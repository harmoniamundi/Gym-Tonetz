// tonnetz-band.js — l'orchestre du Tonnetz : lit la progression avec piano, basse, batterie, etc. selon le style choisi.
//
// Ce fichier reprend TELLES QUELLES les méthodes d'orchestre du moteur de Jam de Chord Scales : piano, basse, batterie, guitare, cuivres,
// accordéon, tango… et appelle les mêmes fonctions pures du dossier app/js/band/ (swing-plan, pop-plan, latin-plan, cuban-plan,
// brass-plan, balkan-plan, piazzolla-plan, classic-plan, meter-plan, ternary-plan). Les styles sonnent donc comme dans la Jam de Chord Scales.
// Seule la « colle » est propre au Tonnetz (en bas de la classe) : la progression remplace la grille, il n'y a pas de métronome.
//
// Chargé par index.html après les modules de app/js/. Les blocs repris de Chord Scales sont signalés par « ===== Recopié de JamEngine ===== ».

class TonnetzBand {
    constructor(app) {
        this.app = app;                 // { audioCtx, pianoInstrument, _pianoPromise, activeAudioNodes } (voir tonnetz.js)
        this.grid = [];                 // la progression : { rootIndex, chordId, measures }
        this.bpm = 100;
        this.isPlaying = false;
        this.currentStepIndex = 0;
        this.currentBeat = 0;
        this.loopEnabled = true;
        this.timer = null;
        this._runId = 0;
        this._LEAD = 0.12;
        this._FIRST_LEAD = 0.35;
        this._beatAudio = null;
        this._beatAudioTime = null;
        this.onBeat = null;             // rappel d'affichage : ({ stepIdx, beat, bpb, measure, total })
        this.onStop = null;

        this.instrumentKey = 'C';       // hauteurs réelles : ce qui est écrit est ce qui sonne
        this.bandStyle = 'swing';
        this.bandVolumes = { piano: 0.5, bass: 0.85, drums: 0.25, bandoneon: 0.7, violin: 0.6, guitar: 0.5 };
        this.bandReverb = 0.25;
        this.bandMaster = (typeof MASTER_UNITY !== 'undefined') ? MASTER_UNITY : 0.5;
        this.masterBus = null;
        this.beatsPerBar = 4;
        this.ternary = false;
        this.bandGains = { piano: null, bass: null, drums: null, bandoneon: null, violin: null, guitar: null };
        this.bandReverbInput = null;
        this.bandReverbWet = null;
        this._bandConvolver = null;
        this.masterShaper = null;
        this.perfMode = 'auto';
        this.perfTier = this._initialPerfTier();
        this._perfPrev = null; this._perfLog = []; this._perfCooldown = 0;
        this._applyPerfTier();
        this.bassInstrument = null;
        this.bandPianoInstrument = null;
        this.bandAudioNodes = [];
        this._noiseBuffer = null;
        Object.assign(this, bandRunState(0), bandVoiceState());
        this.bassInstrumentPop = null;
        this._bassPopLoading = false;
        this.guitarInstrument = null;
        this.brassInst = {}; this._brassLoading = {};
        this.accordionInstrument = null; this._accordionLoading = false; this._accordionBus = null;
        this.pzInst = {}; this._pzLoading = {}; this._pzFail = {}; this._pzBuses = null;
        this._guitarLoading = false;
        this._bandGroove = null;
        this._arpPrevStyle = null;
        this._seedBase = 0;
    }

    // ===== Recopié de JamEngine : orchestre (index.html, de ensureBandAudio à findChordObj) =====
            // --- Bande son "Orchestre" : piano (comping), basse et batterie synthétisées ---

            ensureBandAudio() {
                if (!this.app.audioCtx) return;
                const ctx = this.app.audioCtx;

                if (!this.bandReverbInput) {
                    const convolver = ctx.createConvolver();
                    const rate = ctx.sampleRate;
                    const length = Math.floor(rate * 1.5);   // 1,5 s au lieu de 2,2 s : convolution ~30 % moins coûteuse
                    const impulse = ctx.createBuffer(2, length, rate);
                    for (let ch = 0; ch < 2; ch++) {
                        const data = impulse.getChannelData(ch);
                        for (let i = 0; i < length; i++) {
                            const decay = Math.exp(-i / (rate * 0.45));
                            data[i] = (Math.random() * 2 - 1) * decay;
                        }
                    }
                    convolver.buffer = impulse;
                    const dry = ctx.createGain();
                    const wet = ctx.createGain();
                    dry.gain.value = 1;
                    wet.gain.value = this.bandReverb * 2;
                    const output = ctx.createGain();
                    output.gain.value = 1;
                    this.bandReverbInput = ctx.createGain();
                    this.bandReverbWet = wet;
                    this.bandReverbInput.connect(dry);
                    this.bandReverbInput.connect(convolver);
                    dry.connect(output);
                    convolver.connect(wet);
                    wet.connect(output);
                    output.connect(this._getMasterBus(ctx));
                    this._bandConvolver = convolver;
                    this._bandConvolverOn = true;   // connectée ci-dessus ; _applyPerfTier la débranche si inutile
                    this._applyPerfTier();
                }

                const dest = this.bandReverbInput;
                if (!this.bandGains.piano) {
                    this.bandGains.piano = ctx.createGain();
                    this.bandGains.piano.gain.value = this.bandVolumes.piano;
                    this.bandGains.piano.connect(dest);
                }
                if (!this.bandGains.bass) {
                    this.bandGains.bass = ctx.createGain();
                    this.bandGains.bass.gain.value = this.bandVolumes.bass;
                    this.bandGains.bass.connect(dest);
                }
                if (!this.bandGains.drums) {
                    this.bandGains.drums = ctx.createGain();
                    this.bandGains.drums.gain.value = this.bandVolumes.drums;
                    this.bandGains.drums.connect(dest);
                }
                this.loadBandPiano();
                if (this.bandStyle === 'brass') this.loadBrass();
                if (this.bandStyle === 'balkan') this.loadAccordion();
                if (this.bandStyle === 'piazzolla') this.loadPiazzolla();
                if (this.bandStyle !== 'classic' && !this.bassInstrument) this.loadBass();
                if (this.bandStyle === 'pop') this.loadBassPop();
                if (this.bandStyle === 'latin') this.loadGuitarLatin();
            }

            // Piano de l'orchestre. soundfont-player n'honore l'option « destination » qu'à la création de l'instrument (pas
            // note par note) : le piano partagé de l'application sort donc directement vers la sortie audio et contourne le
            // bus de l'orchestre (réverbération, Master). On charge donc une seconde instance, branchée dès sa création sur
            // bandGains.piano, exactement comme la basse.
            // Charge un instrument soundfont. Si `donor` (promesse d'un instrument déjà chargé, même nom) est fourni, ses
            // échantillons déjà décodés sont réutilisés : on ne décode pas une seconde fois la même banque (dizaines de Mo de
            // mémoire pour un piano). Le nouvel instrument garde sa propre sortie audio. En cas de doute : chargement complet.
            _loadInstrumentShared(ctx, name, opts, donor) {
                const full = () => Soundfont.instrument(ctx, name, opts);
                if (!donor) return full();
                return donor.then((src) => {
                    if (!src || !src.buffers || typeof src.buffers !== 'object' || !Object.keys(src.buffers).length) return full();
                    // On ne décode qu'une note (le temps de créer l'instrument), puis on lui donne les échantillons du premier.
                    return Soundfont.instrument(ctx, name, Object.assign({}, opts, { only: ['C4'] })).then((inst) => {
                        if (inst && typeof inst === 'object' && 'buffers' in inst) { inst.buffers = src.buffers; return inst; }
                        return full();
                    }, full);
                }, full);
            }

            loadBandPiano() {
                if (this.bandPianoInstrument || this._bandPianoLoading || !this.app.audioCtx || !this.bandGains.piano) return;
                this._bandPianoLoading = true;
                this._loadInstrumentShared(this.app.audioCtx, 'acoustic_grand_piano', {
                    soundfont: 'FluidR3_GM',
                    destination: this.bandGains.piano
                }, this.app.pianoInstrument ? Promise.resolve(this.app.pianoInstrument) : (this.app._pianoPromise || null))
                    .then(instr => { this.bandPianoInstrument = instr; })
                    .catch(() => { setTimeout(() => { this._bandPianoLoading = false; }, 5000); });
            }

            loadBass() {
                if (this.bassInstrument || this._bassLoading || !this.app.audioCtx) return;
                this._bassLoading = true;
                Soundfont.instrument(this.app.audioCtx, 'acoustic_bass', {
                    soundfont: 'FluidR3_GM',
                    destination: this.bandGains.bass || this.app.audioCtx.destination
                })
                    .then(instr => { this.bassInstrument = instr; })
                    .catch(() => { setTimeout(() => { this._bassLoading = false; }, 5000); });
            }

            // Basse électrique (doigts) pour le style Pop ; tant qu'elle n'est pas chargée, la contrebasse prend le relais.
            loadBassPop() {
                if (this.bassInstrumentPop || this._bassPopLoading || !this.app.audioCtx) return;
                this._bassPopLoading = true;
                Soundfont.instrument(this.app.audioCtx, 'electric_bass_finger', {
                    soundfont: 'FluidR3_GM',
                    destination: this.bandGains.bass || this.app.audioCtx.destination
                })
                    .then(instr => { this.bassInstrumentPop = instr; })
                    .catch(() => { setTimeout(() => { this._bassPopLoading = false; }, 5000); });
            }

