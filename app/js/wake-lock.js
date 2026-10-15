// wake-lock.js — sur téléphone et tablette (écran tactile), l'écran ne se met pas en veille tant que l'appli est ouverte et visible.
// Utilise l'API Screen Wake Lock (Safari iOS 16.4+, Chrome Android). Le verrou est perdu quand on quitte l'appli ou verrouille l'écran :
// on le redemande au retour, et au premier toucher (certains navigateurs n'accordent le verrou qu'après un geste de l'utilisateur).
// Sur ordinateur, rien n'est demandé.

(function () {
    'use strict';
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    const touchDevice = () => { try { return window.matchMedia('(pointer: coarse)').matches; } catch (e) { return false; } };
    let lock = null, pending = false;

    async function acquire() {
        if (lock || pending || document.visibilityState !== 'visible' || !touchDevice()) return;
        pending = true;
        try {
            lock = await navigator.wakeLock.request('screen');
            lock.addEventListener('release', () => { lock = null; });
        } catch (e) { lock = null; }
        pending = false;
    }

    acquire();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') acquire(); });
    ['pointerdown', 'touchend', 'click', 'keydown'].forEach((evt) => document.addEventListener(evt, acquire, { capture: true, passive: true }));
})();
