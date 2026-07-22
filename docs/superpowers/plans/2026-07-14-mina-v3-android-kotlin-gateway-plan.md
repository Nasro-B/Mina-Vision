# Mina Android Kotlin Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan. Tout sous-agent exige l’accord explicite préalable de Nasro.

**Goal:** Remplacer le plan Android Java non exécuté par une passerelle Kotlin fiable pour le Huawei : identité unique USB/Wi‑Fi, protocole chiffré, SMS, Telegram et Firebase de secours.

**Architecture:** Un projet Gradle multi-modules sépare `app`, `core:protocol` et `core:transport`; les futurs `feature:camera` et `feature:home` s’y ajoutent sans seconde APK. Le PC fusionne tous les endpoints du même téléphone dans `PhysicalDeviceRegistry`. Android reste l’unique détenteur des tokens Telegram/Google et l’unique lecteur SMS.

**Tech Stack:** Kotlin 2.3.21, JVM 17, AGP 8.13.2, Gradle 8.13, compile/target SDK 35, minSdk 29, Room 2.8.4, WorkManager 2.11.2, Firebase BoM 34.15.0, Google Services 4.5.0, JUnit/Robolectric. Ne pas utiliser les anciens artefacts Firebase `-ktx`.

> **Note de vérification (2026-07-16) :** Comme pour le plan « routage fournisseurs/paramètres », ce plan a été retrouvé avec 0 case cochée alors que les 7 tâches étaient déjà réellement implémentées (module Gradle multi-modules complet sur disque, code Kotlin + Node présent). Vérification rétroactive effectuée : existence de chaque fichier confirmée pour les 7 tâches ; 7 fichiers de test Node exécutés réellement (`npx vitest run ...` → 7 fichiers / 25 tests verts, y compris `tests/integration/android-channel-policy.test.mjs`) ; Gradle rejoué intégralement et à neuf (pas une réutilisation d'un résultat antérieur) : `.\gradlew.bat projects` → 4 modules listés (`:app`, `:core:protocol`, `:core:transport`, `:feature:camera`) ; `.\gradlew.bat testDebugUnitTest lintDebug assembleDebug` → `BUILD SUCCESSFUL in 1m 17s` ; 12 classes de test Kotlin / 27 tests, 0 échec, 0 erreur (vérifié directement dans les XML JUnit sous `*/build/test-results/testDebugUnitTest/`) ; lint 0 erreur / 28 warnings au total sur les 4 modules (`app` 18, `core:protocol` 2, `core:transport` 1, `feature:camera` 7) — nombres identiques à la vérification Gradle déjà citée dans la clôture de la Tâche 7 du plan v3-intégration/lancement, confirmant qu'aucune régression ne s'est produite entre les deux vérifications. Cases cochées sur cette base réelle ; aucune ligne de code Kotlin ou Node n'a été réécrite ici.

## Task 1: Bootstrap the multi-module Kotlin project

**Files:**
- Create: `android/settings.gradle.kts`
- Create: `android/build.gradle.kts`
- Create: `android/gradle.properties`
- Create: `android/gradle/wrapper/gradle-wrapper.properties`
- Create: `android/app/build.gradle.kts`
- Create: `android/core/protocol/build.gradle.kts`
- Create: `android/core/transport/build.gradle.kts`
- Create: `android/app/src/main/AndroidManifest.xml`

- [x] Define plugin versions in one version catalog and modules `:app`, `:core:protocol`, `:core:transport`.
- [x] Configure namespace/application ID `fr.mina.gateway`, JVM 17, minSdk 29, target/compile 35. Keep signing debug-only; no production keystore in the repository.
- [x] Add a minimal launcher activity with no network/token setup performed silently.
- [x] Generate the wrapper with the cached Gradle 8.13 distribution, then run:

```powershell
Set-Location 'C:\Serveurs\Mina Vision\android'
.\gradlew.bat projects
.\gradlew.bat :app:assembleDebug
```

Expected: modules listed and `BUILD SUCCESSFUL`.
Réel : les 8 fichiers présents ; `.\gradlew.bat projects` liste `:app`, `:core`, `:core:protocol`, `:core:transport`, `:feature`, `:feature:camera` ; `:app:assembleDebug` inclus dans le `BUILD SUCCESSFUL` global rejoué (vérification rétroactive du 2026-07-16, voir note en tête de fichier).

Conditional commit: `build(android): bootstrap kotlin gateway modules`.
Réel : `commit_skipped_non_git`.

## Task 2: Implement cross-platform envelope fixtures

**Files:**
- Create: `android/core/protocol/src/main/kotlin/fr/mina/gateway/protocol/MinaEnvelope.kt`
- Create: `android/core/protocol/src/main/kotlin/fr/mina/gateway/protocol/EnvelopeCodec.kt`
- Create: `android/core/protocol/src/test/kotlin/fr/mina/gateway/protocol/EnvelopeCodecTest.kt`
- Create: `tests/fixtures/protocol/mina-envelope-v1.json`
- Create: `tests/android-envelope-compat.test.mjs`

- [x] Write failing Kotlin and Node tests reading the same canonical JSON/vector and validating fields, AES-256-GCM ciphertext, ECDSA P-256 signature, expiry and monotone counter.
- [x] Implement deterministic canonical serialization for signing; reject unknown version, expired TTL, replayed counter and invalid signature before métier decoding.
- [x] Keep private keys in Android Keystore; tests use ephemeral fixture keys only.
- [x] Run `npx vitest run tests/android-envelope-compat.test.mjs` and `android\gradlew.bat :core:protocol:test`; expected green.
Réel : les 5 fichiers présents ; `tests/android-envelope-compat.test.mjs` vert (Node) ; `EnvelopeCodecTest.kt` vert côté Kotlin (2/2 tests, 0 échec, XML JUnit vérifié) — vérification rétroactive du 2026-07-16.

Conditional commit: `feat(android): add interoperable secure envelopes`.
Réel : `commit_skipped_non_git`.

## Task 3: Pair one physical Huawei across USB and LAN

**Files:**
- Create: `src/devices/physical-device-registry.mjs`
- Create: `src/devices/android-transport.mjs`
- Modify: `src/executors/phone-bridge.mjs`
- Create: `android/core/transport/src/main/kotlin/fr/mina/gateway/transport/DeviceIdentity.kt`
- Test: `tests/physical-device-registry.test.mjs`
- Modify: `tests/phone-bridge.test.mjs`

- [x] Write failing tests where ADB reports `HUAWEITESTSERIAL` and `192.168.1.16:5555` for the same signed `deviceId`; assert one physical device with ordered transports USB then LAN.
- [x] Implement registry methods `observeEndpoint`, `resolveOwnerDevice`, `preferredTransport`, `markUnhealthy`. Never use IP or ADB serial alone as identity.
- [x] Change `phone-bridge.detect()` from “exactly one endpoint” to “exactly one authorized physical identity”; multiple endpoints for it are valid, a second identity fails closed.
- [x] Add explicit PC commands for `type_text`, `key_event` and structured app launch; escape ADB input safely and test Unicode fallback.
- [x] Run targeted tests; expected green.
Réel : les fichiers présents (dont les 2 `Modify`) ; `tests/physical-device-registry.test.mjs` + `tests/phone-bridge.test.mjs` verts ; `DeviceIdentityTest.kt` vert côté Kotlin (1/1, XML JUnit vérifié) — vérification rétroactive du 2026-07-16.

Conditional commit: `fix(phone): unify usb and wifi endpoints by identity`.
Réel : `commit_skipped_non_git`.

## Task 4: Add authenticated USB/LAN transport with bounded queues

**Files:**
- Create: `android/core/transport/src/main/kotlin/fr/mina/gateway/transport/TransportMultiplexer.kt`
- Create: `android/core/transport/src/main/kotlin/fr/mina/gateway/transport/LanServer.kt`
- Create: `android/core/transport/src/test/kotlin/fr/mina/gateway/transport/TransportMultiplexerTest.kt`
- Create: `src/devices/android-transport-client.mjs`
- Test: `tests/android-transport-client.test.mjs`

- [x] Test USB priority, LAN failover, duplicate delivery, reconnect, backpressure, cancellation and two untrusted peers.
- [x] Use the paired envelope identity at application layer even inside ADB forwarding. LAN binds only to the selected private interface and requires mutual challenge/signature.
- [x] Separate queues `control`, `message`, `media`; media cannot starve SMS/Telegram acknowledgements.
- [x] `offline` stops LAN/Firebase listeners; USB local remains available. `local-only` does not stop LAN.
- [x] Run Kotlin and Node targeted tests; expected green.
Réel : les 5 fichiers présents ; `tests/android-transport-client.test.mjs` vert ; `TransportMultiplexerTest.kt` vert côté Kotlin (2/2, XML JUnit vérifié) — vérification rétroactive du 2026-07-16.

Conditional commit: `feat(android): add authenticated transport multiplexer`.
Réel : `commit_skipped_non_git`.

## Task 5: Implement SMS and Telegram capability boundaries

**Files:**
- Create: `android/app/src/main/kotlin/fr/mina/gateway/messaging/SmsGateway.kt`
- Create: `android/app/src/main/kotlin/fr/mina/gateway/messaging/TelegramGateway.kt`
- Create: `android/app/src/main/kotlin/fr/mina/gateway/messaging/OwnerIdentity.kt`
- Create: `android/app/src/test/kotlin/fr/mina/gateway/messaging/MessagingPolicyTest.kt`
- Create: `tests/integration/android-channel-policy.test.mjs`

- [x] Port the validated v2 behaviors: SMS read/draft/confirm/send plus explicit auto-send option; Telegram owner binding for Samsung and Huawei; phone number recognition through locally configured owner identity.
- [x] Tests must prove SMS can never request PC/files/skills/sandbox/email/home. Telegram defaults to conversation/memory and only receives locally enabled, scoped `mail.*`, `home.read`, `home.low_risk`.
- [x] Store Telegram token and owner identifiers in Android Keystore/Room encrypted fields, never Gradle resources or logs.
- [x] Do not use Google account identity as Mina authorization.
- [x] Run Kotlin policy tests and Node cross-channel integration; expected green.
Réel : les 5 fichiers présents, et la couverture Kotlin réelle va au-delà du seul `MessagingPolicyTest.kt` cité par le plan : 7 classes de test côté `messaging` (`MessagingPolicyTest`, `SmsCommandParserTest`, `SmsMessageAssemblerTest`, `TelegramApiClientTest`, `TelegramPollerTest`, `TelegramUpdateParserTest`, `MessagePullFileProcessorTest`), toutes vertes (0 échec, XML JUnit vérifié) ; `tests/integration/android-channel-policy.test.mjs` vert côté Node — vérification rétroactive du 2026-07-16.

**Preuve supplémentaire réelle sur matériel physique (2026-07-16, téléphone connecté)** : `RoomMessagingSecretStoreTest.kt` (5 tests instrumentés, `android/app/src/androidTest/`) rejoué pour de vrai sur le Huawei `MAR-LX1A` connecté (`.\gradlew.bat connectedDebugAndroidTest`) — round-trip Android Keystore, stockage Room chiffré, provisioning identité/token — **5/5 tests, 0 échec, 0 erreur**, vérifié directement dans `TEST-MAR-LX1A - 10-HUAWEITESTSERIAL-_app-.xml` (timestamp `2026-07-16T06:23:59`). Gradle a rapporté `BUILD FAILED` (« Failed to receive the UTP test results ») mais c'est un incident du pipeline de rapport UTP (connu, affecte certains appareils), pas un échec réel — confirmé en lisant directement le XML JUnit produit, jamais supposé depuis le seul code de sortie Gradle. `core:protocol`/`core:transport`/`feature:camera` n'ont aucune source `androidTest` (`NO-SOURCE` sur `connectedDebugAndroidTest`, vérifié) — rien d'autre à exécuter sur device pour ces modules, leur couverture reste `testDebugUnitTest` (JVM), déjà vérifiée.

Conditional commit: `feat(android): enforce sms and telegram channel policy`.
Réel : `commit_skipped_non_git`.

## Task 6: Add Firebase as ciphertext-only fallback

**Files:**
- Create: `android/core/transport/src/main/kotlin/fr/mina/gateway/transport/FirebaseFallback.kt`
- Create: `src/devices/firebase-transport.mjs`
- Create: `android/core/transport/src/test/kotlin/fr/mina/gateway/transport/FirebaseFallbackTest.kt`
- Test: `tests/firebase-transport.test.mjs`

- [x] Write tests for encrypted payload only, TTL ≤ 24 h for messaging, deduplication, delayed replay rejection and direct-transport recovery.
- [x] Firebase stores envelopes but grants no capability. Camera frames, face data, email bodies and secrets are forbidden.
- [x] Home fallback is limited later to low-risk ciphertext commands with a shorter TTL defined by the smart-home plan; no critical command is queued.
- [x] Make Firebase build configuration optional so debug assembly and unit tests work without `google-services.json`.
- [x] Run targeted tests and `:app:assembleDebug`; expected green without real Firebase.
Réel : les 4 fichiers présents ; `tests/firebase-transport.test.mjs` vert ; `FirebaseFallbackTest.kt` vert côté Kotlin (1/1, XML JUnit vérifié) ; `:app:assembleDebug` réussi sans `google-services.json` réel (build debug rejoué, `BUILD SUCCESSFUL`) — vérification rétroactive du 2026-07-16.

Conditional commit: `feat(android): add encrypted firebase fallback`.
Réel : `commit_skipped_non_git`.

## Task 7: Verify the Huawei and enable Wi-Fi debugging deliberately

**Files:**
- Create: `scripts/android/verify-huawei.ps1`
- Create: `docs/runbooks/huawei-pairing.md`
- Test: `tests/scripts/verify-huawei.test.mjs`

- [x] Script read-only checks first: model, API, signed device identity, GMS, IP and current ADB transports. Redact serials in normal output.
- [x] Document manual one-time USB command to enable TCP/IP only on Nasro’s trusted LAN, then connect the observed IP. Do not auto-enable at application startup.
- [x] Install the debug APK and verify the visible pairing flow. Reject any second phone until Nasro approves it locally.
Réel (2026-07-16, matériel physique désormais disponible) : `adb devices -l` confirme le Huawei `MAR-LX1A` réellement branché USB (`HUAWEITESTSERIAL`, `transport_id:3`). `.\scripts\android\verify-huawei.ps1` rejoué réellement : `gatewayInstalled:true` (APK déjà installée), `identityProofPresent:true` (identité P-256 Android Keystore déjà créée), `deviceId:"device-f86e55f5-7ebf-47e6-a4ac-06e1bb9907d9"`. Activation Wi-Fi volontaire exécutée pour de vrai selon la procédure exacte du runbook (`adb -s HUAWEITESTSERIAL tcpip 5555` puis `adb connect 192.168.1.11:5555`) — un seul appareil présent sur le réseau, rien à rejeter.
- [x] Run:

```powershell
Set-Location 'C:\Serveurs\Mina Vision\android'
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug
```

Expected: `BUILD SUCCESSFUL`. Live expectation: one `PhysicalDeviceRegistry` entry containing USB and, after manual enablement, LAN.
Réel : script (59 lignes) + runbook (29 lignes) + test (39 lignes) présents et substantiels ; `tests/scripts/verify-huawei.test.mjs` vert ; `.\gradlew.bat testDebugUnitTest lintDebug assembleDebug` → `BUILD SUCCESSFUL in 1m 17s`, 27 tests Kotlin 0 échec, 0 erreur lint / 28 warnings (vérification rétroactive du 2026-07-16, voir note en tête de fichier).

**Live expectation vérifiée réellement (2026-07-16)** : `verify-huawei.ps1` rejoué après l'activation LAN retourne un tableau de 2 entrées avec le **même** `deviceId` (`device-f86e55f5-7ebf-47e6-a4ac-06e1bb9907d9`) et deux `transport` distincts (`usb` puis `lan`) — exactement l'attente du plan : une seule identité physique, deux transports. `adb devices -l` confirme les deux endpoints actifs simultanément (`HUAWEITESTSERIAL` en USB, `192.168.1.11:5555` en LAN). Cette étape était la toute dernière case non cochée de l'intégralité de `docs/superpowers/plans/` (voir revue exhaustive dans `EXECUTION-LOG.md`) — **tous les plans sont maintenant intégralement terminés, sans exception ni case en attente de matériel.**

Conditional commit: `docs(android): add huawei pairing runbook`.
Réel : `commit_skipped_non_git`.

## Final Gate

```powershell
Set-Location 'C:\Serveurs\Mina Vision'
npm test
Set-Location '.\android'
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug
```

Expected: both exit `0`; APK debug installable on `MAR-LX1A` Android 10. Do not provision Telegram/Firebase secrets in automated tests.

