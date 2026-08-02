# Mina Vision — Journal de preuve de réconciliation

> Journal append-only en heure Africa/Lagos. Les statuts manuels et live ne sont jamais déduits d’un test unitaire.

## 2026-07-29 04:57 | baseline | gate unitaire avant correction

- files: aucun
- command: `npm run test:unit`
- exit: 1
- proof: `3 failed | 392 passed (395)` ; `3 failed | 3255 passed (3258)` ; les trois échecs sont des timeouts Vitest de 10 000 ms dans `security-invariants`, `main-host-write-policy-contract` et `git-real-repo`.
- manual/live: failed
- remaining: le gate officiel lance les fichiers avec parallélisme ; la cause de la lenteur doit être confirmée avant modification.

## 2026-07-29 04:57 | task-0 | reproduction contrôlée de la contention du gate

- files: aucun
- command: `npx vitest run tests/security-invariants.test.mjs tests/main-host-write-policy-contract.test.mjs tests/code/git-real-repo.test.mjs --maxWorkers=1 --no-file-parallelism`
- exit: 0
- proof: `3 passed (3)` ; `18 passed (18)` ; durée 22,47 s. Les trois fichiers passent aussi isolément avec le timeout inchangé.
- manual/live: passed
- remaining: rejouer le corpus complet sans parallélisme de fichiers et appliquer seulement le réglage qui rend le script officiel reproductible.

## 2026-07-29 04:57 | task-0 | baseline unitaire série complète

- files: aucun
- command: `npx vitest run --exclude tests/integration/** --maxWorkers=2 --no-file-parallelism`
- exit: 0
- proof: `395 passed (395)` ; `3258 passed (3258)` ; durée 378,31 s.
- manual/live: passed
- remaining: le script `test:unit` n’inclut pas encore ce mode reproductible.

## 2026-07-29 04:59 | task-0 | intégration, smoke et runtime courant

- files: aucun
- command: `npm run test:integration` ; `npm run test:smoke` ; `npm run verify`
- exit: 0 ; 0 ; 0
- proof: intégration `17 passed (17)` et `48 passed (48)` ; smoke `MINA_SMOKE_WINDOW_OK` reçu et fermeture propre ; verification runtime : LM Studio `lm_studio_unreachable`, Android `no_authorized_android_device`, Wi-Fi `wifi_transport_not_connected`, Google Home `google_home_sdk_unavailable`, mail `mail_accounts_not_yet_configurable_from_cli`, Firebase `firebase_unconfigured`.
- manual/live: passed pour les tests automatisés ; failed pour les prérequis runtime non prêts.
- remaining: le smoke ne prouve pas encore l’isolation lorsque l’instance Mina normale est déjà ouverte ; aucun statut runtime non prêt ne doit être présenté comme disponible.

## 2026-07-29 04:59 | task-0 | contrôle du journal

- files: `docs/superpowers/execution/2026-07-29-mina-reconciliation-log.md`
- command: `rg -n -i 'api[_-]?key\s*[:=]|token\s*[:=]|password\s*[:=]|private[_-]?key|refresh[_-]?token' docs/superpowers/execution/2026-07-29-mina-reconciliation-log.md`
- exit: 0
- proof: `EVIDENCE_SECRET_SCAN=NO_MATCHES`.
- manual/live: passed
- remaining: aucun.

## 2026-07-29 05:01 | task-0 | gate unitaire reproductible

- files: `package.json`, `vitest.config.mjs`
- command: `npm run test:unit`
- exit: 0
- proof: le script officiel inclut `--no-file-parallelism` sans augmenter le timeout ; `395 passed (395)` ; `3258 passed (3258)`.
- manual/live: passed
- remaining: aucun pour le gate unitaire.

## 2026-07-29 05:10 | task-1 | contrat TDD du profil utilisateur explicite

- files: `tests/user-data-path.test.mjs`, `tests/main-user-data-path-contract.test.mjs`
- command: `npx vitest run tests/user-data-path.test.mjs tests/main-user-data-path-contract.test.mjs --maxWorkers=1 --no-file-parallelism`
- exit: 1 puis 0
- proof: rouge initial : module `src/ui/user-data-path.mjs` absent et import du résolveur absent de `main.mjs` ; vert après implémentation : `2 passed (2)` ; `4 passed (4)`.
- manual/live: passed
- remaining: aucun.

## 2026-07-29 05:29 | task-1 | smoke avec verrou actif d’un profil nommé

- files: `src/ui/user-data-path.mjs`, `src/ui/main.mjs`, `tests/smoke/boot-smoke.mjs`, `tests/smoke/profile-lock-holder.mjs`
- command: `npm run test:smoke` ; `MINA_SMOKE_SELFTEST=fault npm run test:smoke` ; `npm run test:release`
- exit: 0 ; 0 ; 0
- proof: le smoke lance un processus Electron minimal qui détient le verrou du profil nommé, puis Mina avec `--user-data-dir` temporaire ; fenêtre principale confirmée et fermeture propre. L’auto-test détecte un boot volontairement cassé. Gate release : `397 passed (397)`, `3262 passed (3262)`, intégration `17 passed (17)` / `48 passed (48)`, smoke vert.
- manual/live: passed pour les gates automatisés.
- remaining: les états Android, Google Home, mail, Firebase et LM Studio restent séparés et non prêts selon le dernier `npm run verify`.

## 2026-07-29 05:43 | task-2 | états de capacité normalisés par la même fonction pure

- files: `src/diagnostics/capability-readiness.mjs`, `src/ui/main.mjs`, `scripts/verify-mina.mjs`, `tests/capability-readiness.test.mjs`, `tests/main-capability-readiness-contract.test.mjs`
- command: `npx vitest run tests/capability-readiness.test.mjs tests/runtime-capability-catalog.test.mjs tests/main-capability-readiness-contract.test.mjs --maxWorkers=1 --no-file-parallelism` ; `npm run verify` ; `npm run test:smoke`
- exit: 1 puis 0 ; 0 ; 0
- proof: rouge initial : module `capability-readiness.mjs` et imports/appels attendus absents. Vert : `3 passed (3)` ; `10 passed (10)`. Le diagnostic courant publie `models.lm_studio: degraded/lm_studio_unreachable`, `computer_use.android: degraded/no_authorized_android_device`, `mail: degraded/mail_accounts_not_yet_configurable_from_cli` et `backup.firebase: degraded/firebase_unconfigured`. Le smoke Electron reste vert.
- manual/live: passed pour les contrats et le diagnostic local ; failed pour les prérequis runtime non prêts.
- remaining: l'autorisation Android, le SDK Google Home, les comptes de test mail, Firebase et une instance LM Studio joignable restent des gates externes.

## 2026-07-29 06:07 | task-4 | gate de release reproductible et sans faux vert manuel

- files: `scripts/verify-release.mjs`, `tests/scripts/verify-release.test.mjs`, `package.json`, `docs/operations/RELEASE-EVIDENCE-2026-07.md`
- command: `npx vitest run tests/scripts/verify-release.test.mjs --maxWorkers=1 --no-file-parallelism` ; `npm run verify:release`
- exit: 1 puis 0 ; 0
- proof: rouge initial : runner absent, puis script npm de release absent. Le premier appel Windows a révélé `spawn EINVAL` avec `npm.cmd`; le lanceur utilise désormais Node + `npm_execpath` ou `cmd.exe` explicite avec tableau d'arguments. Vert : `5 passed (5)`. Release final : unit `400 passed (400)` / `3273 passed (3273)` ; intégration `17 passed (17)` / `48 passed (48)` ; smoke Electron et SQLite/Electron passés ; diagnostic JSON produit ; statut global `pass`.
- manual/live: passed pour les cinq contrôles automatisés ; `unrun` pour Android, Home, comptes fournisseurs, Sandbox et tour vocal local.
- remaining: aucun gate manuel n'est converti en succès ; leurs prérequis restent nécessaires.

## 2026-07-29 07:19 | task-5 | opérations fournisseurs déclarées, jamais simulées

- files: `src/mail/adapters/gmail.mjs`, `src/mail/adapters/microsoft-graph.mjs`, `src/mail/adapters/imap-smtp.mjs`, `src/mail/google-runtime-adapters.mjs`, `src/mail/mail-service.mjs`, `src/personal/adapters/*.mjs`, `src/personal/calendar-service.mjs`, `src/personal/task-service.mjs` et tests associés.
- command: focused adapter/service suite, then final `npm run verify:release`.
- exit: 1 puis 0 ; 0.
- proof: rouge initial sur les capacités absentes et les opérations non supportées ; vert ciblé `10 passed (10)` fichiers / `156 passed (156)` tests. Les actions non déclarées sont refusées avant proposition ou mutation locale ; un échec fournisseur laisse une tâche active.
- manual/live: `unrun` — aucun compte Gmail, IMAP/SMTP ou Microsoft dédié n'a été configuré ou utilisé.
- remaining: comptes non-production, consentement explicite et opérations réversibles séparées par fournisseur.

## 2026-07-29 07:19 | task-6 | persistance recovery et états documents/impression véridiques

- files: `src/recovery/recovery-service.mjs`, `src/documents/form-service.mjs`, `src/core/compose-governance-domains.mjs`, `src/ui/main.mjs`, contrôleur document et tests associés.
- command: `npx vitest run tests/automation-runner.test.mjs tests/recovery-service.test.mjs tests/form-service.test.mjs tests/print-service.test.mjs tests/compose-governance-domains.test.mjs tests/main-domain-composition-contract.test.mjs tests/document-ui-contract.test.mjs`.
- exit: 1 puis 0.
- proof: rouge : fermeture recovery perdue, formulaire sans renderer accepté ou statut de composition absent. Vert : `7 passed (7)` fichiers / `78 passed (78)` tests. Les fermetures manuelles passent par le repository durable ; un formulaire sans renderer échoue avant écriture ; documents et impression sont explicitement dégradés.
- manual/live: renderer PDF réel et reçu d'impression physique `unrun`.
- remaining: fournir/autoriser un renderer réel et une recette d'impression si la fonctionnalité doit devenir disponible.

