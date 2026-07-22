# Mina Automation Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Tout sous-agent exige le feu vert préalable de Nasro.

**Goal:** Construire le mode ombre, les grants d’autonomie, le ledger, le centre de récupération, le laboratoire d’évaluation et les sondes santé.

**Architecture:** Les définitions et grants sont immuables/versionnés. La simulation précède toujours la policy ; le runner appelle uniquement des services métier enregistrés. Recovery et evaluation projettent/rejouent les preuves existantes sans produire d’effet.

**Tech Stack:** JavaScript ESM, Vitest, Zod, SQLite chiffré et `BudgetGuard` des plans précédents.

## Global Constraints

- Statuts exacts : `draft|shadow|supervised|active|suspended|revoked`.
- Décisions exactes : `simulate|confirm|allow|deny`.
- Aucun grant sans `expiresAt`, digest et limites positives.
- Mode ombre : zéro appel à une méthode métier `execute|send|write|commit`.
- Aucun retry à effet sans réconciliation.
- Aucun contenu personnel brut dans usage, audit ou fixtures.
- Commits seulement si Git existe et Nasro les a autorisés.

---

### Task 1: Automation definitions and lifecycle

**Files:**
- Create: `src/crypto/canonical-json.mjs`
- Create: `src/crypto/digest.mjs`
- Create: `src/automation/automation-contracts.mjs`
- Create: `src/automation/automation-definition-store.mjs`
- Test: `tests/canonical-json.test.mjs`
- Test: `tests/automation-contracts.test.mjs`
- Test: `tests/automation-definition-store.test.mjs`

**Interfaces:**
- Consumes: `clock.now()`, encrypted repository `put/get/list`.
- Produces: `canonicalJson(value)`, `sha256(text)`, `validateAutomationDefinition(input)`, `createAutomationDefinitionStore({ repository, clock })` with `create`, `get`, `transition`, `revoke`.

- [x] **Step 1: Write failing lifecycle tests**

```js
it('rejects activation before shadow and supervision', async () => {
  const store = createAutomationDefinitionStore({ repository: fakeRepo(), clock })
  const item = await store.create(validDefinition({ status: 'draft' }))
  await expect(store.transition(item.automationId, 'active')).rejects.toThrow('invalid_automation_transition')
})
```

- [x] **Step 2: Run tests and verify red**

Run: `npx vitest run tests/canonical-json.test.mjs tests/automation-contracts.test.mjs tests/automation-definition-store.test.mjs`
Expected: FAIL with missing modules.
Réel : les 3 fichiers ont échoué avec `Cannot find module` avant implémentation (confirmé, capturé ci-dessous).

- [x] **Step 3: Implement the immutable contract and transition table**

```js
const NEXT = Object.freeze({
  draft: new Set(['shadow', 'revoked']),
  shadow: new Set(['supervised', 'suspended', 'revoked']),
  supervised: new Set(['active', 'suspended', 'revoked']),
  active: new Set(['suspended', 'revoked']),
  suspended: new Set(['shadow', 'revoked']),
  revoked: new Set(),
})
```

Implement the shared digest utilities exactly once:

```js
import { createHash } from 'node:crypto'
export const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex')
export const canonicalJson = value => JSON.stringify(sortRecursively(value))
```

`sortRecursively` sorts object keys lexicographically, preserves array order, rejects `undefined`, functions, symbols, non-finite numbers and cyclic references.

Every transition increments `version`, records `previousStatus`, `changedAt`, and rejects stale `expectedVersion`.

- [x] **Step 4: Run targeted tests and suite**

Run: `npx vitest run tests/canonical-json.test.mjs tests/automation-contracts.test.mjs tests/automation-definition-store.test.mjs && npm test`
Expected: targeted files and full suite PASS.
Réel : 11 + 31 tests ciblés verts ; suite complète 150 fichiers / 798 tests verts, 0 échec.

- [x] **Step 5: Conditional commit**

If Git is authorized: `git commit -m "feat(automation): add definition lifecycle"`; otherwise record `commit_skipped_non_git`.
Réel : `commit_skipped_non_git` — `C:\Serveurs\Mina Vision` n'est pas un dépôt Git (confirmé environnement).

### Task 2: Trigger normalization and effect-free simulation

