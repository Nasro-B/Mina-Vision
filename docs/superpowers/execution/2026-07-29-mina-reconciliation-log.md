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