## 2026-07-29 07:19 | task-7 | politique maison fail-closed et préconditions physiques

- files: `src/home/registry.mjs`, `src/home/intent-normalizer.mjs`, `src/home/policy.mjs`, `src/home/service.mjs`, `src/home/automation-result.mjs`, `src/automation/receipt-verifier.mjs`, `src/ui/main.mjs` et tests associés.
- command: focused home/Telegram suite ; `adb devices` ; `Get-FileHash` du manifest Google Home ; `npm run verify`.
- exit: 1 puis 0 ; commandes de précondition : 1 car le manifest est absent.
- proof: rouge : Telegram était encore admis directement et un reçu explicitement non vérifié pouvait être accepté sans effet attendu. Vert direct : `2 passed (2)` fichiers / `21 passed (21)` tests ; le corpus ciblé complet : `31 passed (31)` fichiers / `317 passed (317)` tests, puis intégration `17 passed (17)` / `48 passed (48). Risque par classe, scènes max-risque, Firebase-only faible risque/TTL 30 s et reçus automation confirmés sont couverts. ADB a listé un transport USB autorisé ; Google Home SDK est absent.
- manual/live: `unrun` — aucun SDK Google Home, Firebase relay, connecteur configuré ni lumière physique n'a été utilisé.
- remaining: SDK signé, build Android feature:home, relais autorisé et recette lumière supervisée.

## 2026-07-29 07:19 | task-8 | périmètre chat natif mesuré

- files: `docs/superpowers/execution/2026-07-29-mina-native-chat-scope-ledger.md`.
- command: extraction read-only des chemins `Create:` des tâches 13–25 et `Test-Path` sur chacun.
- exit: 0.
- proof: `102` chemins déclarés ; `4` présents ; `98` absents. Le ledger ne déduit pas la validité fonctionnelle des quatre fichiers présents.
- manual/live: décision produit `unrun`.
- remaining: Nasro choisit Option A (chat complet) ou Option B (périmètre limité honnête) avant tout code de chat natif.

## 2026-07-29 07:19 | task-9 | capacités locales non prouvées explicitement gelées

- files: `src/ui/main.mjs`, `src/core/domain-circles.mjs`, `tests/main-domain-composition-contract.test.mjs`, `tests/domain-circles.test.mjs`, `tests/face-embedder-factory.test.mjs`, `CHANGELOG.md`.
- command: focused capability/face suite ; lecture du manifeste facial runtime ; final `npm run verify:release`.
- exit: 0.
- proof: `voice.local_only` suit la sonde LM Studio, sandbox reste `degraded`, avatar et packaging vocal `unavailable`. Le manifeste facial est absent dans la racine runtime par défaut ; la factory retourne `modele_non_provisionne`. Les tests face ciblés : `3 passed (3)` fichiers / `8 passed (8)` tests.
- manual/live: tour vocal hors réseau, Sandbox Windows, asset VRM sous licence et décision de distribution `unrun`.
- remaining: les décisions produit/légales et preuves physiques correspondantes.

## 2026-07-29 07:19 | task-10 | documentation et release finale réconciliées

- files: plans/specs audités hors plan de publication exclu, `CHANGELOG.md`, `docs/operations/RELEASE-EVIDENCE-2026-07.md`.
- command: scans de claims, `git diff --check`, puis `npm run verify:release`.
- exit: 0.
- proof: release `pass` : unit `403 passed (403)` / `3291 passed (3291)` ; intégration `17 passed (17)` / `48 passed (48)` ; smoke Electron et SQLite/Electron passés. Runtime : LM Studio `degraded/lm_studio_unreachable`, Android `available` USB, Google Home/mail/Firebase non prêts ou non configurés. Scan de complétion : seul match = commande littérale du scan ; `EVIDENCE_SECRET_SCAN=NO_MATCHES` ; `DIFF_CHECK=PASS` ; le plan `2026-07-28-mina-publication-visuels-locaux-plan.md` n'a aucun diff.
- manual/live: toutes les lignes manuelles du runner restent `unrun`.
- remaining: gates physiques, comptes dédiés et décisions produit listés dans le plan de réconciliation.

## 2026-07-29 07:45 | task-3 | pipeline de grounding validé, raccordement live non inventé

- files: `src/grounding/grounding-pipeline.mjs`, `src/grounding/claim-ledger.mjs`, `src/grounding/evidence-validator.mjs`, `tests/grounding-pipeline.test.mjs`, `tests/claim-ledger.test.mjs`.
- command: `npx vitest run tests/grounding-pipeline.test.mjs tests/claim-ledger.test.mjs` ; `npx vitest run tests/grounding-pipeline.test.mjs tests/claim-ledger.test.mjs tests/evidence-validator.test.mjs tests/response-gate.test.mjs` ; `npx vitest run tests/grounding-pipeline.test.mjs tests/claim-ledger.test.mjs tests/evidence-validator.test.mjs tests/response-gate.test.mjs tests/conversation-service.test.mjs tests/telegram-conversation-responder.test.mjs tests/phone-message-sync.test.mjs tests/orchestrator.test.mjs tests/integration/grounded-research.test.mjs tests/integration/cross-channel-memory.test.mjs`.
- exit: `1` puis `0` ; `0`.
- proof: rouge initial : `Cannot find module '../src/grounding/grounding-pipeline.mjs'` et `ledger.applyValidation is not a function`. Vert : `4 passed (4)` / `28 passed (28)`, puis `10 passed (10)` / `82 passed (82)`. Toute proposition entre dans le ledger avec `unsupported`; seul le résultat opaque du validateur peut la promouvoir. Le parcours Telegram réel reste du texte libre et ne fournit pas le contrat structuré.
- manual/live: `unrun` — aucune réponse locale ou Telegram n'a été réécrite à partir d'un protocole non décidé.
- remaining: décider un contrat de corrélation des `claimId` entre propositions, rendu et citations avant de modifier `startMission` ou `phoneMessageSync`.

## 2026-07-29 07:45 | task-7 | gates Android locaux passés, physique et Home toujours non prouvés

- files: artefacts Gradle locaux uniquement ; aucun fichier source modifié.
- command: depuis `C:\Serveurs\Mina Vision\android`, `.\gradlew.bat test --console=plain` ; `.\gradlew.bat :app:assembleDebug --console=plain` ; depuis la racine, `npm run verify`.
- exit: `0` ; `0` ; `0`.
- proof: `BUILD SUCCESSFUL in 12s` / `321 actionable tasks: 321 up-to-date`; `BUILD SUCCESSFUL in 20s` / `162 actionable tasks: 1 executed, 161 up-to-date`; APK debug local `app-debug.apk` produit (53 794 848 octets, SHA-256 `893CFBA8C19E98C5AB2284F52F1C7CF47CBB2969DF2A0470F3E79E948B8CFA82`). Le diagnostic confirme encore `lm_studio_unreachable`; le processus `LMS` existe mais aucun listener n'a été trouvé sur `127.0.0.1:1234`.
- manual/live: `unrun` — aucune installation APK, aucun parcours app, aucune commande téléphone/Home, aucun SDK Google Home signé.
- remaining: démarrer le serveur API LM Studio sur le port configuré ou configurer explicitement un autre endpoint loopback ; fournir le SDK Google Home et autoriser la recette lumière supervisée avant toute déclaration Home.

## 2026-07-29 08:14 | release | vérification complète après le pipeline grounding

- files: code et documentation de la branche de travail ; aucun push, commit ou déploiement.
- command: `npm run verify:release`.
- exit: `0`.
- proof: statut JSON `pass`; unit `404 passed (404)` / `3295 passed (3295)` ; intégration `17 passed (17)` / `48 passed (48)` ; smoke Electron `SMOKE OK` ; SQLite/Electron `{"ok":true,"electron":"43.1.0","abi":"148"}` ; diagnostic : LM Studio `degraded/lm_studio_unreachable`, Android `available` USB, Google Home/mail/Firebase non prêts ou non configurés.
- manual/live: `android_physical_acceptance`, `home_safe_light_acceptance`, `provider_dedicated_account_acceptance`, `sandbox_isolation_acceptance` et `local_voice_offline_acceptance` restent tous `unrun`.
- remaining: contrat de réponse grounding live, SDK/recette Home, comptes dédiés, Sandbox et tour vocal hors réseau.

## 2026-07-29 08:25 | runtime | LM Studio local vérifié après démarrage explicite par Nasro

- files: aucun fichier source modifié; mise à jour de la preuve de réconciliation uniquement.
- command: `lms server --help`; `lms ps`; `lms server status`; lecture `GET http://127.0.0.1:1234/v1/models`; `npm run verify`; appel des fournisseurs `createLmStudioProvider` et `createLmStudioEmbeddingProvider` avec les modèles configurés.
- exit: `0` pour chaque commande.
- proof: `lms server status` a indiqué le port `1234` et le listener loopback a été observé. `lms ps` a listé `google/gemma-4-e2b` et `text-embedding-nomic-embed-text-v1.5` chargés. `npm run verify` a retourné `lmStudio.ready: true` avec texte, vision et embedding chargés, et `models.lm_studio: available`. Le fournisseur texte Mina a retourné exactement `MINA_LOCAL_OK`; le fournisseur embedding Mina a retourné un vecteur fini de `768` dimensions.
- manual/live: texte local et embedding local passés sur l'API loopback; inférence vision, microphone/STT/TTS et test réseau désactivé restent `unrun`.
- remaining: ne pas promouvoir la voix locale complète avant un tour STT -> modèle -> TTS hors réseau; les gates grounding live, Home, comptes dédiés, Sandbox, avatar et décision de distribution restent ouverts.

## 2026-07-29 08:34 | runtime | vision Mina locale exercée et échec isolé sans hypothèse de cause

