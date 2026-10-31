# VoixTexte

Application web (PWA) qui **retranscrit en texte, en temps réel**, ce que capte le micro de votre smartphone.

## Fonctionnalités

- Transcription en direct : les mots s'affichent pendant que vous parlez (en gris), puis se fixent une fois reconnus.
- Écoute continue : relance automatique après les silences.
- Plusieurs langues (français par défaut, anglais, espagnol, allemand, italien, portugais, breton…).
- Copier, partager (menu de partage du téléphone) ou télécharger le texte en `.txt`.
- Le texte est conservé sur l'appareil même si vous fermez l'appli.
- L'écran reste allumé pendant l'écoute.
- Installable sur l'écran d'accueil, thème clair/sombre automatique.

## Utilisation sur smartphone

1. Ouvrez l'adresse de l'appli (en **HTTPS**) :
   - Android : **Chrome** (recommandé)
   - iPhone : **Safari** (iOS 14.5 ou plus)
2. Appuyez sur le bouton micro et autorisez l'accès au microphone.
3. Pour l'installer : menu ⋮ → « Ajouter à l'écran d'accueil » (Android) ou bouton Partager → « Sur l'écran d'accueil » (iPhone).

## Mise en ligne

L'appli est 100 % statique (HTML/CSS/JS, aucun serveur ni clé d'API). Le workflow
`.github/workflows/pages.yml` la publie sur GitHub Pages à chaque push sur `main` :
`https://<utilisateur>.github.io/voixtexte/`. Si besoin, activez Pages dans
**Settings → Pages → Source : GitHub Actions**.

Test en local (sur ordinateur) :

```sh
python3 -m http.server 8000
# puis ouvrir http://localhost:8000 dans Chrome
```

## Limites à connaître

- La reconnaissance utilise le moteur vocal intégré au navigateur (Web Speech API). Sur Chrome
  et Safari, l'audio est généralement traité par les serveurs de Google ou d'Apple : **une connexion
  internet est nécessaire**.
- L'appli écoute **le micro** : elle transcrit ce qui est dit autour du téléphone (conférence,
  conversation, haut-parleur…). Un navigateur ne peut pas capter directement le son interne d'une
  autre appli (vidéo, appel) ; dans ce cas, faites jouer le son sur le haut-parleur.
- Firefox ne prend pas en charge la reconnaissance vocale.
