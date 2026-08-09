# Mina Vision — tâches restantes de réconciliation

> État au 2026-08-09 01:56 (Africa/Lagos). Ce tableau consolide les dernières preuves du [journal de réconciliation](2026-07-29-mina-reconciliation-log.md), de la [preuve de release](../../operations/RELEASE-EVIDENCE-2026-07.md) et du [ledger du chat natif](2026-07-29-mina-native-chat-scope-ledger.md). Il ne transforme aucune recette matérielle, compte externe ou décision produit en succès.

## Clos avec preuve récente

- [x] Validation unitaire après le fallback OCR : `421` fichiers / `3 395` tests passés par `npx vitest run --exclude tests/integration/** --maxWorkers=1 --no-file-parallelism` en `321,17 s`. Les intégrations et smoke Electron historiques ne sont pas rejoués dans cette vague OCR.
- [x] Firebase local : projet et app Android inventoriés en lecture seule ; règles owner/device testées dans Auth/Firestore/RTDB/Storage Emulator sur loopback (`6/6` chat + smoke backup historique). Le diagnostic refuse aussi, avant signature, un compte de service d'un autre projet. Ces règles locales ne sont pas déployées dans le projet cloud.
- [x] Firebase cloud : une clé de compte de service Mina Vision est configurée uniquement dans `env/` ignoré ; la release Storage active refuse l’anonyme. Une recette réelle avec UID temporaire a vérifié custom token, Firestore valide/refus invalide, Storage propriétaire/refus inter-propriétaire, puis sauvegarde chiffrée et restauration. La recette a supprimé ses objets et son utilisateur ; le listing Storage final est vide. La sonde locale reste volontairement `firebase_cloud_unverified`, car elle ne fait aucun appel cloud implicite.
- [x] Autorité Firebase opérationnelle : la dernière consigne Nasro désigne `mina.vision.ai@gmail.com`, via l’index navigateur `/u/5`, pour les prochaines opérations Mina. Le compte `/u/0` `mina.vision.ai@gmail.com` n’est pas autorisé pour ces opérations. Aucun paramètre Firebase ni ressource cloud n’a été modifié par cette décision.
- [x] LM Studio local : génération texte et embedding Mina passés avec Gemma et Nomic chargés.
- [x] TTS locale hors réseau : Kokoro a effectué un warm-up puis une synthèse française PCM à `24 000 Hz` avec `MINA_OFFLINE=true`, sans microphone ni téléchargement.
- [x] Vision locale Mina : l’adaptateur réellement utilisé par Mina a analysé une image locale de contrôle avec Gemma à `4096` tokens et un flux. La réponse finale a été reçue séparément du raisonnement du modèle ; seul ce contenu final est consommé par Mina. Le flag est activé uniquement dans `.env` local après cette sonde ; `.env.example` conserve le défaut désactivé. Cette preuve ne couvre pas une webcam ou une caméra téléphone physique.
- [x] Fallback OCR local : Tesseract est composé après un échec ou une réponse vide de la vision, sans réseau ni téléchargement. Le test réel d’une image synthétique a retourné `MINA OCR TEST` via `tesseract:eng` ; seules les langues locales `eng` et `osd` sont présentes, pas `fra`.
- [x] Durcissement FCM Android : le service n’accepte qu’un signal opaque strict (`type`, `ownerId`, `deviceId`, `highWatermark`), ciblé par claims Firebase et planifié par WorkManager unique. Auto-init Messaging et Analytics sont désactivés. Le commit `071d279` a passé le lint/APK, le test Kotlin ciblé (`3/3`) et le contrat Node (`1/1`). Cette preuve ne vaut ni enregistrement FCM/FID live, ni relais cloud propriétaire prêt.
- [x] APK debug Android : l’APK issu du lint/build a été installé et comparé par SHA-256 sur le Huawei USB et le Samsung A71 ADB Wi-Fi, sous le package distinct `fr.mina.gateway.debug`. Cette installation ne constitue pas un parcours applicatif ni une recette Telegram/SMS.
- [x] Indexation initiale Mina Code : corpus réel de `935` fichiers indexé en `23 481 ms`, sous l'objectif historique `<30 s`.
- [x] Avatar VRM : explicitement hors périmètre ; aucun asset, modèle, dépendance ou distribution VRM ne doit être ajouté.

## Reste à faire — décision ou prérequis nécessaire

### Runtime local