- files: aucun fichier source modifié; mise à jour des preuves de réconciliation uniquement.
- command: appel `createCameraVisionRuntime` en `local-only` avec une image JPEG 1x1 générée en mémoire; puis `lms server status`, `lms ps`, `npm run verify`, appel texte/embedding Mina de récupération et `lms ls --json` sur les deux modèles vision déclarés.
- exit: vision `1`; commandes de diagnostic/récupération `0`.
- proof: le premier JPEG fourni n'était pas lisible par LM Studio. Avec un JPEG généré par `sharp`, le routeur Mina a échoué exactement avec `camera_vision_all_providers_failed:lm-studio-camera-vision:400` et le message LM Studio indiquait un crash du modèle. Juste après, `lms ps` ne listait plus que l'embedder et `npm run verify` retournait `lm_studio_models_not_ready`. L'appel texte suivant a retourné `MINA_TEXT_RECOVERY_OK`; l'embedding a retourné un vecteur fini de `768` dimensions; le dernier `lms ps` puis `npm run verify` ont de nouveau vu Gemma et l'embedder chargés. Les métadonnées CLI indiquent `vision:true` pour Gemma configuré et pour `zai-org/glm-4.6v-flash`; ce dernier n'a pas été chargé ni testé.
- manual/live: texte et embedding locaux réussis; caméra locale échouée; micro/STT/TTS, réseau désactivé et caméra physique restent `unrun`.
- remaining: ne pas changer le modèle vision configuré ni charger l'alternative de 7,95 Go sans décision explicite; conserver le statut vision dégradé et investiguer le crash seulement avec des logs non sensibles ou une autorisation de configuration.

## 2026-07-29 08:34 | task-7 | instrumentation Android non lancée car elle peut activer Telegram réel

- files: aucun fichier source modifié.
- command: lecture de `android/app/src/androidTest/kotlin/fr/mina/gateway/messaging/storage/RoomMessagingSecretStoreTest.kt`, `MinaGatewayService.kt`, manifeste et scripts Gradle; `adb devices`; builds Gradle locaux déjà consignés.
- exit: lecture `0`; aucun `connectedDebugAndroidTest`, `installDebug` ou APK install n'a été lancé.
- proof: le test instrumenté appelle `startForegroundService(Intent(context, MinaGatewayService::class.java))`. Le service exécute `runPollLoop` et `runCommandLoop`; si le stockage local contient déjà owner et token Telegram, ces boucles peuvent appeler le poller Telegram ou traiter des réponses sortantes. L'installation d'un APK peut aussi déclencher le receiver `MY_PACKAGE_REPLACED`, qui démarre le même service. Ces effets ne sont pas acceptables comme test neutre.
- manual/live: Android unit tests et APK debug compilés restent passés; installation, instrumentation, parcours app et action téléphone/Home restent `unrun`.
- remaining: fournir un mode test explicitement sans réseau et testé, ou autoriser explicitement l'état live Telegram du téléphone avant toute opération d'installation/instrumentation.

## 2026-07-29 08:44 | task-7 | préparation test Android sans boucles Telegram, sans installation

- files: `android/app/src/main/kotlin/fr/mina/gateway/messaging/GatewayServiceStartPolicy.kt`, `MinaGatewayService.kt`, `android/app/src/debug/AndroidManifest.xml`, `RoomMessagingSecretStoreTest.kt`, `GatewayServiceStartPolicyTest.kt`.
- command: rouge `./gradlew.bat :app:testDebugUnitTest --tests "fr.mina.gateway.messaging.GatewayServiceStartPolicyTest"`; vert ciblé avec la même commande; puis `./gradlew.bat test :app:assembleDebug :app:assembleDebugAndroidTest --console=plain`; contrôle des manifests mergés debug/release.
- exit: rouge `1` (référence policy absente), vert `0`; build complet `0` (`BUILD SUCCESSFUL`, 392 tâches); contrôle manifest `0`.
- proof: le flag explicite `EXTRA_ISOLATED_TEST_MODE` fait retourner une build debug après `startForeground`, avant `runPollLoop` et `runCommandLoop`; une build non débuggable l'ignore. L'instrumentation existante passe désormais ce flag. Le manifeste debug retire `GatewayBootReceiver`; le manifeste mergé debug ne contient pas ce receiver, le manifeste release le contient. La policy pure couvre le démarrage live normal, le refus de l'isolation release et l'isolation debug demandée.
- manual/live: aucun APK ou APK de test installé; aucun `connectedDebugAndroidTest` exécuté; l'app, Telegram, téléphone et Home restent `unrun`.
- remaining: le debug APK utilise encore le même application ID que la passerelle existante; une installation peut la remplacer ou la suspendre. Attendre l'autorisation explicite de Nasro avant l'instrumentation physique.

## 2026-07-29 08:48 | task-7 | isolation instrumentation limitée aux builds debug

- files: `GatewayServiceStartPolicy.kt`, `MinaGatewayService.kt`, `GatewayServiceStartPolicyTest.kt`.
- command: cycle TDD ciblé `:app:testDebugUnitTest --tests "fr.mina.gateway.messaging.GatewayServiceStartPolicyTest"`, puis `./gradlew.bat test :app:assembleDebug :app:assembleDebugAndroidTest --console=plain` et contrôle des manifests mergés.
- exit: rouge `1` (signature policy précédente sans paramètre `debugBuild`); vert ciblé `0`; build complet `0` (`BUILD SUCCESSFUL`, 392 tâches); contrôle manifest `0`.
- proof: `MinaGatewayService` utilise `ApplicationInfo.FLAG_DEBUGGABLE`, pas un `BuildConfig` absent du module. Le test prouve que le flag d'isolation est ignoré hors debug et qu'il coupe les boucles seulement en debug. Le manifeste debug reste sans receiver boot, le release le conserve.
- manual/live: aucune installation ou instrumentation physique.
- remaining: autorisation explicite avant tout remplacement potentiel de l'application existante sur le téléphone.

## 2026-07-29 08:58 | release | gates automatisés finaux après préparation Android isolée

- files: branche de travail complète; aucun push, commit, déploiement, installation APK ou opération fournisseur.
- command: `npm run verify:release`.
- exit: `0`.
- proof: statut `pass`; unit `404 passed (404)` / `3295 passed (3295)` en `445,40 s`; intégration `17 passed (17)` / `48 passed (48)` en `41,57 s`; smoke Electron et SQLite/Electron passés. Le diagnostic a vu LM Studio chargé et `models.lm_studio: available`, Android USB `available`; Google Home, mail et Firebase restent non prêts ou non configurés.
- manual/live: `android_physical_acceptance`, `home_safe_light_acceptance`, `provider_dedicated_account_acceptance`, `sandbox_isolation_acceptance` et `local_voice_offline_acceptance` restent `unrun`.
- remaining: décisions et preuves externes du plan de réconciliation; le routeur vision Mina reste dégradé malgré la santé LM Studio finale.

## 2026-07-29 09:17 | task-7 | instrumentation Android isolée exécutée sans remplacement du paquet existant

- files: `android/app/build.gradle.kts`, `android/app/src/androidTest/kotlin/fr/mina/gateway/messaging/storage/RoomMessagingSecretStoreTest.kt`; la politique de démarrage isolée et le manifeste debug consignés plus haut restent en vigueur.
- command: rouge physique `.\gradlew.bat :app:connectedDebugAndroidTest --console=plain` (5 tests, un échec à `RoomMessagingSecretStoreTest.kt:113`); vert après correction du test de visibilité de notification : même commande, puis `.\gradlew.bat test :app:assembleDebug :app:assembleDebugAndroidTest --console=plain`; contrôles post-run `adb shell pm list packages fr.mina.gateway`, `adb shell pm path fr.mina.gateway`, `adb shell pm path fr.mina.gateway.debug` et `adb shell pm path fr.mina.gateway.debug.test`.
- exit: rouge `1`; vert instrumentation `0` (`Starting 5 tests`, `Finished 5 tests`, `BUILD SUCCESSFUL in 2m 37s`); gate Gradle final `0` (`BUILD SUCCESSFUL in 25s`, 391 tâches, 3 exécutées, 388 à jour).
- proof: le premier échec ne portait pas sur le démarrage du service : il échouait seulement sur l'assertion de notification active alors que `POST_NOTIFICATIONS` n'était pas accordée au paquet de test. Le test exige désormais toujours démarrage puis arrêt du service, et n'exige la notification visible que si la permission est accordée. Le build debug porte `applicationIdSuffix = ".debug"`; AAPT a confirmé `fr.mina.gateway.debug` et `fr.mina.gateway.debug.test`. `google-services.json` ne possède pas ce client debug, donc seule la tâche `processDebugGoogleServices` debug est désactivée. Après le runner, `fr.mina.gateway` est toujours installé, version `0.1.0`, et les deux paquets temporaires debug ne sont plus installés.
- manual/live: le cycle de service instrumenté isolé est passé. Les parcours applicatifs, permissions caméra/micro, SMS, échange Telegram, action téléphone/Home, SDK Google Home, Firebase et lumière supervisée restent `unrun`.
- remaining: ne pas assimiler ce test au parcours Mina réel; fournir le SDK Google Home, le relais autorisé et une recette de lumière non critique avant toute déclaration Home.

## 2026-07-29 09:25 | integrity | clôture de la vague sans dérive de périmètre

- command: `git diff --check`; scan de fichiers modifiés par expression de secret; `git diff --quiet -- docs/superpowers/plans/2026-07-28-mina-publication-visuels-locaux-plan.md`; scan Markdown des espaces terminaux.
- exit: `0`; scan secret `1` sans sortie (aucun match); contrôle du plan exclu `0`; scan espaces terminaux `1` sans sortie (aucun match).
- proof: `DIFF_CHECK=PASS`; `EVIDENCE_SECRET_SCAN=NO_MATCHES`; `EXCLUDED_PUBLICATION_PLAN=NO_DIFF`; aucune espace terminale détectée dans les trois documents de preuve.
- remaining: aucun commit, push ou déploiement n'a été effectué. Les gates externes et décisions explicites restent celles listées dans le plan maître.

## 2026-07-29 10:20 | task-2/task-4/task-5/runtime | états ADB, composition et opérations mail rendus vérifiables