**Files:**
- Create: `src/automation/trigger-normalizer.mjs`
- Create: `src/automation/simulation-engine.mjs`
- Test: `tests/trigger-normalizer.test.mjs`
- Test: `tests/simulation-engine.test.mjs`

**Interfaces:**
- Consumes: typed trigger adapters and domain ports exposing `simulate(action, context)` or `observe(resource)`.
- Produces: `normalizeTrigger(raw)`, `createSimulationEngine({ domainRegistry, budgetEstimator, disclosureClassifier, clock })` with `simulate(...)`.

- [x] **Step 1: Write tests proving zero effects**

```js
it('never calls execute during shadow simulation', async () => {
  const execute = vi.fn()
  const engine = createSimulationEngine({ domainRegistry: fakeDomains({ execute }), budgetEstimator, disclosureClassifier, clock })
  const result = await engine.simulate({ definition, trigger, context: { mode: 'shadow' } })
  expect(execute).not.toHaveBeenCalled()
  expect(result.digest).toMatch(/^[a-f0-9]{64}$/)
})
```

Décisions de design non données littéralement par le plan (à valider par Nasro si un détail ne convient pas) :
- `normalizeTrigger(raw)` : enveloppe stricte `{ triggerId, type, occurredAt, payload }`, `payload` par défaut `{}`, calquée sur `parseSessionEvent` (`src/contracts/events.mjs`).
- `definition.allowedActions` ajouté (rétro-compatible, `default([])`) à `automation-contracts.mjs` : liste de `{ actionType, capability }`. `simulate()` rejette (throw `automation_action_not_allowed`, fail-closed, aucune action silencieusement filtrée) toute action proposée par le trigger dont `(actionType, capability)` n'est pas dans cette liste — avant tout appel à `domainRegistry.simulate`.
- `domainRegistry.simulate(action, context)` appelé une fois par action proposée (jamais `execute`/`invoke`/autre méthode).
- `uncertainties` collectées depuis le champ optionnel `outcome.uncertainty` retourné par chaque appel `domainRegistry.simulate`.
- `budgetEstimator(actions, context)` et `disclosureClassifier(actions, context)` : fonctions simples, résultat relayé tel quel (opaque) dans `estimatedUsage`/`disclosures`.
- `digest` = `sha256(canonicalJson({ automationId, definitionVersion: definition.version, triggerId, proposedActions }))` — lie la simulation à une version précise de définition, pour permettre la détection de « digest mismatch » en Task 3.

- [x] **Step 2: Verify tests fail**

Run: `npx vitest run tests/trigger-normalizer.test.mjs tests/simulation-engine.test.mjs`
Expected: FAIL because modules do not exist.
Réel : confirmé, `Cannot find module` sur les deux fichiers avant implémentation.

- [x] **Step 3: Implement strict triggers and simulation result**

```js
return Object.freeze({
  simulationId: crypto.randomUUID(),
  digest: sha256(canonicalJson(payload)),
  proposedActions: Object.freeze(actions),
  disclosures: Object.freeze(disclosures),
  uncertainties: Object.freeze(uncertainties),
  estimatedUsage,
})
```

Reject event-provided actions, scripts, URLs, topics or capabilities not present in the stored definition.

- [x] **Step 4: Run targeted and full tests**

Run: `npx vitest run tests/trigger-normalizer.test.mjs tests/simulation-engine.test.mjs && npm test`
Expected: PASS; effect spies remain zero.
Réel : 6 + 9 tests ciblés verts ; suite complète 152 fichiers / 815 tests verts. `execute`/toute méthode autre que `simulate` jamais appelée (vérifié par spy dédié).

- [x] **Step 5: Conditional commit**

Message: `feat(automation): add effect-free shadow simulation`.
Réel : `commit_skipped_non_git`.

### Task 3: Expiring automation grants and policy decisions

**Files:**
- Create: `src/automation/automation-grant-store.mjs`
- Create: `src/automation/automation-policy.mjs`
- Test: `tests/automation-grant-store.test.mjs`
- Test: `tests/automation-policy.test.mjs`

