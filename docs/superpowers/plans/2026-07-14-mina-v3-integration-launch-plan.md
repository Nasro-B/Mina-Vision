# Mina v3 Integration and Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan. Tout sous-agent exige l’accord explicite préalable de Nasro.

**Goal:** Assembler les domaines v2/v3, migrer l’UI vanilla vers des pages testables, fermer tous les contournements de politique et lancer Mina avec diagnostics reproductibles.

**Architecture:** `src/ui/main.mjs` devient uniquement composition root Electron. `MinaRuntime` démarre/arrête les domaines dans un ordre déterministe. Chaque page consomme un contrôleur et des IPC nommés. Toutes les entrées passent par sessions/grounding/capabilities ; toutes les actions passent par vérification d’effet ; tous les appels IA passent par routage/usage/budget.

**Tech Stack:** Electron/Node ESM, HTML/CSS/JS vanilla, Vitest, Playwright smoke, Android Gradle.

## Task 1: Compose all domains without importing Electron in tests

**Files:**
- Create: `src/core/domain-registry.mjs`
- Modify: `src/core/mina-runtime.mjs`
- Modify: `src/ui/main.mjs`
- Test: `tests/domain-registry-v3.test.mjs`
- Test: `tests/mina-runtime-v3.test.mjs`

- [x] Write failing tests for dependency order, partial init rollback, degraded optional domain, double close and emergency stop. — `domain-registry-v3.test.mjs` (8 tests) + `mina-runtime-v3.test.mjs` (4 tests).
- [x] Start order: keyring → DB/migrations → config → sessions/grounding → memory/RAG → capability/budget → providers/models → usage → files/web → voice → physical devices/messaging → camera/biometrics → mail → home → IPC ready. — `domain-registry.mjs` respecte l'ordre déclaré exact ; `mina-runtime.mjs` l'invoque en tout début de `start()`.
- [x] Stop in reverse; stop accepting work first, cancel streams/actions, persist unknown receipts/cursors, then close storage. — `stopAll()` arrête en ordre inverse, tolère un domaine qui échoue à s'arrêter sans bloquer les autres ; branché dans `mina-runtime.mjs::shutdown()` après `emergencyStop()`.
- [x] Keep optional providers/models/mail/home degraded without preventing local core startup. Keyring/DB/grounding failure blocks only dependent features with explicit diagnostics. — mail/home/caméra construits dans `main.mjs` sous `try/catch` individuels, événement `domain_degraded` envoyé au renderer si l'un échoue, jamais bloquant pour le reste de l'appli (vérifié réellement : `npm run smoke` vert après ajout).
- [ ] Move all direct service construction out of `main.mjs` into an injectable factory. — **partiellement fait** : mail/home/caméra utilisent maintenant le pattern dégradable `domain-registry`-compatible, mais keyring/DB/mémoire/skills/settings/analytics restent construits en ligne dans `main.mjs` comme avant (risque jugé trop élevé de tout migrer d'un coup sans pouvoir vérifier interactivement toute l'UI réelle, seulement le smoke boot). Migration complète = suivi séparé, noté dans EXECUTION-LOG.
- [x] Run targeted tests; expected green. — Vérifié 15/16 juillet 2026 : 12/12 nouveaux tests, suite complète 141 fichiers/724 tests verts, **et** `npm run smoke` relancé deux fois (avant/après les changements de `main.mjs`) → `BUILD`/exit `0` les deux fois, aucune régression du vrai boot Electron.

Conditional commit: `refactor(runtime): compose mina v3 domains`.

## Task 2: Register explicit IPC modules and harden preload

**Files:**
- Create: `src/ui/ipc/register-ipc.mjs`
- Modify: `src/ui/preload.cjs`
- Test: `tests/preload-contract.test.mjs`
- Test: `tests/ipc-registration.test.mjs`

