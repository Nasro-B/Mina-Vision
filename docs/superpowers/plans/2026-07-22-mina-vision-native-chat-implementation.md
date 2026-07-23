# Mina Vision Native Android Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. `superpowers:subagent-driven-development` is permitted only after Nasro explicitly approves the number and role of every sub-agent.

**Goal:** livrer sur le Samsung et le Huawei un chat Mina Vision natif, chiffré, multi-device et utilisable sans Telegram, avec transport direct prioritaire, Firebase en secours, historique complet, médias, voix et approbations gouvernées par le PC.

**Architecture:** chaque téléphone écrit d’abord des enveloppes E2EE dans Room ciphertext-only, sous le stockage privé/FBE Android, puis utilise un WebSocket Mina chiffré quand le PC est joignable, sinon le projet Firebase existant comme boîte de synchronisation ciphertext-only. Le PC reste l’unique cerveau et l’unique autorité d’action ; les appareils possèdent des rôles/capacités révocables, des clés Android Keystore et un ledger commun aux deux transports garantissant une seule réponse finale visible et aucun effet dupliqué.

**Tech Stack:** Windows 11, Node.js 22, Electron 43.1.0, JavaScript ESM, Vitest 4.1.10, `better-sqlite3` 12.11.1, Firebase JS 12.16.0, Firebase Functions 7.3.0, Firebase Admin 14.2.0, Firebase Tools 15.24.0, `qrcode` 1.5.4, `ws` 8.21.1 ; Android Kotlin 2.3.21, Coroutines 1.11.0, JVM 17, AGP 8.13.2, Gradle 8.13, compile/target SDK 35, minSdk 29, AndroidX Core 1.19.0, Lifecycle 2.11.0, DataStore 1.2.1, Room 2.8.4, Compose BOM 2026.06.00, Firebase Android BoM 34.16.0, Google Services 4.5.0, WorkManager 2.11.2, Activity 1.13.0, Navigation 2.9.8, Biometric 1.1.0, CameraX 1.5.3 existant, ZXing Core 3.5.4, OkHttp BOM 5.3.0.

## Global Constraints

- Le projet actif est exclusivement `C:\Serveurs\Mina Vision`; l’ancien Mina AI reste hors périmètre.
- Le projet possède un dépôt Git strictement local sans remote configuré au 2026-07-22 ; les commits du plan sont des checkpoints locaux. Aucun `push` n’est supposé ni requis.
- Conserver `applicationId = "fr.mina.gateway"`, `minSdk = 29`, `compileSdk = targetSdk = 35` et JVM 17 pour préserver l’installation Huawei et l’enregistrement Firebase existants.
- Utiliser le projet Firebase déjà créé ; aucun second projet Firebase, Huawei/AppGallery ou backend IA cloud.
- Firebase ne reçoit que ciphertext, signatures et métadonnées de routage minimales ; aucun texte, nom de fichier, miniature, audio, secret ou détail d’action en clair.
- Le PC reste requis pour toute réponse IA. PC arrêté signifie `En attente du PC`, jamais une génération cloud de substitution.
- L’historique complet reste chiffré sur le PC et chaque appareil actif ; Firebase est une boîte de synchronisation dont chaque copie possède une lease maximale de 30 jours, renouvelable seulement pour une outbox source non acquittée et déclarée comme telle dans le data map.
- `MINA.md` reste inchangé jusqu’à validation explicite par Nasro de l’amendement exact `mina_app` décrit en Task 0.
- Toute action suit `computer-action-authorizer` puis le capability broker existants. Aucune seconde autorité d’action n’est créée dans le chat.
- Toute capacité `local_only` est impossible à approuver dans l’APK.
- Telegram reste fonctionnel mais optionnel ; aucun composant du chat natif ne dépend du token ou du poller Telegram.
- Les artefacts Firebase Android `-ktx` sont interdits ; utiliser les modules principaux gérés par le BoM 34.16.0.
- Les secrets administratifs Firebase restent uniquement dans l’environnement managé des Functions ; aucun fichier de compte de service dans le dépôt, l’APK ou `.env`.
- Android laisse Firebase Auth persister sa session dans le sandbox afin que le fallback fonctionne PC arrêté, mais Mina ne lit, ne copie et ne journalise jamais ces credentials ; `allowBackup=false`, révocation ciblée et `signOut()` à la révocation sont obligatoires.
- Play Integrity Samsung n’est annoncé `hardware` que si le projet est lié et configuré pour l’APK sideloadée ; sinon le fournisseur custom appairé est utilisé et publié `software_paired`/`degraded`.
- TDD obligatoire : test rouge observé, implémentation minimale, test vert, puis gate impacté avant chaque commit.
- Diff minimal par tâche. Aucun reformatage ou renommage sans nécessité fonctionnelle.
- Aucun `git push`, déploiement Firebase, activation App Check enforcement ou publication APK sans ordre explicite de Nasro.
- Aucun sous-agent sans annonce du nombre/rôle et autorisation explicite de Nasro.

---

## Carte des vagues

| Vague | Tasks | Livrable testable |
|---|---:|---|
| 0 — autorité et baseline | 0-1 | constitution validée, baseline verte, modules Android compilables |
| 1 — protocole et identité | 2-5 | fixtures Node/Kotlin, crypto par époque, appareils/rôles et pairing local |
| 2 — boucle texte locale | 6-9 | Samsung/Huawei ↔ PC en direct, ledger durable, une réponse finale sans effet dupliqué |
| 3 — Firebase et hors-ligne | 10-14 | Auth/App Check, rules, sync, FCM/WorkManager, historique complet multi-device |
| 4 — expérience complète | 15-19 | Compose, médias, notifications et approbations biométriques |
| 5 — voix et robustesse | 20-23 | note/PTT/live LAN-VPN, révocation, budgets, diagnostics et réparation |
| 6 — release | 24-25 | Emulator Suite, appareils physiques, gates sécurité, documentation et rollback |

## Structure de fichiers cible

### Android

```text
android/
  core/chat/                 # Room, crypto local, outbox, sync, pièces jointes
  core/protocol/             # enveloppes v1/v2 + contrats/fixtures communs
  core/transport/            # direct, Firebase, files et sélection
  feature/chat/              # Compose + ViewModel
  feature/voice/             # note, PTT, live
  app/                       # composition, navigation, notifications, services
```

### PC et Firebase

```text
src/contracts/chat.mjs
src/devices/chat-crypto.mjs
src/devices/trusted-chat-device-store.mjs
src/devices/native-chat-store.mjs
src/devices/native-chat-direct-server.mjs
src/devices/firebase-chat-backend.mjs
src/devices/native-chat-sync.mjs
src/messaging/native-chat-service.mjs
src/approvals/app-approval-adapter.mjs
src/voice/native-chat-live-bridge.mjs
src/devices/migrations/001-native-chat-devices.sql
src/devices/migrations/002-native-chat-ledger.sql
src/devices/migrations/003-native-chat-approvals.sql
functions/src/*.mjs
firestore.rules
database.rules.json
firebase.storage.rules
firebase.json
```

---

### Task 0: Gate constitutionnel `mina_app` et baseline post-réconciliation ✅ FAIT (2026-07-23)

> Amendement MINA.md validé explicitement par Nasro (AskUserQuestion) ; ligne ajoutée dans `## Canaux` ; test `tests/architecture/mina-app-constitution.test.mjs` vert. Baseline : arbre git propre, gates verts (2803+48 au dernier gate). Firebase : décision Nasro « projet réel créé par Claude via navigateur à la vague qui l'utilise ». Sous-agents : AUCUN (décision Nasro — tout inline, gates specialists faits inline).

**Files:**
- Modify only after explicit approval: `MINA.md`
- Create: `tests/architecture/mina-app-constitution.test.mjs`
- Modify: `docs/superpowers/EXECUTION-LOG.md`

**Interfaces:**
- Consumes: la règle de modification constitutionnelle de `MINA.md`.
- Produces: canal autorisé `mina_app` et preuve de baseline avant changement fonctionnel.

- [ ] **Step 1: demander la validation exacte de l’amendement**

Présenter à Nasro cette unique ligne, sans modifier le fichier avant un « oui » explicite :

```markdown
- Application Mina (`mina_app`) : conversation, mémoire et médias uniquement depuis un appareil appairé, actif et autorisé. Les approbations distantes sont liées au digest exact, expirantes et consommables une fois ; une action sensible exige une authentification Android et une signature de clé appareil. Toute capacité `local_only` reste confirmable exclusivement sur le PC.
```

Si Nasro refuse ou modifie le texte, arrêter l’implémentation du canal et réviser cette spécification.

- [ ] **Step 2: capturer la baseline réelle avant toute édition**

Run:

```powershell
git status --short
npm test
npm run smoke
npm run smoke:sqlite:electron
Set-Location android
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug
Set-Location ..
```

Expected: aucune modification source/configuration héritée ; seuls cette spécification et ce plan peuvent rester non suivis. Enregistrer leur chemin et leur SHA-256 dans la baseline au lieu d’exiger artificiellement un arbre totalement propre. Tous les gates existants doivent être verts. Coller les stdout et durées dans `docs/superpowers/EXECUTION-LOG.md`. Si un gate est rouge, diagnostiquer avant toute modification.

- [ ] **Step 3: écrire le test constitutionnel rouge**

```js
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('constitution du canal mina_app', () => {
  it('définit le canal appairé sans élargir local_only', async () => {
    const constitution = await readFile(new URL('../../MINA.md', import.meta.url), 'utf8');
    expect(constitution).toContain('Application Mina (`mina_app`)');
    expect(constitution).toContain('Toute capacité `local_only` reste confirmable exclusivement sur le PC.');
  });
});
```

- [ ] **Step 4: observer l’échec avant modification**

Run:

```powershell
npx vitest run tests/architecture/mina-app-constitution.test.mjs
```

Expected: `FAIL` sur `Application Mina (`mina_app`)` absent.

- [ ] **Step 5: appliquer uniquement la ligne approuvée dans `## Canaux`**

Insérer la ligne après Telegram. Ne modifier aucune autre règle constitutionnelle.

- [ ] **Step 6: vérifier et committer**

```powershell
npx vitest run tests/architecture/mina-app-constitution.test.mjs
git add MINA.md tests/architecture/mina-app-constitution.test.mjs docs/superpowers/EXECUTION-LOG.md
git commit -m "docs(constitution): authorize paired mina app channel"
```

Expected: test vert et commit créé localement. Ne pas pousser.

---

### Task 1: Ajouter les modules Android et les versions épinglées

**Files:**
- Modify: `.gitignore`
- Modify: `android/settings.gradle.kts`
- Modify: `android/build.gradle.kts`
- Modify: `android/gradle/libs.versions.toml`
- Modify: `android/app/build.gradle.kts`
- Modify: `android/core/transport/build.gradle.kts`
- Create: `android/core/chat/build.gradle.kts`
- Create: `android/feature/chat/build.gradle.kts`
- Create: `android/feature/voice/build.gradle.kts`
- Create: `tests/android-chat-bootstrap.test.mjs`

**Interfaces:**
- Consumes: modules existants `:core:protocol`, `:core:transport`, `:feature:camera`.
- Produces: `:core:chat`, `:feature:chat`, `:feature:voice` compilables ; Firebase reste optionnel sans `google-services.json`.

- [ ] **Step 1: écrire le test d’architecture rouge**

```js
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('bootstrap Android chat', () => {
  it('déclare les trois modules et garde Firebase optionnel', async () => {
    const settings = await readFile(new URL('../android/settings.gradle.kts', import.meta.url), 'utf8');
    const app = await readFile(new URL('../android/app/build.gradle.kts', import.meta.url), 'utf8');
    const transport = await readFile(new URL('../android/core/transport/build.gradle.kts', import.meta.url), 'utf8');
    expect(settings).toContain('":core:chat"');
    expect(settings).toContain('":feature:chat"');
    expect(settings).toContain('":feature:voice"');
    expect(app).toContain('file("google-services.json").exists()');
    expect(app).toContain('implementation(platform(libs.firebase.bom))');
    expect(app).toContain('implementation(project(":feature:chat"))');
    expect(app).toContain('debugImplementation("com.google.firebase:firebase-appcheck-debug")');
    expect(transport).toContain('implementation("com.google.firebase:firebase-firestore")');
    expect(app).not.toContain('firebase-auth-ktx');
    expect(transport).not.toContain('-ktx');
    expect(app.match(/firebase-appcheck-debug/g)).toHaveLength(1);
    const gitignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');
    expect(gitignore).toContain('android/app/google-services.json');
  });
});
```

- [ ] **Step 2: vérifier l’échec**

```powershell
npx vitest run tests/android-chat-bootstrap.test.mjs
```

Expected: `FAIL` sur les modules absents.

- [ ] **Step 3: étendre le catalogue de versions**

Ajouter ces entrées exactes :

```toml
[versions]
compose-bom = "2026.06.00"
firebase-bom = "34.16.0"
google-services = "4.5.0"
work = "2.11.2"
activity = "1.13.0"
navigation = "2.9.8"
biometric = "1.1.0"
core = "1.19.0"
lifecycle = "2.11.0"
datastore = "1.2.1"
room = "2.8.4"
okhttp = "5.3.0"
coroutines = "1.11.0"
zxing = "3.5.4"

[plugins]
kotlin-compose = { id = "org.jetbrains.kotlin.plugin.compose", version.ref = "kotlin" }
kotlin-kapt = { id = "org.jetbrains.kotlin.kapt", version.ref = "kotlin" }
google-services = { id = "com.google.gms.google-services", version.ref = "google-services" }

[libraries]
compose-bom = { module = "androidx.compose:compose-bom", version.ref = "compose-bom" }
androidx-compose-ui = { module = "androidx.compose.ui:ui" }
androidx-compose-ui-tooling = { module = "androidx.compose.ui:ui-tooling" }
androidx-compose-ui-tooling-preview = { module = "androidx.compose.ui:ui-tooling-preview" }
androidx-compose-ui-test-junit4 = { module = "androidx.compose.ui:ui-test-junit4" }
androidx-compose-ui-test-manifest = { module = "androidx.compose.ui:ui-test-manifest" }
androidx-compose-material3 = { module = "androidx.compose.material3:material3" }
firebase-bom = { module = "com.google.firebase:firebase-bom", version.ref = "firebase-bom" }
androidx-core-ktx = { module = "androidx.core:core-ktx", version.ref = "core" }
androidx-work-runtime = { module = "androidx.work:work-runtime", version.ref = "work" }
androidx-activity-compose = { module = "androidx.activity:activity-compose", version.ref = "activity" }
androidx-navigation-compose = { module = "androidx.navigation:navigation-compose", version.ref = "navigation" }
androidx-biometric = { module = "androidx.biometric:biometric", version.ref = "biometric" }
androidx-lifecycle-runtime-compose = { module = "androidx.lifecycle:lifecycle-runtime-compose", version.ref = "lifecycle" }
androidx-lifecycle-viewmodel-compose = { module = "androidx.lifecycle:lifecycle-viewmodel-compose", version.ref = "lifecycle" }
androidx-datastore-preferences = { module = "androidx.datastore:datastore-preferences", version.ref = "datastore" }
androidx-room-runtime = { module = "androidx.room:room-runtime", version.ref = "room" }
androidx-room-compiler = { module = "androidx.room:room-compiler", version.ref = "room" }
androidx-room-testing = { module = "androidx.room:room-testing", version.ref = "room" }
okhttp-bom = { module = "com.squareup.okhttp3:okhttp-bom", version.ref = "okhttp" }
kotlinx-coroutines-android = { module = "org.jetbrains.kotlinx:kotlinx-coroutines-android", version.ref = "coroutines" }
kotlinx-coroutines-test = { module = "org.jetbrains.kotlinx:kotlinx-coroutines-test", version.ref = "coroutines" }
zxing-core = { module = "com.google.zxing:core", version.ref = "zxing" }
```

- [ ] **Step 4: déclarer les modules et plugins**

Dans `settings.gradle.kts` :

```kotlin
include(":app", ":core:protocol", ":core:transport", ":core:chat", ":feature:camera", ":feature:chat", ":feature:voice")
```

Dans le build racine :

```kotlin
alias(libs.plugins.kotlin.compose) apply false
alias(libs.plugins.kotlin.kapt) apply false
alias(libs.plugins.google.services) apply false
```

Dans `app/build.gradle.kts`, appliquer Google Services seulement si le fichier du projet existant est présent :

```kotlin
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}
```

Ajouter `android/app/google-services.json` à `.gitignore` avant tout téléchargement depuis Firebase.

- [ ] **Step 5: créer les trois builds ciblés**

`core:chat` dépend de protocol, Room, DataStore, Coroutines et de l’interface transport ; `feature:chat` dépend de core:chat, Core KTX, Lifecycle et Compose ; `feature:voice` dépend de core:chat, transport, Coroutines, Compose et Android media. `app` dépend explicitement des trois nouveaux modules. Utiliser `kapt(libs.androidx.room.compiler)` et `androidTestImplementation(libs.androidx.room.testing)` uniquement dans `core:chat`, puis `testImplementation(libs.kotlinx.coroutines.test)` dans les modules qui testent des `Flow`/ViewModel. Dans chaque module Compose, appliquer `libs.plugins.kotlin.compose`, activer `buildFeatures.compose`, importer `implementation(platform(libs.compose.bom))` et `androidTestImplementation(platform(libs.compose.bom))`, puis Material3/UI/tooling-preview ; réserver tooling et test-manifest aux configurations debug et UI Test JUnit4 à `androidTestImplementation`. Réutiliser les versions de test Android déjà présentes dans `app` (`androidx.test` core/runner/ext-junit) dans les modules ayant des `androidTest`.

Dans `core:transport`, déclarer exactement le BoM OkHttp et le client :

```kotlin
implementation(platform(libs.okhttp.bom))
implementation("com.squareup.okhttp3:okhttp")
```

Dans `core:transport`, déclarer aussi le BoM Firebase puis les modules principaux non-KTX consommés par les adaptateurs et l’appairage :

```kotlin
implementation(platform(libs.firebase.bom))
implementation("com.google.firebase:firebase-auth")
implementation("com.google.firebase:firebase-firestore")
implementation("com.google.firebase:firebase-database")
implementation("com.google.firebase:firebase-storage")
implementation("com.google.firebase:firebase-functions")
```

Dans `app`, déclarer le même BoM puis les modules propres au service Android et à l’attestation :

```kotlin
implementation(platform(libs.firebase.bom))
implementation("com.google.firebase:firebase-messaging")
implementation("com.google.firebase:firebase-installations")
implementation("com.google.firebase:firebase-appcheck")
implementation("com.google.firebase:firebase-appcheck-playintegrity")
debugImplementation("com.google.firebase:firebase-appcheck-debug")
```

Le provider debug est sélectionnable uniquement dans une build `debug` connectée aux émulateurs ; un test de structure interdit sa référence depuis `release`.

- [ ] **Step 6: compiler et committer**

```powershell
npx vitest run tests/android-chat-bootstrap.test.mjs
Set-Location android
.\gradlew.bat projects :core:chat:testDebugUnitTest :feature:chat:testDebugUnitTest :feature:voice:testDebugUnitTest :app:assembleDebug
Set-Location ..
git add .gitignore android tests/android-chat-bootstrap.test.mjs
git commit -m "build(android): scaffold native chat modules"
```

Expected: modules listés et `BUILD SUCCESSFUL` sans `google-services.json` obligatoire.

---

### Task 2: Étendre les contrats Node/Kotlin avec `mina_app` et les événements v2

**Files:**
- Modify: `src/contracts/envelope.mjs`
- Modify: `src/contracts/events.mjs`
- Create: `src/contracts/chat.mjs`
- Create: `src/contracts/event-id.mjs`
- Create: `src/contracts/chat-binary-codec.mjs`
- Modify: `android/core/protocol/src/main/kotlin/fr/mina/gateway/protocol/MinaEnvelope.kt`
- Modify: `android/core/protocol/src/main/kotlin/fr/mina/gateway/protocol/EnvelopeCodec.kt`
- Create: `android/core/protocol/src/main/kotlin/fr/mina/gateway/protocol/ChatEvent.kt`
- Create: `android/core/protocol/src/main/kotlin/fr/mina/gateway/protocol/MonotonicUlid.kt`
- Create: `android/core/protocol/src/main/kotlin/fr/mina/gateway/protocol/ChatBinaryCodec.kt`
- Create: `tests/fixtures/protocol/mina-chat-event-v2.json`
- Create: `tests/native-chat-contract.test.mjs`
- Create: `tests/chat-event-id.test.mjs`
- Create: `tests/chat-binary-codec.test.mjs`
- Create: `android/core/protocol/src/test/kotlin/fr/mina/gateway/protocol/ChatEventTest.kt`
- Create: `android/core/protocol/src/test/kotlin/fr/mina/gateway/protocol/MonotonicUlidTest.kt`
- Create: `android/core/protocol/src/test/kotlin/fr/mina/gateway/protocol/ChatBinaryCodecTest.kt`

**Interfaces:**
- Produces Node: `parseChatEvent(value)`, `encodeChatHeader(header)`, `encodeChatSignatureInput(event)`, `CHAT_EVENT_TYPES`, `CHAT_ROUTING_CLASSES`, `createMonotonicUlid({ now, randomBytes })`.
- Produces Kotlin: `ChatEventCodec.decode(json): ChatEvent`, `ChatBinaryCodec.encodeHeader/encodeSignatureInput`, `MonotonicUlid.next(): String`.
- Compatibility: v1 SMS/Telegram fixtures restent acceptées à l’identique.

- [ ] **Step 1: créer la fixture commune et les tests rouges**

La fixture doit contenir :

```json
{
  "version": 2,
  "eventId": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  "threadId": "thread-main",
  "senderDeviceId": "device-samsung",
  "deviceSequence": 1,
  "keyEpoch": 1,
  "routingClass": "message",
  "createdAtMs": 1784732400000,
  "expiresAtMs": 1787324400000,
  "payloadCiphertext": "Y2lwaGVydGV4dA==",
  "nonce": "MDEyMzQ1Njc4OWFi",
  "authTag": "MDEyMzQ1Njc4OWFiY2RlZg==",
  "signature": "MAYCAQECAQE="
}
```

Node doit refuser les champs supplémentaires, `deviceSequence=0` ou supérieur à `Number.MAX_SAFE_INTEGER`, `keyEpoch` hors `[1, Int.MAX_VALUE]`, une expiration signée initiale >30 jours, des timestamps hors plage entière sûre, un identifiant hors ASCII autorisé, une base64 non canonique et une classe inconnue. Ce `expiresAtMs` borne l’acceptation initiale/replay de l’enveloppe ; il ne sera jamais réécrit lors d’un renouvellement de copie cloud. Kotlin applique exactement les mêmes bornes et doit lire la même fixture. Les tests d’identifiant exigent 26 caractères Crockford Base32, l’ordre lexical pour 1 000 générations dans la même milliseconde, l’absence de recul si l’horloge système recule, et l’absence de collision sur 100 000 identifiants avec une source aléatoire réelle. `now` et `randomBytes` restent injectables pour rendre les cas déterministes.

