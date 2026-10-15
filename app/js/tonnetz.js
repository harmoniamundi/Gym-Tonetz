// tonnetz.js — page Tonnetz : réseau de notes infini (déplacement au glisser, zoom de ×0,45 à ×4), accords touchables, transformations
// néo-riemanniennes P / L / R, analyse harmonique en chiffrage romain pour n'importe quelle tonique, constructeur de progressions
// (enregistrement, export / import), accords personnalisés, sept schémas de couleurs, mode plein écran (réseau + progression seulement),
// et lecture par les orchestres de la Jam (tonnetz-band.js).
//
// Chargé par index.html, après les modules de théorie (app/js/theory.js), d'orchestre (app/js/band/, app/js/tonnetz-band.js) et de sons (app/sounds/).
// Aucune bibliothèque externe en dehors de app/vendor/soundfont-player.min.js.

(() => {
    'use strict';

    // ------------------------------------------------------------------------------------------------------------------
    // Dépendances : la théorie et l'orchestre viennent des modules de app/js/
    // ------------------------------------------------------------------------------------------------------------------
    const hasTheory = typeof lookupChord === 'function' && typeof chordInfo === 'function' && typeof cbSuffix === 'function'
        && typeof cbStateOfId === 'function' && typeof cbNormalize === 'function' && typeof cbId === 'function'
        && typeof stackIntervalsUp === 'function' && typeof AUDIO_ROOT_NAMES !== 'undefined';
    const hasBand = hasTheory && typeof TonnetzBand === 'function' && typeof buildStandardPlan === 'function'
        && typeof bandRunState === 'function' && typeof beatClock === 'function' && typeof Soundfont !== 'undefined';

    const SVGNS = 'http://www.w3.org/2000/svg';
    const mod = (n, m = 12) => ((n % m) + m) % m;
    const $ = (id) => document.getElementById(id);
    const store = {
        get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
        set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
    };
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    if (!hasTheory) {
        const b = $('banner');
        b.hidden = false;
        b.innerHTML = '<b>Des fichiers de l\'application sont introuvables.</b><br>Gym Tonnetz a besoin de son dossier <code>app/</code> complet (théorie, orchestres, sons) : '
            + 'gardez <code>index.html</code> à côté du dossier <code>app/</code>.';
        $('app').hidden = true;
        return;
    }

    // ------------------------------------------------------------------------------------------------------------------
    // Réglages (gardés dans le navigateur) et état
    // ------------------------------------------------------------------------------------------------------------------
    const DEFAULTS = {
        fr: true, spell: 'auto', labels: true, sound: true, analysis: false,
        tonic: 0, mode: 'maj',
        style: 'swing', bpm: 100, meter: '4/4', loop: true, entry: false,
        master: 50, reverb: 25, vols: { piano: 50, bass: 85, drums: 25 }
    };
    const S = Object.assign({}, DEFAULTS, store.get('tonnetz.settings', {}));
    S.vols = Object.assign({}, DEFAULTS.vols, S.vols || {});
    const saveSettings = () => store.set('tonnetz.settings', S);
    // Le chiffrage romain est masqué par défaut : une seule fois, on le masque aussi chez ceux qui l'avaient gardé affiché
    if (!(((store.get('tonnetz.settings', {}) || {}).anV) >= 2)) { S.analysis = false; S.anV = 2; saveSettings(); }

    const R = {
        sel: null,        // clé du triangle sélectionné
        note: null,       // hauteur (0-11) d'une note sélectionnée
        custom: null,     // { root, id } : accord personnalisé sélectionné
        prog: [],         // la progression : { r, id, m, tri? }
        inst: [],         // pour chaque accord de la progression, le triangle du réseau qui le représente (ou null)
        progSel: null,    // index de l'accord de la progression sélectionné
        playing: -1       // index de l'accord en cours de lecture
    };

    // ------------------------------------------------------------------------------------------------------------------
    // Noms de notes et d'accords
    // ------------------------------------------------------------------------------------------------------------------
    const NAMES = {
        fr: { s: ['Do', 'Do♯', 'Ré', 'Ré♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'],
              f: ['Do', 'Ré♭', 'Ré', 'Mi♭', 'Mi', 'Fa', 'Sol♭', 'Sol', 'La♭', 'La', 'Si♭', 'Si'] },
        en: { s: ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'],
              f: ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'] }
    };
    // Dièses ou bémols : « auto » suit la tonique choisie (la tonalité majeure de même armure pour le mode mineur)
    function useFlats() {
        if (S.spell === 'f') return true;
        if (S.spell === 's') return false;
        const major = S.mode === 'maj' ? S.tonic : mod(S.tonic + 3);
        return [1, 3, 5, 8, 10].includes(major);
    }
    const nm = (pc) => NAMES[S.fr ? 'fr' : 'en'][useFlats() ? 'f' : 's'][mod(pc)];

    const TRI_MAJ = 'majTriad', TRI_MIN = 'minTriad';
    const chordPcs = (root, id) => lookupChord(id).notes.map((n) => mod(root + n));
    const chordSuffix = (id) => { const st = cbStateOfId(id); return st ? cbSuffix(st) : ''; };
    function chordName(root, id) {
        const suf = chordSuffix(id);
        return nm(root) + ((S.fr && /^[a-z]/i.test(suf)) ? ' ' : '') + suf;
    }
    const isMinorish = (id) => { const i = chordInfo(id); return !!(i && i.st.third === 'm'); };

    // ------------------------------------------------------------------------------------------------------------------
    // Géométrie du réseau : un réseau triangulaire infini, calculé à la demande (seule la partie visible est dessinée)
    // ------------------------------------------------------------------------------------------------------------------
    // Le nœud (i, j) est à x = (i + j/2)·DX, y = −j·DY ; sa hauteur est 7i + 4j (quinte à l'horizontale, tierce majeure en diagonale).
    // Le triangle « u » (i, j) a pour sommets (i, j), (i+1, j), (i, j+1) : pointe en haut, accord majeur de fondamentale (i, j).
    // Le triangle « d » (i, j) a pour sommets (i+1, j), (i, j+1), (i+1, j+1) : pointe en bas, accord mineur de fondamentale (i, j+1).
    const DX = 132, DY = DX * Math.sqrt(3) / 2;
    const pcAt = (i, j) => mod(7 * i + 4 * j);

    const nodeCache = new Map();
    function N(i, j) {
        const k = i + ',' + j;
        let n = nodeCache.get(k);
        if (!n) { n = { i, j, pc: pcAt(i, j), x: (i + j / 2) * DX, y: -j * DY }; nodeCache.set(k, n); }
        return n;
    }

    const tris = new Map();           // triangles déjà calculés, par clé (« u3,-2 »)
    function T(kind, i, j) {
        const key = kind + i + ',' + j;
        let t = tris.get(key);
        if (t) return t;
        const v = kind === 'u' ? [N(i, j), N(i + 1, j), N(i, j + 1)] : [N(i + 1, j), N(i, j + 1), N(i + 1, j + 1)];
        t = { key, kind, i, j, v, root: kind === 'u' ? v[0].pc : v[1].pc, minor: kind === 'd',
              cx: (v[0].x + v[1].x + v[2].x) / 3, cy: (v[0].y + v[1].y + v[2].y) / 3, pcs: v.map((n) => n.pc) };
        tris.set(key, t);
        return t;
    }
    function triByKey(key) {
        if (typeof key !== 'string') return null;
        const m = /^([ud])(-?\d+),(-?\d+)$/.exec(key);
        return m ? T(m[1], parseInt(m[2], 10), parseInt(m[3], 10)) : null;
    }
    const triId = (t) => (t.minor ? TRI_MIN : TRI_MAJ);

    // Transformations néo-riemanniennes : les trois triangles qui partagent une arête avec t (le réseau n'a pas de bord)
    function neighbors(t) {
        const { i, j } = t;
        return t.kind === 'u'
            ? { P: 'd' + i + ',' + (j - 1), R: 'd' + (i - 1) + ',' + j, L: 'd' + i + ',' + j }
            : { L: 'u' + i + ',' + j, P: 'u' + i + ',' + (j + 1), R: 'u' + (i + 1) + ',' + j };
    }
    // Résultat d'une transformation, par les hauteurs
    function riemann(t, op) {
        if (op === 'P') return { root: t.root, minor: !t.minor };
        if (op === 'L') return t.minor ? { root: mod(t.root - 4), minor: false } : { root: mod(t.root + 4), minor: true };
        return t.minor ? { root: mod(t.root + 3), minor: false } : { root: mod(t.root + 9), minor: true };   // R
    }
    // Le point du plan qui sert de repère quand rien d'autre n'est connu (autour de Do)
    const ORIGIN = { cx: DX / 2, cy: -DY / 3 };
    // Une même fondamentale revient tous les 12 pas de quinte, sur chaque rang : on cherche la copie la plus proche d'un point du plan
    // (par défaut, le centre de ce qu'on voit à l'écran).
    function nearestInstance(root, minor, from) {
        const f = from || viewCenter();
        const jc = Math.round(-f.cy / DY);
        let best = null, bd = Infinity;
        for (let j = jc - 4; j <= jc + 4; j++) {
            const i0 = mod(7 * (root - 4 * (minor ? j + 1 : j)), 12);    // 7 est son propre inverse modulo 12
            const n0 = Math.round((f.cx / DX - j / 2 - (minor ? 1 : 0.5) - i0) / 12);
            for (let n = n0 - 1; n <= n0 + 1; n++) {
                const t = T(minor ? 'd' : 'u', i0 + 12 * n, j);
                const d = (t.cx - f.cx) ** 2 + (t.cy - f.cy) ** 2;
                if (d < bd) { bd = d; best = t; }
            }
        }
        return best;
    }

    // ------------------------------------------------------------------------------------------------------------------
    // Analyse harmonique : chiffrage romain et fonction, pour n'importe quelle tonique
    // ------------------------------------------------------------------------------------------------------------------
    const DEG = ['I', '♭II', 'II', '♭III', 'III', 'IV', '♯IV', 'V', '♭VI', 'VI', '♭VII', 'VII'];
    // Accords de la tonalité (nature de la triade sur chaque degré)
    const DIA = {
        maj: { 0: 'M', 2: 'm', 4: 'm', 5: 'M', 7: 'M', 9: 'm', 11: 'dim' },
        min: { 0: 'm', 2: 'dim', 3: 'M', 5: 'm', 7: 'm', 8: 'M', 10: 'M' }
    };
    function triKind(st) {
        if (st.third === 'm') return st.fifth === 'b5' ? 'dim' : 'm';
        if (st.third === 'M') return st.fifth === 's5' ? 'aug' : 'M';
        return 'sus';
    }
    // Ce qui suit le chiffre : 7, Δ7, °, ø, +, sus4…
    function figure(st) {
        const s = cbSuffix(st);
        if (st.third === 'm' && st.fifth === 'b5') {
            if (s.startsWith('dim')) return '°' + s.slice(3);
            if (s.startsWith('°')) return '°7' + s.slice(1);
            return s;
        }
        if (st.third === 'm') return s.replace(/^(−|m)/, '');
        if (s.startsWith('aug')) return '+' + s.slice(3);
        return s;
    }
    const lowerRoman = (s) => s.replace(/[IVX]+/, (m) => m.toLowerCase());
    function romanOf(root, id) {
        const info = chordInfo(id);
        if (!info) return '';
        const d = mod(root - S.tonic);
        const kind = triKind(info.st);
        let base = DEG[d];
        if (d === 6 && info.fam === 'dom') base = '♭V';
        return ((kind === 'm' || kind === 'dim') ? lowerRoman(base) : base) + figure(info.st);
    }
    function isInKey(root, id) {
        const info = chordInfo(id);
        if (!info) return false;
        const d = mod(root - S.tonic);
        const want = DIA[S.mode][d];
        if (!want) return false;
        const got = triKind(info.st);
        return got === want || (S.mode === 'min' && d === 7 && got === 'M');
    }
    // ------------------------------------------------------------------------------------------------------------------
    // Audio : écoute des notes et accords touchés ; l'orchestre (tonnetz-band.js) partage le même contexte audio
    // ------------------------------------------------------------------------------------------------------------------
    const App = { audioCtx: null, pianoInstrument: null, _pianoPromise: null, activeAudioNodes: [], reverbInput: null };

    function ensureCtx() {
        if (typeof unlockIOSAudio === 'function') unlockIOSAudio();   // iPhone : son audible même en mode silencieux
        if (!App.audioCtx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return false;
            App.audioCtx = new AC({ latencyHint: 'playback' });
        }
        if (App.audioCtx.state === 'suspended') App.audioCtx.resume().catch(() => {});
        if (typeof Soundfont !== 'undefined' && !App.pianoInstrument && !App._pianoPromise) {
            App._pianoPromise = Soundfont.instrument(App.audioCtx, 'acoustic_grand_piano', { soundfont: 'FluidR3_GM' })
                .then((instr) => { App.pianoInstrument = instr; return instr; })
                .catch(() => { App._pianoPromise = null; return null; });
        }
        return true;
    }

    let tapNodes = [];
    function stopTap() {
        tapNodes.forEach((n) => { try { if (n && typeof n.stop === 'function') n.stop(); } catch (e) {} });
        tapNodes = [];
    }
    const OCT = (typeof PLAY_BASE_OCTAVE !== 'undefined') ? PLAY_BASE_OCTAVE : 3;     // octave de lecture de l'appli : 3
    const noteName = (abs) => AUDIO_ROOT_NAMES[mod(abs)] + (OCT + Math.floor(abs / 12));
    function beep(abs, when, dur) {
        const ctx = App.audioCtx;
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'triangle';
        o.frequency.value = 440 * Math.pow(2, ((12 * (OCT + 1) + abs) - 69) / 12);
        g.gain.setValueAtTime(0, when);
        g.gain.linearRampToValueAtTime(0.18, when + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
        o.connect(g).connect(ctx.destination);
        o.start(when); o.stop(when + dur + 0.05);
        tapNodes.push(o);
    }
    function playAbs(list, opts) {
        if (!S.sound || !ensureCtx()) return;
        const o = Object.assign({ dur: 1.8, roll: 0.014, gain: 0.9 }, opts || {});
        stopTap();
        const now = App.audioCtx.currentTime + 0.02;
        list.forEach((abs, i) => {
            const when = now + i * o.roll;
            if (App.pianoInstrument) {
                try { tapNodes.push(App.pianoInstrument.play(noteName(abs), when, { duration: o.dur, gain: o.gain })); } catch (e) {}
            } else beep(abs, when, o.dur * 0.7);
        });
    }
    function playChord(root, id) {
        playAbs(stackIntervalsUp(lookupChord(id).notes).map((iv) => mod(root) + iv));
    }
    const playNote = (pc) => playAbs([pc], { dur: 1.6 });

    // ------------------------------------------------------------------------------------------------------------------
    // Dessin du réseau : seule la partie visible (plus une marge) existe dans le SVG ; elle se renouvelle quand on déplace la vue
    // ------------------------------------------------------------------------------------------------------------------
    const svg = $('board');
    const boardBox = $('boardwrap');
    const el = (name, attrs, parent) => {
        const e = document.createElementNS(SVGNS, name);
        for (const k in (attrs || {})) e.setAttribute(k, attrs[k]);
        if (parent) parent.appendChild(e);
        return e;
    };
    const vp = $('vp');
    const vis = { tri: new Map(), node: new Map() };      // éléments SVG existants : clé → { t, poly, tag, name, rom } / { n, g, tx }
    let built = null;                                     // zone du plan (unités du réseau) couverte par ces éléments
    let boardW = 0, boardH = 0;                           // taille du dessin en pixels (le SVG est en pixels : 1 unité = 1 px à ×1)
    const view = { k: 1, tx: 0, ty: 0 };
    const MIN_ZOOM = 0.45, MAX_ZOOM = 4;
    const viewCenter = () => ({ cx: (boardW / 2 - view.tx) / view.k, cy: (boardH / 2 - view.ty) / view.k });

    // Largeur de la pastille du chiffrage romain (police Kalam 16 px) : estimée d'après les caractères, sans mesurer le DOM
    const ROM_W = { I: 5, V: 11, X: 10, i: 5, v: 8, x: 8, '♭': 7, '♯': 7, '°': 7, 'ø': 8, 'Δ': 10 };
    const romWidth = (s) => Math.max(26, 14 + [...s].reduce((w, c) => w + (ROM_W[c] || 8), 0));
    function makeTri(t) {
        const poly = el('polygon', { points: t.v.map((n) => n.x + ',' + n.y).join(' '), class: 'tri', 'data-tri': t.key }, $('triLayer'));
        // Les trois lignes (P/L/R, nom, chiffrage) sont centrées dans le triangle : pointe en haut = majeur (large en bas),
        // pointe en bas = mineur (large en haut, étroit vers la pointe). Les cercles des notes occupent les sommets.
        const up = t.kind === 'u';
        const yTag = t.cy + (up ? -14 : -17), yName = t.cy + (up ? 9 : 4), yRom = t.cy + (up ? 29 : 25);
        const tag = el('text', { x: t.cx, y: yTag, class: 'ttag' }, $('labelLayer'));
        const name = el('text', { x: t.cx, y: yName, class: 'tname' }, $('labelLayer'));
        const pill = el('rect', { x: t.cx - 14, y: yRom - 15, width: 28, height: 21, rx: 10.5, class: 'tpill', visibility: 'hidden' }, $('labelLayer'));
        const rom = el('text', { x: t.cx, y: yRom, class: 'troman' }, $('labelLayer'));
        vis.tri.set(t.key, { t, poly, tag, name, pill, rom });
    }
    function makeNode(n) {
        const g = el('g', { class: 'node', 'data-pc': n.pc }, $('nodeLayer'));
        el('circle', { cx: n.x, cy: n.y, r: 24 }, g);
        const tx = el('text', { x: n.x, y: n.y }, g);
        vis.node.set(n.i + ',' + n.j, { n, g, tx });
    }
    // Crée les éléments qui manquent et retire ceux qui sont loin. Renvoie true si quelque chose a été (re)dessiné.
    function syncVisible(force) {
        if (!boardW || !boardH) return false;
        const sx0 = -view.tx / view.k, sx1 = (boardW - view.tx) / view.k;
        const sy0 = -view.ty / view.k, sy1 = (boardH - view.ty) / view.k;
        if (!force && built && sx0 >= built.x0 && sx1 <= built.x1 && sy0 >= built.y0 && sy1 <= built.y1) return false;
        const mx = DX * 2, my = DY * 2;
        built = { x0: sx0 - mx, x1: sx1 + mx, y0: sy0 - my, y1: sy1 + my };
        for (const [k, e] of vis.tri) {
            if (e.t.cx < built.x0 - mx || e.t.cx > built.x1 + mx || e.t.cy < built.y0 - my || e.t.cy > built.y1 + my) {
                e.poly.remove(); e.tag.remove(); e.name.remove(); e.pill.remove(); e.rom.remove(); vis.tri.delete(k);
            }
        }
        for (const [k, e] of vis.node) {
            if (e.n.x < built.x0 - mx || e.n.x > built.x1 + mx || e.n.y < built.y0 - my || e.n.y > built.y1 + my) { e.g.remove(); vis.node.delete(k); }
        }
        const jMin = Math.floor(-built.y1 / DY) - 1, jMax = Math.ceil(-built.y0 / DY) + 1;
        for (let j = jMin; j <= jMax; j++) {
            const iMin = Math.floor(built.x0 / DX - j / 2) - 1, iMax = Math.ceil(built.x1 / DX - j / 2) + 1;
            for (let i = iMin; i <= iMax; i++) {
                if (!vis.node.has(i + ',' + j)) makeNode(N(i, j));
                if (!vis.tri.has('u' + i + ',' + j)) makeTri(T('u', i, j));
                if (!vis.tri.has('d' + i + ',' + j)) makeTri(T('d', i, j));
            }
        }
        return true;
    }

    // ------------------------------------------------------------------------------------------------------------------
    // Zoom (pincement, molette, boutons) et déplacement : la vue est libre, le réseau se prolonge dans toutes les directions
    // ------------------------------------------------------------------------------------------------------------------
    let anim = null;
    const stopAnim = () => { if (anim) { cancelAnimationFrame(anim); anim = null; } };
    const clampK = (k) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
    function applyView() {
        view.k = clampK(view.k);
        vp.setAttribute('transform', `translate(${view.tx} ${view.ty}) scale(${view.k})`);
        svg.classList.toggle('lod1', view.k < 0.75);
        svg.classList.toggle('lod2', view.k < 0.55);
        $('zoomVal').textContent = (Math.round(view.k * 10) / 10).toString().replace('.', ',') + '×';
        $('bZoomOut').disabled = view.k <= MIN_ZOOM + 0.001;
        $('bZoomIn').disabled = view.k >= MAX_ZOOM - 0.001;
        if (syncVisible(false)) paint();
    }
    function toUnits(cx, cy) {
        const r = svg.getBoundingClientRect();
        return { x: cx - r.left, y: cy - r.top };
    }
    function zoomAt(newK, px, py) {
        stopAnim();
        newK = clampK(newK);
        const r = newK / view.k;
        view.tx = px - (px - view.tx) * r;
        view.ty = py - (py - view.ty) * r;
        view.k = newK;
        applyView();
    }
    function animateView(tx, ty, k) {
        stopAnim();
        const from = { tx: view.tx, ty: view.ty, k: view.k }, t0 = performance.now(), dur = 380;
        const step = (now) => {
            const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
            view.k = from.k + (k - from.k) * e;
            view.tx = from.tx + (tx - from.tx) * e;
            view.ty = from.ty + (ty - from.ty) * e;
            applyView();
            anim = p < 1 ? requestAnimationFrame(step) : null;
        };
        anim = requestAnimationFrame(step);
    }
    // Place le point (cx, cy) du réseau au centre de l'écran (k = null : on garde le zoom actuel)
    function centerOn(cx, cy, k, animate) {
        const kk = clampK(k == null ? view.k : k);
        const tx = boardW / 2 - cx * kk, ty = boardH / 2 - cy * kk;
        if (animate) animateView(tx, ty, kk);
        else { stopAnim(); view.k = kk; view.tx = tx; view.ty = ty; applyView(); }
    }
    const baseZoom = () => (boardW && boardW < 600 ? 0.7 : 1);
    // Vue de départ ou « Recentrer » : l'accord sélectionné ou, à défaut, la tonique de l'analyse
    function recenter(animate) {
        const sel = R.sel ? triByKey(R.sel) : null;
        const t = sel || nearestInstance(S.tonic, S.mode === 'min', ORIGIN);
        centerOn(t.cx, t.cy, baseZoom(), animate);
    }
    // Si le triangle est près du bord (ou hors de l'écran), on glisse la vue pour le ramener au centre
    function ensureVisible(t) {
        if (!t || !boardW || svg.classList.contains('dragging')) return;
        const sx = t.cx * view.k + view.tx, sy = t.cy * view.k + view.ty, m = 90;
        if (sx < m || sx > boardW - m || sy < m || sy > boardH - m) centerOn(t.cx, t.cy, null, true);
    }
    function measureBoard() {
        const r = boardBox.getBoundingClientRect();
        const w = Math.round(r.width), h = Math.round(r.height);
        if (!w || !h || (w === boardW && h === boardH)) return;
        const first = !boardW, dw = w - boardW, dh = h - boardH;
        boardW = w; boardH = h;
        svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
        if (first) { recenter(false); }
        else { view.tx += dw / 2; view.ty += dh / 2; applyView(); }     // le centre de la vue ne bouge pas quand la fenêtre change de taille
    }
    function initZoom() {
        const pts = new Map();
        let pinch = null, down = null, moved = false, multi = false;

        svg.addEventListener('pointerdown', (e) => {
            stopAnim();
            pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pts.size === 1) {
                down = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
                moved = false; multi = false;
            } else if (pts.size === 2) {
                multi = true;
                const [a, b] = [...pts.values()];
                const mid = toUnits((a.x + b.x) / 2, (a.y + b.y) / 2);
                pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, k0: view.k, tx0: view.tx, ty0: view.ty, mid0: mid };
            }
        });
        svg.addEventListener('pointermove', (e) => {
            if (!pts.has(e.pointerId)) return;
            pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pts.size >= 2 && pinch) {
                const [a, b] = [...pts.values()];
                const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
                const newK = clampK(pinch.k0 * d / pinch.d0);
                const mid = toUnits((a.x + b.x) / 2, (a.y + b.y) / 2);
                const cxp = (pinch.mid0.x - pinch.tx0) / pinch.k0, cyp = (pinch.mid0.y - pinch.ty0) / pinch.k0;   // point du réseau sous les doigts au départ
                view.k = newK;
                view.tx = mid.x - cxp * newK;
                view.ty = mid.y - cyp * newK;
                applyView();
                moved = true;
            } else if (pts.size === 1 && down) {
                const dx = e.clientX - down.x, dy = e.clientY - down.y;
                if (!moved && Math.hypot(dx, dy) > 6) {
                    moved = true;
                    try { svg.setPointerCapture(e.pointerId); } catch (err) {}
                    svg.classList.add('dragging');
                }
                if (moved) {
                    view.tx = down.tx + dx;
                    view.ty = down.ty + dy;
                    applyView();
                }
            }
        });
        const end = (e) => {
            if (!pts.has(e.pointerId)) return;
            const wasSingle = pts.size === 1;
            pts.delete(e.pointerId);
            if (pts.size < 2) pinch = null;
            if (pts.size === 0) {
                svg.classList.remove('dragging');
                if (wasSingle && !moved && !multi && e.type === 'pointerup') {
                    const hit = document.elementFromPoint(e.clientX, e.clientY);
                    const nodeEl = hit && hit.closest ? hit.closest('[data-pc]') : null;
                    const triEl = hit && hit.closest ? hit.closest('[data-tri]') : null;
                    if (nodeEl && svg.contains(nodeEl)) onNodeTap(parseInt(nodeEl.getAttribute('data-pc'), 10));
                    else if (triEl && svg.contains(triEl)) onTriTap(triEl.getAttribute('data-tri'));
                }
                down = null;
            } else if (pts.size === 1) {
                const rest = [...pts.values()][0];       // un doigt reste : on reprend le déplacement depuis sa position
                down = { x: rest.x, y: rest.y, tx: view.tx, ty: view.ty };
            }
        };
        svg.addEventListener('pointerup', end);
        svg.addEventListener('pointercancel', end);

        svg.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (e.ctrlKey || e.metaKey) {                       // pincement du pavé tactile, ou Ctrl + molette
                const p = toUnits(e.clientX, e.clientY);
                zoomAt(view.k * Math.exp(-e.deltaY * 0.01), p.x, p.y);
            } else {                                              // glissement à deux doigts ou molette : on déplace le réseau
                stopAnim();
                const f = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? boardH : 1);
                view.tx -= e.deltaX * f;
                view.ty -= e.deltaY * f;
                applyView();
            }
        }, { passive: false });

        $('bZoomIn').addEventListener('click', () => zoomAt(view.k * 1.4, boardW / 2, boardH / 2));
        $('bZoomOut').addEventListener('click', () => zoomAt(view.k / 1.4, boardW / 2, boardH / 2));
        $('bZoomReset').addEventListener('click', () => recenter(true));

        if (typeof ResizeObserver === 'function') new ResizeObserver(measureBoard).observe(boardBox);
        else window.addEventListener('resize', measureBoard);
        measureBoard();
    }

    // ------------------------------------------------------------------------------------------------------------------
    // Plein écran : seulement le réseau et la progression (iPhone et navigateurs sans API plein écran : plein écran simulé)
    // ------------------------------------------------------------------------------------------------------------------
    function initFullscreen() {
        const stage = $('stage'), btn = $('bFull'), exit = $('bFullExit');
        const nativeOn = () => document.fullscreenElement === stage || document.webkitFullscreenElement === stage;
        const canNative = !!(stage.requestFullscreen || stage.webkitRequestFullscreen);
        let sim = false;
        const reflect = () => {
            const on = nativeOn() || sim;
            stage.classList.toggle('is-fs', on);
            stage.classList.toggle('fs-sim', sim);
            document.body.classList.toggle('fs-lock', sim);
            btn.setAttribute('aria-pressed', String(on));
            measureBoard();
        };
        function enter() {
            if (canNative) {
                try {
                    const p = (stage.requestFullscreen || stage.webkitRequestFullscreen).call(stage);
                    if (p && typeof p.catch === 'function') p.catch(() => { sim = true; reflect(); });
                    return;
                } catch (e) { /* on bascule sur le plein écran simulé */ }
            }
            sim = true; reflect();
        }
        function leave() {
            if (nativeOn()) { try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (e) {} }
            sim = false; reflect();
        }
        btn.addEventListener('click', () => ((nativeOn() || sim) ? leave() : enter()));
        exit.addEventListener('click', leave);
        document.addEventListener('fullscreenchange', reflect);
        document.addEventListener('webkitfullscreenchange', reflect);
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sim) leave(); });
    }

    // ------------------------------------------------------------------------------------------------------------------
    // Sélection
    // ------------------------------------------------------------------------------------------------------------------
    function current() {
        if (R.sel) { const t = triByKey(R.sel); return { kind: 'tri', t, root: t.root, id: triId(t) }; }
        if (R.custom) return { kind: 'custom', root: R.custom.root, id: R.custom.id };
        return null;
    }
    function clearSel() { R.sel = null; R.note = null; R.custom = null; }

    let arrowsOnProg = false;   // vrai juste après le choix d'un accord dans la progression : ← / → passent alors d'un accord à l'autre
    function selectTri(key, opts) {
        const o = Object.assign({ play: true }, opts || {});
        arrowsOnProg = false;
        clearSel(); R.sel = key;
        const t = triByKey(key);
        if (o.play) playChord(t.root, triId(t));
        refreshSelection();
    }
    function selectNote(pc) {
        clearSel(); R.note = pc; R.progSel = null;
        playNote(pc);
        refreshSelection();
    }
    function selectCustom(root, id, opts) {
        const o = Object.assign({ play: true }, opts || {});
        clearSel(); R.custom = { root, id };
        if (o.play) playChord(root, id);
        refreshSelection();
    }
    // Sélection depuis le réseau : si l'accord fait partie de la progression, la case correspondante est aussi
    // sélectionnée en bas (triangle exact d'abord, sinon même accord ; en cas de répétition, on passe à la suivante).
    function progIndexFor(key) {
        const t = triByKey(key), id = triId(t);
        const same = [], exact = [];
        R.prog.forEach((it, i) => {
            if (it.r !== t.root || it.id !== id) return;
            same.push(i);
            if (R.inst[i] && R.inst[i].key === key) exact.push(i);
        });
        const list = exact.length ? exact : same;
        if (!list.length) return null;
        const prev = R.progSel === null ? -1 : R.progSel;
        return list.find((i) => i > prev) ?? list[0];
    }
    function onTriTap(key) {
        const idx = S.entry ? null : progIndexFor(key);
        R.progSel = idx;
        selectTri(key);
        if (S.entry) addCurrent();
    }
    function onNodeTap(pc) { selectNote(pc); }

    // Navigation au clavier : les flèches déplacent la sélection d'un triangle à l'autre, dans le sens de l'écran.
    // ← / → : le triangle voisin dans la même rangée (ils partagent une arête) ; ↑ / ↓ : la rangée du dessus / du dessous, juste à la verticale.
    function stepTri(t, dir) {
        const { i, j } = t, up = t.kind === 'u';
        if (dir === 'right') return up ? T('d', i, j) : T('u', i + 1, j);
        if (dir === 'left') return up ? T('d', i - 1, j) : T('u', i, j);
        if (dir === 'up') return up ? T('d', i - 1, j + 1) : T('u', i, j + 1);
        return up ? T('d', i, j - 1) : T('u', i + 1, j - 1);
    }
    function triNearViewCenter() {
        const f = viewCenter(), j0 = Math.floor(-f.cy / DY);
        let best = null, bd = Infinity;
        for (let j = j0 - 1; j <= j0 + 1; j++) {
            const i0 = Math.round(f.cx / DX - j / 2);
            for (let i = i0 - 2; i <= i0 + 2; i++) {
                for (const kind of ['u', 'd']) {
                    const t = T(kind, i, j), d = (t.cx - f.cx) ** 2 + (t.cy - f.cy) ** 2;
                    if (d < bd) { bd = d; best = t; }
                }
            }
        }
        return best;
    }
    function moveOnBoard(dir) {
        // Un bouton resté actif (Son, Couleurs…) ne doit pas intercepter la touche Entrée qui ajoute le triangle à la progression
        const ae = document.activeElement;
        if (ae && ae !== document.body && ae.blur && ae.tagName === 'BUTTON') ae.blur();
        // Sans triangle sélectionné, on part de celui qui est au centre de l'écran
        const t = R.sel ? stepTri(triByKey(R.sel), dir) : triNearViewCenter();
        R.progSel = S.entry ? null : progIndexFor(t.key);
        selectTri(t.key);
        renderChips();
        ensureVisible(t);
        if (S.entry) addCurrent();
    }
    // Maj + flèche : fait glisser la vue sans changer la sélection
    function panBy(dir) {
        const step = 160, dx = dir === 'left' ? step : dir === 'right' ? -step : 0, dy = dir === 'up' ? step : dir === 'down' ? -step : 0;
        animateView(view.tx + dx, view.ty + dy, view.k);
    }

    // ------------------------------------------------------------------------------------------------------------------
    // Peinture du réseau
    // ------------------------------------------------------------------------------------------------------------------
    function paint() {
        const cur = current();
        $('bDeselect').disabled = !cur && R.note === null;
        const playItem = R.playing >= 0 ? R.prog[R.playing] : null;
        const shown = playItem ? { root: playItem.r, id: playItem.id } : (cur ? { root: cur.root, id: cur.id } : null);
        const lit = new Set();
        let rootPc = -1;
        if (shown) { chordPcs(shown.root, shown.id).forEach((p) => lit.add(p)); rootPc = shown.root; }
        else if (R.note !== null) lit.add(R.note);

        const sel = (!playItem && R.sel) ? triByKey(R.sel) : null;
        const nb = sel ? neighbors(sel) : {};
        const nbKey = {};
        for (const k of ['P', 'L', 'R']) if (nb[k]) nbKey[nb[k]] = k;
        const playKey = playItem && R.inst[R.playing] ? R.inst[R.playing].key : null;
        const inprog = new Set(R.inst.filter(Boolean).map((t) => t.key));
        const isTriad = shown && (shown.id === TRI_MAJ || shown.id === TRI_MIN);

        const marks = [];          // triangles à contourner : { t, cls, pr }
        for (const e of vis.tri.values()) {
            const t = e.t;
            const id = triId(t);
            const isSel = !!(sel && t.key === sel.key), isPlay = t.key === playKey, isNb = !!nbKey[t.key];
            const outKey = !isInKey(t.root, id);                   // hors tonalité : toujours atténué (sa couleur se règle dans « Couleurs »)
            let cls = 'tri ' + (t.minor ? 'min' : 'maj') + ((outKey && !isNb && !isSel && !isPlay) ? ' out' : '');
            if (isNb) cls += ' nb';
            if (isSel) cls += ' sel';
            if (isPlay) cls += ' play';
            if (e.cls !== cls) { e.poly.setAttribute('class', cls); e.cls = cls; }
            // Contours (accord de la progression, même accord ailleurs, triades contenues, sélection, accord joué) : dessinés à part,
            // au-dessus de toutes les cases, pour qu'aucune case voisine ni aucun trait du chemin ne les recouvre.
            let hl = '', pr = 0;
            if (inprog.has(t.key)) { hl += ' inprog'; pr = 1; }
            if (shown && isTriad && t.root === shown.root && (shown.id === id) && !isSel) hl += ' twin';
            if (shown && !isTriad && t.pcs.every((p) => lit.has(p))) hl += ' near';        // triades contenues dans l'accord
            if (!shown && R.note !== null && t.pcs.includes(R.note)) hl += ' near';          // triades qui contiennent la note
            if (isSel) { hl += ' sel'; pr = 2; }
            if (isPlay) { hl += ' play'; pr = 3; }
            // Accord sélectionné qui fait aussi partie de la progression : son contour de progression est dessiné par-dessus celui de la sélection
            if (isSel && inprog.has(t.key)) { marks.push({ t, cls: 'sel', pr: 2 }, { t, cls: 'inprog', pr: 2.5 }); }
            else if (hl) marks.push({ t, cls: hl.trim(), pr });
            // couleur du texte : celle qui se lit le mieux sur la case (voir les variables --*-ink du CSS)
            const tone = isPlay ? 'play' : (isSel ? 'sel' : (isNb ? 'nb' : (t.minor ? 'min' : 'maj') + (outKey ? 'out' : '')));
            if (e.tone !== tone) {
                e.name.setAttribute('class', 'tname t-' + tone); e.tag.setAttribute('class', 'ttag t-' + tone);
                e.tone = tone;
            }
            const nameTxt = S.labels ? chordName(t.root, id) : '';
            const romTxt = S.analysis ? romanOf(t.root, id) : '';
            const tagTxt = nbKey[t.key] || '';
            if (e.name.textContent !== nameTxt) e.name.textContent = nameTxt;
            if (e.rom.textContent !== romTxt) {
                e.rom.textContent = romTxt;
                const w = romWidth(romTxt);
                e.pill.setAttribute('width', w); e.pill.setAttribute('x', t.cx - w / 2);
                e.pill.setAttribute('visibility', romTxt ? 'visible' : 'hidden');
            }
            if (e.tag.textContent !== tagTxt) e.tag.textContent = tagTxt;
        }
        drawMarks(marks);
        for (const e of vis.node.values()) {
            const txt = nm(e.n.pc);
            if (e.tx.textContent !== txt) e.tx.textContent = txt;
            const cls = 'node' + (lit.has(e.n.pc) ? ' on' : '') + (e.n.pc === rootPc ? ' root' : '');
            if (e.cls !== cls) { e.g.setAttribute('class', cls); e.cls = cls; }
        }
    }

    // Couche des contours : un polygone sans remplissage par triangle à signaler, l'accord joué et la sélection au-dessus des autres
    let marksSig = '';
    function drawMarks(marks) {
        marks.sort((a, b) => a.pr - b.pr);
        const sig = marks.map((m) => m.t.key + ' ' + m.cls).join('|');
        if (sig === marksSig) return;
        marksSig = sig;
        const layer = $('hlLayer');
        layer.textContent = '';
        for (const m of marks) el('polygon', { points: m.t.v.map((n) => n.x + ',' + n.y).join(' '), class: m.cls }, layer);
    }

    // Choisit, pour chaque accord de la progression, le triangle qui le représente : celui qu'on avait touché, sinon la copie la plus
    // proche du précédent ; puis dessine le chemin parcouru dans le réseau.
    // La triade du réseau qui représente un accord : lui-même s'il est une triade, sinon la triade majeure ou mineure qu'il contient
    // (tierce 4 ou 3 et quinte juste : maj7, 7, 6, m7, 9… ; pas les accords suspendus, diminués ou augmentés).
    function triadOfChord(id) {
        if (id === TRI_MAJ || id === TRI_MIN) return id;
        const o = lookupChord(id);
        if (!o || !o.notes || !o.notes.includes(7)) return null;
        return o.notes[1] === 4 ? TRI_MAJ : (o.notes[1] === 3 ? TRI_MIN : null);
    }
    function computeInstances() {
        let prev = null;
        R.inst = R.prog.map((it) => {
            const kind = triadOfChord(it.id);
            if (!kind) return null;
            const minor = kind === TRI_MIN;
            let t = it.tri ? triByKey(it.tri) : null;
            if (!t || t.root !== it.r || t.minor !== minor) t = nearestInstance(it.r, minor, prev || ORIGIN);
            if (t) prev = t;
            return t;
        });
    }
    // Flèches de la progression (forme de secours : ruban droit à pointe anguleuse, utilisé seulement si le calcul de chemin échoue ; voir arrowD).
    // Pour chaque passage d'un accord au suivant, une forme pleine (corps + pointe) tracée au-dessus de tout.
    // Entre deux triangles voisins la flèche est courte et centrée sur leur arête commune ; plus loin, elle part près du centre
    // du premier triangle et s'arrête près de celui du second, pour ne pas masquer leurs inscriptions.
    function arrowShape(a, b, both) {
        const dx = b.cx - a.cx, dy = b.cy - a.cy, dist = Math.hypot(dx, dy) || 1;
        const ux = dx / dist, uy = dy / dist, nx = -uy, ny = ux;
        const trim = Math.max(0, Math.min(34, (dist - 50) / 2));
        const L = dist - 2 * trim, hl = Math.min(18, L * (both ? 0.3 : 0.5)), hw = 9, sw = 2.8;     // longueur de pointe, demi-largeur de pointe et de corps
        const P = (t, w) => (a.cx + ux * (trim + t) + nx * w).toFixed(1) + ' ' + (a.cy + uy * (trim + t) + ny * w).toFixed(1);
        if (both) {        // aller-retour : une seule flèche à deux pointes
            return `M${P(0, 0)} L${P(hl, -hw)} L${P(hl, -sw)} L${P(L - hl, -sw)} L${P(L - hl, -hw)} L${P(L, 0)} L${P(L - hl, hw)} L${P(L - hl, sw)} L${P(hl, sw)} L${P(hl, hw)} Z`;
        }
        return `M${P(0, -sw)} L${P(L - hl, -sw)} L${P(L - hl, -hw)} L${P(L, 0)} L${P(L - hl, hw)} L${P(L - hl, sw)} L${P(0, sw)} Z`;
    }
    // ---- Forme des flèches : un ruban lisse qui contourne les noms d'accord ----
    // Pour chaque passage d'un accord au suivant, on cherche un chemin dans l'espace libre entre les inscriptions (noms d'accord, chiffrages
    // romains, puis cercles des notes quand c'est possible) : recherche du plus court chemin sur une grille fine, puis chemin « élastique »
    // lissé qui reste à distance des inscriptions. La flèche est un ruban sans aucun angle droit : bout arrondi, corps qui s'évase en
    // douceur en une pointe effilée, et, si la place manque, une pointe plus petite.
    const ARROW_HEADS = [[18, 9], [14, 7.5], [11, 6]];       // [longueur, demi-largeur] de la pointe, de la plus grande à la plus petite
    const ARROW_BODY = 2.8;                                  // demi-largeur du corps
    const fontW = new Map();
    let measureCtx = null;
    // Largeur d'un nom d'accord (police des accords, 21 px gras), mesurée une fois puis gardée
    function textWidth(s) {
        let w = fontW.get(s);
        if (w !== undefined) return w;
        try {
            if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
            measureCtx.font = '700 21px ' + (getComputedStyle(document.documentElement).getPropertyValue('--font-chord') || 'serif');
            w = measureCtx.measureText(s).width;
        } catch (e) { w = s.length * 12; }
        fontW.set(s, w);
        return w;
    }
    // Encombrement des inscriptions d'un triangle (rectangles), tel qu'il est dessiné par makeTri / paint
    function labelRects(t) {
        const up = t.kind === 'u', id = triId(t), out = [];
        const name = S.labels ? chordName(t.root, id) : '';
        if (name) { const hw = textWidth(name) / 2 + 1.5, yb = t.cy + (up ? 9 : 4); out.push({ k: 'r', x0: t.cx - hw, x1: t.cx + hw, y0: yb - 16, y1: yb + 5 }); }
        const rom = S.analysis ? romanOf(t.root, id) : '';
        if (rom) { const hw = romWidth(rom) / 2, yr = t.cy + (up ? 29 : 25); out.push({ k: 'r', x0: t.cx - hw, x1: t.cx + hw, y0: yr - 13, y1: yr + 5 }); }
        if (!out.length) out.push({ k: 'r', x0: t.cx - 9, x1: t.cx + 9, y0: t.cy - 9, y1: t.cy + 9 });   // rien d'écrit : un petit repère au centre
        return out;
    }
    const obDist = (o, x, y) => (o.k === 'r'
        ? Math.hypot(Math.max(o.x0 - x, 0, x - o.x1), Math.max(o.y0 - y, 0, y - o.y1))
        : Math.max(0, Math.hypot(x - o.x, y - o.y) - o.r));
    // Point de l'obstacle le plus proche de (x, y) : { d, x, y } (d = 0 à l'intérieur : on sort par le bord le plus proche)
    function obNearest(o, x, y) {
        if (o.k === 'c') {
            const dx = x - o.x, dy = y - o.y, h = Math.hypot(dx, dy) || 1;
            return { d: Math.max(0, h - o.r), x: o.x + dx / h * o.r, y: o.y + dy / h * o.r };
        }
        const px = Math.min(o.x1, Math.max(o.x0, x)), py = Math.min(o.y1, Math.max(o.y0, y));
        const d = Math.hypot(x - px, y - py);
        if (d > 0) return { d, x: px, y: py };
        const l = x - o.x0, r = o.x1 - x, u = y - o.y0, b = o.y1 - y, m = Math.min(l, r, u, b);
        if (m === l) return { d: 0, x: o.x0, y }; if (m === r) return { d: 0, x: o.x1, y };
        return m === u ? { d: 0, x, y: o.y0 } : { d: 0, x, y: o.y1 };
    }
    const inTriangle = (t, x, y) => {
        const [p, q, r] = t.v;
        const s1 = (q.x - p.x) * (y - p.y) - (q.y - p.y) * (x - p.x), s2 = (r.x - q.x) * (y - q.y) - (r.y - q.y) * (x - q.x), s3 = (p.x - r.x) * (y - r.y) - (p.y - r.y) * (x - r.x);
        return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
    };
    // Pastille « 1 » du premier accord de la progression (dessinée par drawPath) : un obstacle de plus pour les flèches
    function startDot() {
        const s = R.inst.find(Boolean);
        return s ? { x: s.cx, y: s.cy - (s.kind === 'u' ? 48 : 50), r: 13 } : null;
    }
    // Obstacles autour de deux triangles : inscriptions de tous les triangles de la zone, et (si demandé) cercles des notes
    function arrowObstacles(a, b, withNodes, pad) {
        const box = { x0: Math.min(a.cx, b.cx) - pad, x1: Math.max(a.cx, b.cx) + pad, y0: Math.min(a.cy, b.cy) - pad, y1: Math.max(a.cy, b.cy) + pad };
        const obs = [];
        const jMin = Math.floor(-box.y1 / DY) - 1, jMax = Math.ceil(-box.y0 / DY) + 1;
        for (let j = jMin; j <= jMax; j++) {
            const iMin = Math.floor(box.x0 / DX - j / 2) - 1, iMax = Math.ceil(box.x1 / DX - j / 2) + 1;
            for (let i = iMin; i <= iMax; i++) {
                for (const kind of ['u', 'd']) {
                    const t = T(kind, i, j);
                    if (t.cx >= box.x0 - 20 && t.cx <= box.x1 + 20 && t.cy >= box.y0 - 20 && t.cy <= box.y1 + 20) obs.push(...labelRects(t));
                }
                if (withNodes) { const n = N(i, j); if (n.x >= box.x0 && n.x <= box.x1 && n.y >= box.y0 && n.y <= box.y1) obs.push({ k: 'c', x: n.x, y: n.y, r: 24 }); }
            }
        }
        const dot = startDot();
        if (dot && dot.x >= box.x0 - 20 && dot.x <= box.x1 + 20 && dot.y >= box.y0 - 20 && dot.y <= box.y1 + 20) obs.push({ k: 'c', x: dot.x, y: dot.y, r: dot.r + 2 });
        return { obs, box };
    }
    // Plus court chemin (Dijkstra sur grille, 8 voisins) des abords des inscriptions de a vers ceux de b, en restant à au moins `clear` px
    // de tout obstacle et en préférant le milieu des passages. Renvoie la liste de points, ou null.
    function arrowRoute(a, b, obs, box, clear, avoid) {
        const cs = Math.max(3, Math.ceil(Math.sqrt((box.x1 - box.x0) * (box.y1 - box.y0) / 22000)));
        const W = Math.ceil((box.x1 - box.x0) / cs), H = Math.ceil((box.y1 - box.y0) / cs);
        const X = (i) => box.x0 + (i + 0.5) * cs, Y = (j) => box.y0 + (j + 0.5) * cs;
        const D = new Float32Array(W * H).fill(99);
        for (const o of obs) {
            const bx0 = o.k === 'r' ? o.x0 : o.x - o.r, bx1 = o.k === 'r' ? o.x1 : o.x + o.r, by0 = o.k === 'r' ? o.y0 : o.y - o.r, by1 = o.k === 'r' ? o.y1 : o.y + o.r;
            const i0 = Math.max(0, Math.floor((bx0 - 12 - box.x0) / cs)), i1 = Math.min(W - 1, Math.floor((bx1 + 12 - box.x0) / cs));
            const j0 = Math.max(0, Math.floor((by0 - 12 - box.y0) / cs)), j1 = Math.min(H - 1, Math.floor((by1 + 12 - box.y0) / cs));
            for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const d = obDist(o, X(i), Y(j)); if (d < D[j * W + i]) D[j * W + i] = d; }
        }
        // trajets des autres flèches : coût élevé à moins de 9 px (on peut les croiser, mais pas les longer)
        const A = new Float32Array(W * H).fill(99);
        if (avoid) for (const pl of avoid) for (const q of pl) {
            const i0 = Math.max(0, Math.floor((q.x - 10 - box.x0) / cs)), i1 = Math.min(W - 1, Math.floor((q.x + 10 - box.x0) / cs));
            const j0 = Math.max(0, Math.floor((q.y - 10 - box.y0) / cs)), j1 = Math.min(H - 1, Math.floor((q.y + 10 - box.y0) / cs));
            for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const d = Math.hypot(X(i) - q.x, Y(j) - q.y); if (d < A[j * W + i]) A[j * W + i] = d; }
        }
        // départs et arrivées : cases libres du triangle, dans une bande étroite autour des inscriptions de ce triangle
        const ring = (t) => {
            const own = labelRects(t), res = [];
            const i0 = Math.max(0, Math.floor((t.cx - 70 - box.x0) / cs)), i1 = Math.min(W - 1, Math.floor((t.cx + 70 - box.x0) / cs));
            const j0 = Math.max(0, Math.floor((t.cy - 60 - box.y0) / cs)), j1 = Math.min(H - 1, Math.floor((t.cy + 60 - box.y0) / cs));
            for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
                if (D[j * W + i] < clear) continue;
                if (!inTriangle(t, X(i), Y(j))) continue;
                let d = 99; for (const o of own) d = Math.min(d, obDist(o, X(i), Y(j)));
                if (d <= clear + cs + 1) res.push(j * W + i);        // bande étroite juste à la limite autorisée : la flèche part et finit tout près du nom
            }
            return res;
        };
        const src = ring(a), dst = ring(b);
        if (!src.length || !dst.length) return null;
        const isDst = new Uint8Array(W * H); dst.forEach((k) => { isDst[k] = 1; });
        const cost = new Float32Array(W * H).fill(Infinity), prev = new Int32Array(W * H).fill(-1), done = new Uint8Array(W * H);
        const hk = [], hv = [];                       // tas binaire (clé, valeur)
        const push = (k, v) => {
            let i = hk.length; hk.push(k); hv.push(v);
            while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= k) break; hk[i] = hk[p]; hv[i] = hv[p]; i = p; }
            hk[i] = k; hv[i] = v;
        };
        const pop = () => {
            const rk = hk[0], rv = hv[0], k = hk.pop(), v = hv.pop(), n = hk.length;
            if (n) {
                let i = 0;
                for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && hk[c + 1] < hk[c]) c++; if (hk[c] >= k) break; hk[i] = hk[c]; hv[i] = hv[c]; i = c; }
                hk[i] = k; hv[i] = v;
            }
            return [rk, rv];
        };
        src.forEach((k) => { cost[k] = 0; push(0, k); });
        let goal = -1;
        while (hk.length) {
            const [c, k] = pop();
            if (done[k]) continue;
            done[k] = 1;
            if (isDst[k]) { goal = k; break; }
            const i = k % W, j = (k / W) | 0;
            for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
                if (!di && !dj) continue;
                const ni = i + di, nj = j + dj;
                if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
                const nk = nj * W + ni;
                if (done[nk] || D[nk] < clear) continue;
                if (di && dj && (D[j * W + ni] < clear || D[nj * W + i] < clear)) continue;      // pas de coupe de coin entre deux obstacles
                const near = D[nk] < 12 ? (12 - D[nk]) / 12 : 0;
                const pen = A[nk] < 9 ? (9 - A[nk]) / 9 * 7 : 0;
                const nc = c + (di && dj ? 1.414 : 1) * cs * (1 + 0.9 * near + pen);
                if (nc < cost[nk]) { cost[nk] = nc; prev[nk] = k; push(nc, nk); }
            }
        }
        if (goal < 0) return null;
        const pts = [];
        for (let k = goal; k >= 0; k = prev[k]) pts.push({ x: X(k % W), y: Y((k / W) | 0) });
        return pts.reverse();
    }
    function resample(pts, step) {
        const out = [{ x: pts[0].x, y: pts[0].y }];
        let carry = 0;
        for (let i = 1; i < pts.length; i++) {
            const p = pts[i - 1], q = pts[i], len = Math.hypot(q.x - p.x, q.y - p.y);
            let pos = step - carry;
            while (pos <= len) { out.push({ x: p.x + (q.x - p.x) * pos / len, y: p.y + (q.y - p.y) * pos / len }); pos += step; }
            carry = len - (pos - step);
        }
        const last = pts[pts.length - 1], e = out[out.length - 1];
        if (Math.hypot(last.x - e.x, last.y - e.y) > step * 0.35) out.push({ x: last.x, y: last.y }); else out[out.length - 1] = { x: last.x, y: last.y };
        return out;
    }
    // Chemin « élastique » : on lisse (chaque point vers la moyenne de ses voisins) et on repousse les points trop proches d'un obstacle
    function relaxRoute(route, obs, lo) {
        let p = resample(route, 3);
        if (p.length < 3) return p;
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        p.forEach((q) => { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); });
        const near = obs.filter((o) => (o.k === 'r' ? o.x1 > x0 - 40 && o.x0 < x1 + 40 && o.y1 > y0 - 40 && o.y0 < y1 + 40 : o.x > x0 - 60 && o.x < x1 + 60 && o.y > y0 - 60 && o.y < y1 + 60));
        const smooth = () => {
            const q = p.map((s) => ({ x: s.x, y: s.y }));
            for (let i = 1; i < p.length - 1; i++) { q[i].x = 0.5 * p[i].x + 0.25 * (p[i - 1].x + p[i + 1].x); q[i].y = 0.5 * p[i].y + 0.25 * (p[i - 1].y + p[i + 1].y); }
            p = q;
        };
        const pushOut = () => {
            for (let i = 1; i < p.length - 1; i++) {
                for (const o of near) {
                    const h = obNearest(o, p[i].x, p[i].y);
                    if (h.d >= lo) continue;
                    let dx = p[i].x - h.x, dy = p[i].y - h.y, l = Math.hypot(dx, dy);
                    if (l < 1e-6) { const c = o.k === 'r' ? { x: (o.x0 + o.x1) / 2, y: (o.y0 + o.y1) / 2 } : o; dx = p[i].x - c.x; dy = p[i].y - c.y; l = Math.hypot(dx, dy) || 1; }
                    const m = h.d > 0 ? lo - h.d : lo + 0.5;
                    p[i].x += dx / l * m; p[i].y += dy / l * m;
                }
            }
        };
        for (let it = 0; it < 60; it++) { smooth(); pushOut(); }
        // dernier lissage libre (sans repousser) pour effacer les plis, aussi long que possible tant que le chemin reste à distance des inscriptions
        const base = p.map((q) => ({ x: q.x, y: q.y }));
        for (const passes of [40, 20, 10, 4, 0]) {
            p = base.map((q) => ({ x: q.x, y: q.y }));
            for (let it = 0; it < passes; it++) smooth();
            if (!passes || minClear(p, near) >= Math.min(1.8, lo - 0.5)) break;
        }
        return p;
    }
    // Raccourcit les bouts d'un chemin tant qu'ils partent en crochet (virage serré dans les 12 premiers px)
    function trimHooks(c) {
        let q = resample(c, 3);
        const hooked = (a) => { let m = 0; for (let i = 1; i < a.length - 1; i++) { const a1 = Math.atan2(a[i].y - a[i - 1].y, a[i].x - a[i - 1].x), a2 = Math.atan2(a[i + 1].y - a[i].y, a[i + 1].x - a[i].x); let d = Math.abs(a2 - a1); if (d > Math.PI) d = 2 * Math.PI - d; m = Math.max(m, d); } return m > 0.35; };
        while (q.length > 8 && hooked(q.slice(0, 5))) q.shift();
        while (q.length > 8 && hooked(q.slice(-5))) q.pop();
        return q;
    }
    // Courbure maximale d'un chemin (angle entre deux pas successifs de 3 px, en radians) : au-delà de 0,3 il y a un pli
    function maxTurn(c) {
        const q = resample(c, 3);
        let m = 0;
        for (let i = 1; i < q.length - 1; i++) {
            const a1 = Math.atan2(q[i].y - q[i - 1].y, q[i].x - q[i - 1].x), a2 = Math.atan2(q[i + 1].y - q[i].y, q[i + 1].x - q[i].x);
            let d = Math.abs(a2 - a1); if (d > Math.PI) d = 2 * Math.PI - d;
            m = Math.max(m, d);
        }
        return m;
    }
    const minClear = (pts, obs) => { let m = 99; for (const q of pts) for (const o of obs) { const d = obDist(o, q.x, q.y); if (d < m) m = d; } return m; };
    // Ruban : bout arrondi, corps de largeur constante qui suit la courbe, puis une pointe triangulaire à base droite (une à chaque bout
    // si `both`), comme les flèches droites d'origine.
    function ribbon(center, both, hl, hw) {
        const c = resample(center, 2), n = c.length;
        const s = [0]; for (let i = 1; i < n; i++) s.push(s[i - 1] + Math.hypot(c[i].x - c[i - 1].x, c[i].y - c[i - 1].y));
        const L = s[n - 1], sw = ARROW_BODY;
        // point et normale du chemin à l'abscisse curviligne sv
        const at = (sv) => {
            let i = 1; while (i < n - 1 && s[i] < sv) i++;
            const a = c[i - 1], b = c[i], f = Math.max(0, Math.min(1, (sv - s[i - 1]) / ((s[i] - s[i - 1]) || 1))), tl = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, nx: -(b.y - a.y) / tl, ny: (b.x - a.x) / tl };
        };
        const s0 = both ? hl : 0, s1 = L - hl;
        const P0 = at(s0), P1 = at(s1);
        const left = [[P0.x + P0.nx * sw, P0.y + P0.ny * sw]], right = [[P0.x - P0.nx * sw, P0.y - P0.ny * sw]];
        for (let i = 1; i < n - 1; i++) {
            if (s[i] <= s0 + 0.5 || s[i] >= s1 - 0.5) continue;
            const a = c[i - 1], b = c[i + 1], tl = Math.hypot(b.x - a.x, b.y - a.y) || 1, nx = -(b.y - a.y) / tl, ny = (b.x - a.x) / tl;
            left.push([c[i].x + nx * sw, c[i].y + ny * sw]); right.push([c[i].x - nx * sw, c[i].y - ny * sw]);
        }
        left.push([P1.x + P1.nx * sw, P1.y + P1.ny * sw]); right.push([P1.x - P1.nx * sw, P1.y - P1.ny * sw]);
        // pointe : base droite (perpendiculaire à la direction base → pointe), élargie à hw, sommet au bout du chemin
        const head = (B, tip) => {
            const dx = tip.x - B.x, dy = tip.y - B.y, dl = Math.hypot(dx, dy) || 1;
            let nx = -dy / dl, ny = dx / dl;
            if (nx * B.nx + ny * B.ny < 0) { nx = -nx; ny = -ny; }
            return { l: [B.x + nx * hw, B.y + ny * hw], r: [B.x - nx * hw, B.y - ny * hw], t: [tip.x, tip.y] };
        };
        const he = head(P1, c[n - 1]);
        // Zone d'une pointe (un peu plus large qu'elle, contour compris) : drawPath y redessine la flèche par-dessus toutes les autres
        const zone = (B, h) => {
            const dx = h.t[0] - B.x, dy = h.t[1] - B.y, dl = Math.hypot(dx, dy) || 1, ux = dx / dl, uy = dy / dl, ex = (h.l[0] - h.r[0]) / (2 * hw || 1), ey = (h.l[1] - h.r[1]) / (2 * hw || 1), pad = 6;
            const q = [[h.l[0] + ex * pad - ux * 2, h.l[1] + ey * pad - uy * 2], [h.t[0] + ux * pad, h.t[1] + uy * pad], [h.r[0] - ex * pad - ux * 2, h.r[1] - ey * pad - uy * 2]];
            return q.map((v) => v[0].toFixed(1) + ',' + v[1].toFixed(1)).join(' ');
        };
        const heads = [zone(P1, he)];
        let all;
        if (both) {
            const hs = head(P0, c[0]);
            heads.push(zone(P0, hs));
            all = [hs.t, hs.l].concat(left, [he.l, he.t, he.r], right.reverse(), [hs.r]);
        } else {
            // bout arrondi : demi-cercle derrière le point de départ
            const a = c[0], b = c[Math.min(n - 1, 1)], tl = Math.hypot(b.x - a.x, b.y - a.y) || 1, tx = (b.x - a.x) / tl, ty = (b.y - a.y) / tl, cap = [];
            for (let k = 1; k < 8; k++) { const th = Math.PI * k / 8; cap.push([a.x + sw * (ty * Math.cos(th) - tx * Math.sin(th)), a.y + sw * (-tx * Math.cos(th) - ty * Math.sin(th))]); }
            all = left.concat([he.l, he.t, he.r], right.reverse(), cap);
        }
        const f = (q) => q[0].toFixed(1) + ' ' + q[1].toFixed(1);
        // points de contrôle des collisions : le contour, échantillonné tous les 3 px
        const pts = [];
        for (let i = 0; i < all.length; i++) {
            const p = all[i], q = all[(i + 1) % all.length], len = Math.hypot(q[0] - p[0], q[1] - p[1]), k = Math.max(1, Math.ceil(len / 3));
            for (let j = 0; j < k; j++) pts.push({ x: p[0] + (q[0] - p[0]) * j / k, y: p[1] + (q[1] - p[1]) * j / k });
        }
        return { d: 'M' + f(all[0]) + ' ' + all.slice(1).map((q) => 'L' + f(q)).join(' ') + ' Z', pts, L, heads };
    }
    // La police des accords (Kalam) se charge après la page : les largeurs mesurées avant son arrivée sont à refaire
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { fontW.clear(); arrowCache.clear(); drawPath(); }).catch(() => {});
    const arrowCache = new Map();
    let arrowSig = '';
    // Longueur (px) sur laquelle un chemin longe de très près d'autres flèches déjà placées (un croisement bref en vaut ~15)
    function overlapLen(center, placed) {
        let n = 0;
        for (const q of resample(center, 3)) {
            let hit = false;
            for (const pl of placed) { for (const r of pl) { const dx = q.x - r.x, dy = q.y - r.y; if (dx * dx + dy * dy < 49) { hit = true; break; } } if (hit) break; }
            if (hit) n++;
        }
        return n * 3;
    }
    // Forme { d, center } de la flèche de a vers b. `placed` : trajets des flèches déjà dessinées (échantillonnés) ; si la flèche en
    // longe une sur plus d'un croisement, on la recalcule en évitant ces trajets (un croisement court reste permis).
    function arrowD(a, b, both, placed) {
        const sig = JSON.stringify([S.labels, S.analysis, S.fr, S.spell, S.tonic, S.mode]);
        if (sig !== arrowSig) { arrowSig = sig; arrowCache.clear(); }
        const key = a.key + '|' + b.key + '|' + (both ? 2 : 1);
        let r = arrowCache.get(key);
        if (r === undefined) {
            try { r = computeArrow(a, b, both, null); } catch (e) { console.warn('Flèche :', e); r = null; }
            if (r === null) r = { d: arrowShape(a, b, both), center: [{ x: a.cx, y: a.cy }, { x: b.cx, y: b.cy }] };
            arrowCache.set(key, r);
        }
        if (placed && placed.length && overlapLen(r.center, placed) > 24) {
            try { const r2 = computeArrow(a, b, both, placed); if (r2) return r2; } catch (e) { console.warn('Flèche :', e); }
        }
        return r;
    }
    const pathLen = (c) => c.reduce((s, q, i) => s + (i ? Math.hypot(q.x - c[i - 1].x, q.y - c[i - 1].y) : 0), 0);
    function computeArrow(a, b, both, avoid) {
        const dist = Math.hypot(b.cx - a.cx, b.cy - a.cy);
        const MIN_L = 26;                      // une flèche plus courte n'est qu'une tache : on desserre alors la distance aux inscriptions
        let fallback = null;                   // meilleur chemin trouvé quand aucun n'est parfait
        for (const withNodes of [true, false]) {                      // d'abord en évitant aussi les cercles des notes, sinon seulement les inscriptions
            const { obs, box } = arrowObstacles(a, b, withNodes, 70);
            for (const clear of [7, 5, 3.5, 2.5, 1.5]) {
                const route = arrowRoute(a, b, obs, box, clear, avoid);
                if (!route) continue;
                let center = trimHooks(relaxRoute(route, obs, Math.max(2, clear - 0.5)));
                if (pathLen(center) < 45) {            // flèche courte (accords voisins) : un trait droit, sans crochet, s'il passe
                    const line = [center[0], center[center.length - 1]];
                    if (minClear(resample(line, 2), obs) >= Math.min(2, clear)) center = line;
                }
                const L = pathLen(center), mc = minClear(center, obs);
                if (mc < 1.2) continue;
                const turn = maxTurn(center);
                if (!fallback || (turn <= 0.3 ? 1 : 0) + L / 1000 > (fallback.smooth ? 1 : 0) + fallback.L / 1000) fallback = { center, L, smooth: turn <= 0.3 };
                if (L < MIN_L || turn > 0.3) continue;
                for (const [hl0, hw0] of ARROW_HEADS) {               // pointe de plus en plus petite jusqu'à ce qu'elle ne touche plus rien
                    const hl = Math.min(hl0, L * (both ? 0.3 : 0.5));
                    const r = ribbon(center, both, hl, Math.min(hw0, hl * 0.65));
                    if (minClear(r.pts, obs) >= 0.6) return { d: r.d, center, heads: r.heads };
                }
            }
        }
        if (fallback) {
            const hl = Math.min(ARROW_HEADS[1][0], fallback.L * (both ? 0.3 : 0.5));
            const r = ribbon(fallback.center, both, hl, Math.min(ARROW_HEADS[1][1], hl * 0.65));
            return { d: r.d, center: fallback.center, heads: r.heads };
        }
        // pas de passage : ruban droit entre les deux accords (comme avant, mais lisse)
        const ux = (b.cx - a.cx) / (dist || 1), uy = (b.cy - a.cy) / (dist || 1), trim = Math.max(13, Math.min(34, (dist - 50) / 2));
        const line = [{ x: a.cx + ux * trim, y: a.cy + uy * trim }, { x: b.cx - ux * trim, y: b.cy - uy * trim }];
        const L = dist - 2 * trim;
        const r = ribbon(line, both, Math.min(18, L * (both ? 0.3 : 0.5)), 9);
        return { d: r.d, center: line, heads: r.heads };
    }

    function drawPath() {
        const layer = $('arrowLayer');
        layer.textContent = '';
        const pts = R.inst.filter(Boolean);
        if (pts.length === 0) return;
        // Un passage A → B et un passage B → A (n'importe où dans la progression) ne font qu'une flèche à deux pointes ;
        // un passage répété dans le même sens n'est dessiné qu'une fois.
        const pairs = new Map();
        for (let k = 0; k + 1 < pts.length; k++) {
            const a = pts[k], b = pts[k + 1];
            if (a === b) continue;
            const fwd = a.key < b.key, key = fwd ? a.key + '|' + b.key : b.key + '|' + a.key;
            let e = pairs.get(key);
            if (!e) { e = { a, b, fwd: false, back: false }; pairs.set(key, e); }
            if (a === e.a) e.fwd = true; else e.back = true;
        }
        const placed = [];     // trajets des flèches déjà dessinées : les suivantes évitent de les longer (elles peuvent les croiser)
        const tips = [];       // pointes à redessiner par-dessus toutes les flèches
        for (const e of pairs.values()) {
            const r = arrowD(e.a, e.b, e.fwd && e.back, placed);
            el('path', { d: r.d, class: 'arrow' }, layer);
            placed.push(resample(r.center, 3));
            (r.heads || []).forEach((h) => tips.push({ d: r.d, h }));
        }
        // Là où deux flèches se chevauchent, la pointe de chacune passe toujours au-dessus de l'autre flèche :
        // on redessine chaque flèche, limitée à la zone de sa pointe, après toutes les autres.
        tips.forEach((o, i) => {
            const id = 'arrowtip' + i;
            el('polygon', { points: o.h }, el('clipPath', { id }, layer));
            el('path', { d: o.d, class: 'arrow', 'clip-path': 'url(#' + id + ')' }, layer);
        });
        const dot = startDot();
        el('circle', { cx: dot.x, cy: dot.y, r: dot.r, class: 'stepdot' }, layer);
        el('text', { x: dot.x, y: dot.y }, layer).textContent = '1';
    }

    // ------------------------------------------------------------------------------------------------------------------
    // Panneau d'information sous le réseau
    // ------------------------------------------------------------------------------------------------------------------
    // Nom de l'accord et notes, comme dans Chord Scales : un clic sur le nom joue l'accord en arpège, un clic sur une note la joue
    // (à la hauteur qu'elle a dans l'accord).
    const chordAbs = (root, id) => stackIntervalsUp(lookupChord(id).notes).map((iv) => mod(root) + iv);
    function playArpeggio(root, id) { playAbs(chordAbs(root, id), { roll: 0.17, dur: 1.5 }); }
    function chordHead(root, id) {
        const notes = chordPcs(root, id).map((pc, i) => `<button type="button" class="cnote" data-act="note" data-i="${i}" title="Jouer ${esc(nm(pc))}">${esc(nm(pc))}</button>`).join('');
        return `<div class="chordhead" data-root="${root}" data-id="${esc(id)}">
            <button type="button" class="cname" data-act="arp" title="Jouer l'accord en arpège">${esc(chordName(root, id))}</button>
            <span class="cnotes">${notes}</span></div>`;
    }
    // Clic sur le nom (arpège) ou sur une note de la fiche d'accord ; renvoie true si le clic a été traité
    function onHeadClick(b) {
        const act = b.dataset.act;
        if (act === 'solo') { if (R.note !== null) playNote(R.note); return true; }
        if (act !== 'arp' && act !== 'note') return false;
        const head = b.closest('.chordhead');
        const root = parseInt(head.dataset.root, 10), id = head.dataset.id;
        if (act === 'arp') playArpeggio(root, id);
        else playAbs([chordAbs(root, id)[parseInt(b.dataset.i, 10)]], { dur: 1.6 });
        return true;
    }
    function renderInfo() {
        const box = $('info');
        const playItem = R.playing >= 0 ? R.prog[R.playing] : null;
        const cur = current();
        if (playItem) {
            box.innerHTML = `${chordHead(playItem.r, playItem.id)}
                <div class="hint">Accord ${R.playing + 1} sur ${R.prog.length}</div>`;
            return;
        }
        if (cur && cur.kind === 'tri') {
            const t = cur.t, nb = neighbors(t);
            const btn = (op, label) => {
                let target = nb[op] ? triByKey(nb[op]) : null;
                if (!target) { const r = riemann(t, op); target = nearestInstance(r.root, r.minor, t); }
                return `<button type="button" class="btn small" data-act="nb" data-key="${target.key}" title="${label}"><b>${op}</b> → ${esc(chordName(target.root, triId(target)))}</button>`;
            };
            box.innerHTML = `${chordHead(t.root, cur.id)}
                <div class="trans" role="group" aria-label="Transformations">${btn('P', 'Parallèle : même fondamentale')}${btn('L', 'Sensible : la quinte monte ou la fondamentale descend d\'un demi-ton')}${btn('R', 'Relatif')}</div>`;
            return;
        }
        if (cur && cur.kind === 'custom') {
            const st = cbStateOfId(cur.id);
            box.innerHTML = `${chordHead(cur.root, cur.id)}
                <div class="hint">${esc(st ? cbFullName(st) : '')}</div>
                <div class="hint">Les triangles entourés sont les triades contenues dans cet accord.</div>`;
            return;
        }
        if (R.note !== null) {
            const n = R.note;
            const list = [[n, false], [mod(n - 4), false], [mod(n - 7), false], [n, true], [mod(n - 3), true], [mod(n - 7), true]];
            const btns = list.map(([r, m]) => {
                const t = nearestInstance(r, m, null);
                return `<button type="button" class="btn small" data-act="nb" data-key="${t.key}">${esc(chordName(r, m ? TRI_MIN : TRI_MAJ))}</button>`;
            }).join('');
            box.innerHTML = `<div class="chordhead"><button type="button" class="cname" data-act="solo" title="Jouer la note">${esc(nm(n))}</button></div>
                <div class="hint">Cette note revient à de nombreux endroits du réseau (un cercle plein par copie). Les triangles entourés la contiennent.</div>
                <div class="row tight"><span class="label">Accords qui la contiennent</span>${btns}</div>`;
            return;
        }
        box.innerHTML = `<div class="hint">Touchez un <b>triangle</b> pour entendre un accord et voir ses voisins P, L et R, ou une <b>note</b> (un cercle) pour la repérer partout dans le réseau.
            Construisez ensuite une progression avec les boutons sous le réseau.</div>`;
    }

    // ------------------------------------------------------------------------------------------------------------------
    // Progression
    // ------------------------------------------------------------------------------------------------------------------
    let band = null;

    function addCurrent() {
        const cur = current();
        if (!cur) return;
        addItem(cur.root, cur.id, cur.kind === 'tri' ? cur.t.key : null);
    }
    function addItem(root, id, tri) {
        const it = { r: root, id, m: 1 };
        if (tri) it.tri = tri;
        R.prog.push(it);
        R.progSel = R.prog.length - 1;
        progChanged();
    }
    // Toute modification de la progression passe par progChanged() : elle est enregistrée dans l'historique
    // (annuler / rétablir) si le contenu a vraiment changé, puis l'affichage est rafraîchi.
    function progChanged() {
        histRecord();
        progRefresh();
    }
    function progRefresh() {
        computeInstances();
        syncBandGrid();
        store.set('tonnetz.work', snapshot('travail'));
        renderChips();
        drawPath();
        paint();
        renderInfo();
        updateUndoButtons();
    }

    // ---- Demi-mesures ----
    // Une durée « ½ » (it.m === 0.5) partage une mesure entre deux accords : deux accords ½ consécutifs sont fusionnés en UN pas
    // d'une mesure portant un second accord (step.split, format de la Jam de Chord Scales : 1er accord sur la première moitié de
    // la mesure, 2e sur la seconde). Un ½ qui n'a pas de ½ voisin à sa suite reste seul et sonne comme une mesure entière.
    // Retourne : steps (pas de grille de l'orchestre / de l'export), chips[pas] = indices des accords du pas,
    // pairPos[i] = 'a' | 'b' (accord faisant partie d'une paire) et lone[i] = true (½ resté seul).
    function stepsOf(prog) {
        const steps = [], chips = [], pairPos = [], lone = [];
        const base = (it) => ({ rootIndex: it.r, chordId: it.id, scaleId: scaleOfChord(it.id, it.s) });
        for (let i = 0; i < prog.length; i++) {
            const it = prog[i], nx = prog[i + 1];
            if (it.m === 0.5 && nx && nx.m === 0.5) {
                const st = base(it); st.measures = 1;
                const b2 = base(nx); st.split = { rootIndex: b2.rootIndex, chordId: b2.chordId, scaleId: b2.scaleId };
                steps.push(st); chips.push([i, i + 1]);
                pairPos[i] = 'a'; pairPos[i + 1] = 'b';
                i++;
            } else {
                const st = base(it); st.measures = it.m === 0.5 ? 1 : it.m;
                steps.push(st); chips.push([i]);
                if (it.m === 0.5) lone[i] = true;
            }
        }
        return { steps, chips, pairPos, lone };
    }
    let STEPS = stepsOf([]);   // pas actuellement donnés à l'orchestre (mis à jour par syncBandGrid)

    // ---- Historique annuler / rétablir (la progression : accords, ordre, durées) ----
    // H.last = état courant sérialisé ; H.undo / H.redo = états précédents / suivants. Changer seulement
    // la sélection d'un accord n'est pas une modification. Limite de 100 étapes, comme dans Chord scales.
    const H = { undo: [], redo: [], last: '[]', limit: 100 };
    const progState = () => JSON.stringify(R.prog);
    function histReset() { H.undo = []; H.redo = []; H.last = progState(); updateUndoButtons(); }
    function histRecord() {
        const now = progState();
        if (now === H.last) return;
        H.undo.push(H.last);
        if (H.undo.length > H.limit) H.undo.shift();
        H.redo = [];
        H.last = now;
    }
    function histStep(from, to) {
        if (!from.length) return;
        to.push(H.last);
        if (to.length > H.limit) to.shift();
        const target = from.pop();
        const before = R.prog;
        R.prog = JSON.parse(target);
        H.last = target;
        // on sélectionne le premier accord touché par le changement
        let i = 0;
        while (i < before.length && i < R.prog.length && JSON.stringify(before[i]) === JSON.stringify(R.prog[i])) i++;
        R.progSel = R.prog.length ? Math.min(i, R.prog.length - 1) : null;
        progRefresh();
    }
    function undo() { histStep(H.undo, H.redo); }
    function redo() { histStep(H.redo, H.undo); }
    function updateUndoButtons() {
        const u = $('bUndo'), r = $('bRedo');
        if (u) u.disabled = !H.undo.length;
        if (r) r.disabled = !H.redo.length;
    }

    function chipClass(it) { return isMinorish(it.id) ? 'min' : 'maj'; }
    function renderChips() {
        const box = $('chips');
        const keepScroll = box.scrollTop;   // la zone défile au-delà de deux rangées : on garde la position au rafraîchissement
        box.textContent = '';
        if (!R.prog.length) {
            const e = document.createElement('div');
            e.className = 'empty';
            e.textContent = 'Touchez un triangle puis « Ajouter », ou activez « Saisie ».';
            box.appendChild(e);
        }
        const sp = stepsOf(R.prog);
        let pairBox = null;   // deux accords ½ = une mesure : ils sont regroupés et collés l'un à l'autre
        R.prog.forEach((it, i) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'chip ' + chipClass(it) + (i === R.progSel ? ' sel' : '') + (i === R.playing ? ' playing' : '') + (sp.lone[i] ? ' lone' : '');
            if (sp.lone[i]) b.title = 'Demi-mesure seule : elle sonne comme une mesure entière. Faites suivre cet accord d\'un autre accord de ½ pour partager la mesure.';
            b.dataset.i = i;
            const m = document.createElement('span'); m.className = 'm'; m.textContent = it.m === 0.5 ? '½' : (it.m > 1 ? '×' + it.m : '');
            const n = document.createElement('span'); n.className = 'n'; n.textContent = chordName(it.r, it.id);
            const r = document.createElement('span'); r.className = 'r'; r.textContent = S.analysis ? romanOf(it.r, it.id) : '';
            b.append(m, n, r);
            if (sp.pairPos[i] === 'a') { pairBox = document.createElement('div'); pairBox.className = 'pair'; box.appendChild(pairBox); }
            (pairBox && sp.pairPos[i] ? pairBox : box).appendChild(b);
            if (sp.pairPos[i] === 'b') pairBox = null;
        });
        // Défilement : position conservée, puis l'accord en lecture (sinon l'accord sélectionné) est ramené dans la zone visible
        box.scrollTop = keepScroll;
        const act = box.querySelector('.chip.playing') || box.querySelector('.chip.sel');
        if (act) {
            const a = act.getBoundingClientRect(), v = box.getBoundingClientRect();
            if (a.top < v.top) box.scrollTop -= (v.top - a.top) + 8;
            else if (a.bottom > v.bottom) box.scrollTop += (a.bottom - v.bottom) + 8;
        }
        // La rangée d'outils reste visible tant que la progression n'est pas vide (« Tout effacer » doit rester accessible) ;
        // les outils qui agissent sur l'accord sélectionné sont grisés quand aucun accord n'est sélectionné.
        const hasSel = R.progSel !== null && !!R.prog[R.progSel];
        $('chipTools').hidden = !R.prog.length;
        ['bLeft', 'bRight', 'bDup', 'bDel'].forEach((id) => { $(id).disabled = !hasSel; });
        const dur = hasSel ? R.prog[R.progSel].m : 1;
        $('durSeg').querySelectorAll('button').forEach((b) => {
            b.disabled = !hasSel;
            b.setAttribute('aria-pressed', String(hasSel && parseFloat(b.dataset.m) === dur));
        });
    }
    function selectItem(i) {
        const it = R.prog[i];
        if (!it) return;
        R.progSel = i;
        arrowsOnProg = true;
        const playing = band && band.isPlaying;
        if (it.id === TRI_MAJ || it.id === TRI_MIN) {
            const t = R.inst[i] || nearestInstance(it.r, it.id === TRI_MIN, null);
            clearSel(); R.sel = t.key;
        } else {
            clearSel(); R.custom = { root: it.r, id: it.id };
        }
        if (!playing) playChord(it.r, it.id);
        refreshSelection();
        renderChips();
        if (R.sel) ensureVisible(triByKey(R.sel));
    }

    function initProgressionUi() {
        $('chips').addEventListener('click', (e) => {
            const c = e.target.closest('.chip');
            if (c) selectItem(parseInt(c.dataset.i, 10));
        });
        $('bAdd').addEventListener('click', addCurrent);
        $('bEntry').addEventListener('click', () => { S.entry = !S.entry; saveSettings(); syncButtons(); });
        $('bLeft').addEventListener('click', () => moveItem(-1));
        $('bRight').addEventListener('click', () => moveItem(1));
        $('bDup').addEventListener('click', () => {
            const i = R.progSel; if (i === null) return;
            R.prog.splice(i + 1, 0, Object.assign({}, R.prog[i]));
            R.progSel = i + 1; progChanged();
        });
        $('bDel').addEventListener('click', removeSelected);
        $('bUndo').addEventListener('click', undo);
        $('bRedo').addEventListener('click', redo);
        // ⌘Z / Ctrl+Z annule, ⌘⇧Z / Ctrl+Maj+Z / Ctrl+Y rétablit — sauf dans un champ de texte (qui garde son propre historique)
        document.addEventListener('keydown', (e) => {
            if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
            const k = (e.key || '').toLowerCase();
            const isUndo = k === 'z' && !e.shiftKey;
            const isRedo = (k === 'z' && e.shiftKey) || (k === 'y' && e.ctrlKey && !e.metaKey);
            if (!isUndo && !isRedo) return;
            const t = e.target;
            const nonText = ['range', 'checkbox', 'radio', 'button', 'file'];
            if (t && (t.isContentEditable || t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !nonText.includes(t.type)))) return;
            e.preventDefault();
            if (isUndo) undo(); else redo();
        });
        $('bClear').addEventListener('click', () => {
            if (band && band.isPlaying) band.stop();
            R.prog = []; R.progSel = null; progChanged();
        });
        const seg = $('durSeg');
        [0.5, 1, 2, 3, 4, 8].forEach((m) => {
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'btn small'; b.dataset.m = m; b.textContent = m === 0.5 ? '½' : m;
            if (m === 0.5) b.title = 'Demi-mesure : deux accords de ½ à la suite se partagent une mesure';
            b.addEventListener('click', () => {
                if (R.progSel === null || !R.prog[R.progSel]) return;
                R.prog[R.progSel].m = m; progChanged();
            });
            seg.appendChild(b);
        });
    }
    function moveItem(dir) {
        const i = R.progSel, j = i + dir;
        if (i === null || j < 0 || j >= R.prog.length) return;
        [R.prog[i], R.prog[j]] = [R.prog[j], R.prog[i]];
        R.progSel = j; progChanged();
    }
    function removeSelected() {
        const i = R.progSel; if (i === null) return;
        R.prog.splice(i, 1);
        R.progSel = R.prog.length ? Math.min(i, R.prog.length - 1) : null;
        progChanged();
    }

    // ------------------------------------------------------------------------------------------------------------------
    // Enregistrement, export, import
    // ------------------------------------------------------------------------------------------------------------------
    // Gamme d'un accord : celle de la grille importée, sinon sa gamme principale du catalogue
    function scaleOfChord(id, s) {
        if (s) return s;
        const o = lookupChord(id);
        return (o && o.scales && o.scales[0]) ? o.scales[0].id : 'ionian';
    }
    function snapshot(name) {
        return {
            tonnetz: 1, name,
            items: R.prog.map((it) => { const o = { r: it.r, id: it.id, m: it.m }; if (it.tri) o.tri = it.tri; if (it.s) o.s = it.s; return o; }),
            bpm: S.bpm, style: S.style, meter: S.meter, tonic: S.tonic, mode: S.mode
        };
    }
    function validItems(items) {
        if (!Array.isArray(items)) return [];
        // durée en mesures : entier de 1 à 16, ou 0,5 (demi-mesure partagée avec l'accord voisin)
        const dur = (v) => (parseFloat(v) === 0.5 ? 0.5 : Math.max(1, Math.min(16, parseInt(v, 10) || 1)));
        return items.filter((o) => o && Number.isInteger(o.r) && o.r >= 0 && o.r < 12 && typeof o.id === 'string' && lookupChord(o.id))
            .map((o) => { const it = { r: o.r, id: o.id, m: dur(o.m) }; if (typeof o.tri === 'string') it.tri = o.tri; if (typeof o.s === 'string') it.s = o.s; return it; });
    }
    const STYLES = ['classic', 'swing', 'pop', 'latin', 'cuba', 'brass', 'balkan', 'piazzolla', 'milongalyrique'];
    const METERS = ['4/4', '3/4', '2/4', '6/8', '9/8', '12/8'];
    function loadSnapshot(o) {
        if (band && band.isPlaying) band.stop();
        R.prog = validItems(o.items);
        R.progSel = null;
        if (Number.isFinite(o.bpm)) S.bpm = Math.max(40, Math.min(220, Math.round(o.bpm)));
        if (STYLES.includes(o.style)) S.style = o.style;
        if (METERS.includes(o.meter)) S.meter = o.meter;
        if (Number.isInteger(o.tonic) && o.tonic >= 0 && o.tonic < 12) S.tonic = o.tonic;
        if (o.mode === 'maj' || o.mode === 'min') S.mode = o.mode;
        if (o.vols) ['piano', 'bass', 'drums'].forEach((k) => { if (Number.isFinite(o.vols[k])) S.vols[k] = Math.max(0, Math.min(100, Math.round(o.vols[k]))); });
        if (Number.isFinite(o.reverb)) S.reverb = Math.max(0, Math.min(100, Math.round(o.reverb)));
        saveSettings();
        syncControls();
        applyBandSettings();
        progChanged();
        refreshAll();
    }
    const savesList = () => store.get('tonnetz.saves', []);
    function renderSaves() {
        const box = $('saves');
        box.textContent = '';
        const list = savesList();
        if (!list.length) {
            const e = document.createElement('div'); e.className = 'hint'; e.textContent = 'Aucune progression enregistrée.';
            box.appendChild(e);
        }
        list.forEach((s, i) => {
            const row = document.createElement('div'); row.className = 'saveitem';
            const nmEl = document.createElement('button');
            nmEl.type = 'button'; nmEl.className = 'btn ghost small nm'; nmEl.style.textAlign = 'left';
            nmEl.textContent = s.name || 'Sans nom';
            nmEl.title = 'Charger';
            nmEl.addEventListener('click', () => { $('saveName').value = s.name || ''; loadSnapshot(s); });
            const meta = document.createElement('span'); meta.className = 'meta';
            const nAcc = s.items ? s.items.length : 0;
            meta.textContent = nAcc + (nAcc > 1 ? ' accords' : ' accord');
            const del = document.createElement('button');
            del.type = 'button'; del.className = 'btn small sq ghost'; del.textContent = '✕'; del.title = 'Supprimer'; del.setAttribute('aria-label', 'Supprimer');
            del.addEventListener('click', () => { const l = savesList(); l.splice(i, 1); store.set('tonnetz.saves', l); renderSaves(); });
            row.append(nmEl, meta, del);
            box.appendChild(row);
        });
    }
    function downloadJson(obj, filename) {
        const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
    // Grille au format de la Jam de Chord Scales (« chord-scales-jam-grid ») : tonalité, qualité, tempo, mesure, orchestration (volumes de 0 à 1)
    // et une case par accord { rootIndex, chordId, measures, scaleId }.
    function chordScalesGrid(name) {
        const keyName = NAMES.en[useFlats() ? 'f' : 's'][S.tonic].replace('♭', 'b').replace('♯', '#');
        return {
            format: 'chord-scales-jam-grid', version: 1, name,
            keyName, key: S.tonic, quality: S.mode === 'min' ? 'aeolian' : 'ionian', spell: useFlats() ? 'ffsff' : 'sfsff',
            bpm: S.bpm, timeSignature: S.meter,
            orchestration: {
                mode: S.style === 'classic' ? 'arpeges' : 'orchestra', style: S.style,
                volumes: { piano: S.vols.piano / 100, bass: S.vols.bass / 100, drums: S.vols.drums / 100, bandoneon: 0.7, violin: 0.6, guitar: 0.5 },
                reverb: S.reverb / 100
            },
            grid: stepsOf(R.prog).steps   // deux accords ½ → une mesure avec « split », comme dans Chord scales
        };
    }
    // Grille Chord Scales → progression Gym Tonnetz. Adaptations : reprises (|: :| et 1re / 2e fin) déroulées ; mesure partagée entre deux
    // accords → deux accords d'une mesure ; basses d'accord, parties, fonctions et modulations ignorées ; qualité modale → majeur ou mineur.
    const MAJOR_QUALITIES = ['ionian', 'lydian', 'mixolydian'];
    function unrollRepeats(grid) {
        const out = [];
        let i = 0, unrolled = false;
        while (i < grid.length) {
            let re = -1;
            for (let k = i; k < grid.length; k++) if (grid[k] && grid[k].repeatEnd) { re = k; break; }
            if (re < 0) { out.push(...grid.slice(i)); break; }
            let rs = i;
            for (let k = i; k <= re; k++) if (grid[k] && grid[k].repeatStart) rs = k;
            let v1 = -1;
            for (let k = rs; k <= re; k++) if (grid[k] && grid[k].volta === 1) { v1 = k; break; }
            const n = Math.max(2, Math.min(8, parseInt(grid[re].repeatEnd, 10) || 2));
            out.push(...grid.slice(i, rs));
            for (let pass = 1; pass <= n; pass++) {
                out.push(...grid.slice(rs, v1 < 0 ? re + 1 : v1));
                if (v1 >= 0 && pass < n) out.push(...grid.slice(v1, re + 1));
            }
            unrolled = true;
            i = re + 1;
        }
        return { seq: out, unrolled };
    }
    function fromChordScales(o) {
        const { seq, unrolled } = unrollRepeats(o.grid);
        const items = [];
        let splits = false;
        seq.forEach((g) => {
            if (!g) return;
            if (g.split && (g.measures || 1) === 1) {   // mesure partagée entre deux accords → deux accords de ½ mesure
                splits = true;
                items.push({ r: g.rootIndex, id: g.chordId, m: 0.5, s: g.scaleId });
                items.push({ r: g.split.rootIndex, id: g.split.chordId, m: 0.5, s: g.split.scaleId });
                return;
            }
            items.push({ r: g.rootIndex, id: g.chordId, m: g.measures || 1, s: g.scaleId });
            if (g.split) { splits = true; items.push({ r: g.split.rootIndex, id: g.split.chordId, m: 1, s: g.split.scaleId }); }
        });
        const orch = o.orchestration || {}, vol = orch.volumes || {};
        const pct = (x) => (Number.isFinite(x) ? (x <= 1 ? x * 100 : x) : undefined);
        const notes = [];
        if (unrolled) notes.push('reprises déroulées');
        if (splits) notes.push('demi-mesures en deux accords');
        return {
            snap: {
                name: o.name, items, bpm: o.bpm, meter: o.timeSignature,
                tonic: Number.isInteger(o.key) ? o.key : undefined,
                mode: o.quality ? (MAJOR_QUALITIES.includes(o.quality) ? 'maj' : 'min') : undefined,
                style: orch.mode === 'arpeges' ? 'classic' : orch.style,
                vols: { piano: pct(vol.piano), bass: pct(vol.bass), drums: pct(vol.drums) }, reverb: pct(orch.reverb)
            },
            notes
        };
    }
    function initSaves() {
        $('bSave').addEventListener('click', () => {
            if (!R.prog.length) { setStatus('Rien à enregistrer : la progression est vide.'); return; }
            const name = $('saveName').value.trim() || ('Progression ' + (savesList().length + 1));
            const list = savesList();
            const snap = snapshot(name);
            const at = list.findIndex((s) => s.name === name);
            if (at >= 0) list[at] = snap; else list.push(snap);
            store.set('tonnetz.saves', list);
            $('saveName').value = name;
            renderSaves();
            setStatus('« ' + name + ' » enregistrée.');
        });
        // Export : un menu propose le fichier Tonnetz ou une grille au format de la Jam de Chord Scales
        const menu = $('exportMenu'), bExp = $('bExport');
        const showMenu = (on) => { menu.hidden = !on; bExp.setAttribute('aria-expanded', String(on)); };
        bExp.addEventListener('click', (e) => { e.stopPropagation(); showMenu(menu.hidden); });
        document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) showMenu(false); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') showMenu(false); });
        menu.addEventListener('click', (e) => {
            const b = e.target.closest('button[data-fmt]');
            if (!b) return;
            showMenu(false);
            if (!R.prog.length) { setStatus('Rien à exporter : la progression est vide.'); return; }
            const name = $('saveName').value.trim() || 'progression';
            const cs = b.dataset.fmt === 'chordscales';
            downloadJson(cs ? chordScalesGrid(name) : snapshot(name), name.replace(/[^\w\-]+/g, '_') + (cs ? '.grille.json' : '.tonnetz.json'));
            setStatus(cs ? 'Grille Chord Scales exportée.' : 'Fichier Tonnetz exporté.');
        });
        $('bImport').addEventListener('click', () => $('fileImport').click());
        $('fileImport').addEventListener('change', (e) => {
            const f = e.target.files && e.target.files[0];
            if (!f) return;
            const rd = new FileReader();
            rd.onload = () => {
                try {
                    let o = JSON.parse(rd.result), adapted = [];
                    if (o && o.format === 'chord-scales-jam-grid' && Array.isArray(o.grid)) {      // grille de la Jam de Chord Scales
                        const c = fromChordScales(o);
                        o = c.snap; adapted = c.notes;
                    }
                    if (!o || !Array.isArray(o.items) || !validItems(o.items).length) throw new Error('vide');
                    $('saveName').value = o.name || '';
                    loadSnapshot(o);
                    setStatus('Progression importée' + (adapted.length ? ' (' + adapted.join(', ') + ')' : '') + '.');
                } catch (err) { setStatus('Ce fichier n\'est ni une progression Gym Tonnetz ni une grille Chord Scales valide.'); }
            };
            rd.readAsText(f);
            e.target.value = '';
        });
    }

    // ------------------------------------------------------------------------------------------------------------------
    // Orchestre : lecture de la progression
    // ------------------------------------------------------------------------------------------------------------------
    function setStatus(msg) { $('status').textContent = msg || ''; }

    function meterParts() {
        const [n, d] = S.meter.split('/').map(Number);
        const ternary = d === 8;
        return { bpb: ternary ? n / 3 : n, ternary };
    }
    function getBand() {
        if (!hasBand) return null;
        if (!band) {
            band = new TonnetzBand(App);
            band.onBeat = onBeat;
            band.onStop = onStop;
            applyBandSettings();
        }
        return band;
    }
    function applyBandSettings() {
        if (!band) return;
        band.bpm = S.bpm;
        band.loopEnabled = S.loop;
        const { bpb, ternary } = meterParts();
        const changed = band.beatsPerBar !== bpb || band.ternary !== ternary;
        band.beatsPerBar = bpb; band.ternary = ternary;
        if (changed && typeof bandMeterResetState === 'function') Object.assign(band, bandMeterResetState());
        if (band._tnStyle !== S.style) { band._tnStyle = S.style; band.chooseBandStyle(S.style); }
        ['piano', 'bass', 'drums'].forEach((k) => band.setBandVolume(k, S.vols[k]));
        band.setBandMaster(S.master);
        band.setBandReverb(S.reverb);
        updateMixerLabels();
    }
    function syncBandGrid() {
        STEPS = stepsOf(R.prog);
        if (!band) return;
        band.grid = STEPS.steps;
        if (band.currentStepIndex >= band.grid.length) { band.currentStepIndex = 0; band.currentBeat = 0; }
    }

    function togglePlay() {
        const b = getBand();
        if (!b) { setStatus('Les orchestres sont indisponibles : le dossier app/ est incomplet.'); return; }
        if (b.isPlaying) { b.stop(); return; }
        if (!R.prog.length) { setStatus('Ajoutez d\'abord au moins un accord à la progression.'); return; }
        if (!ensureCtx()) { setStatus('Le son n\'est pas disponible dans ce navigateur.'); return; }
        stopTap();
        applyBandSettings();
        syncBandGrid();
        R.playing = -1;
        b.start(0);
        syncButtons();
        watchLoading();
    }
    let loadTimer = null;
    function watchLoading() {
        clearInterval(loadTimer);
        const check = () => {
            if (!band || !band.isPlaying) { clearInterval(loadTimer); setStatus(''); return; }
            if (!band.bandPianoInstrument && !App.pianoInstrument) setStatus('Chargement des instruments…');
            else { setStatus(''); clearInterval(loadTimer); }
        };
        check();
        if (band && band.isPlaying) loadTimer = setInterval(check, 400);
    }
    function onBeat(ev) {
        // ev.stepIdx est un pas de l'orchestre : une mesure à deux accords (deux ½) = un pas ; on retrouve l'accord qui sonne
        const ch = STEPS.chips[ev.stepIdx] || [];
        const half = ch.length > 1 && (ev.beat % ev.bpb) >= band.getSplitBeat() ? 1 : 0;
        const pi = ch.length ? ch[half] : ev.stepIdx;
        const changed = R.playing !== pi;
        R.playing = pi;
        const bars = Math.round(ev.total / ev.bpb);
        $('counter').textContent = `Mesure ${ev.measure + 1}/${bars}`;
        if (changed) {
            renderChips();
            paint();
            renderInfo();
            ensureVisible(R.inst[pi]);       // le réseau suit l'accord joué s'il sort de l'écran
            const chip = $('chips').querySelector('.chip.playing');
            if (chip && chip.scrollIntoView) { try { chip.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {} }
        }
    }
    function onStop() {
        R.playing = -1;
        $('counter').textContent = '';
        setStatus('');
        renderChips(); paint(); renderInfo(); syncButtons();
    }

    function updateMixerLabels() {
        const l = { piano: 'Piano', bass: 'Basse', drums: 'Batterie' };
        if (S.style === 'latin') l.piano = 'Guitare';
        if (S.style === 'brass') { l.piano = 'Cuivres'; l.bass = 'Tubas'; l.drums = 'Percus.'; }
        if (S.style === 'balkan') { l.piano = 'Accordéon'; l.drums = 'Percus.'; }
        if (S.style === 'piazzolla' || S.style === 'milongalyrique') { l.bass = 'Contreb.'; l.drums = 'Percus.'; }
        if (S.style === 'classic') l.piano = 'Piano';
        ['piano', 'bass', 'drums'].forEach((k) => { const e = $('mixl-' + k); if (e) e.textContent = l[k]; });
    }
    function initOrchestraUi() {
        const mix = $('mixer');
        const row = (id, label, val, onInput) => {
            const l = document.createElement('span'); l.id = 'mixl-' + id; l.textContent = label;
            const r = document.createElement('input'); r.type = 'range'; r.min = 0; r.max = 100; r.value = val; r.id = 'mix-' + id;
            const v = document.createElement('span'); v.className = 'v'; v.textContent = val;
            r.addEventListener('input', () => { v.textContent = r.value; onInput(parseInt(r.value, 10)); saveSettings(); });
            mix.append(l, r, v);
        };
        row('piano', 'Piano', S.vols.piano, (v) => { S.vols.piano = v; if (band) band.setBandVolume('piano', v); });
        row('bass', 'Basse', S.vols.bass, (v) => { S.vols.bass = v; if (band) band.setBandVolume('bass', v); });
        row('drums', 'Batterie', S.vols.drums, (v) => { S.vols.drums = v; if (band) band.setBandVolume('drums', v); });
        row('reverb', 'Réverbération', S.reverb, (v) => { S.reverb = v; if (band) band.setBandReverb(v); });
        row('master', 'Master', S.master, (v) => { S.master = v; if (band) band.setBandMaster(v); });

        $('selStyle').addEventListener('change', (e) => {
            S.style = e.target.value; saveSettings();
            if (band) applyBandSettings(); else updateMixerLabels();
        });
        $('selMeter').addEventListener('change', (e) => { S.meter = e.target.value; saveSettings(); if (band) applyBandSettings(); });
        $('rBpm').addEventListener('input', (e) => {
            S.bpm = parseInt(e.target.value, 10); $('bpmVal').textContent = S.bpm + ' bpm';
            if (band) band.bpm = S.bpm;
            saveSettings();
        });
        $('bLoop').addEventListener('click', () => { S.loop = !S.loop; if (band) band.loopEnabled = S.loop; saveSettings(); syncButtons(); });
        $('bPlay').addEventListener('click', togglePlay);
        if (!hasBand) { $('bPlay').disabled = true; $('selStyle').disabled = true; $('selMeter').disabled = true; }
    }

    // ------------------------------------------------------------------------------------------------------------------
    // Accords personnalisés
    // ------------------------------------------------------------------------------------------------------------------
    const CU = { root: 0, third: 'M', fifth: 'P', sev: '', ext: [] };
    const customList = () => store.get('tonnetz.chords', []);

    function cuState() { return cbNormalize({ third: CU.third, fifth: CU.fifth, sev: CU.sev, ext: CU.ext }); }
    function cuApply(sel) {
        const st = cuState();
        CU.third = st.third; CU.fifth = st.fifth; CU.sev = st.sev; CU.ext = st.ext;
        const id = cbId(st);
        if (sel !== false) { R.progSel = null; selectCustom(CU.root, id, { play: sel === 'play' }); }
        renderCustomUi();
    }
    function mkSegButtons(boxId, items, getVal, setVal) {
        const box = $(boxId);
        box.textContent = '';
        items.forEach(([val, label]) => {
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'btn small'; b.textContent = label; b.dataset.v = val;
            b.addEventListener('click', () => { setVal(val); cuApply('play'); });
            box.appendChild(b);
        });
        return () => box.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(String(getVal()) === b.dataset.v)));
    }
    let cuSync = [];
    function initCustomUi() {
        const rootBox = $('cuRoot');
        for (let pc = 0; pc < 12; pc++) {
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'btn small'; b.dataset.pc = pc;
            b.addEventListener('click', () => { CU.root = pc; cuApply('play'); });
            rootBox.appendChild(b);
        }
        cuSync.push(mkSegButtons('cuThird', [['M', 'Majeure'], ['m', 'mineure'], ['sus4', 'sus4'], ['sus2', 'sus2']], () => CU.third, (v) => { CU.third = v; }));
        cuSync.push(mkSegButtons('cuFifth', [['P', 'Juste'], ['b5', '♭5'], ['s5', '♯5']], () => CU.fifth, (v) => { CU.fifth = v; }));
        cuSync.push(mkSegButtons('cuSev', [['', 'Aucune'], ['6', '6'], ['b7', '♭7'], ['M7', 'Δ7'], ['bb7', '°7']], () => CU.sev, (v) => { CU.sev = v; }));
        const ext = $('cuExt');
        CB_EXT_ORDER.forEach((k) => {
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'btn small'; b.dataset.k = k; b.textContent = CB_EXT_LABEL[k];
            b.addEventListener('click', () => {
                CU.ext = CU.ext.includes(k) ? CU.ext.filter((x) => x !== k) : CU.ext.concat(k);
                cuApply('play');
            });
            ext.appendChild(b);
        });
        $('cuPlay').addEventListener('click', () => { const id = cbId(cuState()); playChord(CU.root, id); });
        $('cuAdd').addEventListener('click', () => { const id = cbId(cuState()); addItem(CU.root, id, null); });
        $('cuSave').addEventListener('click', () => {
            const id = cbId(cuState());
            const list = customList();
            if (!list.some((c) => c.root === CU.root && c.id === id)) { list.push({ root: CU.root, id }); store.set('tonnetz.chords', list); }
            renderCustomUi();
        });
        renderCustomUi();
    }
    function renderCustomUi() {
        const st = cuState();
        const id = cbId(st);
        $('cuRoot').querySelectorAll('button').forEach((b) => {
            const pc = parseInt(b.dataset.pc, 10);
            b.textContent = nm(pc);
            b.setAttribute('aria-pressed', String(pc === CU.root));
        });
        cuSync.forEach((f) => f());
        $('cuExt').querySelectorAll('button').forEach((b) => {
            b.setAttribute('aria-pressed', String(st.ext.includes(b.dataset.k)));
        });
        const lc = lookupChord(id);
        $('cuPreview').innerHTML = `${chordHead(CU.root, id)}
            <div class="hint">${esc(cbFullName(st))}${lc ? '' : ''}</div>`;
        $('cuSum').textContent = chordName(CU.root, id);
        const box = $('cuList');
        box.textContent = '';
        const list = customList();
        if (!list.length) {
            const e = document.createElement('span'); e.className = 'hint'; e.textContent = 'Aucun accord enregistré.';
            box.appendChild(e);
        }
        list.forEach((c, i) => {
            const wrap = document.createElement('span'); wrap.className = 'seg';
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'btn small'; b.textContent = chordName(c.root, c.id);
            b.addEventListener('click', () => {
                const s = cbStateOfId(c.id);
                if (!s) return;
                CU.root = c.root; CU.third = s.third; CU.fifth = s.fifth; CU.sev = s.sev; CU.ext = s.ext.slice();
                cuApply('play');
            });
            const x = document.createElement('button');
            x.type = 'button'; x.className = 'btn small'; x.textContent = '✕'; x.title = 'Supprimer'; x.setAttribute('aria-label', 'Supprimer');
            x.addEventListener('click', () => { const l = customList(); l.splice(i, 1); store.set('tonnetz.chords', l); renderCustomUi(); });
            wrap.append(b, x);
            box.appendChild(wrap);
        });
    }

    // ------------------------------------------------------------------------------------------------------------------
    // Barre d'outils, analyse, rafraîchissements
    // ------------------------------------------------------------------------------------------------------------------
    function syncButtons() {
        $('bNames').textContent = S.fr ? 'Do Ré Mi' : 'C D E';
        $('bSpell').textContent = S.spell === 'auto' ? '♯♭ auto' : (S.spell === 's' ? '♯ dièses' : '♭ bémols');
        $('bLabels').setAttribute('aria-pressed', String(S.labels));
        $('bSound').setAttribute('aria-pressed', String(S.sound));
        $('bAnalysis').setAttribute('aria-pressed', String(S.analysis));
        $('bEntry').setAttribute('aria-pressed', String(S.entry));
        $('bLoop').setAttribute('aria-pressed', String(S.loop));
        const playing = !!(band && band.isPlaying);
        $('bPlay').textContent = playing ? '■ Arrêter' : '▶ Lire';
        $('bPlay').classList.toggle('on', playing);
    }
    function syncControls() {
        $('selStyle').value = S.style;
        $('selMeter').value = S.meter;
        $('rBpm').value = S.bpm;
        $('bpmVal').textContent = S.bpm + ' bpm';
        document.querySelectorAll('#pAnalysis [data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === S.mode)));
        ['piano', 'bass', 'drums', 'reverb', 'master'].forEach((k) => {
            const r = $('mix-' + k);
            if (r) { r.value = (k in S.vols) ? S.vols[k] : S[k]; if (r.nextSibling) r.nextSibling.textContent = r.value; }
        });
        syncButtons();
        updateMixerLabels();
    }
    function renderAnalysisUi() {
        document.querySelectorAll('#tonicKeys button').forEach((b) => {
            const pc = parseInt(b.dataset.pc, 10);
            b.textContent = nm(pc);
            b.setAttribute('aria-pressed', String(pc === S.tonic));
        });
        document.querySelectorAll('#pAnalysis [data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === S.mode)));
        $('anSum').textContent = nm(S.tonic) + (S.mode === 'maj' ? ' majeur' : ' mineur');
    }
    function initToolbar() {
        $('bDeselect').addEventListener('click', () => { clearSel(); R.progSel = null; arrowsOnProg = false; refreshSelection(); });
        $('bNames').addEventListener('click', () => { S.fr = !S.fr; saveSettings(); refreshAll(); });
        $('bSpell').addEventListener('click', () => { S.spell = S.spell === 'auto' ? 's' : (S.spell === 's' ? 'f' : 'auto'); saveSettings(); refreshAll(); });
        $('bLabels').addEventListener('click', () => { S.labels = !S.labels; saveSettings(); refreshAll(); });
        $('bSound').addEventListener('click', () => { S.sound = !S.sound; if (!S.sound) stopTap(); saveSettings(); syncButtons(); });
        $('bAnalysis').addEventListener('click', () => { S.analysis = !S.analysis; saveSettings(); refreshAll(); });
        const keys = $('tonicKeys');
        for (let pc = 0; pc < 12; pc++) {
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'btn small'; b.dataset.pc = pc;
            b.addEventListener('click', () => { S.tonic = pc; saveSettings(); refreshAll(); });
            keys.appendChild(b);
        }
        document.querySelectorAll('#pAnalysis [data-mode]').forEach((b) => {
            b.addEventListener('click', () => { S.mode = b.dataset.mode; saveSettings(); refreshAll(); });
        });
        $('cuPreview').addEventListener('click', (e) => { const b = e.target.closest('button[data-act]'); if (b) onHeadClick(b); });
        $('info').addEventListener('click', (e) => {
            const b = e.target.closest('button[data-act]');
            if (!b) return;
            if (onHeadClick(b)) return;
            if (b.dataset.act === 'nb') { R.progSel = S.entry ? null : progIndexFor(b.dataset.key); selectTri(b.dataset.key); renderChips(); ensureVisible(triByKey(b.dataset.key)); if (S.entry) addCurrent(); }
        });
        document.addEventListener('keydown', (e) => {
            const tag = (e.target && e.target.tagName) || '';
            if (/INPUT|SELECT|TEXTAREA/.test(tag) || e.metaKey || e.ctrlKey || e.altKey) return;
            if (/^Arrow(Left|Right|Up|Down)$/.test(e.key) && !(e.target.closest && e.target.closest('#colorPop'))) {
                const dir = e.key.slice(5).toLowerCase();
                // Juste après le choix d'un accord de la progression, ← / → passent à l'accord précédent / suivant (sans boucler)
                if (arrowsOnProg && !e.shiftKey && (dir === 'left' || dir === 'right') && R.progSel !== null && R.prog[R.progSel]) {
                    e.preventDefault();
                    const j = R.progSel + (dir === 'left' ? -1 : 1);
                    if (j >= 0 && j < R.prog.length) selectItem(j);
                    return;
                }
                e.preventDefault();
                if (e.shiftKey) panBy(dir); else moveOnBoard(dir);
                return;
            }
            // Entrée : ajoute à la progression le triangle sélectionné dans le réseau (sauf si un bouton ou un lien a le focus : Entrée l'active)
            if (e.key === 'Enter' && R.sel && !/^(BUTTON|A|SUMMARY)$/.test(tag) && !(e.target.closest && e.target.closest('#colorPop'))) { e.preventDefault(); addCurrent(); return; }
            if (e.key === ' ' && tag !== 'BUTTON') { e.preventDefault(); togglePlay(); }
            else if ((e.key === 'Delete' || e.key === 'Backspace') && R.progSel !== null && tag !== 'BUTTON') { e.preventDefault(); removeSelected(); }
            else if (e.key === '+' || e.key === '=') $('bZoomIn').click();
            else if (e.key === '-') $('bZoomOut').click();
            else if (e.key === 'f' || e.key === 'F') $('bFull').click();
        });
    }

    function refreshSelection() { paint(); renderInfo(); renderChips(); }
    function refreshAll() {
        drawPath();          // les flèches contournent les inscriptions : elles suivent noms, chiffrage et orthographe
        syncButtons();
        renderAnalysisUi();
        renderCustomUi();
        renderChips();
        paint();
        renderInfo();
    }

    // ------------------------------------------------------------------------------------------------------------------
    // Démarrage
    // ------------------------------------------------------------------------------------------------------------------
    if (window.TonnetzColors) TonnetzColors.init({ button: $('bTheme') });
    initZoom();
    initFullscreen();
    initToolbar();
    initProgressionUi();
    initOrchestraUi();
    initSaves();
    initCustomUi();
    if (!hasBand) setStatus('Orchestres indisponibles : vérifiez que le dossier app/ est à côté de index.html.');
    syncControls();

    const work = store.get('tonnetz.work', null);
    if (work && Array.isArray(work.items)) R.prog = validItems(work.items);
    histReset();   // l'historique annuler / rétablir part de la progression retrouvée au démarrage
    computeInstances();
    { const first = R.inst.find(Boolean); if (first && boardW) centerOn(first.cx, first.cy, baseZoom(), false); }   // la vue démarre sur la progression gardée
    drawPath();
    renderSaves();
    refreshAll();

    // utile aux tests automatiques
    window.TONNETZ_DEBUG = { S, R, get band() { return band; }, App, tris, nodes: nodeCache, view, vis, triByKey, nearestInstance };
})();
