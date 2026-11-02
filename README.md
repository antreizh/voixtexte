# VTS

<img src="icons/icon-192.png" alt="Icône VTS" width="96">

Application web (PWA) qui **retranscrit en texte, en temps réel**, ce que capte le micro de votre smartphone.

## Fonctionnalités

- Transcription en direct : les mots s'affichent pendant que vous parlez (en gris), puis se fixent une fois reconnus.
- Écoute continue : relance automatique après les silences.
- Plusieurs langues (français par défaut, anglais, espagnol, allemand, italien, portugais, breton…).
- Copier, partager (menu de partage du téléphone) ou télécharger le texte en `.txt`.
- **Enregistrement au fil de la voix** : chaque phrase reconnue est sauvegardée sur l'appareil
  dès qu'elle est validée, avec son heure. Rien n'est perdu si l'appli se ferme ou si le
  téléphone s'éteint.
- **Historique** (📚) : ➕ démarre un nouvel enregistrement, les précédents restent consultables,
  réouvrables (pour continuer à dicter dedans) ou supprimables.
- Export horodaté en option : `[14:32:05] Bonjour à tous`.
- L'écran reste allumé pendant l'écoute.
- **Écran noir pendant l'écoute** : dès qu'on lance la dictée, l'écran devient entièrement noir
  (discret, et économe en batterie sur les écrans OLED) ; la transcription continue en dessous.
  Un toucher sur le **petit coin gris en bas à droite** réaffiche l'appli ; « 🌑 Masquer » la
  remasque. Désactivable dans ⚙️ Réglages.
- Installable sur l'écran d'accueil, thème clair/sombre automatique.

## Compte-rendu de réunion 📝

Le bouton 📝 transforme la transcription en compte-rendu structuré, modifiable, puis exporté en
document professionnel aux couleurs de votre organisation.

**1. Mots-clés à dicter** (reconnus en début de phrase, affichés en badges colorés) :

| Vous dites | Résultat |
|---|---|
| « Point suivant : budget 2027 » | nouveau point de l'ordre du jour |
| « Décision : on valide le prestataire » | ligne du tableau des décisions |
| « Action : Marie envoie le devis pour vendredi » | action + responsable (Marie) + échéance (vendredi) |
| « Participants : Paul, Marie et Ahmed » | liste des présents |
| « Prochaine réunion : mardi 10 h » | date de la prochaine réunion |

Un mot-clé dit seul, suivi d'une pause, s'applique à la phrase suivante.

**2. Rédaction par Claude (facultatif)** : « ✨ Rédiger avec Claude » envoie la transcription à
l'API d'Anthropic, qui renvoie un compte-rendu rédigé (synthèse, points, décisions, actions).
Il faut une clé d'API personnelle (⚙️ Réglages), facturée à l'usage. Elle reste stockée sur
l'appareil. Relisez toujours le résultat avant diffusion.

**3. Export** : 👁️ aperçu, 📄 PDF (via l'impression du navigateur : « Enregistrer au format PDF »),
💾 Word (.docx modifiable) ou 📤 partage direct du fichier Word. Nom automatique :
`CR_2026-11-02_Comite-de-pilotage.docx`.

**Charte** (⚙️ Réglages) : nom de l'organisation, logo, couleur principale, rédacteur par défaut,
mention de pied de page. Le document comprend un en-tête avec logo, un tableau d'informations,
des sections numérotées, les tableaux des décisions et des actions, une pagination et, en option,
la transcription intégrale en annexe.

## Utilisation sur smartphone

1. Ouvrez l'adresse de l'appli (en **HTTPS**) :
   - Android : **Chrome** (recommandé)
   - iPhone : **Safari** (iOS 14.5 ou plus)
2. Appuyez sur le bouton micro et autorisez l'accès au microphone.
3. Pour l'installer : menu ⋮ → « Ajouter à l'écran d'accueil » (Android) ou bouton Partager → « Sur l'écran d'accueil » (iPhone).

## Mise en ligne

L'appli est 100 % statique (HTML/CSS/JS, aucun serveur). Les bibliothèques `docx` (Word) et
`@anthropic-ai/sdk` (Claude) sont intégrées dans `vendor/` (licence MIT). Le workflow
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