La fixture binaire fixe aussi l’hex exact de l’AAD et de l’entrée de signature. L’AAD encode dans cet ordre : préfixe ASCII `MINA_CHAT_EVENT_V2\0`, `version`, `eventId`, `threadId`, `senderDeviceId`, `deviceSequence`, `keyEpoch`, `routingClass`, `createdAtMs`, `expiresAtMs`. Les strings sont précédées de leur longueur UTF-8 uint32 big-endian ; `version` est uint16, `deviceSequence`/dates uint64 et `keyEpoch` uint32. L’entrée ES256 est `MINA_CHAT_SIGNATURE_V1\0 + len(AAD) + AAD + len(nonce) + nonce + len(ciphertext) + ciphertext + len(tag) + tag`. Aucun `JSON.stringify` ne sert de canonicalisation.

- [ ] **Step 2: observer les deux échecs**

```powershell
npx vitest run tests/native-chat-contract.test.mjs
npx vitest run tests/chat-event-id.test.mjs
npx vitest run tests/chat-binary-codec.test.mjs
android\gradlew.bat :core:protocol:testDebugUnitTest --tests "*ChatEventTest" --tests "*MonotonicUlidTest" --tests "*ChatBinaryCodecTest"
```

Expected: symboles `parseChatEvent` et `ChatEventCodec` absents.

- [ ] **Step 3: implémenter le schéma Node strict**

```js
export const CHAT_ROUTING_CLASSES = Object.freeze(['message', 'receipt', 'control', 'stream', 'approval']);
export const CHAT_EVENT_TYPES = Object.freeze([
  'message.text.created', 'message.attachment.created', 'message.voice.created',
  'message.status.changed', 'assistant.response.started', 'assistant.response.chunk',
  'assistant.response.completed', 'assistant.response.failed', 'approval.requested',
  'approval.approved', 'approval.denied', 'device.role.changed', 'device.endpoint.changed', 'device.revoked',
  'history.snapshot.available', 'thread.created', 'thread.renamed', 'thread.archived', 'thread.tombstoned', 'thread.purged',
]);
```

Le schéma Zod strict exige un eventId ULID uppercase, borne les autres ids ASCII `[A-Za-z0-9._:-]` à 160 caractères, `payloadCiphertext` base64 canonique à 196 608 caractères afin que le document complet reste sous le budget interne de 256 KiB, nonce décodé de 12 octets, tag de 16 octets, signature P-256 DER canonique de 8 à 72 octets et base64 ≤96 caractères, `deviceSequence` entier sûr positif, `keyEpoch <= 2_147_483_647` et TTL à 30 jours.

- [ ] **Step 4: implémenter le générateur ULID monotone sans dépendance**

Node et Kotlin utilisent le même format ULID Crockford Base32 : 48 bits de temps suivis de 80 bits aléatoires. Dans une même milliseconde, incrémenter les 80 bits en big-endian ; en cas de recul d’horloge, conserver le dernier timestamp. À l’improbable saturation des 80 bits, lever `ulid_entropy_exhausted` et laisser l’appelant retenter au tick suivant, sans boucle active sur le thread Node/UI. Protéger l’état concurrent (`synchronized` côté Kotlin, section critique sérialisée côté Node) et utiliser `SecureRandom`/`randomBytes` par défaut.

- [ ] **Step 5: implémenter l’encodage binaire identique**

Construire les octets dans l’ordre fixe de la fixture, refuser toute longueur dépassant les bornes avant allocation et utiliser une comparaison d’hex entre Node/Kotlin. La base64 wire reste standard avec padding ; un décodage suivi d’un réencodage doit rendre exactement la chaîne reçue. Les signatures P-256 sont DER strictes, sans octets de fin ni entiers négatifs/non minimaux.

- [ ] **Step 6: implémenter le miroir Kotlin**

```kotlin
data class ChatEvent(
    val version: Int,
    val eventId: String,
    val threadId: String,
    val senderDeviceId: String,
    val deviceSequence: Long,
    val keyEpoch: Int,
    val routingClass: String,
    val createdAtMs: Long,
    val expiresAtMs: Long,
    val payloadCiphertext: String,
    val nonce: String,
    val authTag: String,
    val signature: String,
)
```

`ChatEventCodec` exige exactement les treize champs, version 2, `deviceSequence` dans `[1, 9_007_199_254_740_991]`, `keyEpoch` dans `[1, 2_147_483_647]` et TTL ≤30 jours.

- [ ] **Step 7: étendre les canaux sans casser v1**

Ajouter `mina_app` à `CHANNELS`, `EnvelopeCodec.channels`, `channel-router` et `events`. Conserver version 1 pour les enveloppes existantes et réserver version 2 aux événements chat.

- [ ] **Step 8: vérifier et committer**

```powershell
npx vitest run tests/native-chat-contract.test.mjs tests/chat-event-id.test.mjs tests/chat-binary-codec.test.mjs tests/contracts.test.mjs tests/android-envelope-compat.test.mjs
android\gradlew.bat :core:protocol:testDebugUnitTest
git add src/contracts android/core/protocol tests/native-chat-contract.test.mjs tests/chat-event-id.test.mjs tests/chat-binary-codec.test.mjs tests/fixtures/protocol/mina-chat-event-v2.json
git commit -m "feat(chat): add interoperable mina app event contracts"
```

---

### Task 3: Implémenter les clés d’époque et le chiffrement interopérable

**Files:**
- Modify: `android/core/protocol/src/main/kotlin/fr/mina/gateway/protocol/DeviceIdentityKeyStore.kt`
- Create: `android/core/protocol/src/main/kotlin/fr/mina/gateway/protocol/ChatCrypto.kt`
- Create: `src/devices/chat-crypto.mjs`
- Create: `tests/fixtures/protocol/mina-chat-crypto-v1.json`
- Create: `tests/chat-crypto.test.mjs`
- Create: `android/core/protocol/src/test/kotlin/fr/mina/gateway/protocol/ChatCryptoTest.kt`
- Create: `android/core/protocol/src/androidTest/kotlin/fr/mina/gateway/protocol/DeviceWrapKeyInstrumentedTest.kt`

**Interfaces:**
- Node: `createChatCrypto({ signingPrivateKey, verifyPublicKey, epochKey })` avec `encryptAndSign` et `verifyAndDecrypt`.
- Android: `ChatCrypto.encryptAndSign(header, plaintext, epochKey, signingKey)` et `verifyAndDecrypt`.
- Keystore: `getOrCreateDeviceMasterKey(alias): SecretKey` AES-256 non exportable ; `deviceWrapKey` reste chiffrée hors mémoire.

- [ ] **Step 1: écrire le vecteur crypto et les tests rouges**

Le vecteur commun fixe header, plaintext UTF-8, clé AES 32 octets, nonce 12 octets, signature DER pré-générée et clés de test. Tester altération de chaque champ, mauvaise époque, mauvaise signature, DER non minimal/trailing bytes, compteur rejoué, wrapping d’époque Node→Kotlin et Kotlin→Node. Le test instrumenté Keystore vérifie création AES-256, GCM randomisé, stockage/restauration de `deviceWrapKey`, mauvais AAD/tag, effacement et réinstallation simulée. Après suppression de l’alias ou des données app, la restauration doit échouer `device_identity_lost_repair_required` : elle ne recrée jamais une clé sous le même `deviceId`.

- [ ] **Step 2: observer l’échec Node/Kotlin**

```powershell
npx vitest run tests/chat-crypto.test.mjs
android\gradlew.bat :core:protocol:testDebugUnitTest --tests "*ChatCryptoTest"
```

- [ ] **Step 3: implémenter les primitives exactes**

Node utilise `createCipheriv('aes-256-gcm')`, `createDecipheriv`, `sign('sha256', bytes, { key, dsaEncoding:'der' })`, `verify('sha256', bytes, { key, dsaEncoding:'der' }, signature)` et `hkdfSync('sha256')`. Android utilise `AES/GCM/NoPadding`, `SHA256withECDSA` et `HmacSHA256` pour HKDF. Les deux appellent exclusivement le codec binaire de Task 2. Les vecteurs communs couvrent aussi `wrapEpochKey(deviceWrapKey, deviceId, keyEpoch)` avec nonce aléatoire 96 bits et AAD binaire domain-separated `MINA_EPOCH_WRAP_V1` contenant version, deviceId et keyEpoch.

```js
export const deriveAttachmentKey = ({ epochKey, attachmentId }) => Buffer.from(hkdfSync(
  'sha256', Buffer.from(epochKey), Buffer.from(attachmentId, 'utf8'), Buffer.from('mina-chat-attachment-v1'), 32,
));
```

- [ ] **Step 4: ajouter la clé maître Android et le wrapping interopérable**

```kotlin
KeyGenParameterSpec.Builder(
    alias,
    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
)
    .setKeySize(256)
    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
    .setRandomizedEncryptionRequired(true)
    .setUserAuthenticationRequired(false)
```

Le test de structure doit échouer si RSA/OAEP réapparaît : l’interop Node ↔ Android API 29 n’en dépend plus. La `deviceWrapKey` aléatoire est chiffrée/déchiffrée uniquement par cette clé maître, avec AAD `MINA_DEVICE_WRAP_LOCAL_V1 + deviceId + alias`, stockée sous forme version+nonce+ciphertext+tag, puis les tableaux mémoire sont écrasés.

La clé biométrique d’approbation est séparée et sera créée en Task 19.

- [ ] **Step 5: vérifier et committer**

```powershell
npx vitest run tests/chat-crypto.test.mjs tests/crypto.test.mjs
android\gradlew.bat :core:protocol:testDebugUnitTest
android\gradlew.bat :core:protocol:connectedDebugAndroidTest
git add src/devices/chat-crypto.mjs android/core/protocol tests/chat-crypto.test.mjs tests/fixtures/protocol/mina-chat-crypto-v1.json
git commit -m "feat(chat): add end to end epoch crypto"
```

Expected: vecteurs Node/Kotlin verts et test Keystore vert au minimum sur le Huawei API 29 avant Task 4 ; un émulateur seul ne valide pas le fournisseur matériel réel.

---

### Task 4: Créer la base versionnée, le registre multi-device et les clés d’époque

**Gate reviewer obligatoire :** avant toute édition/application de schéma, annoncer un seul `db-migration-reviewer` en lecture seule et attendre l’autorisation explicite de Nasro. Son préflight couvre les migrations PC `001/002/003`, Room v1/v2, indexes/contraintes, replay, upgrade/downgrade, sauvegarde et rollback décrits dans ce plan. Sans autorisation, cette tâche reste bloquée ; aucun sous-agent n’est lancé implicitement. Toute divergence ultérieure du schéma approuvé exige un follow-up annoncé et réautorisé avant application.

**Files:**
- Create: `src/devices/migrations/001-native-chat-devices.sql`
- Create: `src/devices/chat-database.mjs`
- Create: `src/devices/trusted-chat-device-store.mjs`
- Create: `src/devices/chat-device-policy.mjs`
- Create: `src/devices/chat-epoch-key-store.mjs`
- Modify: `src/devices/physical-device-registry.mjs`
- Modify: `src/executors/phone-bridge.mjs`
- Create: `tests/trusted-chat-device-store.test.mjs`
- Create: `tests/chat-device-policy.test.mjs`
- Create: `tests/chat-database-migrations.test.mjs`
- Create: `tests/chat-epoch-key-store.test.mjs`
- Modify: `tests/physical-device-registry.test.mjs`
- Modify: `tests/phone-bridge.test.mjs`

**Interfaces:**
- `openNativeChatDatabase({ filename, nativeBinding, securePermissions })` applique uniquement des migrations numérotées et checksummées.
- `createTrustedChatDeviceStore({ db, clock })` produit `enroll`, `get`, `listActive`, `setRole`, `revoke`, `recordFirebasePrincipal`, `recordTokenVersion`.
- `createChatEpochKeyStore({ db, keyring, randomBytes, clock })` produit `current`, `get`, `getOrCreate`, `rotate`, `listForSnapshot` sans clé SQLite en clair.
- `authorizeDeviceCapability({ device, capability })` retourne `{decision:'allow'|'deny', reason}`.
- `resolveDeviceForCapability(capability)` remplace la sélection implicite « exactement une identité » pour les capacités passerelle.

- [ ] **Step 1: écrire les tests rouges de rôles et ambiguïté**

Tester Samsung `owner_primary`, Huawei `gateway_secondary`, viewer, rôle inconnu, capacité inconnue, révocation, tokenVersion, retrait/ajout `chat.read` exigeant rotation/snapshot, changement passerelle sans rotation chat, deux appareils ne pouvant partager le même `firebaseAuthUid`, même public key sous deux identités, changement de clé sous un deviceId existant, nom appareil absent en clair de SQLite, deux appareils ADB réels où seul Huawei possède `gateway.sms`, migration rejouée, checksum modifié refusé, DB future refusée et crash simulé entre écriture keyring/activation d’époque.

```js
expect(authorizeDeviceCapability({ device: samsung, capability: 'chat.write' })).toEqual({ decision: 'allow', reason: 'device_capability' });
expect(authorizeDeviceCapability({ device: samsung, capability: 'gateway.sms' }).decision).toBe('deny');
expect(authorizeDeviceCapability({ device: revoked, capability: 'chat.read' }).decision).toBe('deny');
```

- [ ] **Step 2: créer le schéma SQLite**

```sql
CREATE TABLE IF NOT EXISTS chat_devices (
  device_id TEXT PRIMARY KEY,
  display_name_ciphertext TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner_primary','owner_secondary','gateway_secondary','viewer','mina_brain')),
  capabilities_json TEXT NOT NULL,
  signing_public_key TEXT NOT NULL,
  signing_key_fingerprint TEXT NOT NULL UNIQUE,
  apk_signing_digest TEXT,
  attestation_level TEXT NOT NULL DEFAULT 'unavailable' CHECK (attestation_level IN ('hardware','software_paired','unavailable')),
  wrap_key_ref TEXT UNIQUE,
  wrap_key_digest TEXT,
  firebase_auth_uid TEXT UNIQUE,
  cloud_state TEXT NOT NULL DEFAULT 'pending' CHECK (cloud_state IN ('pending','active','revoked','error')),
  token_version INTEGER NOT NULL DEFAULT 1 CHECK (token_version BETWEEN 1 AND 9007199254740991),
  enrolled_at_ms INTEGER NOT NULL,
  last_seen_at_ms INTEGER,
  revoked_at_ms INTEGER,
  CHECK (
    (role='mina_brain' AND wrap_key_ref IS NULL AND wrap_key_digest IS NULL)
    OR (role!='mina_brain' AND wrap_key_ref IS NOT NULL AND wrap_key_digest IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS one_mina_brain ON chat_devices(role) WHERE role='mina_brain' AND revoked_at_ms IS NULL;

CREATE TABLE IF NOT EXISTS chat_key_epochs (
  key_epoch INTEGER PRIMARY KEY CHECK (key_epoch BETWEEN 1 AND 2147483647),
  key_ref TEXT NOT NULL UNIQUE,
  key_digest TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','retired')),
  reason TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_chat_epoch ON chat_key_epochs(status) WHERE status='active';
```

`chat-database.mjs` maintient `chat_schema_migrations(version,name,checksum,applied_at)`, refuse tout checksum divergent et toute version DB supérieure au code. Les fichiers appliqués sont immuables : chaque tâche ultérieure ajoute `002`, `003`, etc., jamais un `ALTER` caché dans `001`.

`chat-epoch-key-store` écrit d’abord la clé base64 dans `keyring.setSecret("chat/epoch/{n}")`, puis active sa référence/digest en transaction SQLite. Si le processus tombe entre les deux, le retry réutilise la même référence orpheline et ne remplace jamais une clé déjà référencée. Le nom d’affichage est chiffré par une clé metadata domain-separated `chat/device-registry/metadata-key`; aucun nom de personne/téléphone n’est une colonne SQLite ou un champ cloud en clair. Les clés privées PC de chat utilisent un alias séparé `chat/brain/signing-key`; la clé de session Firebase reste séparée.

- [ ] **Step 3: implémenter la matrice fail-closed**

```js
export const ROLE_DEFAULTS = Object.freeze({
  owner_primary: Object.freeze(['chat.read','chat.write','media.send','voice.note','voice.live','approval.ordinary','approval.sensitive']),
  owner_secondary: Object.freeze(['chat.read','chat.write','media.send','voice.note','voice.live','approval.ordinary']),
  gateway_secondary: Object.freeze(['chat.read','chat.write','media.send','voice.note','gateway.sms','gateway.telegram','gateway.camera']),
  viewer: Object.freeze(['chat.read']),
  mina_brain: Object.freeze(['chat.read','chat.write','chat.process','media.send','voice.live','approval.request','history.sync','device.manage']),
});
```

Une capacité n’est autorisée que si elle figure dans la liste persistée de l’appareil actif ; le rôle fournit seulement les defaults d’enrôlement.

- [ ] **Step 4: rendre le bridge ADB explicite par capacité**

Conserver le regroupement USB/LAN d’une même identité. Quand plusieurs identités Mina sont visibles, `phoneBridge` demande `gateway.camera` ou `gateway.sms` au registre ; zéro ou plusieurs candidats capables échouent avec une erreur stable, jamais avec une sélection par ordre ADB.

- [ ] **Step 5: vérifier et committer**

```powershell
npx vitest run tests/chat-database-migrations.test.mjs tests/chat-epoch-key-store.test.mjs tests/trusted-chat-device-store.test.mjs tests/chat-device-policy.test.mjs tests/physical-device-registry.test.mjs tests/phone-bridge.test.mjs
git add src/devices src/executors/phone-bridge.mjs tests
git commit -m "feat(devices): add durable roles and capability selection"
```

---

### Task 5: Livrer l’appairage local QR et la distribution des clés

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/devices/chat-pairing-service.mjs`
- Create: `src/ui/ipc/device-chat-ipc.mjs`
- Create: `src/ui/pages/device-chat-controller.mjs`
- Modify: `src/ui/ipc/register-ipc.mjs`
- Modify: `src/ui/preload.cjs`
- Modify: `src/ui/main.mjs`
- Create: `android/core/transport/src/main/kotlin/fr/mina/gateway/transport/ChatPairingClient.kt`
- Create: `android/core/transport/src/main/kotlin/fr/mina/gateway/transport/PrivateIpPolicy.kt`
- Create: `android/app/src/main/kotlin/fr/mina/gateway/pairing/PairingViewModel.kt`
- Modify: `android/feature/camera/build.gradle.kts`
- Create: `android/feature/camera/src/main/kotlin/fr/mina/gateway/camera/PairingQrScanner.kt`
- Create: `tests/chat-pairing-service.test.mjs`
- Create: `tests/device-chat-ipc.test.mjs`
- Create: `android/core/transport/src/test/kotlin/fr/mina/gateway/transport/ChatPairingClientTest.kt`
- Create: `android/feature/camera/src/test/kotlin/fr/mina/gateway/camera/PairingQrScannerTest.kt`

**Interfaces:**
- PC: `createPairingSession({ requestedRole, expiresInMs:300000 })`, `approvePairing({ sessionId, proof, displayName })`, `cancelPairing(sessionId)`.
- Android: `submitPairing(qr: PairingQr, proof: DeviceIdentityProof)` ; la réponse contient `encryptedBootstrap` protégé par la clé de session dérivée du secret QR. Son plaintext borné contient `deviceWrapKey`, époque courante enveloppée, identité cloud éventuelle et paramètres publics, jamais un champ secret au niveau externe.
- IPC renderer principal : `mina:devices:pairing-create` retourne seulement `{ pairingWindowOpened, expiresAt, requestedRole }`, puis `mina:devices:pairing-approve`, `mina:devices:pairing-cancel`, `mina:devices:list`. Le main process affiche le PNG dans une fenêtre QR dédiée sans preload/script/navigation/réseau ; ni JSON QR, ni data URL, ni secret brut ne traverse le preload principal.

- [ ] **Step 1: écrire les tests rouges d’appairage**

Cas requis : challenge et transportSecret distincts de 32 octets, TTL cinq minutes, signature valide, signature fausse, QR expiré, session rejouée, rôle non autorisé, projectId/région Functions altéré, région mal formée, région nullable quand le cloud n’est pas encore activé, même public key sous deux deviceIds, même deviceId avec nouvelle clé, endpoint public/hostname refusé avant connexion, approbation one-shot, retransmission idempotente de la même réponse chiffrée après ACK perdu, session annulée, renderer principal ne recevant jamais `transportSecret`/payload/data URL QR, fenêtre dédiée sans preload/nodeIntegration/script/opener/navigation/réseau, protection de capture active seulement pendant l’affichage puis fenêtre détruite sur approve/cancel/expiry.

- [ ] **Step 2: implémenter le contrat QR strict**

Après le test rouge, installer le générateur PC et déclarer le décodeur Android sans service Google :

```powershell
npm install qrcode@1.5.4 --save-exact
```

Dans `feature:camera`, ajouter `implementation(libs.zxing.core)`. `PairingQrScanner` réutilise CameraX 1.5.3 déjà présent, analyse seulement depuis l’Activity d’appairage visible, borne le payload UTF-8 à 4 KiB et ferme toujours `ImageProxy`; aucun appel ML Kit/GMS n’est introduit afin que le Huawei fonctionne. Le payload/secret QR n’entre ni dans saved state, Intent, log, Room ou DataStore. Les bytes maîtrisés sont écrasés et les références aux chaînes de parsing JVM sont abandonnées à ACK/cancel/expiry, sans prétendre pouvoir effacer physiquement une `String` immuable. Avant tout socket, `ChatPairingClient` exige des IP littérales appartenant à la policy privée/VPN de Task 6 ; un QR ne peut pas provoquer de résolution DNS ni de connexion publique.

```js
const pairingQrSchema = z.strictObject({
  version: z.literal(1),
  sessionId: z.string().uuid(),
  challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  transportSecret: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  pcDeviceId: z.literal('mina-brain'),
  pcSigningKeyFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  firebaseProjectId: z.string().min(1).max(100),
  firebaseFunctionsRegion: z.string().regex(/^[a-z]+(?:-[a-z0-9]+)+[0-9]$/u).nullable(),
  directEndpoints: z.array(z.string().max(200)).max(4),
  requestedRole: z.enum(['owner_primary','owner_secondary','gateway_secondary','viewer']),
  expiresAt: z.string().datetime({ offset: true }),
});
```

- [ ] **Step 3: lier la preuve à tous les champs matériels**

La signature appareil couvre, via un codec binaire domain-separated, `sessionId`, challenge, digest du secret de transport, deviceId, rôle, clé ES256, empreinte PC, projectId, région Functions nullable et expiry. Toute preuve réseau et la réponse PC utilisent AES-256-GCM avec une clé dérivée par HKDF depuis `transportSecret` avec `sessionId` comme salt/info, des nonces distincts et AAD canonique. Après approbation, le PC génère `deviceWrapKey`, la stocke dans le keyring `chat/device/{deviceId}/wrap-key`, renvoie cette clé uniquement dans `encryptedBootstrap`, crée `keyEpoch=1` si nécessaire via le store de Task 4, enveloppe l’époque pour l’appareil et persiste l’enrôlement avant ACK. Android re-chiffre immédiatement `deviceWrapKey` sous sa clé maître Keystore ; le renderer ne voit aucun de ces secrets. Après perte de l’ACK, seul le même deviceId/clé/preuve peut obtenir une retransmission ; aucune seconde consommation ni nouvelle clé n’est créée.

- [ ] **Step 4: enregistrer les IPC via l’unique registrar**

Ajouter `deviceChat` à `DOMAIN_REGISTRARS` et passer par la garde sender-frame/limite payload. Le main process conserve le payload QR et génère l’image. Il ouvre une `BrowserWindow` dédiée non parente, `sandbox:true`, `nodeIntegration:false`, `contextIsolation:true`, sans preload ni script, bloque `will-navigate`/`setWindowOpenHandler`, interdit toute permission/réseau et charge directement le PNG data URL. Le renderer principal reçoit seulement l’état public ; aucun pixel/data URL, `transportSecret`, `deviceWrapKey` ou clé d’époque. Appeler `setContentProtection(true)` sur cette fenêtre et la détruire sur approve, cancel, expiry, fermeture principale et tous les chemins d’erreur. Le threat model reconnaît que le processus d’affichage dédié voit nécessairement les pixels ; l’isolation réduit sa surface au document image statique.

- [ ] **Step 5: vérifier et committer**

```powershell
npx vitest run tests/chat-pairing-service.test.mjs tests/device-chat-ipc.test.mjs tests/ipc-registration.test.mjs tests/main-domain-composition-contract.test.mjs
android\gradlew.bat :core:transport:testDebugUnitTest --tests "*ChatPairingClientTest"
git add package.json package-lock.json src/devices src/ui android/core/transport android/feature/camera android/app/src/main/kotlin/fr/mina/gateway/pairing tests
git commit -m "feat(pairing): add one shot native device enrollment"
```

---

### Task 6: Implémenter le transport direct WebSocket chiffré

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/devices/native-chat-direct-server.mjs`
- Create: `src/devices/private-endpoint-policy.mjs`
- Modify: `android/core/transport/src/main/kotlin/fr/mina/gateway/transport/TransportMultiplexer.kt`
- Create: `android/core/transport/src/main/kotlin/fr/mina/gateway/transport/DirectChatClient.kt`
- Create: `android/core/transport/src/main/kotlin/fr/mina/gateway/transport/DirectEndpointStore.kt`
- Create: `tests/native-chat-direct-server.test.mjs`
- Create: `tests/private-endpoint-policy.test.mjs`
- Create: `android/core/transport/src/test/kotlin/fr/mina/gateway/transport/DirectChatClientTest.kt`

