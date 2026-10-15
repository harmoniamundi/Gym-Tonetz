# Gym Tonnetz

Réseau des accords (Tonnetz) : accords touchables et transformations néo-riemanniennes P / L / R, analyse harmonique en chiffrage romain pour n'importe quelle tonique, constructeur de progressions (enregistrement, export / import), accords personnalisés, réglage complet des couleurs du réseau (six thèmes proposés, thèmes personnels enregistrables et exportables), et lecture des progressions par les orchestres de Chord scales.

## Disposition

- **À gauche** : l'accord sélectionné (son nom, cliquable : arpège ; ses notes, cliquables : chacune se joue ; les trois transformations P / L / R sur une ligne), puis les réglages (analyse harmonique, progression et orchestre, accords personnalisés, aide).
- **À droite** : le réseau, qui occupe toute la place disponible, et la barre de progression juste dessous : Lire, Boucle, Ajouter (l'accord sélectionné), le chiffrage romain (bouton aux chiffres romains), Saisie (chaque triangle touché est ajouté), Annuler ↶ et Rétablir ↷ (aussi ⌘Z / ⌘⇧Z ou Ctrl+Z / Ctrl+Maj+Z : 100 étapes, pour les accords, leur ordre et leurs durées), et Couleurs à droite ; puis les accords de la progression (deux rangées visibles au plus : au-delà, la zone défile et suit l'accord sélectionné ou en lecture), avec dessous leurs outils : Durée à gauche (½, 1, 2, 3, 4, 8 : deux accords de ½ à la suite se partagent une mesure, comme les mesures à deux accords de Chord Scales ; un ½ seul, entouré de pointillés, sonne comme une mesure entière), déplacer, Dupliquer, Retirer et Tout effacer.
- **Export / import** : « Exporter » propose le fichier Tonnetz (`.tonnetz.json`) ou une grille au format de la Jam de Chord Scales (`.grille.json`, format `chord-scales-jam-grid`). « Importer » lit les deux. Pour une grille Chord Scales : les reprises (|: :| et 1re / 2e fin) sont déroulées, une mesure partagée entre deux accords devient deux accords de ½ mesure, les accords à quatre sons ou plus sont placés sur la triade qu'ils contiennent, les basses d'accord, parties, fonctions et modulations sont ignorées, la qualité modale devient majeure ou mineure (ionien, lydien, mixolydien = majeur ; les autres = mineur).
- **Hors tonalité** : toujours atténué (gris) ; sa couleur se règle dans « Couleurs ».
- **Navigation au clavier** : quand un accord de la progression est sélectionné, les flèches ← et → passent à l'accord précédent / suivant (l'accord est joué et repéré sur le réseau ; pas de retour au début en bout de liste). Sans effet dans un champ de texte.
- **Sélection depuis le réseau** : toucher un accord sur le réseau (ou un voisin P/L/R dans le panneau d'info) sélectionne aussi sa case dans la grille du bas quand cet accord fait partie de la progression (le triangle exact en priorité ; si l'accord est répété, chaque nouveau toucher passe à l'occurrence suivante). Sinon, aucune case n'est sélectionnée. En mode saisie, le toucher ajoute l'accord comme avant.
- **Flèches de la progression** : chaque flèche cherche un passage libre entre les noms d'accord, les chiffrages romains et (si possible) les cercles des notes, et suit une courbe lisse : corps de largeur constante à bout arrondi, pointe triangulaire à base droite comme les flèches droites d'origine. Les flèches évitent de se longer ou de se superposer ; elles ne se croisent que brièvement. Quand la place manque (accords voisins), la flèche est plus courte, avec une pointe plus petite. Les trajets sont recalculés quand on change noms, chiffrage ou orthographe, et gardés en mémoire quand rien ne change.
- **Épaisseur des contours** : dans « Couleurs » (onglet Réglage, tout en bas de la liste), un curseur par type de contour — surbrillance (sélection, accord joué ; voisins et copies en proportion), accords de la progression, filets de la grille, cercles des notes, flèches — de 0 (invisible) à 6, 8 ou 10 px selon le contour. Réglage appliqué en direct, gardé dans le navigateur (clé `tonnetz.widths`), indépendant des thèmes de couleurs ; « Épaisseurs par défaut » remet les valeurs de départ.
- **Couleurs** : l'interface garde toujours le style Harmonia Mundi ; le bouton « Couleurs » (en bas à droite, dans la barre de progression) ouvre un popup déplaçable qui ne change que le réseau et les pastilles d'accords, en direct. Par défaut, le thème est « Épure ». Onglet *Réglage* : choisir un élément (fond, majeur / mineur dans la tonalité, hors tonalité, sélection, voisins P/L/R, accord joué, contour des accords de la progression, flèches (couleur et contour), notes, pastille et rouge du chiffrage romain), puis la couleur par cercle chromatique + carré saturation / luminosité, curseurs teinte / saturation / luminosité et rouge / vert / bleu, code hexadécimal, pipette (navigateurs qui la proposent : Chrome, Edge), sélecteur système, bouton « Aucune couleur » (élément transparent ; texte masqué), nuances, couleurs du thème et couleurs récentes ; un indicateur donne le contraste texte / fond et « Texte auto » choisit noir ou blanc. Onglet *Thèmes* : les six thèmes proposés (Épure, Jour, Prairie, Harmonia, Aurore, Émeraude), vos thèmes enregistrés, et l'import d'un fichier `.tonnetz-theme.json`. En bas : *Enregistrer* (sous un nom), *Exporter* (fichier `.json`) et *Rétablir*. Le choix est conservé dans le navigateur. Logique commune des thèmes : dans la tonalité, majeur en teinte claire et mineur en teinte foncée ; hors tonalité, en gris ; un accent par état (sélection, voisins P/L/R, accord joué).
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
    tonnetz.css         styles (interface fixe aux couleurs de la suite ; couleurs du réseau = thème « Épure » par défaut)
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

## Clavier et sélection dans le réseau

- **← ↑ ↓ →** : déplacent la sélection d'un triangle à l'autre (la vue suit) ; **Maj + flèche** fait seulement glisser la vue. Juste après le choix d'un accord de la progression, ← et → passent à l'accord précédent / suivant.
- **Entrée** : ajoute à la progression le triangle sélectionné.
- Deux icônes dans la barre du réseau : la mire **Recentrer** et la flèche circulaire **Désélectionner** (plus aucun triangle n'est sélectionné).
- Quand deux flèches de la progression se chevauchent, la pointe de chacune passe toujours au-dessus de l'autre flèche.
- Un accord sélectionné qui fait partie de la progression garde son contour de progression visible par-dessus la sélection ; les flèches de la progression contournent la pastille « 1 » du premier accord.
- Son sur iPhone même en mode silencieux : voir `js/audio/ios-silent-mode.js`.
- Sur téléphone, les boutons de zoom (− / +) sont masqués : on zoome en pinçant l'écran.
- **Téléphone (portrait)** : à l'ouverture, le réseau, ses boutons (une seule ligne en haut, une seule ligne en bas) et les deux rangées d'accords de la progression remplissent tout l'écran sous le titre ; les réglages sont plus bas, en faisant défiler la page. La mesure en cours et les messages s'affichent en petite étiquette sur le haut du réseau.
- **Écran toujours allumé** sur téléphone / tablette tant que l'appli est ouverte (`js/wake-lock.js`, API Screen Wake Lock : Safari iOS 16.4+, Chrome Android).
