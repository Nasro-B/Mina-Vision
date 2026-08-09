# Mina Vision — tâches restantes de réconciliation

> État au 2026-08-09 10:51 (Africa/Lagos). Ce tableau consolide les dernières preuves du [journal de réconciliation](2026-07-29-mina-reconciliation-log.md), de la [preuve de release](../../operations/RELEASE-EVIDENCE-2026-07.md) et du [ledger du chat natif](2026-07-29-mina-native-chat-scope-ledger.md). Il ne transforme aucune recette matérielle, compte externe ou décision produit en succès.

## Clos avec preuve récente

- [x] Validation unitaire après le fallback OCR : `421` fichiers / `3 395` tests passés par `npx vitest run --exclude tests/integration/** --maxWorkers=1 --no-file-parallelism` en `321,17 s`. Les intégrations et smoke Electron historiques ne sont pas rejoués dans cette vague OCR.
- [x] Firebase local : projet et app Android inventoriés en lecture seule ; règles owner/device testées dans Auth/Firestore/RTDB/Storage Emulator sur loopback (`6/6` chat + smoke backup historique). Le diagnostic refuse aussi, avant signature, un compte de service d'un autre projet. Ces règles locales ne sont pas déployées dans le projet cloud.
- [x] Firebase cloud : une clé de compte de service Mina Vision est configurée uniquement dans `env/` ignoré ; la release Storage active refuse l’anonyme. Une recette réelle avec UID temporaire a vérifié custom token, Firestore valide/refus invalide, Storage propriétaire/refus inter-propriétaire, puis sauvegarde chiffrée et restauration. La recette a supprimé ses objets et son utilisateur ; le listing Storage final est vide. La sonde locale reste volontairement `firebase_cloud_unverified`, car elle ne fait aucun appel cloud implicite.
- [x] LM Studio local : génération texte et embedding Mina passés avec Gemma et Nomic chargés.
- [x] TTS locale hors réseau : Kokoro a effectué un warm-up puis une synthèse française PCM à `24 000 Hz` avec `MINA_OFFLINE=true`, sans microphone ni téléchargement.
- [x] Vision locale Mina : l’adaptateur réellement utilisé par Mina a analysé une image locale de contrôle avec Gemma à `4096` tokens et un flux. La réponse finale a été reçue séparément du raisonnement du modèle ; seul ce contenu final est consommé par Mina. Le flag est activé uniquement dans `.env` local après cette sonde ; `.env.example` conserve le défaut désactivé. Cette preuve ne couvre pas une webcam ou une caméra téléphone physique.
- [x] Fallback OCR local : Tesseract est composé après un échec ou une réponse vide de la vision, sans réseau ni téléchargement. Le test réel d’une image synthétique a retourné `MINA OCR TEST` via `tesseract:eng` ; seules les langues locales `eng` et `osd` sont présentes, pas `fra`.
- [x] Durcissement FCM Android : le service n’accepte qu’un signal opaque strict (`type`, `ownerId`, `deviceId`, `highWatermark`), ciblé par claims Firebase et planifié par WorkManager unique. Auto-init Messaging et Analytics sont désactivés. Le commit `071d279` a passé le lint/APK, le test Kotlin ciblé (`3/3`) et le contrat Node (`1/1`). Cette preuve ne vaut ni enregistrement FCM/FID live, ni relais cloud propriétaire prêt.
- [x] APK debug Android : l’APK issu du lint/build a été installé et comparé par SHA-256 sur le Huawei USB et le Samsung A71 ADB Wi-Fi, sous le package distinct `fr.mina.gateway.debug`. Cette installation ne constitue pas un parcours applicatif ni une recette Telegram/SMS.
- [x] Indexation initiale Mina Code : corpus réel de `935` fichiers indexé en `23 481 ms`, sous l'objectif historique `<30 s`.
- [x] Avatar VRM : explicitement hors périmètre ; aucun asset, modèle, dépendance ou distribution VRM ne doit être ajouté.
- [x] Parsing documentaire local partiel : le runtime compose maintenant la quarantaine avec les parseurs PDF à texte natif et image PNG/JPEG via Tesseract, puis conserve les observations et propositions de classification dans des stores SQLite locaux. Le panneau Mina accepte désormais un chemin explicitement saisi, lance quarantaine → extraction locale → proposition de classement après un clic, et affiche uniquement les métadonnées redacted (type, pages, compte de blocs, confiance, classement) : ni octets bruts ni texte extrait ne traversent la réponse `parse` vers le renderer. Les `15` tests documents/UI ciblés ont passé (`111` tests), le smoke Electron isolé a rendu `SMOKE OK`, puis `npm test` a rendu `432` fichiers unitaires / `3 481` tests passés / `6` ignorés et `18/18` fichiers d’intégration / `49/49` tests. Cette preuve ne couvre aucun document utilisateur, PDF scanné ni impression.