- files: `src/devices/adb-devices.mjs`, `scripts/verify-mina.mjs`, `tests/adb-devices.test.mjs`, `src/ui/runtime/compose-sms-send-policy.mjs`, `tests/compose-sms-send-policy.test.mjs`, `src/mail/adapters/gmail.mjs`, `src/mail/adapters/microsoft-graph.mjs`, `src/mail/adapters/imap-smtp.mjs`, `src/mail/google-runtime-adapters.mjs`, `src/mail/mail-service.mjs` et leurs tests ciblés.
- command: rouge `npx vitest run tests/adb-devices.test.mjs`; vert `npx vitest run tests/adb-devices.test.mjs tests/health-service.test.mjs`; suites fournisseurs ciblées et étendues; `npm run test:unit`; `adb devices -l`; `lms server status`; `lms ps`; `lms load google/gemma-4-e2b --estimate-only --yes`; `lms load google/gemma-4-e2b --yes`; requête Mina loopback; `npm run verify`.
- exit: rouge `1` (module `adb-devices.mjs` absent); vert `0` (`2` fichiers / `6` tests); composition SMS ciblée `0` (`2` fichiers / `22` tests) et smoke `0`; fournisseurs `0` (`5` fichiers / `74` tests, puis `9` fichiers / `165` tests); unit `0` (`405` fichiers / `3309` tests); commandes ADB/LM Studio/diagnostic `0`.
- proof: le rapport ADB ne code plus `usb` en dur : l'unique endpoint autorisé observé est maintenant `lan`. LM Studio est sur le port `1234`; le modèle configuré Gemma et l'embedder sont chargés. Le fournisseur Mina local a renvoyé exactement `MINA_LOCAL_RELOAD_OK` en `8683` ms. Gmail, Graph et IMAP confirment `markRead`/`archive` après écriture, ou renvoient `delivery_unknown` pour IMAP si le UID destination ne peut pas être relu. La route vision Mina reste hors de cette réussite et demeure dégradée après l'échec antérieur sur JPEG valide.
- manual/live: texte local loopback passé; vision locale, microphone/STT/TTS hors réseau, comptes mail dédiés, Google Home et parcours Android utilisateur restent `unrun`.
- remaining: accepter le contrat de corrélation grounding avant tout raccordement live; fournir le SDK Home et comptes dédiés; choisir le périmètre native-chat, l'asset VRM et la stratégie de distribution. Les opérations mail `move`/`label`, `trash`/`markSpam` et téléchargement d'attachment restent explicitement indisponibles.

## 2026-07-29 11:32 | release/runtime | gate automatisé final et ré-observation LM Studio distincte

- files: `tests/main-host-write-policy-contract.test.mjs`, `tests/code/git-real-repo.test.mjs`, `vitest.config.mjs` (commentaire de configuration), `docs/operations/RELEASE-EVIDENCE-2026-07.md` et ce journal.
- command: rouge `npm run verify:release`; test hôte ciblé; trace Git `GIT_TRACE2_EVENT=1`; test Git ciblé; diagnostics navigateur ciblés; vert final `npm run verify:release`; puis `lms ps`, requête Mina loopback et `npm run verify`.
- exit: premier run release `1` (timeout du scan hôte, puis timeout du test Git temporaire et timeout navigateur); tests ciblés corrigés `0`; run release final `0` avec statut JSON `pass`: unit `406` fichiers / `3 310` tests en `665.46 s`; intégration `17` fichiers / `48` tests en `181.45 s`; smoke Electron et SQLite/Electron `0`.
- proof: le scan de contrat lisait les fichiers séquentiellement et dépassait son timeout sous Vitest; les lectures sont maintenant parallèles, sans changer son corpus ni ses assertions. La trace Git a mesuré le hook `post-commit` hérité du template personnel à `7.117 s`; le dépôt temporaire de test utilise désormais un template/hooks vide local. Aucun correctif navigateur n'a été appliqué : son test a seulement passé dans le run final après libération de ressources. Pendant ce run, Gemma n'était pas chargé et le diagnostic informatif a donc publié `models.lm_studio: degraded`; cela ne constitue pas une preuve runtime. À 11:32, `lms ps`, la requête Mina (`MINA_LOCAL_RELOAD_OK`) et `npm run verify` ont de nouveau confirmé Gemma, l'embedder et `models.lm_studio: available`. Android reste `available` sur transport `lan`; Home est `google_home_sdk_unavailable`; mail reste sans comptes configurables par CLI; Firebase reste non configuré.
- manual/live: vision Mina sur caméra, voix locale hors réseau, comptes mail dédiés, Google Home, parcours Android utilisateur, Sandbox, native-chat, avatar et packaging restent `unrun` ou soumis à décision explicite.
- remaining: ne pas assimiler la santé vision du diagnostic à la route caméra qui a échoué; ne pas déclarer les gates externes passés sans leurs preuves dédiées.

## 2026-07-29 12:31 | task-5 | déplacement mail post-vérifié, sans compte externe

- files: `src/mail/adapters/gmail.mjs`, `src/mail/google-runtime-adapters.mjs`, `src/mail/adapters/microsoft-graph.mjs`, `src/mail/adapters/imap-smtp.mjs` et les quatre suites d'adaptateur/runtime associées.
- command: rouge `npx vitest run tests/gmail-adapter.test.mjs tests/google-runtime-adapters.test.mjs tests/microsoft-graph-adapter.test.mjs tests/imap-smtp-adapter.test.mjs`; vert ciblé avec la même commande; gate élargi `npx vitest run tests/gmail-adapter.test.mjs tests/google-runtime-adapters.test.mjs tests/microsoft-graph-adapter.test.mjs tests/imap-smtp-adapter.test.mjs tests/mail-service.test.mjs tests/personal-adapters.test.mjs tests/calendar-service.test.mjs tests/contact-service.test.mjs tests/task-service.test.mjs`.
- exit: rouge `1` (méthodes `move` et capacités absentes); vert ciblé `0` (`4` fichiers / `68` tests); gate élargi `0` (`9` fichiers / `176` tests).
- proof: Gmail ajoute le label destination et retire tous les labels source demandés, puis vérifie les labels retournés. Graph déplace le message, récupère son nouvel identifiant et le relit dans le dossier explicitement demandé. IMAP exige la correspondance UIDPLUS et relit l'UID destination; absence de correspondance ou de relecture conserve `delivery_unknown`.
- manual/live: `unrun` — aucun compte Gmail, IMAP/SMTP ou Microsoft dédié, aucune autorisation OAuth/TLS ni mutation fournisseur réelle n'a été utilisé.
- remaining: labels Graph, opérations spam/corbeille hors Gmail et téléchargement de pièce jointe explicitement autorisé restent ouverts; le stockage chiffré du contenu joint n'existe pas encore dans le dépôt actuel, donc aucun téléchargement brut n'est exposé.

## 2026-07-29 12:40 | task-5 | opérations réversibles étendues, frontières fournisseurs conservées

- files: `src/mail/adapters/gmail.mjs`, `src/mail/google-runtime-adapters.mjs`, `src/mail/adapters/microsoft-graph.mjs`, `src/mail/adapters/imap-smtp.mjs` et tests associés.
- command: tests rouges unitaires par opération, puis `npx vitest run tests/gmail-adapter.test.mjs tests/google-runtime-adapters.test.mjs tests/microsoft-graph-adapter.test.mjs tests/imap-smtp-adapter.test.mjs tests/mail-service.test.mjs tests/personal-adapters.test.mjs tests/calendar-service.test.mjs tests/contact-service.test.mjs tests/task-service.test.mjs`; `git diff --check`.
- exit: rouges `1` avant implémentation; gate élargi `0` (`9` fichiers / `183` tests); contrôle diff `0` sans erreur de diff.
- proof: Gmail expose et confirme `move`, `label`, `trash` et `markSpam`. Graph confirme `move`, `label` par catégorie existante de la liste maître et `trash` via `deleteditems`; `markSpam` reste absent car la seule API trouvée est bêta, dépréciée et non supportée en production v1.0. IMAP confirme `move`, `trash` et `markSpam` seulement avec les dossiers destination explicites et une relecture UIDPLUS; `label` générique reste absent faute de preuve d'extension serveur. Les trois adaptateurs n'exposent toujours pas `downloadAttachment`.
- manual/live: `unrun` — les tests utilisent des fournisseurs injectés; aucun compte, token, boîte, message ou fichier externe n'a été touché.
- remaining: un téléchargement réellement sûr nécessite de récupérer le contenu dans une quarantaine chiffrée persistante. Le repository actuel ne stocke que le digest, type, statut et taille : aucun contenu joint n'est persistant ni exportable, donc la fonctionnalité ne doit pas être annoncée comme implémentée avant ce raccordement.

## 2026-07-29 13:32 | task-5/integrity | gate complet stable après extension mail

- files: les quatre adaptateurs mail et leurs tests; `tests/security-invariants.test.mjs`; `tests/architecture/storage-boundaries.test.mjs`; ce journal.
- command: mesure en lecture seule du scan de `472` fichiers (`séquentiel: 7145 ms`; `parallèle: 372 ms`); rouge du test d'invariant `9` et des limites de stockage; vert ciblé `npx vitest run tests/security-invariants.test.mjs tests/architecture/storage-boundaries.test.mjs --maxWorkers=1 --no-file-parallelism`; `npm run test:unit`; `npm run test:integration`; `npm run smoke:sqlite:electron`.
- exit: focused `0` (`2` fichiers / `15` tests); unit `0` (`406` fichiers / `3 328` tests, `828.22 s`); intégration `0` (`17` fichiers / `48` tests, `128.86 s`); smoke `0` (`electron 43.1.0`, ABI `148`).
- proof: les deux scans de fichiers lisaient leur corpus séquentiellement et dépassaient leurs délais sous contention Vitest. Ils lisent désormais le même corpus en parallèle, sans réduire les assertions. Le gate complet est vert après les opérations mail : Gmail confirme `label`, `move`, `trash`, `markSpam`; Graph confirme `label`, `move`, `trash`; IMAP confirme `move`, `trash`, `markSpam` avec dossiers explicites et relecture UIDPLUS. Le smoke SQLite/Electron a retourné exactement `{"ok":true,"electron":"43.1.0","abi":"148"}`.
- manual/live: `unrun` — aucun compte fournisseur, contenu joint, token, boîte ou opération externe n'a été utilisé.
- remaining: le téléchargement de pièce jointe demeure indisponible tant que Nasro n'a pas choisi et autorisé le contrat de persistance chiffrée/quarantaine; il n'existe actuellement ni stockage du contenu brut ni chaîne sûre de récupération vers le dépôt local.

