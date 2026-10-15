// sw.js — service worker de Gym Tonnetz : garde l'appli en mémoire du navigateur pour qu'elle s'ouvre et joue sans
// connexion (et permet de l'installer comme application). Doit rester À LA RACINE (à côté de index.html) pour couvrir
// toute l'appli, y compris quand elle est publiée dans un sous-dossier (https://…github.io/Gym-Tonnetz/).
// Tous les chemins sont relatifs à ce fichier.
//
// Deux caches :
//  - « shell » : la page, le code, les styles, la police, les bibliothèques, les icônes. Téléchargé d'un coup à
//    l'installation (si un seul fichier manque, l'installation échoue et l'ancienne version reste en place).
//    Servi « réseau d'abord » (3 s maximum) : en ligne, on a toujours la dernière version publiée ; hors ligne
//    ou réseau trop lent, on prend la copie gardée. Aucun numéro de version à penser à changer.
//  - « sounds » : les ~30 Mo d'échantillons d'instruments. Servi « cache d'abord » (ils ne changent jamais) et
//    téléchargé en arrière-plan, un par un, quand la page le demande (message « precache-sounds »).
// SI ON AJOUTE OU RETIRE UN FICHIER du projet, mettre à jour SHELL_FILES ci-dessous (si un fichier de la liste manque,
// l'installation échoue). Pour un instrument, voir aussi app/js/audio/local-soundfonts.js.

importScripts('app/js/audio/local-soundfonts.js'); // définit LOCAL_SOUNDFONT_FILES

const SHELL_CACHE = 'tonnetz-shell-v1';
const SOUNDS_CACHE = 'tonnetz-sounds-v1';
const SHELL_TIMEOUT_MS = 3000;

const SHELL_FILES = [
    './',
    'index.html',
    'manifest.webmanifest',
    'app/css/tonnetz.css',
    'app/icons/icon-192.png',
    'app/icons/icon-512.png',
    'app/icons/icon-maskable-512.png',
    'app/icons/apple-touch-icon.png',
    'app/vendor/soundfont-player.min.js',
    'app/js/audio/ios-silent-mode.js',
    'app/js/wake-lock.js',
    'app/js/audio/local-soundfonts.js',
    'app/js/theory.js',
    'app/js/band-patterns.js',
    'app/js/audio-config.js',
    'app/js/band/band-helpers.js',
    'app/js/band/pop-plan.js',
    'app/js/band/brass-plan.js',
    'app/js/band/piazzolla-plan.js',
    'app/js/band/latin-plan.js',
    'app/js/band/balkan-plan.js',
    'app/js/band/cuban-plan.js',
    'app/js/band/meter-plan.js',
    'app/js/band/ternary-plan.js',
    'app/js/band/bass-lines.js',
    'app/js/band/swing-plan.js',
    'app/js/band/classic-plan.js',
    'app/js/band/phrase-plan.js',
    'app/js/band/band-state.js',
    'app/js/grid/generation.js',
    'app/js/grid/transport.js',
    'app/js/audio/drum-synths.js',
    'app/js/audio/note-events.js',
    'app/js/tonnetz-band.js',
    'app/js/colors.js',
    'app/js/tonnetz.js',
    'app/js/offline.js'
];

// Fichiers qui ne changent jamais pour une version donnée : cache d'abord, sans aller vérifier sur le réseau.
const IMMUTABLE_PREFIXES = ['app/vendor/', 'app/icons/'];

const scopeUrl = (path) => new URL(path, self.registration.scope).href;

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then((cache) => cache.addAll(SHELL_FILES.map((f) => new Request(scopeUrl(f), { cache: 'reload' }))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys
                .filter((k) => (k.startsWith('tonnetz-shell-') && k !== SHELL_CACHE) ||
                               (k.startsWith('tonnetz-sounds-') && k !== SOUNDS_CACHE))
                .map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

function relativePath(url) {
    const base = new URL(self.registration.scope);
    return url.pathname.startsWith(base.pathname) ? url.pathname.slice(base.pathname.length) : url.pathname;
}

async function cacheFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    const hit = await cache.match(request.url);
    if (hit) return hit;
    const response = await fetch(request.url);
    if (response && response.ok) cache.put(request.url, response.clone());
    return response;
}

function fetchFresh(url, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { cache: 'no-cache', signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

async function networkFirst(request) {
    const cache = await caches.open(SHELL_CACHE);
    try {
        const response = await fetchFresh(request.url, SHELL_TIMEOUT_MS);
        if (response && response.ok) cache.put(request.url, response.clone());
        return response;
    } catch (err) {
        const hit = await cache.match(request.url, { ignoreSearch: true });
        if (hit) return hit;
        if (request.mode === 'navigate') {
            const index = await cache.match(scopeUrl('index.html'));
            if (index) return index;
        }
        throw err;
    }
}

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return; // autres sites : on ne touche à rien
    const path = relativePath(url);
    if (path.startsWith('app/sounds/')) {
        event.respondWith(cacheFirst(request, SOUNDS_CACHE));
    } else if (IMMUTABLE_PREFIXES.some((p) => path.startsWith(p))) {
        event.respondWith(cacheFirst(request, SHELL_CACHE));
    } else {
        event.respondWith(networkFirst(request));
    }
});

// --- Téléchargement des sons en arrière-plan ---
async function broadcast(message) {
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    clients.forEach((c) => c.postMessage(message));
}

let precaching = null;
function precacheSounds() {
    if (precaching) return precaching;
    precaching = (async () => {
        const cache = await caches.open(SOUNDS_CACHE);
        const total = LOCAL_SOUNDFONT_FILES.length;
        let done = 0, failed = 0, downloaded = 0;
        for (const file of LOCAL_SOUNDFONT_FILES) {
            const url = scopeUrl(file);
            try {
                if (!(await cache.match(url))) {
                    await broadcast({ type: 'sounds-progress', done, total, failed });
                    const response = await fetch(url);
                    if (!response.ok) throw new Error('HTTP ' + response.status);
                    await cache.put(url, response);
                    downloaded++;
                }
                done++;
            } catch (err) {
                failed++;
            }
        }
        await broadcast({ type: 'sounds-done', done, total, failed, downloaded });
    })().finally(() => { precaching = null; });
    return precaching;
}

self.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.type === 'precache-sounds') event.waitUntil(precacheSounds());
});