## Reste à faire — décision ou prérequis nécessaire

### Runtime local

- [ ] **Vision Mina par webcam PC et caméra téléphone** — les deux captures sont présentes dans le code (`getUserMedia` côté PC, flux Android signé côté téléphone) et l’adaptateur vision a désormais une preuve image locale. Il reste à tester les permissions, la capture matérielle et le trajet complet sur webcam PC puis téléphone Android autorisé. Ces recettes n’ont pas été exécutées.
- [ ] **Voix locale complète hors réseau** — Kokoro TTS est maintenant prouvé localement hors réseau. Il reste microphone → STT local → Gemma → Kokoro, réseau désactivé. `MINA_STT_ENABLED=false` et aucun cache Whisper/Xenova n'a été trouvé dans les emplacements configurés/attendus ; le code ne lira désormais qu'un modèle STT déjà local en mode hors-ligne. La dernière sonde Mina locale a retourné `lm_studio_unreachable` sur l’endpoint configuré `127.0.0.1:1234`, sans prompt envoyé. Aucun téléchargement, transcription réelle ni test microphone n'a été lancé.
- [ ] **Packaging voix locale** — décision de distribution eSpeak/Kokoro requise avant publication de ce chemin.

### Exécution autorisée, encore à réconcilier et terminer

- [ ] **Grounding live** — le gate est maintenant exécuté sur les réponses modèles Telegram et `mina_app` : l’enveloppe JSON est bornée et redacted, les `claimId` sont générés par le ledger local, les segments factuels passent `EvidenceValidator`/`ResponseGate`, et une sortie brute ou non prouvée devient la réponse sûre (`e38856d`, `c05e042`, `59e04fd`). Le flux `mina_app` ne publie plus de chunk avant ce gate ; le runtime démarre avant le canal appairé. Après une action non vérifiée, `done` arrête aussi la mission ; le texte final non vérifié du modèle est remplacé par un résumé déterministe d’actions vérifiées (`547d5c1`, `19bdc84`). La dernière suite globale a retourné `432` fichiers unitaires, `3 481` tests passés et `6` ignorés, puis `18/18` fichiers d’intégration et `49/49` tests. Ces preuves sont locales. `startMission` ne crée toujours pas de `claimId` pour un texte de modèle, et aucun compte Telegram de test, appareil appairé de test ou citation live n’a été exécuté.
- [ ] **Chat natif Android, option A** — Nasro a choisi le chat complet des tâches 13–25. La notification Android n’expose plus le texte de réponse (`2185166`), les règles owner/device sont prouvées localement (`335d8e9`) et le réveil FCM est fail-closed (`071d279`). L’historique Android charge maintenant explicitement des pages de `50` avec curseur tuple et garde au plus `200` objets déchiffrés dans l’état UI ; un message texte sortant en échec final peut aussi être remis dans sa même outbox avec son même `eventId`, sans doublon local. `ChatRepositoryTest` (`26/26`) et `ChatHistoryWindowTest` (`3/3`) sont sans échec, et la gate Android fraîche a retourné `GRADLE_EXIT=0`. Le test Compose a seulement été compilé : aucun appareil n’étant attaché, il ne vaut pas recette instrumentée. Le retry ne couvre pas les pièces jointes, le streaming ordonné/final ni cancel/stop. La migration notes/PTT PCM chiffrée reste partielle et la tâche 21 de voix live n’est pas commencée. Il reste la migration du relais Firebase anonyme vers une identité propriétaire/appareil avec custom claims, App Check, Functions et enregistrement FID/FCM explicite ; tant qu’elle n’existe pas, le réveil FCM est volontairement ignoré et aucune tâche Android 13–25 ne peut être déclarée complète.
- [ ] **Téléchargement de pièces jointes mail** — l’ingestion bornée est désormais implémentée pour Gmail et Microsoft Graph (`dd23516`) : seulement les descripteurs `fileAttachment` Graph sont lus, les références ne sont pas suivies, les tailles et encodages sont validés avant la quarantaine, et `74/74` tests ciblés sont verts. Le contenu brut n’est toujours pas persisté chiffré ; la migration de blob, l’export local one-shot et la recette réelle avec comptes de test restent à faire. `downloadAttachment` ne doit pas être annoncé comme disponible.
- [ ] **Documents / impression** — `main.mjs` compose réellement la quarantaine/intake, le parsing PDF à texte natif et PNG/JPEG via Tesseract, les preuves et la proposition/confirmation de classification dans des stores SQLite locaux, ainsi que l’impression Windows avec confirmation locale. Le panneau Mina permet maintenant, après clic, d’intake/analyser un chemin local explicitement saisi et de générer une proposition de classement. La réponse IPC de parsing est une projection redacted (`documentId`, type, pages, parser, confiance, `blockCount`) ; l’observation complète reste dans le store local et le panneau n’affiche ni texte extrait ni octets bruts. Il n’existe pas encore de vue des preuves, de liste de quarantaine, ni de contrôle UI pour confirmer/corriger la classification. La promotion résout désormais le dossier parent réel d’un nouveau fichier, autorise le chemin canonique et conserve l’écriture `wx` ; elle refuse les chemins relatifs, UNC et toute autorisation qui redirige le fichier. Un PDF sans texte extrait échoue explicitement par `document_pdf_text_empty` : aucun OCR de PDF scanné n’est branché. Mémoire/RAG, formulaires, conversion et téléchargement restent non composés et échouent explicitement avec `*_not_configured`, jamais par une valeur `undefined`. Le contrôleur urgence est enregistré uniquement lorsque le corpus et le mode réels sont composés ; le renderer expose encore seulement son état, sans action de construction ou d’activation. Aucune promotion via UI, analyse d’un document utilisateur, réception physique d’impression ou état terminal spooler vérifié n’a été exécuté.