**Interfaces:**
- PC: `createNativeChatDirectServer({ hosts, port, deviceStore, verifyEnvelope, onEnvelope, clock })` produit `start`, `stop`, `send`, `status` et refuse tout host wildcard/public.
- Android: `DirectChatClient.connect(endpoint, proof)`, `send(queue, envelope)`, `close()`.
- Frame JSON strict : `hello`, `challenge`, `proof`, `event`, `event_renewal_request`, `event_renewal_challenge`, `event_renewal`, `ack`, `ping`, `pong`; binaire réservé à `media` et `live_audio` chiffrés.
- Garantie : E2EE/authentification au niveau Mina sur IP privée/VPN, pas de promesse WSS/PKI publique ; seuls ids opaques/nonces/version/empreintes précèdent `ready`, et le threat model expose les métadonnées IP/timing/tailles visibles sur le LAN.

- [ ] **Step 1: écrire les tests rouges**

Tester bind loopback/wildcard refusé en production, IP publique, hostname et faux préfixe `10.evil` refusés, IPv4 privée/Tailscale et IPv6 ULA valides, IPv4-mapped normalisée, challenge mutuel, appareil révoqué, replay de challenge, frame inconnue, event JSON >256 KiB, live frame >64 KiB, média >5 MiB, compression WebSocket désactivée, limite connexions/handshakes, heartbeat manqué, changement DHCP, endpoint signé invalide, ACK idempotent et bascule du même `eventId`. Ajouter un clock test PC arrêté >30 jours : l’enveloppe historiquement expirée est refusée seule, puis acceptée une fois après `event_renewal_request/challenge` avec une preuve fraîche liée au `sessionId`, au nonce dédié et au SHA-256 exact ; mauvais digest, nonce de handshake recyclé, autre session ou replay divergent sont refusés sans insertion.

```js
await expect(policy.assertAllowedHost('8.8.8.8')).rejects.toThrow('chat_direct_private_host_required');
await expect(server.acceptProof(replayedProof)).rejects.toThrow('chat_direct_challenge_replayed');
```

- [ ] **Step 2: observer les échecs puis réintroduire `ws` au moment de son usage réel**

```powershell
npx vitest run tests/native-chat-direct-server.test.mjs tests/private-endpoint-policy.test.mjs
npm install ws@8.21.1 --save-exact
```

Expected avant installation/implémentation : modules absents. Après `npm install`, vérifier que seules les entrées nécessaires changent dans `package.json` et le lockfile.

- [ ] **Step 3: implémenter la policy réseau**

Utiliser `node:net` (`isIP` + `BlockList`) avec les CIDR exacts `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10` et `fc00::/7`. Rejeter hostname, unspecified, multicast, link-local, loopback et wildcard ; normaliser explicitement les IPv4-mapped avant le check. Android applique la même table sur les bytes `InetAddress` d’une IP littérale, sans résolution DNS. Loopback n’est injectable que dans les tests via `allowLoopbackForTests:true`, option rejetée si `NODE_ENV !== 'test'`.

- [ ] **Step 4: implémenter le handshake mutuel**

```text
client hello(protocolVersion, deviceId, clientNonce)
server challenge(sessionId, serverNonce, pcFingerprint, expiresAtMs)
client proof(signature(MINA_DIRECT_CLIENT_V1, protocolVersion, sessionId, deviceId,
                       clientNonce, serverNonce, pcFingerprint, expiresAtMs))
server proof(signature(MINA_DIRECT_SERVER_V1, protocolVersion, sessionId, mina-brain,
                       deviceFingerprint, serverNonce, clientNonce, expiresAtMs))
session ready(sessionId, heartbeatMs=10000)
```

Chaque structure utilise le codec binaire à longueurs de Task 2, pas une concaténation avec séparateur. Chaque nonce fait 32 octets et expire après 30 secondes. Aucun event n’est accepté avant `ready`. Limiter à deux handshakes en cours par IP, dix connexions actives globales et appliquer un backoff après cinq échecs par device/IP sans journaliser l’IP brute au-delà de la fenêtre de quota.

Pour un événement dont `expiresAtMs` est historique, le client envoie d’abord `event_renewal_request(eventId, envelopeDigest)`. Le PC répond dans la session authentifiée par un nonce aléatoire dédié de 32 octets et une expiry cinq minutes ; ce nonce ne peut servir qu’à cet event/digest. `event_renewal` porte ensuite une signature DER sur le codec `MINA_EVENT_RENEWAL_V1`, `eventId`, SHA-256 des octets exacts, `senderDeviceId`, scope `direct:<pcFingerprint>:<sessionId>`, ce nonce, `issuedAtMs` et `renewalExpiresAtMs`. Le PC exige la session active, l’appareil non révoqué et un event inconnu ou byte-for-byte identique ; il persiste preuve et claim ledger atomiquement avant ACK. Un retry byte-for-byte rend le même ACK, toute réutilisation divergente échoue. Aucun nouvel `eventId`, timestamp ou ciphertext n’est fabriqué. Une indisponibilité Firebase n’empêche donc pas le retour direct après expiration.

- [ ] **Step 5: adapter le multiplexer Android**

Étendre `TransportEnvelope` avec les bytes de l’enveloppe et rendre `send` suspendable dans le nouveau client sans casser les tests du multiplexer existant. Côté `ws`, fixer `perMessageDeflate:false` et `maxPayload=5 MiB`; l’application resserre ensuite event JSON à 256 KiB, live audio direct à 64 KiB et objet média chiffré à 5 MiB framing compris. Files : `CONTROL=100`, `MESSAGE=500`, `LIVE_AUDIO=64`, `MEDIA=8` ; priorité dans cet ordre. `DirectEndpointStore` ne remplace ses candidats qu’après un événement `device.endpoint.changed` chiffré, signé par le PC épinglé et borné à quatre IP autorisées. Après changement DHCP/VPN, Firebase transporte cet événement ; si aucun transport ne reste, un QR de rafraîchissement local exige une confirmation sans recréer l’identité.

- [ ] **Step 6: vérifier et committer**

```powershell
npx vitest run tests/native-chat-direct-server.test.mjs tests/private-endpoint-policy.test.mjs tests/android-transport-client.test.mjs
android\gradlew.bat :core:transport:testDebugUnitTest
npm test
git add package.json package-lock.json src/devices android/core/transport tests
git commit -m "feat(transport): add authenticated native chat direct link"
```

---

### Task 7: Créer le ledger PC durable idempotent et la lease de génération

**Gate conformité obligatoire :** avant de persister les conversations, annoncer un seul `compliance-rgpd-auditor` en lecture seule (cartographie données, minimisation, rétention, effacement/export, isolation owner/device, consentements voix/notifications) et attendre l’autorisation explicite de Nasro. Il relit d’abord la spec, puis reçoit en Task 24 un follow-up sur le diff final ; aucun autre agent n’est lancé implicitement.

**Files:**
- Create: `src/devices/migrations/002-native-chat-ledger.sql`
- Modify: `src/devices/chat-database.mjs`
- Create: `src/devices/native-chat-store.mjs`
- Create: `tests/native-chat-store.test.mjs`

**Interfaces:**
- `claimInbound(event, verifiedDelivery?)` → `{ claimed, state, eventId }`; une enveloppe historiquement expirée exige une preuve déjà vérifiée par le transport et liée à son digest.
- `acquireGenerationLease(eventId, workerId, ttlMs)`, `renewGenerationLease`, `appendResponseChunk`, `completeResponse`.
- `recordAck({ eventId, deviceId })`, `pendingForDevice(deviceId, limit)`, `historyForThread(threadId, cursor, limit)`.
- `createHistorySnapshot({ deviceId, threadIds })` produit un manifeste chiffrable, sans plaintext cloud.

- [ ] **Step 1: écrire les tests rouges de crash/reprise**

Scénarios : double livraison avant ACK, deux appareils insérant concurremment dans le même thread, deux workers en course, lease vivante/stale, restart entre `processing` et premier chunk, restart après résultat persisté mais avant émission, chunks dupliqués, ACK de deux appareils, ordre par séquence canonique sans trou/duplication, compteur à la borne JavaScript sûre refusant l’allocation suivante sans mutation, événement expiré sans preuve refusé, preuve direct vérifiée persistée avec claim, retry du même event avec nouvelle preuve sans nouvelle séquence, transaction rollback, upgrade 001→002 et base version inconnue fail-closed.

- [ ] **Step 2: ajouter la migration `002` sans modifier `001`**

```sql
CREATE TABLE IF NOT EXISTS chat_threads (
  thread_id TEXT PRIMARY KEY,
  created_at_ms INTEGER NOT NULL,
  next_canonical_sequence INTEGER NOT NULL DEFAULT 1 CHECK (next_canonical_sequence BETWEEN 1 AND 9007199254740991),
  tombstoned_at_ms INTEGER
);
CREATE TABLE IF NOT EXISTS chat_events (
  event_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES chat_threads(thread_id),
  sender_device_id TEXT NOT NULL,
  device_sequence INTEGER NOT NULL CHECK (device_sequence BETWEEN 1 AND 9007199254740991),
  canonical_sequence INTEGER NOT NULL CHECK (canonical_sequence BETWEEN 1 AND 9007199254740991),
  routing_class TEXT NOT NULL,
  key_epoch INTEGER NOT NULL CHECK (key_epoch BETWEEN 1 AND 2147483647),
  envelope_json TEXT NOT NULL,
  delivery_proof_json TEXT,
  state TEXT NOT NULL CHECK (state IN ('received','processing','completed','retry_wait','failed_final','canceled')),
  generation_attempt INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_expires_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  UNIQUE(sender_device_id, device_sequence)
);
CREATE TABLE IF NOT EXISTS chat_response_chunks (
  source_event_id TEXT NOT NULL REFERENCES chat_events(event_id),
  sequence INTEGER NOT NULL,
  envelope_json TEXT NOT NULL,
  PRIMARY KEY(source_event_id, sequence)
);
CREATE TABLE IF NOT EXISTS chat_device_acks (
  event_id TEXT NOT NULL REFERENCES chat_events(event_id),
  device_id TEXT NOT NULL,
  acked_at_ms INTEGER NOT NULL,
  PRIMARY KEY(event_id, device_id)
);
CREATE INDEX IF NOT EXISTS chat_events_thread_order ON chat_events(thread_id, canonical_sequence, created_at_ms);
CREATE UNIQUE INDEX IF NOT EXISTS chat_events_thread_sequence ON chat_events(thread_id, canonical_sequence);
```

- [ ] **Step 3: implémenter les transitions atomiques**

`claimInbound` ouvre une transaction immédiate, tente d’abord le `event_id`/couple device-sequence, réserve exactement `chat_threads.next_canonical_sequence`, l’incrémente puis insère l’événement. `delivery_proof_json` ne contient que scope, dates, nonce, digests et signatures ; il est obligatoire pour une enveloppe historiquement expirée et provient d’un résultat typé du vérificateur de transport, jamais d’un booléen fourni par l’appelant. Un duplicate byte-for-byte relit sans consommer de séquence et conserve la première preuve acceptée ; un contenu divergent est refusé. Si `next_canonical_sequence == Number.MAX_SAFE_INTEGER`, l’allocation est refusée avant mutation afin que le compteur `next` reste représentable. `acquireGenerationLease` ne réussit que pour une source non terminée sans lease vivante, incrémente `generation_attempt` et utilise un TTL renouvelé par heartbeat. `completeResponse` vérifie le propriétaire de lease, réserve la séquence de l’événement final, l’insère et passe la source à `completed` dans la même transaction. Une source `completed` retourne le résultat existant et interdit une seconde réponse.

Après crash avec résultat déjà persisté, rejouer sans appeler le modèle. Après crash avant toute persistance exploitable, une lease stale autorise une nouvelle invocation avec `idempotencyKey=sourceEventId` si le provider le supporte. Sans support provider, le plan garantit une seule réponse finale/effet visible, pas une seule facturation réseau ; enregistrer l’attempt et appliquer le budget avant retry.

- [ ] **Step 4: vérifier et committer**

```powershell
npx vitest run tests/chat-database-migrations.test.mjs tests/native-chat-store.test.mjs tests/message-delivery-ledger.test.mjs
git add src/devices/migrations/002-native-chat-ledger.sql src/devices/chat-database.mjs src/devices/native-chat-store.mjs tests/native-chat-store.test.mjs tests/chat-database-migrations.test.mjs
git commit -m "feat(chat): persist idempotent conversation ledger"
```

---

### Task 8: Brancher le canal natif sur mémoire, modèles et response gate

**Gate reviewer obligatoire :** avant de modifier le chemin LLM/fallback, annoncer un seul `ai-llm-engineer` en lecture seule et attendre l’autorisation explicite de Nasro. Le lancer après implémentation/tests rouges→verts mais avant le commit afin qu’il inspecte le fallback, les prompts/guards, le streaming, la mémoire et le diff réel.

**Files:**
- Create: `src/messaging/native-chat-service.mjs`
- Modify: `src/messaging/channel-router.mjs`
- Modify: `src/messaging/conversation-service.mjs`
- Modify: `src/safety/channel-policy.mjs`
- Modify: `src/memory/runtime-controller.mjs`
- Modify: `src/ui/main.mjs`
- Create: `tests/native-chat-service.test.mjs`
- Modify: `tests/channel-router.test.mjs`
- Modify: `tests/conversation-service.test.mjs`
- Modify: `tests/integration/cross-channel-memory.test.mjs`

**Interfaces:**
- `createNativeChatService({ store, crypto, memoryController, generator, responseGate, actionAuthorizer, publish, clock })`.
- `ingest(envelope, { transport, signal })` retourne `{ duplicate, sourceEventId, responseEventId, state }`.
- `memoryController.rememberChatTurn({ eventId, threadId, deviceId, role, text, sentAtMs })`.
- `generator.generate({ threadId, messages, signal, onChunk })` reste injecté et n’expose aucun provider au transport.

- [ ] **Step 1: écrire les tests rouges du pipeline**

Tester : plaintext déchiffré seulement après vérification, mémoire verrouillée, owner turn mémorisé, contexte rappelé, chunks persistés avant publish, response gate block, génération échouée/retry, lease concurrente, crash avant/après résultat, idempotency key provider propagée, event duplicate sans seconde réponse finale, préfixe futur `memory.delete` non auto-autorisé et contenu demandant « ignore la policy » traité comme donnée.

- [ ] **Step 2: ajouter la policy `mina_app`**

```js
const NATIVE_CHAT_PASSIVE_CAPABILITIES = new Set([
  'conversation.reply_draft', 'conversation.reply_send', 'memory.read', 'memory.search',
]);

if (channel === 'mina_app') {
  if (capability === null || NATIVE_CHAT_PASSIVE_CAPABILITIES.has(capability)) {
    return { decision: 'allow', reason: 'paired_app_channel' };
  }
  return { decision: 'confirm', reason: 'paired_app_action_requires_broker' };
}
```

Cette décision ne suffit jamais à exécuter : toute capacité avec effet passe ensuite par `computer-action-authorizer` et Task 18/19.

- [ ] **Step 3: créer une méthode mémoire dédiée**

```js
async function rememberChatTurn({ eventId, threadId, deviceId, role, text, sentAtMs }) {
  const active = requireUnlocked();
  if (!/^(?:owner|mina)$/u.test(role) || typeof text !== 'string' || text.length < 1 || text.length > 32_768) {
    throw new TypeError('chat_turn_invalid');
  }
  await active.memoryService.remember({
    eventId: `chat-${eventId}`,
    kind: 'local_owner', value: 'owner', channel: 'mina_app', content: text,
    classification: 'sensitive', provenance: { threadId, deviceId, role, sentAtMs },
  });
}
```

- [ ] **Step 4: extraire le générateur conversationnel commun**

Renommer l’instance interne Telegram en générateur de conversation commun sans modifier sa stratégie provider. Telegram et `native-chat-service` reçoivent la même interface injectée ; aucun import direct Gemini/OpenAI n’entre dans le service de transport. Propager `sourceEventId` comme idempotency key quand l’adaptateur provider le permet. Persister les chunks avant émission et, sur Firebase, regrouper au plus un frame toutes les 350 ms avec plaintext ≤8 KiB avant chiffrement ; le résultat final durable remplace toujours le stream éphémère.

- [ ] **Step 5: composer hors de `main.mjs` autant que possible**

Créer le service dans un getter borné, injecter store/crypto/publish et n’ajouter à `main.mjs` que la composition et le lifecycle start/stop. Rapporter `native_chat` dans le catalogue runtime avec une raison exacte si Firebase ou direct sont absents ; le chat local direct peut être `available` même si Firebase est `degraded`.

- [ ] **Step 6: vérifier et committer**

Après les tests verts et avant `git add`, lancer uniquement le reviewer préalablement autorisé. Reproduire ses findings, corriger par TDD les problèmes prouvés et relancer les gates ; aucun commit si une régression LLM/mémoire/guard élevée reste ouverte.

```powershell
npx vitest run tests/native-chat-service.test.mjs tests/channel-router.test.mjs tests/conversation-service.test.mjs tests/integration/cross-channel-memory.test.mjs tests/main-domain-composition-contract.test.mjs
npm test
git add src/messaging src/safety/channel-policy.mjs src/memory/runtime-controller.mjs src/ui/main.mjs tests
git commit -m "feat(chat): route paired conversations through mina runtime"
```

---

### Task 9: Créer Room ciphertext-only, le repository et l’outbox Android

**Files:**
- Create: `android/core/chat/src/main/kotlin/fr/mina/gateway/chat/storage/ChatEntities.kt`
- Create: `android/core/chat/src/main/kotlin/fr/mina/gateway/chat/storage/ChatDao.kt`
- Create: `android/core/chat/src/main/kotlin/fr/mina/gateway/chat/storage/MinaChatDatabase.kt`
- Create: `android/core/chat/src/main/kotlin/fr/mina/gateway/chat/ChatRepository.kt`
- Create: `android/core/chat/src/main/kotlin/fr/mina/gateway/chat/ChatOutbox.kt`
- Create: `android/core/chat/src/main/kotlin/fr/mina/gateway/chat/EpochKeyRepository.kt`
- Create: `android/core/chat/src/test/kotlin/fr/mina/gateway/chat/ChatOutboxTest.kt`
- Create: `android/core/chat/src/androidTest/kotlin/fr/mina/gateway/chat/MinaChatDatabaseTest.kt`
- Create: `android/core/chat/schemas/fr.mina.gateway.chat.storage.MinaChatDatabase/1.json`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Create: `android/app/src/main/res/xml/backup_rules.xml`
- Create: `android/app/src/main/res/xml/data_extraction_rules.xml`

**Interfaces:**
- `ChatRepository.createTextMessage(threadId, plaintext)` persiste avant réseau et retourne `ChatEvent`.
- `pageThread(threadId, beforeCanonicalSequence, limit=50): Flow<List<ChatMessage>>` ne déchiffre jamais tout le fil en mémoire.
- `nextOutboxBatch(limit)`, `markTransported`, `markPcReceived`, `markCompleted`, `scheduleRetry`.
- `markRemoteExpired(eventId)` puis `markRenewing(eventId)` conservent les octets originaux ; un renouvellement réussi revient à `cloud_queued` sans créer un second `ChatEvent`.
- `EpochKeyRepository.unwrap(epoch)` garde les bytes uniquement en mémoire et les efface après usage.

- [ ] **Step 1: écrire les tests rouges**

Tester transaction « message + outbox », process restart, ordre, duplicate eventId, compteur monotone par device survivant à purge/compaction, génération concurrente de séquence, borne `Number.MAX_SAFE_INTEGER` refusant l’incrément suivant sans event/outbox partiel, texte 32 KiB mesuré en UTF-8 multioctet, séquence canonique nullable avant ACK puis réconciliée sans déplacer le draft, page de 50, retry/expiry/renouvellement, conservation byte-for-byte de l’enveloppe et du même `eventId` après >30 jours, clé absente, migration Room, fichier dans le stockage privé, `android:allowBackup="false"`, `fullBackupContent` et `dataExtractionRules` excluant DB/files/sharedprefs/device-transfer, et aucune colonne `body`, `text`, `filename` ou `caption` en clair. Le test interdit aussi toute mention `SQLCipher enabled` : cette garantie n’est pas livrée tant que la compatibilité Room 2.8.4 n’est pas démontrée.