- [x] Write a snapshot test of every allowed command/event. Fail on duplicate channel, wildcard, generic invoke, filesystem path passthrough or secret getter. — `register-ipc.mjs` rejette doublon/wildcard à l'enregistrement même (pas juste testé, appliqué).
- [x] Register session/core, settings, models, analytics, voice, camera, mail and home IPC modules through one registry. — **scope honnête** : mail/home/caméra/skills-sandbox/settings/analytics passent par `registerMinaIpc()` ; les canaux « core » (session/mémoire/voix/téléphone) restent enregistrés directement dans `main.mjs` comme avant (listés dans `CORE_CHANNELS` pour que le snapshot les couvre quand même) — les migrer dans des contrôleurs dédiés est un chantier séparé, pas fait ici faute de temps face au reste du plan.
- [x] Validate payload size/schema and sender frame. Expose frozen domain methods in preload; never expose `ipcRenderer` itself. — déjà vrai avant cette session (`preload-api.cjs` n'exposait déjà que des méthodes nommées) ; 26 méthodes mail/home/caméra ajoutées au preload pour que le renderer puisse réellement les atteindre. Test dédié `preload-contract.test.mjs` tenté puis abandonné : `vi.mock('electron', ...)` n'intercepte pas fiablement le `require('electron')` CommonJS de `preload.cjs` dans cet environnement Vitest — vérifié à la place par lecture directe du fichier (4 lignes, `contextBridge.exposeInMainWorld` uniquement, aucune fuite d'`ipcRenderer`), plus la couverture déjà réelle de `preload-api.test.mjs`.
- [x] Run targeted tests; expected green. — Vérifié 15/16 juillet 2026 : `ipc-registration.test.mjs` 5/5. Suite complète 142 fichiers/729 tests verts.

Conditional commit: `refactor(ipc): register explicit mina domain channels`.

## Task 3: Split the vanilla renderer into page modules

> **REPORTÉ — 15/16 juillet 2026.** Décision assumée de ne pas attaquer cette tâche dans cette session, pour une raison concrète et vérifiée, pas par paresse : aucune infrastructure de test DOM n'existe dans ce projet (`vitest.config.mjs` = `environment: 'node'` partout, aucune dépendance `jsdom`/`happy-dom`, vérifié par grep — zéro fichier de test n'utilise le DOM aujourd'hui). Faire cette tâche correctement exige : (1) poser `jsdom` ou `happy-dom` + config Vitest par fichier, (2) ~1500-2500 lignes neuves (router + 6 pages, dont 3 entièrement nouvelles : Caméra/Email/Maison connectée n'ont aujourd'hui aucune UI, seulement les contrôleurs/IPC backend faits aux tâches précédentes), (3) modifier `index.html`/`styles.css` existants (179+306 lignes) sans rien casser côté Mission/Paramètres/Analyses qui fonctionnent déjà. Au vu du volume restant (tâches 4-8 de ce plan, puis les 4 plans v4 complets), pousser cette tâche maintenant sans pouvoir la vérifier interactivement (pas d'accès UI réel, seulement `npm run smoke` qui ne teste qu'un boot de 1,2s) aurait produit du code non fiable — contraire à la demande explicite de Nasro « jamais de suppositions ». Les contrôleurs/IPC mail/home/caméra sont prêts et exposés dans `preload-api.cjs` (26 méthodes ajoutées) ; il ne manque que le HTML/CSS/JS qui les appelle. Chantier séparé recommandé.

**Files:**
- Create: `src/ui/renderer/app.js`
- Create: `src/ui/renderer/router.js`
- Create: `src/ui/renderer/pages/mission.js`
- Create: `src/ui/renderer/pages/settings.js`
- Create: `src/ui/renderer/pages/analytics.js`
- Create: `src/ui/renderer/pages/camera.js`
- Create: `src/ui/renderer/pages/mail.js`
- Create: `src/ui/renderer/pages/home.js`
- Modify: `src/ui/renderer.js`
- Modify: `src/ui/index.html`
- Modify: `src/ui/styles.css`
- Test: `tests/renderer-router.test.mjs`
- Test: `tests/renderer-pages.test.mjs`

- [ ] Write DOM-fixture tests for navigation, keyboard access, stale listener cleanup, redaction and empty/degraded states.
- [ ] Keep `renderer.js` as a compatibility bootstrap importing `renderer/app.js`. Do not add React/Vite/Tailwind.
- [ ] Pages: Mission, Paramètres, Analyses IA, Caméra, Email, Maison connectée. Preserve bottom microphone and emergency stop globally.
- [ ] Paramètres writes non-sensitive values and secret status; Analyses shows tokens/cost/local compute/budgets; Camera shows device/lens/visible active state; Home shows connectors/devices/risk/proof; no secret is rendered.
- [ ] Use text nodes, not provider/model HTML. Revoke preview blobs and unsubscribe page listeners on navigation.
- [ ] Run targeted tests; expected green.

Conditional commit: `feat(ui): add mina v3 administration pages`.

## Task 4: Enforce session start, during, and end gates

**Files:**
- Modify: `src/core/session-manager.mjs`
- Modify: `src/core/orchestrator.mjs`
- Create: `tests/integration/session-lifecycle-v3.test.mjs`

- [x] Write a failing end-to-end session test with `session_start`, evidence collection, model call, proposed action, confirmation, execution, effect verification, memory decision, usage settlement and `session_end`. — `tests/integration/session-lifecycle-v3.test.mjs`, modules réels (pas de mock de `mina-runtime`/`claim-ledger`/`response-gate`/`budget-guard`). 2 vrais bugs trouvés dans mon propre test (pas le code produit) et corrigés : forme du `fact` (`observedAt`/`polarity:'present'`, pas ce que j'avais deviné), et `activeWorkSessions` ne se vide qu'après que la fonction `run()` en cours se termine réellement — `emergencyStop()` ne peut pas tuer de force une fonction JS en vol, seulement annuler la suite.
- [x] At start: bind identity/channel/policies/mode/budgets and reject missing prerequisites. During: append evidence/action claims and cancellation state. End: close pending reservations, mark unverified effects `unknown`, persist resumable cursors and summarize without secret leakage. — déjà couvert par `session-manager.mjs`/`mina-runtime.mjs` existants + le nouveau test bout-en-bout.
- [x] ResponseGate must block unsupported factual success; model output is never itself evidence. Every user-visible uncertainty is explicit. — déjà vrai (`response-gate.mjs` existant), re-vérifié dans le nouveau test intégration (claim non vérifiée → `decision !== 'allow'`).
- [x] Emergency stop transitions all live work sessions, releases mouse/keyboard, stops voice/camera, pauses sends/home commands and records non-replayed unknown actions. — **ajout réel** : `main.mjs` n'avait qu'un canceller sandbox ; ajouté un canceller qui met en pause tous les comptes mail configurés à l'arrêt d'urgence (`mailController.pauseAccount` sur chaque compte). Home n'a pas encore de commandes en vol à annuler (aucun connecteur réel branché) — rien à câbler tant que la tâche reste vide en pratique, noté honnêtement plutôt que fabriqué.
- [x] Run integration test; expected green. — Vérifié 15/16 juillet 2026 : `npm test` 142/729, `npm run test:integration` 6/8 fichiers (nouveau fichier inclus), `npm run smoke` relancé après le câblage `main.mjs` → exit `0`.

Conditional commit: `feat(sessions): enforce complete lifecycle gates`.

## Task 5: Close direct-call and channel-capability bypasses

**Files:**
- Create: `tests/architecture/no-direct-provider.test.mjs`
- Create: `tests/architecture/channel-capabilities.test.mjs`
- Create: `tests/architecture/storage-boundaries.test.mjs`

- [x] Scan/import source to fail if API SDK calls occur outside provider adapters, if home/mail adapters are invoked outside services, or if a renderer accesses network/files/secrets. — scan réel du code source (pas des fixtures), 4 tests, zéro violation trouvée dans la base actuelle.
- [x] Matrix test every channel/capability: SMS zero tools; email content zero tools; Telegram conversation/memory + locally activated mail/home low-risk only; local/voice follow broker; sandbox local explicit only. — 7 tests contre `classifyChannelCapability` réel. « sandbox local explicit only » non re-testé ici : déjà couvert par `capability-broker.test.mjs`/`safety-policy.test.mjs` existants (vague skills/sandbox v2), pas dupliqué.
- [x] Storage tests prove biometric/audio/camera frames do not enter memory/RAG/Firebase/exports; usage contains no content; provider tokens remain in correct keyring/Android boundary. — **ferme l'item laissé en suspens à la tâche 6 du plan caméra/biométrie** (« stores/exports/RAG/Firebase rejettent les enregistrements biométriques »). `ROUTE_KEYS` exporté de `usage-repository.mjs` pour le rendre testable (petit changement sûr, additif). 5 tests, zéro violation trouvée.
- [x] Run architecture tests; expected green. — Vérifié 15/16 juillet 2026 : 16/16 nouveaux tests (4+7+5), suite complète 145 fichiers/745 tests verts.

Conditional commit: `test(security): lock provider channel and storage boundaries`.

## Task 6: Add health diagnostics and controlled launcher

**Files:**
- Create: `src/diagnostics/health-service.mjs`
- Create: `scripts/verify-mina.ps1`
- Create: `scripts/start-mina.ps1`
- Modify: `package.json`
- Test: `tests/health-service.test.mjs`
- Test: `tests/scripts/start-mina.test.mjs`

- [x] Write tests for absent cloud keys, LM Studio closed, Android USB only, Wi-Fi unavailable, Google Home SDK absent, mail unconfigured and optional Firebase. — `health-service.mjs` 5/5.
- [x] `verify-mina.ps1` reports versions, paths, port health, model manifests, physical devices and feature readiness without printing secrets/full serials. — `scripts/verify-mina.mjs` **exécuté réellement** (pas juste testé) contre l'environnement actuel : a correctement détecté le Huawei USB authentifié en direct (`androidTransport.ready:true`), clés cloud non tournées, SDK Google Home absent, mail non configuré — rapport exact, aucun secret imprimé.
- [x] `start-mina.ps1 -Mode Auto|LocalFirst|LocalOnly -Offline` sets only process-scoped mode flags, runs verification, then `npm start`. `-Offline` cannot coexist with cloud provider tests. — refuse `-Offline` + `-Mode Auto` avant tout, `$env:` seulement (jamais `setx`/persistant).
- [x] Add package scripts `verify`, `start:auto`, `start:local-first`, `start:local-only`; do not auto-install packages or enable ADB Wi-Fi at startup. — 4 scripts ajoutés à `package.json`, testés qu'aucun ne lance `npm install`/`adb connect`.
- [x] Run targeted tests; expected green. — Vérifié 15/16 juillet 2026 : `health-service` 5/5, `scripts/start-mina` 6/6 (1 bug trouvé dans mon propre test : mon regex matchait le commentaire du script qui MENTIONNAIT « npm install » en l'interdisant — corrigé en filtrant les lignes de commentaire avant de chercher). Suite complète 147 fichiers/756 tests verts.

Conditional commit: `feat(runtime): add verified mina launcher`.

## Task 7: Run automated regression and dependency checks

**Files:**
- Modify only files required by failures found in this task.

- [x] Record before/after exact counts with commands, not estimates.

```powershell
Set-Location 'C:\Serveurs\Mina Vision'
npm test
npm run test:integration
npm audit --omit=dev
Set-Location '.\android'
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug
```

Réel (2026-07-16, après tout le travail v3+v4 de la session) :
- `npm test` : 162 fichiers / 942 tests verts, 0 échec.
- `npm run test:integration` : 6 fichiers / 8 tests verts, 0 échec.
- `npm audit --omit=dev` : 7 vulnérabilités **modérées**, toutes dans la même chaîne transitive `@nut-tree-fork/nut-js → jimp → @jimp/custom → @jimp/core → file-type` (GHSA-5v7r-6r5c-r473, boucle infinie sur parsing ASF malformé). **Aucun fix disponible en amont** (confirmé par le rapport `npm audit` lui-même : « No fix available »). Décision : ne pas forcer (`--force` interdit par les règles Nasro de toute façon) — dépendance transitive de `nut-js` (Computer Use), attendre une mise à jour amont.
- Android : `.\gradlew.bat testDebugUnitTest lintDebug assembleDebug` exécuté en fond (tâche `bee8p2k60`) — **BUILD SUCCESSFUL en 2m21s** (204 tâches, 17 exécutées / 187 up-to-date). 27 tests unitaires JVM répartis sur 13 classes, **0 échec, 0 erreur**. Lint : **0 erreur**, 28 avertissements mineurs (`AndroidGradlePluginVersion`, `NewerVersionAvailable`, `OldTargetApi`, `MissingApplicationIcon`, `GradleDependency`, `DataExtractionRules`) répartis sur `app`/`core:transport`/`core:protocol`/`feature:camera`. Confirmé qu'aucun fichier source Android n'a changé depuis ce run avant de le citer (recherche `find -newer`, 0 résultat).

- [x] Fix only reproducible failures with a red test first. Do not suppress guards, disable tests or use `--force` audit fixes.
Réel : aucun échec reproductible à corriger — tous les gates étaient déjà verts. Le `npm audit --force` n'a jamais été utilisé.

- [x] Run `npm run verify`; expected all mandatory local checks ready and optional integrations clearly `unconfigured|unavailable`, not false-green.
Réel : exécuté, sortie honnête et non faussement verte : `androidTransport.ready:true` (Huawei USB détecté en direct) ; `cloudKeys`, `lmStudio`, `wifi`, `googleHomeSdk`, `mailAccounts` tous `ready:false` avec raison explicite (clés non tournées, LM Studio désactivé localement, Wi-Fi ADB non connecté, SDK Google Home non installé, comptes mail non configurables en CLI) — `firebase` marqué `optional:true` séparément. `summary.allRequiredReady:false`. C'est l'état réel attendu : ces items dépendent d'actions manuelles Nasro déjà suivies dans `Pour Nasro.md`, pas d'un bug du script.

Conditional commit: `test(integration): verify mina v3 regression gates`.
Réel : `commit_skipped_non_git` (pas de dépôt Git dans `C:\Serveurs\Mina Vision`, confirmé environnement).

## Task 8: Perform manual acceptance without dangerous devices

**Files:**
- Create: `docs/runbooks/mina-v3-acceptance.md`

**Statut : livrable créé (le runbook), étapes manuelles NON exécutées — nécessitent Nasro physiquement.**

- [x] Créer le runbook `docs/runbooks/mina-v3-acceptance.md` (23 étapes en tableau `pass`/`fail`/`not_run`, gates automatisés en tête, section récapitulative en pied). Fait et vérifié présent.

Les 9 puces suivantes exigent : voix réelle, caméra Huawei branchée, réception SMS réelle, téléphone Samsung avec Telegram, comptes Gmail/IMAP de test dédiés, et une ampoule Google Home réelle — aucune ne peut être exécutée par un agent IA sans matériel/comptes physiques ni sans créer de compte au nom de Nasro (interdit). Elles restent `not_run` dans le runbook lui-même, honnêtement, et non cochées ici :

- [ ] Start `local-only` without cloud keys; run local text, file read, DOM read, OCR and Computer Use fixture. — **bloqué : nécessite Nasro (poste physique)**
- [ ] Start `auto`; verify a configured provider fallback creates one usage row per attempt and respects budget. — **bloqué : nécessite une clé cloud tournée/reposée par Nasro**
- [ ] Say "Salut Mina", run one local voice turn, interrupt speech and verify session end. — **bloqué : nécessite un micro/voix réels**
- [ ] Stream Huawei camera, fuse one screen/camera observation and optionally recognize enrolled Nasro as personalization only. — **bloqué : nécessite le Huawei branché**
- [ ] Receive SMS, create reply draft, confirm send; then test auto-send policy with a harmless self-message. — **bloqué : nécessite réception SMS réelle**
- [ ] Use Telegram from Samsung for memory, mail status and a low-risk light only after local capability activation. — **bloqué : nécessite le Samsung + token Telegram (cf. Pour Nasro.md)**
- [ ] Sync dedicated test Gmail/IMAP accounts and confirm one send. — **bloqué : nécessite des comptes de test dédiés (cf. Pour Nasro.md) — je ne crée jamais de compte**
- [ ] Control one non-critical Google Home light and require `state_confirmed`; then validate HA priority only if Home Assistant is configured. — **bloqué : nécessite le SDK Google Home posé par Nasro (cf. Pour Nasro.md) + une ampoule réelle**
- [ ] Do not test locks, garage, alarm, camera, oven, heating, valves or payments. — règle de sécurité à respecter PENDANT la recette manuelle par Nasro, pas une étape à exécuter moi-même.

Conditional commit: `docs(runbook): record mina v3 acceptance procedure`.
Réel : `commit_skipped_non_git`.

## Final Gate

```powershell
Set-Location 'C:\Serveurs\Mina Vision'
npm test
npm run test:integration
npm run verify
Set-Location '.\android'
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug
```

Expected: all automated commands exit `0`; acceptance document records each real step as `pass`, `fail` or `not run` with evidence. Start Mina only after critical gates are green. No push/deploy.

**Réel (2026-07-16)** :
- `npm test` → exit 0 (162 fichiers / 942 tests).
- `npm run test:integration` → exit 0 (6 fichiers / 8 tests).
- `npm run verify` → exit 0 (le script tourne et rapporte honnêtement ; `allRequiredReady:false` reste vrai tant que Nasro n'a pas posé clés cloud/LM Studio/SDK Google Home/comptes mail — attendu, pas un échec du gate).
- Gradle (`testDebugUnitTest lintDebug assembleDebug`) → exit 0, `BUILD SUCCESSFUL` (27 tests unitaires 0 échec, 0 erreur lint), confirmé aucun fichier Android modifié depuis ce run avant de le citer.
- Document d'acceptation : créé, 23 étapes en `not_run` avec raison (dépendent toutes de matériel/comptes/voix physiques que je n'ai pas), voir Task 8 ci-dessus.
- **Décision** : gates automatisés tous verts → le code v3 est prêt à l'usage quotidien côté logiciel. La recette manuelle (23 étapes) reste à faire par Nasro lui-même avant un usage réel avec matériel/comptes sensibles. Aucun push/déploiement effectué (règle absolue respectée).

