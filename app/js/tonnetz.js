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
        fr: true, spell: 'auto', labels: true, sound: true, analysis: true, dim: true,
        tonic: 0, mode: 'maj', dimV: 2,
        style: 'swing', bpm: 100, meter: '4/4', loop: true, entry: false,
        master: 50, reverb: 25, vols: { piano: 50, bass: 85, drums: 25 }
    };
    const S = Object.assign({}, DEFAULTS, store.get('tonnetz.settings', {}));
    S.vols = Object.assign({}, DEFAULTS.vols, S.vols || {});
    // L'atténuation du hors-tonalité est active par défaut et ne dépend plus du chiffrage romain : une seule fois, on la rallume
    if (!((store.get('tonnetz.settings', {}) || {}).dimV >= 2)) { S.dim = true; S.dimV = 2; }
    const saveSettings = () => store.set('tonnetz.settings', S);

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
    const FN = {
        maj: { 0: 'T', 2: 'SD', 4: 'T', 5: 'SD', 7: 'D', 9: 'T', 11: 'D' },
        min: { 0: 'T', 2: 'SD', 3: 'T', 5: 'SD', 7: 'D', 8: 'SD', 10: 'D' }
    };
    const FN_LABEL = { T: 'Tonique', SD: 'Sous-dominante', D: 'Dominante' };

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
    function degreeNumeral(d) {
        const kind = DIA[S.mode][d];
        if (!kind) return null;
        const base = DEG[d];
        return (kind === 'm' || kind === 'dim') ? lowerRoman(base) + (kind === 'dim' ? '°' : '') : base;
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
    function fnLabel(root, id) {
        const info = chordInfo(id);
        if (!info) return '';
        const d = mod(root - S.tonic);
        if (isInKey(root, id)) return FN_LABEL[FN[S.mode][d]] || '';
        if (info.fam === 'dom') {
            const target = degreeNumeral(mod(d + 5));
            return target ? 'Dominante secondaire de ' + target : 'Dominante hors tonalité';
        }
        return 'Hors tonalité (emprunt)';
    }

    // ------------------------------------------------------------------------------------------------------------------
    // Audio : écoute des notes et accords touchés ; l'orchestre (tonnetz-band.js) partage le même contexte audio
    // ------------------------------------------------------------------------------------------------------------------
    const App = { audioCtx: null, pianoInstrument: null, _pianoPromise: null, activeAudioNodes: [], reverbInput: null };

    function ensureCtx() {
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
    // flèche des segments du chemin
    const defs = el('defs', {}, svg);
    const marker = el('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: '8', refY: '5', markerWidth: '6', markerHeight: '6', orient: 'auto-start-reverse' }, defs);
    const arrow = el('path', { d: 'M1 1 L9 5 L1 9 z' }, marker);
    arrow.style.fill = 'var(--path)';
    arrow.style.stroke = 'var(--gbg)';
    arrow.style.strokeWidth = '1.5';
    arrow.style.paintOrder = 'stroke';

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

    function selectTri(key, opts) {
        const o = Object.assign({ play: true }, opts || {});
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
    function onTriTap(key) {
        R.progSel = null;
        selectTri(key);
        if (S.entry) addCurrent();
    }
    function onNodeTap(pc) { selectNote(pc); }

    // ------------------------------------------------------------------------------------------------------------------
    // Peinture du réseau
    // ------------------------------------------------------------------------------------------------------------------
    function paint() {
        const cur = current();
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

        let front = null;
        for (const e of vis.tri.values()) {
            const t = e.t;
            const id = triId(t);
            const isSel = !!(sel && t.key === sel.key), isPlay = t.key === playKey, isNb = !!nbKey[t.key];
            const outKey = S.dim && !isInKey(t.root, id);          // hors tonalité : gris (indépendant du chiffrage romain)
            let cls = 'tri ' + (t.minor ? 'min' : 'maj') + ((outKey && !isNb && !isSel && !isPlay) ? ' out' : '');
            if (inprog.has(t.key)) cls += ' inprog';
            if (shown && isTriad && t.root === shown.root && (shown.id === id) && !(sel && t.key === sel.key)) cls += ' twin';
            if (shown && !isTriad && t.pcs.every((p) => lit.has(p))) cls += ' near';      // triades contenues dans l'accord
            if (!shown && R.note !== null && t.pcs.includes(R.note)) cls += ' near';        // triades qui contiennent la note
            if (isNb) cls += ' nb';
            if (isSel) cls += ' sel';
            if (isPlay) { cls += ' play'; front = e.poly; }
            else if (isSel) front = front || e.poly;
            if (e.cls !== cls) { e.poly.setAttribute('class', cls); e.cls = cls; }
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
        if (front && front.parentNode && front.parentNode.lastChild !== front) front.parentNode.appendChild(front);   // le contour de l'accord actif passe au-dessus
        for (const e of vis.node.values()) {
            const txt = nm(e.n.pc);
            if (e.tx.textContent !== txt) e.tx.textContent = txt;
            const cls = 'node' + (lit.has(e.n.pc) ? ' on' : '') + (e.n.pc === rootPc ? ' root' : '');
            if (e.cls !== cls) { e.g.setAttribute('class', cls); e.cls = cls; }
        }
    }

    // Choisit, pour chaque accord de la progression, le triangle qui le représente : celui qu'on avait touché, sinon la copie la plus
    // proche du précédent ; puis dessine le chemin parcouru dans le réseau.
    function computeInstances() {
        let prev = null;
        R.inst = R.prog.map((it) => {
            if (it.id !== TRI_MAJ && it.id !== TRI_MIN) return null;
            const minor = it.id === TRI_MIN;
            let t = it.tri ? triByKey(it.tri) : null;
            if (!t || t.root !== it.r || t.minor !== minor) t = nearestInstance(it.r, minor, prev || ORIGIN);
            if (t) prev = t;
            return t;
        });
    }
    function drawPath() {
        const layer = $('pathLayer');
        layer.textContent = '';
        const pts = R.inst.filter(Boolean);
        if (pts.length === 0) return;
        for (let k = 0; k + 1 < pts.length; k++) {
            const a = pts[k], b = pts[k + 1];
            if (a === b) continue;
            const dx = b.cx - a.cx, dy = b.cy - a.cy, len = Math.hypot(dx, dy) || 1;
            const sx = a.cx + dx / len * 34, sy = a.cy + dy / len * 34, ex = b.cx - dx / len * 40, ey = b.cy - dy / len * 40;
            el('path', { d: `M${sx} ${sy} L${ex} ${ey}`, class: 'halo' }, layer);       // liseré de la couleur du fond : le trait reste lisible sur toutes les cases
            el('path', { d: `M${sx} ${sy} L${ex} ${ey}`, class: 'seg', 'marker-end': 'url(#arrow)' }, layer);
        }
        const s = pts[0];
        const dot = el('circle', { cx: s.cx, cy: s.cy - (s.kind === 'u' ? 56 : 50), r: 13, class: 'stepdot' }, layer);
        const lab = el('text', { x: s.cx, y: s.cy - (s.kind === 'u' ? 56 : 50) }, layer);
        lab.textContent = '1';
        void dot;
    }

    // ------------------------------------------------------------------------------------------------------------------
    // Panneau d'information sous le réseau
    // ------------------------------------------------------------------------------------------------------------------
    function chordNotesText(root, id) {
        return chordPcs(root, id).map(nm).join(' – ');
    }
    function tagsFor(root, id) {
        if (!S.analysis) return '';
        const num = romanOf(root, id), fn = fnLabel(root, id);
        return `<div class="tags"><span class="tag"><b>${esc(num)}</b> en ${esc(nm(S.tonic))} ${S.mode === 'maj' ? 'majeur' : 'mineur'}</span>`
            + (fn ? `<span class="tag">${esc(fn)}</span>` : '') + '</div>';
    }
    function renderInfo() {
        const box = $('info');
        const playItem = R.playing >= 0 ? R.prog[R.playing] : null;
        const cur = current();
        if (playItem) {
            box.innerHTML = `<div class="title">${esc(chordName(playItem.r, playItem.id))}</div>
                <div class="notes">${esc(chordNotesText(playItem.r, playItem.id))}</div>${tagsFor(playItem.r, playItem.id)}
                <div class="hint">Accord ${R.playing + 1} sur ${R.prog.length}</div>`;
            return;
        }
        if (cur && cur.kind === 'tri') {
            const t = cur.t, nb = neighbors(t);
            const btn = (op, label) => {
                let target = nb[op] ? triByKey(nb[op]) : null;
                if (!target) { const r = riemann(t, op); target = nearestInstance(r.root, r.minor, t); }
                return `<button type="button" class="btn small" data-act="nb" data-key="${target.key}" title="${label}">${op} → ${esc(chordName(target.root, triId(target)))}</button>`;
            };
            box.innerHTML = `<div class="title">${esc(chordName(t.root, cur.id))} <span class="hint">${t.minor ? 'triade mineure' : 'triade majeure'}</span></div>
                <div class="notes">${esc(chordNotesText(t.root, cur.id))}</div>${tagsFor(t.root, cur.id)}
                <div class="row tight"><span class="label">Transformations</span>${btn('P', 'Parallèle : même fondamentale')}${btn('L', 'Sensible : la quinte monte ou la fondamentale descend d\'un demi-ton')}${btn('R', 'Relatif')}</div>
                <div class="row"><button type="button" class="btn" data-act="add">+ Ajouter à la progression</button></div>`;
            return;
        }
        if (cur && cur.kind === 'custom') {
            const st = cbStateOfId(cur.id);
            box.innerHTML = `<div class="title">${esc(chordName(cur.root, cur.id))}</div>
                <div class="notes">${esc(chordNotesText(cur.root, cur.id))}</div>
                <div class="hint">${esc(st ? cbFullName(st) : '')}</div>${tagsFor(cur.root, cur.id)}
                <div class="hint">Les triangles entourés sont les triades contenues dans cet accord.</div>
                <div class="row"><button type="button" class="btn" data-act="add">+ Ajouter à la progression</button></div>`;
            return;
        }
        if (R.note !== null) {
            const n = R.note;
            const list = [[n, false], [mod(n - 4), false], [mod(n - 7), false], [n, true], [mod(n - 3), true], [mod(n - 7), true]];
            const btns = list.map(([r, m]) => {
                const t = nearestInstance(r, m, null);
                return `<button type="button" class="btn small" data-act="nb" data-key="${t.key}">${esc(chordName(r, m ? TRI_MIN : TRI_MAJ))}</button>`;
            }).join('');
            box.innerHTML = `<div class="title">${esc(nm(n))}</div>
                <div class="hint">Cette note revient à de nombreux endroits du réseau (un cercle plein par copie). Les triangles entourés la contiennent.</div>
                <div class="row tight"><span class="label">Accords qui la contiennent</span>${btns}</div>`;
            return;
        }
        box.innerHTML = `<div class="hint">Touchez un <b>triangle</b> pour entendre un accord et voir ses voisins P, L et R, ou une <b>note</b> (un cercle) pour la repérer partout dans le réseau.
            Construisez ensuite une progression avec les réglages de gauche.</div>`;
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
    function progChanged() {
        computeInstances();
        syncBandGrid();
        store.set('tonnetz.work', snapshot('travail'));
        renderChips();
        drawPath();
        paint();
        renderInfo();
    }

    function chipClass(it) { return isMinorish(it.id) ? 'min' : 'maj'; }
    function renderChips() {
        const box = $('chips');
        box.textContent = '';
        if (!R.prog.length) {
            const e = document.createElement('div');
            e.className = 'empty';
            e.textContent = 'Touchez un triangle puis « Ajouter l\'accord », ou activez « Saisie par touches ».';
            box.appendChild(e);
        }
        R.prog.forEach((it, i) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'chip ' + chipClass(it) + (i === R.progSel ? ' sel' : '') + (i === R.playing ? ' playing' : '');
            b.dataset.i = i;
            const m = document.createElement('span'); m.className = 'm'; m.textContent = it.m > 1 ? '×' + it.m : '';
            const n = document.createElement('span'); n.className = 'n'; n.textContent = chordName(it.r, it.id);
            const r = document.createElement('span'); r.className = 'r'; r.textContent = S.analysis ? romanOf(it.r, it.id) : '';
            b.append(m, n, r);
            box.appendChild(b);
        });
        $('chipTools').hidden = R.progSel === null || !R.prog[R.progSel];
        const dur = R.progSel !== null && R.prog[R.progSel] ? R.prog[R.progSel].m : 1;
        $('durSeg').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(parseInt(b.dataset.m, 10) === dur)));
        const total = R.prog.reduce((s, it) => s + it.m, 0);
        $('progSum').textContent = R.prog.length ? `${R.prog.length} accord${R.prog.length > 1 ? 's' : ''} · ${total} mesure${total > 1 ? 's' : ''}` : '';
    }
    function selectItem(i) {
        const it = R.prog[i];
        if (!it) return;
        R.progSel = i;
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
        $('bClear').addEventListener('click', () => {
            if (band && band.isPlaying) band.stop();
            R.prog = []; R.progSel = null; progChanged();
        });
        const seg = $('durSeg');
        [1, 2, 3, 4, 8].forEach((m) => {
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'btn small'; b.dataset.m = m; b.textContent = m;
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
    function snapshot(name) {
        return {
            tonnetz: 1, name,
            items: R.prog.map((it) => { const o = { r: it.r, id: it.id, m: it.m }; if (it.tri) o.tri = it.tri; return o; }),
            bpm: S.bpm, style: S.style, meter: S.meter, tonic: S.tonic, mode: S.mode
        };
    }
    function validItems(items) {
        if (!Array.isArray(items)) return [];
        return items.filter((o) => o && Number.isInteger(o.r) && o.r >= 0 && o.r < 12 && typeof o.id === 'string' && lookupChord(o.id))
            .map((o) => { const it = { r: o.r, id: o.id, m: Math.max(1, Math.min(16, parseInt(o.m, 10) || 1)) }; if (typeof o.tri === 'string') it.tri = o.tri; return it; });
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
        $('bExport').addEventListener('click', () => {
            if (!R.prog.length) { setStatus('Rien à exporter : la progression est vide.'); return; }
            const name = $('saveName').value.trim() || 'progression';
            const blob = new Blob([JSON.stringify(snapshot(name), null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = name.replace(/[^\w\-]+/g, '_') + '.tonnetz.json';
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        });
        $('bImport').addEventListener('click', () => $('fileImport').click());
        $('fileImport').addEventListener('change', (e) => {
            const f = e.target.files && e.target.files[0];
            if (!f) return;
            const rd = new FileReader();
            rd.onload = () => {
                try {
                    const o = JSON.parse(rd.result);
                    if (!o || !Array.isArray(o.items) || !validItems(o.items).length) throw new Error('vide');
                    $('saveName').value = o.name || '';
                    loadSnapshot(o);
                    setStatus('Progression importée.');
                } catch (err) { setStatus('Ce fichier n\'est pas une progression Gym Tonnetz valide.'); }
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
        if (!band) return;
        band.grid = R.prog.map((it) => ({ rootIndex: it.r, chordId: it.id, measures: it.m }));
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
        const changed = R.playing !== ev.stepIdx;
        R.playing = ev.stepIdx;
        const bars = Math.round(ev.total / ev.bpb);
        $('counter').textContent = `Mesure ${ev.measure + 1}/${bars}`;
        if (changed) {
            renderChips();
            paint();
            renderInfo();
            ensureVisible(R.inst[ev.stepIdx]);       // le réseau suit l'accord joué s'il sort de l'écran
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
        $('cuPreview').innerHTML = `<div class="title">${esc(chordName(CU.root, id))}</div>
            <div class="notes">${esc(chordPcs(CU.root, id).map(nm).join(' – '))}</div>
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
        $('bDim').setAttribute('aria-pressed', String(S.dim));
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
        $('bNames').addEventListener('click', () => { S.fr = !S.fr; saveSettings(); refreshAll(); });
        $('bSpell').addEventListener('click', () => { S.spell = S.spell === 'auto' ? 's' : (S.spell === 's' ? 'f' : 'auto'); saveSettings(); refreshAll(); });
        $('bLabels').addEventListener('click', () => { S.labels = !S.labels; saveSettings(); refreshAll(); });
        $('bSound').addEventListener('click', () => { S.sound = !S.sound; if (!S.sound) stopTap(); saveSettings(); syncButtons(); });
        $('bAnalysis').addEventListener('click', () => { S.analysis = !S.analysis; saveSettings(); refreshAll(); });
        $('bDim').addEventListener('click', () => { S.dim = !S.dim; saveSettings(); refreshAll(); });
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
        $('info').addEventListener('click', (e) => {
            const b = e.target.closest('button[data-act]');
            if (!b) return;
            if (b.dataset.act === 'add') addCurrent();
            else if (b.dataset.act === 'nb') { R.progSel = null; selectTri(b.dataset.key); renderChips(); ensureVisible(triByKey(b.dataset.key)); if (S.entry) addCurrent(); }
        });
        document.addEventListener('keydown', (e) => {
            const tag = (e.target && e.target.tagName) || '';
            if (/INPUT|SELECT|TEXTAREA/.test(tag) || e.metaKey || e.ctrlKey || e.altKey) return;
            if (e.key === ' ' && tag !== 'BUTTON') { e.preventDefault(); togglePlay(); }
            else if ((e.key === 'Delete' || e.key === 'Backspace') && R.progSel !== null && tag !== 'BUTTON') { e.preventDefault(); removeSelected(); }
            else if (e.key === '+' || e.key === '=') $('bZoomIn').click();
            else if (e.key === '-') $('bZoomOut').click();
            else if (e.key === 'f' || e.key === 'F') $('bFull').click();
        });
    }

    function refreshSelection() { paint(); renderInfo(); renderChips(); }
    function refreshAll() {
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
    computeInstances();
    { const first = R.inst.find(Boolean); if (first && boardW) centerOn(first.cx, first.cy, baseZoom(), false); }   // la vue démarre sur la progression gardée
    drawPath();
    renderSaves();
    refreshAll();

    // utile aux tests automatiques
    window.TONNETZ_DEBUG = { S, R, get band() { return band; }, App, tris, nodes: nodeCache, view, vis, triByKey, nearestInstance };
})();
