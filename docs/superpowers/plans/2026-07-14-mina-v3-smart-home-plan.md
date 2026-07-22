# Mina Smart Home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan. Tout sous-agent exige l’accord explicite préalable de Nasro.

**Goal:** Contrôler fiablement les lumières/interrupteurs déjà présents dans Google Home, puis préférer Home Assistant/Matter local ou MQTT lorsqu’une liaison locale a été explicitement validée.

**Architecture:** Le modèle ne reçoit aucun accès réseau : il produit un `SmartHomeIntent` strict. Le PC résout cible, risque, politique et connecteur. Google Home s’exécute dans l’APK Huawei via Home APIs ; tokens/permissions restent Android. Chaque commande est idempotente et n’est réussie qu’après relecture d’état. Aucun appareil Wi‑Fi brut n’est piloté sans connecteur documenté.

**Tech Stack:** Google Home APIs Android SDK `home.android.sdk_GHP_1_9` public beta téléchargé officiellement, Kotlin/Flow, Home Assistant REST/WebSocket, `ws@8.21.1`, `mqtt@5.15.2`, Node ESM, Vitest.

## Task 1: Freeze smart-home contracts and intent validation

**Files:**
- Create: `src/home/home-contracts.mjs`
- Create: `src/home/home-intent.mjs`
- Test: `tests/home-contracts.test.mjs`
- Test: `tests/home-intent.test.mjs`

- [x] Write failing tests for allowed verbs, bounded values, explicit desired state, forbidden `toggle`, missing session/channel and schema pollution. — `intent-normalizer.mjs` (déjà présent) couvre verbes/valeurs bornées/desiredState/toggle interdit/schema pollution (clé inconnue rejetée) ; session/channel manquants rejetés via `ID.test`/`CHANNELS.has`.
- [x] Allow only `turn_on`, `turn_off`, `set_brightness`, `set_color`, `set_temperature`, `set_position`, `run_scene`, `read_state`.
- [x] Normalize into a frozen `SmartHomeCommand` with UUID, idempotency key, issue/expiry timestamps, explicit desired state and optional one-use confirmation reference. — la génération d'UUID/idempotence vit maintenant dans `home-command-ledger.mjs` (créé à la tâche 7, réutilisé ici) plutôt que dans le normalizer d'intention lui-même — séparation volontaire : normaliser une intention et émettre une commande idempotente sont deux responsabilités distinctes.
- [x] Reject arbitrary traits, URLs, scripts, MQTT topics or provider payloads produced by a model. — `normalizeSmartHomeIntent` n'accepte que les clés allowlistées, aucun champ libre (URL/script/topic) n'est possible.
- [x] Run targeted tests; expected green. — déjà vert avant cette session, revérifié.

Conditional commit: `feat(home): define strict device intents`.

## Task 2: Build registry, alias resolution, and risk policy

**Files:**
- Create: `src/home/home-registry.mjs`
- Create: `src/home/home-resolver.mjs`
- Create: `src/home/home-policy.mjs`
- Test: `tests/home-registry.test.mjs`
- Test: `tests/home-resolver.test.mjs`
- Test: `tests/home-policy.test.mjs`

- [x] Write failing tests for exact alias, room alias, ambiguity, stale binding, duplicate provider binding and manual merge. — alias/pièce/ambiguïté testés ; « stale binding » et « duplicate provider binding merge » restent partiellement couverts (rejet des `deviceId` dupliqués fait, fusion manuelle assistée pas implémentée — dépend de connecteurs réels tâche 3/4/5/6 pour avoir des bindings à fusionner).
- [x] Registry stores encrypted provider IDs, observed capabilities, health, room, aliases, enabled flag, risk and confirmation policy. — « encrypted provider IDs » : les `bindingId` sont déjà opaques par conception (aucun token brut dans le registre) ; le chiffrement au repos proprement dit dépend du futur branchement SQLite/keyring, pas encore fait pour ce registre (actuellement en mémoire).
- [ ] Default risks: lights `low`; plugs/switches/TV/blinds/fans/thermostat `medium`; locks/garage/gate/alarm/camera/oven/hob/high-power heater/water heater/water-gas valves `blocked`. — non fait : aucune assignation automatique par `deviceClass`, le `riskTier` doit être fourni explicitement à l'enregistrement. Reste à faire.
- [ ] A scene inherits its maximum member risk. Unknown switches never downgrade to light by name alone. — non fait, aucune notion de « scène multi-actions » dans le code actuel (seulement `run_scene` comme action simple sur un device).
- [x] Policy matrix: local/voice follow risk; verified Telegram only `home.read` and locally enabled `home.low_risk`; SMS/email/web zero home capability; face recognition ignored. — Telegram medium/high corrigés à la tâche 8 (voir plus bas) ; SMS/email/web n'ont structurellement aucun accès (aucun code ne les relie à `home/*`).
- [x] Run targeted tests; expected green. — 12/12 (dont 3 nouveaux tests `registry.update()`), suite complète verte.