- [ ] **Step 2: définir les entités minimales**

```kotlin
@Entity(tableName = "chat_events", indices = [Index("threadId"), Index(value = ["threadId", "canonicalSequence"], unique = true), Index(value = ["senderDeviceId", "deviceSequence"], unique = true)])
data class ChatEventEntity(
    @PrimaryKey val eventId: String,
    val threadId: String,
    val senderDeviceId: String,
    val deviceSequence: Long,
    val canonicalSequence: Long?,
    val keyEpoch: Int,
    val routingClass: String,
    val envelopeJson: ByteArray,
    val localState: String,
    val createdAtMs: Long,
    val updatedAtMs: Long,
)

@Entity(tableName = "chat_outbox")
data class ChatOutboxEntity(
    @PrimaryKey val eventId: String,
    val queue: String,
    val attempt: Int,
    val nextAttemptAtMs: Long,
    val lastErrorCode: String?,
)

@Entity(tableName = "chat_device_state")
data class ChatDeviceStateEntity(
    @PrimaryKey val deviceId: String,
    val nextDeviceSequence: Long,
    val cloudSequence: Long,
)
```

L’incrément de `nextDeviceSequence`, l’insert event et l’insert outbox sont une seule transaction Room. `chat_outbox.eventId` référence `chat_events` avec suppression interdite tant que l’outbox existe. La séquence ne se recalcule jamais par `MAX(events)` afin qu’une purge ne provoque pas de replay.

- [ ] **Step 3: implémenter les transitions autorisées**

```kotlin
private val transitions = mapOf(
    "local_pending" to setOf("direct_sending", "cloud_queued", "retry_wait", "canceled"),
    "direct_sending" to setOf("pc_received", "cloud_queued", "retry_wait"),
    "cloud_queued" to setOf("pc_received", "retry_wait", "expired_remote_copy"),
    "cloud_renewing" to setOf("cloud_queued", "pc_received", "retry_wait", "canceled"),
    "pc_received" to setOf("processing", "completed", "failed_final"),
    "processing" to setOf("response_streaming", "completed", "retry_wait", "failed_final"),
    "response_streaming" to setOf("completed", "retry_wait", "failed_final"),
    "retry_wait" to setOf("direct_sending", "cloud_queued", "failed_final", "canceled"),
    "expired_remote_copy" to setOf("direct_sending", "cloud_renewing", "canceled"),
)
```

Toute transition hors matrice lève `chat_state_transition_invalid`.

Conserver `allowBackup=false` et ajouter des règles explicites de sauvegarde API 23–30 et d’extraction API 31+ excluant `database`, `file`, `sharedpref`, `root`, leurs domaines device-protected et le device transfer. Aucun ciphertext, token Firebase, clé enveloppée ou cache d’ouverture ne doit être restauré sur une autre installation.

- [ ] **Step 4: borner l’outbox**

Maximum global 5 000 événements ou 500 MiB. Réserver 10 MiB et 100 slots aux files `control`/`message` afin qu’un média saturé ne bloque jamais ACK, stop ou texte.

- [ ] **Step 5: vérifier et committer**

```powershell
android\gradlew.bat :core:chat:testDebugUnitTest :core:chat:connectedDebugAndroidTest :core:chat:lintDebug
git add android/core/chat android/app/src/main/AndroidManifest.xml android/app/src/main/res/xml/backup_rules.xml android/app/src/main/res/xml/data_extraction_rules.xml
git commit -m "feat(android): persist encrypted chat history and outbox"
```

Expected device gate: tests instrumentés verts sur au moins un appareil ; si UTP retourne un code incohérent, lire le XML JUnit comme preuve et documenter séparément l’incident de harness.

---

### Task 10: Configurer Firebase Emulator Suite et les règles fail-closed

**Files:**
- Create: `firebase.json`
- Create: `firestore.rules`
- Create: `firestore.indexes.json`
- Create: `database.rules.json`
- Modify: `firebase.storage.rules`
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `tests/firebase-chat-rules.test.mjs`

**Interfaces:**
- Firestore append-only sous `owners/{ownerId}` avec `eventRuntime` courant, `syncLog` immuable séquencé par Functions et `syncState` de compaction.
- RTDB éphémère sous `activeDevices`, `presence`, `streams`.
- Storage ciphertext-only sous `owners/{ownerId}/chat` et `history-snapshots`.
- Aucun déploiement réel dans cette tâche ; tous les tests utilisent Emulator Suite.

- [ ] **Step 1: installer les outils de test épinglés et écrire les tests rouges**

```powershell
npm install --save-dev --save-exact firebase-tools@15.24.0 @firebase/rules-unit-testing@5.0.1
```

Tester owner différent, UID Auth partagé/usurpé, `authUid` différent du document device, claim `device_id` absent, tokenVersion incorrecte, appareil révoqué, viewer créant un message, rôle autorisé mais capacité persistée absente, update/delete d’événement, champ inconnu, sender usurpé, createdAt futur, TTL >30 jours depuis createdAt, ciphertext/base64/nonce/tag invalides, cursor cloudSequence d’un autre device, régressif ou supérieur au high-watermark, écriture/lecture client de `rejectedEvents`/`renewalChallenges`, écriture client `eventRuntime`/`syncLog`/`syncState`/`ownerRuntime`, device modifiant son document/pairingSession/thread, lecture/écriture client de `deviceRuntime`, snapshot d’un autre targetDeviceId, téléphone uploadant un snapshot, tentative client de modifier `activeDevices`, téléphone écrivant un stream, Storage >5 MiB, RTDB ciphertext >16 384 caractères et non-régression des chemins backup déjà protégés par `firebase.storage.rules`.

- [ ] **Step 2: créer la configuration locale**

```json
{
  "firestore": { "rules": "firestore.rules", "indexes": "firestore.indexes.json" },
  "database": { "rules": "database.rules.json" },
  "storage": { "rules": "firebase.storage.rules" },
  "emulators": {
    "auth": { "port": 9099 },
    "firestore": { "port": 8080 },
    "database": { "port": 9000 },
    "storage": { "port": 9199 },
    "ui": { "enabled": true, "port": 4000 },
    "singleProjectMode": true
  }
}
```

Initialiser `firestore.indexes.json` à `{ "indexes": [], "fieldOverrides": [] }`. L’ordre `syncLog.serverSequence` utilise l’index mono-champ automatique ; ajouter un composite uniquement lorsqu’un test Emulator reproduit une requête qui l’exige.

- [ ] **Step 3: écrire les règles Firestore strictes**

Le noyau doit être équivalent à :

```text
function hasOwnerClaim(ownerId) {
  return request.auth != null
    && request.auth.token.owner_id == ownerId
    && request.auth.token.device_id is string;
}
function devicePath(ownerId) {
  return /databases/$(database)/documents/owners/$(ownerId)/devices/$(request.auth.token.device_id);
}
function isActiveDevice(ownerId) {
  return hasOwnerClaim(ownerId)
    && exists(devicePath(ownerId))
    && get(devicePath(ownerId)).data.authUid == request.auth.uid
    && get(devicePath(ownerId)).data.revokedAt == null
    && get(devicePath(ownerId)).data.tokenVersion == request.auth.token.token_version;
}
function hasCapability(ownerId, capability) {
  return isActiveDevice(ownerId)
    && capability in get(devicePath(ownerId)).data.capabilities;
}
```

`events/{eventId}` autorise seulement `create`, avec `senderDeviceId == request.auth.token.device_id`, `deviceSequence` dans `[1, 9 007 199 254 740 991]`, `keyEpoch` dans `[1, 2 147 483 647]`, timestamps Firestore natifs, `createdAt <= request.time + 5 min`, `expiresAt > request.time`, `expiresAt <= createdAt + 30 j`, champs `hasOnly`, ciphertext/base64/nonce/tag/signature et tailles bornées. La classe `message` exige `chat.write`, `receipt` exige `chat.read`, `stream` est create-only pour `device_id=mina-brain`, `approval` exige `approval.request` côté brain ou la capacité d’approbation côté appareil, et `control` exige `chat.write`/`voice.live` ou brain. `update` et `delete` sont toujours faux côté client. `eventRuntime`, `syncLog` et `syncState` sont lisibles par un appareil actif mais écrits uniquement par Admin/Functions ; `ownerRuntime`, `deviceRuntime`, `renewalChallenges` et `rejectedEvents` sont intégralement refusés côté client. Les documents device/pairing/thread sont non-écrivables par les clients ; un cursor n’est modifiable que par son propre `device_id`, avec champs exacts, `cloudSequence` monotone, entier sûr et `<= syncState.highWatermark`. Un `attachmentAck` est create-only, porte le `device_id` authentifié, le digest attendu et des champs stricts. Le rattrapage utilise l’index mono-champ Firestore automatique de `syncLog.serverSequence`; `firestore.indexes.json` reste explicitement vide tant qu’aucune requête composite réelle n’est introduite, et aucune requête ne scanne `eventRuntime`.

- [ ] **Step 4: durcir Storage et RTDB**

Fusionner les règles chat dans `firebase.storage.rules` sans modifier les autorisations backup existantes, puis ajouter des tests de non-régression sur ces chemins. Storage exige appareil actif via Firestore, `contentType == 'application/octet-stream'`, métadonnées strictes et `size <= 5 * 1024 * 1024`. Un upload attachment exige `media.send`; un download exige `chat.read`. Pour `history-snapshots`, seul `mina-brain` écrit et seul le `targetDeviceId` inscrit dans la métadonnée d’objet lit.

Dans RTDB, tout write client sous `activeDevices` est refusé : ce miroir est écrit par Admin/Functions. Une présence exige `auth.token.owner_id == ownerId`, `auth.token.device_id == deviceId`, `auth.uid == activeDevices/{ownerId}/{deviceId}/authUid`, un appareil non révoqué et la tokenVersion identique. Sous `streams`, seul `device_id=mina-brain` écrit des frames strictes ; les appareils actifs du même owner lisent. Le ciphertext base64 est ≤16 384 caractères, sequence/expiry sont bornées et aucun audio live n’entre dans RTDB.

- [ ] **Step 5: vérifier dans les émulateurs et committer**

```powershell
npx firebase-tools@15.24.0 emulators:exec --project mina-vision-test "npx vitest run tests/firebase-chat-rules.test.mjs"
git add firebase.json firestore.rules firestore.indexes.json database.rules.json firebase.storage.rules package.json package-lock.json tests/firebase-chat-rules.test.mjs
git commit -m "feat(firebase): enforce ciphertext only chat rules"
```

Expected: tous les refus et autorisations attendus passent ; aucun projet réel touché.

---

### Task 11: Créer les Functions d’auth, App Check, réveil et révocation

**Gate reviewers obligatoires :** avant de commencer cette tâche, annoncer trois reviewers en lecture seule (`backend-api-reviewer`, `integration-resilience-reviewer`, `security-auditor`) avec leur périmètre exact et attendre l’autorisation explicite de Nasro. Les lancer après implémentation/tests rouges→verts mais avant le commit afin qu’ils inspectent le diff réel ; aucun n’édite ni ne déploie.

**Files:**
- Modify: `.gitignore`
- Create: `functions/package.json`
- Create: `functions/package-lock.json`
- Modify: `firebase.json`
- Create: `functions/src/index.mjs`
- Create: `functions/src/runtime-config.mjs`
- Create: `functions/src/contracts.mjs`
- Create: `functions/src/chat-event-verifier.mjs`
- Create: `functions/src/renewal.mjs`
- Create: `functions/src/sequence.mjs`
- Create: `functions/src/pairing.mjs`
- Create: `functions/src/app-check.mjs`
- Create: `functions/src/wake.mjs`
- Create: `functions/src/revocation.mjs`
- Create: `functions/src/gc.mjs`
- Create: `functions/test/pairing.test.mjs`
- Create: `functions/test/app-check.test.mjs`
- Create: `functions/test/wake.test.mjs`
- Create: `functions/test/sequence.test.mjs`
- Create: `functions/test/chat-event-verifier.test.mjs`
- Create: `functions/test/renewal.test.mjs`
- Create: `src/devices/firebase-owner-session.mjs`
- Modify: `src/devices/chat-pairing-service.mjs`
- Modify: `android/core/transport/src/main/kotlin/fr/mina/gateway/transport/ChatPairingClient.kt`
- Create: `tests/firebase-owner-session.test.mjs`
- Create: `tests/functions-chat-contract-parity.test.mjs`

**Interfaces:**
- HTTPS `bootstrapBrain` one-shot → UID Auth opaque dédié + custom token `device_id=mina-brain`.
- HTTPS `issueBrainSession` → nouveaux tokens Auth/App Check après challenge ES256 anti-replay ; aucun refresh token PC n’est persisté.
- Callable brain-only `registerCloudPairingSession` enregistre une session locale déjà approuvée ; aucun téléphone ne peut créer cette session.
- HTTPS `completePairing` one-shot → UID Auth opaque unique + custom token de l’appareil + clé d’époque enveloppée.
- Callable brain-only `relayVerifiedEvent` réplique idempotemment une enveloppe reçue en direct sans changer son auteur.
- Callables self-only `issueEventRenewalNonce` et `renewExpiredEvent` renouvellent la lease d’une enveloppe historiquement expirée sans modifier ses octets ni son `eventId`.
- Callables `refreshDeviceToken`, `registerFcmInstallation` et `unregisterFcmInstallation` self-only avec signature fraîche ; `setDevicePolicy` et `revokeDevice` brain-only via Admin SDK. Aucun appareil ne modifie directement son document d’autorité.
- HTTPS `issueBootstrapAppCheck` pour l’étape pré-Auth Huawei.
- HTTPS `issueCustomAppCheck` pour appareil sans Play Integrity, avec mode normal Auth et mode recovery signé après expiration simultanée Auth/App Check.
- Paramètre de déploiement obligatoire `MINA_FUNCTION_REGION`, sans défaut ; la même région épinglée configure les Functions et leurs clients.
- Trigger Firestore `indexEventRuntime` attribue un `serverSequence` global idempotent, crée l’entrée immuable `syncLog`, avance `syncState.highWatermark`, puis `dispatchOpaqueWake` envoie ce high-watermark.
- Trigger Firestore/Admin `mirrorActiveDevice` vers RTDB, jamais accessible en écriture client.
- Scheduled `gcAcknowledgedEvents`.

- [ ] **Step 1: inventorier les régions puis créer le sous-projet Functions épinglé**

Avant d’écrire une région dans le runtime, inventorier en lecture seule le projet déjà choisi : ID exact, emplacement Firestore, instance/région RTDB, bucket/région Storage et Functions existantes. Si cet inventaire ou la confirmation de Nasro manque, poursuivre uniquement contre les émulateurs avec le paramètre non résolu et bloquer toute activation cloud réelle ; ne jamais laisser le défaut Firebase choisir implicitement `us-central1`. La région retenue doit être supportée par Functions v2 et minimiser les échanges avec les ressources existantes. Une ressource absente n’est jamais créée implicitement : son provisionnement manuel, sa localisation immuable et son coût nécessitent un gate Nasro. Aucun service ni projet supplémentaire n’est créé pendant cet inventaire.

```json
{
  "name": "mina-vision-firebase-functions",
  "private": true,
  "type": "module",
  "engines": { "node": "22" },
  "main": "src/index.mjs",
  "dependencies": {
    "firebase-admin": "14.2.0",
    "firebase-functions": "7.3.0",
    "zod": "4.4.3"
  },
  "devDependencies": {
    "vitest": "4.1.10"
  },
  "scripts": { "test": "vitest run" }
}
```

Créer `functions/src/runtime-config.mjs` avec `defineString('MINA_FUNCTION_REGION')` sans valeur par défaut et passer directement ce paramètre à `setGlobalOptions({ region: functionRegion, minInstances: 0, maxInstances: 3, concurrency: 20, timeoutSeconds: 30, memory: '256MiB' })`. Les jobs GC/compaction surchargent explicitement `maxInstances:1`, `concurrency:1`, `timeoutSeconds:120`; aucun endpoint ne définit de min instance payante. Les tests de structure refusent région absente, instances non bornées ou override plus permissif. Cette valeur de localisation est non sensible, mais elle appartient au paramétrage Firebase et non à Vercel : aucune API Vercel n’est appelée. Le CLI doit bloquer le déploiement tant que la valeur confirmée n’est pas fournie. Le commit local peut donc conserver le paramètre non résolu sans déclencher de build distant ; sa valeur doit exister avant le premier deploy. Ajouter `functions/.env*` à `.gitignore` afin que le fichier local généré par le CLI ne soit jamais committé. Les tests fixent une valeur d’émulateur explicite ; aucun test ne dépend d’une région cloud réelle.

Après création de `functions/package.json`, générer le lockfile avant les tests :

```powershell
Set-Location functions
npm install
Set-Location ..
```

Ajouter ensuite à `firebase.json` la source `functions` avec runtime `nodejs22` et l’émulateur Functions sur le port 5001. Ne modifier ni alias ni projet Firebase réel.

- [ ] **Step 2: écrire les tests rouges**

Cas : bootstrap code faux/consommé, session PC redémarrée par signature ES256, nonce PC rejoué/expiré refusé, coffre verrouillé fail-closed, persistence Auth PC non-memory refusée, création de session cloud par téléphone refusée, mutation role/capabilities par téléphone refusée, `setDevicePolicy` brain-only avec allowlist, session locale non approuvée refusée, session pairing expirée, plus de cinq essais, preuve invalide, role non approuvé, UID Auth unique par appareil, réponse pairing perdue puis reprise idempotente sans nouvelle clé/UID, custom claims exacts, révocation ciblée ne coupant pas l’autre téléphone, relay direct signature source fausse/appareil révoqué/digest divergent, relay direct historique sans preuve source ou sans attestation PC fraîche refusé, preuve direct exacte relayée par la transaction de renouvellement, événement cloud signature/DER/timestamp invalides produisant rejet privé sans sequence/FCM, compteur de rejet idempotent et GC 24 h, trigger Firestore valide rejoué sans trou ni double `serverSequence`/`syncLog`, deux événements concurrents, high-watermark exact, bootstrap App Check pré-Auth accepté seulement avec session+signature+digest APK+nonce valides, renouvellement App Check normal avec ID token actif+signature+nonce+tokenVersion, recovery après expiration simultanée ID/App Check avec preuve clé appareil mais sans émission Auth, recovery révoqué/mauvais authUid/tokenVersion refusé, nonce rejoué, allowlist d’exemption limitée exactement à trois endpoints, FCM contenant une clé interdite, GC événement/runtime avant/après ACK, compaction uniquement par préfixe avec `compactedThrough` monotone, attachment partiellement ACK, snapshot target ACK et upload orphelin 24 h.

Ajouter une expiration simulée >30 jours : nonce de renouvellement one-shot, original + preuve fraîche acceptés, mêmes octets/`eventId`, nouveau `serverSequence`/lease, retry byte-for-byte du même appel retournant le même reçu sans nouvelle séquence ; tampering, mauvais scope/sender, appareil révoqué, réutilisation du nonce avec un autre digest, preuve >5 min ou lease >30 jours sont refusés sans mutation/wake.

```powershell
Set-Location functions
npm test
Set-Location ..
npx vitest run tests/firebase-owner-session.test.mjs
```

Expected: `FAIL` sur les handlers et la session propriétaire encore absents.

- [ ] **Step 3: implémenter les claims minimaux**

```js
const claimsFor = ({ ownerId, deviceId, role, tokenVersion }) => Object.freeze({
  owner_id: ownerId,
  device_id: deviceId,
  role,
  token_version: tokenVersion,
});
```

`registerCloudPairingSession` exige la session Firebase du PC `device_id=mina-brain`, l’appareil déjà actif dans le registre local, la confirmation locale, le challenge, `transportSecretHash`, digests de clés/rôle/région/expiry signés par le PC, `wrappedDeviceKey` et clé d’époque déjà enveloppée pour l’appareil. Le secret QR et `deviceWrapKey` plaintext sont explicitement interdits. Il écrit cette matière ciphertext-only dans `pairingSessions`; un appel provenant du téléphone est refusé. Générer une seule fois un UID opaque `mina_device_<128 bits base64url>` dans cette session et le conserver dans `devices/{deviceId}.authUid`.

`completePairing` suit une machine idempotente `approved → provisioning → completed → acknowledged`. La transaction réserve l’UID et le digest de preuve ; création Auth/custom claims/device doc peut être rejouée avec les mêmes valeurs. Tant que la session n’est pas expirée et pas ACK, la même clé/preuve obtient un nouveau custom token mais jamais un nouvel UID, `deviceWrapKey` ou epoch wrap. Une preuve différente est refusée. La consommation définitive intervient à l’ACK ou à l’expiry, ce qui évite qu’une réponse réseau perdue rende l’appareil irrécupérable. Deux appareils ne partagent jamais un principal Auth.

`relayVerifiedEvent` exige brain Auth/App Check, schéma strict, signature DER valide contre la clé publique du `senderDeviceId`, device actif et digest PC lié. Si l’eventId existe, seul un contenu byte-for-byte identique est idempotent ; sinon conflit. Un événement direct non expiré suit l’indexation initiale. Un événement direct historiquement expiré exige en plus la `RenewalProof` source persistée par le ledger et une attestation PC `MINA_RELAY_RENEWAL_V1` fraîche sur event digest, proof digest, acceptedAt, nonce de relay et date ; les deux signatures et le device encore actif sont vérifiés, puis la transaction `reason=renewal` commune est utilisée. Pour toute création client, `indexEventRuntime` appelle d’abord `chat-event-verifier` avec la clé publique/device live et le mapping Timestamp exact. Un échec écrit idempotemment `rejectedEvents/{eventId}` avec seulement code stable, deviceId haché et expiry 24 h, incrémente un compteur privé borné, puis ne crée ni runtime, ni log, ni séquence, ni wake. Un succès réserve dans une transaction `ownerRuntime/sync.nextServerSequence`, crée `eventRuntime/{eventId}`, crée `syncLog/{sequenceKey}` avec `reason=initial` et avance `syncState.highWatermark`; il n’incrémente rien si le runtime initial existe déjà. `sequenceKey` est le `serverSequence` décimal left-pad sur 16 caractères et doit correspondre au champ numérique. À `Number.MAX_SAFE_INTEGER`, la transaction refuse avant mutation plutôt que produire une séquence imprécise. Les contrats Functions ont des fixtures de parité byte-for-byte avec Task 2.