- [ ] **Vision Mina par webcam PC et caméra téléphone** — les deux captures sont présentes dans le code (`getUserMedia` côté PC, flux Android signé côté téléphone) et l’adaptateur vision a désormais une preuve image locale. Il reste à tester les permissions, la capture matérielle et le trajet complet sur webcam PC puis téléphone Android autorisé. Ces recettes n’ont pas été exécutées.
- [ ] **Voix locale complète hors réseau** — Kokoro TTS est maintenant prouvé localement hors réseau. Il reste microphone → STT local → Gemma → Kokoro, réseau désactivé. `MINA_STT_ENABLED=false` et aucun cache Whisper/Xenova n'a été trouvé dans les emplacements configurés/attendus ; le code ne lira désormais qu'un modèle STT déjà local en mode hors-ligne. Aucun téléchargement, transcription réelle ni test microphone n'a été lancé.
- [ ] **Packaging voix locale** — décision de distribution eSpeak/Kokoro requise avant publication de ce chemin.

### Exécution autorisée, encore à réconcilier et terminer

- [ ] **Grounding live** — l’exécution selon le plan et la spécification est autorisée. Il reste à réconcilier le code actuel avec le contrat de corrélation `claimId`, puis à implémenter et prouver les chemins `startMission` et `phoneMessageSync` sans annoncer de citation live avant test.
- [ ] **Chat natif Android, option A** — Nasro a choisi le chat complet des tâches 13–25. La notification Android n’expose plus le texte de réponse (`2185166`), les règles owner/device sont prouvées localement (`335d8e9`) et le réveil FCM est fail-closed (`071d279`). L’historique Android charge maintenant explicitement des pages de `50` avec curseur tuple et garde au plus `200` objets déchiffrés dans l’état UI : `ChatRepositoryTest` (`23/23`) et `ChatHistoryWindowTest` (`3/3`) sont sans échec, et la gate Android fraîche a retourné `GRADLE_EXIT=0`. Le test Compose a seulement été compilé : aucun appareil n’étant attaché, il ne vaut pas recette instrumentée. La migration notes/PTT PCM chiffrée reste partielle et la tâche 21 de voix live n’est pas commencée. Il reste la migration du relais Firebase anonyme vers une identité propriétaire/appareil avec custom claims, App Check, Functions et enregistrement FID/FCM explicite ; tant qu’elle n’existe pas, le réveil FCM est volontairement ignoré et aucune tâche Android 13–25 ne peut être déclarée complète.
- [ ] **Téléchargement de pièces jointes mail** — l’implémentation reste à concevoir contre le contrat de récupération, quarantaine et persistance chiffrée ; le contenu brut n’est pas persisté actuellement et `downloadAttachment` ne doit pas être annoncé comme disponible.
- [ ] **Documents / impression** — l’exécution plan/spécification est autorisée ; il reste à identifier les implémentations réellement présentes, compléter le renderer requis et réaliser une recette d’impression physique avant de déclarer la capacité disponible.

### Preuves externes ou physiques

- [ ] **Android utilisateur** — le Huawei USB et le Samsung A71 ADB Wi-Fi ont historiquement reçu l’APK debug vérifié. À la dernière vérification, `adb devices -l` n’a listé aucun appareil : le parcours application, le provisioning local et les permissions caméra/micro, SMS et Telegram restent donc à prouver. Le propriétaire indique que l’APK de référence et un fichier `.env` local contiennent des données de provisioning ; ce fichier n’a pas été lu pendant cette réconciliation, ne doit pas être exposé, et l’APK de référence ne doit pas être écrasé. Toute réinstallation autorisée exige une saisie locale du provisioning. Le test instrumentation isolé passé ne prouve pas ces parcours.
- [ ] **Google Home** — SDK signé, relais autorisé et recette sur lumière non critique, supervisée.
- [ ] **Mail fournisseurs** — comptes de test dédiés, consentement OAuth/TLS et opérations réversibles réelles par fournisseur.
- [ ] **Windows Sandbox** — preuve d'isolation physique dédiée.
- [ ] **Chrome via l'extension demandée** — réinstaller/réparer le plugin navigateur Codex : l'extension est installée, mais son hôte natif Chrome n'est pas enregistré ; aucune navigation de contournement n'est utilisée.

## Ordre de reprise proposé

1. Réconcilier le code courant avec les plans chat Android, grounding, documents et impression, puis traiter les écarts test par test.
2. Provisionner un modèle STT local avant toute transcription ; installer explicitement `fra` pour l’OCR français si cette qualité est requise.
3. Connecter les matériels autorisés pour les recettes webcam, Android et microphone ; conserver Home, mail et Sandbox à des actions séparément autorisées.
4. Rejouer `npm run verify:release` après la prochaine vague de code et actualiser ce tableau avec les sorties réellement observées.