### Preuves externes ou physiques

- [ ] **Accès Firebase Mina Vision** — la console RTDB a été relue sous
  `Compte Google Sourire Concept (mina.vision.ai@gmail.com)` dans le projet Mina Vision ; la base
  est en Belgique (`europe-west1`). L’endpoint
  `https://mina-vision-default-rtdb.europe-west1.firebasedatabase.app` est propagé dans les deux
  configurations locales et la génération Android release a lu exactement cette valeur
  (`4e8cd2e`). Les règles cloud actuellement visibles restent le refus global par défaut
  (`.read: false`, `.write: false`) ; aucune ressource cloud ni règle n’a été modifiée. La
  publication des règles owner/device préparées attend la confirmation explicite de Nasro au moment
  de l’action.
- [ ] **Android utilisateur** — le 2026-08-09, `adb devices -l` a listé le Huawei USB
  `HUAWEITESTSERIAL` (`MAR_LX1A`) et le Samsung A71 Wi-Fi `192.168.1.11:46505` (`SM_A715F`), et
  `pm path` confirme `fr.mina.gateway.debug` sur les deux. Aucun parcours applicatif, aucune
  permission caméra/micro/SMS/Telegram et aucune recette instrumentation n’ont encore été exécutés.
  Le provisioning local n’a pas été lu ni modifié, et aucun APK n’a été réinstallé ; il doit être
  préservé avant toute recette pouvant l’écraser.
- [ ] **Google Home** — SDK signé, relais autorisé et recette sur lumière non critique, supervisée.
- [ ] **Mail fournisseurs** — comptes de test dédiés, consentement OAuth/TLS et opérations réversibles réelles par fournisseur.
- [ ] **Windows Sandbox** — preuve d'isolation physique dédiée.
- [x] **Chrome via l'extension demandée** — la session Chrome demandée fonctionne ; elle a ouvert la
  page RTDB Rules et relu le compte Google, la région et les règles sans effectuer de modification
  cloud.

## Ordre de reprise proposé

1. Réconcilier le code courant avec les plans chat Android, grounding, documents et impression, puis traiter les écarts test par test.
2. Provisionner un modèle STT local avant toute transcription ; installer explicitement `fra` pour l’OCR français si cette qualité est requise.
3. Connecter les matériels autorisés pour les recettes webcam, Android et microphone ; conserver Home, mail et Sandbox à des actions séparément autorisées.
4. Rejouer `npm run verify:release` après la prochaine vague de code et actualiser ce tableau avec les sorties réellement observées.