`issueEventRenewalNonce` exige Auth + App Check, claims exacts et appareil actif ; il retourne un nonce aléatoire de 32 octets dont `renewalChallenges/{nonceDigest}` ne conserve avant usage que le digest et l’expiry cinq minutes. `renewExpiredEvent` exige les octets canoniques de l’enveloppe d’origine et une signature DER sur un codec binaire à longueurs contenant `MINA_EVENT_RENEWAL_V1`, `eventId`, `SHA256(envelopeBytes)`, `senderDeviceId`, le scope `firebase:<projectId>:<ownerId>`, le nonce, `issuedAtMs` et `requestedCloudExpiresAtMs`. Il revalide la signature d’origine en mode historique, sans relâcher les bornes structurelles/TTL initial, puis consomme le nonce transactionnellement. La consommation mémorise pendant 24 heures le digest de la requête et son reçu : un retry byte-for-byte retourne le même résultat, toute autre réutilisation échoue. Auth UID/claims, App Check, sender, clé publique, `tokenVersion` et device actif doivent tous correspondre. Dans une transaction Admin, un event existant doit être byte-for-byte identique ; un event supprimé est recréé avec exactement les mêmes champs. Dans les deux cas, la Function réserve un nouveau `serverSequence`, fixe `cloudExpiresAt <= serverNow + 30 jours`, met à jour `eventRuntime.latestServerSequence`, ajoute `syncLog/{sequenceKey}` avec `reason=renewal` et la preuve, puis avance `syncState.highWatermark`. `indexEventRuntime` détecte le runtime Admin déjà vérifié et ne crée aucune entrée initiale supplémentaire. Les clients avancent le curseur depuis le `syncLog` mais dédupliquent l’UI/Room sur `eventId`. Aucune voie ordinaire n’accepte un `expiresAtMs` historique.

`setDevicePolicy` valide rôle/capacités contre les allowlists, incrémente `tokenVersion`, met à jour les custom claims et révoque les refresh tokens du seul `authUid` concerné. Les rules bloquent immédiatement l’ancien `token_version`. Retirer `chat.read` exige dans la demande brain-only la preuve d’une nouvelle époque déjà créée/enveloppée pour les autres appareils ; ajouter `chat.read` laisse l’appareil `history_pending` jusqu’à distribution de clé + snapshot. Changer seulement une capacité passerelle ne tourne pas les clés de chat. `refreshDeviceToken` peut accepter l’ancien ID token uniquement pour cette opération, à condition que `authUid`, signature fraîche et device actif correspondent ; un device révoqué est toujours refusé.

Si Firebase était indisponible au QR initial, `chat-pairing-service` garde `cloud_state=pending`. L’activation ultérieure exige une nouvelle confirmation locale et un nouveau challenge envoyé sur le WebSocket déjà mutuellement authentifié ; la réponse signée transmet aussi la région Functions confirmée, et aucun QR/session expiré n’est réutilisé.

- [ ] **Step 4: définir le bootstrap PC sans compte de service local**

Le déploiement initial, exécuté manuellement par Nasro, crée un secret aléatoire 256 bits dans Secret Manager, configure l’`ownerId` logique existant et attribue au PC un UID Auth opaque `mina_brain_<128 bits base64url>` distinct des téléphones. Déclarer ce secret via `defineSecret('MINA_BOOTSTRAP_CODE')` et le lier uniquement à `bootstrapBrain`. Cette Function compare en temps constant, refuse après consommation, enregistre la clé publique ES256 du PC et ne journalise jamais le code.

`firebase-owner-session.mjs` reçoit le keyring Mina, conserve la clé privée PC sous le nom de domaine `firebase/chat/brain-identity-key`, mais ne persiste jamais le custom token, l’ID token, l’App Check token ou le refresh token. Il appelle `bootstrapBrain`/`issueBrainSession` par HTTPS régional épinglé avant de créer les autres clients Firebase, installe un `CustomProvider` App Check alimenté par cette réponse, force l’obtention du token App Check, puis seulement impose `setPersistence(auth, inMemoryPersistence)` et exécute `signInWithCustomToken`. À chaque démarrage, il demande un nonce serveur, signe par codec binaire domain-separated `ownerId + brainAuthUid + nonce + issuedAt + tokenVersion`, puis appelle `issueBrainSession`. Cet endpoint public de bootstrap est exclu de l’enforcement App Check automatique, fortement rate-limité, et valide nonce one-shot, signature et version avant d’émettre un custom token Auth à échange immédiat et un token App Check de trente minutes, minimum officiel. Le supplier App Check renouvelle par la même voie HTTPS brute, jamais via le SDK Functions qu’il protège. Après redémarrage, la preuve de clé est rejouée avec un nouveau nonce. Coffre verrouillé signifie Firebase `degraded`, jamais stockage en clair.

Commande préparatoire à présenter, jamais lancer automatiquement :

```powershell
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))" | npx firebase-tools@15.24.0 functions:secrets:set MINA_BOOTSTRAP_CODE
```

Le générateur n’ajoute aucun retour de ligne et la valeur ne passe ni par un fichier, ni par une variable PowerShell, ni par une sortie affichée à l’utilisateur. Le code est saisi une fois dans l’UI locale et marqué consommé côté Function. Après preuve du bootstrap, créer manuellement une nouvelle version aléatoire inconnue et désactiver seulement l’ancienne ; ne jamais désactiver l’unique version encore liée tant que `bootstrapBrain` n’a pas été redéployée sans ce secret, sinon un cold start pourrait échouer.

- [ ] **Step 5: implémenter App Check custom Huawei sans dépendance circulaire**

`issueBootstrapAppCheck` n’accepte avant Auth qu’une session pairing non expirée/non consommée, un nonce serveur de 32 octets à usage unique, la signature ES256 du challenge et le digest de signature APK déclaré/autorisé. Sans attestation matérielle, ce digest n’est jamais traité comme une preuve autonome : seule la session physique liée à la clé appareil fonde l’état `software_paired`. L’endpoint est fortement rate-limité et émet un token App Check au minimum officiel de trente minutes ; le test refuse tout TTL inférieur. Sa fenêtre d’usage effective reste cinq minutes, car `completePairing` exige ce token puis revalide session non expirée, nonce one-shot, preuve et signature, tandis que les rules sans Auth refusent les données. L’allowlist exclue de l’enforcement App Check automatique contient exactement `issueBootstrapAppCheck`, `issueBrainSession` et `issueCustomAppCheck` : ce dernier renouvelle précisément un token expiré et ne peut donc pas l’exiger. Tous les autres endpoints exigent App Check. Les trois exceptions ont leurs propres contrôles cryptographiques, quotas et anti-replay ; le quota distribué privilégie session/device et l’IP n’est conservée que sous HMAC secret rotatif avec TTL court, jamais brute dans Firestore ou les logs. Après appairage, `issueCustomAppCheck` possède un mode normal (ID token actif de l’UID dédié + nonce frais + signature appareil + `tokenVersion` live + version APK autorisée) et un mode recovery pour l’expiration simultanée (ownerId/deviceId + nonce serveur + mêmes vérifications contre le device actif, sans exiger/émettre Auth). Il émet uniquement un token App Check d’une heure ; le refresh token Firebase Auth privé renouvelle ensuite l’ID token. Ce provider custom est utilisable sur Huawei et, si Play Integrity sideload n’est pas réellement configuré, sur Samsung. L’état d’attestation est `hardware`, `software_paired` ou `unavailable`, exposé sans inventer une garantie matérielle.

- [ ] **Step 6: garantir un FCM opaque**

```js
const wakeData = ({ ownerId, deviceId, highWatermark }) => ({
  type: 'sync', ownerId, deviceId, highWatermark: String(highWatermark),
});
```

Le test interdit `text`, `body`, `title`, `filename`, `summary`, `action`, `ciphertext`, `nonce`, `tag` et `signature` dans la payload FCM.

`registerFcmInstallation` reçoit exclusivement le FID livré par `onRegistered()`, vérifie Auth/App Check/device/signature fraîche et le conserve dans `deviceRuntime`, jamais dans le document device lisible. `unregisterFcmInstallation` ne supprime que le FID exact de son propre device et reste idempotent. `dispatchOpaqueWake` cible l’Admin SDK avec le champ `fid`, pas le champ `token` déprécié. Une erreur `installation-id-not-registered` efface conditionnellement ce seul FID s’il correspond encore à la valeur enregistrée ; elle ne révoque pas l’identité Mina.

- [ ] **Step 7: implémenter la GC sans confondre événement et média**

`gcAcknowledgedEvents` supprime un événement et son `eventRuntime` avant échéance seulement après ACK PC et cursors de tous les devices actifs ; sinon il utilise exclusivement `eventRuntime.cloudExpiresAt`, jamais l’ancien `expiresAt` signé. La lease initiale vaut `min(expiresAt, serverReceivedAt + 30 jours)` et chaque renouvellement validé peut repartir au plus 30 jours depuis le serveur. À expiry, la copie Firebase disparaît mais l’outbox Android et le PC restent canoniques. Le `syncLog` se compacte séparément, uniquement par préfixe contigu : la transaction supprime un lot déjà lu par tous les devices actifs ou arrivé en fin de lease, puis avance `syncState.compactedThrough` jusqu’à la dernière séquence réellement supprimée. Elle ne modifie jamais `highWatermark` ni le compteur privé et ne réutilise aucune séquence. Un cursor inférieur au watermark compacté déclenche snapshot ; un trou supérieur reste une erreur. Un objet attachment attend les `attachmentAcks` de tous les devices actifs ou 30 jours. Un snapshot ciblé est supprimé après ACK du target ou sept jours. Nettoyer aussi événements/rejections invalides et uploads orphelins après 24 heures, les pairing sessions/nonces non consommés à cinq minutes, les reçus de renouvellement consommés à 24 heures et les HMAC de rate-limit à leur TTL court. Chaque delete est idempotent, borné par lot et vérifie à nouveau les références avant suppression.

- [ ] **Step 8: vérifier et committer sans déployer**

Après les tests verts et avant `git add`, lancer uniquement les trois reviewers préalablement autorisés. Rejouer localement chaque finding contre le code ; corriger par test rouge puis vert, ou documenter la réfutation avec commande/stdout. Aucun finding n’est relayé sur simple affirmation et aucun commit n’est créé tant qu’un finding critique/élevé reproductible reste ouvert.

```powershell
Set-Location functions
npm ci
npm test
Set-Location ..
npx vitest run tests/firebase-owner-session.test.mjs tests/functions-chat-contract-parity.test.mjs
git add .gitignore functions firebase.json src/devices/firebase-owner-session.mjs src/devices/chat-pairing-service.mjs android/core/transport/src/main/kotlin/fr/mina/gateway/transport/ChatPairingClient.kt tests/firebase-owner-session.test.mjs tests/functions-chat-contract-parity.test.mjs
git commit -m "feat(firebase): add paired device auth and opaque wake functions"
```

---

### Task 12: Implémenter les adaptateurs Firebase Node et Android

**Files:**
- Create: `src/devices/firebase-chat-backend.mjs`
- Create: `src/devices/native-chat-sync.mjs`
- Modify: `src/backup/firebase-backup.mjs`
- Create: `android/core/transport/src/main/kotlin/fr/mina/gateway/transport/FirebaseChatDataSource.kt`
- Create: `android/core/transport/src/main/kotlin/fr/mina/gateway/transport/ChatCloudDataSource.kt`
- Create: `android/core/transport/src/main/kotlin/fr/mina/gateway/transport/FirebaseChatClientFactory.kt`
- Create: `android/core/transport/src/main/kotlin/fr/mina/gateway/transport/FirebaseAuthSession.kt`
- Create: `android/core/transport/src/main/kotlin/fr/mina/gateway/transport/FirebaseAppCheckProviderSelector.kt`
- Create: `android/core/transport/src/main/kotlin/fr/mina/gateway/transport/FirebaseRuntimeBootstrap.kt`
- Create: `android/core/transport/src/test/kotlin/fr/mina/gateway/transport/FirebaseChatDataSourceTest.kt`
- Create: `android/core/transport/src/test/kotlin/fr/mina/gateway/transport/FirebaseAppCheckProviderSelectorTest.kt`
- Create: `android/core/transport/src/test/kotlin/fr/mina/gateway/transport/FirebaseRuntimeBootstrapTest.kt`
- Create: `tests/firebase-chat-backend.test.mjs`
- Create: `tests/native-chat-sync.test.mjs`
- Modify: `tests/firebase-backup.test.mjs`

**Interfaces:**
- Node backend: `appendOwnEvent`, `relayVerifiedEvent`, `requestEventRenewalNonce`, `renewExpiredEvent`, `listenSyncLog`, `fetchSyncState`, `fetchEvent`, `writeCursor`, `putChunk`, `getChunk`, `publishStreamFrame`, `listenStreamFrames`.
- Android data source : mêmes opérations suspendables, sans exposer Firebase types au repository ; la factory exige la région Functions épinglée reçue pendant le pairing ou l’activation cloud.
- `native-chat-sync.start()`/`stop()`/`synchronizeOnce()`.

- [ ] **Step 1: écrire les tests rouges avec SDK injecté**

Tester config publique incomplète, région Functions absente/non épinglée/divergente, service credentials interdits, auth owner mismatch, UID principal différent du device doc, backup refusant un UID sans claims, backup acceptant uniquement `owner_id` attendu + `device_id=mina-brain` tout en conservant le chemin logique historique `owners/{ownerId}`, persistence PC autre que memory refusée, session Android restaurée par SDK mais jamais exposée, long offline avec recovery App Check signé puis refresh Auth, recovery d’un device révoqué refusé, signOut révocation, mapping epoch-ms↔Firestore Timestamp exact, `syncLog` ordre/doublon/trou, cursor derrière `compactedThrough`, relay d’un event direct étranger, append brain propre, listener reconnect, cursor global, chunk hash faux, RTDB frame expirée, sélection Play Integrity sideload/custom explicite sans downgrade automatique, App Check installé avant tout Auth/Firestore/Storage/Functions/FCM, provider custom pré-Auth sans dépendance au SDK Functions/Auth ni redirect/host/région libre, App Check absent en mode enforced, abort signal et absence de seconde file disque Firestore.

Simuler aussi >30 jours PC arrêté : l’append ordinaire expiré est refusé, le sync demande un nonce puis renouvelle les mêmes octets/`eventId`, reçoit une nouvelle séquence, avance le cursor et n’insère qu’une ligne Room/UI ; réponse réseau perdue puis retry exact reste idempotent, tandis qu’une réutilisation du nonce avec un autre digest échoue.

- [ ] **Step 2: charger les SDK paresseusement côté PC**

```js
async function defaultChatSdkLoader() {
  const [app, auth, firestore, database, storage, appCheck] = await Promise.all([
    import('firebase/app'), import('firebase/auth'), import('firebase/firestore'),
    import('firebase/database'), import('firebase/storage'), import('firebase/app-check'),
  ]);
  return { ...app, ...auth, ...firestore, ...database, ...storage, ...appCheck };
}
```

Aucun import Firebase statique dans le hot path de boot Electron. Réutiliser la validation de config publique de `firebase-backup.mjs` sans fusionner les stores backup et chat. Imposer `inMemoryPersistence` avant tout sign-in PC. Après `signInWithCustomToken`, lire `getIdTokenResult(user, true)` et autoriser d’après `claims.owner_id`/`claims.device_id`, jamais d’après `user.uid == ownerId` puisque l’UID Auth est désormais opaque et propre au principal. Le backup conserve son chemin logique `owners/{ownerId}/devices/{deviceId}` afin de ne pas déplacer les objets existants.

- [ ] **Step 3: implémenter l’adaptateur Android derrière une interface**

```kotlin
interface ChatCloudDataSource {
    suspend fun appendEvent(ownerId: String, event: ChatEvent): CloudReceipt
    suspend fun requestEventRenewalNonce(ownerId: String, eventId: String): RenewalChallenge
    suspend fun renewExpiredEvent(ownerId: String, envelopeBytes: ByteArray, challenge: RenewalChallenge): CloudReceipt
    fun observeSyncLog(ownerId: String, afterCloudSequence: Long): Flow<SequencedEventRef>
    suspend fun fetchSyncState(ownerId: String): SyncState
    suspend fun fetchEvent(ownerId: String, eventId: String): ChatEvent
    suspend fun updateCursor(ownerId: String, deviceId: String, cursor: ChatCursor)
    suspend fun putAttachmentChunk(path: String, bytes: ByteArray, sha256: String)
    suspend fun getAttachmentChunk(path: String, expectedSha256: String): ByteArray
}
```

Sur Firestore, `createdAtMs`/`expiresAtMs` deviennent des `Timestamp` et reviennent en `Long` sans perte ; toute précision sub-milliseconde ou divergence est refusée avant signature. Seul `syncLog.serverSequence` pilote le curseur cloud ; `eventRuntime.latestServerSequence` est un index courant, jamais une source de pagination. Avant chaque page, lire `syncState` : si le cursor est inférieur à `compactedThrough`, demander/importer un snapshot puis reprendre au watermark du snapshot. Sinon les références immuables sont lues dans l’ordre, l’event et l’éventuelle preuve de renouvellement sont vérifiés, Room déduplique sur `eventId`, puis seulement le cursor progresse. Un trou strictement au-dessus de `compactedThrough`, ou une référence dont la copie event a déjà expiré, bloque l’avancement et demande repair/snapshot ; rien n’est sauté silencieusement. Le log minimal peut survivre au ciphertext seulement jusqu’à compaction et ne prolonge pas la rétention du contenu.

Les implémentations Firebase restent dans `core:transport`; `core:chat` ne dépend que de l’interface. `FirebaseChatClientFactory` doit être appelé avant toute première utilisation Firestore et imposer le cache mémoire officiel :

```kotlin
db.firestoreSettings = firestoreSettings {
    setLocalCacheSettings(memoryCacheSettings {})
}
```

Room reste l’unique outbox durable. Un write Firestore n’est marqué `transported` qu’après succès serveur ; aucune réussite issue seulement d’un snapshot `metadata.isFromCache` n’est acceptée.

`FirebaseAuthSession` accepte la persistance privée gérée par le SDK Android parce que le téléphone doit publier PC arrêté ; aucun token n’est accessible via l’interface applicative. Révocation, identité Keystore perdue ou reset explicite appelle `FirebaseAuth.signOut()` avant effacement local. `FirebaseRuntimeBootstrap` laisse le direct fonctionner tant qu’aucune policy cloud signée n’existe ; dès qu’elle existe, il installe d’abord le provider App Check choisi, puis seulement crée/utilise Auth, Firestore, Storage, RTDB, Functions ou FCM. Le provider custom appelle `issueBootstrapAppCheck`/`issueCustomAppCheck` par un petit client OkHttp indépendant, vers l’URL HTTPS exacte construite depuis projectId + région signés ; redirects, autre host, autre région et cleartext sont refusés. Ce chemin pré-Auth n’instancie ni Firebase Functions, ni Firebase Auth et évite toute dépendance circulaire. `FirebaseAppCheckProviderSelector` autorise debug uniquement en build debug+émulateur, Play Integrity seulement si le profil sideload a été validé, sinon custom. Un échec ne rétrograde jamais silencieusement vers un provider plus faible.

- [ ] **Step 4: implémenter la priorité direct puis cloud**

`native-chat-sync` tente direct si heartbeat sain ; après échec confirmé, Android append le même événement Firebase. Il ne publie jamais les deux simultanément et accepte un ACK de l’un ou l’autre. Un retour direct n’efface pas l’outbox avant ACK PC. Côté PC, tout événement reçu uniquement en direct est passé à `relayVerifiedEvent`; une copie déjà créée par Android est acceptée seulement si son digest est identique. Si l’enveloppe directe est historique, le backend joint la preuve persistée du ledger et signe l’attestation PC de relay ; il n’essaie jamais la voie initiale. Ainsi le second téléphone reçoit le tour sans réécriture d’auteur. Si `expiresAtMs` est déjà historique côté Android, le direct utilise `event_renewal` de Task 6 ; le cloud n’appelle jamais `appendEvent` mais `requestEventRenewalNonce` puis `renewExpiredEvent`. Après une réponse Function ambiguë, lire d’abord `syncLog`/`eventRuntime` : une preuve/digest correspondant vaut succès ; sinon retenter byte-for-byte tant que le challenge vit, puis demander un nouveau challenge. Le repository déduplique sur `eventId` tout en avançant le nouveau `serverSequence`.

- [ ] **Step 5: vérifier et committer**

```powershell
npx vitest run tests/firebase-chat-backend.test.mjs tests/native-chat-sync.test.mjs tests/firebase-backup.test.mjs tests/integration/messaging-failover.test.mjs
android\gradlew.bat :core:transport:testDebugUnitTest
git add src/devices src/backup/firebase-backup.mjs android/core/transport tests
git commit -m "feat(sync): add firebase chat fallback adapters"
```

---

### Task 13: Brancher FCM, WorkManager et le fallback foreground Huawei

**Files:**
- Create: `android/app/src/main/kotlin/fr/mina/gateway/chat/MinaChatMessagingService.kt`
- Create: `android/app/src/main/kotlin/fr/mina/gateway/chat/ChatSyncWorker.kt`
- Create: `android/app/src/main/kotlin/fr/mina/gateway/chat/ChatSyncScheduler.kt`
- Create: `android/app/src/main/kotlin/fr/mina/gateway/chat/FcmRegistrationCoordinator.kt`
- Create: `android/app/src/main/kotlin/fr/mina/gateway/chat/HuaweiRealtimeCoordinator.kt`
- Modify: `android/app/src/main/kotlin/fr/mina/gateway/messaging/MinaGatewayService.kt`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Create: `android/app/src/test/kotlin/fr/mina/gateway/chat/ChatSyncSchedulerTest.kt`
- Create: `android/app/src/test/kotlin/fr/mina/gateway/chat/FcmRegistrationCoordinatorTest.kt`
- Create: `android/app/src/test/kotlin/fr/mina/gateway/chat/HuaweiRealtimeCoordinatorTest.kt`
- Create: `tests/android-chat-background-contract.test.mjs`

**Interfaces:**
- `ChatSyncScheduler.enqueueImmediate(reason, highWatermark)` utilise unique work `mina-chat-sync`.
- `ChatSyncWorker` appelle `repository.synchronizeOnce()` et mappe retry/failure sans perdre l’outbox.
- `HuaweiRealtimeCoordinator.mode()` → `fcm`, `foreground_listener`, `periodic_degraded`.

- [ ] **Step 1: écrire les tests rouges**

Prouver que `onMessageReceived` ne fait qu’une validation stricte de payload/cible + scheduling, qu’un highWatermark négatif/trop grand est refusé, que work est unique, que `onDeletedMessages` force un resync, que l’auto-init FCM/Analytics reste false et le support FID `register/unregister` est explicitement activé dans le manifest, qu’aucun `register()` n’arrive avant provider App Check + Auth actifs, que `onRegistered()` ne logue/persiste pas le FID applicativement et l’enregistre seulement après Auth/App Check, que `onUnregistered()` purge le matching serveur, que révocation maintient l’auto-init désactivé avant `unregister()` puis supprime le Firebase Installation ID, que contraintes réseau sont appliquées, que foreground n’est activé qu’avec consentement et que l’état dégradé est visible.