            // Guitare classique (nylon) du style Latin ; elle passe par le bus « piano » (curseur de volume du premier
            // instrument, réverbération de l'orchestre). Tant qu'elle n'est pas chargée, le piano joue les mêmes notes.
            // Chaîne de traitement de la guitare : retire le grave inutile, ajoute du corps (résonance de la caisse
            // vers 110 Hz, léger relief vers 250 Hz), creuse le « pincé » métallique du médium-aigu (3 kHz) et adoucit
            // les aigus ; un compresseur doux calme les attaques. C'est ce qui enlève le côté « casserole ».
            _getGuitarBus() {
                if (this._guitarBus) return this._guitarBus;
                const ctx = this.app.audioCtx;
                const f = (type, freq, gain, q) => {
                    const n = ctx.createBiquadFilter();
                    n.type = type; n.frequency.value = freq;
                    if (gain !== undefined) n.gain.value = gain;
                    if (q !== undefined) n.Q.value = q;
                    return n;
                };
                const hp = f('highpass', 70, undefined, 0.7);
                const body = f('peaking', 115, 3.5, 1.1);
                const warm = f('lowshelf', 260, 2.5);
                const ping = f('peaking', 2900, -4.5, 0.9);
                const air = f('highshelf', 4200, -7);
                const lp = f('lowpass', 7000, undefined, 0.5);
                const comp = ctx.createDynamicsCompressor();
                comp.threshold.value = -26; comp.knee.value = 18; comp.ratio.value = 2.5;
                comp.attack.value = 0.006; comp.release.value = 0.18;
                const makeup = ctx.createGain();
                makeup.gain.value = 1.35;
                const chain = [hp, body, warm, ping, air, lp, comp, makeup];
                for (let k = 0; k + 1 < chain.length; k++) chain[k].connect(chain[k + 1]);
                makeup.connect(this.bandGains.piano || ctx.destination);
                this._guitarBus = hp;
                return hp;
            }

            loadGuitarLatin() {
                if (this.guitarInstrument || this._guitarLoading || !this.app.audioCtx) return;
                this._guitarLoading = true;
                const ctx = this.app.audioCtx;
                const destination = this._getGuitarBus();
                const done = (instr) => { this.guitarInstrument = instr; };
                // Banque « MusyngKite » : nylon bien plus riche que celle de FluidR3_GM ; repli sur cette dernière si besoin.
                Soundfont.instrument(ctx, 'acoustic_guitar_nylon', { soundfont: 'MusyngKite', destination })
                    .then(done)
                    .catch(() => Soundfont.instrument(ctx, 'acoustic_guitar_nylon', { soundfont: 'FluidR3_GM', destination })
                        .then(done)
                        .catch(() => { setTimeout(() => { this._guitarLoading = false; }, 5000); }));
            }

            getNoiseBuffer() {
                if (this._noiseBuffer) return this._noiseBuffer;
                this._noiseBuffer = makeNoiseBuffer(this.app.audioCtx);
                return this._noiseBuffer;
            }

            // Courbe de saturation douce (waveshaper) utilisée pour donner du corps
            // et un peu de grain analogique à la grosse caisse et à la caisse claire.
            getSaturationCurve() {
                if (this._satCurve) return this._satCurve;
                this._satCurve = makeSaturationCurve();
                return this._satCurve;
            }

            // Bus de réverbération partagé pour les cymbales : un long halo métallique dans lequel
            // chaque coup envoie une partie de son signal, pour un son qui s'épanouit et traîne
            // naturellement plutôt que de claquer sec comme une casserole.
            getCymbalReverb() {
                if (this._cymbalReverbNode) return this._cymbalReverbNode;
                const ctx = this.app.audioCtx;
                const convolver = ctx.createConvolver();
                const rate = ctx.sampleRate;
                const length = Math.floor(rate * 1.6);   // 1,6 s au lieu de 2,2 s
                const impulse = ctx.createBuffer(2, length, rate);
                for (let ch = 0; ch < 2; ch++) {
                    const data = impulse.getChannelData(ch);
                    for (let i = 0; i < length; i++) {
                        const decay = Math.pow(1 - i / length, 2.4);
                        data[i] = (Math.random() * 2 - 1) * decay;
                    }
                }
                convolver.buffer = impulse;
                const wet = ctx.createGain();
                wet.gain.value = 1;
                convolver.connect(wet);
                wet.connect(this.bandGains.drums);
                this._cymbalReverbNode = convolver;
                return convolver;
            }

            playBandDrum(e, time) {
                let dest = this.bandGains.drums;
                if (!dest) return;
                // Niveau minimal : on laisse tomber les notes fantômes et percussions d'ornement
                if (this.perfTier >= 2 && (e.drum === 'ghost' || e.drum === 'pedal' || e.drum === 'chich' || e.drum === 'latigo')) return;
                let v = e.vel * (0.92 + Math.random() * 0.16);
                // Brass band : percussions en retrait (bus plus doux et plus sombre ; cymbales encore plus discrètes)
                if (this.bandStyle === 'brass') {
                    dest = this._getBrassPercBus();
                    if (e.drum === 'crash' || e.drum === 'clash') v *= 0.6;
                }
                // Percussion pré-calculée : le même son de synthèse, rendu une fois pour toutes puis rejoué (1 source + 1 gain
                // par coup au lieu de 5 à 25 nœuds). Tant que l'échantillon n'est pas prêt, on joue la synthèse en direct.
                try { if (this._playDrumSample(e, time, dest, v)) return; } catch (err) {}
                this._synthDrumLive(e, time, dest, v);
            }

            // ---- Percussions pré-calculées (OfflineAudioContext) ----
            // Retourne { drum, mul, freq, short, name, variants, maxDur } décrivant l'échantillon d'un coup, ou null.
            _drumSpec(e) { return drumSpec(e); }

            _playDrumSample(e, time, dest, v) {
                const ctx = this.app.audioCtx;
                if (!ctx || this._drumSamplesOff || !(window.OfflineAudioContext || window.webkitOfflineAudioContext)) return false;
                if (this._drumSampleCtx !== ctx) { this._drumSamples = new Map(); this._drumPending = new Set(); this._drumQueue = null; this._drumSampleCtx = ctx; }
                const spec = this._drumSpec(e);
                if (!spec) return false;
                // Deux niveaux de force pour les sons courts (la courbe d'enveloppe dépend un peu de la force) ; un seul pour les cymbales
                const ref = (!spec.long && v < 0.72) ? 0.5 : 1;
                // On choisit au hasard parmi les variantes prêtes ; on lance le calcul de celles qui manquent
                const ready = [];
                for (let k = 0; k < spec.variants; k++) {
                    const key = `${this.perfTier}|${spec.name}|${ref}|${k}`;
                    const smp = this._drumSamples.get(key);
                    if (smp) ready.push(smp);
                    else if (smp === undefined) this._requestDrumSample(key, spec, ref, ctx, this.perfTier);
                }
                if (!ready.length) return false;
                const smp = ready.length === 1 ? ready[0] : ready[Math.floor(Math.random() * ready.length)];
                const gain = (v * spec.mul) / ref;

                const src = ctx.createBufferSource();
                src.buffer = smp.dry;
                const g = ctx.createGain();
                g.gain.value = gain;
                src.connect(g); g.connect(dest);
                src.start(time);
                this.bandAudioNodes.push(src);
                if (smp.wet && this.perfTier < 1) {
                    // Part envoyée à la réverbération des cymbales (déjà dosée dans l'échantillon)
                    const rv = this.getCymbalReverb();
                    const src2 = ctx.createBufferSource();
                    src2.buffer = smp.wet;
                    const g2 = ctx.createGain();
                    g2.gain.value = gain;
                    src2.connect(g2); g2.connect(rv);
                    src2.start(time);
                    this.bandAudioNodes.push(src2);
                }
                return true;
            }

            _requestDrumSample(key, spec, ref, ctx, tier) {
                if (!this._drumPending) this._drumPending = new Set();
                if (this._drumPending.has(key)) return;
                this._drumPending.add(key);
                // Un seul calcul à la fois, en arrière-plan : on ne gêne pas la lecture en cours
                this._drumQueue = (this._drumQueue || Promise.resolve())
                    .then(() => this._renderDrumSample(key, spec, ref, ctx, tier))
                    .catch(() => { if (this._drumSampleCtx === ctx) this._drumSamples.set(key, false); });
            }

