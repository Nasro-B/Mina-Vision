# Mina Vision — agent visuel local

Mina contrôle le navigateur, le bureau Windows (n'importe quelle application, pas seulement celles déjà ouvertes) et un téléphone Android autorisé en ADB. Elle peut écouter une instruction vocale (compréhension dynamique, pas un lexique figé), observer l’écran, cliquer, saisir, défiler, lancer et piloter des missions à la voix, exécuter la mission Google Photos dentaire, analyser son propre code, générer de vrais documents PDF/Word, et expliquer ses propres erreurs techniques avec un remède concret.

Guide complet des capacités, commandes vocales et limites : bouton ⚙️ dans l’app, ou `src/ui/help.html`.

## Sécurité avant premier usage

Les clés présentes pendant la configuration ont été exposées dans une sortie locale. Elles doivent être révoquées et recréées avant toute connexion. Ne réutilisez pas les anciennes valeurs.

Après rotation de `GEMINI_API_KEY`, `OPENROUTER_API_KEY` et des jetons Modal concernés, ajoutez dans `.env` :

```env
MINA_KEYS_ROTATED=true
```

Sans ce marqueur, l’interface démarre mais bloque volontairement les fournisseurs IA. Les secrets ne sont jamais affichés dans le diagnostic.

## Lancer Mina

Double-cliquez sur `Mina` sur le Bureau ou sur `Lancer Mina.cmd` dans ce dossier. Le premier lancement peut prendre environ 25 à 30 secondes sur cette machine.

Arrêt global : `Ctrl + Alt + Échap` ou le bouton **Arrêt d’urgence**.

## Voix

Activez **Live Stream**, puis utilisez l’une des phrases :

- « Salut Mina »
- « Bonjour Mina »
- « Mina, comment ça va ? »
- « Mina, <votre demande> » directement

Vous pouvez donner l’instruction dans la même phrase ou juste après. Un verbe d’action seul en début de phrase (« lance… », « ouvre… », « cherche… ») suffit aussi, sans dire « Mina » avant.

**Couper sa parole** : dites « stop », « chut », « tais-toi » ou « silence » à tout moment pendant qu’elle parle — coupure immédiate, y compris au tout début d’une phrase ; elle continue d’écouter. « Mina, arrête » va plus loin : elle se tait ET arrête complètement d’écouter.

**Mode pause** : « mets-toi en pause » (ou juste « pause ») la fait taire et ignorer toute voix entendue — y compris une conversation ambiante — jusqu’à ce que son nom soit prononcé (« Mina », « reprends Mina »). Aucune mission, aucun outil, aucun son ne part pendant la pause.

Mina comprend aussi des formulations jamais listées ici (compréhension dynamique via le modèle vocal) — la liste ci-dessus est une référence rapide, pas une limite de vocabulaire. Guide complet (bouton ⚙️ dans l’app) : `src/ui/help.html`.

Pendant qu’une mission tourne, une nouvelle instruction vocale ne relance jamais une deuxième mission concurrente : elle est transmise à la mission en cours. Tant qu’une page média (YouTube…) reste ouverte, les phrases suivantes la pilotent directement (« mets cheb hasni », « la chanson 2 », « mets sur pause », « chanson suivante »).

## Téléphone Android (Huawei par USB, Samsung par Wi-Fi)

1. Activez les options développeur et le débogage USB sur le téléphone.
2. Branchez-le, déverrouillez-le et acceptez l’empreinte RSA ADB.
3. Dans Mina, cliquez **Détecter le Huawei**, puis **Ouvrir la caméra**.

Mina exige exactement un appareil ADB autorisé. La caméra est pilotée sur le téléphone et prévisualisée avec scrcpy ; le flux n’est pas enregistré par défaut.

Un second appareil (ex. Samsung) peut rester connecté en parallèle par Wi-Fi (débogage sans fil activé côté téléphone) : `MINA_SAMSUNG_ADB_SERIAL` dans `.env`. Mina retrouve automatiquement sa dernière adresse connue si l’annonce réseau du téléphone reste muette (comportement de certains constructeurs), toujours avec vérification d’identité avant reconnexion.

## Google Photos dentaire

`MINA_DRY_RUN=true` analyse sans sélectionner ni télécharger. Avec `false`, les images correspondantes sont sélectionnées, mais le téléchargement exige encore une confirmation native explicite.

## Recherche, téléchargement et impression

- **Navigateur** : ouvrir une URL, rechercher, cliquer, saisir du texte, défiler et télécharger après confirmation.
- **Bureau** : contrôler Chrome et les fenêtres Windows, ouvrir `Ctrl+P`, choisir une imprimante déjà configurée sur le réseau et lancer l’impression après confirmation.

L’ajout d’une nouvelle imprimante ou la modification de Windows reste une action système sensible. Mina demandera une autorisation et ne contournera jamais les identifiants ou permissions du réseau.

## Mémoire locale chiffrée

Se déverrouille automatiquement à chaque démarrage. Si le chiffrement Windows change (migration de profil, réinstallation), un déverrouillage avec la phrase de récupération suffit une seule fois — la réparation est ensuite automatique et permanente.

## Mina Code — agent de développement (auto-analyse)

Section « Code » du tableau de bord, ou à la voix (« Mina, analyse le code », « cherche dans le code… », « statut Git », « lance les tests », « revue du code »). Indexe et analyse le code source de Mina Vision elle-même — pas un projet externe. Lecture, recherche, tests et revue de sécurité sans confirmation ; toute écriture de fichier ou commit Git reste soumise à confirmation, jamais de `git push`.

## Documents

« Mina, génère-moi un [PDF ou Word] sur… » : elle rédige le contenu et crée un vrai fichier dans `Documents\Mina Vision\`, jamais d’écrasement d’un fichier existant.

## Développement

```powershell
npm test
npm run smoke
```

Le profil Chrome de Mina est séparé du profil personnel. Les captures d’écran restent en mémoire et les applications sensibles, terminaux et gestionnaires de mots de passe sont bloqués — y compris au lancement d’une application.