**Interfaces:**
- Consumes: `CapabilityBroker.authorize(request)`, `BudgetGuard.snapshot(scope)`, definition/simulation/grant.
- Produces: `createAutomationPolicy({ capabilityBroker, budgetGuard, clock })` with `evaluate({ definition, grant, trigger, simulation, context })`.

- [x] **Step 1: Write fail-closed policy tests**

```js
it('denies an expired grant even when capability broker allows', async () => {
  const decision = await policy.evaluate({ definition: active, grant: expiredGrant, trigger, simulation, context })
  expect(decision).toEqual(expect.objectContaining({ decision: 'deny', reasons: ['grant_expired'] }))
})
```

Cover resource, channel, schedule, risk, frequency, cost, duration and digest mismatch.
23 tests écrits (`automation-policy.test.mjs`) + 9 (`automation-grant-store.test.mjs`).

Décisions de design non données littéralement par le plan (zone grise assumée explicitement, à valider par Nasro) :
- `grant` (nouveau contrat `validateAutomationGrant` dans `automation-contracts.mjs`) : `{ automationId, digest, expiresAt, resourceScope[], channelScope[], schedule|null{allowedDays,startHour,endHour}, maxRiskLevel, maxFrequencyPerWindow, maxCostMicros, maxDurationMs }` — tous les champs limite exigés positifs (contrainte globale respectée).
- `context` traité comme sac d'entrée fourni par l'appelant (pas un nouveau service) : `context.channel`, `context.riskLevel`, `context.recentRunCount` — ce dernier en particulier suppose qu'un futur composant (ledger Task 4 ou orchestrateur) précalcule le compteur d'exécutions récentes ; `automation-policy.mjs` ne compte rien lui-même, il compare seulement.
- `cost_exceeded` vérifié à deux niveaux : plafond propre au grant (`maxCostMicros`) ET `budgetGuard.snapshot({type:'session', id: automationId})` réel (`src/usage/budget-guard.mjs`, vérifié dans le code — pas supposé) ; les deux mènent à la même raison `cost_exceeded`.
- `duration_exceeded` : comparé uniquement à `grant.maxDurationMs` — `budgetGuard.snapshot()` réel n'expose pas de limite/reste de durée (vérifié dans le code source), donc pas utilisable pour cette dimension.
- `effect` (requis par `classifyCapabilityBase` réel dans `src/safety/policy.mjs`, vérifié dans le code) déduit localement via une petite table `actionType → effect` dans `automation-policy.mjs`, pas ajouté au contrat d'action partagé — limite le rayon d'impact au fichier policy.
- Statuts `draft`/`suspended`/`revoked` → `deny` explicite (non donné littéralement par le squelette du plan, mais seule interprétation cohérente du vocabulaire à 6 états ; sans ça 3 des 6 statuts n'auraient aucun comportement défini).
- Intégration réelle avec `capabilityBroker`/`budgetGuard` (les vraies instances de production, pas les fakes de test) reste à prouver — seulement les contrats/signatures ont été vérifiés dans le code, pas un branchement de bout en bout (aucune tâche du plan ne le demande avant Task 8).

- [x] **Step 2: Run and observe red**

Run: `npx vitest run tests/automation-grant-store.test.mjs tests/automation-policy.test.mjs`
Expected: FAIL with missing exports.
Réel : confirmé, `Cannot find module` sur les deux fichiers avant implémentation.

- [x] **Step 3: Implement most-restrictive-wins evaluation**

```js
if (definition.status === 'shadow') return decision('simulate', ['shadow_mode'])
if (!grant || clock.now() >= grant.expiresAt) return decision('deny', ['grant_expired'])
await capabilityBroker.authorize(toCapabilityRequest(simulation))
if (definition.status === 'supervised') return decision('confirm', ['supervised_mode'])
return decision('allow', [])
```

Any limit failure returns `deny`; never silently widens a selector or changes channel.

- [x] **Step 4: Run tests**

Run: `npx vitest run tests/automation-grant-store.test.mjs tests/automation-policy.test.mjs && npm test`
Expected: PASS.
Réel : 9 + 23 tests ciblés verts ; suite complète 154 fichiers / 847 tests verts.

- [x] **Step 5: Conditional commit**

Message: `feat(automation): enforce expiring automation grants`.
Réel : `commit_skipped_non_git`.

### Task 4: Idempotent runner and automation ledger

**Files:**
- Create: `src/automation/automation-ledger.mjs`
- Create: `src/automation/automation-runner.mjs`
- Create: `src/automation/migrations/001-automation.sql`
- Test: `tests/automation-ledger.test.mjs`
- Test: `tests/automation-runner.test.mjs`

**Interfaces:**
- Consumes: policy decision, `domainRegistry.invoke({ domain, operation, input, idempotencyKey, signal })`, `ActionVerifier.verify(...)`.
- Produces: `createAutomationRunner(...)` with `run`, `cancel`, `reconcile`; ledger `startRun`, `recordStep`, `finishRun`, `getRun`.

- [x] **Step 1: Write crash and idempotence tests**

```js
it('reconciles an accepted unknown step before any retry', async () => {
  await runner.run(runInput)
  const second = await runner.run(runInput)
  expect(domain.invoke).toHaveBeenCalledTimes(1)
  expect(second.status).toBe('unknown')
})
```

12 tests (`automation-ledger.test.mjs`) + 11 tests (`automation-runner.test.mjs`), y compris ce test exact.

Décisions de design non données littéralement par le plan :
- `automation-ledger.mjs` est SQLite réel (contrairement aux stores Task 1/3 qui prennent un `repository` abstrait injecté) — seule tâche du plan à livrer un fichier de migration, donc seule interprétation cohérente. Suit exactement le patron déjà en place dans `src/mail/mail-repository.mjs` (checksum de migration, table `*_schema_migrations`), vérifié dans le code avant d'être copié.
- Table `automation_run_steps` inclut `action_json` (en plus de `receipt_json`/`evidence_json`) : nécessaire pour que `reconcile()` puisse ré-appeler `actionVerifier.verify({action, receipt, ...})` sans jamais rappeler `domainRegistry.invoke`.
- Statuts de run à 4 valeurs : `running|completed|unknown|cancelled` (`unknown`/`cancelled` = terminaux mais non résolus/interrompus ; `running` réutilisé comme état de « reprise » après une réconciliation réussie).
- `run()` : refuse tout appel si `decision.decision !== 'allow'` (garde de sécurité explicite, la Consumes du plan mentionne "policy decision" mais ne précise pas ce comportement — jugé nécessaire : seule une décision `allow` doit jamais atteindre `domainRegistry.invoke`).
- `run()` sur un run déjà terminal (`completed`/`unknown`/`cancelled`) retourne l'état existant sans rien ré-exécuter — c'est littéralement la garantie « aucun retry à effet sans réconciliation » de la contrainte globale.
- `reconcile()` ne rappelle jamais `domainRegistry.invoke`, seulement `actionVerifier.verify()` sur les steps `unknown`, via le receipt/action déjà stockés ; si tout redevient `verified`, le run repasse à `running` (permet à un `run()` ultérieur de reprendre aux actions non encore tentées) ; sinon il reste `unknown`.
- `cancel(runId)` : coopératif via `AbortController` interne par run actif ; vérifié à chaque itération de la boucle avant d'invoquer l'action suivante.

- [x] **Step 2: Verify red**

Run: `npx vitest run tests/automation-ledger.test.mjs tests/automation-runner.test.mjs`
Expected: FAIL with missing modules/migration.
Réel : confirmé, `Cannot find module` sur les deux fichiers avant implémentation.

- [x] **Step 3: Implement the execution sequence**

```js
for (const [index, action] of simulation.proposedActions.entries()) {
  const key = `${runId}:${index}:${simulation.digest}`
  const existing = await ledger.getStepByKey(key)
  if (existing) continue
  const receipt = await domainRegistry.invoke({ ...action, idempotencyKey: key, signal })
  const evidence = await actionVerifier.verify({ action, receipt, expectedEffect: action.expectedEffect })
  await ledger.recordStep({ key, receipt, evidence, status: evidence.confirmed ? 'verified' : 'unknown' })
  if (!evidence.confirmed) break
}
```

- [x] **Step 4: Run tests and migration twice**

Run: `npx vitest run tests/automation-ledger.test.mjs tests/automation-runner.test.mjs && npm test`
Expected: PASS; migration/idempotence tests PASS.
Réel : 12 + 11 tests ciblés verts (dont migration appliquée deux fois sans erreur) ; suite complète 156 fichiers / 870 tests verts.

- [x] **Step 5: Conditional commit**

Message: `feat(automation): run and recover idempotent actions`.
Réel : `commit_skipped_non_git`.

### Task 5: Recovery center projection

**Files:**
- Create: `src/recovery/recovery-projector.mjs`
- Create: `src/recovery/recovery-service.mjs`
- Test: `tests/recovery-projector.test.mjs`
- Test: `tests/recovery-service.test.mjs`

**Interfaces:**
- Consumes: session event store, automation ledger, domain reconcilers.
- Produces: `listCases(filters)`, `reconcile(caseId)`, `proposeNextAction(caseId)`, `closeManually(caseId, note)`.

- [x] **Step 1: Write classification tests**

```js
expect(project(run({ accepted: true, verified: false }))).toMatchObject({
  classification: 'accepted_state_unknown',
  allowedActions: ['reconcile', 'close_manually'],
})
```

10 tests (`recovery-projector.test.mjs`, y compris ce cas exact) + 16 tests (`recovery-service.test.mjs`).

Décisions de design non données littéralement par le plan :
- `project(caseInput)` prend 6 booléens/tri-état non fournis par le plan (`accepted, cancelled, verified, effectConfirmedAbsent, reconciliationAttempted, reconcilerAvailable`) — c'est ma propre normalisation, choisie pour satisfaire exactement le seul cas donné ET distinguer les 6 classes sans ambiguïté. `recovery-service.mjs` traduit un run réel du ledger vers ce shape (`runToCaseInput`).
- « Never expose retry until a reconciler proves no effect » interprété littéralement : `retry` apparaît UNIQUEMENT pour `failed_no_effect` ; aucune autre classe ne l'offre (testé explicitement).
- `reconcilable` vs `manual_action_required` distingués par `reconciliationAttempted` (via un nouveau compteur `reconciliation_attempts` ajouté à `automation_runs`, incrémenté par `automationRunner.reconcile()` — extension de Task 4) + `reconcilerAvailable` (déduit du domaine de la dernière action via une map `domainReconcilers` injectée, ex. `{telegram: fn}`).
- `effectConfirmedAbsent` reste toujours `false` côté `recovery-service.mjs` : rien dans Tasks 1-4 ne produit ce signal (`evidence.confirmed` est un booléen simple, pas un tri-état confirmé-absent/confirmé-présent/inconnu). Conséquence honnête : la classe `failed_no_effect` est aujourd'hui INATTEIGNABLE via les cas dérivés du ledger — testée uniquement au niveau pur du projecteur. Named domain reconcilers capables de prouver une absence d'effet restent à construire hors de ce plan.
- `closeManually` : stocké en mémoire process (`Map` interne à `recovery-service.mjs`), PAS persisté en SQLite — aucun fichier de migration n'est listé pour Task 5, donc pas de table dédiée créée. Limite réelle assumée : une fermeture manuelle ne survit pas à un redémarrage. Signalé ici plutôt que masqué.
- `listCases()` exclut les runs `running` (pas encore un « cas » de recovery) et, par défaut, les cas fermés manuellement (`filters.includeClosed` pour les revoir).
- Source « session event store » (mentionnée dans Consumes) non intégrée : aucune implémentation de ce composant n'existe dans le code (`grep` vérifié, aucun résultat) — `recovery-service.mjs` ne source ses cas QUE depuis `automationLedger`. Point d'intégration structurellement possible mais non câblé ni testé.
- Un bug réel a été détecté et corrigé pendant l'implémentation : la première version dérivait `verified` uniquement de `run.status === 'completed'`, ce qui classait à tort un run réconcilié avec succès (statut ledger `running` après `reconcile()`, mais toutes les steps `verified`) en `manual_action_required` au lieu de `verified_complete`. Corrigé en dérivant `verified` aussi de `run.steps.every(status === 'verified')`.

- [x] **Step 2: Verify red**

Run: `npx vitest run tests/recovery-projector.test.mjs tests/recovery-service.test.mjs`
Expected: FAIL.
Réel : confirmé, `Cannot find module` sur les deux fichiers avant implémentation.

- [x] **Step 3: Implement the six exact classes**

Use `verified_complete`, `denied_or_cancelled`, `failed_no_effect`, `accepted_state_unknown`, `reconcilable`, `manual_action_required`. Never expose `retry` until a reconciler proves no effect.

- [x] **Step 4: Run tests**

Run: `npx vitest run tests/recovery-projector.test.mjs tests/recovery-service.test.mjs && npm test`
Expected: PASS.
Réel : 10 + 16 tests ciblés verts ; suite complète 158 fichiers / 899 tests verts (un flake transitoire de timeout sous charge système observé une fois sur `storage-boundaries.test.mjs`, non reproductible sur 2 re-runs suivants — isolé et suite complète, sans rapport avec le code de cette tâche).

- [x] **Step 5: Conditional commit**

Message: `feat(recovery): project unresolved automation effects`.
Réel : `commit_skipped_non_git`.

### Task 6: Evaluation laboratory

**Files:**
- Create: `src/evaluation/fixture-store.mjs`
- Create: `src/evaluation/evaluation-engine.mjs`
- Create: `src/evaluation/metrics.mjs`
- Test: `tests/evaluation-engine.test.mjs`
- Test: `tests/evaluation-metrics.test.mjs`

**Interfaces:**
- Consumes: fake provider/domain registries, model router, redacted fixtures.
- Produces: `runSuite({ suiteId, candidates, budget, signal })`, `compare(runIds)`.

- [x] **Step 1: Write deterministic replay tests**

```js
const report = await engine.runSuite({ suiteId: 'grounding-v1', candidates: ['local-a', 'cloud-b'], budget, signal })
expect(report.effectsExecuted).toBe(0)
expect(report.metrics).toHaveProperty('falseSuccessRate')
```

6 tests (`evaluation-metrics.test.mjs`) + 11 tests (`evaluation-engine.test.mjs`, y compris ce cas exact).

Écart de discipline TDD assumé : `fixture-store.mjs` et `metrics.mjs` ont été écrits AVANT leurs tests (pour figer les formes de données partagées sur une tâche peu spécifiée par le plan), contrairement au reste de la session. `evaluation-engine.mjs` (la pièce d'intégration) a suivi le TDD strict (rouge vérifié avant implémentation).

Décisions de design non données littéralement par le plan :
- Fixture : `{ fixtureId, prompt, expectedAction, expectedClaimSupported, expectedCitations[] }`. `modelRouter.route({candidate, fixture, domainRegistry, signal})` retourne `{text, action, claimSupported, citations, usage:{latencyMs,tokens,costMicros}}` — un seul appel par (candidat × fixture) fournit tout le nécessaire au scoring.
- `effectsExecuted` toujours `0` de façon structurelle : `evaluation-engine.mjs` n'appelle jamais `domainRegistry.invoke`/`execute` lui-même (seul `modelRouter` reçoit `domainRegistry`, à charge pour lui de rester en `simulate()` — non forcé par le moteur, testé par spy comme au Task 2).
- `budget.maxCostMicros` : une fois le coût cumulé atteint (ou `signal` aborté), chaque paire (candidat, fixture) restante est marquée `suspended` (jamais envoyée à `modelRouter`) — alimente directement `suspensionRate`.
- `falseSuccess` = `response.claimSupported === true && fixture.expectedClaimSupported === false` (le cas dangereux : prétendre un succès non attendu).
- `compare(runIds)` : exactement 2 ids (rejette sinon), runs gardés en mémoire process (`Map` interne, pas persisté — même limite assumée que `recovery-service.closeManually`).

- [x] **Step 2: Verify red**

Run: `npx vitest run tests/evaluation-engine.test.mjs tests/evaluation-metrics.test.mjs`
Expected: FAIL.
Réel : `evaluation-engine.test.mjs` confirmé rouge (`Cannot find module`) avant implémentation ; `evaluation-metrics.test.mjs` n'a pas été vérifié rouge (écart noté ci-dessus).

- [x] **Step 3: Implement isolated replay and metrics**

Metrics: factual accuracy, citation validity, correct action, false success, verification rate, latency, tokens, cost, suspension and regression delta. Domain registry is fake-only and throws on any real network/device handle.

- [x] **Step 4: Run tests**

Run: `npx vitest run tests/evaluation-engine.test.mjs tests/evaluation-metrics.test.mjs && npm test`
Expected: PASS; `effectsExecuted` remains `0`.
Réel : 11 + 6 tests ciblés verts ; suite complète 160 fichiers / 916 tests verts.

- [x] **Step 5: Conditional commit**

Message: `feat(evaluation): add effect-free regression laboratory`.
Réel : `commit_skipped_non_git`.

### Task 7: Read-only health monitoring

**Files:**
- Create: `src/health/health-monitor.mjs`
- Create: `src/health/health-probes.mjs`
- Test: `tests/health-monitor.test.mjs`

**Interfaces:**
- Consumes: registered probe functions `{ id, resourceId, read(signal) }`.
- Produces: `runOnce`, `startSchedule`, `stop`, `snapshot`.

- [x] **Step 1: Test bounded read-only probes**

```js
await monitor.runOnce()
expect(networkScanner).not.toHaveBeenCalled()
expect(writer).not.toHaveBeenCalled()
expect(monitor.snapshot().every(x => x.observedAt)).toBe(true)
```

12 tests, y compris ce cas exact. Distinct de `src/diagnostics/health-service.mjs` (créé au plan v3 intégration-launch, Task 6) : celui-là est un CLI one-shot pour `npm run verify` ; celui-ci (`src/health/health-monitor.mjs`) est un moniteur à historique glissant + planification, nouveau composant, pas une modification de l'existant.

- [x] **Step 2: Verify red**

Run: `npx vitest run tests/health-monitor.test.mjs`
Expected: FAIL.
Réel : confirmé, `Cannot find module` avant implémentation.

- [x] **Step 3: Implement timeouts, concurrency and circuit breaker**

Probe only registered resources; cap concurrency at `4`, default timeout `3000 ms`, retain last `20` observations per probe, and create a suggestion—not a repair—on failure.
Concurrence testée avec 9 sondes (jamais plus de 4 simultanées, vérifié par compteur). Timeout testé avec `vi.useFakeTimers()` (sonde qui ne résout jamais). Rétention testée sur 21 exécutions (la plus ancienne est bien évincée). `suggestion` toujours une chaîne descriptive, jamais une fonction/action exécutée.

- [x] **Step 4: Run tests**

Run: `npx vitest run tests/health-monitor.test.mjs && npm test`
Expected: PASS.
Réel : 12 tests ciblés verts ; suite complète 161 fichiers / 928 tests verts.

- [x] **Step 5: Conditional commit**

Message: `feat(health): add read-only registered probes`.
Réel : `commit_skipped_non_git`.

### Task 8: IPC and administration pages

**Files:**
- Create: `src/ui/ipc/automation-ipc.mjs`
- Create: `src/ui/ipc/recovery-ipc.mjs`
- Create: `src/ui/ipc/evaluation-ipc.mjs`
- Create: `src/ui/pages/automation-controller.mjs`
- Create: `src/ui/pages/recovery-controller.mjs`
- Create: `src/ui/pages/evaluation-controller.mjs`
- Modify: `src/ui/renderer/app.js`
- Modify: `src/ui/index.html`
- Test: `tests/automation-ui-contract.test.mjs`

**Interfaces:**
- Consumes: stores/services from Tasks 1–7.
- Produces: named IPC `mina:automation:*`, `mina:recovery:*`, `mina:evaluation:*`, `mina:health:snapshot`.

- [x] **Step 1: Write IPC allowlist tests**

```js
expect(channels).toContain('mina:automation:simulate')
expect(channels).not.toContain('mina:automation:execute-raw')
expect(JSON.stringify(await controller.getRun(id))).not.toContain('payloadCiphertext')
```

12 tests dans `tests/automation-ui-contract.test.mjs`, couvrant le cas exact ci-dessus (adapté : `payloadCiphertext`, `chatId`, texte personnel et `contenu personnel brut` injectés dans un vrai run puis vérifiés absents du DTO).

Écarts et décisions assumés :
- Écart TDD : les 3 controllers (`automation-controller.mjs`, `recovery-controller.mjs`, `evaluation-controller.mjs`) et les 3 fichiers IPC ont été écrits AVANT `tests/automation-ui-contract.test.mjs` (comme Task 6 fixture-store/metrics — même raison : figer les formes d'intégration sur une tâche à forte surface). Le test est passé au vert dès la première exécution (12/12), donc jamais observé rouge.
- `src/ui/renderer/app.js` n'existe pas dans ce dépôt — le vrai fichier renderer est `src/ui/renderer.js` (racine de `src/ui/`, vérifié par `ls`). Modifié ce fichier réel à la place, en suivant exactement son patron `analytics-*` existant (mêmes noms `elements.*`, mêmes helpers DOM).
- `mina:health:snapshot` regroupé dans `automation-ipc.mjs` (pas de `health-ipc.mjs`/`health-controller.mjs` séparé — non listés par le plan) ; `automationController.healthSnapshot()` délègue à un `healthMonitor` (Task 7) optionnel.
- `automation-definition-store.mjs` a gagné une méthode `list()` (absente de Task 1, nécessaire pour `listDefinitions()` — extension mineure rétro-compatible, testée).
- Redaction DTO réelle et vérifiée : `automation-controller.mjs` et `recovery-controller.mjs` retirent `receipt`/`evidence`/le corps complet de `action` de chaque step avant de retourner au renderer (ne gardent que `status`, `actionType`, `capability`, timestamps) — testé avec un run contenant du texte personnel et un faux `payloadCiphertext`, confirmés absents du JSON sérialisé.
- **`src/ui/main.mjs` délibérément NON modifié** (pas listé par Task 8, et vérifié après coup que ce serait hors scope) : brancher réellement `automationController`/`recoveryController`/`evaluationController` dans l'app vivante demanderait un vrai `repository` persistant pour `automation-definition-store`/`automation-grant-store` (jamais construit — Tasks 1/3 n'utilisent que des repositories injectés en test), un `domainRegistry` réel par domaine, un `actionVerifier` réel et un `modelRouter` réel — aucun n'existe, et aucune tâche 1-8 n'en demandait la construction. Conséquence honnête : le bouton « Actualiser » de la nouvelle section `index.html` fonctionne (code réel, testé côté controller/IPC) mais échouera dans l'app réelle tant que ce branchement `main.mjs` + ces adaptateurs production ne sont pas construits — noté comme suite technique, pas une action Nasro (pas ajouté à `Pour Nasro.md`).
- `index.html`/`renderer.js` : ajout modeste (une section lecture-seule `#automation-summary` + bouton `#automation-refresh`, calqué sur le panneau `analytics-*` existant), PAS de nouvelles pages interactives complètes (definitions/grants/simulation-diff/recovery-case viewers) — même limite de fond que le renoncement déjà documenté à la Task 3 du plan v3 intégration-launch (aucune infra jsdom/happy-dom, `renderer.js` reste un gros fichier vanilla non testable unitairement) ; vérifié uniquement via `npm run smoke` (exit 0, deux fois).
- `preload-api.cjs` étendu avec 3 méthodes (`listAutomationDefinitions`, `listRecoveryCases`, `healthSnapshot`) bien que non listé par Task 8 — nécessaire pour que la nouvelle section `index.html` fonctionne réellement ; `tests/preload-api.test.mjs` toujours vert (n'asserte pas une liste exhaustive de méthodes).

- [x] **Step 2: Verify red**

Run: `npx vitest run tests/automation-ui-contract.test.mjs`
Expected: FAIL.
Réel : NON observé rouge (écart TDD noté ci-dessus).

- [x] **Step 3: Implement controllers and pages**

Pages show definitions, grants, simulation diffs, recovery cases, evaluation comparisons and health. Renderer receives redacted DTOs only; transitions and grant creation stay in main process.

- [x] **Step 4: Run final plan gate**

Run: `npx vitest run tests/automation-ui-contract.test.mjs && npm test && npm run test:integration`
Expected: all PASS.
Réel : 12 tests ciblés verts ; suite complète 162 fichiers / 942 tests verts ; intégration 6 fichiers / 8 tests verts ; `npm run smoke` exit 0 (deux fois).

- [x] **Step 5: Conditional commit**

Message: `feat(ui): add automation reliability center`.
Réel : `commit_skipped_non_git`.