            _renderDrumSample(key, spec, ref, liveCtx, tier) {
                if (this._drumSampleCtx !== liveCtx) return Promise.resolve();
                const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
                const sr = liveCtx.sampleRate;
                const off = new OAC(2, Math.ceil(sr * spec.maxDur), sr);
                const merger = off.createChannelMerger(2);
                merger.connect(off.destination);
                const dry = off.createGain(); dry.connect(merger, 0, 0);
                const wet = off.createGain(); wet.connect(merger, 0, 1);
                this.getNoiseBuffer(); // créé avec le vrai contexte (le même bruit que la synthèse en direct)
                this.getSaturationCurve();
                // La synthèse en direct est rejouée telle quelle, branchée sur le contexte hors-ligne (l'état du moteur n'est pas touché)
                const rt = {
                    ctx: off,
                    tier,                           // niveau de qualité en vigueur quand l'échantillon a été demandé
                    nodes: [],
                    noise: () => this.getNoiseBuffer(), curve: () => this.getSaturationCurve(),
                    reverb: () => wet               // l'envoi vers la réverbération est capturé sur le canal 2
                };
                synthDrumLive(rt, { drum: spec.drum, freq: spec.freq, short: spec.short }, 0, dry, ref);
                return off.startRendering().then((rendered) => {
                    if (this._drumSampleCtx !== liveCtx) return;
                    const ch0 = rendered.getChannelData(0), ch1 = rendered.getChannelData(1);
                    let last = 0, wetLast = 0;
                    for (let i = ch0.length - 1; i >= 0; i--) if (Math.abs(ch0[i]) > 1e-4) { last = i; break; }
                    for (let i = ch1.length - 1; i >= 0; i--) if (Math.abs(ch1[i]) > 1e-4) { wetLast = i; break; }
                    const mk = (data, n) => {
                        const b = liveCtx.createBuffer(1, Math.max(1, n), sr);
                        b.copyToChannel(data.subarray(0, Math.max(1, n)), 0);
                        return b;
                    };
                    const sample = { dry: mk(ch0, Math.min(ch0.length, last + 64)), wet: wetLast > 0 ? mk(ch1, Math.min(ch1.length, wetLast + 64)) : null };
                    this._drumSamples.set(key, sample);
                });
            }

            _synthDrumLive(e, time, dest, v) { synthDrumLive(this._drumRt(), e, time, dest, v); }

            // Environnement de synthèse des percussions (voir audio/drum-synths.js)
            _drumRt() {
                return { ctx: this.app.audioCtx, tier: this.perfTier, nodes: this.bandAudioNodes,
                    noise: () => this.getNoiseBuffer(), curve: () => this.getSaturationCurve(), reverb: () => this.getCymbalReverb() };
            }

            // --- Basse ---

            // Ce dont audio/note-events.js a besoin pour calculer les notes (voir ce fichier).
            _noteEnv() {
                return {
                    instrumentKey: this.instrumentKey, currentTime: this.app.audioCtx ? this.app.audioCtx.currentTime : 0,
                    transOffset: this._jamTransOffset(), perfTier: this.perfTier, bassVolume: this.bandVolumes.bass
                };
            }

            // Joue des notes calculées (audio/note-events.js) sur un instrument soundfont et garde les nœuds pour pouvoir les couper.
            _playNotes(inst, notes) {
                notes.forEach(n => {
                    try { this.bandAudioNodes.push(inst.play(n.noteStr, n.when, n.opts)); } catch (err) {}
                });
            }

            // --- Basse ---

            playBassAbs(absSemi, time, duration, vel = 0.85, wide = false) {
                const inst = (this.bandStyle === 'pop' && this.bassInstrumentPop) ? this.bassInstrumentPop : this.bassInstrument;
                if (!inst) return;
                // soundfont-player n'honore l'option "destination" qu'à la création de l'instrument, pas par note : le curseur
                // de volume de la basse est donc appliqué directement au gain de la note (wide : dynamique élargie, style Pop).
                const n = bassNote(this._noteEnv(), absSemi, time, duration, vel, wide);
                this._playNotes(inst, [n]);
            }

            // --- Piano ---

            playPianoHit(e, time, beatSec) {
                // Piano de l'orchestre (branché sur le bus : volume du piano, réverbération et Master s'appliquent). Tant qu'il
                // n'est pas chargé, le piano partagé prend le relais, avec volume et Master appliqués directement au gain.
                const inst = this.bandPianoInstrument || this.app.pianoInstrument;
                if (!inst || !this.app.audioCtx) return;
                const viaBus = !!this.bandPianoInstrument;
                const notes = pianoNotes({ ...this._noteEnv(), viaBus, outGain: this.bandVolumes.piano * masterGainFor(this.bandMaster) }, e, time, beatSec);
                if (viaBus) notes.forEach(n => { n.opts.destination = this.bandGains.piano; });
                this._playNotes(inst, notes);
            }

            // --- Planification rythmique ---
            // Chaque mesure est planifiée au premier temps (buildBandPlan) : le plan liste toutes les
            // frappes (piano, basse, batterie) avec leur position en temps (0 à 4). playBandBeat joue
            // ensuite, à chaque temps, les frappes qui tombent dans ce temps.
            // Les patterns sont organisés en phrases (4 mesures en général) : motif, reprise, variation,
            // puis mesure de « turnaround » qui anticipe l'accord suivant et peut se terminer par un fill.

            // Rapport de swing : triolet au départ, qui se rapproche des croches droites quand le tempo monte.
            getBandSwing() { return bandSwing(this.bandStyle, this.bpm); }

            getBandPhraseLength() { return bandPhraseLength(this.grid); }

            buildBandPhrase(index, style) {
                const rng = this.makeVariationRng(this._bandSeed + index * 7919 + 1, style);
                const ctx = {
                    lib: this.getPatternLib(style), bpb: this.getBeatsPerBar(), ternary: this.isTernary(),
                    bpm: this.bpm, isCuba: this.bandStyle === 'cuba', groove: this.getEffectiveGroove(), rng
                };
                return buildBandPhrase(ctx, index, style, this._bandPhrase);
            }

            buildBandPlan(step, nextStep, measureInStep, isLastMeasureOfStep) {
                // Orchestre « Cuba » : l'orchestration afro-cubaine (piano montuno, tumbao, cloche, congas, clave) pour n'importe quelle
                // grille ; il s'appuie sur la génération Latin avec le rythme « afro » imposé.
                const cuba = this.bandStyle === 'cuba';
                const style = cuba ? 'latin' : (BAND_PATTERNS[this.bandStyle] ? this.bandStyle : 'swing');
                const L = this.getBandPhraseLength();
                const m = this._bandMeasureCounter - 1; // index de mesure depuis le début de la jam
                const phraseIndex = Math.floor(m / L);
                const i = m % L;
                if (!this._bandPhrase || this._bandPhrase.index !== phraseIndex || this._bandPhrase.style !== style || !!this._bandPhrase.cuba !== cuba) {
                    this._bandPhrase = this.buildBandPhrase(phraseIndex, style);
                    this._bandPhrase.cuba = cuba;
                }
                const ph = this._bandPhrase;
                const swing = this.getBandSwing();
                const isTurn = L > 1 && i === L - 1;
                // Une frappe tombant sur le "et" du temps 4 de la dernière mesure d'un accord
                // annonce déjà l'accord suivant (anticipation).
                // Mesure à deux accords : temps 1-2 sur le premier accord, temps 3-4 sur le second
                const halves = this.isSplitEffective(step) ? this.getStepHalves(step) : null;
                // 2/4 et 3/4 : générateur dédié (les motifs ci-dessous sont écrits pour 4 temps)
                const bpbNow = this.getBeatsPerBar();
                // Bouton « Arpèges » : arpège simple (basse puis notes de l'accord en montant), quelle que soit la signature
                if (this._arpPrevStyle) return this.buildArpPlan(bpbNow, step, nextStep, isLastMeasureOfStep, halves);
                // Brass band : orchestre dédié (cuivres, tubas, caisse claire, grosse caisse, timbales), quelle que soit la signature
                if (style === 'brass') return this.buildBrassPlan(bpbNow, this.isTernary(), step, nextStep, isLastMeasureOfStep, halves, ph, i, L, isTurn, m);
                // Balkans : accordéon, basse, percussions (tapan / darbuka), quelle que soit la signature
                if (style === 'balkan') return this.buildBalkanPlan(bpbNow, this.isTernary(), step, nextStep, isLastMeasureOfStep, halves, ph, i, L, isTurn, m);
                // Tango nuevo : bandonéon, violon, piano, guitare électrique, contrebasse, quelle que soit la signature
                if (style === 'piazzolla') return this.buildPiazzollaPlan(bpbNow, this.isTernary(), step, nextStep, isLastMeasureOfStep, halves, ph, i, L, isTurn, m);
                // Rythme afro-cubain : orchestre dédié (piano montuno, tumbao, cloche, congas), quelle que soit la signature
                if (cuba && style === 'latin') return this.buildCubanPlan(bpbNow, this.isTernary(), step, nextStep, isLastMeasureOfStep, halves, ph, i, L, isTurn, m);
                if (this.isTernary()) return this.buildTernaryPlan(bpbNow, style, step, nextStep, isLastMeasureOfStep, halves, ph, i, L, isTurn, m);
                if (bpbNow !== 4) return this.buildMeterPlan(bpbNow, style, step, nextStep, isLastMeasureOfStep, halves, ph, i, L, isTurn, m);
                if (style === 'pop') return this.buildPopPlan(step, nextStep, isLastMeasureOfStep, halves, ph, i, L, isTurn, m);
                if (style === 'latin') return this.buildLatinPlan(step, nextStep, isLastMeasureOfStep, halves, ph, i, L, isTurn, m);
                if (style === 'classic') return this.buildClassicPlan(step, nextStep, isLastMeasureOfStep, halves, ph, i, L, isTurn, m);
                return this._bandRun(['bandLastFill'], env => buildStandardPlan(env, style, step, nextStep, isLastMeasureOfStep, halves, ph, i, L, isTurn, m), { swing });
            }