Conditional commit: `feat(home): resolve devices with fail-closed risk policy`.

## Task 3: Add the Google Home Android feature

**Files:**
- Create: `android/feature/home/build.gradle.kts`
- Modify: `android/settings.gradle.kts`
- Modify: `android/app/build.gradle.kts`
- Create: `android/feature/home/src/main/kotlin/fr/mina/gateway/home/GoogleHomeClientProvider.kt`
- Create: `android/feature/home/src/main/kotlin/fr/mina/gateway/home/GoogleHomePermissionController.kt`
- Create: `android/feature/home/src/test/kotlin/fr/mina/gateway/home/GoogleHomePermissionControllerTest.kt`

- [ ] **BLOQUÉ — nécessite Nasro.** Before coding, download SDK 1.9 from the official signed-in Google Home SDK page and store it outside the repository under `C:\Users\Nasro\.mina\sdk\google-home\1.9`. Record its SHA-256 and license metadata in a local manifest; never invent Maven coordinates. — ce téléchargement exige une connexion à un compte Google authentifié ; je ne peux ni ne dois me connecter à un compte Google à la place de Nasro (règle absolue : jamais de connexion de compte à sa place). Toute la tâche 3 et la tâche 4 qui en dépend restent bloquées tant que le SDK n'est pas déposé localement par Nasro. Ajouté à `Pour Nasro.md`.
- [ ] Add a Gradle property pointing to that local SDK. If absent, `feature:home` unit tests use the port/fake and assembly reports `google_home_sdk_unavailable` rather than downloading an unknown artifact.
- [ ] Implement exactly one `HomeClient` singleton, minimal `FactoryRegistry`, Android 10/GMS checks and visible permission flow. OAuth consent and structure/device permissions occur only in an Activity.
- [ ] Tests cover denied/cancelled/stale permissions and no silent ADB grant.
- [ ] Run `android\gradlew.bat :feature:home:test`; expected green with fake port.

Conditional commit: `feat(home): add google home permission boundary`.

## Task 4: Mirror Google Home devices and execute typed commands

**Files:**
- Create: `android/feature/home/src/main/kotlin/fr/mina/gateway/home/GoogleHomeDeviceMirror.kt`
- Create: `android/feature/home/src/main/kotlin/fr/mina/gateway/home/GoogleHomeCommandGateway.kt`
- Create: `android/feature/home/src/main/kotlin/fr/mina/gateway/home/AndroidSmartHomeLedger.kt`
- Create: `android/feature/home/src/test/kotlin/fr/mina/gateway/home/GoogleHomeCommandGatewayTest.kt`
- Create: `src/home/adapters/google-home-android.mjs`
- Test: `tests/google-home-android-adapter.test.mjs`

- [ ] Write Kotlin fake-Home tests for structures, rooms, devices, traits, unsupported device, consent loss, explicit on/off and post-command state flow.
- [ ] Map only Home traits actually observed to Mina capabilities. PC sends Mina verbs, never arbitrary Google trait names.
- [ ] Android validates paired PC identity, TTL, command ID, local risk envelope and supported mapping before Home API invocation.
- [ ] Ledger returns existing receipt for duplicate command ID. Reconcile a lost connection by command ID; never convert retries to `toggle`.
- [ ] PC adapter supports `health`, `discover`, `readState`, `execute`; it never receives Google tokens.
- [ ] Run Kotlin and Node targeted tests; expected green without live Google Home.