## 2026-07-29 13:33 | runtime | LM Studio en service, modèle Mina texte/vision non chargé

- files: ce journal uniquement.
- command: `npm run verify`; `lms server status`; `lms ps`.
- exit: `0` pour les trois commandes.
- proof: le serveur LM Studio écoute sur le port `1234`. `lms ps` ne liste que `text-embedding-nomic-embed-text-v1.5` en état `IDLE`. Le diagnostic Mina marque donc `google/gemma-4-e2b` non chargé pour texte et vision, l'embedder chargé, et `models.lm_studio: degraded / lm_studio_models_not_ready`.
- manual/live: aucune inférence texte, vision ou voix n'a été lancée dans cette vérification.
- remaining: charger explicitement un modèle texte/vision compatible puis refaire une preuve fournisseur distincte; ne pas utiliser cette observation pour déclarer la route caméra saine.

## 2026-07-29 13:38 | runtime | modèles LM Studio configurés rechargés et observés sains

- files: ce journal uniquement.
- command: `lms load google/gemma-4-e2b --yes`; `npm run verify`.
- exit: `0`; `0`.
- proof: LM Studio a chargé `google/gemma-4-e2b` en `2m 22.79s` (`4.11 GiB`). Le diagnostic Mina observe ensuite Gemma chargé à la fois pour texte et vision, l'embedder chargé, et `models.lm_studio: available`. Android reste disponible par transport LAN; Google Home et les comptes mail restent respectivement `google_home_sdk_unavailable` et `mail_accounts_not_yet_configurable_from_cli`.
- manual/live: aucun appel de fournisseur Mina ni route caméra n'a été exécuté après ce chargement.
- remaining: la précédente route caméra locale a échoué après crash modèle sur JPEG valide; elle reste dégradée jusqu'à une preuve dédiée réussie. La santé de chargement ne suffit pas à la promouvoir.

## 2026-07-29 14:35 | task-5 | quarantaine IMAP éphémère, aucun octet joint dans le corps mail chiffré

- files: `src/mail/adapters/imap-smtp.mjs`, `src/mail/mail-sync-service.mjs`, `tests/imap-smtp-adapter.test.mjs`, `tests/mail-sync-service.test.mjs` et le plan de réconciliation.
- command: preuve MIME synthétique `mailparser`; rouge `npx vitest run tests/mail-sync-service.test.mjs tests/imap-smtp-adapter.test.mjs --maxWorkers=1 --no-file-parallelism`; vert avec la même commande; gate fournisseur `10` fichiers / `191` tests; suite unitaire, intégration et smoke consignés ci-dessous.
- exit: rouge `1` (`2` régressions); vert ciblé `0` (`2` fichiers / `29` tests); gate fournisseur `0` (`10` fichiers / `191` tests).
- proof: `mailparser` fournit un Buffer de contenu joint. Avant correction, l'adaptateur IMAP le supprimait avant la quarantaine, tandis que `saveMessage` pouvait l'inclure dans `body_ciphertext` lorsqu'il était fourni. L'adaptateur transmet désormais les bytes uniquement au synchroniseur; celui-ci les retire avant `saveMessage`, appelle la quarantaine, puis conserve le digest, type, statut, taille et lien. Le test déchiffre le record et prouve `attachments: []` dans le corps, tout en retrouvant le descripteur lié.
- manual/live: `unrun` — message MIME synthétique et fournisseurs injectés uniquement; aucun compte, fichier externe ou pièce jointe réelle n'a été touché.
- remaining: `downloadAttachment` reste absent. Il faudra d'abord le contrat explicite de récupération et de persistance chiffrée/quarantaine avant d'exposer un téléchargement.

## 2026-07-29 14:35 | code/integrity | indexeur réel rétabli sans réduire le corpus

- files: `src/code/intelligence/symbol-index.mjs`; `tests/code/code-services-real-project.test.mjs`; ce journal.
- command: unit complet rouge; test réel isolé rouge; diagnostic instrumenté de l'indexeur; prototype externe avec cache exact; test réel + index de symboles; suite unitaire, intégration et smoke.
- exit: rouge `1` par timeout du hook à `180000 ms`, y compris isolé; diagnostic réel `0` après `257989 ms` (`917` fichiers); prototype `0` après `68887 ms`; test ciblé `0` (`2` fichiers / `16` tests, `69.01 s`).
- proof: l'indexeur parcourait les `917` fichiers JavaScript du corpus et, pour chaque appel, `byName(..., { exact: true })` balayait tous les symboles déjà indexés. `symbol-index` maintient désormais un index exact mis à jour à l'ajout/remplacement d'un fichier; les recherches partielles conservent leur balayage existant. Le corpus n'a pas été réduit et le test réel passe dans sa borne de `180 s`.
- manual/live: aucune opération Git, écriture projet ou action externe; l'indexation lit le dépôt local.
- remaining: l'objectif historique de la spécification Mina Code (`<30 s` d'indexation initiale) n'est pas atteint sur ce corpus : mesure actuelle `68.887 s`. Une optimisation de parsing ou une décision explicite de périmètre est nécessaire avant de le cocher.

## 2026-07-29 14:35 | gates | vérification automatisée après les correctifs mail et indexeur

- files: toutes les modifications de cette vague; aucun fichier publication non lié.
- command: `npm run test:unit`; `npm run test:integration`; `npm run smoke:sqlite:electron`; `npm run verify`; contrôle du plan publication exclu séparé.
- exit: unit `0` (`406` fichiers / `3330` tests, `836.73 s`); intégration `0` (`17` fichiers / `48` tests, `159.37 s`); smoke `0`.
- proof: smoke retourné exactement `{"ok":true,"electron":"43.1.0","abi":"148"}`. Les tests de régression mail et l'indexeur réel sont inclus dans la suite unitaire verte. Le diagnostic courant voit Gemma chargé pour texte/vision, l'embedder chargé et `models.lm_studio: available`; Google Home et les comptes mail CLI restent non prêts.
- manual/live: les comptes mail dédiés, route caméra locale, Google Home, Firebase, Sandbox, voix hors réseau et actions Android utilisateur restent `unrun` ou dégradés selon les entrées précédentes.
- remaining: les gates externes et décisions explicites du plan maître restent ouverts; aucun push, déploiement ou commit de cette vague n'a été effectué.

## 2026-07-29 15:14 | task-5/integrity | labels Gmail ambigus refusés et scan d'architecture stabilisé

- files: `src/mail/adapters/gmail.mjs`, `tests/gmail-adapter.test.mjs`, `tests/architecture/no-direct-provider.test.mjs` et le plan de réconciliation.
- command: rouge `npx vitest run tests/gmail-adapter.test.mjs --maxWorkers=1 --no-file-parallelism`; vert avec la même commande; gate mail étendu de `10` fichiers; repro isolée puis suite de `tests/architecture/no-direct-provider.test.mjs`; `npm run test:unit`; `npm run test:integration`; `npm run smoke:sqlite:electron`.
- exit: rouge Gmail `1` (la mutation atteignait encore le fournisseur et retournait `unhandled_url`); vert ciblé `0` (`29` tests); gate mail `0` (`10` fichiers / `192` tests); repro architecture isolée `0` (`21.35 s` pour le scan cible) mais run complet précédent `1` par timeout à `30 s`; test architecture optimisé `0` (`4` tests, `615 ms`); unit `0` (`406` fichiers / `3331` tests, `527.33 s`); intégration `0` (`17` fichiers / `48` tests, `92.12 s`); smoke `0`.
- proof: Gmail rejette désormais les IDs de labels dupliqués et tout label demandé à la fois en ajout et en retrait avant tout appel OAuth. Le test d'architecture lisait le même corpus de manière séquentielle; il lit désormais tous ses contenus en parallèle sans réduire le corpus ni les assertions. Le contrôle complet des imports fournisseurs est donc inclus dans la suite unitaire verte.
- manual/live: `unrun` — les fournisseurs mail restent injectés; aucune boîte, aucun token, aucun message ou fichier externe n'a été utilisé.
- remaining: `downloadAttachment` demeure indisponible jusqu'au contrat de récupération et de persistance chiffrée/quarantaine explicitement autorisé; les comptes dédiés restent requis pour le gate live.

## 2026-07-29 15:14 | runtime | LM Studio non prêt après échec de rechargement local

- files: ce journal et le plan de réconciliation uniquement.
- command: `npm run verify`; `lms ps`; `lms load google/gemma-4-e2b --yes`; puis `lms ps` et `npm run verify`.
- exit: diagnostics et listings `0`; chargement Gemma `1` avec `Failed to load model`.
- proof: avant et après la tentative, `lms ps` a retourné `No models are currently loaded`. Le diagnostic final a retourné `lm_studio_models_not_ready`: Gemma est non chargé pour texte et vision, et l'embedder est non chargé. Aucun motif plus précis n'a été fourni par LM Studio; aucun succès de runtime n'est donc déclaré pour cet état.
- manual/live: aucune inférence texte, vision, voix ou caméra n'a été exécutée après cet échec.
- remaining: résoudre le chargement côté LM Studio puis refaire séparément la preuve texte/embedding; ne pas assimiler un serveur ouvert ou le modèle présent sur disque à un modèle prêt.

## 2026-08-01 20:40 | review/publication | neuf commits post-réconciliation revus et trois écarts corrigés