            // ===================== Orchestration POP =====================
            // Chaque phrase reçoit une « énergie » (0 à 1) qui pilote ensemble le piano (nappe tenue, arpèges liés,
            // comping syncopé), la basse (notes longues, rythmes pointés, croches, lignes chantantes) et la batterie
            // (charleston en noires / croches / « drive », cross-stick, demi-tempo, fills). Le piano enchaîne ses accords
            // par conduite des voix, tient ses notes comme avec la pédale, retarde parfois la tierce (sus4 → 3) et relie
            // les accords par de courtes phrases conjointes ; la basse anticipe l'accord suivant en même temps que le
            // piano, et la grosse caisse se cale sur les attaques de la basse.

            _jamTransOffset() {
                return ({ C: 0, Bb: -2, Eb: -9 })[this.instrumentKey] || 0;
            }

            // Ce dont les fonctions pures de band/ ont besoin pour lire l'état du moteur.
            _bandEnv() { return { transOffset: this._jamTransOffset(), findChordObj: (id) => this.findChordObj(id) }; }

            // Exécute une fonction pure de band/ avec la mémoire du moteur : les propriétés `_nom` listées sont copiées dans
            // env.state.nom avant l'appel puis recopiées dans le moteur après (la fonction les modifie en place).
            _bandRun(keys, fn, extra) {
                const state = {};
                keys.forEach(k => { state[k] = this['_' + k]; });
                const out = fn({ ...this._bandEnv(), ...extra, state });
                keys.forEach(k => { this['_' + k] = state[k]; });
                return out;
            }

            // ===================== Orchestration POP : le calcul est dans band/pop-plan.js =====================
            buildPopPlan(step, nextStep, isLastMeasureOfStep, halves, ph, i, L, isTurn, m) {
                return this._bandRun(['popVoice', 'popRunAt', 'bandLastFill'], env => buildPopPlan(env, step, nextStep, isLastMeasureOfStep, halves, ph, i, L, isTurn, m));
            }

            // ===================== Orchestration LATIN =====================
            // Guitare classique, basse et batterie travaillent ensemble sur un « groove » choisi par phrase :
            //  - bossa nova : le pouce de la guitare garde le balancement fondamentale / quinte pendant que les doigts
            //    suivent la clave 3-2 (temps 1, 2&, 4 puis 2, 3), arpèges de pouce en mode doux, basse en « noire pointée »,
            //    charleston en croches, cross-stick sur la clave ;
            //  - samba : batida de guitare avec accords étouffés sur les doubles croches, basse « courte-longue »,
            //    surdo à la grosse caisse (temps 2 et 4 forts), charleston en doubles croches ;
            //  - afro-cubain : guajeo arpégé, basse en tumbao qui anticipe l'accord suivant (note tenue sur le 1),
            //    clave et petites toms façon congas.
            // Le groove tend à rester stable d'une phrase à l'autre (il suit aussi le tempo) ; l'énergie de la phrase choisit
            // la densité de la guitare et de la batterie. Les accords de guitare sont placés dans un registre de guitare et
            // enchaînés par conduite des voix, avec coups descendants (accords pleins) et montants (cordes aiguës).

            // ===================== Orchestration LATIN : le calcul est dans band/latin-plan.js =====================

            buildLatinPlan(step, nextStep, isLastMeasureOfStep, halves, ph, i, L, isTurn, m) {
                return this._bandRun(['latVoice', 'latTie', 'latRunAt', 'bandLastFill'], env => buildLatinPlan(env, step, nextStep, isLastMeasureOfStep, halves, ph, i, L, isTurn, m));
            }

            // Jeu d'une frappe de guitare : notes de l'accord « grattées » (coup descendant du grave à l'aigu, coup
            // montant de l'aigu au grave), voix extrêmes un peu en avant. Sans guitare chargée, le piano prend le relais.
            playGuitarHit(e, time, beatSec) {
                const inst = this.guitarInstrument;
                if (!inst || !this.app.audioCtx) { this.playPianoHit(e, time, beatSec); return; }
                // Le volume est réglé par le bus (bandGains.piano) : pas de second facteur de volume ici.
                this._playNotes(inst, guitarNotes(this._noteEnv(), e, time, beatSec));
            }

            // ===================== Signatures 2/4 et 3/4 =====================
            // Les générateurs 4/4 ci-dessus sont écrits pour quatre temps. Pour le 2/4 et le 3/4, ce générateur écrit chaque
            // style directement dans la durée de la mesure, à partir des motifs de METER_LIB : valse jazz / deux temps swing,
            // pop (ballade, valse, marche, polka), bossa-valse / valsa / samba / baião, arpèges classiques. Comme en 4/4, chaque
            // phrase choisit ses cellules (ph.mx) puis les reprend, les varie et se « referme » sur la dernière mesure, où
            // l'accord suivant est annoncé sur le « et » du dernier temps. Une mesure à deux accords se coupe après
            // getSplitBeat() temps (2/4 : 1+1 ; 3/4 : 2+1).

            getPatternLib(style) { return patternLib(this.getMeterKey(), style); }

            // Choix propres au 3/4 et au 2/4, faits une fois par phrase et gardés pendant toute la phrase.

            buildMeterPlan(bpb, style, step, nextStep, isLastMeasureOfStep, halves, ph, i, L, isTurn, m) {
                const extra = { splitBeat: this.getSplitBeat(), meterKey: this.getMeterKey(), swing: this.getBandSwing() };
                return this._bandRun(['meterVoice', 'bandLastFill'], env => buildMeterPlan(env, bpb, style, step, nextStep, isLastMeasureOfStep, halves, ph, i, L, isTurn, m), extra);
            }

            // ===================== Mesures composées : 6/8, 9/8, 12/8 =====================
            // La pulsation est la noire pointée (BPM = pulsations par minute) et chaque pulsation se divise en trois croches :
            // les positions du plan restent en pulsations, avec des tiers (croche k = k/3). La mesure est une suite d'unités
            // (voir TERN_LIB) : H de deux pulsations, P d'une pulsation. Comme ailleurs, chaque phrase choisit ses cellules
            // (ph.mx), les reprend, les varie et se « referme » sur la dernière mesure, où l'accord suivant est annoncé sur la
            // dernière croche de la mesure. Une mesure à deux accords se coupe après getSplitBeat() pulsations.

            // Choix propres aux mesures composées, faits une fois par phrase.

            buildTernaryPlan(bpb, style, step, nextStep, isLastMeasureOfStep, halves, ph, i, L, isTurn, m) {
                const extra = { splitBeat: this.getSplitBeat(), meterKey: this.getMeterKey() };
                return this._bandRun(['meterVoice', 'bandLastFill'], env => buildTernaryPlan(env, bpb, style, step, nextStep, isLastMeasureOfStep, halves, ph, i, L, isTurn, m), extra);
            }

            // ===================== Style CLASSIQUE (arpèges au piano) =====================
            // Écriture volontairement simple, uniquement avec les notes de l'accord (celles de l'affichage en jam : 4 notes) :
            // chaque phrase de 4 mesures choisit une « famille » (arpège en croches, en noires, rythmes variés, basse tenue +
            // voix aiguës, accord plaqué + arpège) selon l'énergie de la phrase et le tempo. La mesure 1 pose le motif, la 2
            // le reprend ou en propose un cousin, la 3 le varie légèrement, la dernière le « referme » (moins de notes, note
            // aiguë tenue ou accord doux). Les notes résonnent comme avec la pédale jusqu'au changement d'accord ; les accents
            // tombent sur les temps, la voix aiguë chante un peu plus. Un accord sur basse fait entendre sa basse, en dessous.


            buildClassicPlan(step, nextStep, isLastMeasureOfStep, halves, ph, i, L, isTurn, m) {
                return buildClassicPlan({ ...this._bandEnv(), bpm: this.bpm }, step, nextStep, isLastMeasureOfStep, halves, ph, i, L, isTurn, m);
            }

            buildArpPlan(bpb, step, nextStep, isLastMeasureOfStep, halves) {
                return buildArpPlan({ ...this._bandEnv(), ternary: this.isTernary(), splitBeat: this.getSplitBeat() }, bpb, step, nextStep, isLastMeasureOfStep, halves);
            }

            // ===== Orchestre cubain : le calcul est dans band/cuban-plan.js (fonction pure) =====
            buildCubanPlan(bpb, ternary, step, nextStep, isLastMeasureOfStep, halves, ph, i, L, isTurn, m) {
                return this._bandRun(['latTie'], env => buildCubanPlan(env, bpb, ternary, step, nextStep, isLastMeasureOfStep, halves, ph, i, L, isTurn, m), { splitBeat: this.getSplitBeat() });
            }

            // ===================== Orchestration BRASS BAND =====================
            // Un brass band (fanfare à l'anglaise) : cornets (trompettes), cors ténor, trombones et tubas, avec caisse claire,
            // grosse caisse, cymbales et timbales. Trois « textures » alternent d'une phrase à l'autre : le choral (accords
            // tenus, en crescendo), la marche (tuba sur les temps forts, accords courts sur les temps faibles, caisse claire
            // roulée) et la fanfare (accords marqués, rythmes pointés, timbales et cymbales).
            // Le réalisme vient de l'orchestration : chaque voix de l'accord est jouée par un pupitre (plusieurs échantillons
            // légèrement désaccordés, comme plusieurs instrumentistes), avec une attaque propre à l'articulation (marqué,
            // piqué, tenu, crescendo), un décalage minime entre les joueurs, un filtrage propre à chaque famille de cuivres
            // et un compresseur commun qui « colle » la section.