- [ ] **Step 2: déclarer les composants Android**

Ajouter le service FCM exporté false et `RECORD_AUDIO` seulement en Task 20. Dans `<application>`, fixer `firebase_messaging_auto_init_enabled=false`, `firebase_analytics_collection_enabled=false` et `firebase_messaging_installation_id_enabled=true` ; ce dernier autorise les appels explicites `register/unregister` mais l’auto-init reste coupé jusqu’à la policy. Conserver le foreground service existant `remoteMessaging` et ne créer aucun service caché sans notification visible.

- [ ] **Step 3: implémenter le handler FCM minimal**

```kotlin
override fun onMessageReceived(message: RemoteMessage) {
    val data = message.data
    if (data.keys != setOf("type", "ownerId", "deviceId", "highWatermark") || data["type"] != "sync") return
    if (data["ownerId"] != session.ownerId || data["deviceId"] != session.deviceId) return
    val watermark = data.getValue("highWatermark").toLongOrNull()
        ?.takeIf { it in 0L..9_007_199_254_740_991L }
        ?: return
    syncScheduler.enqueueImmediate("fcm", watermark)
}

override fun onDeletedMessages() {
    syncScheduler.enqueueImmediate("fcm_deleted", 0L)
}
```

`FcmRegistrationCoordinator` n’enregistre FCM qu’après `FirebaseRuntimeBootstrap` réussi, provider App Check installé et Auth de l’UID appareil active. L’auto-init reste `false`; il appelle explicitement `register()`, puis `onRegistered(fid)` remet ce FID en mémoire au registrar et l’enregistre par la callable self-only signée. Si Auth/App Check ne sont pas prêts, aucun register n’est lancé et seul `registration_pending` reste en mémoire jusqu’à la session. Aucun FID n’entre dans Room, DataStore, log ou notification. Pour un reset volontaire encore authentifié, appeler d’abord `unregisterFcmInstallation(fid)`, puis `setAutoInitEnabled(false)`, `unregister()`, attendre `onUnregistered(fid)`, `FirebaseInstallations.delete()` et enfin `signOut()`. Pour une révocation brain-only, la Function retire déjà le FID serveur avant que l’ordre arrive ; le téléphone exécute ensuite la partie locale même si ses tokens sont devenus invalides. Le test interdit qu’un redémarrage recrée silencieusement un FID avant un nouvel appairage. Le consentement système `POST_NOTIFICATIONS` de Task 18 contrôle l’affichage, pas la synchronisation opaque.

- [ ] **Step 4: implémenter les trois modes Huawei**

Détecter la disponibilité réelle de Firebase Messaging. Sans FCM, proposer explicitement le listener foreground ; s’il est refusé/tué, planifier le rattrapage périodique WorkManager à l’intervalle minimal Android de quinze minutes et publier `notifications_temps_reel_degradees`, jamais `connected` optimiste. Le constructeur peut retarder ce périodique : le texte UI ne promet aucune latence maximale.

- [ ] **Step 5: vérifier et committer**

```powershell
npx vitest run tests/android-chat-background-contract.test.mjs
android\gradlew.bat :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
git add android/app tests/android-chat-background-contract.test.mjs
git commit -m "feat(android): add resilient chat background synchronization"
```

---

### Task 14: Répliquer l’historique complet et gérer ACK/cursors/GC

**Files:**
- Create: `src/devices/chat-history-snapshot.mjs`
- Modify: `src/devices/native-chat-store.mjs`
- Modify: `src/devices/native-chat-sync.mjs`
- Create: `android/core/chat/src/main/kotlin/fr/mina/gateway/chat/HistorySnapshotImporter.kt`
- Create: `android/core/chat/src/main/kotlin/fr/mina/gateway/chat/storage/SnapshotStagingEntities.kt`
- Create: `android/core/chat/src/main/kotlin/fr/mina/gateway/chat/storage/ChatRoomMigrations.kt`
- Create: `android/core/chat/src/test/kotlin/fr/mina/gateway/chat/HistorySnapshotImporterTest.kt`
- Create: `android/core/chat/schemas/fr.mina.gateway.chat.storage.MinaChatDatabase/2.json`
- Create: `tests/chat-history-snapshot.test.mjs`
- Create: `tests/integration/native-chat-multi-device.test.mjs`

**Interfaces:**
- PC `exportSnapshot({ deviceId, afterByThread, cloudResumeSequence })` → manifeste + chunks chiffrés après avoir ingéré le `syncLog` jusqu’à ce resume point.
- Android `importSnapshot(manifest, chunks)` → `{ inserted, duplicates, threadCursors, cloudResumeSequence }` promu atomiquement après staging.
- `allActiveDevicesAcked(eventId)` pilote suppression anticipée cloud ; TTL 30 jours reste le filet final.

- [ ] **Step 1: écrire les tests rouges de réplication**

Scénarios : Samsung puis Huawei, appareil neuf vide, plusieurs fils aux séquences indépendantes, cursor inférieur à `compactedThrough` déclenchant snapshot, resume point inférieur au compacted watermark refusé, événement concurrent après le cut récupéré par `syncLog`, vrai trou au-dessus bloquant sans skip, renouvellement créant une nouvelle entrée `syncLog` mais aucune seconde ligne logique, historique de 10 001 événements paginé, inventaire de médias déclaré mais non encore transféré, snapshot interrompu/repris, process kill avant/après promotion, chunk altéré sans aucune ligne visible, duplicate local, tombstone, purge exclue, migration Room 1→2, appareil révoqué exclu des ACK attendus et nouvel appareil recevant toutes les anciennes époques autorisées.

- [ ] **Step 2: définir le manifeste snapshot**

```js
const snapshotManifest = Object.freeze({
  version: 1,
  snapshotId,
  targetDeviceId,
  cloudResumeSequence,
  threadRanges: [{ threadId, fromCanonicalSequence, toCanonicalSequence }],
  eventCount,
  chunkCount,
  chunkDigests,
  keyEpochs,
  createdAt,
  expiresAt,
  signature,
});
```

Le PC génère une clé AES-256 snapshot aléatoire, chiffre le manifeste et chaque chunk par AES-GCM avec nonces distincts, puis enveloppe cette clé via HKDF+AES-GCM sous la `deviceWrapKey` du device. L’enveloppe publique minimale contient `snapshotId`, `targetDeviceId`, `wrappedSnapshotKey`, nonce/tag/ciphertext du manifeste et signature PC ; les anciennes clés d’époque autorisées restent dans le manifeste chiffré. Chaque chunk contient au plus 500 événements ou 4 MiB avant chiffrement ; l’objet Storage final doit rester ≤5 MiB framing compris.

- [ ] **Step 3: importer dans une transaction bornée**

Valider signature, targetDeviceId, expiry, `cloudResumeSequence`, digests, plages sans trou et disponibilité des keyEpochs avant toute ligne visible. Le PC ne signe ce resume point qu’après avoir durablement ingéré toutes les entrées `syncLog` jusqu’à lui ; lors d’un repair de compaction, il doit être `>= compactedThrough` observé au début du snapshot. Déchiffrer/importer chunk par chunk dans des tables de staging ciphertext-only avec checkpoint et `snapshotId`. Après validation du compte global, des digests et de chaque plage, promouvoir les lignes vers `chat_events`, les positions par thread et `chat_device_state.cloudSequence=cloudResumeSequence` dans une seule transaction Room, puis supprimer le staging. Un crash reprend le staging ou le supprime ; il ne laisse jamais un historique partiel affiché. Tout log arrivé après le cut est ensuite rejoué normalement.

- [ ] **Step 4: implémenter la GC sans perte**

La Function ne supprime un événement avant TTL que si tous les devices actifs au moment du calcul ont un cursor supérieur ou un ACK explicite. Un appareil révoqué est exclu ; un appareil nouvellement enrôlé reçoit un snapshot PC et ne bloque pas la GC antérieure.

- [ ] **Step 5: vérifier et committer**

```powershell
npx vitest run tests/chat-history-snapshot.test.mjs tests/integration/native-chat-multi-device.test.mjs
android\gradlew.bat :core:chat:testDebugUnitTest
git add src/devices android/core/chat tests
git commit -m "feat(sync): replicate full encrypted history across devices"
```

---

### Task 15: Migrer l’activité vers Compose sans perdre la passerelle existante

**Gate UX recommandé :** avant cette vague UI, annoncer un seul `frontend-ux-reviewer` en lecture seule (Compose, accessibilité WCAG AA/TalkBack, responsive Samsung/Huawei, confidentialité et clarté des actions) et attendre la décision de Nasro. S’il est autorisé, le lancer après Task 19 sur le diff UI complet et avant son commit ; s’il est refusé, ne lancer aucun agent et consigner la revue inline sans prétendre à une revue spécialisée.

**Files:**
- Modify: `android/app/src/main/kotlin/fr/mina/gateway/MainActivity.kt`
- Create: `android/app/src/main/kotlin/fr/mina/gateway/MinaApplication.kt`
- Create: `android/app/src/main/kotlin/fr/mina/gateway/ui/MinaApp.kt`
- Create: `android/app/src/main/kotlin/fr/mina/gateway/ui/MinaNavigation.kt`
- Create: `android/app/src/main/kotlin/fr/mina/gateway/ui/MinaTheme.kt`
- Create: `android/feature/chat/src/main/kotlin/fr/mina/gateway/chat/ui/ConversationListScreen.kt`
- Create: `android/feature/chat/src/main/kotlin/fr/mina/gateway/chat/ui/ChatScreen.kt`
- Create: `android/feature/chat/src/main/kotlin/fr/mina/gateway/chat/ui/DeviceScreen.kt`
- Create: `android/feature/chat/src/main/kotlin/fr/mina/gateway/chat/ui/SettingsScreen.kt`
- Create: `android/feature/chat/src/androidTest/kotlin/fr/mina/gateway/chat/ui/MinaNavigationTest.kt`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Modify: `tests/android-bootstrap.test.mjs`

**Interfaces:**
- Routes stables : `conversations`, `chat/{threadId}`, `voice/{threadId}`, `devices`, `settings`, `gateway`.
- `MainActivity` devient `ComponentActivity` et ne contient plus de construction impérative de widgets.
- Le provisioning Telegram/SMS existant reste accessible sous `gateway`.

- [ ] **Step 1: écrire les tests rouges de navigation et préservation**

Tester destination initiale conversations, ouverture thread, back, process recreation, deep link notification interne, grande police, TalkBack labels, écran appareils strictement read-only avec gestion PC indiquée, et présence de tous les champs provisioning historiques dans la route gateway.

- [ ] **Step 2: activer Compose dans le module app**

```kotlin
android { buildFeatures { compose = true } }

dependencies {
    implementation(platform(libs.compose.bom))
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.navigation.compose)
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    androidTestImplementation(platform(libs.compose.bom))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
}
```

- [ ] **Step 3: créer le graphe sans logique métier**

```kotlin
@Composable
fun MinaNavigation(state: MinaAppState) {
    val nav = rememberNavController()
    NavHost(navController = nav, startDestination = "conversations") {
        composable("conversations") { ConversationListScreen(state.conversations, { nav.navigate("chat/$it") }) }
        composable("chat/{threadId}") { entry -> ChatScreen(entry.arguments!!.getString("threadId")!!, state.chat) }
        composable("voice/{threadId}") { entry -> VoiceRoute(entry.arguments!!.getString("threadId")!!) }
        composable("devices") { DeviceScreen(state.devices) }
        composable("settings") { SettingsScreen(state.settings) }
        composable("gateway") { GatewayProvisioningRoute(state.gateway) }
    }
}
```

- [ ] **Step 4: préserver le service et les permissions actuels**

`MinaApplication` compose les repositories paresseusement. `MinaGatewayService`, receivers SMS/boot, caméra et notification foreground restent déclarés. Aucune migration de secret n’est faite par le renderer Compose.

- [ ] **Step 5: vérifier et committer**

```powershell
npx vitest run tests/android-bootstrap.test.mjs tests/android-chat-bootstrap.test.mjs
android\gradlew.bat :feature:chat:connectedDebugAndroidTest :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
git add android tests/android-bootstrap.test.mjs
git commit -m "feat(android): add compose shell for native chat"
```

---

### Task 16: Livrer le chat texte, les statuts et le streaming Compose

**Files:**
- Modify: `android/core/chat/src/main/kotlin/fr/mina/gateway/chat/storage/ChatDao.kt`
- Modify: `android/core/chat/src/main/kotlin/fr/mina/gateway/chat/ChatRepository.kt`
- Create: `android/feature/chat/src/main/kotlin/fr/mina/gateway/chat/ui/ConversationListViewModel.kt`
- Create: `android/feature/chat/src/main/kotlin/fr/mina/gateway/chat/ui/ChatViewModel.kt`
- Create: `android/feature/chat/src/main/kotlin/fr/mina/gateway/chat/ui/ChatUiState.kt`
- Create: `android/feature/chat/src/main/kotlin/fr/mina/gateway/chat/ui/MessageBubble.kt`
- Create: `android/feature/chat/src/main/kotlin/fr/mina/gateway/chat/ui/MessageComposer.kt`
- Create: `android/feature/chat/src/main/kotlin/fr/mina/gateway/chat/ui/ConnectionBanner.kt`
- Create: `android/feature/chat/src/test/kotlin/fr/mina/gateway/chat/ui/ChatViewModelTest.kt`
- Create: `android/feature/chat/src/test/kotlin/fr/mina/gateway/chat/ui/ConversationListViewModelTest.kt`
- Create: `android/feature/chat/src/androidTest/kotlin/fr/mina/gateway/chat/ui/ChatScreenTest.kt`
- Create: `tests/integration/native-chat-text-roundtrip.test.mjs`

**Interfaces:**
- `ChatViewModel.sendText(text)`, `loadOlder(beforeSequence)`, `retry(eventId)`, `cancel(eventId)`, `stopGeneration(sourceEventId)`.
- `ConversationListViewModel.newThread()`, `rename(threadId,title)`, `archive`, `restore`, `tombstone`, `searchLocal(query)`.
- `ChatUiState` expose une fenêtre bornée de messages, curseur précédent, composer, transport, PC state, pending count et erreur localisée.
- Chunks d’une réponse partagent `sourceEventId` et sont fusionnés par séquence avant affichage.

- [ ] **Step 1: écrire les tests rouges ViewModel/UI**

Cas : trim mais conservation multiline, texte vide, limite 32 KiB calculée sur UTF-8 multioctet, double tap send, offline, PC arrêté, retry, stop, chunks hors ordre/dupliqués, final remplaçant le stream, pagination 50/fenêtre max 200 sans charger tout le fil, nouveau fil, titre chiffré, rename/archive/restore/tombstone réversible, aucune purge permanente depuis l’APK, recherche locale annulable sans index plaintext, composer sans autofill et avec apprentissage IME désactivé quand supporté, copie presse-papiers auto-effacée sans effacer une valeur remplacée par l’utilisateur, rotation écran, scroll stable et TalkBack annonçant le nouveau message sans relire tout l’historique.

- [ ] **Step 2: définir l’état UI immuable**

```kotlin
data class ChatUiState(
    val threadId: String,
    val messages: List<ChatMessageUi>,
    val beforeCanonicalSequence: Long?,
    val draft: String,
    val sending: Boolean,
    val transport: TransportUi,
    val pcState: PcStateUi,
    val pendingCount: Int,
    val errorCode: String?,
)

enum class PcStateUi { ONLINE, OFFLINE, LOCKED, PROCESSING, DEGRADED }
enum class TransportUi { DIRECT, FIREBASE, LOCAL_QUEUE, UNAVAILABLE }
```

- [ ] **Step 3: persister avant de vider le composer**

`sendText` appelle `repository.createTextMessage`; seulement après transaction réussie, le draft devient vide. Le réseau est déclenché ensuite. Un échec Room conserve le draft et affiche `stockage_local_indisponible`.

- [ ] **Step 4: rendre les statuts honnêtes**

Mapper exactement : `local_pending → En attente d’envoi`, `cloud_queued → En attente du PC`, `pc_received → Reçu`, `processing → Mina réfléchit`, `response_streaming → Réponse en cours`, `completed → Livré`, `retry_wait → Nouvelle tentative`, `failed_final → Échec`.

- [ ] **Step 5: livrer le cycle des conversations sans index plaintext**

Les titres et actions de fil sont des événements chiffrés. La liste charge 50 messages à la fois et conserve au plus 200 objets déchiffrés dans l’état UI ; le reste demeure ciphertext en Room. `searchLocal` lit les enveloppes par pages de 100, déchiffre en mémoire, borne à 500 résultats, respecte l’annulation coroutine et efface les buffers ; aucune colonne FTS/plaintext n’est créée. L’action APK « Masquer » exige une confirmation, émet `thread.tombstoned`, masque immédiatement avec état pending/undo puis se synchronise ; elle reste réversible par `restore`. La purge/oubli définitif n’est pas exposée dans l’APK et reste `critical_local_only` sur le PC. La copie utilise `ClipData` marquée sensible sur API compatible et efface après 60 secondes seulement si le clip courant correspond encore au digest posé par Mina.

- [ ] **Step 6: grouper le streaming distant**

Le PC publie au plus un chunk toutes les 350 ms sur RTDB ; le direct peut publier plus finement. Android ordonne par séquence, ignore les doublons et remplace les chunks par l’événement final durable.

- [ ] **Step 7: vérifier et committer**

```powershell
npx vitest run tests/integration/native-chat-text-roundtrip.test.mjs
android\gradlew.bat :feature:chat:testDebugUnitTest :feature:chat:connectedDebugAndroidTest
git add android/core/chat android/feature/chat tests/integration/native-chat-text-roundtrip.test.mjs
git commit -m "feat(android): deliver native encrypted text conversations"
```

---

### Task 17: Ajouter photos, caméra, documents et transferts repris par chunk

**Files:**
- Create: `android/core/chat/src/main/kotlin/fr/mina/gateway/chat/attachments/AttachmentPolicy.kt`
- Create: `android/core/chat/src/main/kotlin/fr/mina/gateway/chat/attachments/EncryptedAttachmentStore.kt`
- Create: `android/core/chat/src/main/kotlin/fr/mina/gateway/chat/attachments/AttachmentTransfer.kt`
- Create: `android/core/chat/src/main/kotlin/fr/mina/gateway/chat/attachments/ChatTransferPolicy.kt`
- Create: `android/core/chat/src/main/kotlin/fr/mina/gateway/chat/attachments/SecureAttachmentOpener.kt`
- Create: `android/feature/chat/src/main/kotlin/fr/mina/gateway/chat/ui/AttachmentPicker.kt`
- Modify: `android/feature/chat/src/main/kotlin/fr/mina/gateway/chat/ui/MessageComposer.kt`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Create: `android/app/src/main/res/xml/chat_file_paths.xml`
- Create: `src/devices/chat-attachment-intake.mjs`
- Modify: `src/devices/chat-history-snapshot.mjs`
- Modify: `android/core/chat/src/main/kotlin/fr/mina/gateway/chat/HistorySnapshotImporter.kt`
- Create: `tests/chat-attachment-intake.test.mjs`
- Create: `android/core/chat/src/test/kotlin/fr/mina/gateway/chat/attachments/AttachmentPolicyTest.kt`
- Create: `android/core/chat/src/androidTest/kotlin/fr/mina/gateway/chat/attachments/AttachmentTransferTest.kt`

**Interfaces:**
- `AttachmentPolicy.inspect(uri, metadata)` → allow/refuse avec code stable.
- `EncryptedAttachmentStore.create(uri, epoch, attachmentId)` → manifeste chiffré + chunks.
- `AttachmentTransfer.resume(attachmentId)` ne renvoie que les chunks manquants.
- PC `intake({ manifest, chunkReader, sourceEventId })` → quarantaine ou média vision, sans exécution.

- [ ] **Step 1: écrire les tests rouges de bornes et reprise**

Tester tous les MIME autorisés, extension/MIME contradictoires, executable/APK/script/archive refusé, image 25 MiB, audio 50 MiB, document 100 MiB, total 120 MiB, réseau mesuré avec média >10 MiB différé/override one-shot, texte/contrôle jamais bloqués par cette policy, chunk plaintext 4 MiB, objet chiffré >5 MiB refusé, disque plein, permission URI perdue, hash faux, reprise au chunk 3, ACK seulement après vérification, nouvel appareil reconstruisant tous les médias depuis le PC après expiration cloud, nom jamais présent dans le chemin local/cloud, ouverture reçue sans path traversal, grant URI read-only ciblé, cache expiré nettoyé et partage externe exigeant confirmation.

- [ ] **Step 2: implémenter l’allowlist exacte**

```kotlin
val allowedMimeTypes = setOf(
    "image/jpeg", "image/png", "image/webp", "image/heic",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain", "text/markdown", "text/csv", "application/json",
    "audio/mp4", "audio/ogg", "audio/opus", "audio/wav",
)
```

Inspecter magic bytes côté PC après déchiffrement ; MIME déclaré n’est jamais une preuve suffisante.

- [ ] **Step 3: utiliser SAF et Camera Activity Result**

Documents via `OpenDocument` avec permission persistable en lecture. Photos via `GetContent`; capture via `TakePicture` et `FileProvider` non exporté. Réutiliser la capacité caméra existante sans exposer son flux live à Firebase.

Par défaut, `ChatTransferPolicy` autorise texte/ACK/control sur tout réseau disponible mais diffère une pièce jointe >10 MiB sur réseau mesuré. L’UI peut autoriser une seule fois ce transfert après afficher taille/coût potentiel ; ce choix n’élargit pas silencieusement la préférence globale.

- [ ] **Step 4: chiffrer et hacher en streaming**

Ne jamais charger 100 MiB en mémoire. Lire au plus 4 MiB plaintext, dériver la clé attachment, AES-GCM, ajouter nonce/tag/framing, vérifier que l’objet final reste ≤5 MiB, calculer SHA-256 du ciphertext, écrire un fichier local opaque, effacer les buffers, puis uploader. Le manifeste contient les digests de tous les chunks et la taille totale.

- [ ] **Step 5: intégrer la quarantaine PC**

Images vont au pipeline vision uniquement après demande utilisateur ; documents vont au `document-intake`/quarantaine existant. Le contenu reste une donnée non fiable et aucune instruction embarquée ne déclenche un outil.

- [ ] **Step 6: compléter l’historique et les ACK médias**

Le PC conserve toujours l’original chiffré validé afin de reconstruire un téléphone après expiration Storage. Étendre le snapshot avec l’inventaire `attachmentId + taille + digests`. Android exige `taille restante + 2 chunks + 256 MiB` libres, écrit `attachmentAcks/{attachmentId_deviceId}` uniquement après réception de tous les chunks, validation des digests, déchiffrement test et fsync local ; la GC cloud attend les ACK de tous les appareils actifs ou le TTL, puis le PC reste la source de rattrapage. Manque d’espace : aucun ACK et aucune éviction silencieuse. L’UI distingue `historique_messages_complet` de `medias_en_attente:N`.