- commits revus: `12465c0` (PPTX), `222338e` (XLSX/texte), `4f0c2f8` (service/LibreOffice), `32ad938` (pipeline huit formats), `2cd1061` (ComfyUI), `beab695` (IPC), `229da02` (composition principale), `1d7195b` (page UI) et `b10760a` (retry résilience).
- proof commits: `npm run test:publication` a passé `14` fichiers / `69` tests avant correction; `npx vitest run tests/error-resilience.test.mjs --maxWorkers=1 --no-file-parallelism` a passé `1` fichier / `35` tests. Le diff résilience conserve les refus/permanentes hors retry et plafonne le backoff.
- corrections TDD: rouge puis vert sur trois points issus de la relecture. ComfyUI passe désormais `redirect:'error'` sur santé et génération, afin qu'un endpoint loopback ne suive jamais une redirection distante. XLSX refuse aussi `HYPERLINK(...)` et `WEBSERVICE(...)`, en plus des références de classeur externe. Tous les générateurs de publication (PDF, DOCX, XLSX, texte, PPTX) sont importés dynamiquement au premier usage; `main.mjs` ne charge plus leurs dépendances lourdes au boot.
- gates: ciblé `3` fichiers / `13` tests vert; contrat/service `2` fichiers / `8` tests vert; publication final `14` fichiers / `70` tests vert; smoke boot Electron `0`; unit `416` fichiers / `3375` tests en `348.45 s`; intégration `18` fichiers / `49` tests en `36.43 s`; smoke SQLite/Electron `0` (`{"ok":true,"electron":"43.1.0","abi":"148"}`).
- runtime: `npm run verify` puis `lms ps` ont observé `lm_studio_unreachable`, aucun transport Android autorisé, aucun Wi-Fi connecté, Home absent, comptes mail CLI absents et Firebase non configuré. `lms ps` a confirmé qu'aucun modèle n'est chargé.
- manual/live: le boot Electron réel est passé. Les pipelines de publication génèrent réellement les huit formats dans leur environnement de test; aucun document n'a été créé dans le dossier Documents utilisateur, aucun fournisseur, compte mail, appareil Android ou service Home n'a été sollicité.
- remaining: l'indexation Mina Code reste au-dessus de son objectif historique `<30 s`; les décisions/gates externes restent explicitement ouverts dans le plan maître.

## 2026-08-01 20:47 | code/performance | objectif d'indexation initiale Mina Code revalidé sur le corpus actuel

- files: aucun fichier source modifié; lecture locale du corpus réel uniquement.
- command: diagnostic instrumenté de `createCodebaseIndexer(...).fullIndex()`; `npx vitest run tests/code/code-services-real-project.test.mjs --maxWorkers=1 --no-file-parallelism`.
- exit: `0`; `0`.
- proof: le diagnostic a indexé `935` fichiers sans réduire le corpus en `23481 ms` (lecture cumulée `18288 ms`, parsing cumulé `3271 ms`, `3969` symboles). Le chemin assemblé réel Mina Code a passé `1` fichier / `9` tests; son hook `beforeAll` d'indexation a pris `11.82 s`. Les deux mesures observées sont sous l'objectif historique `<30 s`. Elles remplacent l'état ouvert fondé sur la mesure antérieure `68.887 s`, sans nier cette mesure historique.
- manual/live: passé pour une indexation locale en lecture seule; aucune écriture projet, opération Git ou action externe.
- remaining: aucune action ouverte pour la cible d'indexation initiale. Re-mesurer après toute modification substantielle du corpus ou de l'indexeur.

## 2026-08-01 20:49 | runtime | serveur LM Studio joignable, modèles Mina non chargés

- files: aucun fichier source modifié; observation runtime en lecture seule.
- command: `npm run verify`; `lms server status`; `lms ps`.
- exit: `0`; `0`; `0`.
- proof: le serveur répond sur le port `1234`. `lms ps` retourne `No models are currently loaded`; le diagnostic Mina retourne donc `lm_studio_models_not_ready` pour `google/gemma-4-e2b` (texte et vision) et `text-embedding-nomic-embed-text-v1.5` (embedding). Aucun modèle n'est présenté comme prêt.
- manual/live: aucun chargement de modèle, appel d'inférence, capture micro, ni changement de configuration n'a été effectué.
- remaining: autorisation explicite de charger les modèles configurés, puis preuve séparée texte/embedding; la boucle STT → modèle → TTS hors réseau et la route caméra demeurent ouvertes.

## 2026-08-01 20:54 | runtime | embedding local prouvé, modèle Mina texte/vision refusé par LM Studio

- files: aucun fichier source modifié; modèles déjà présents sur disque et observation runtime locale.
- command: `lms ls --json`; `lms load google/gemma-4-e2b --yes`; `lms load text-embedding-nomic-embed-text-v1.5 --yes`; appel `createLmStudioEmbeddingProvider(...).embed('Mina embedding probe')`; `lms ps`; `npm run verify`.
- exit: Gemma `1`; embedder, sonde et diagnostic `0`.
- proof: Gemma 4 E2B est présent sur disque (`4 414 807 594` octets) mais son chargement échoue après environ `76 s` avec `Error loading model` et le code interne `18446744072635812000`; aucun autre modèle texte n'a été essayé. L'embedder Nomic est chargé (`84.11 MB`, état `IDLE`) et la sonde locale a retourné un vecteur fini de `768` dimensions. Le diagnostic Mina voit donc l'embedding chargé, mais Gemma non chargé pour texte et vision et conserve `models.lm_studio: degraded / lm_studio_models_not_ready`.
- manual/live: une requête d'embedding locale avec la chaîne non sensible `Mina embedding probe` a été exécutée; aucun log de requête LM Studio, microphone, image, compte ou service réseau n'a été utilisé.
- remaining: investiguer l'échec de chargement Gemma avec une autorisation de modifier sa configuration ou l'environnement LM Studio; ne pas déclarer le texte, la vision ou la voix locale prêts avant leurs preuves dédiées.

## 2026-08-02 07:44 | fix/runtime | état LM Studio truthful, texte local prouvé, vision locale toujours en échec

- files: `src/providers/lm-studio.mjs`, `tests/lm-studio-provider.test.mjs` et ce journal.
- TDD: le rouge ciblé a échoué comme attendu (`2` tests) : le fournisseur lisait `/v1/models`, qui liste le catalogue sur disque, et déclarait `gemma-local` disponible malgré `loaded_instances: []`. La correction lit désormais `/api/v1/models`, ne retient que les instances `llm` chargées et renvoie `local_model_unavailable:<model>` avant toute génération. Le vert ciblé a passé `4` fichiers / `22` tests.
- live: avec Gemma et l'embedder chargés, le fournisseur Mina a renvoyé exactement `MINA_TEXT_OK` (`26` tokens d'entrée, `7` de sortie, `33` total). Une seule sonde vision `local-only` a utilisé un JPEG 1×1 synthétique et a échoué avec `camera_vision_all_providers_failed:lm-studio-camera-vision:400 "Model reloaded."`; immédiatement après, Gemma n'était plus listé. Aucun retry, modèle alternatif, fichier utilisateur, photo, microphone, log LM Studio ou service réseau n'a été utilisé. À `07:44`, `lms ps` et `npm run verify` ont de nouveau vu Gemma et Nomic chargés, et `models.lm_studio: available`.
- gates: `npm run test:unit` `416` fichiers / `3376` tests; intégration `18` fichiers / `49` tests; smoke boot Electron et SQLite/Electron passés. `git diff --check` passé.
- remaining: la preuve texte et embedding locale est faite; la route caméra/vision reste non prouvée après son échec réel. La boucle microphone STT → modèle → TTS hors réseau reste séparée et non exécutée.

## 2026-08-02 08:16 | config/firebase | projet Mina Vision localement raccordé, sans écriture cloud

- files: `firebase.json`, `.firebaserc`, `tests/firebase-deployment-config.test.mjs`, `docs/operations/FIREBASE.fr.md`, `docs/operations/FIREBASE.md` et configuration locale ignorée `.env`.
- TDD: le test de configuration a d'abord échoué car `firebase.json` était absent, puis a passé après ajout du ciblage `mina-vision`, des règles Firestore/Storage et du stack Emulator Auth/Firestore/Storage. Le corpus Firebase ciblé a passé `5` fichiers / `19` tests.
- cloud read-only: `firebase login:list` et `firebase projects:list` ont confirmé le compte `mina.vision.ai@gmail.com` et le projet `mina-vision` (`000000000000`). `firebase apps:list` a retourné une seule app Android `fr.mina.gateway`; `firebase firestore:databases:list` a retourné `(default)`. Les métadonnées non sensibles de `env/google-services.json` et `android/app/google-services.json` correspondent exactement à la configuration téléchargée de l'app (projet, bucket, app ID et package). Aucun fichier existant n'a été écrasé.
- runtime: `.env` local contient désormais seulement `FIREBASE_PROJECT_ID=mina-vision` et `FIREBASE_STORAGE_BUCKET=mina-vision.firebasestorage.app`; `npm run verify` retourne `firebase.ready: true` / `backup.firebase: available`. Cette sonde prouve la configuration locale, pas une écriture Firebase ni un backup effectif.
- emulator: la CLI a bien lu la configuration, mais Firestore Emulator s'arrête car Java `17.0.18` est présent alors que Firebase CLI 15 exige un JDK 21 ou supérieur. Aucun JDK 21 n'a été trouvé dans les emplacements locaux vérifiés; aucune installation n'a été effectuée.
- gates: `npm run test:unit` a passé `417` fichiers / `3377` tests; `npm run test:integration` a passé `18` fichiers / `49` tests; les smoke Electron et SQLite/Electron ont passé; `git diff --check` a passé.
- manual/live: aucune règle, base, utilisateur Auth, document Firestore, bucket ou fichier cloud n'a été créé, modifié ou supprimé.
- remaining: installer/mettre à disposition un JDK 21 pour l'Emulator, puis obtenir l'autorisation explicite juste avant un test cloud qui crée une session/document ou un déploiement de règles. L'état des règles cloud et des fournisseurs Auth n'est pas affirmé sans cette lecture ou ce test dédié.

## 2026-08-02 08:34 | test/firebase | Emulator et règles locales exécutés de bout en bout