            _getBrassBuses() {
                if (this._brassBuses) return this._brassBuses;
                const ctx = this.app.audioCtx;
                const f = (type, freq, gain, q) => {
                    const n = ctx.createBiquadFilter();
                    n.type = type; n.frequency.value = freq;
                    if (gain !== undefined) n.gain.value = gain;
                    if (q !== undefined) n.Q.value = q;
                    return n;
                };
                const chain = (nodes, out) => {
                    for (let k = 0; k + 1 < nodes.length; k++) nodes[k].connect(nodes[k + 1]);
                    nodes[nodes.length - 1].connect(out);
                    return nodes[0];
                };
                // Position dans la section (chaque pupitre a sa place, comme sur une scène)
                const pan = (v) => {
                    if (!ctx.createStereoPanner) return ctx.createGain();
                    const n = ctx.createStereoPanner(); n.pan.value = v; return n;
                };
                // Léger vibrato du pupitre (ligne à retard modulée) : quelques cents seulement, une vitesse propre à chaque pupitre
                const vib = (rate, depth) => {
                    const d = ctx.createDelay(0.05);
                    d.delayTime.value = 0.004;
                    const lfo = ctx.createOscillator();
                    lfo.frequency.value = rate;
                    const lg = ctx.createGain();
                    lg.gain.value = depth;
                    lfo.connect(lg); lg.connect(d.delayTime);
                    lfo.start();
                    return d;
                };
                // Section de cuivres : mélange des pupitres, compresseur doux, puis le bus « piano » (curseur Cuivres)
                const mix = ctx.createGain();
                mix.gain.value = 1;
                const comp = ctx.createDynamicsCompressor();
                comp.threshold.value = -22; comp.knee.value = 14; comp.ratio.value = 3;
                comp.attack.value = 0.01; comp.release.value = 0.22;
                const makeup = ctx.createGain();
                makeup.gain.value = 1.25;
                mix.connect(comp); comp.connect(makeup); makeup.connect(this.bandGains.piano || ctx.destination);
                // Tuba : bus « basse » (curseur Tubas)
                const tubaOut = this.bandGains.bass || ctx.destination;
                this._brassBuses = {
                    // cornet 1 : le plus brillant, mais sans l'éclat nasillard de l'échantillon (creux vers 3 kHz, aigus raccourcis)
                    trumpet: chain([f('highpass', 200, undefined, 0.7), f('peaking', 1100, 1.5, 0.9), f('peaking', 2900, -4.5, 1), f('highshelf', 3800, -3), f('lowpass', 5200, undefined, 0.5), vib(4.7, 0.00011), pan(0.22)], mix),
                    // cornet 2 : plus sombre et plus rond (côté bugle), un peu à gauche, vibrato plus lent
                    trumpet2: chain([f('highpass', 220, undefined, 0.7), f('lowshelf', 500, 1.5), f('peaking', 2700, -5, 1), f('highshelf', 3400, -3), f('lowpass', 4300, undefined, 0.5), vib(5.3, 0.0001), pan(-0.2)], mix),
                    // cors : ronds et chauds, de part et d'autre
                    french_horn: chain([f('highpass', 100, undefined, 0.7), f('lowshelf', 250, 2), f('lowpass', 4600, undefined, 0.5), pan(-0.38)], mix),
                    french_horn2: chain([f('highpass', 110, undefined, 0.7), f('lowshelf', 250, 1.5), f('lowpass', 4200, undefined, 0.5), pan(0.32)], mix),
                    // trombone ténor : corps dans le grave-médium, un peu de mordant vers 900 Hz
                    trombone: chain([f('highpass', 70, undefined, 0.7), f('lowshelf', 200, 2.5), f('peaking', 900, 1.5, 1), f('lowpass', 4800, undefined, 0.5), pan(0.14)], mix),
                    // trombone basse : plus sombre
                    trombone2: chain([f('highpass', 60, undefined, 0.7), f('lowshelf', 180, 3), f('peaking', 800, 1, 1), f('lowpass', 4000, undefined, 0.5), pan(-0.12)], mix),
                    // tuba : profond, sans bruit de souffle
                    tuba: chain([f('highpass', 38, undefined, 0.7), f('lowshelf', 140, 2), f('peaking', 650, -2, 1), f('lowpass', 2600, undefined, 0.5)], tubaOut)
                };
                return this._brassBuses;
            }

            // Bus des percussions du brass band : plus doux, adouci dans l'aigu, en retrait derrière les cuivres.
            _getBrassPercBus() {
                const ctx = this.app.audioCtx;
                if (this._brassPercBus && this._brassPercBus.ctx === ctx) return this._brassPercBus.node;
                const g = ctx.createGain();
                g.gain.value = 0.55;
                const lp = ctx.createBiquadFilter();
                lp.type = 'lowpass'; lp.frequency.value = 5200; lp.Q.value = 0.5;
                g.connect(lp); lp.connect(this.bandGains.drums || ctx.destination);
                this._brassPercBus = { ctx, node: g };
                return g;
            }

            // Charge les pupitres (banque « MusyngKite », plus réaliste ; repli sur « FluidR3_GM »). Chaque pupitre est un
            // instrument à part, avec sa propre chaîne de filtres et sa place dans l'espace : deux cornets, deux cors, deux
            // trombones (ténor et basse), et le tuba. Tant que les cuivres ne sont pas tous chargés, le piano et la contrebasse
            // prennent le relais.
            loadBrass() {
                const ctx = this.app.audioCtx;
                if (!ctx || !this.bandGains.piano || !this.bandGains.bass) return;
                const buses = this._getBrassBuses();
                [['trumpet', 'trumpet'], ['french_horn', 'french_horn'], ['trombone', 'trombone'], ['tuba', 'tuba'],
                 ['trumpet2', 'trumpet'], ['french_horn2', 'french_horn'], ['trombone2', 'trombone']].forEach(([key, name]) => {
                    if (this.brassInst[key] || this._brassLoading[key]) return;
                    this._brassLoading[key] = true;
                    const destination = buses[key];
                    const done = (instr) => { this.brassInst[key] = instr; };
                    // Les pupitres « 2 » (deuxième cornet, cor, trombone) réutilisent les échantillons du premier
                    const isDup = key !== name;
                    const donor = !isDup ? null : (this.brassInst[name] ? Promise.resolve(this.brassInst[name]) : ((this._brassBase && this._brassBase[name]) || null));
                    const p = this._loadInstrumentShared(ctx, name, { soundfont: 'MusyngKite', destination }, donor)
                        .then(done)
                        .catch(() => this._loadInstrumentShared(ctx, name, { soundfont: 'FluidR3_GM', destination }, donor)
                            .then(done)
                            .catch(() => { setTimeout(() => { this._brassLoading[key] = false; }, 5000); }));
                    if (!isDup) { if (!this._brassBase) this._brassBase = {}; this._brassBase[name] = p.then(() => this.brassInst[key] || null); }
                });
            }

            _brassParts(V) { return brassParts(V); }

            // Souffle d'attaque : un grain de bruit très bref et très doux dans le médium aigu, que l'on entend avec la langue.
            _brassBreath(time, level) {
                const ctx = this.app.audioCtx;
                const bus = this._brassBuses && this._brassBuses.trumpet;
                if (!ctx || !bus || !this.getNoiseBuffer) return;
                try {
                    const src = ctx.createBufferSource();
                    src.buffer = this.getNoiseBuffer();
                    const bp = ctx.createBiquadFilter();
                    bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 0.7;
                    const g = ctx.createGain();
                    g.gain.setValueAtTime(0.0001, time);
                    g.gain.linearRampToValueAtTime(level, time + 0.008);
                    g.gain.exponentialRampToValueAtTime(0.0005, time + 0.06);
                    src.connect(bp); bp.connect(g); g.connect(bus);
                    src.start(time); src.stop(time + 0.08);
                    this.bandAudioNodes.push(src);
                } catch (err) {}
            }

            // Une frappe de la section : e.parts = [{ iv (hauteur écrite), slot (pupitre) }] ; e.art = articulation
            // (marc, stac, ten, swell, pad, hold). Chaque pupitre a son timbre, son entrée (les cuivres graves parlent un peu
            // après les aigus), son attaque, son accord et sa dynamique propres : pas deux joueurs exactement ensemble.
            playBrassHit(e, time, beatSec) {
                const I = this.brassInst;
                const ctx = this.app.audioCtx;
                if (!ctx || !(I.trumpet && I.french_horn && I.trombone)) return;   // (Tonnetz) cuivres pas encore chargés : on attend
                const out = brassNotes({ ...this._noteEnv(), has: (name) => !!I[name] }, e, time, beatSec);
                out.notes.forEach(n => this._playNotes(I[n.inst], [n]));
                if (out.breath !== null) this._brassBreath(time, out.breath);
            }