`SecureAttachmentOpener` déchiffre image/audio par stream. Pour un viewer externe, il crée dans `noBackupFilesDir/open-cache` un nom aléatoire, borne le TTL à dix minutes, utilise un `FileProvider` non exporté et accorde uniquement `FLAG_GRANT_READ_URI_PERMISSION` au package choisi. Afficher un avertissement/confirmation car Mina ne contrôle plus la copie après remise à l’autre application. Révoquer le grant et nettoyer au timeout, retour d’Activity et démarrage suivant ; ne jamais revendiquer une suppression physique garantie sur flash.

- [ ] **Step 7: vérifier et committer**

```powershell
npx vitest run tests/chat-attachment-intake.test.mjs tests/document-intake.test.mjs tests/document-quarantine.test.mjs
android\gradlew.bat :core:chat:testDebugUnitTest :core:chat:connectedDebugAndroidTest :feature:chat:connectedDebugAndroidTest
git add android src/devices/chat-attachment-intake.mjs tests/chat-attachment-intake.test.mjs
git commit -m "feat(chat): add encrypted resumable attachments"
```

---

### Task 18: Ajouter notifications privées et réglages de confidentialité

**Files:**
- Create: `android/app/src/main/kotlin/fr/mina/gateway/chat/ChatNotificationManager.kt`
- Create: `android/app/src/main/kotlin/fr/mina/gateway/chat/ChatPrivacySettings.kt`
- Create: `android/app/src/main/kotlin/fr/mina/gateway/chat/ChatSessionLock.kt`
- Create: `android/app/src/main/kotlin/fr/mina/gateway/chat/NotificationPermissionCoordinator.kt`
- Modify: `android/app/src/main/kotlin/fr/mina/gateway/chat/MinaChatMessagingService.kt`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Modify: `android/feature/chat/src/main/kotlin/fr/mina/gateway/chat/ui/SettingsScreen.kt`
- Modify: `android/feature/chat/src/main/kotlin/fr/mina/gateway/chat/ui/ChatScreen.kt`
- Create: `android/app/src/test/kotlin/fr/mina/gateway/chat/ChatNotificationManagerTest.kt`
- Create: `android/app/src/test/kotlin/fr/mina/gateway/chat/NotificationPermissionCoordinatorTest.kt`
- Create: `tests/android-chat-privacy-contract.test.mjs`

**Interfaces:**
- Canaux Android : `mina_chat_messages`, `mina_chat_approvals`, `mina_gateway_status`.
- `ChatPrivacySettings` : `showLockScreenPreview=false`, `secureChatWindow=true`, `huaweiForegroundConsent=false` par défaut.
- Notification ouvre `chat/{threadId}` via PendingIntent immutable.

- [ ] **Step 1: écrire les tests rouges de confidentialité**

Prouver qu’une notification par défaut contient seulement `Mina a répondu`, qu’aucun plaintext/digest/filename n’apparaît dans extras, que les approval notifications restent `PRIVATE`, que PendingIntent est explicite+immutable, que `FLAG_SECURE` protège chat/approval quand activé et que verrouillage écran/révocation purge les buffers UI déchiffrés sans supprimer le ciphertext Room. Sur API 33+, `POST_NOTIFICATIONS` n’est demandé qu’après explication dans une UI visible, jamais au premier boot/pré-pairing ; refus = chat/sync fonctionnels, état `notifications_refusees`, aucun prompt en boucle. API 29–32 ne demande pas cette permission runtime.

- [ ] **Step 2: implémenter les defaults fail-private**

```kotlin
data class ChatPrivacySettings(
    val showLockScreenPreview: Boolean = false,
    val secureChatWindow: Boolean = true,
    val huaweiForegroundConsent: Boolean = false,
)
```

Stocker les réglages non sensibles dans DataStore ; aucune clé ni message n’y entre.

Déclarer `android.permission.POST_NOTIFICATIONS` dans le manifest. `NotificationPermissionCoordinator` demande la permission seulement sur action explicite après pairing, distingue `not_required`, `granted`, `denied` et `denied_permanently`, et dirige vers les réglages système uniquement sur action utilisateur. Le refus ne désactive ni Room, ni direct, ni FCM data-only ; il supprime seulement les notifications visibles.

Activer un aperçu exige un écran d’avertissement : le texte déchiffré peut alors être conservé par l’historique de notifications Android ou transmis à un appareil compagnon. Les approbations, secrets détectés et noms de fichiers restent toujours sans aperçu, quel que soit le réglage. L’écran confidentialité rappelle honnêtement que `FLAG_SECURE`, l’absence d’autofill et les hints IME ne neutralisent pas un clavier tiers ni un service d’accessibilité auquel Android a accordé l’accès.

`ChatSessionLock` observe le verrouillage appareil et le lifecycle. À verrouillage/révocation, il annule recherche/stream, remplace l’état Compose par `LOCKED`, écrase les `ByteArray` maîtrisés et retire toutes les références aux `String` plaintext des ViewModel (sans prétendre garantir l’effacement physique de chaînes JVM immuables). Le déverrouillage recharge depuis Room après contrôle de session ; aucune copie plaintext durable n’est créée.

- [ ] **Step 3: séparer réveil et affichage**

FCM programme le sync. Une notification utilisateur n’est créée qu’après insertion locale vérifiée d’un nouvel événement déchiffrable. Ainsi une payload FCM forgée ne peut pas injecter un texte affiché.

- [ ] **Step 4: vérifier et committer**

```powershell
npx vitest run tests/android-chat-privacy-contract.test.mjs
android\gradlew.bat :app:testDebugUnitTest :app:lintDebug
git add android tests/android-chat-privacy-contract.test.mjs
git commit -m "feat(android): add private native chat notifications"
```

---

### Task 19: Remplacer l’approbation Telegram-only par un adaptateur APK biométrique

**Gate migration obligatoire :** avant d’écrire/appliquer `003-native-chat-approvals.sql`, annoncer un follow-up du `db-migration-reviewer` autorisé en Task 4 — ou un reviewer unique de remplacement avec nouvelle autorisation — couvrant replayabilité 002→003, contraintes/indexes, rollback/sauvegarde et absence de plaintext. Attendre le feu vert ; aucun SQL utilisateur n’est appliqué automatiquement.

**Files:**
- Modify: `src/approvals/approval-contracts.mjs`
- Create: `src/devices/migrations/003-native-chat-approvals.sql`
- Modify: `src/devices/chat-database.mjs`
- Create: `src/approvals/approval-store.mjs`
- Modify: `src/approvals/remote-approval-service.mjs`
- Create: `src/approvals/app-approval-adapter.mjs`
- Modify: `src/safety/computer-action-authorizer.mjs`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Create: `tests/approval-store.test.mjs`
- Create: `tests/app-approval-adapter.test.mjs`
- Modify: `tests/remote-approval-service.test.mjs`
- Modify: `tests/computer-action-authorizer.test.mjs`
- Create: `android/core/chat/src/main/kotlin/fr/mina/gateway/chat/approval/ApprovalSigner.kt`
- Create: `android/core/chat/src/main/kotlin/fr/mina/gateway/chat/approval/ApprovalRequestVerifier.kt`
- Create: `android/core/chat/src/main/kotlin/fr/mina/gateway/chat/approval/TargetedApprovalCrypto.kt`
- Create: `android/feature/chat/src/main/kotlin/fr/mina/gateway/chat/ui/ApprovalCard.kt`
- Create: `android/feature/chat/src/main/kotlin/fr/mina/gateway/chat/ui/ApprovalViewModel.kt`
- Create: `android/core/chat/src/test/kotlin/fr/mina/gateway/chat/approval/ApprovalSignerTest.kt`
- Create: `android/core/chat/src/test/kotlin/fr/mina/gateway/chat/approval/ApprovalRequestVerifierTest.kt`
- Create: `android/feature/chat/src/androidTest/kotlin/fr/mina/gateway/chat/ui/ApprovalCardTest.kt`

**Interfaces:**
- PC `request` produit une demande durable avec `risk`, `locality`, digest canonique, nonce et signature PC.
- `decideFromDevice({ approvalId, deviceId, decision, callbackDigest, signature, authMethod, signedAtMs })`.
- Android vérifie la signature PC épinglée avant affichage, puis `ApprovalSigner.sign(decisionEnvelope, risk)` couvre décision, digest, méthode réelle et date.
- Telegram adapter reste compatible mais ne reçoit aucun droit supplémentaire.

- [ ] **Step 1: écrire les tests rouges de matrice de risque**

Tester ordinary simple, refus signé, demande sans signature PC, clé PC différente, sensitive signée par la clé ordinaire refusée, `authMethod` modifiée après signature, device non capable, viewer incapable de déchiffrer les détails/marker secret, mauvaise cible, deux enveloppes ciblées avec consommation globale first-wins, signature DER fausse/non minimale, digest/state/policy modifiés, clock skew, expiry >5 min, replay, double consume, restart PC, migration 002→003, aucune action plaintext en SQLite, touch obscurci/partiellement obscurci refusé, overlay masqué sur API compatible, `local_only`, paiement/secret/MFA/purge définitive et arrêt d’urgence.

- [ ] **Step 2: rendre les demandes durables**

Ajouter la migration immuable `003-native-chat-approvals.sql` sans toucher à `001/002`. La table `chat_approvals` contient `request_ciphertext`, digest, deviceId attendu nullable, keyId attendu, status, expiry en epoch ms, signature/méthode nullable et timestamps ; aucun domaine, destinataire, ressource ou détail d’action n’est stocké en clair. `approvalStore` chiffre/déchiffre avec une clé domain-separated issue du coffre, est injecté dans `remote-approval-service` et remplace la `Map` sans casser les méthodes Telegram.

- [ ] **Step 3: étendre le contrat strict**

```js
const riskSchema = z.enum(['read_only', 'ordinary_remote', 'sensitive_remote', 'critical_local_only']);

const appApprovalSchema = z.strictObject({
  approvalId: z.string().uuid(),
  deviceId: z.string().regex(/^[A-Za-z0-9._:-]{1,160}$/u),
  decision: z.enum(['approve', 'deny']),
  callbackDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  signature: z.string().min(12).max(96), // base64 standard d’un DER P-256 de 8..72 octets
  authMethod: z.enum(['simple', 'biometric_strong', 'device_credential']),
  signedAtMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
```

La signature DER appareil porte sur l’encodage binaire domain-separated `MINA_APPROVAL_DECISION_V1`, `approvalId`, `deviceId`, `decision`, `callbackDigest`, `authMethod` et `signedAtMs`. Le digest de requête couvre déjà nonce, expiry, état et policy. Une valeur callback modifiée après le prompt invalide la signature. `deny` reste toujours possible avec le bouton explicite et la clé ordinaire ; seule une décision `approve` sur `sensitive_remote` exige la clé publique sensible attendue et auth-per-use.

Avant publication, sélectionner un device actif possédant la capacité. Dériver `HKDF(deviceWrapKey, approvalId, "mina-approval-payload-v1")`, chiffrer les détails par AES-GCM avec AAD `approvalId + targetDeviceId + requestDigest + expiry`, puis placer seulement cette enveloppe intérieure dans l’événement conversation. `TargetedApprovalCrypto` refuse toute autre cible. Si plusieurs devices sont proposés, créer une enveloppe par device mais conserver un unique état PC : la première décision valide consomme l’approbation et toutes les autres deviennent `already_consumed`.

- [ ] **Step 4: brancher le broker existant**

`computer-action-authorizer.assess` reste l’entrée. Pour `ordinary_remote`/`sensitive_remote`, créer l’ApprovalRequest à partir de `request.digest`, ressource, capability, état observé et effet attendu, puis la signer avec la clé PC épinglée lors du pairing. L’APK refuse toute carte dont la signature PC, le digest ou l’expiry échoue. Après signature APK, `approvalVerifier.verify` revalide décision, identité, authMethod, état/policy puis `capabilityBroker.grantConfirmation` consomme exactement ce digest. Une décision `deny` clôt sans grant. `critical_local_only` ne crée jamais d’action approve dans l’APK.

- [ ] **Step 5: créer les clés Android adaptées à API 29+**

- clé ordinaire ES256 sans user auth, utilisable seulement après bouton explicite ;
- clé sensible ES256 avec user authentication requise ;
- API 30+ : paramètres `BIOMETRIC_STRONG | DEVICE_CREDENTIAL` ;
- API 29 Huawei : fenêtre d’authentification Keystore de 30 secondes après BiometricPrompt/credential, puis signature immédiate ;
- alias séparé par usage et rotation lors de révocation/réinstallation.

Afficher la méthode réellement obtenue. Ne jamais présenter `biometric_strong` si le fallback credential a été utilisé.

- [ ] **Step 6: rendre la carte non ambiguë**

Afficher domaine, action exacte, ressource/destinataire, état actuel, effet attendu, données divulguées, risque et compte à rebours. Le bouton sensible lance BiometricPrompt ; le bouton `local_only` est absent et remplacé par « Confirmation requise sur le PC ». Déclarer `android.permission.HIDE_OVERLAY_WINDOWS`. L’écran approval garde `FLAG_SECURE`, appelle `setHideOverlayWindows(true)` sur API 31+ uniquement pendant la carte sensible puis restaure l’état à la sortie, et refuse les événements tactiles marqués obscurcis/partiellement obscurcis sur API 29+ ; aucune décision n’est signée depuis un callback UI non visible ou après changement d’état/lifecycle.

- [ ] **Step 7: vérifier et committer**

Après les tests verts, lancer le `frontend-ux-reviewer` uniquement s’il a été explicitement autorisé en Task 15. Reproduire ses findings sur les deux profils d’écran, corriger les défauts prouvés avec tests UI et relancer les gates avant `git add`.

```powershell
npx vitest run tests/chat-database-migrations.test.mjs tests/approval-store.test.mjs tests/app-approval-adapter.test.mjs tests/remote-approval-service.test.mjs tests/approval-verifier.test.mjs tests/computer-action-authorizer.test.mjs tests/telegram-approval-adapter.test.mjs
android\gradlew.bat :core:chat:testDebugUnitTest :feature:chat:connectedDebugAndroidTest
npm test
git add src/approvals src/devices/migrations/003-native-chat-approvals.sql src/devices/chat-database.mjs src/safety/computer-action-authorizer.mjs android/app/src/main/AndroidManifest.xml android/core/chat android/feature/chat tests
git commit -m "feat(approvals): add biometric digest bound app decisions"
```

---

### Task 20: Ajouter notes vocales et push-to-talk asynchrones

**Files:**
- Create: `android/feature/voice/src/main/kotlin/fr/mina/gateway/voice/VoiceNoteRecorder.kt`
- Create: `android/feature/voice/src/main/kotlin/fr/mina/gateway/voice/VoiceNoteViewModel.kt`
- Create: `android/feature/voice/src/main/kotlin/fr/mina/gateway/voice/VoiceNoteScreen.kt`
- Modify: `android/feature/chat/src/main/kotlin/fr/mina/gateway/chat/ui/MessageComposer.kt`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Create: `android/feature/voice/src/test/kotlin/fr/mina/gateway/voice/VoiceNoteRecorderTest.kt`
- Create: `android/feature/voice/src/androidTest/kotlin/fr/mina/gateway/voice/VoiceNoteScreenTest.kt`
- Create: `src/messaging/native-chat-voice-note.mjs`
- Create: `tests/native-chat-voice-note.test.mjs`

**Interfaces:**
- `VoiceNoteRecorder.start(encryptedSink)`, `stop()`, `cancel()`.
- `VoiceNoteViewModel.beginPushToTalk()`, `endPushToTalk()`, `startNote()`, `stopAndSend()`, `cancel()`.
- PC `processVoiceNote({ sourceEventId, attachment, threadId, signal })` transcrit puis passe par le même service conversationnel.

- [ ] **Step 1: écrire les tests rouges**

Tester permission refusée, micro système désactivé, audio focus refusé/perdu puis abandonné sur tous les chemins, start/stop, double stop, capture <300 ms annulée, limite 30 minutes/50 MiB (première borne atteinte), buffer court/overrun, passage app en arrière-plan annulant proprement la capture, appel téléphonique interrompant le micro, cancel supprimant les chunks chiffrés, aucune extension/fichier PCM/WAV/M4A plaintext dans le sandbox, PC arrêté, retry et transcription idempotente.

- [ ] **Step 2: déclarer et demander `RECORD_AUDIO` au moment de l’usage**

Ajouter la permission manifeste. Aucun accès micro au boot. Dans la première release, le recorder ne démarre que depuis une Activity visible, acquiert explicitement l’audio focus, l’abandonne sur chaque sortie et s’annule si l’Activity passe en arrière-plan ou si focus/appel/micro système l’interrompt ; ne pas créer de foreground service microphone caché. Un vrai enregistrement background exigerait une tâche séparée, notification persistante et permissions/type de service dédiés.

- [ ] **Step 3: chiffrer le PCM pendant la capture sur API 29+**

```kotlin
val minBuffer = AudioRecord.getMinBufferSize(
    16_000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
)
val recorder = AudioRecord(
    MediaRecorder.AudioSource.VOICE_RECOGNITION,
    16_000,
    AudioFormat.CHANNEL_IN_MONO,
    AudioFormat.ENCODING_PCM_16BIT,
    maxOf(minBuffer * 2, 32 * 1024),
)
```

Lire sur un dispatcher I/O dédié dans un buffer borné, grouper au maximum une seconde de PCM, chiffrer immédiatement chaque chunk via `EncryptedAttachmentStore` et écraser le buffer. Le manifeste chiffré indique PCM16/mono/16 kHz et les digests ; aucun fichier audio plaintext temporaire n’est créé. Le PC reconstruit un flux WAV virtuel ou transcode en mémoire bornée pour le STT.

- [ ] **Step 4: distinguer note et PTT**

PTT démarre à `ACTION_DOWN` et s’arrête à `ACTION_UP/CANCEL`; note classique possède boutons stop/cancel. Les deux produisent `message.voice.created` et fonctionnent via Firebase. Aucun RTDB audio continu.

- [ ] **Step 5: traiter côté PC une seule fois**

Le service réclame le ledger, reconstruit l’audio vérifié, appelle le STT injecté, mémorise le texte avec provenance voice-note puis génère la réponse. Une redelivery réutilise transcription/réponse persistées.

- [ ] **Step 6: vérifier et committer**

```powershell
npx vitest run tests/native-chat-voice-note.test.mjs tests/audio-normalizer.test.mjs tests/deepgram-stt.test.mjs
android\gradlew.bat :feature:voice:testDebugUnitTest :feature:voice:connectedDebugAndroidTest :app:lintDebug
git add android src/messaging/native-chat-voice-note.mjs tests/native-chat-voice-note.test.mjs
git commit -m "feat(voice): add asynchronous encrypted voice messages"
```

---

### Task 21: Ajouter la conversation vocale live sur LAN/VPN

**Files:**
- Create: `android/feature/voice/src/main/kotlin/fr/mina/gateway/voice/LiveAudioCapture.kt`
- Create: `android/feature/voice/src/main/kotlin/fr/mina/gateway/voice/LiveVoiceSession.kt`
- Create: `android/feature/voice/src/main/kotlin/fr/mina/gateway/voice/LiveVoiceScreen.kt`
- Modify: `android/core/transport/src/main/kotlin/fr/mina/gateway/transport/DirectChatClient.kt`
- Create: `src/voice/native-chat-live-bridge.mjs`
- Modify: `src/ui/main.mjs`
- Create: `android/feature/voice/src/test/kotlin/fr/mina/gateway/voice/LiveVoiceSessionTest.kt`
- Create: `tests/native-chat-live-bridge.test.mjs`
- Create: `tests/integration/native-chat-live-control.test.mjs`

**Interfaces:**
- Android `LiveVoiceSession.start(threadId)`, `pushPcm(frame)`, `pause()`, `resume()`, `stop()`, `bargeIn()`.
- PC `createNativeChatLiveBridge({ startVoiceSession, stopSpeech, publishAudio, audit, clock })`.
- Direct frames : `live.open`, `live.audio`, `live.pause`, `live.resume`, `live.stop`, `live.barge_in`, `live.closed`.

- [ ] **Step 1: écrire les tests rouges de contrôle prioritaire**

Tester direct absent, ouverture, PCM hors ordre, jitter, backpressure, pause, reprise, stop pendant capture, stop pendant lecture, barge-in, perte réseau, arrêt d’urgence, audio focus/micro concurrent et conversion en note après coupure.

- [ ] **Step 2: capturer PCM16 mono 16 kHz par frames bornées**

Utiliser `AudioRecord` avec buffer contrôlé. `live.open` est signé par la clé appareil/PC et lie sessionId, threadId, deux nonces, époque, paramètres audio, quatre préfixes de nonce et expiry. Chaque frame contient sessionId, sequence, timestamp monotone, 20 à 100 ms de PCM chiffré, nonce et tag ; l’AEAD + la séquence assurent l’intégrité sans ECDSA coûteuse sur chaque frame. Maximum 64 frames en mémoire ; au-delà, abandonner les frames audio les plus anciennes mais jamais un contrôle.

- [ ] **Step 3: chiffrer avec une clé de session dérivée**

Dériver d’abord `root = HKDF-SHA256(ikm=epochKey, salt=SHA256(transcript live.open signé), info="MINA_LIVE_ROOT_V1", len=32)`, puis quatre clés HKDF domain-separated : `phone_to_pc_audio`, `pc_to_phone_audio`, `phone_to_pc_control`, `pc_to_phone_control`. Chaque sous-clé possède un préfixe aléatoire 32 bits lié au transcript et une séquence uint64 monotone ; le nonce vaut `prefix || sequence` (12 octets). Toute réutilisation ou divergence ferme la session. L’AAD binaire couvre type, direction, sessionId, sequence et timestamp. Les frames control ont une file prioritaire et leur propre sous-clé/compteur, jamais seulement le même AEAD avec un label différent.

- [ ] **Step 4: relier au moteur vocal existant**

Le bridge appelle l’interface déjà utilisée par Gemini Live/Deepgram, sans importer un provider dans le transport. Les commandes `pause`, `stop` et barge-in appellent les mêmes mécanismes `speech-stop` que l’UI PC. L’arrêt d’urgence ferme d’abord la session, puis vide les files audio.

- [ ] **Step 5: afficher honnêtement la disponibilité**

Le bouton live est actif seulement si PC online + direct healthy + capacité `voice.live`. Sur Firebase seul : « Live nécessite le LAN ou le VPN privé » et propositions PTT/note. Aucun stream audio via Firestore/RTDB.

- [ ] **Step 6: vérifier et committer**

```powershell
npx vitest run tests/native-chat-live-bridge.test.mjs tests/integration/native-chat-live-control.test.mjs tests/emergency-stop-v2.test.mjs tests/speech-stop.test.mjs
android\gradlew.bat :feature:voice:testDebugUnitTest :feature:voice:connectedDebugAndroidTest
git add android src/voice/native-chat-live-bridge.mjs src/ui/main.mjs tests
git commit -m "feat(voice): add direct live conversation controls"
```

