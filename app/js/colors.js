// colors.js — réglage des couleurs du réseau (Gym Tonnetz).
// Un bouton de la barre du haut ouvre un popup déplaçable : on y choisit un thème proposé, ou on règle chaque couleur du réseau
// (fonds, textes, états, flèches de la progression, notes, chiffrage romain) avec plusieurs outils : cercle chromatique + carré saturation / luminosité, curseurs
// teinte / saturation / luminosité et rouge / vert / bleu, code hexadécimal, pipette, sélecteur du système, nuances, couleurs récentes.
// Les couleurs changent en direct sur le réseau (variables CSS posées sur <html>). On peut enregistrer son thème, l'exporter et
// l'importer (.json). Tout est gardé dans le navigateur (clés tonnetz.colors, tonnetz.themes, tonnetz.colors.recent).
//
// Chargé par index.html avant tonnetz.js, qui appelle TonnetzColors.init({ button }).

(() => {
    'use strict';

    // ------------------------------------------------------------------------------------------------------------------
    // Couleurs : conversions et contraste
    // ------------------------------------------------------------------------------------------------------------------
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const hexNorm = (s) => {
        s = String(s == null ? '' : s).trim().replace(/^#/, '');
        if (/^[0-9a-f]{3}$/i.test(s)) s = s.split('').map((c) => c + c).join('');
        return /^[0-9a-f]{6}$/i.test(s) ? '#' + s.toLowerCase() : null;
    };
    // « Aucune couleur » : la valeur 'none' (peinte en transparent sur le réseau). Elle est permise pour tous les éléments.
    const NONE = 'none';
    const parseVal = (s) => {
        const t = String(s == null ? '' : s).trim().toLowerCase();
        return ['none', 'aucune', 'aucun', 'transparent'].includes(t) ? NONE : hexNorm(s);
    };
    const cssVal = (v) => (v === NONE ? 'transparent' : v);
    const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.substr(i, 2), 16));
    const toHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
    function rgb2hsv(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
        let h = 0;
        if (d) {
            if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
            h *= 60; if (h < 0) h += 360;
        }
        return { h, s: mx ? d / mx : 0, v: mx };
    }
    function hue2rgb(h, c, x, m) {
        const k = Math.floor((((h % 360) + 360) % 360) / 60);
        const t = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][k];
        return t.map((v) => (v + m) * 255);
    }
    function hsv2rgb(h, s, v) {
        const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1));
        return hue2rgb(h, c, x, v - c);
    }
    function rgb2hsl(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
        let h = 0;
        if (d) {
            if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
            h *= 60; if (h < 0) h += 360;
        }
        return { h, s: d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1)), l };
    }
    function hsl2rgb(h, s, l) {
        const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1));
        return hue2rgb(h, c, x, l - c / 2);
    }
    const hsvHex = (h, s, v) => toHex(...hsv2rgb(h, s, v));
    function lum(hex) {
        const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
        const [r, g, b] = toRgb(hex);
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    }
    function contrast(a, b) {
        const la = lum(a), lb = lum(b);
        return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    }
    const readableOn = (bg) => (contrast(bg, '#111827') >= contrast(bg, '#ffffff') ? '#111827' : '#ffffff');
    const kebab = (k) => k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
    const clone = (o) => JSON.parse(JSON.stringify(o));
    const store = {
        get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
        set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
    };

    // ------------------------------------------------------------------------------------------------------------------
    // Les couleurs du réseau et les thèmes proposés
    // ------------------------------------------------------------------------------------------------------------------
    // Logique commune des thèmes : dans la tonalité, majeur en teinte claire et mineur en teinte foncée ; hors tonalité, en gris ;
    // un accent par état (sélection, voisins P / L / R, accord joué) ; texte choisi pour un contraste d'au moins 4,5:1.
    const KEYS = ['gbg', 'maj', 'majInk', 'min', 'minInk', 'majOut', 'majOutInk', 'minOut', 'minOutInk', 'sel', 'selInk', 'nb', 'nbInk',
        'play', 'playInk', 'hl', 'path', 'arrow', 'arrowEdge', 'node', 'nodeInk', 'nodeEdge', 'nodeOn', 'nodeOnInk', 'pill', 'roman'];

    const PRESETS = [
        { id: 'jour', name: 'Jour', colors: { gbg: '#f4f4f5', maj: '#f59e0b', majInk: '#111827', min: '#1d4ed8', minInk: '#ffffff',
            majOut: '#d4d4d8', majOutInk: '#27272a', minOut: '#71717a', minOutInk: '#ffffff', sel: '#111827', selInk: '#ffffff',
            nb: '#06b6d4', nbInk: '#0b1220', play: '#e11d48', playInk: '#ffffff', hl: '#111827', path: '#111827', arrow: '#ffffff', arrowEdge: '#111827', node: '#ffffff',
            nodeInk: '#111827', nodeEdge: '#71717a', nodeOn: '#111827', nodeOnInk: '#ffffff', pill: '#18181b', roman: '#ef4444' } },
        { id: 'lagon', name: 'Lagon', colors: { gbg: '#f1f5f9', maj: '#06b6d4', majInk: '#0b1220', min: '#5b21b6', minInk: '#ffffff',
            majOut: '#cbd5e1', majOutInk: '#1e293b', minOut: '#64748b', minOutInk: '#ffffff', sel: '#0f172a', selInk: '#ffffff',
            nb: '#facc15', nbInk: '#111827', play: '#e11d48', playInk: '#ffffff', hl: '#0f172a', path: '#0f172a', arrow: '#ffffff', arrowEdge: '#111827', node: '#ffffff',
            nodeInk: '#0f172a', nodeEdge: '#64748b', nodeOn: '#0f172a', nodeOnInk: '#ffffff', pill: '#18181b', roman: '#ef4444' } },
        { id: 'prairie', name: 'Prairie', colors: { gbg: '#f4f4f5', maj: '#84cc16', majInk: '#111827', min: '#115e59', minInk: '#ffffff',
            majOut: '#d4d4d8', majOutInk: '#27272a', minOut: '#71717a', minOutInk: '#ffffff', sel: '#111827', selInk: '#ffffff',
            nb: '#ec4899', nbInk: '#111827', play: '#f97316', playInk: '#111827', hl: '#111827', path: '#111827', arrow: '#ffffff', arrowEdge: '#111827', node: '#ffffff',
            nodeInk: '#111827', nodeEdge: '#71717a', nodeOn: '#111827', nodeOnInk: '#ffffff', pill: '#18181b', roman: '#ef4444' } },
        { id: 'harmonia', name: 'Harmonia', colors: { gbg: '#121214', maj: '#fbbf24', majInk: '#111827', min: '#2563eb', minInk: '#ffffff',
            majOut: '#a1a1aa', majOutInk: '#111827', minOut: '#3f3f46', minOutInk: '#f4f4f5', sel: '#ffffff', selInk: '#111827',
            nb: '#d946ef', nbInk: '#111827', play: '#10b981', playInk: '#052e16', hl: '#ffffff', path: '#ffffff', arrow: '#ffffff', arrowEdge: '#111827', node: '#1f1f23',
            nodeInk: '#f4f4f5', nodeEdge: '#71717a', nodeOn: '#ffffff', nodeOnInk: '#111827', pill: '#18181b', roman: '#ef4444' } },
        { id: 'aurore', name: 'Aurore', colors: { gbg: '#0b1020', maj: '#22d3ee', majInk: '#0b1220', min: '#7c3aed', minInk: '#ffffff',
            majOut: '#94a3b8', majOutInk: '#0f172a', minOut: '#334155', minOutInk: '#e2e8f0', sel: '#ffffff', selInk: '#0f172a',
            nb: '#facc15', nbInk: '#111827', play: '#e11d48', playInk: '#ffffff', hl: '#ffffff', path: '#ffffff', arrow: '#ffffff', arrowEdge: '#111827', node: '#172036',
            nodeInk: '#e2e8f0', nodeEdge: '#64748b', nodeOn: '#ffffff', nodeOnInk: '#0f172a', pill: '#18181b', roman: '#ef4444' } },
        { id: 'emeraude', name: 'Émeraude', colors: { gbg: '#08130f', maj: '#a3e635', majInk: '#111827', min: '#0f766e', minInk: '#ffffff',
            majOut: '#a1a1aa', majOutInk: '#111827', minOut: '#3b4743', minOutInk: '#ecfdf5', sel: '#ffffff', selInk: '#111827',
            nb: '#ec4899', nbInk: '#111827', play: '#f97316', playInk: '#111827', hl: '#ffffff', path: '#ffffff', arrow: '#ffffff', arrowEdge: '#111827', node: '#13241d',
            nodeInk: '#ecfdf5', nodeEdge: '#6b7f77', nodeOn: '#ffffff', nodeOnInk: '#111827', pill: '#18181b', roman: '#ef4444' } }
    ];
    const DEFAULT_PRESET = PRESETS[0];                       // « Jour » : le thème de départ

    // Les éléments du réseau, tels qu'ils apparaissent dans le popup : [clé, intitulé de la case]
    const GROUPS = [
        { title: 'Fond', rows: [{ label: 'Fond de la grille', cells: [['gbg', 'Fond']] }] },
        { title: 'Dans la tonalité', rows: [
            { label: 'Accord majeur', cells: [['maj', 'Fond'], ['majInk', 'Texte']] },
            { label: 'Accord mineur', cells: [['min', 'Fond'], ['minInk', 'Texte']] }] },
        { title: 'Hors tonalité', rows: [
            { label: 'Majeur', cells: [['majOut', 'Fond'], ['majOutInk', 'Texte']] },
            { label: 'Mineur', cells: [['minOut', 'Fond'], ['minOutInk', 'Texte']] }] },
        { title: 'États', rows: [
            { label: 'Accord sélectionné', cells: [['sel', 'Fond'], ['selInk', 'Texte']] },
            { label: 'Voisins P · L · R', cells: [['nb', 'Fond'], ['nbInk', 'Texte']] },
            { label: 'Accord joué', cells: [['play', 'Fond'], ['playInk', 'Texte']] },
            { label: 'Contours et surbrillance', cells: [['hl', 'Couleur']] },
            { label: 'Contour des accords de la progression', cells: [['path', 'Couleur']] },
            { label: 'Flèches de la progression', cells: [['arrow', 'Couleur'], ['arrowEdge', 'Contour']] }] },
        { title: 'Notes', rows: [
            { label: 'Note', cells: [['node', 'Fond'], ['nodeInk', 'Texte'], ['nodeEdge', 'Contour']] },
            { label: 'Note jouée', cells: [['nodeOn', 'Fond'], ['nodeOnInk', 'Texte']] }] },
        { title: 'Chiffrage romain', rows: [{ label: 'Chiffrage', cells: [['pill', 'Pastille'], ['roman', 'Texte']] }] }
    ];
    const INK_OF = { maj: 'majInk', min: 'minInk', majOut: 'majOutInk', minOut: 'minOutInk', sel: 'selInk', nb: 'nbInk', play: 'playInk',
        node: 'nodeInk', nodeOn: 'nodeOnInk', pill: 'roman' };
    const FILL_OF = {}; Object.keys(INK_OF).forEach((f) => { FILL_OF[INK_OF[f]] = f; });
    const TITLES = {};
    GROUPS.forEach((g) => g.rows.forEach((r) => r.cells.forEach(([k, c]) => { TITLES[k] = r.label + ' · ' + c.toLowerCase(); })));

    // Épaisseur des contours (en pixels d'écran) : [clé, intitulé, infobulle, valeur de départ, maximum]. Posées sur <html> en variables CSS --w-<clé>
    // (voir tonnetz.css). Réglage à part des couleurs : un thème ne change pas les épaisseurs.
    const WIDTHS = [
        ['hl', 'Surbrillance', 'Contour de l\'accord sélectionné, de l\'accord joué, des voisins et des copies de l\'accord (les voisins et les copies suivent en proportion)', 4, 10],
        ['path', 'Progression', 'Contour des accords de la progression', 4, 10],
        ['grid', 'Grille', 'Filets entre les triangles', 2, 8],
        ['node', 'Notes', 'Contour des cercles de notes', 1.5, 6],
        ['arrow', 'Flèches', 'Contour des flèches de la progression', 2, 6]
    ];
    const WIDTH_DEFAULTS = {}; WIDTHS.forEach(([k, , , d]) => { WIDTH_DEFAULTS[k] = d; });
    const widthsOk = (o) => {
        const out = {};
        WIDTHS.forEach(([k, , , d, mx]) => { const v = parseFloat(o && o[k]); out[k] = Number.isFinite(v) ? clamp(Math.round(v * 2) / 2, 0, mx) : d; });
        return out;
    };
    const fmtW = (v) => String(v).replace('.', ',') + ' px';

    const keysOk = (o) => {
        const out = {};
        KEYS.forEach((k) => { out[k] = parseVal(o && o[k]) || DEFAULT_PRESET.colors[k]; });
        return out;
    };
    const sameColors = (a, b) => KEYS.every((k) => a[k] === b[k]);

    // ------------------------------------------------------------------------------------------------------------------
    // État
    // ------------------------------------------------------------------------------------------------------------------
    let cur = clone(DEFAULT_PRESET.colors);                 // couleurs en cours (appliquées au réseau)
    let base = { kind: 'preset', id: DEFAULT_PRESET.id, name: DEFAULT_PRESET.name, colors: clone(DEFAULT_PRESET.colors) };   // thème de départ des réglages
    let saved = [];                                         // mes thèmes : { name, colors }
    let recent = [];                                        // dernières couleurs choisies
    let widths = clone(WIDTH_DEFAULTS);                     // épaisseurs des contours en cours
    let sel = 'maj';                                        // couleur en cours de réglage
    let ed = { h: 0, s: 0, v: 0 };                          // sa teinte / saturation / valeur (on garde la teinte même sur un gris)
    let ui = null;                                          // éléments du popup
    let persistTimer = null;

    function applyAll() {
        const root = document.documentElement;
        KEYS.forEach((k) => root.style.setProperty('--' + kebab(k), cssVal(cur[k])));
    }
    function applyWidths() {
        const root = document.documentElement;
        WIDTHS.forEach(([k]) => root.style.setProperty('--w-' + k, String(widths[k])));
    }
    const persistWidths = () => store.set('tonnetz.widths', widths);
    function persist() {
        store.set('tonnetz.colors', { colors: cur, base: { kind: base.kind, id: base.id, name: base.name } });
    }
    const schedulePersist = () => { clearTimeout(persistTimer); persistTimer = setTimeout(persist, 250); };
    const isModified = () => !sameColors(cur, base.colors);
    // La couleur pleine que montrent le cercle et les curseurs (quand l'élément est « sans couleur », celle du dernier réglage)
    const solidSel = () => (cur[sel] === NONE ? hsvHex(ed.h, ed.s, ed.v) : cur[sel]);
    function pushRecent(hex) {
        if (!hexNorm(hex)) return;
        recent = [hex].concat(recent.filter((c) => c !== hex)).slice(0, 12);
        store.set('tonnetz.colors.recent', recent);
    }

    function setEdFromHex(hex) {
        if (!hexNorm(hex)) return;                           // « aucune couleur » : on garde le réglage d'avant
        const [r, g, b] = toRgb(hex);
        const hsv = rgb2hsv(r, g, b);
        if (hsv.s === 0 || hsv.v === 0) hsv.h = ed.h;        // gris ou noir : la teinte n'existe pas, on garde celle d'avant
        ed = hsv;
    }
    function select(key) {
        sel = key;
        setEdFromHex(cur[key]);
        refreshAll();
    }
    // Change la couleur en cours de réglage : appliquée tout de suite au réseau
    function update(hex, keepEd) {
        hex = parseVal(hex);
        if (!hex) return;
        cur[sel] = hex;
        document.documentElement.style.setProperty('--' + kebab(sel), cssVal(hex));
        if (!keepEd) setEdFromHex(hex);
        schedulePersist();
        refreshAll();
    }
    const setHSV = (h, s, v) => { ed = { h, s, v }; update(hsvHex(h, s, v), true); };
    function setHSL(h, s, l) {
        const rgb = hsl2rgb(h, s, l);
        const hsv = rgb2hsv(...rgb);
        if (hsv.s === 0 || hsv.v === 0) hsv.h = h;
        ed = hsv;
        update(toHex(...rgb), true);
    }
    function setRGB(r, g, b) { update(toHex(r, g, b)); }

    function loadColors(colors, newBase) {
        cur = keysOk(colors);
        base = Object.assign({}, newBase, { colors: clone(cur) });
        applyAll();
        persist();
        setEdFromHex(cur[sel]);
        refreshAll();
    }

    // ------------------------------------------------------------------------------------------------------------------
    // Thèmes enregistrés, export, import
    // ------------------------------------------------------------------------------------------------------------------
    function saveTheme() {
        const name = (ui.name.value || '').trim().slice(0, 40) || ('Thème ' + (saved.length + 1));
        ui.name.value = name;
        const entry = { name, colors: clone(cur) };
        const at = saved.findIndex((t) => t.name === name);
        if (at >= 0) saved[at] = entry; else saved.push(entry);
        store.set('tonnetz.themes', saved);
        base = { kind: 'saved', id: name, name, colors: clone(cur) };
        persist();
        refreshAll();
        flash('« ' + name + ' » enregistré.');
    }
    function exportTheme(name, colors) {
        const nm = name || 'theme';
        const blob = new Blob([JSON.stringify({ tonnetzTheme: 1, name: nm, colors }, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = nm.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\-]+/g, '_') + '.tonnetz-theme.json';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
    function importFile(file) {
        const rd = new FileReader();
        rd.onload = () => {
            try {
                const o = JSON.parse(rd.result);
                if (!o || typeof o !== 'object' || !o.colors || !KEYS.some((k) => parseVal(o.colors[k]))) throw new Error('invalide');
                const name = String(o.name || 'Thème importé').slice(0, 40);
                ui.name.value = name;
                loadColors(o.colors, { kind: 'import', id: name, name });
                flash('Thème « ' + name + ' » importé. Enregistrez-le pour le garder dans « Mes thèmes ».');
            } catch (e) { flash('Ce fichier n\'est pas un thème Gym Tonnetz valide.'); }
        };
        rd.readAsText(file);
    }
    let flashTimer = null;
    function flash(msg) {
        ui.msg.textContent = msg;
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => { ui.msg.textContent = ''; }, 5000);
    }

    // ------------------------------------------------------------------------------------------------------------------
    // Popup : construction
    // ------------------------------------------------------------------------------------------------------------------
    const WHEEL = 190, RING_IN = 75, SQ = 96;
    const RAINBOW = 'linear-gradient(90deg,hsl(0 100% 50%),hsl(60 100% 50%),hsl(120 100% 50%),hsl(180 100% 50%),hsl(240 100% 50%),hsl(300 100% 50%),hsl(360 100% 50%))';

    function mk(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }
    function slider(label, max, onInput) {
        const row = mk('label', 'cp-slider');
        const l = mk('span', 'cp-sl-label', label);
        const input = mk('input', 'cp-range');
        input.type = 'range'; input.min = 0; input.max = max; input.step = 1;
        const val = mk('span', 'cp-sl-val');
        input.addEventListener('input', () => { active = input; onInput(parseInt(input.value, 10)); });
        input.addEventListener('change', () => { active = null; pushRecent(cur[sel]); refreshRecent(); });
        row.append(l, input, val);
        return { row, input, val };
    }
    let active = null;                                       // le curseur en cours de glissement (on n'y touche pas pendant ce temps)

    function build(button) {
        const pop = mk('div', 'cpop');
        pop.id = 'colorPop';
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', 'Couleurs du Tonnetz');
        pop.hidden = true;

        // en-tête (poignée de déplacement)
        const head = mk('div', 'cp-head');
        const title = mk('strong', 'cp-title', 'Couleurs du Tonnetz');
        const state = mk('span', 'cp-state');
        const close = mk('button', 'btn small sq', '✕');
        close.type = 'button'; close.title = 'Fermer'; close.setAttribute('aria-label', 'Fermer');
        head.append(title, state, close);

        const tabs = mk('div', 'seg cp-tabs');
        tabs.setAttribute('role', 'group');
        const tabEdit = mk('button', 'btn', 'Réglage'), tabThemes = mk('button', 'btn', 'Thèmes');
        tabEdit.type = tabThemes.type = 'button';
        tabs.append(tabEdit, tabThemes);

        const body = mk('div', 'cp-body');

        // ----- onglet Réglage : liste des éléments + outils de couleur
        const paneEdit = mk('div', 'cp-pane');
        const items = mk('div', 'cp-items');
        const editor = mk('div', 'cp-editor');
        const target = mk('div', 'cp-target');

        const wheelBox = mk('div', 'cp-wheelbox');
        const wheel = mk('div', 'cp-wheel');
        wheel.style.width = wheel.style.height = WHEEL + 'px';
        const ring = mk('div', 'cp-ring');
        const ringThumb = mk('div', 'cp-thumb');
        const sv = mk('div', 'cp-sv');
        sv.style.width = sv.style.height = SQ + 'px';
        const svThumb = mk('div', 'cp-thumb');
        wheel.append(ring, sv, ringThumb, svThumb);

        const side = mk('div', 'cp-side');
        const cmp = mk('div', 'cp-compare');
        const swOld = mk('span', 'cp-old'), swNew = mk('span', 'cp-new');
        cmp.append(swOld, swNew);
        const hexRow = mk('div', 'cp-hexrow');
        const hexLabel = mk('span', 'label', 'Code');
        const hex = mk('input', 'cp-hex');
        hex.type = 'text'; hex.maxLength = 7; hex.spellcheck = false; hex.setAttribute('aria-label', 'Code hexadécimal');
        hexRow.append(hexLabel, hex);
        const contrastBox = mk('div', 'cp-contrast');
        const toolRow = mk('div', 'cp-tools');
        const eye = mk('button', 'btn small', 'Pipette');
        eye.type = 'button'; eye.title = 'Prélever une couleur n\'importe où à l\'écran';
        const sys = mk('button', 'btn small', 'Sélecteur système');
        sys.type = 'button'; sys.title = 'Le sélecteur de couleur de votre ordinateur (avec sa loupe sur Mac)';
        const native = mk('input', 'cp-native');
        native.type = 'color'; native.tabIndex = -1; native.setAttribute('aria-hidden', 'true');
        const auto = mk('button', 'btn small', 'Texte auto');
        auto.type = 'button'; auto.title = 'Noir ou blanc, selon ce qui se lit le mieux sur le fond';
        const none = mk('button', 'btn small', 'Aucune couleur');
        none.type = 'button'; none.title = 'Sans couleur : l\'élément devient transparent (fond, contour, chemin) ou invisible (texte)';
        const orig = mk('button', 'btn small', 'Rétablir cette couleur');
        orig.type = 'button'; orig.title = 'Revenir à la couleur du thème de départ';
        toolRow.append(none, eye, sys, auto, orig, native);
        side.append(cmp, hexRow, contrastBox, toolRow);
        wheelBox.append(wheel, side);

        const sliders = mk('div', 'cp-sliders');
        const sH = slider('Teinte', 360, (v) => { const c = toRgb(solidSel()); const h = rgb2hsl(c[0], c[1], c[2]); setHSL(v, h.s, h.l); });
        const sS = slider('Saturation', 100, (v) => { const c = toRgb(solidSel()); const h = rgb2hsl(c[0], c[1], c[2]); setHSL(ed.h, v / 100, h.l); });
        const sL = slider('Luminosité', 100, (v) => { const c = toRgb(solidSel()); const h = rgb2hsl(c[0], c[1], c[2]); setHSL(ed.h, h.s, v / 100); });
        const sR = slider('Rouge', 255, (v) => { const c = toRgb(solidSel()); setRGB(v, c[1], c[2]); });
        const sG = slider('Vert', 255, (v) => { const c = toRgb(solidSel()); setRGB(c[0], v, c[2]); });
        const sB = slider('Bleu', 255, (v) => { const c = toRgb(solidSel()); setRGB(c[0], c[1], v); });
        const sep = mk('div', 'cp-sep');
        sliders.append(sH.row, sS.row, sL.row, sep, sR.row, sG.row, sB.row);

        const palettes = mk('div', 'cp-palettes');
        const shades = mk('div', 'cp-swrow'), themeSw = mk('div', 'cp-swrow'), recentSw = mk('div', 'cp-swrow');
        palettes.append(mk('div', 'label', 'Nuances'), shades, mk('div', 'label', 'Couleurs du thème'), themeSw, mk('div', 'label', 'Récentes'), recentSw);

        editor.append(target, wheelBox, sliders, palettes);
        paneEdit.append(items, editor);

        // ----- onglet Thèmes
        const paneThemes = mk('div', 'cp-pane');
        const presetBox = mk('div', 'cp-cards');
        const mineTitle = mk('div', 'label', 'Mes thèmes');
        const mineBox = mk('div', 'cp-mine');
        const importRow = mk('div', 'row');
        const importBtn = mk('button', 'btn small', 'Importer un thème (.json)');
        importBtn.type = 'button';
        const importFileInput = mk('input'); importFileInput.type = 'file'; importFileInput.accept = '.json,application/json'; importFileInput.hidden = true;
        importRow.append(importBtn, importFileInput);
        paneThemes.append(mk('div', 'label', 'Thèmes proposés'), presetBox, mineTitle, mineBox, importRow);

        body.append(paneEdit, paneThemes);

        // ----- pied : enregistrer / exporter / rétablir
        const foot = mk('div', 'cp-foot');
        const name = mk('input', 'cp-name'); name.type = 'text'; name.placeholder = 'Nom du thème'; name.maxLength = 40; name.setAttribute('aria-label', 'Nom du thème');
        const bSave = mk('button', 'btn small', 'Enregistrer'); bSave.type = 'button';
        const bExport = mk('button', 'btn small', 'Exporter'); bExport.type = 'button'; bExport.title = 'Télécharger le thème en cours (.json)';
        const bRevert = mk('button', 'btn small', 'Rétablir'); bRevert.type = 'button'; bRevert.title = 'Annuler les modifications : retour au thème de départ';
        const msg = mk('div', 'cp-msg');
        msg.setAttribute('aria-live', 'polite');
        const footRow = mk('div', 'cp-footrow');
        footRow.append(name, bSave, bExport, bRevert);
        foot.append(footRow, msg);

        pop.append(head, tabs, body, foot);
        document.body.appendChild(pop);
        // En plein écran natif, seul l'élément affiché (le réseau et la progression) est visible : le popup l'accompagne
        const rehost = () => {
            const host = document.fullscreenElement || document.webkitFullscreenElement || document.body;
            if (pop.parentNode !== host) host.appendChild(pop);
        };
        document.addEventListener('fullscreenchange', rehost);
        document.addEventListener('webkitfullscreenchange', rehost);

        ui = { pop, head, state, close, tabEdit, tabThemes, paneEdit, paneThemes, items, target, wheel, ringThumb, sv, svThumb, swOld, swNew, hex, contrastBox,
            eye, sys, native, auto, orig, none, editor, sH, sS, sL, sR, sG, sB, shades, themeSw, recentSw, presetBox, mineBox, mineTitle, name, msg, bSave, bExport, bRevert,
            importBtn, importFileInput, chips: {}, button };

        // onglets
        const showTab = (which) => {
            const edit = which === 'edit';
            ui.paneEdit.hidden = !edit; ui.paneThemes.hidden = edit;
            tabEdit.setAttribute('aria-pressed', String(edit)); tabThemes.setAttribute('aria-pressed', String(!edit));
        };
        tabEdit.addEventListener('click', () => showTab('edit'));
        tabThemes.addEventListener('click', () => showTab('themes'));
        ui.showTab = showTab;
        showTab('edit');

        buildItems();
        wireWheel();
        wireTools();
        wireDrag();

        // pied
        bSave.addEventListener('click', saveTheme);
        name.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveTheme(); e.stopPropagation(); });
        bExport.addEventListener('click', () => exportTheme((name.value || '').trim() || base.name, cur));
        bRevert.addEventListener('click', () => {
            cur = clone(base.colors); applyAll(); persist(); setEdFromHex(cur[sel]); refreshAll();
        });
        importBtn.addEventListener('click', () => importFileInput.click());
        importFileInput.addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; if (f) importFile(f); e.target.value = ''; });
        close.addEventListener('click', () => toggle(false));
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) toggle(false); });

        button.addEventListener('click', (e) => { e.stopPropagation(); toggle(pop.hidden); });
    }

    function buildItems() {
        ui.items.textContent = '';
        GROUPS.forEach((g) => {
            const gt = mk('div', 'cp-gtitle', g.title);
            ui.items.appendChild(gt);
            g.rows.forEach((r) => {
                const row = mk('div', 'cp-row');
                row.appendChild(mk('span', 'cp-rlabel', r.label));
                const cells = mk('span', 'cp-cells');
                r.cells.forEach(([key, caption]) => {
                    const b = mk('button', 'cp-chip');
                    b.type = 'button'; b.dataset.key = key; b.title = TITLES[key];
                    b.addEventListener('click', () => select(key));
                    ui.chips[key] = b;
                    cells.appendChild(b);
                    b.dataset.caption = caption;
                });
                row.appendChild(cells);
                ui.items.appendChild(row);
            });
        });

        // Épaisseur des contours : un curseur par type de contour, appliqué en direct
        ui.items.appendChild(mk('div', 'cp-gtitle', 'Épaisseur des contours'));
        ui.wr = {};
        WIDTHS.forEach(([key, label, tip, , mx]) => {
            const row = mk('label', 'cp-row cp-wrow');
            row.title = tip;
            row.appendChild(mk('span', 'cp-rlabel', label));
            const input = mk('input', 'cp-range cp-wrange');
            input.type = 'range'; input.min = 0; input.max = mx; input.step = 0.5; input.setAttribute('aria-label', 'Épaisseur : ' + label);
            const val = mk('span', 'cp-sl-val cp-wval');
            input.addEventListener('input', () => {
                widths[key] = parseFloat(input.value);
                document.documentElement.style.setProperty('--w-' + key, String(widths[key]));
                val.textContent = fmtW(widths[key]);
                ui.wReset.disabled = WIDTHS.every(([k]) => widths[k] === WIDTH_DEFAULTS[k]);
                persistWidths();
            });
            row.append(input, val);
            ui.wr[key] = { input, val };
            ui.items.appendChild(row);
        });
        ui.wReset = mk('button', 'btn small cp-wreset', 'Épaisseurs par défaut');
        ui.wReset.type = 'button'; ui.wReset.title = 'Remettre toutes les épaisseurs de contour à leur valeur de départ';
        ui.wReset.addEventListener('click', () => { widths = clone(WIDTH_DEFAULTS); applyWidths(); persistWidths(); refreshWidths(); });
        ui.items.appendChild(ui.wReset);
        refreshWidths();
    }
    function refreshWidths() {
        if (!ui || !ui.wr) return;
        WIDTHS.forEach(([k]) => { ui.wr[k].input.value = widths[k]; ui.wr[k].val.textContent = fmtW(widths[k]); });
        ui.wReset.disabled = WIDTHS.every(([k]) => widths[k] === WIDTH_DEFAULTS[k]);
    }

    // Cercle chromatique (anneau = teinte) et carré (saturation en x, luminosité en y)
    function wireWheel() {
        let mode = null;
        const apply = (e) => {
            const r = ui.wheel.getBoundingClientRect();
            const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
            if (mode === 'hue') {
                const deg = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
                setHSV(deg, ed.s, ed.v);
            } else if (mode === 'sv') {
                const half = SQ / 2;
                setHSV(ed.h, clamp((dx + half) / SQ, 0, 1), 1 - clamp((dy + half) / SQ, 0, 1));
            }
        };
        ui.wheel.addEventListener('pointerdown', (e) => {
            const r = ui.wheel.getBoundingClientRect();
            const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
            const half = SQ / 2;
            const inSquare = Math.abs(dx) <= half + 3 && Math.abs(dy) <= half + 3;
            mode = inSquare ? 'sv' : (Math.hypot(dx, dy) >= RING_IN - 8 ? 'hue' : 'sv');
            try { ui.wheel.setPointerCapture(e.pointerId); } catch (err) {}
            e.preventDefault();
            apply(e);
        });
        ui.wheel.addEventListener('pointermove', (e) => { if (mode) apply(e); });
        const end = () => { if (mode) { mode = null; pushRecent(cur[sel]); refreshRecent(); } };
        ui.wheel.addEventListener('pointerup', end);
        ui.wheel.addEventListener('pointercancel', end);
    }

    function wireTools() {
        ui.hex.addEventListener('keydown', (e) => e.stopPropagation());
        ui.hex.addEventListener('input', () => {
            const h = parseVal(ui.hex.value);
            ui.hex.classList.toggle('bad', !h && ui.hex.value.trim() !== '');
            if (h === NONE || (h && ui.hex.value.replace('#', '').length >= 6)) update(h);
        });
        ui.hex.addEventListener('change', () => {
            const h = parseVal(ui.hex.value);
            if (h) { update(h); pushRecent(h); refreshRecent(); } else refreshHex();
        });
        ui.hex.addEventListener('blur', refreshHex);
        if ('EyeDropper' in window) {
            ui.eye.addEventListener('click', async () => {
                try { const r = await new window.EyeDropper().open(); update(r.sRGBHex); pushRecent(hexNorm(r.sRGBHex)); refreshRecent(); } catch (e) { /* annulé */ }
            });
        } else {
            ui.eye.hidden = true;                             // Safari et Firefox n'ont pas la pipette : le sélecteur système la remplace
        }
        ui.sys.addEventListener('click', () => { ui.native.value = solidSel(); ui.native.click(); });
        ui.native.addEventListener('input', () => update(ui.native.value));
        ui.native.addEventListener('change', () => { pushRecent(cur[sel]); refreshRecent(); });
        ui.auto.addEventListener('click', () => {
            const fill = FILL_OF[sel];
            if (fill) {
                const bg = cur[fill] !== NONE ? cur[fill] : (cur.gbg !== NONE ? cur.gbg : '#ffffff');
                update(readableOn(bg)); pushRecent(cur[sel]); refreshRecent();
            }
        });
        ui.orig.addEventListener('click', () => update(base.colors[sel]));
        ui.none.addEventListener('click', () => {            // bascule : « aucune couleur » / retour à la dernière couleur réglée
            if (cur[sel] === NONE) { update(hsvHex(ed.h, ed.s, ed.v), true); pushRecent(cur[sel]); refreshRecent(); } else update(NONE);
        });
    }

    function wireDrag() {
        let drag = null;
        const narrow = () => window.matchMedia('(max-width: 899px)').matches;
        ui.head.addEventListener('pointerdown', (e) => {
            if (narrow() || e.target.closest('button')) return;
            const r = ui.pop.getBoundingClientRect();
            drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
            try { ui.head.setPointerCapture(e.pointerId); } catch (err) {}
            e.preventDefault();
        });
        ui.head.addEventListener('pointermove', (e) => {
            if (!drag) return;
            const w = ui.pop.offsetWidth, h = ui.pop.offsetHeight;
            ui.pop.style.left = clamp(e.clientX - drag.dx, 4 - w + 80, window.innerWidth - 80) + 'px';
            ui.pop.style.top = clamp(e.clientY - drag.dy, 0, window.innerHeight - 40) + 'px';
            ui.pop.style.right = 'auto'; ui.pop.style.bottom = 'auto';
        });
        const end = () => { drag = null; };
        ui.head.addEventListener('pointerup', end);
        ui.head.addEventListener('pointercancel', end);
    }

    function toggle(open) {
        ui.pop.hidden = !open;
        ui.button.setAttribute('aria-expanded', String(open));
        ui.button.classList.toggle('on', open);
        if (open) refreshAll();
    }

    // ------------------------------------------------------------------------------------------------------------------
    // Popup : affichage (tout est recalculé à chaque changement : c'est léger, et le réseau suit en direct)
    // ------------------------------------------------------------------------------------------------------------------
    // Peint une pastille : couleur pleine, ou damier pour « aucune couleur »
    function paint(el, v) {
        el.classList.toggle('none', v === NONE);
        el.style.background = v === NONE ? '' : v;
    }
    function swatchButton(hex, label, onClick) {
        const b = mk('button', 'cp-sw');
        b.type = 'button'; paint(b, hex); b.title = label || (hex === NONE ? 'Aucune couleur' : hex); b.setAttribute('aria-label', b.title);
        b.addEventListener('click', () => { update(hex); pushRecent(hex); refreshRecent(); });
        return b;
    }
    function refreshChips() {
        Object.keys(ui.chips).forEach((key) => {
            const b = ui.chips[key], hex = cur[key], fill = FILL_OF[key];
            b.classList.toggle('sel', key === sel);
            b.textContent = '';
            if (fill) {                                        // case de texte : « Aa » dans sa couleur, sur son fond
                paint(b, cur[fill]);
                b.style.color = hex === NONE ? '' : hex;
                b.classList.toggle('ink-none', hex === NONE);
                b.appendChild(mk('span', 'cp-aa', 'Aa'));
            } else {                                           // case de fond / de contour : la couleur, légendée
                paint(b, hex);
                b.classList.remove('ink-none');
                b.style.color = hex === NONE ? '' : readableOn(hex);
                b.appendChild(mk('span', 'cp-cap', b.dataset.caption));
            }
            b.setAttribute('aria-pressed', String(key === sel));
        });
    }
    function refreshHex() { if (document.activeElement !== ui.hex) { ui.hex.value = cur[sel] === NONE ? 'aucune' : cur[sel]; ui.hex.classList.remove('bad'); } }
    function refreshRecent() {
        ui.recentSw.textContent = '';
        if (!recent.length) ui.recentSw.appendChild(mk('span', 'hint', 'Aucune pour l\'instant.'));
        recent.forEach((c) => ui.recentSw.appendChild(swatchButton(c)));
    }
    function refreshPalettes() {
        ui.shades.textContent = '';
        const [r, g, b] = toRgb(solidSel());
        const hsl = rgb2hsl(r, g, b);
        [0.08, 0.18, 0.3, 0.42, 0.5, 0.6, 0.72, 0.84, 0.94].forEach((l) => ui.shades.appendChild(swatchButton(toHex(...hsl2rgb(ed.h, hsl.s, l)))));
        ui.themeSw.textContent = '';
        const seen = new Set();
        KEYS.forEach((k) => { if (!seen.has(cur[k])) { seen.add(cur[k]); ui.themeSw.appendChild(swatchButton(cur[k])); } });
        refreshRecent();
    }
    function refreshSliders() {
        const [r, g, b] = toRgb(solidSel());
        const hsl = rgb2hsl(r, g, b);
        const hh = Math.round(ed.h), ss = Math.round(hsl.s * 100), ll = Math.round(hsl.l * 100);
        const set = (s, v, bg, txt) => { if (active !== s.input) s.input.value = v; s.input.style.background = bg; s.val.textContent = txt; };
        set(ui.sH, hh, RAINBOW, hh + '°');
        set(ui.sS, ss, `linear-gradient(90deg,hsl(${hh} 0% ${ll}%),hsl(${hh} 100% ${ll}%))`, ss + ' %');
        set(ui.sL, ll, `linear-gradient(90deg,#000,hsl(${hh} ${ss}% 50%),#fff)`, ll + ' %');
        set(ui.sR, r, `linear-gradient(90deg,rgb(0 ${g} ${b}),rgb(255 ${g} ${b}))`, r);
        set(ui.sG, g, `linear-gradient(90deg,rgb(${r} 0 ${b}),rgb(${r} 255 ${b}))`, g);
        set(ui.sB, b, `linear-gradient(90deg,rgb(${r} ${g} 0),rgb(${r} ${g} 255))`, b);
    }
    function refreshWheel() {
        ui.sv.style.backgroundColor = `hsl(${ed.h} 100% 50%)`;
        const R = WHEEL / 2, rr = (R + RING_IN) / 2, a = ed.h * Math.PI / 180;
        ui.ringThumb.style.left = (R + rr * Math.sin(a)) + 'px';
        ui.ringThumb.style.top = (R - rr * Math.cos(a)) + 'px';
        ui.ringThumb.style.background = `hsl(${ed.h} 100% 50%)`;
        ui.svThumb.style.left = (R - SQ / 2 + ed.s * SQ) + 'px';
        ui.svThumb.style.top = (R - SQ / 2 + (1 - ed.v) * SQ) + 'px';
        ui.svThumb.style.background = solidSel();
    }
    function refreshContrast() {
        const fill = FILL_OF[sel], ink = INK_OF[sel];
        let txt = '', cls = '';
        if (cur[sel] === NONE) {
            txt = fill ? 'Texte invisible : « Aucune couleur » masque le texte.' : 'Sans couleur : l\'élément est transparent (on voit ce qu\'il y a derrière).';
            cls = 'mid';
        } else if ((fill || ink) && cur[fill || ink] === NONE) {
            txt = fill ? 'Le fond est transparent : le contraste dépend de ce qui est derrière.' : '';
            cls = 'mid';
        } else if (fill || ink) {
            const f = fill ? cur[fill] : cur[sel], t = fill ? cur[sel] : cur[ink];
            const c = contrast(f, t);
            cls = c >= 4.5 ? 'ok' : (c >= 3 ? 'mid' : 'low');
            txt = 'Contraste texte / fond : ' + (Math.round(c * 10) / 10).toString().replace('.', ',') + ' : 1 ' + (c >= 4.5 ? '✓ lisible' : (c >= 3 ? '· moyen' : '· trop faible'));
        }
        ui.contrastBox.className = 'cp-contrast ' + cls;
        ui.contrastBox.textContent = txt;
        ui.contrastBox.hidden = !txt;
        ui.auto.hidden = !fill;
    }
    function refreshThemesPane() {
        ui.presetBox.textContent = '';
        const mosaic = (c) => {
            const m = mk('span', 'cp-mosaic');
            m.style.background = cssVal(c.gbg);
            ['maj', 'min', 'majOut', 'minOut', 'nb', 'play'].forEach((k) => { const i = mk('i'); i.style.background = cssVal(c[k]); m.appendChild(i); });
            return m;
        };
        PRESETS.forEach((p) => {
            const b = mk('button', 'cp-card');
            b.type = 'button';
            b.setAttribute('aria-pressed', String(base.kind === 'preset' && base.id === p.id));
            b.append(mosaic(p.colors), mk('span', 'cp-cname', p.name));
            b.addEventListener('click', () => loadColors(p.colors, { kind: 'preset', id: p.id, name: p.name }));
            ui.presetBox.appendChild(b);
        });
        ui.mineBox.textContent = '';
        ui.mineTitle.hidden = false;
        if (!saved.length) ui.mineBox.appendChild(mk('div', 'hint', 'Aucun thème enregistré : réglez vos couleurs puis « Enregistrer ».'));
        saved.forEach((t, i) => {
            const row = mk('div', 'cp-mrow');
            const load = mk('button', 'cp-card cp-mload');
            load.type = 'button';
            load.setAttribute('aria-pressed', String(base.kind === 'saved' && base.id === t.name));
            load.append(mosaic(t.colors), mk('span', 'cp-cname', t.name));
            load.addEventListener('click', () => { ui.name.value = t.name; loadColors(t.colors, { kind: 'saved', id: t.name, name: t.name }); });
            const ex = mk('button', 'btn small', 'Exporter'); ex.type = 'button';
            ex.addEventListener('click', () => exportTheme(t.name, t.colors));
            const del = mk('button', 'btn small sq', '✕'); del.type = 'button'; del.title = 'Supprimer'; del.setAttribute('aria-label', 'Supprimer ' + t.name);
            del.addEventListener('click', () => {
                saved.splice(i, 1); store.set('tonnetz.themes', saved);
                if (base.kind === 'saved' && base.id === t.name) { base = { kind: 'custom', id: '', name: 'Personnalisé', colors: clone(cur) }; persist(); }
                refreshAll();
            });
            row.append(load, ex, del);
            ui.mineBox.appendChild(row);
        });
    }
    function refreshAll() {
        if (!ui) return;
        const mod = isModified();
        ui.state.textContent = base.name + (mod ? ' · modifié' : '');
        ui.state.classList.toggle('mod', mod);
        ui.bRevert.disabled = !mod;
        ui.target.textContent = TITLES[sel];
        paint(ui.swOld, base.colors[sel]); ui.swOld.title = 'Thème de départ : ' + (base.colors[sel] === NONE ? 'aucune couleur' : base.colors[sel]);
        paint(ui.swNew, cur[sel]); ui.swNew.title = 'Couleur actuelle : ' + (cur[sel] === NONE ? 'aucune' : cur[sel]);
        ui.none.setAttribute('aria-pressed', String(cur[sel] === NONE));
        ui.editor.classList.toggle('is-none', cur[sel] === NONE);
        ui.orig.disabled = base.colors[sel] === cur[sel];
        refreshChips();
        refreshHex();
        refreshWheel();
        refreshSliders();
        refreshContrast();
        refreshPalettes();
        refreshThemesPane();
    }

    // ------------------------------------------------------------------------------------------------------------------
    // Démarrage
    // ------------------------------------------------------------------------------------------------------------------
    function init(opts) {
        const stored = store.get('tonnetz.colors', null);
        saved = (store.get('tonnetz.themes', []) || []).filter((t) => t && typeof t.name === 'string' && t.colors)
            .map((t) => ({ name: t.name.slice(0, 40), colors: keysOk(t.colors) }));
        recent = (store.get('tonnetz.colors.recent', []) || []).map(hexNorm).filter(Boolean).slice(0, 12);
        if (stored && stored.colors) {
            cur = keysOk(stored.colors);
            const b = stored.base || {};
            const preset = b.kind === 'preset' ? PRESETS.find((p) => p.id === b.id) : null;
            const mine = b.kind === 'saved' ? saved.find((t) => t.name === b.id) : null;
            if (preset) base = { kind: 'preset', id: preset.id, name: preset.name, colors: clone(preset.colors) };
            else if (mine) base = { kind: 'saved', id: mine.name, name: mine.name, colors: clone(mine.colors) };
            else base = { kind: b.kind === 'import' ? 'import' : 'custom', id: b.id || '', name: b.name || 'Personnalisé', colors: clone(cur) };
        }
        widths = widthsOk(store.get('tonnetz.widths', null));
        applyAll();
        applyWidths();
        setEdFromHex(cur[sel]);
        build(opts.button);
        if (base.kind === 'saved') ui.name.value = base.name;
        refreshAll();
    }

    window.TonnetzColors = { init, PRESETS, KEYS };
})();