            // Tuba : note de basse (hauteur écrite relative à do2) ramenée dans le registre du tuba (sol1 à sol2 réels).
            playTubaAbs(abs, time, duration, vel = 0.85, art) {
                const inst = this.brassInst.tuba;
                if (!inst || !this.app.audioCtx) { this.playBassAbs(abs, time, duration, vel, true); return; }
                this._playNotes(inst, [tubaNote(this._noteEnv(), abs, time, duration, vel, art)]);
            }

            // ===================== Orchestration BRASS BAND : le calcul est dans band/brass-plan.js =====================

            buildBrassPlan(bpb, ternary, step, nextStep, isLastMeasureOfStep, halves, ph, i, L, isTurn, m) {
                const extra = { splitBeat: this.getSplitBeat(), bpm: this.bpm, bandCtx: this._bandCtx };
                return this._bandRun(['brassVoice', 'brassLines'], env => buildBrassPlan(env, bpb, ternary, step, nextStep, isLastMeasureOfStep, halves, ph, i, L, isTurn, m), extra);
            }

            // ===================== Orchestration BALKANS : le calcul est dans band/balkan-plan.js =====================

            buildBalkanPlan(bpb, ternary, step, nextStep, isLastMeasureOfStep, halves, ph, i, L, isTurn, m) {
                return this._bandRun(['balkanVoice', 'balkanMel'], env => buildBalkanPlan(env, bpb, ternary, step, nextStep, isLastMeasureOfStep, halves, ph, i, L, isTurn, m), { splitBeat: this.getSplitBeat(), bpm: this.bpm });
            }

            // Bus de l'accordéon : anches un peu nasales (bosse vers 1,8 kHz), graves nettoyés, aigus adoucis, compresseur doux, puis
            // le bus « piano » (curseur Accordéon).
            _getAccordionBus() {
                if (this._accordionBus) return this._accordionBus;
                const ctx = this.app.audioCtx;
                const f = (type, freq, gain, q) => {
                    const n = ctx.createBiquadFilter();
                    n.type = type; n.frequency.value = freq;
                    if (gain !== undefined) n.gain.value = gain;
                    if (q !== undefined) n.Q.value = q;
                    return n;
                };
                const hp = f('highpass', 130, undefined, 0.7);
                const reed = f('peaking', 1800, 2.5, 0.9);
                const body = f('lowshelf', 300, 1.5);
                const air = f('highshelf', 5000, -4);
                const lp = f('lowpass', 7500, undefined, 0.5);
                const comp = ctx.createDynamicsCompressor();
                comp.threshold.value = -24; comp.knee.value = 16; comp.ratio.value = 2.5;
                comp.attack.value = 0.008; comp.release.value = 0.2;
                const makeup = ctx.createGain();
                makeup.gain.value = 1.3;
                const chain = [hp, reed, body, air, lp, comp, makeup];
                for (let k = 0; k + 1 < chain.length; k++) chain[k].connect(chain[k + 1]);
                makeup.connect(this.bandGains.piano || ctx.destination);
                this._accordionBus = hp;
                return hp;
            }

            loadAccordion() {
                if (this.accordionInstrument || this._accordionLoading || !this.app.audioCtx || !this.bandGains.piano) return;
                this._accordionLoading = true;
                const ctx = this.app.audioCtx;
                const destination = this._getAccordionBus();
                const done = (instr) => { this.accordionInstrument = instr; };
                Soundfont.instrument(ctx, 'accordion', { soundfont: 'MusyngKite', destination })
                    .then(done)
                    .catch(() => Soundfont.instrument(ctx, 'accordion', { soundfont: 'FluidR3_GM', destination })
                        .then(done)
                        .catch(() => { setTimeout(() => { this._accordionLoading = false; }, 5000); }));
            }

            // Une frappe de l'accordéon : e.intervals = hauteurs écrites ; e.art = 'pah' (accord court), 'run' (note de phrase rapide).
            // Chaque note est jouée par deux jeux d'anches légèrement désaccordés (effet « musette »), avec un très léger décalage.
            playAccordionHit(e, time, beatSec) {
                const inst = this.accordionInstrument;
                if (!inst || !this.app.audioCtx) { this.playPianoHit(e, time, beatSec); return; }
                this._playNotes(inst, accordionNotes(this._noteEnv(), e, time, beatSec));
            }

            // =====================================================================================================================
            // Orchestre « Tango nuevo » (style Piazzolla) : bandonéon, violon, piano, guitare électrique et contrebasse, avec les
            // « bruits » du quinteto (golpe sur la caisse, chicharra du violon, látigo). La conduite des voix suit l'écriture de
            // Piazzolla :
            //  - contrepoint et fugue : un sujet exposé tour à tour par le bandonéon, le violon et la guitare (réponse à la quinte),
            //    pendant que les voix déjà entrées continuent par un contre-sujet conjoint ;
            //  - lignes chromatiques descendantes, à la basse et dans une voix intérieure, qui relient les accords (la ligne
            //    s'arrête un demi-ton au-dessus de la note de l'accord suivant, qu'elle atteint au temps fort) ;
            //  - contre-chant : le violon (ou le bandonéon) chante, une autre voix lui répond dans un registre très contrasté ;
            //  - mouvements conjoints partout, posés sur la cellule 3+3+2 (groupes de croches : 3+3+2 en 4/4, 3+1 en 2/4, 3+3 en 3/4
            //    et en 6/8, 3+3+3 en 9/8…).
            // Chaque phrase choisit une texture : « marcato » (cellule 3+3+2 percussive), « cantabile » (chant + contre-chant),
            // « fugue » (entrées en imitation) ou « chromatic » (descentes chromatiques).

            // ===================== Orchestration PIAZZOLLA : le calcul est dans band/piazzolla-plan.js =====================

            buildPiazzollaPlan(bpb, ternary, step, nextStep, isLastMeasureOfStep, halves, ph, i, L, isTurn, m) {
                const extra = { splitBeat: this.getSplitBeat() };
                return this._bandRun(['pzState'], env => buildPiazzollaPlan(env, bpb, ternary, step, nextStep, isLastMeasureOfStep, halves, ph, i, L, isTurn, m), extra);
            }

            // Bus de chaque instrument du quinteto : égalisation propre, puis le curseur de volume de l'instrument, puis la réverbération.
            _getPzBuses() {
                if (this._pzBuses) return this._pzBuses;
                const ctx = this.app.audioCtx;
                const dest = this.bandReverbInput || ctx.destination;
                const f = (type, freq, gain, q) => {
                    const n = ctx.createBiquadFilter();
                    n.type = type; n.frequency.value = freq;
                    if (gain !== undefined) n.gain.value = gain;
                    if (q !== undefined) n.Q.value = q;
                    return n;
                };
                const build = (key, filters, comp) => {
                    const vol = ctx.createGain();
                    vol.gain.value = this.bandVolumes[key];
                    vol.connect(dest);
                    this.bandGains[key] = vol;
                    const c = ctx.createDynamicsCompressor();
                    c.threshold.value = comp[0]; c.knee.value = 16; c.ratio.value = comp[1];
                    c.attack.value = 0.008; c.release.value = 0.2;
                    const makeup = ctx.createGain();
                    makeup.gain.value = comp[2];
                    const chain = filters.concat([c, makeup]);
                    for (let k = 0; k + 1 < chain.length; k++) chain[k].connect(chain[k + 1]);
                    makeup.connect(vol);
                    return chain[0];
                };
                this._pzBuses = {
                    // bandonéon : anches nasales (bosse vers 1,4 kHz), graves nettoyés, aigus adoucis
                    bandoneon: build('bandoneon', [f('highpass', 110, undefined, 0.7), f('peaking', 1400, 3, 0.9), f('lowshelf', 280, 1.5), f('highshelf', 5000, -5), f('lowpass', 7000, undefined, 0.5)], [-24, 2.5, 1.3]),
                    // violon : un peu de présence (3 kHz), aigus adoucis (moins de « scie »)
                    violin: build('violin', [f('highpass', 190, undefined, 0.7), f('peaking', 3000, 1.5, 0.9), f('highshelf', 6500, -4), f('lowpass', 9000, undefined, 0.5)], [-26, 2, 1.25]),
                    // guitare électrique (son clair de jazz) : corps vers 200 Hz, médium présent, aigus tamisés
                    guitar: build('guitar', [f('highpass', 85, undefined, 0.7), f('peaking', 220, 2, 1), f('peaking', 2200, 2.5, 0.9), f('highshelf', 4500, -6), f('lowpass', 6500, undefined, 0.5)], [-24, 2.5, 1.3])
                };
                return this._pzBuses;
            }

            // Charge bandonéon (accordéon « tango »), violon, guitare électrique claire et contrebasse à l'archet. Banque « MusyngKite »,
            // repli sur « FluidR3_GM » ; tant qu'un instrument n'est pas chargé, le piano joue sa partie.
            loadPiazzolla() {
                if (!this.app.audioCtx || !this.bandGains.piano) return;
                const ctx = this.app.audioCtx;
                const buses = this._getPzBuses();
                const banks = ['MusyngKite', 'FluidR3_GM'];
                const load = (key, name, dest) => {
                    if (this.pzInst[key] || this._pzLoading[key] || (this._pzFail[key] || 0) >= 3) return;
                    this._pzLoading[key] = true;
                    const attempt = (k) => Soundfont.instrument(ctx, name, { soundfont: banks[k], destination: dest })
                        .then(instr => { this.pzInst[key] = instr; this._pzLoading[key] = false; })
                        .catch(() => {
                            if (k + 1 < banks.length) return attempt(k + 1);
                            this._pzFail[key] = (this._pzFail[key] || 0) + 1;
                            this._pzLoading[key] = false;
                        });
                    attempt(0);
                };
                load('bandoneon', 'tango_accordion', buses.bandoneon);
                load('violin', 'violin', buses.violin);
                load('guitar', 'electric_guitar_clean', buses.guitar);
                load('arco', 'contrabass', this.bandGains.bass || ctx.destination);
            }