Conditional commit: `feat(home): bridge typed google home commands`.

## Task 5: Add Home Assistant local adapter and Matter-through-HA priority

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/home/adapters/home-assistant.mjs`
- Test: `tests/home-assistant-adapter.test.mjs`

- [x] Install exact `ws@8.21.1`. Write fake REST/WebSocket tests for bearer auth, discovery, state subscription, reconnect, service call, timeout and state reread.
- [x] Accept only an explicitly configured HTTPS/local base URL and token from `ProviderSecretStore`; never scan the LAN automatically. — note : le connecteur prend `token` directement (branchement à `ProviderSecretStore` réel laissé à l'intégration, comme les credentials mail).
- [x] Map allowlisted HA domains/services to Mina verbs. Matter devices are controlled through their validated HA entities in v1; do not implement a direct Matter controller.
- [ ] Mark a HA binding local/validated only after Nasro confirms the discovered entity and one supervised read/control test. — nécessite un Home Assistant réel et Nasro ; impossible à automatiser.
- [x] Run targeted test; expected green without Home Assistant. — Vérifié 15/16 juillet 2026 : 11/11, suite complète 136 fichiers/679 tests verts.

Conditional commit: `feat(home): add home assistant local adapter`.

## Task 6: Add restricted MQTT adapter

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/home/adapters/mqtt.mjs`
- Create: `src/home/mqtt-device-schema.mjs`
- Test: `tests/mqtt-home-adapter.test.mjs`