- files: `scripts/firebase-emulator-smoke.mjs`, `scripts/run-firebase-emulator-smoke.ps1`, `package.json`, `tests/firebase-deployment-config.test.mjs` et les deux guides Firebase.
- prerequisite: Eclipse Temurin JDK `21.0.12.8` a été installé via winget; le hash du MSI a été vérifié par winget. Le runner choisit explicitement un JDK 21 pour éviter le Java 17 hérité du processus courant.
- TDD: la première recette locale a rejeté correctement l'écriture Firestore invalide, mais l'assertion ne reconnaissait pas le code Storage réel `storage/unauthorized`; après correction minimale de l'assertion, la même recette a passé. Le corpus Firebase ciblé a passé `5` fichiers / `20` tests.
- live local: `npm run test:firebase:emulator` a démarré Auth, Firestore et Storage sur `127.0.0.1`, puis a confirmé `{"firestore":"rules_enforced","storage":"rules_enforced","network":"loopback_only"}`. La donnée relay valide et l'objet du propriétaire ont été supprimés dans le `finally`; le contenu de l'Emulator reste éphémère à l'arrêt.
- manual/live: aucune ressource Firebase distante n'a été lue, créée, modifiée ou supprimée par cette recette; aucune règle cloud n'a été déployée.
- remaining: une preuve cloud reste distincte et doit être autorisée immédiatement avant de créer une session/document distant ou de déployer les règles. Le projet, l'app et la base ont seulement été inventoriés en lecture seule dans l'entrée précédente.

## 2026-08-02 08:34 | runtime/vision | Gemma texte récupéré, vision locale crashée de façon reproductible

- files: aucun fichier source modifié; modèles LM Studio et observation locale uniquement.
- command: `lms load google/gemma-4-e2b --yes`; `lms load text-embedding-nomic-embed-text-v1.5 --yes`; sonde Mina `local-only` sur JPEG synthétique 1×1; rechargement Gemma; sonde texte Mina; `lms ps`; `npm run verify`.
- proof: Gemma et Nomic ont été chargés et le diagnostic Mina a vu les trois modèles configurés disponibles. La route vision Mina a échoué sur une seule image synthétique avec `camera_vision_all_providers_failed` puis `The model has crashed without additional information` et le code de sortie `18446744072635812000`; Gemma avait disparu de `lms ps`. Après rechargement, la même intégration Mina texte a retourné exactement `TEXT_LOCAL_OK` (usage final `25` / `134` / `159`). Aucun second essai vision n'a été lancé.
- capacity: la seule autre vision locale inventoriée (`zai-org/glm-4.6v-flash`) pèse `7.95 GiB`; la mémoire physique libre mesurée était `7.74 GiB` avant surcharge. Elle n'a pas été chargée ni configurée.
- manual/live: aucune caméra, photo utilisateur, microphone, fournisseur cloud ou fichier persistant n'a été utilisé; le JPEG de sonde est resté en mémoire.
- remaining: la génération texte/embedding est prouvée localement et Gemma est rechargé; la vision reste dégradée tant qu'un modèle vision stable adapté à la capacité machine n'est pas disponible et validé sur une sonde dédiée.

## 2026-08-02 08:51 | decision/product | avatar VRM explicitement hors périmètre

- source: décision explicite de Nasro : « pas de Avatar VRM ».
- files: `src/ui/main.mjs`, `tests/main-domain-composition-contract.test.mjs` et ce journal.
- proof: le catalogue runtime conserve `avatar.visage` à `unavailable`, avec la raison exacte `vrm_avatar_out_of_scope`; le contrat ciblé passe (`1` fichier / `3` tests).
- effect: les mentions historiques d'un asset VRM sous licence ou d'un choix d'asset VRM ne sont plus des tâches ouvertes. Aucun modèle, asset, dépendance ou distribution VRM ne sera ajouté.
- remaining: aucun travail VRM. Une éventuelle autre technologie d'avatar exigerait une nouvelle décision produit explicite.

## 2026-08-02 09:30 | fix/firebase | compte de service inter-projet refusé et topologie cloud relue

- files: `src/backup/custom-token-minter.mjs`, `src/diagnostics/firebase-health.mjs`, `scripts/verify-mina.mjs`, `src/ui/main.mjs`, `tests/custom-token-minter.test.mjs`, `tests/firebase-health.test.mjs`, `.env.example`, les deux guides Firebase et ce journal.
- TDD: le test de diagnostic avec `client: {}` a échoué comme attendu avec `TypeError: googleServices.client?.find is not a function`; le correctif vérifie désormais que la liste Android est bien un tableau. Le corpus ciblé a ensuite passé `4` fichiers / `14` tests. Le minteur refuse aussi, avant toute signature, un `serviceAccount.project_id` différent de `FIREBASE_PROJECT_ID`.
- commands: `npx vitest run tests/custom-token-minter.test.mjs tests/firebase-health.test.mjs tests/firebase-backup.test.mjs tests/firebase-deployment-config.test.mjs --maxWorkers=1 --no-file-parallelism`; `npm run verify:release`; `npm run test:firebase:emulator`; lectures cloud `gcloud firestore databases describe`, `gcloud storage buckets list`, `gcloud iam service-accounts list` et Firebase Rules API avec `X-Goog-User-Project: mina-vision`.
- exit: ciblé `0` (`4` fichiers / `14` tests) ; release `0` (unit `418` fichiers / `3 383` tests, intégration `18` / `49`, smoke Electron et SQLite/Electron passés) ; Emulator `0` (`firestore: rules_enforced`, `storage: rules_enforced`, `network: loopback_only`) ; lectures cloud `0`.
- proof local: `npm run verify` retourne `backup.firebase: degraded / firebase_service_account_project_mismatch`. Le fichier de compte de service ignoré actuellement présent déclare `mina-vission`, alors que la configuration attend `mina-vision`; aucun token n'est donc signé avec ce compte.
- proof cloud read-only: avec `mina.vision.ai@gmail.com` et le projet gcloud `mina-vision`, la politique IAM retourne exactement `roles/owner` pour cette adresse. Firestore `(default)` est `FIRESTORE_NATIVE` en `eur3`. La release distante `cloud.firestore` référence le ruleset `86199dee-794e-4a50-ab29-6e611986953f` (mise à jour `2026-07-23T04:00:56.501669Z`); son SHA-256 est `D30C513950ACB498B4608A7AB6F529F216551F92045608ECE9F02A367B74BEFF`, contre `F2F50EF6986418AD4D72C1547E6D7DA48F88B70434BA34BFF620529E29AEE67D` localement. Une comparaison après retrait des commentaires et espaces prouve que la seule différence source est le bloc local explicite `match /{document=**} { allow read, write: if false; }`, absent de la release distante; ce résultat textuel ne prouve pas à lui seul le comportement live des autres chemins. La liste Cloud Storage est vide et la release `firebase.storage` répond `404`. Le compte de service existant correct est `firebase-adminsdk-fbsvc@mina-vision.iam.gserviceaccount.com` (`firebase-adminsdk`).
- manual/live: aucune clé privée, bucket, session Auth, document Firestore, objet Storage ou règle distante n'a été créé, modifié ou supprimé. La différence de hash des règles ne permet pas d'affirmer un écart de comportement sans recette cloud autorisée.
- remaining: décision et autorisation distinctes requises pour (1) initialiser le bucket Storage par défaut, avec choix explicite d'emplacement/coût, (2) créer une nouvelle clé du compte `mina-vision` dans un chemin ignoré ou fournir un endpoint de jeton, puis (3) déployer les règles et exécuter une recette cloud éphémère. Aucune de ces trois actions n'est implicite dans les lectures réalisées.

## 2026-08-02 10:01 | fix/vision | vision Gemma explicitement désactivée après crash local confirmé

- files: `src/config/config-schema.mjs`, `src/config/config-service.mjs`, `src/diagnostics/lm-studio-health.mjs`, `src/providers/camera-vision-runtime.mjs`, `src/ui/renderer.js`, `.env.example`, les cinq tests ciblés et ce journal.
- TDD: les nouveaux tests ont d'abord échoué (`5` échecs) : la vision LM Studio restait enregistrée même avec `visionEnabled: false`, le schéma ne connaissait pas le flag et les réglages ne pouvaient pas le persister. La correction ajoute `LM_STUDIO_VISION_ENABLED=false` par défaut, le rend éditable sans secret et exclut le provider caméra local sans opt-in explicite. La sonde de santé publie alors `vision.enabled:false`, `vision.loaded:false`, `lm_studio_vision_disabled`, sans dégrader texte/embedding.
- gates: le corpus ciblé a passé `7` fichiers / `39` tests. `npm run verify:release` a passé unit `418` fichiers / `3 388` tests, intégration `18` / `49`, smoke Electron et SQLite/Electron. Son diagnostic voit Gemma texte et Nomic chargés, mais la vision locale délibérément désactivée. Une sonde texte Mina locale avec l'instance Gemma `4096` tokens / `1` flux a retourné exactement `MINA_LOCAL_TEXT_4096` (usage `31` / `12` / `43`).
- live local: après rechargement Gemma à `4096` tokens et `1` flux, une unique requête loopback sur JPEG synthétique 1×1, `64` tokens maximum, a retourné HTTP `400` avec `The model has crashed without additional information. (Exit code: 18446744072635812000)` puis a déchargé Gemma. Cela élimine le contexte `1000` et la sortie `640` comme seule explication observée. Gemma a été rechargé sans image après la sonde.
- capture paths: le code conserve la webcam PC via `navigator.mediaDevices.getUserMedia` puis `mina:analyze-vision-frame`, et le flux téléphone via `mina:phone-camera`, `shared-camera-runtime` et les enveloppes Android signées. Aucune webcam ni téléphone réel n'a été ouvert dans cette entrée.
- remaining: fournir ou autoriser un modèle vision local stable, puis une sonde dédiée réussie avant de passer `LM_STUDIO_VISION_ENABLED=true`; exécuter séparément les recettes physiques webcam PC et Android autorisé.

## 2026-08-02 10:12 | cloud/firebase | bucket Storage créé hors Mina, règles encore absentes