            // Une frappe d'un instrument du quinteto. e.inst : 'piano' | 'bandoneon' | 'violin' | 'guitar' ; e.intervals = hauteurs écrites ;
            // e.art : 'stab' (accord court), 'line' (note de ligne), 'sus' (note tenue), 'grace' (petite note d'appui).
            playPiazzollaHit(e, time, beatSec) {
                const ctx = this.app.audioCtx;
                if (!ctx) return;
                const who = e.inst || 'piano';
                if (who === 'piano') { this.playPianoHit(e, time, beatSec); return; }
                const inst = this.pzInst && this.pzInst[who];
                if (!inst) { this.playPianoHit(Object.assign({}, e, { gainMul: 0.85 }), time, beatSec); return; }
                this._playNotes(inst, piazzollaNotes(this._noteEnv(), e, time, beatSec, who));
            }

            // Contrebasse : pizzicato (basse acoustique de l'orchestre) ou archet (contrebasse arco), selon e.art.
            playPiazzollaBass(e, time, beatSec) {
                const dur = Math.max(0.1, e.dur * beatSec);
                const vel = e.vel * (0.94 + Math.random() * 0.12);
                const arco = e.art === 'arco' && this.pzInst && this.pzInst.arco;
                if (!arco) { this.playBassAbs(e.abs, time, dur, vel, true); return; }
                this._playNotes(arco, [arcoNote(this._noteEnv(), e.abs, time, dur, vel)]);
            }

            playBandBeat(step, beatInMeasure) {
                if (!this.app.audioCtx) return;
                this.ensureBandAudio();
                // Les frappes sont plus nombreuses qu'avant : on purge régulièrement les nœuds déjà terminés.
                if (this.bandAudioNodes.length > 600) this.bandAudioNodes.splice(0, this.bandAudioNodes.length - 300);
                const now = this._audioNow();
                const beatSec = 60 / this.bpm;

                if (beatInMeasure === 0) {
                    this._bandMeasureCounter = (this._bandMeasureCounter + 1) % 1000000;
                    const nxIdx = this._peekNextIndex(this.currentStepIndex);
                    const nextStep = nxIdx >= 0 ? this.grid[nxIdx] : null;
                    const measureInStep = Math.floor(this.currentBeat / this.getBeatsPerBar());
                    // Brass band : les notes tenues voient plus loin que le prochain accord (jusqu'à deux blocs de la grille)
                    const nx2Idx = nxIdx >= 0 ? this._peekNextIndex(nxIdx) : -1;
                    this._bandCtx = { measureInStep, next2: nx2Idx >= 0 ? this.grid[nx2Idx] : null };
                    this._bandPlan = this.buildBandPlan(step, nextStep, measureInStep, measureInStep === step.measures - 1);
                }
                const plan = this._bandPlan;
                if (!plan) return;

                const inBeat = (e) => e.pos >= beatInMeasure - 1e-6 && e.pos < beatInMeasure + 1 - 1e-6;
                // Léger jitter d'humanisation (±6 ms), jamais dans le passé
                const at = (e) => Math.max(now, now + (e.pos - beatInMeasure) * beatSec + (e.lay || 0) + (Math.random() - 0.5) * 0.012);
                plan.drums.filter(inBeat).forEach(e => this.playBandDrum(e, at(e)));
                plan.bass.filter(inBeat).forEach(e => plan.piazzolla ? this.playPiazzollaBass(e, at(e), beatSec) : plan.brass ? this.playTubaAbs(e.abs, at(e), Math.max(0.1, e.dur * beatSec), e.vel * (0.94 + Math.random() * 0.12), e.art) : this.playBassAbs(e.abs, at(e), Math.max(0.1, e.dur * beatSec), e.vel * (0.94 + Math.random() * 0.12), !!e.wide));
                plan.piano.filter(inBeat).forEach(e => plan.piazzolla ? this.playPiazzollaHit(e, at(e), beatSec) : plan.brass ? this.playBrassHit(e, at(e), beatSec) : (plan.accordion ? this.playAccordionHit(e, at(e), beatSec) : (plan.guitar ? this.playGuitarHit(e, at(e), beatSec) : this.playPianoHit(e, at(e), beatSec))));
            }


            findChordObj(chordId) {
                return lookupChord(chordId) || chordTypes.maj[0];
            }

    // ===== Recopié de JamEngine : performance adaptative, bus master, horloge =====
            // --- Performance adaptative ---
            _initialPerfTier() {
                if (this.perfMode === 'full') return 0;
                if (this.perfMode === 'light') return 1;
                if (this.perfMode === 'minimal') return 2;
                const cores = navigator.hardwareConcurrency || 4;
                const mem = navigator.deviceMemory;   // Chrome seulement
                return (cores <= 2 || (mem && mem <= 2)) ? 1 : 0;
            }

            // Applique le niveau courant aux parties permanentes du graphe audio ; les synthés de batterie et le
            // piano lisent this.perfTier à chaque frappe.
            _applyPerfTier() {
                const t = this.perfTier;
                this._LEAD = t >= 2 ? 0.45 : t >= 1 ? 0.25 : 0.12;   // plus de marge pour les machines dont les timers / l'affichage saccadent
                this._FIRST_LEAD = t >= 2 ? 0.7 : t >= 1 ? 0.5 : 0.35;
                if (this.masterShaper) this.masterShaper.oversample = t >= 1 ? 'none' : '2x';
                this._syncBandConvolver();
                this._updatePerfUI();
            }

            // La convolution (coûteuse) ne tourne que si on l'entend : qualité complète ET réverbération de l'orchestre > 0.
            _syncBandConvolver() {
                if (!this.bandReverbInput || !this._bandConvolver) return;
                const want = this.perfTier === 0 && this.bandReverb > 0;
                if (want === this._bandConvolverOn) return;
                try { this.bandReverbInput.disconnect(this._bandConvolver); } catch (e) {}
                if (want) { try { this.bandReverbInput.connect(this._bandConvolver); } catch (e) {} }
                this._bandConvolverOn = want;
            }

            // Appelée à chaque temps de l'orchestre : repère les signes de surcharge (tick tardif, horloge audio qui
            // décroche, programmation trop longue) et descend d'un niveau si ça se répète.
            _perfObserve(ctx, t, costMs) {
                if (this.perfMode !== 'auto' || this.perfTier >= 2) return;
                const w = performance.now(), a = ctx.currentTime;
                const prev = this._perfPrev;
                this._perfPrev = { w, a };
                if (this._perfCooldown > 0) { this._perfCooldown--; return; }
                if (!prev || ctx.state !== 'running') return;
                const dW = (w - prev.w) / 1000, dA = a - prev.a;
                if (dW <= 0 || dW > 2) return;                 // pause, onglet figé : sans signification
                const late = (t - a) < this._LEAD * 0.3;       // le tick est parti trop tard
                const stall = (dW - dA) > 0.06;                // l'horloge audio prend du retard sur l'horloge réelle : le processeur audio décroche
                const heavy = costMs > 25;                     // la programmation d'un seul temps a mobilisé le processeur trop longtemps
                this._perfLog.push((late || stall || heavy) ? 1 : 0);
                if (this._perfLog.length > 10) this._perfLog.shift();
                if (this._perfLog.reduce((x, y) => x + y, 0) >= 3) {
                    this.perfTier++;
                    this._perfLog = [];
                    this._perfCooldown = 8;
                    this._applyPerfTier();
                }
            }

            // Volume général de l'orchestre (piano, basse, batterie, réverbération) : gain, puis limiteur doux, puis sortie.
            // Le métronome a sa propre voie et son propre curseur : il ne passe pas ici.
            _getMasterBus(ctx) {
                if (this.masterBus) return this.masterBus;
                const g = ctx.createGain();
                g.gain.value = masterGainFor(this.bandMaster);
                const span = 8;                               // la courbe couvre ±8 en amplitude (marge pour le gain max ×4)
                const pre = ctx.createGain();
                pre.gain.value = 1 / span;
                const shaper = ctx.createWaveShaper();
                const n = 4096, curve = new Float32Array(2 * n + 1);
                const t = MASTER_KNEE;
                for (let i = 0; i <= 2 * n; i++) {
                    const x = span * (i / n - 1), ax = Math.abs(x);
                    const y = ax <= t ? ax : t + (1 - t) * Math.tanh((ax - t) / (1 - t));
                    curve[i] = x < 0 ? -y : y;
                }
                shaper.curve = curve;
                shaper.oversample = '2x';                     // suréchantillonnage x2 : évite le repliement (grésillements) quand le limiteur écrête
                g.connect(pre);
                pre.connect(shaper);
                shaper.connect(ctx.destination);
                this.masterShaper = shaper;
                this.masterBus = g;
                return g;
            }