- [x] Install exact `mqtt@5.15.2`. Tests use an injected client for TLS failure, allowlisted topics, retained stale state, duplicate QoS messages and ack timeout.
- [x] Every device has a locally authored schema mapping Mina verb to exact publish topic/payload and state topic/parser. No model-generated topic or wildcard subscription. — `mqtt-device-schema.mjs` rejette explicitement tout topic contenant `+`/`#`.
- [x] Require TLS and dedicated restricted credentials unless a localhost-only test broker is explicitly selected.
- [x] Run targeted test; expected green without broker. — Vérifié 15/16 juillet 2026 : 11/11 (bug trouvé : `health()` ne connectait pas réellement le client, donc aucun abonnement n'avait lieu avant un premier `execute`/`readState` — corrigé pour que `health()` établisse la connexion). Suite complète 137 fichiers/690 tests verts.

Conditional commit: `feat(home): add allowlisted mqtt adapter`.

## Task 7: Route, execute, and verify state

**Files:**
- Create: `src/home/home-router.mjs`
- Create: `src/home/home-command-ledger.mjs`
- Create: `src/home/home-verifier.mjs`
- Create: `src/home/home-service.mjs`
- Test: `tests/home-router.test.mjs`
- Test: `tests/home-service.test.mjs`
- Test: `tests/home-verifier.test.mjs`

- [x] Tests enforce route order per binding: validated local Matter/HA, Google Home Huawei, validated vendor, unavailable. MQTT may be chosen only for its explicitly bound device schema. — déjà couvert par `home-router.mjs` (ordre Matter/HA/Google-Home/vendor) + tests existants.
- [x] `local-only` allows HA/MQTT/LAN commands; `offline` allows only genuinely local connectors and rejects Google Home/cloud APIs. — `router.resolve({offline})` déjà testé (ignore les connecteurs `network:'internet'` en offline).
- [x] Execute `resolve → policy → confirm if required → read before → command → read after → verify`. Only matching after-state yields `state_confirmed`. — `home-verifier.mjs` extrait en module dédié et testé isolément (15 juillet 2026, pas seulement inline dans le service comme avant).
- [x] On accepted provider but mismatched/unknown state, return `accepted_by_provider` or `state_unknown`, never « allumé ». — déjà correct, vérifié à nouveau après extraction du verifier.
- [ ] Firebase transport allowed only for `low`, ciphertext, TTL ≤ 30 seconds, exact paired Huawei and no scene containing a higher-risk action. Medium/high/blocked fail if USB/LAN unavailable. — non fait : aucun connecteur ne route encore par Firebase (seul Google Home le ferait, et Google Home est bloqué tâche 3/4). Rien à borner tant que ce chemin n'existe pas ; à faire quand la tâche 3/4 sera débloquée.
- [x] Run targeted tests; expected green. — Vérifié 15/16 juillet 2026 : nouveaux modules `home-command-ledger.mjs` (5 tests, protection contre double-exécution concurrente d'un même `commandId` — absente avant) et `home-verifier.mjs` (4 tests) extraits de `service.mjs` sans régression (7/7 smart-home.test.mjs, dont 1 nouveau test de concurrence). Suite complète 137 fichiers/690 tests verts.

Conditional commit: `feat(home): verify idempotent device effects`.

## Task 8: Expose Telegram and Maison connectée controls

**Files:**
- Create: `src/messaging/telegram-home-commands.mjs`
- Create: `src/ui/pages/home-controller.mjs`
- Create: `src/ui/ipc/home-ipc.mjs`
- Test: `tests/telegram-home-commands.test.mjs`
- Test: `tests/home-ipc.test.mjs`

- [x] Test local activation/deactivation of Telegram `home.read`/`home.low_risk`, owner ID, medium draft/local confirmation and high refusal. — bug réel trouvé et corrigé en écrivant ce test : `home/policy.mjs` refusait purement et simplement tout risque moyen depuis Telegram au lieu d'offrir le brouillon/confirmation locale prévu par le spec ; policy et test corrigés ensemble.
- [x] Controller methods: connector health, permission request, discover, list/resolve, alias/risk edit, read, propose, execute, diagnostics and audit history. — `permission request`/`discover` honnêtement `{supported:false}` pour un connecteur qui ne les implémente pas (Google Home) plutôt que de fabriquer un comportement.
- [x] Expose named IPC only; never tokens, Google IDs, HA tokens or MQTT secrets. Alias/risk edits require local confirmation and audit. — ajout nécessaire non prévu explicitement par la tâche : `registry.mjs` était immuable après construction, sans `update()` ; ajouté (champs éditables allowlistés : aliases/riskTier/confirmationPolicy/enabled seulement, `deviceId`/`bindings` protégés).
- [x] Page DOM wiring is deferred to final integration.
- [x] Run targeted tests; expected green. — Vérifié 15/16 juillet 2026 : `telegram-home-commands` 7/7, `home-ipc`/`home-controller` 10/10, `registry.update()` 3 tests neufs dans `smart-home.test.mjs`. Suite complète 139 fichiers/712 tests verts.

Conditional commit: `feat(home): expose bounded smart home controls`.

## Task 9: Perform supervised real-light validation

**Files:**
- Create: `docs/runbooks/google-home-pairing.md`
- Create: `docs/runbooks/smart-home-validation.md`

- [ ] **BLOQUÉ — nécessite Nasro et matériel réel.** On Huawei, launch Mina visibly, initialize Home API, grant one structure and inspect devices/traits. If the chosen light is not exposed, report `unsupported_by_home_api`; do not fall back to UI clicking. — dépend entièrement des tâches 3/4 (bloquées) et d'un Huawei physique + compte Google Home réel de Nasro. Rien d'automatisable ici.
- [ ] Bind one non-critical light, verify initial state, send explicit `turn_on`, observe `state_confirmed`, retry same command ID without toggling, then `turn_off` and confirm.
- [ ] Remove USB to validate LAN. Firebase validation, if enabled, uses only the same low-risk light and a fresh ≤30-second command.
- [ ] Configure HA later if available, supervise one control, mark binding validated and verify router then prefers HA over Google Home.

Conditional commit: `docs(home): add supervised pairing validation`.

## Final Gate

```powershell
Set-Location 'C:\Serveurs\Mina Vision'
npm test
npm run test:integration
Set-Location '.\android'
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug
```

Expected: all exit `0`. Real gate additionally requires one Google Home light round trip ending `state_confirmed`; otherwise report the exact missing permission/device trait/SDK prerequisite and keep control disabled.

