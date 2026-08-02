# Mina Vision — tâches restantes de réconciliation

> État au 2026-08-02 10:17 (Africa/Lagos). Ce tableau consolide les dernières preuves du [journal de réconciliation](2026-07-29-mina-reconciliation-log.md), de la [preuve de release](../../operations/RELEASE-EVIDENCE-2026-07.md) et du [ledger du chat natif](2026-07-29-mina-native-chat-scope-ledger.md). Il ne transforme aucune recette matérielle, compte externe ou décision produit en succès.

## Clos avec preuve récente

- [x] Validation complète après le garde-fou vision : `418` fichiers / `3 388` tests unitaires, `18` fichiers / `49` tests d'intégration et les deux smoke Electron passés.
- [x] Firebase local : projet et app Android inventoriés en lecture seule ; règles testées dans Auth/Firestore/Storage Emulator sur loopback. Le diagnostic refuse aussi, avant signature, un compte de service d'un autre projet.
- [x] LM Studio local : génération texte et embedding Mina passés avec Gemma et Nomic chargés.
- [x] Garde-fou vision locale : Gemma image est désactivé par défaut et ne peut être réactivé qu'après une sonde image réussie ; les captures webcam PC et caméra téléphone ne sont pas supprimées.
- [x] Indexation initiale Mina Code : corpus réel de `935` fichiers indexé en `23 481 ms`, sous l'objectif historique `<30 s`.
- [x] Avatar VRM : explicitement hors périmètre ; aucun asset, modèle, dépendance ou distribution VRM ne doit être ajouté.

## Reste à faire — décision ou prérequis nécessaire

### Runtime local

- [ ] **Vision Mina par webcam PC et caméra téléphone** — les deux captures sont présentes dans le code (`getUserMedia` côté PC, flux Android signé côté téléphone), mais aucune recette matérielle n'a été exécutée. Gemma a de nouveau crashé sur un JPEG synthétique 1×1 même avec `4096` tokens et un seul flux (`18446744072635812000`); `LM_STUDIO_VISION_ENABLED=false` empêche désormais cette route locale de recevoir une image. Réactiver seulement après une sonde image réussie avec un modèle stable, puis tester la permission webcam et un téléphone Android autorisé. L'unique autre modèle vision inventorié pèse `7,95 GiB` : il n'a pas été chargé.
- [ ] **Voix locale complète hors réseau** — la recette requiert microphone → STT local → modèle → TTS, réseau désactivé. Kokoro n'était pas présent dans le cache local et la mémoire libre mesurée est `1,87 GiB`; aucun téléchargement ni chargement n'a été lancé.
- [ ] **Packaging voix locale** — décision de distribution eSpeak/Kokoro requise avant publication de ce chemin.

### Contrats produit à choisir avant code

- [ ] **Grounding live** — choisir le contrat de corrélation `claimId` entre proposition, rendu et citation avant de raccorder `startMission` ou `phoneMessageSync`.
- [ ] **Chat natif Android** — choisir l'option A (tâches 13–25, chat complet) ou B (socle expérimental limité et limites publiées). Le ledger constate `102` chemins déclarés, `4` présents et `98` absents pour les tâches 13–25 ; cette mesure ne valide pas fonctionnellement les quatre présents.
- [ ] **Téléchargement de pièces jointes mail** — choisir et autoriser le contrat de récupération, quarantaine et persistance chiffrée. Le contenu brut n'est pas persisté actuellement ; `downloadAttachment` ne doit pas être annoncé comme disponible.
- [ ] **Documents / impression** — fournir ou choisir un renderer de formulaire réel, puis une recette d'impression physique si cette capacité doit devenir disponible.

### Preuves externes ou physiques

- [ ] **Firebase cloud** — lecture seule vérifiée le `2026-08-02 10:12` : la base Firestore `(default)` existe (`FIRESTORE_NATIVE`, `eur3`) et publie `cloud.firestore`. Après normalisation, la seule différence source est le refus catch-all explicite du fichier local (`match /{document=**} { allow read, write: if false; }`), absent de la release distante ; cela ne prouve pas un écart de comportement sans recette cloud. Le bucket `gs://mina-vision.firebasestorage.app` existe désormais (`US-CENTRAL1`, `REGIONAL`, rétention douce `7` jours), mais la release `firebase.storage` retourne encore `404`. Le compte `firebase-adminsdk-fbsvc@mina-vision.iam.gserviceaccount.com` existe, mais le fichier local actuel appartient à `mina-vission` et est refusé. Il faut maintenant autoriser explicitement : nouvelle clé ou endpoint du compte `mina-vision`, déploiement des règles Storage/Firestore et recette cloud avec écritures éphémères.
- [ ] **Android utilisateur** — parcours application, permissions caméra/micro, SMS et Telegram sur appareil autorisé. Le test instrumentation isolé passé ne prouve pas ce parcours.
- [ ] **Google Home** — SDK signé, relais autorisé et recette sur lumière non critique, supervisée.
- [ ] **Mail fournisseurs** — comptes de test dédiés, consentement OAuth/TLS et opérations réversibles réelles par fournisseur.
- [ ] **Windows Sandbox** — preuve d'isolation physique dédiée.
- [ ] **Chrome via l'extension demandée** — réinstaller/réparer le plugin navigateur Codex : l'extension est installée, mais son hôte natif Chrome n'est pas enregistré ; aucune navigation de contournement n'est utilisée.

## Ordre de reprise proposé

1. Décider le périmètre chat natif, le contrat grounding et le contrat de pièces jointes.
2. Fournir ou autoriser les prérequis locaux voix/vision ; effectuer ensuite les sondes dédiées.
3. Donner un feu vert explicite, action par action, pour Firebase cloud, Android, Home, mail et Sandbox.
4. Rejouer `npm run verify:release` après toute nouvelle vague de code et actualiser ce tableau avec les sorties réellement observées.