- files: ce journal et le tableau des tâches restantes.
- command: `gcloud storage buckets describe gs://mina-vision.firebasestorage.app --format=json`; lecture Firebase Rules API de `projects/mina-vision/releases/firebase.storage`.
- exit: `0` pour la description du bucket ; la lecture de release retourne HTTP `404`.
- proof: le bucket `gs://mina-vision.firebasestorage.app` est présent, créé à `2026-08-02T08:52:11Z`, emplacement `US-CENTRAL1`, type `region`, classe par défaut `REGIONAL`, et politique de soft-delete de `604800` secondes. La règle Firebase Storage n'est pas encore publiée. Cette entrée constate une création cloud observée; Mina n'a créé, modifié ni déployé aucune ressource dans cette vérification.
- remaining: obtenir l'autorisation explicite avant de créer une clé de service locale ou un endpoint de jeton, de déployer `storage`/`firestore` rules, puis de créer une session/document/objet de recette éphémère.

## 2026-08-02 10:17 | docs/reconciliation | entrées caméra distinguées de l'analyse locale et périmètre VRM fermé

- files: `docs/superpowers/execution/2026-08-02-mina-remaining-work.md`, ce journal, et les documents de travail locaux ignorés `docs/superpowers/plans/2026-07-29-mina-audit-reconciliation-plan.md` / `docs/superpowers/specs/2026-07-24-mina-visage-avatar-spec.md`.
- source: précision explicite de Nasro : Mina dispose aussi de la vision par caméra du PC et des téléphones ; décision antérieure : « pas de Avatar VRM ».
- proof source: `src/ui/renderer.js` appelle `navigator.mediaDevices.getUserMedia` puis `mina:analyze-vision-frame`; `src/ui/main.mjs` expose `mina:phone-camera` et démarre le flux caméra partagé. Le runtime conserve donc les deux entrées. `npm run verify` retourne `lmStudio.ready: true` avec Gemma texte et Nomic embedding chargés, mais `vision.enabled:false`, `vision.loaded:false`, raison `lm_studio_vision_disabled`.
- scope: le crash image de Gemma reste séparé des captures; aucune webcam PC, caméra téléphone, permission matérielle, image utilisateur ou modèle vision alternatif n'a été lancé. L'avatar VRM reste `unavailable / vrm_avatar_out_of_scope`.
- git: les dossiers `docs/superpowers/plans/` et `docs/superpowers/specs/` sont volontairement ignorés par `.gitignore` comme documents de travail privés. Leurs mises à jour locales ne sont pas forcées dans le dépôt; ce journal versionné porte la trace de réconciliation publiable.
- remaining: choisir/provisionner un modèle vision stable, réussir une sonde image dédiée, puis exécuter séparément les recettes physiques webcam PC et Android autorisé. Aucun travail VRM ne reste.

## 2026-08-02 10:23 | runtime/vision | seul modèle vision alternatif local non chargé faute de marge mémoire observée

- command: `lms ps`; `lms ls --json`; `lms load zai-org/glm-4.6v-flash --context-length 4096 --parallel 1 --estimate-only`; lecture mémoire physique Windows et contrôleur graphique.
- proof: Gemma (`4,41 GB`, contexte `4096`, parallèle `1`) et Nomic sont les seules instances chargées. Les deux seuls modèles locaux déclarant `vision:true` sont Gemma et `zai-org/glm-4.6v-flash` (`7 953 555 436` octets, `9,4B`, Q4_K_M). L'estimation LM Studio pour GLM à `4096`/`1` est `7,83 GiB` de mémoire totale. La mémoire physique libre observée est `0,68 Gio` sur `15,92 Gio`; le contrôleur déclaré est Intel UHD 630 (`1 Gio` d'AdapterRAM), sans `nvidia-smi` disponible.
- decision: aucune charge de GLM n'est tentée dans cet état, afin de ne pas déstabiliser LM Studio ou le poste. Cette décision ne conclut pas que GLM échouerait : elle constate seulement qu'aucune marge mémoire vérifiée ne permet une recette prudente.
- remaining: libérer/provisionner une marge mémoire appropriée ou choisir un modèle vision plus léger, puis autoriser une unique sonde image locale avant toute recette webcam/téléphone.

## 2026-08-02 10:35 | fix/voice | TTS locale réellement hors ligne, STT cache-only préparé

- files: `src/voice/local-voice-offline-policy.mjs`, `src/voice/local-voice-worker.mjs`, `src/chat/voice-transcriber.mjs`, `src/ui/main.mjs`, tests voix et ce journal.
- TDD: le test de politique hors-ligne a d'abord échoué faute de module. Le test STT a ensuite échoué avec l'ancien refus inconditionnel `stt_modele_absent_mode_hors_ligne`. La correction interdit tout `fetch` dans le worker Kokoro quand `MINA_OFFLINE=true`; le transcripteur transmet désormais `localFilesOnly:true` au loader, et le loader Electron le traduit en `local_files_only:true` pour transformers.js. Les `4` fichiers ciblés passent (`20` tests).
- live local: avec `MINA_OFFLINE=true` et sans microphone, le warm-up Kokoro a retourné `ready:true`, puis la synthèse française `Bonjour Mina.` a retourné un chunk PCM à `24 000 Hz`. Le worker aurait rejeté un accès réseau sous `local_voice_network_forbidden`; le succès établit que le chargement n'a pas eu besoin de `fetch`. Les poids TTS locaux observés sont sous `node_modules/kokoro-js/node_modules/@huggingface/transformers/.cache/onnx-community/Kokoro-82M-v1.0-ONNX/` (`model_q4.onnx`, `305 215 966` octets).
- STT: la configuration actuelle est `MINA_STT_ENABLED=false`, modèle `Xenova/whisper-small`. Aucun fichier Whisper/Xenova n'a été trouvé dans les emplacements de cache configurés ou attendus; aucune transcription réelle, aucun téléchargement et aucun microphone n'ont été utilisés.
- gates: `npm run verify:release` passe : `419` fichiers / `3 390` tests unitaires, `18` / `49` intégration, smoke Electron et SQLite/Electron. Le diagnostic runtime conserve correctement la vision Gemma désactivée et Firebase dégradé pour le compte de service inter-projet.
- remaining: la bouche TTS locale est prouvée. Il reste à provisionner explicitement Whisper ou un autre modèle STT local, activer le STT, puis réaliser une recette microphone → STT local → Gemma → Kokoro avec le réseau désactivé. Le cache TTS actuel sous `node_modules` demeure aussi un sujet de packaging, distinct de la preuve runtime.

## 2026-08-02 10:49 | deploy/firebase | règles Storage publiées et refus anonyme prouvé

- command: pré-vol Firebase CLI sur `mina.vision.ai@gmail.com` / projet `mina-vision`; `firebase deploy --only storage --project mina-vision --non-interactive`; lectures Firebase Rules API et requête anonyme `GET /v0/b/mina-vision.firebasestorage.app/o`.
- deploy: la CLI a compilé `firebase.storage.rules`, activé/vérifié `firebasestorage.googleapis.com`, puis publié la release Storage. La release active est `projects/mina-vision/releases/firebase.storage/mina-vision.firebasestorage.app`, ruleset `82df4019-5889-4a38-b72c-3589c359c014`, mise à jour `2026-08-02T09:46:54.693393Z`.
- proof: le SHA-256 distant et local est exactement `4A7B7E46E9DE1CA3382497B7C1BA2B8A17510983DBC027010E111A7A95D65B53`; la lecture anonyme de la liste d'objets retourne `403 Permission denied`. Aucun objet Storage ni utilisateur Auth n'a été créé. Firestore n'a pas été modifié.
- credentials: l'inventaire local des JSON ignore les secrets et ne trouve aucun compte de service `mina-vision`; le seul JSON de service présent déclare `mina-vission` et reste refusé par Mina. Aucune clé n'a été créée.
- remaining: fournir ou autoriser la création d'une clé locale ignorée du compte `firebase-adminsdk-fbsvc@mina-vision.iam.gserviceaccount.com`, ou fournir un endpoint de jeton équivalent, puis une recette cloud éphémère Auth/Firestore/Storage. La release Firestore existante reste inchangée.

## 2026-08-02 11:08 | fix/firebase | sauvegarde cloud réelle prouvée et restauration corrigée

- credentials: pré-vol relu : `mina.vision.ai@gmail.com` est `roles/owner` du projet `mina-vision`; Firebase CLI est connecté avec `mina.vision.ai@gmail.com`. Le compte `firebase-adminsdk-fbsvc@mina-vision.iam.gserviceaccount.com` dispose de Firebase SDK Admin, Firebase Auth Admin, IAM Token Creator et Storage Admin. Aucune clé utilisateur préexistante n'était listée. Une nouvelle clé JSON a été créée exclusivement sous `env/` ignoré et référencée dans `.env`, sans afficher ni versionner son contenu.
- TDD: le test de `firebaseConfigFromGoogleServices` a d'abord échoué car le résultat ne contenait pas `authDomain`; le correctif dérive `${project_id}.firebaseapp.com`. La recette cloud a ensuite révélé `firebase_object_key_invalid` à la restauration : `restore-service` passait `tombstones/`, que l'adaptateur Storage refuse à juste titre. Un test rouge reproduit un remote qui refuse les slashs terminaux; la correction passe `tombstones`. Les six fichiers ciblés passent (`34` tests).
- live: avec un UID et un device aléatoires, le custom token réel a été accepté. Firestore a accepté l'enveloppe conforme et refusé la version contenant `plaintext`; Storage a accepté l'aller-retour propriétaire et refusé un chemin d'un autre propriétaire. Le domaine de sauvegarde réellement composé a uploadé un blob, vérifié que le texte de contrôle n'y figurait pas, puis restauré exactement l'enregistrement.
- cleanup: les deux recettes ont supprimé leurs documents, objets et utilisateurs Auth temporaires sans erreur de nettoyage. La commande Storage en lecture seule retourne ensuite `bucket_empty_after_cloud_proof`. La release Firestore existante n'a pas été déployée ni modifiée.
- gates: `npm run verify:release` passe : `419` fichiers / `3 391` tests unitaires, `18` fichiers / `49` tests d’intégration, smoke Electron et smoke SQLite/Electron. Les gates manuels Android, Home, mail, Sandbox et microphone restent explicitement non exécutés.
- remaining: Firebase cloud est clos avec preuve live. Le diagnostic local conserve intentionnellement `firebase_cloud_unverified`, car le rendre « ready » exigerait un appel cloud implicite à chaque vérification.