            // --- Horloge du métronome / de la jam -------------------------------------------------
            // Les timers du thread principal sont bridés (onglet en arrière-plan) et retardés par les rendus
            // lourds ; on délègue donc l'attente à un Web Worker, et on vise des instants ABSOLUS
            // (grille de temps sans dérive) au lieu d'enchaîner des setTimeout relatifs.
            _getClockWorker() {
                if (this._clockWorker !== undefined) return this._clockWorker;
                this._clockCbs = new Map();
                this._clockSeq = 0;
                try {
                    const src = "const m=new Map();onmessage=e=>{const d=e.data;if(d.t==='set'){m.set(d.id,setTimeout(()=>{m.delete(d.id);postMessage(d.id);},d.ms));}else if(d.t==='clear'){clearTimeout(m.get(d.id));m.delete(d.id);}};";
                    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
                    w.onmessage = (e) => {
                        const cb = this._clockCbs.get(e.data);
                        this._clockCbs.delete(e.data);
                        if (cb) cb();
                    };
                    this._clockWorker = w;
                } catch (err) {
                    this._clockWorker = null; // repli : setTimeout classique
                }
                return this._clockWorker;
            }

            _clockSet(ms, cb) {
                const w = this._getClockWorker();
                if (!w) return setTimeout(cb, ms);
                const id = ++this._clockSeq;
                this._clockCbs.set(id, cb);
                w.postMessage({ t: 'set', id, ms });
                return id;
            }

            _clockClear(id) {
                if (id === null || id === undefined) return;
                const w = this._clockWorker;
                if (!w) { clearTimeout(id); return; }
                this._clockCbs.delete(id);
                w.postMessage({ t: 'clear', id });
            }

            // Exécute fn à l'instant audio t (affichage synchronisé avec le son), sauf si la lecture a changé entre-temps.
            _runAtAudioTime(t, runId, fn) {
                const ctx = this.app.audioCtx;
                const delayMs = (t - ctx.currentTime) * 1000;
                const guarded = () => { if (this.isPlaying && runId === this._runId) fn(); };
                if (delayMs <= 4) guarded();
                else this._clockSet(delayMs, guarded);
            }

    // ===== Colle propre au Tonnetz =====

    _updatePerfUI() {}   // pas de menu de performance dans le Tonnetz

    getBeatsPerBar() { return [2, 3, 4].includes(this.beatsPerBar) ? this.beatsPerBar : 4; }
    isTernary() { return !!this.ternary; }
    getMeterKey() {
        const b = this.getBeatsPerBar();
        return this.isTernary() ? ({ 2: '6/8', 3: '9/8', 4: '12/8' })[b] : (b + '/4');
    }
    getSplitBeat() { return this.getBeatsPerBar() === 2 ? 1 : 2; }

    // Rythme imposé applicable à l'orchestre actuel (Milonga lyrique = quinteto piazzolla + écriture lyrique).
    getEffectiveGroove(style) {
        const ok = { latin: ['samba', 'tango', 'piazzolla'], cuba: ['afro'], brass: ['b-chorale'], piazzolla: ['lyrique'] }[style || this.bandStyle];
        return (this._bandGroove && ok && ok.includes(this._bandGroove)) ? this._bandGroove : null;
    }

    makeVariationRng(variant, styleKey) { return makeVariationRng(variant, styleKey, this._seedBase); }
    isSplitEffective(step) { return isSplitEffective(step); }
    getStepHalves(step) { return getStepHalves(step); }

    // Bloc suivant de la progression (-1 s'il n'y en a pas : fin sans boucle).
    _peekNextIndex(i) {
        const n = this.grid.length;
        if (!n) return -1;
        if (i + 1 < n) return i + 1;
        return this.loopEnabled ? 0 : -1;
    }

    _audioNow() {
        return this._beatAudioTime != null ? this._beatAudioTime : this.app.audioCtx.currentTime;
    }

    // Choix du style d'orchestre : 'swing' | 'pop' | 'latin' | 'cuba' | 'classic' | 'brass' | 'balkan' | 'piazzolla' | 'milongalyrique'
    chooseBandStyle(v) {
        if (v === 'milongalyrique') {
            this._bandGroove = 'lyrique';
            this.setBandStyle('piazzolla');
        } else {
            if (this._bandGroove === 'lyrique') this._bandGroove = null;
            this.setBandStyle(v);
        }
    }

    setBandStyle(style) {
        this._arpPrevStyle = null;
        const prev = this.bandStyle;
        this.bandStyle = ['swing', 'pop', 'latin', 'cuba', 'classic', 'brass', 'balkan', 'piazzolla'].includes(style) ? style : 'swing';
        if (prev !== this.bandStyle) Object.assign(this, bandVoiceState());   // chaque orchestre repart d'un état propre
        if (this.app.audioCtx) this.ensureBandAudio();                        // lance le chargement des instruments du style
    }

    setBandVolume(instrument, val) {
        const v = parseInt(val, 10) / 100;
        this.bandVolumes[instrument] = v;
        if (this.bandGains[instrument]) this.bandGains[instrument].gain.value = v;
    }

    setBandMaster(val) {
        this.bandMaster = Math.max(0, Math.min(1, parseInt(val, 10) / 100));
        if (this.masterBus) this.masterBus.gain.value = masterGainFor(this.bandMaster);
    }

    setBandReverb(val) {
        this.bandReverb = Math.max(0, Math.min(1, parseInt(val, 10) / 100));
        if (this.bandReverbWet) this.bandReverbWet.gain.value = this.bandReverb * 2;
        this._syncBandConvolver();
    }

    // --- Lecture de la progression ---

    start(fromIndex = 0) {
        if (!this.grid.length || !this.app.audioCtx) return false;
        const ctx = this.app.audioCtx;
        if (ctx.state !== 'running') ctx.resume().catch(() => {});
        this.ensureBandAudio();
        this._seedBase = Math.floor(Math.random() * 1000000);
        Object.assign(this, bandVoiceState(), bandRunState(newBandSeed()));
        this._bandCtx = null;
        this.isPlaying = true;
        this._runId++;
        this.currentStepIndex = Math.max(0, Math.min(fromIndex, this.grid.length - 1));
        this.currentBeat = 0;
        this._beatAudio = null;
        this._beatAudioTime = null;
        this.tick(this._runId);
        return true;
    }

    stop() {
        const was = this.isPlaying;
        this.isPlaying = false;
        this._runId++;
        this._clockClear(this.timer);
        this.timer = null;
        this._beatAudio = null;
        this._beatAudioTime = null;
        this._perfPrev = null; this._perfLog = [];
        this.bandAudioNodes.forEach(node => {
            try { if (node && typeof node.stop === 'function') node.stop(); } catch (e) {}
        });
        this.bandAudioNodes = [];
        if (was && this.onStop) this.onStop();
    }

    _scheduleNextTick(runId) {
        const ctx = this.app.audioCtx;
        const delayMs = nextTickDelayMs({ beatAudio: this._beatAudio, now: ctx.currentTime, lead: this._LEAD, intervalSec: 60 / this.bpm });
        this.timer = this._clockSet(delayMs, () => this.tick(runId));
    }

    tick(runId = this._runId) {
        if (!this.isPlaying || runId !== this._runId) return;
        const ctx = this.app.audioCtx;
        if (!ctx) { this.stop(); return; }
        if (ctx.state !== 'running') ctx.resume().catch(() => {});

        const intervalSec = 60 / this.bpm;
        const bpb = this.getBeatsPerBar();
        const clock = beatClock({ beatAudio: this._beatAudio, now: ctx.currentTime, intervalSec, firstLead: this._FIRST_LEAD, lead: this._LEAD });
        const t = clock.t;
        this._beatAudio = clock.next;

        const stepIdx = this.currentStepIndex;
        const step = this.grid[stepIdx];
        if (!step) { this.stop(); return; }
        const beat = this.currentBeat;
        const total = step.measures * bpb;

        // Son programmé à l'instant exact du temps ; une erreur ne doit jamais interrompre la chaîne de temps.
        this._beatAudioTime = t;
        const perfT0 = performance.now();
        try {
            this.playBandBeat(step, beat % bpb);
        } catch (e) {
            console.error('Tonnetz audio', e);
        } finally {
            this._beatAudioTime = null;
            try { this._perfObserve(ctx, t, performance.now() - perfT0); } catch (e) {}
        }

        // Affichage : à l'instant du temps
        this._runAtAudioTime(t, runId, () => {
            if (this.onBeat) this.onBeat({ stepIdx, beat, bpb, measure: Math.floor(beat / bpb), total });
        });

        // Avance d'un temps
        let nb = beat + 1, ns = stepIdx;
        if (nb >= total) {
            nb = 0; ns = stepIdx + 1;
            if (ns >= this.grid.length) {
                if (this.loopEnabled) ns = 0;
                else {
                    // fin sans boucle : le dernier temps sonne jusqu'au bout, puis on s'arrête
                    this._runAtAudioTime(t + intervalSec, runId, () => this.stop());
                    return;
                }
            }
        }
        this.currentStepIndex = ns;
        this.currentBeat = nb;
        this._scheduleNextTick(runId);
    }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { TonnetzBand };
