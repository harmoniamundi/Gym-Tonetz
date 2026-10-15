// ios-silent-mode.js — fait jouer les sons de l'appli sur iPhone/iPad même quand l'interrupteur « silencieux » est activé.
// Par défaut, iOS coupe tout ce que produit Web Audio (AudioContext) en mode silencieux. Deux parades combinées :
//   1) navigator.audioSession.type = 'playback' (Safari iOS 16.4+) : l'appli est traitée comme un lecteur de média ;
//   2) secours pour les iOS plus anciens : une piste <audio> totalement silencieuse, en boucle, lancée au premier
//      toucher — tant qu'elle « joue », iOS route aussi le son Web Audio comme de la lecture multimédia.
// Chargé avant tout le reste ; tonnetz.js appelle unlockIOSAudio() depuis ensureCtx() (donc depuis un geste de l'utilisateur).

(function () {
    'use strict';
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return;

    function setPlaybackSession() {
        try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
    }
    setPlaybackSession();   // le plus tôt possible, avant la création de l'AudioContext

    const ua = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!isIOS) { window.unlockIOSAudio = function () {}; return; }

    // WAV mono 16 bits de silence (1 s à 8 kHz), construit à la volée : pas de fichier en plus à embarquer.
    function silentWavUrl() {
        const rate = 8000, n = rate, bytes = n * 2;
        const buf = new ArrayBuffer(44 + bytes), v = new DataView(buf);
        const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
        str(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); str(8, 'WAVE'); str(12, 'fmt ');
        v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
        v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
        str(36, 'data'); v.setUint32(40, bytes, true);
        return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    }

    let el = null;
    function playSilentTrack() {
        try {
            if (!el) {
                el = document.createElement('audio');
                el.setAttribute('playsinline', '');
                el.setAttribute('x-webkit-airplay', 'deny');
                el.preload = 'auto';
                el.loop = true;
                el.src = silentWavUrl();
            }
            if (el.paused) {
                const p = el.play();
                if (p && p.catch) p.catch(() => {});
            }
        } catch (e) {}
    }

    function unlock() {
        setPlaybackSession();
        playSilentTrack();
    }
    window.unlockIOSAudio = unlock;

    // Premier geste de l'utilisateur (n'importe où) : lance la piste silencieuse, sans attendre le premier son.
    ['touchend', 'pointerdown', 'click', 'keydown'].forEach((evt) => {
        document.addEventListener(evt, unlock, { capture: true, passive: true });
    });
    // iOS met la piste en pause quand l'appli passe en arrière-plan : on la relance au retour.
    document.addEventListener('visibilitychange', () => { if (!document.hidden && el) playSilentTrack(); });
})();