---

### Task 22: Implémenter révocation, rotation de clés et réparation des files

**Files:**
- Create: `src/devices/chat-device-revocation.mjs`
- Create: `src/devices/chat-repair-service.mjs`
- Create: `src/devices/chat-thread-purge.mjs`
- Modify: `src/devices/trusted-chat-device-store.mjs`
- Modify: `src/devices/native-chat-store.mjs`
- Modify: `functions/src/revocation.mjs`
- Modify: `functions/src/gc.mjs`
- Create: `android/core/chat/src/main/kotlin/fr/mina/gateway/chat/DeviceRevocationHandler.kt`
- Create: `tests/chat-device-revocation.test.mjs`
- Create: `tests/chat-repair-service.test.mjs`
- Create: `tests/chat-thread-purge.test.mjs`
- Create: `android/core/chat/src/test/kotlin/fr/mina/gateway/chat/DeviceRevocationHandlerTest.kt`

**Interfaces:**
- `revoke({ deviceId, reason, confirmedLocally })` → nouvelle époque + propagation cloud.
- `repair.scan()` → diagnostics redacted ; `repair.retry(eventId)` et `repair.deadLetter(eventId, reason)`.
- `purgeThread({ threadId, confirmedLocally })` reste PC-only, oublie mémoire/médias puis émet `thread.purged` signé.
- Android `onDeviceRevoked(event)` verrouille le chat, efface tokens/keys wrappées concernées et conserve uniquement diagnostics non sensibles.

- [ ] **Step 1: écrire les tests rouges**

Cas : révocation sans confirmation locale, owner_primary, gateway, viewer, device déjà révoqué, ancien token, ancienne clé, nouvel event chiffré, appareil révoqué hors ACK, effacement de données/réinstallation exigeant nouveau deviceId, aucun faux remote wipe hors ligne, tombstone APK réversible, purge sans confirmation PC refusée, purge mémoire+events+médias+snapshot/backup anti-résurrection, device offline appliquant la purge au retour, événement retry bloqué, corruption envelope, dead-letter et repair sans régénération.

- [ ] **Step 2: ordonner la révocation fail-closed**

```text
confirmation locale PC
→ marquer device révoqué localement
→ incrémenter tokenVersion / révoquer les refresh tokens de authUid / désactiver ce principal Auth
→ maintenir auto-init FCM désactivé, unregister côté appareil, retirer le FID serveur/activeDevices RTDB et supprimer le Firebase Installation ID
→ générer keyEpoch+1
→ envelopper pour chaque appareil encore actif
→ supprimer du keyring PC la deviceWrapKey du device révoqué
→ publier device.revoked + key rotation
→ fermer sessions directes du device
```

Si Firebase échoue, le registre local refuse déjà l’appareil et la propagation reste dans une outbox contrôle prioritaire.

- [ ] **Step 3: empêcher toute « crypto-erasure » mensongère**

La rotation protège les événements futurs. L’UI et les logs ne prétendent jamais effacer les données historiques que l’appareil a déjà déchiffrées ni effectuer un remote wipe d’un téléphone hors ligne. Une réinstallation Android ayant perdu la clé Keystore crée une nouvelle identité/appairage ; l’ancien deviceId est révoqué, jamais réanimé avec un compteur remis à zéro.

Le tombstone APK de Task 16 est un masquage réversible. La purge définitive exige une confirmation locale PC `critical_local_only`, appelle le service d’oubli existant, supprime les enveloppes/médias canoniques du thread, exclut le fil des futurs snapshots/backups, conserve seulement un marqueur minimal non réanimable puis publie `thread.purged` signé pour que les appareils actifs suppriment leurs copies. Les devices offline appliquent la purge à leur retour avant d’afficher l’historique ; aucune clé d’époque partagée n’est détruite si elle protège d’autres fils.

- [ ] **Step 4: créer le repair sans plaintext**

Le scan liste ids, états, attempts, dates, tailles et codes d’erreur. Retry reprend livraison/résultat persisté ; il n’appelle le modèle que si le ledger prouve qu’aucun résultat n’existe. Dead-letter exige raison et conserve digest/audit minimal.

- [ ] **Step 5: vérifier et committer**

```powershell
npx vitest run tests/chat-device-revocation.test.mjs tests/chat-repair-service.test.mjs tests/chat-thread-purge.test.mjs tests/native-chat-store.test.mjs
android\gradlew.bat :core:chat:testDebugUnitTest
git add src/devices functions/src android/core/chat tests
git commit -m "feat(chat): add device revocation and deterministic repair"
```

---

### Task 23: Publier budgets, santé et diagnostics sans contenu sensible

**Files:**
- Modify: `src/core/operational-budgets.mjs`
- Modify: `src/core/capability-catalog.mjs`
- Modify: `src/runtime/capability-catalog.mjs`
- Create: `src/diagnostics/native-chat-diagnostics.mjs`
- Modify: `src/ui/main.mjs`
- Modify: `android/feature/chat/src/main/kotlin/fr/mina/gateway/chat/ui/SettingsScreen.kt`
- Create: `tests/native-chat-diagnostics.test.mjs`
- Modify: `tests/capability-catalog.test.mjs`
- Modify: `tests/runtime-capability-catalog.test.mjs`

**Interfaces:**
- Budgets `chat`, `attachments`, `firebase`, `liveVoice` dans la source centrale.
- Capability runtime `native_chat`, `native_chat.firebase`, `native_chat.direct`, `native_chat.voice_live`, `native_chat.huawei_realtime`.
- Diagnostics : compteurs/latences/états uniquement, export redacted.

- [ ] **Step 1: écrire les tests rouges de vérité runtime**

Tester direct seul available, Firebase absent degraded, auth expirée unavailable cloud mais local intact, Huawei foreground refusé degraded, live direct absent unavailable, queue saturée, appareil révoqué et preuve sensible rejetée.

- [ ] **Step 2: centraliser les budgets exacts**

```js
chat: { maxOutboxEvents: 5_000, maxOutboxBytes: 500 * 1024 * 1024, cloudLeaseDays: 30, renewalProofTtlMs: 5 * 60 * 1000, heartbeatMs: 10_000, pageSize: 50, maxDecryptedUiItems: 200, maxGenerationAttempts: 3 },
attachments: { plaintextChunkBytes: 4 * 1024 * 1024, cloudObjectBytes: 5 * 1024 * 1024, imageBytes: 25 * 1024 * 1024, audioBytes: 50 * 1024 * 1024, documentBytes: 100 * 1024 * 1024, messageBytes: 120 * 1024 * 1024 },
firebase: { eventDocumentBytes: 256 * 1024, eventCiphertextBase64Chars: 196_608, responseStreamCiphertextBase64Chars: 16_384, streamTtlMs: 10 * 60 * 1000, wakeMinIntervalMs: 2_000, maxStreamFramesPerResponse: 1_000 },
functions: { minInstances: 0, maxInstances: 3, concurrency: 20, timeoutSeconds: 30, gcMaxInstances: 1, gcTimeoutSeconds: 120 },
liveVoice: { maxBufferedFrames: 64, sampleRate: 16_000, channels: 1 },
```

Android reçoit les mêmes valeurs depuis un fichier de contrat généré/testé ou les répète avec un test de compatibilité Node/Kotlin ; aucune dérive silencieuse.

- [ ] **Step 3: interdire le contenu dans diagnostics/logs**

Le schéma accepte seulement ids hachés, transport, état, code erreur, counts, octets, timings et version. Les clés `text`, `body`, `content`, `filename`, `caption`, `transcript`, `ciphertext`, `token`, `secret`, `signature` sont rejetées avant log. Aucun nouveau stockage télémétrique durable ou envoi analytics n’est créé : l’export est manuel et s’appuie sur la rétention/log rotation existante, qui doit être mesurée et documentée dans le data map.

- [ ] **Step 4: exposer un écran diagnostic utile**

Afficher PC, direct, Firebase, outbox, dernier sync, rôle, App Check réel, notification mode et action `Resynchroniser`. Ne jamais afficher clés/tokens. `Réparer` ouvre les événements en erreur par id/date/code uniquement.

- [ ] **Step 5: vérifier et committer**

```powershell
npx vitest run tests/native-chat-diagnostics.test.mjs tests/capability-catalog.test.mjs tests/runtime-capability-catalog.test.mjs tests/main-domain-composition-contract.test.mjs
npm test
git add src/core src/runtime src/diagnostics src/ui/main.mjs android/feature/chat tests
git commit -m "feat(diagnostics): expose truthful native chat health"
```

---

### Task 24: Exécuter la matrice sécurité, Emulator Suite et appareils physiques

**Files:**
- Create: `scripts/verify-native-chat-release.mjs`
- Create: `tests/security/native-chat-invariants.test.mjs`
- Create: `tests/integration/native-chat-offline-reconnect.test.mjs`
- Create: `tests/integration/native-chat-approval-roundtrip.test.mjs`
- Create: `tests/integration/native-chat-attachment-roundtrip.test.mjs`
- Create: `tests/manual/MINA-NATIVE-CHAT-ACCEPTANCE.md`
- Create: `docs/privacy/native-chat-data-map.md`
- Modify: `package.json`

**Interfaces:**
- Script read-only `npm run verify:native-chat` agrège les preuves, ne déploie rien et ne lit aucun plaintext utilisateur.
- Recette manuelle couvre Samsung, Huawei, PC online/offline, LAN/Firebase, médias, approbations et voix.

- [ ] **Step 1: écrire les invariants sécurité et la data map factuelle**

Prouver par tests : aucune propriété plaintext backend/temp audio, aucune service credential, aucune approbation local_only, migrations appliquées immuables, codec Node/Kotlin/Functions byte-for-byte, signature DER/digest/state/policy obligatoires, event append-only, sender claim exact, allocation `serverSequence`/`syncLog` atomique et retry idempotent, compaction par préfixe avec watermark monotone, réplication direct→second device, device révoqué, réinstallation=new identity, nonce/counter replay, une seule réponse/effet visible après crash, contrôle prioritaire, session Auth PC memory-only et logs redacted. Prouver aussi qu’après une horloge avancée de plus de 30 jours, direct et cloud reprennent le même événement avec preuve fraîche, nouvelle séquence cloud et une seule ligne logique, tandis qu’un renouvellement altéré/révoqué/rejoué échoue. Construire le data map depuis les schémas/migrations/rules/code réellement présents, avec commandes et comptes ; aucun TTL ou champ n’est déduit de la documentation seule. La rétention décrit séparément lease courante, republications possibles tant que l’outbox n’est pas acquittée, journal de métadonnées/compaction et suppression finale après ACK.

- [ ] **Step 2: créer le vérificateur read-only**

Le script vérifie existence des configs, modules, rules, tests, absence de patterns secrets dans les fichiers trackés, alignement des versions et statut de configuration. Il retourne `configured:false` pour Firebase réel absent ; il ne prétend pas que le live est prêt sans sonde.

- [ ] **Step 3: exécuter Emulator Suite complet**

```powershell
npx firebase-tools@15.24.0 emulators:exec --project mina-vision-test "npx vitest run tests/firebase-chat-rules.test.mjs tests/integration/native-chat-offline-reconnect.test.mjs tests/integration/native-chat-approval-roundtrip.test.mjs tests/integration/native-chat-attachment-roundtrip.test.mjs"
```

Expected: exit 0, aucun accès projet réel.

- [ ] **Step 4: exécuter les gates PC et Android**

```powershell
npm test
npm run test:coverage
npm run smoke
npm run smoke:sqlite:electron
npm run verify:native-chat
Set-Location android
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug
```

Expected: tous verts. La couverture des policies/crypto/rules/approvals/sync doit être ≥95 % branches ; aucune baisse globale non expliquée.

- [ ] **Step 5: exécuter sur les deux téléphones réels**

Installer la même build release-candidate signée de test sur Samsung et Huawei. Exécuter : pairing, direct, Firebase, message direct Samsung visible Huawei, PC arrêté 30 min, perte ACK, Wi-Fi coupé, process kill au milieu d’une génération, reboot, historique multi-thread, 100 MiB interrompu, FCM Samsung, profil Play Integrity sideload réellement attesté ou fallback custom explicitement dégradé, fallback Huawei, biometric/credential, révocation, effacement données/réappairage, PTT et live LAN. Renseigner chaque case avec date, appareil, version/signature APK, résultat et preuve redacted.

- [ ] **Step 6: vérifier les revues sécurité et conformité avant release**

Vérifier que les rapports autorisés de Tasks 4, 7, 8, 11 et 19 existent et correspondent aux diffs finalement testés. Envoyer au `compliance-rgpd-auditor` déjà autorisé le follow-up final couvrant data map, rétention réelle, purge anti-résurrection, consentements voix/notifications, export redacted et isolation owner/device. Si le SQL, les endpoints, l’auth, App Check, les rules, la crypto, les approvals ou le traitement de données ont changé depuis leur revue, annoncer le reviewer concerné et demander une nouvelle autorisation avant de le relancer ; ne jamais créer un doublon implicitement. Sans autorisation, ne lancer aucun sous-agent, consigner la revue inline et bloquer release/migration live sur les domaines dont la revue obligatoire manque. Aucun finding n’est accepté sans reproduction.

- [ ] **Step 7: committer les preuves**

```powershell
git add scripts/verify-native-chat-release.mjs tests docs/privacy/native-chat-data-map.md package.json package-lock.json
git commit -m "test(chat): gate native app security and resilience"
```

---

### Task 25: Documenter, préparer le déploiement manuel et conserver le rollback

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `DESIGN.md`
- Modify: `PRODUCT.md`
- Modify: `src/ui/help.html`
- Create: `docs/runbooks/native-chat-firebase.md`
- Create: `docs/runbooks/native-chat-pairing.md`
- Create: `docs/runbooks/native-chat-recovery.md`
- Create: `docs/security/native-chat-threat-model.md`
- Modify: `docs/privacy/native-chat-data-map.md`
- Modify: `docs/superpowers/EXECUTION-LOG.md`
- Local-only setup: `android/app/google-services.json` téléchargé depuis le projet Firebase existant ; ne pas committer.

**Interfaces:**
- Runbooks sans secret, commandes manuelles exactes, rollback APK et désactivation Firebase documentés ; data map avec finalités, champs, emplacements, destinataires, rétentions, purge/export et preuves.
- Documentation n’annonce que les capacités prouvées au gate Task 24.

- [ ] **Step 1: mettre la documentation au niveau du runtime réel**

Décrire chat natif, PC requis, comportements offline, deux appareils, Firebase ciphertext-only, voix, limites live et approvals. Telegram est indiqué optionnel, pas supprimé. Toute capacité non testée reste `indisponible` ou `expérimentale` avec raison. Le data map distingue contenu E2EE, métadonnées techniques, UID Auth/FID/attestation, présence, HMAC IP, logs, caches et plaintext envoyé depuis le PC aux fournisseurs modèle/STT déjà activés ; pour chaque classe il donne source, finalité, chiffrement, lecteurs/destinataires, TTL réel, export et chemin d’effacement sans prétendre au remote wipe.

- [ ] **Step 2: écrire le runbook Firebase du projet existant**

Inclure les commandes à exécuter manuellement après ordre explicite :

```powershell
npx firebase-tools@15.24.0 login
npx firebase-tools@15.24.0 projects:list
npx firebase-tools@15.24.0 use --add
npx firebase-tools@15.24.0 emulators:start
npx firebase-tools@15.24.0 deploy --only functions,firestore:rules,firestore:indexes,database,storage
```

Le runbook impose de sélectionner l’ID égal à `FIREBASE_PROJECT_ID` existant, de rejouer l’inventaire Task 11 (apps, plan de facturation, régions immuables Firestore/RTDB/Storage et Functions existantes), puis de fournir exactement la région confirmée au paramètre Firebase non sensible `MINA_FUNCTION_REGION` avant le premier deploy. Aucune valeur par défaut n’est tolérée et aucune procédure Vercel n’est utilisée. Si Firestore, RTDB ou le bucket requis n’existe pas, présenter séparément le provisionnement dans ce même projet, la région définitive et l’impact de facturation ; ne rien créer sans confirmation explicite. Le code bootstrap, lui, est un secret sensible et reste exclusivement dans Secret Manager, jamais dans `.env`. Sauvegarder les rules live avant fusion et prouver que les chemins backup existants restent autorisés ; un deploy de rules remplace la version live, il ne la fusionne pas automatiquement. Configurer alertes de budget/quotas avant les Functions planifiées et ne lancer `deploy` qu’après confirmation Nasro. Le threat model documente aussi les frontières Android non maîtrisables : clavier tiers, service d’accessibilité autorisé, destinataire d’un partage et téléphone perdu hors ligne.

Dans la console du même projet, enregistrer ou retrouver l’application Android `fr.mina.gateway`, télécharger son `google-services.json`, vérifier que `project_info.project_id == FIREBASE_PROJECT_ID`, puis placer le fichier dans `android/app/google-services.json`. Ne jamais afficher son contenu dans les logs ni le committer, même s’il ne contient normalement que des identifiants de projet non secrets. App Check commence en métriques, puis enforcement service par service après validation Samsung/Huawei. L’allowlist d’exception contient exactement les bootstraps `issueBootstrapAppCheck`/`issueBrainSession` et le renouvellement `issueCustomAppCheck`; chacun reste protégé par les preuves, nonces, versions, quotas et rate limits décrits en Task 11.

Pour le Samsung sideloadé, le runbook vérifie le lien Play Console→même projet Cloud, l’empreinte SHA-256 de la release candidate et les réglages officiels hors Google Play : `PLAY_RECOGNIZED` non requis, `LICENSED` non requis, `MEETS_DEVICE_INTEGRITY` requis. Si ce prérequis ne peut pas être démontré, sélectionner explicitement le provider custom et publier `software_paired/degraded`; ne jamais activer l’enforcement en supposant que le sideload passera. Le provider debug est réservé au variant debug/émulateurs et un gate interdit sa présence effective en release.

Documenter séparément le pare-feu Windows : aucune règle n’est créée automatiquement. La règle entrante manuelle cible seulement l’exécutable/port Mina, le profil `Private`, et les adresses `LocalSubnet` ou le CIDR VPN explicitement choisi ; le profil `Public` et `Any` sont interdits. Le runbook fournit `Get-NetTCPConnection` et `Test-NetConnection` pour distinguer bind réussi, pare-feu bloqué et endpoint obsolète, sans demander de désactiver le pare-feu. Le runbook Huawei explique consentement foreground, notification persistante, exclusion batterie éventuellement accordée manuellement et rattrapage WorkManager ≥15 min sans promesse temps réel.

- [ ] **Step 3: documenter le rollback**

Conserver l’APK précédente, sauvegarder la DB PC avant chaque migration, versionner les schémas Room, vérifier upgrade et refus de downgrade, permettre désactivation `native_chat.firebase` côté PC sans supprimer l’outbox locale, restaurer les rules sauvegardées et laisser Telegram actif. Une clé d’époque tournée n’est jamais rétrogradée pendant rollback. Documenter aussi la perte de Keystore/réappairage, la révocation d’un téléphone perdu, la récupération du keyring PC et la différence entre tombstone réversible et purge définitive PC-only.

- [ ] **Step 4: exécuter le gate final après docs**

```powershell
npm test
npm run verify:native-chat
android\gradlew.bat testDebugUnitTest lintDebug assembleDebug
git status --short
```

Expected: tests verts ; seuls les docs/runbooks attendus sont non commités avant le commit final.

- [ ] **Step 5: committer localement et s’arrêter**

```powershell
git add README.md CHANGELOG.md DESIGN.md PRODUCT.md src/ui/help.html docs
git commit -m "docs(chat): document native android conversation release"
git status --short
git remote -v
```

Expected: arbre propre, aucun remote ou aucun push effectué. Présenter à Nasro les commandes de déploiement/push restantes sans les exécuter.

---

## Gates d’arrêt obligatoires

L’exécuteur s’arrête et demande Nasro avant :

1. la modification de `MINA.md` en Task 0 ;
2. toute revue sous-agent, notamment `db-migration-reviewer` et `compliance-rgpd-auditor`, puis toute application d’une migration à une DB utilisateur ;
3. la sélection du projet Firebase réel, tout provisionnement de ressource, la confirmation de ses régions/du paramètre `MINA_FUNCTION_REGION` et tout `firebase deploy` ;
4. la création/rotation du bootstrap secret et l’activation App Check enforcement ;
5. l’enrôlement, la révocation ou la purge d’un vrai appareil/thread ;
6. l’utilisation réelle d’une approbation entraînant un effet externe ;
7. la publication/signature release de l’APK ;
8. tout push ou déploiement.

Les autres choix ont un défaut fail-closed : file locale, capacité `degraded/unavailable`, aucun plaintext et aucun effet externe.

## Définition de terminé

- [ ] Amendement `mina_app` explicitement validé et testé.
- [ ] Samsung et Huawei appairés avec rôles/capacités distincts.
- [ ] Texte direct et Firebase fonctionnels sans Telegram.
- [ ] Message PC arrêté donnant une seule réponse finale visible et aucun effet dupliqué ; éventuel retry provider/coût supplémentaire explicitement audité.
- [ ] Retour après expiration cloud simulée >30 jours vérifié en direct sans Firebase et via renouvellement Firebase, avec même `eventId` et aucune duplication UI/effet.
- [ ] Historique complet chiffré présent sur les deux appareils.
- [ ] Aucune donnée métier lisible dans Firestore, Storage, RTDB, FCM, logs ou diagnostics.
- [ ] Pièces jointes bornées, reprises par chunk et mises en quarantaine PC.
- [ ] Notifications privées Samsung et fallback Huawei honnête.
- [ ] Approbation ordinaire simple, sensible biométrique/credential, local_only impossible.
- [ ] Notes vocales/PTT partout et live sur direct LAN/VPN.
- [ ] Révocation, key rotation, retry, dead-letter et repair vérifiés.
- [ ] Tombstone APK réversible, purge définitive PC-only et anti-résurrection snapshot/backup vérifiés.
- [ ] Data map factuelle et revue RGPD couvrant rétention, export/effacement, consentements et isolation owner/device.
- [ ] Emulator Suite, tests Node/Android, smoke et deux appareils physiques verts.
- [ ] Documentation et runtime cohérents ; Telegram encore disponible comme rollback.
- [ ] Aucun push/déploiement automatique.

## Ordre d’exécution recommandé

Exécuter inline avec `superpowers:executing-plans`, par lots de deux tâches maximum et checkpoint Nasro après chaque vague. Avant chaque lot, proposer un seul `code-reviewer` réutilisable, en lecture seule, après modification/tests et avant commit ; ne le lancer qu’après autorisation explicite. Si Nasro refuse cette revue générale, effectuer la revue inline et ne prétendre à aucune revue sous-agent ; les gates spécialistes marqués obligatoires restent, eux, bloquants. Toute autre option sous-agents reste indisponible sans autorisation conformément à `AGENTS.md`.
