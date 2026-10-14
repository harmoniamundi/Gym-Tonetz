# Gym Tonnetz

Réseau des accords (Tonnetz) : accords touchables et transformations néo-riemanniennes P / L / R, analyse harmonique en chiffrage romain pour n'importe quelle tonique, constructeur de progressions (enregistrement, export / import `.json`), accords personnalisés, réglage complet des couleurs du réseau (six thèmes proposés, thèmes personnels enregistrables et exportables), et lecture des progressions par les orchestres de Chord scales.

## Disposition

- **À gauche** : les réglages (accord sélectionné et transformations, analyse harmonique, progression et orchestre, accords personnalisés, aide).
- **À droite** : le réseau, qui occupe toute la place disponible, et la progression d'accords (boutons Lire / Boucle et accords) juste dessous.
- **Couleurs** : l'interface garde toujours le style Harmonia Mundi ; le bouton « Couleurs » (en haut à droite) ouvre un popup déplaçable qui ne change que le réseau et les pastilles d'accords, en direct. Par défaut, le thème est « Jour ». Onglet *Réglage* : choisir un élément (fond, majeur / mineur dans la tonalité, hors tonalité, sélection, voisins P/L/R, accord joué, chemin, notes, pastille et rouge du chiffrage romain), puis la couleur par cercle chromatique + carré saturation / luminosité, curseurs teinte / saturation / luminosité et rouge / vert / bleu, code hexadécimal, pipette (navigateurs qui la proposent : Chrome, Edge), sélecteur système, bouton « Aucune couleur » (élément transparent ; texte masqué), nuances, couleurs du thème et couleurs récentes ; un indicateur donne le contraste texte / fond et « Texte auto » choisit noir ou blanc. Onglet *Thèmes* : les six thèmes proposés (Jour, Lagon, Prairie, Harmonia, Aurore, Émeraude), vos thèmes enregistrés, et l'import d'un fichier `.tonnetz-theme.json`. En bas : *Enregistrer* (sous un nom), *Exporter* (fichier `.json`) et *Rétablir*. Le choix est conservé dans le navigateur. Logique commune des thèmes : dans la tonalité, majeur en teinte claire et mineur en teinte foncée ; hors tonalité, en gris ; un accent par état (sélection, voisins P/L/R, accord joué).
- **Réseau infini** : il se prolonge dans toutes les directions. On le déplace en glissant (souris ou doigt, molette ou glissement à deux doigts), on zoome de ×0,45 à ×4 (pincement, Ctrl + molette, boutons − / +). « Recentrer » revient sur l'accord sélectionné ou sur la tonique. Pendant la lecture, la vue suit l'accord joué s'il sort de l'écran.
- **Plein écran** (bouton ⛶ de la barre du réseau, ou touche `F`) : n'affiche que le réseau et la progression. `Échap` ou le bouton en haut à droite pour revenir. Sur iPhone (pas d'API plein écran), c'est un plein écran simulé.
- **Police Kalam** : les noms d'accords utilisent Kalam comme dans Chord Scales. Copier `Kalam-Regular.woff` et `Kalam-Bold.woff` de Chord Scales dans `app/fonts/` ; sans eux, la police manuscrite du système prend le relais.

## Lancer

- **En local** : double-cliquer sur `index.html` (aucun serveur). Le son marche, mais ni l'installation ni le mode hors ligne : les navigateurs les réservent aux adresses `https://` et `http://localhost`.
- **Installable et hors ligne** : publier le dossier tel quel (GitHub Pages, par exemple : tous les chemins sont relatifs), ou le servir sur `localhost` (`python3 -m http.server` dans le dossier, puis http://localhost:8000).

## Installer comme application

Ouvrir l'adresse publiée, puis :
- **Chrome / Edge** : icône « Installer » à droite de la barre d'adresse ;
- **Safari (Mac)** : Fichier → Ajouter au Dock ;
- **iPhone / iPad** : Partager → Sur l'écran d'accueil.

À la première visite, les ~30 Mo de sons se téléchargent en arrière-plan (pastille « Sons hors ligne : n/13 », puis « ✓ Prêt hors ligne »). Ensuite l'app s'ouvre et joue sans connexion.

## Organisation

```
index.html            page unique et ordre de chargement des scripts
sw.js                 service worker : garde l'app et les sons pour le hors ligne
manifest.webmanifest  nom, couleurs et icônes de l'app installée
app/
  README.md
  css/
    tonnetz.css         styles (interface fixe aux couleurs de la suite ; couleurs du réseau = thème « Jour » par défaut)
  fonts/                Kalam (à copier depuis Chord Scales, voir plus haut)
  js/
    colors.js           popup de réglage des couleurs du réseau, thèmes proposés / enregistrés, export et import
    tonnetz.js          interface : réseau infini (dessiné à la demande), zoom et déplacement, plein écran, analyse, progression, accords personnalisés, sauvegardes
    tonnetz-band.js     orchestre : lit la progression (piano, basse, batterie, cuivres…)
    theory.js           gammes, accords, noms de notes
    band-patterns.js    tables de rythmes et de motifs des styles
    audio-config.js     constantes audio (octave de lecture, niveau maître, clic)
    offline.js          enregistre le service worker, télécharge les sons, affiche la pastille d'état
    audio/              synthèse de batterie, calcul des notes jouées, chargement des sons locaux
    band/               plans d'accompagnement par style et par mesure (swing, pop, latin, cuba, brass, balkans, tango…), état de l'orchestre
    grid/               mécanique de lecture (temps, boucle, fin) et utilitaires de grille
  icons/                icônes de l'app (192, 512, maskable, iOS)
  vendor/
    soundfont-player.min.js   lecteur d'échantillons (licence incluse)
  sounds/
    FluidR3_GM/ MusyngKite/   échantillons des 13 instruments (licence incluse)
```

`sw.js` et `manifest.webmanifest` restent à la racine : un service worker ne contrôle que le dossier où il se trouve, il doit donc être à côté de `index.html`.

## Notes

- Les réglages et les progressions enregistrées restent dans le navigateur (clé `tonnetz.settings`).
- Les échantillons sont servis par le dossier `app/sounds/` : aucune ressource n'est chargée depuis Internet.
- **Si on ajoute ou retire un fichier**, mettre à jour la liste `SHELL_FILES` de `sw.js` (sinon l'installation échoue ou le fichier manque hors ligne). Pour publier une nouvelle version, aucun numéro à changer : l'app prend toujours la dernière version en ligne.
- Pour ajouter un instrument : déposer son fichier dans `app/sounds/` et l'ajouter à la liste de `app/js/audio/local-soundfonts.js`.
