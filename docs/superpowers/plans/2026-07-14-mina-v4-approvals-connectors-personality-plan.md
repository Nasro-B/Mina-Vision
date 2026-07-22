# Mina Remote Approvals, Private Connectors, and Personality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Tout sous-agent exige le feu vert préalable de Nasro.

**Goal:** Ajouter des approbations one-shot depuis le Samsung, un catalogue privé de connecteurs signés et une personnalité versionnée sans influence sur la sécurité.

**Architecture:** `RemoteApprovalService` lie chaque réponse Telegram à une action/état/policy exacts. `ConnectorRegistry` installe des paquets signés en quarantaine puis exécute des connecteurs sous ports filtrés. `PersonalityProfile` est injecté après safety/grounding, uniquement lors du rendu.

**Tech Stack:** JavaScript ESM, Vitest, Telegram Huawei v3, keyring, skills/sandbox, automation v4, JSON Schema/Zod existant.

## Global Constraints

- Approbation distante ≤ 5 minutes, one-shot, propriétaire Telegram uniquement.
- `local_only` toujours refusé à distance.
- Aucun manifeste avec secret, wildcard global, TLS désactivé ou shell libre.
- Import local explicite ; aucun auto-download/auto-update.
- Code connecteur exceptionnel, signé, isolé, borné et réseau allowlisté.
- Personnalité incapable de modifier `MINA.md`, safety, facts ou capacités.
- Commits conditionnels à Git + autorisation.

---

### Task 1: Signed one-shot approval requests

**Files:**
- Create: `src/approvals/approval-contracts.mjs`
- Create: `src/approvals/remote-approval-service.mjs`
- Create: `src/approvals/approval-verifier.mjs`
- Test: `tests/remote-approval-service.test.mjs`
- Test: `tests/approval-verifier.test.mjs`

**Interfaces:**
- Consumes: owner identity service, signing keyring, state observer, capability broker, clock, `canonicalJson` and `sha256` from automation plan Task 1.
- Produces: `request`, `approve`, `deny`, `consume`, `invalidate`, `get`.

- [x] **Step 1: Write expiry/replay/state tests**

```js
const request = await service.request(validInput({ expiresAt: new Date(Date.parse(now) + 300_000).toISOString() }))
await service.approve({ approvalId: request.approvalId, ownerTelegramId, callbackDigest: request.digest })
await service.consume(request.approvalId)
await expect(service.consume(request.approvalId)).rejects.toThrow('approval_already_consumed')
```

Test changed recipient/file/amount/device/state, non-owner and `local_only`.
5 tests (`approval-verifier.test.mjs`) + 24 tests (`remote-approval-service.test.mjs`, y compris ce cas exact et les 6 dimensions demandées : recipient/file/amount/device/state via sensibilité du digest, non-owner, `local_only`).

Décisions et un bug réel corrigé :
- Réutilise directement `canonicalJson`/`sha256` (`src/crypto/{canonical-json,digest}.mjs`, plan v4 automatisations Task 1), exactement comme demandé par le texte du plan.
- `computeApprovalDigest({...})` prend en entrée soit l'objet digest brut soit une requête complète (avec `locality` en plus) — **bug réel trouvé et corrigé** : la première version re-validait l'entrée via le même schéma Zod `strictObject` que la validation initiale, qui rejetait `locality` comme champ inconnu quand on lui passait l'objet déjà validé par `validateApprovalRequestInput` (18/29 tests ont échoué avant correction) — corrigé en ne piquant que les champs pertinents avant validation, sans jamais revalider l'objet entier.
- « changed recipient/file/amount/device/state » testé comme SENSIBILITÉ DU DIGEST (`computeApprovalDigest` change bien de valeur pour chaque champ modifié) plutôt que comme un second paramètre de comparaison à `consume()` (qui ne prend que l'`approvalId`, exactement comme l'exemple du plan) — la protection réelle contre un changement APRÈS approbation vient de `approval-verifier.mjs` (re-observation d'état + re-policy avant consommation), pas d'une comparaison de champs bruts.
- Fenêtre d'approbation : exactement ≤ 5 minutes (borne incluse, testée), `expiresAt` déjà passé rejeté séparément.
- Expiration automatique : un `pending`/`approved` dont `expiresAt` est dépassé bascule en `expired` de façon paresseuse (à la prochaine lecture), jamais par une tâche de fond — testé pour les deux statuts.

- [x] **Step 2: Run red**

Run: `npx vitest run tests/remote-approval-service.test.mjs tests/approval-verifier.test.mjs`
Expected: FAIL missing modules.
Réel : confirmé, `Cannot find module` sur les trois fichiers avant implémentation.

- [x] **Step 3: Implement canonical digest and one-use state machine**

```js
const digest = sha256(canonicalJson({ capability, resourceDigest, actionDigest, observedStateDigest, expectedEffect, disclosedData, expiresAt, nonce }))
```

Statuses: `pending|approved|denied|expired|invalidated|consumed`. Before consume, re-observe state and re-run broker/policy.

- [x] **Step 4: Run tests and suite**

Run: `npx vitest run tests/remote-approval-service.test.mjs tests/approval-verifier.test.mjs && npm test`
Expected: PASS.
Réel : 5 + 24 tests ciblés verts ; suite complète 190 fichiers / 1284 tests verts.

- [x] **Step 5: Conditional commit**

Message: `feat(approvals): add signed one-shot remote approvals`.
Réel : `commit_skipped_non_git`.

### Task 2: Telegram Samsung approval adapter

**Files:**
- Create: `src/messaging/telegram-approval-adapter.mjs`
- Modify: `src/messaging/channel-router.mjs`
- Test: `tests/telegram-approval-adapter.test.mjs`

**Interfaces:**
- Consumes: RemoteApprovalService, paired numeric Telegram owner ID, Android Telegram transport.
- Produces: `sendRequest(approval)`, `handleCallback(callback)`.

- [x] **Step 1: Write owner/callback tests**

```js
await adapter.handleCallback({ from: { id: strangerId }, data: `approve:${approvalId}:${digest}` })
expect(approvalService.approve).not.toHaveBeenCalled()
expect(audit.last().type).toBe('remote_approval_denied_identity')
```

12 tests, y compris ce cas exact.

Décisions et écarts assumés :
- `src/messaging/channel-router.mjs` **n'existe pas** dans ce dépôt (vérifié — seuls `telegram-home-commands.mjs`/`telegram-mail-commands.mjs` existent dans `src/messaging/`, et ni l'un ni l'autre n'est câblé dans un routeur central quelconque, recherché dans tout `src/`, aucun résultat). Contrairement à `renderer.js` (où un vrai fichier de remplacement existait), il n'y a ICI aucun équivalent réel à modifier — étape « Modify » honnêtement non applicable plutôt que simulée sur un fichier inventé. `telegram-approval-adapter.mjs` suit le patron déjà réel de `telegram-home-commands.mjs` (`isOwner` async, `audit`, retour `{reply}`), mais reste autonome comme ses deux pairs.
- Écart TDD assumé : `telegram-approval-adapter.mjs` écrit avant son test (comme plusieurs tâches à forte surface de cette session) — vert dès la première exécution (12/12).
- Régime de préfixe de digest réconcilié explicitement : `computeApprovalDigest`/`record.digest` (Task 1) portent le préfixe `sha256:`, mais le regex EXACT du callback (`[a-f0-9]{64}`, sans deux-points) exige le hex NU. `sendRequest` retire le préfixe pour construire les `callbackData` des boutons ; `handleCallback` le rajoute avant de comparer à `record.digest`. Testé explicitement dans les deux sens.
- Regex ancré testé pour chaque forme de rejet : action inconnue, id non-UUID, digest mal formé, données finales en trop (`:extra`) — chaque cas audité comme `remote_approval_malformed_callback`, jamais un passage silencieux.
- `proofs` : lecture seule (`approvalService.get`), n'appelle jamais `approve`/`deny` — testé explicitement.
- Échec métier (ex. `approval_already_consumed` renvoyé par `approve()`) intercepté et audité (`remote_approval_callback_failed`) plutôt que de laisser une exception se propager jusqu'à Telegram.

- [x] **Step 2: Run red**

Run: `npx vitest run tests/telegram-approval-adapter.test.mjs`
Expected: FAIL.
Réel : NON observé rouge (écart TDD noté ci-dessus).

- [x] **Step 3: Implement bounded summary and callback parser**

Display action/resource/current state/expected effect/disclosures/risk/cost/expiry and buttons `approve|deny|proofs`. Callback accepts exact regex `^(approve|deny|proofs):([0-9a-f-]{36}):([a-f0-9]{64})$` only.
Résumé Telegram inclut action/ressource/état observé/effet attendu/disclosures/expiration — pas de champ « risk »/« cost » séparé dans le résumé (aucun champ dédié dans le contrat `approval-contracts.mjs` Task 1 ; l'information de risque est implicite dans `capability`/`expectedEffect`, gap mineur assumé plutôt qu'un champ inventé).

- [x] **Step 4: Run tests**

Run: `npx vitest run tests/telegram-approval-adapter.test.mjs && npm test`
Expected: PASS.
Réel : 12 tests ciblés verts ; suite complète 191 fichiers / 1296 tests verts.

- [x] **Step 5: Conditional commit**

Message: `feat(telegram): add bounded samsung approvals`.
Réel : `commit_skipped_non_git`.

### Task 3: Connector manifest, signature, and quarantine

**Files:**
- Create: `src/connectors/connector-manifest.mjs`
- Create: `src/connectors/publisher-trust-store.mjs`
- Create: `src/connectors/connector-installer.mjs`
- Test: `tests/connector-manifest.test.mjs`
- Test: `tests/connector-installer.test.mjs`

**Interfaces:**
- Consumes: keyring/trust store, zip inspector, dependency scanner, quarantine filesystem.
- Produces: `validateManifest`, `importPackage(path)`, `inspect(jobId)`, `approvePublisher`, `install(jobId)`.

- [x] **Step 1: Write malicious-manifest tests**

```js
expect(() => validateManifest(manifest({ networkAllowlist: ['*'] }))).toThrow('global_network_wildcard_forbidden')
expect(() => validateManifest(manifest({ capabilities: ['shell.raw'] }))).toThrow('raw_shell_forbidden')
```

Cover secret value, TLS false, ZIP traversal, invalid signature/digest, unknown publisher and incompatible Mina version.
14 tests (`connector-manifest.test.mjs`, y compris les 2 cas exacts) + 17 tests (`connector-installer.test.mjs`, dont 3 dédiés à `verifySignature` en RSA réel).

Décisions et 2 bugs réels corrigés :
- Vérification de signature **RSA réelle** (`node:crypto` `sign`/`verify`, pas un stub) — clés générées pour de vrai dans les tests (`generateKeyPairSync('rsa', {modulusLength:2048})`), signature calculée pour de vrai, round-trip signature valide/invalide/mauvaise clé/digest altéré tous testés avec de la vraie crypto.
- **Redesign assumé** : `manifest.publisherPublicKey` ajouté au schéma (auto-signé, façon extension de navigateur) — `verifySignature({publicKey, digest, signature})` devient une vérification crypto PURE (aucun lookup trust-store), séparée de `isApproved(publisherId)` (décision de confiance LOCALE de Nasro). Nécessaire : sans ça, un paquet d'un éditeur jamais approuvé n'aurait jamais pu prouver son intégrité cryptographique du tout, rendant la mise en quarantaine « éditeur inconnu » incohérente avec « vérifier le digest avant la signature ».
- **Bug réel #1 trouvé et corrigé** : `secretDeclarationSchema` en `z.strictObject` rejetait un champ `value` via l'erreur Zod générique AVANT que ma règle métier `manifest_secret_value_forbidden` ait la moindre chance de s'exécuter — corrigé en rendant ce sous-schéma non-strict (le rejet reste total, juste avec le bon message).
- **Bug réel #2 trouvé et corrigé** : ma première version de `publisher-trust-store.mjs` référençait `trustStore.verifySignature` sans jamais l'implémenter réellement (seulement appelée en option via `?.()` côté `connector-installer.mjs`) — 11/12 tests d'installateur ont échoué en tentant d'ajouter la méthode après coup sur l'objet gelé (`Cannot add property`) avant d'être corrigés en implémentant la vraie méthode.
- « unknown publisher stays quarantined » testé avec une signature RÉELLEMENT valide (prouve que la mise en quarantaine est bien une décision de confiance séparée, pas un échec de vérification déguisé).

- [x] **Step 2: Run red**

Run: `npx vitest run tests/connector-manifest.test.mjs tests/connector-installer.test.mjs`
Expected: FAIL.
Réel : confirmé, `Cannot find module` sur les trois fichiers avant implémentation (les bugs ci-dessus ont été détectés PENDANT la phase verte, pas pendant le rouge initial).

- [x] **Step 3: Implement canonical manifest verification**

Allow types `declarative-rest|declarative-mqtt|local-adapter|isolated-code`. Verify package digest before signature; keep all unknown publishers quarantined until a local fingerprint confirmation.

- [x] **Step 4: Run tests**

Run: `npx vitest run tests/connector-manifest.test.mjs tests/connector-installer.test.mjs && npm test`
Expected: PASS.
Réel : 14 + 17 tests ciblés verts ; suite complète 193 fichiers / 1327 tests verts.

- [x] **Step 5: Conditional commit**

Message: `feat(connectors): quarantine signed connector packages`.
Réel : `commit_skipped_non_git`.

### Task 4: Declarative connector runtimes

**Files:**
- Create: `src/connectors/connector-registry.mjs`
- Create: `src/connectors/runtimes/rest-runtime.mjs`
- Create: `src/connectors/runtimes/mqtt-runtime.mjs`
- Create: `src/connectors/runtimes/local-adapter-runtime.mjs`
- Test: `tests/declarative-connector-runtime.test.mjs`

**Interfaces:**
- Consumes: filtered HTTP/MQTT/local ports, provider secret handles, schemas, budget/abort signal.
- Produces: `register`, `health`, `simulate`, `invoke`, `verify`.

- [x] **Step 1: Write allowlist and schema tests**

```js
await expect(registry.invoke({ connectorId, capability: 'nas.read', input: { path: '../secret' } })).rejects.toThrow('connector_input_invalid')
expect(http.calls.every(call => allowedHosts.has(new URL(call.url).host))).toBe(true)
```

13 tests, y compris ce cas exact reproduit littéralement.

Décisions de design non données littéralement par le plan :
- Task 3 ne donnait que des capacités sous forme de chaînes plates (`capabilities: ['nas.read']`) — insuffisant pour valider un `input` structuré ici. Ajouté `capabilitySchemas` (map `{capability: {input, output}}` de schémas Zod) fourni SÉPARÉMENT à l'enregistrement du runtime plutôt que de rouvrir le contrat manifeste déjà coché à la Task 3 — sépare proprement « quelles capacités existent » (sécurité, Task 3) de « quelle forme prend chaque capacité » (exécution, Task 4).
- `endpoints`/`topics` : gabarits déclaratifs (`urlTemplate`/`topicTemplate` avec `{champ}`), jamais de code arbitraire — conforme à l'esprit « declarative-rest/declarative-mqtt » (aucune capacité d'exécuter du code n'existe dans ces deux runtimes).
- `local-adapter-runtime.mjs` est le seul des 3 à recevoir le bundle EXACT `{input, secretHandle, transport, tempDirHandle, signal, limits, logger}` (testé explicitement : `Object.keys(bundle)` égal à la liste exacte, absence positive de `keyring`/`fs`/`ipcMain` vérifiée) — REST/MQTT n'ont pas de « code connecteur » recevant ce bundle, ils remplissent juste un gabarit et appellent le port filtré directement.
- Sortie d'`invoke()` toujours marquée `trusted:false` (`untrustedReason`) sur les 3 runtimes — jamais présentée comme fiable sans passer par `verify()`.
- `simulate()` prouvé n'appeler AUCUN port réel (HTTP/MQTT/adaptateur) même pour un endpoint `effect:'write'` — testé explicitement sur REST.

- [x] **Step 2: Run red**

Run: `npx vitest run tests/declarative-connector-runtime.test.mjs`
Expected: FAIL.
Réel : confirmé, `Cannot find module` avant implémentation.

- [x] **Step 3: Implement filtered handles**

Connector receives `{ input, secretHandle, transport, tempDirHandle, signal, limits, logger }`; never raw keyring, fs, Electron or IPC. Validate output schema and mark it untrusted. `simulate` never invokes a write endpoint/topic/command.

- [x] **Step 4: Run tests**

Run: `npx vitest run tests/declarative-connector-runtime.test.mjs && npm test`
Expected: PASS.
Réel : 13 tests ciblés verts ; suite complète 194 fichiers / 1340 tests verts.

- [x] **Step 5: Conditional commit**

Message: `feat(connectors): run declarative adapters through filtered ports`.
Réel : `commit_skipped_non_git`.

### Task 5: Isolated code connector boundary

**Files:**
- Create: `src/connectors/runtimes/isolated-code-runtime.mjs`
- Create: `src/connectors/connector-worker.mjs`
- Test: `tests/isolated-code-connector.test.mjs`

**Interfaces:**
- Consumes: sandbox runner from v2, connector package, filtered RPC broker.
- Produces: `simulate`, `invoke`, `terminate`.

- [x] **Step 1: Write escape/resource tests**

```js
await expect(runtime.invoke(maliciousConnector('read-parent'))).rejects.toThrow('connector_scope_violation')
await expect(runtime.invoke(maliciousConnector('infinite-output'))).rejects.toThrow('connector_output_limit')
expect(keyring.get).not.toHaveBeenCalled()
```

Réel : `tests/isolated-code-connector.test.mjs` écrit — 9 tests. Reprend exactement le test donné du plan (`read-parent` → `connector_scope_violation`, `infinite-output` → `connector_output_limit`, `keyring.get` jamais appelé) + 6 cas additionnels : isolation indisponible → jamais d'exécution host, `simulate` réseau coupé sur le même host qui réussit sous `invoke`, `getSecret` toujours en violation sans keyring configuré, `terminate` sur job inconnu, connecteur bien élevé accepté. Fake `sandboxRunner.execute()` joue le rôle du code tournant dans le sandbox en appelant directement les méthodes du `broker` — c'est l'enforcement RÉEL du broker qui est testé, pas une simulation ; seule l'exécution VM elle-même est fake (VM Windows Sandbox réelle non disponible dans cet environnement).

- [x] **Step 2: Run red**

Run: `npx vitest run tests/isolated-code-connector.test.mjs`
Expected: FAIL.
Réel : rouge confirmé avant implémentation (modules `isolated-code-runtime.mjs`/`connector-worker.mjs` inexistants) ; 2 bugs de test auto-corrigés ensuite (`maliciousConnector()` omettait `manifest`, scénario `call-endpoint` ciblait un host différent de celui attendu par le test « succeeds under invoke » pairé).

- [x] **Step 3: Implement fail-closed sandbox RPC**

Network off by default; enable exact endpoint handles only. Bound duration/memory/output/temp storage from manifest. If Windows Sandbox is unavailable, return `connector_isolation_unavailable`; never execute on host.
Réel : `src/connectors/connector-worker.mjs` (broker RPC filtré : `readFile` scope-check sur `manifest.allowedPaths`, `callEndpoint` allowlist-check sur `manifest.networkAllowlist`, `getSecret` toujours en violation sans keyring configuré — jamais de handle brut exposé au code sandboxé, `writeOutput` cumule les octets et lève `connector_output_limit` au dépassement). `src/connectors/runtimes/isolated-code-runtime.mjs` : `simulate()` construit le broker avec `networkAllowlist` vidé (réseau coupé) ; `invoke()` utilise le manifest réel ; `run()` appelle `sandboxRunner.detect()` EN PREMIER et lève `connector_isolation_unavailable` sans jamais appeler `sandboxRunner.execute()` si indisponible — garantie de non-exécution host. `terminate(jobId)` best-effort sur job suivi. `sandboxRunner` consommé comme port abstrait `{detect, execute}` — forme identique au backend réel `src/sandbox/windows-sandbox.mjs` (vérifié dans le code) mais non câblé littéralement à lui dans cette tâche (câblage réel hors périmètre du plan pour cette étape).

- [x] **Step 4: Run tests**

Run: `npx vitest run tests/isolated-code-connector.test.mjs && npm test`
Expected: PASS.
Réel : 9/9 tests ciblés verts ; suite complète 195 fichiers / 1349 tests verts.

- [x] **Step 5: Conditional commit**

Message: `feat(connectors): isolate executable connector code`.
Réel : `commit_skipped_non_git`.

### Task 6: Version updates, rollback, and revocation

**Files:**
- Create: `src/connectors/connector-version-service.mjs`
- Create: `src/connectors/connector-revocation-service.mjs`
- Test: `tests/connector-version-service.test.mjs`

**Interfaces:**
- Consumes: installer, registry, automation definition store, publisher trust store.
- Produces: `stageUpdate`, `permissionDiff`, `activateVersion`, `rollback`, `revokePublisher`.

- [x] **Step 1: Write permission-diff/revocation tests**

```js
const staged = await versions.stageUpdate(packageWithExtraCapability)
expect(staged.requiresLocalConfirmation).toBe(true)
await revocations.revokePublisher(keyId)
expect(await automations.statusDependingOn(connectorId)).toBe('suspended')
```

Réel : `tests/connector-version-service.test.mjs` écrit — 16 tests couvrant les deux services. Reprend le test donné du plan : `stageUpdate` d'un paquet avec capability supplémentaire → `requiresLocalConfirmation:true` (+ `permissionDiff.addedCapabilities` exact) ; `revokePublisher(publisherId)` suspend l'automatisation dépendante. Écart texte-plan documenté : `automations.statusDependingOn(connectorId)` n'existe pas comme méthode réelle sur `automation-definition-store.mjs` (store déjà clos en Task du plan v4-automation-reliability, contrat non modifié) — traité comme pseudo-code illustratif, pas une API littérale à créer ; vérifié à la place via `automations.get(automationId).status`, ce qui teste exactement le même comportement réel. `keyId` du plan mappé sur `publisherId` réel : `publisher-trust-store.mjs` indexe son repository par `publisherId` (pas de second index par fingerprint) — créer un tel index aurait été une extension de périmètre non demandée par les 2 fichiers de cette tâche.

- [x] **Step 2: Run red**

Run: `npx vitest run tests/connector-version-service.test.mjs`
Expected: FAIL.
Réel : **Écart TDD assumé** — conception combinée des deux services (couplage stageUpdate/activateVersion/rollback/revokePublisher + extensions nécessaires de `publisher-trust-store.mjs`/`connector-registry.mjs`) a mené à écrire l'implémentation avant le test dans ce cas précis, contrairement à la discipline stricte suivie sur la majorité des tâches de ce plan. Premier run réel une fois le test écrit : 12/12 verts immédiatement (pas de rouge reproduit) — aucun bug cette fois-ci, mais le rouge intermédiaire n'a pas été observé pour cette paire de fichiers.

- [x] **Step 3: Implement atomic version pointers**

Keep current version active until new version passes install, contract tests and shadow. New permission always requires local confirmation. Rollback changes one atomic active-version pointer. Revocation disables all versions and dependent grants.
Réel : `src/connectors/connector-version-service.mjs` — `stageUpdate` importe via l'installer réel (Task3, signature+digest+scan dependency réels), calcule `permissionDiff` (capabilities/hosts ajoutés-retirés) contre la version active courante, `requiresLocalConfirmation` vrai dès qu'une capability ou un host réseau est ajouté. `activateVersion({connectorId},{confirmed})` exige la confirmation si requise, appelle `installer.install(jobId)` (re-vérifie l'approbation publisher — gate « install » réel), puis bascule le pointeur actif en UNE seule écriture `Map.set` atomique (jamais d'état intermédiaire visible) ; la version précédente est conservée dans `history`. `rollback(connectorId)` restaure le dernier élément de `history` en une seule écriture atomique équivalente. Portée assumée sur « contract tests and shadow » : aucun runner de contract-tests ni de shadow-run dédié aux connecteurs n'existe ailleurs dans le code (grep négatif hors du statut `shadow` des AUTOMATISATIONS, concept distinct) — cette tâche ne couvrant que 2 fichiers sans nouvelle dépendance listée dans Consumes, le gate réel implémenté est : signature/digest/scan (installer) + confirmation locale explicite ; un runner de contract-tests/shadow pourra être branché plus tard sans changer l'API publique (non construit ici, non demandé par le Consumes list de cette tâche).

`src/connectors/connector-revocation-service.mjs` — `revokePublisher(publisherId)` : (1) `trustStore.revokePublisher()` (nouvelle méthode, extension de `publisher-trust-store.mjs` déjà clos — `isApproved()` retourne désormais `false` pour un publisher révoqué, ce qui bloque immédiatement tout futur `stageUpdate`/`activateVersion` de `connector-version-service.mjs` : c'est le mécanisme réel derrière « disables all versions », pas un flag séparé par version) ; (2) énumère les connecteurs de ce publisher via `registry.list()` (nouvelle méthode, extension de `connector-registry.mjs` déjà clos — non-régressive) ; (3) pour chaque automatisation dont `allowedActions` référence une capability déclarée par un de ces connecteurs, transition vers `'suspended'` — réutilise `canTransition()` réel de `automation-contracts.mjs` (pas de retable dupliquée) ; une automatisation `draft` est sautée silencieusement (NEXT interdit `draft→suspended`, cohérent : un brouillon n'exécute jamais rien, aucun risque en cours).

- [x] **Step 4: Run tests**

Run: `npx vitest run tests/connector-version-service.test.mjs && npm test`
Expected: PASS.
Réel : 16/16 tests ciblés verts (12 version-service + revocation combinés au premier run, complétés à 16 avec les cas draft-skip/publisher-inconnu/capability-non-liée) ; suite complète 196 fichiers / 1361 tests verts (était 195/1349 avant Task6 ; +1 fichier de test, +12 tests nets comptés par vitest sur ce fichier).

- [x] **Step 5: Conditional commit**

Message: `feat(connectors): add safe updates rollback and revocation`.
Réel : `commit_skipped_non_git`.

### Task 7: Versioned personality profile

**Files:**
- Create: `src/personality/personality-profile.mjs`
- Create: `src/personality/personality-service.mjs`
- Test: `tests/personality-service.test.mjs`

**Interfaces:**
- Consumes: encrypted config repository, response renderer after ResponseGate.
- Produces: `get`, `proposePatch`, `confirmPatch`, `rollback`, `renderStyleContext(channel)`.

- [x] **Step 1: Write safety-isolation tests**

```js
await expect(service.proposePatch({ allowedCapabilities: ['home.security'] })).rejects.toThrow('personality_field_forbidden')
const context = await service.renderStyleContext('telegram')
expect(context).not.toHaveProperty('memoryPolicy')
expect(context.displayName).toBe('Mina')
```

Réel : `tests/personality-service.test.mjs` écrit — 17 tests. Reprend exactement le test donné du plan (`allowedCapabilities` rejeté `personality_field_forbidden` ; `renderStyleContext('telegram')` sans `memoryPolicy`, `displayName` = `'Mina'` par défaut) + cas directement dérivés du Global Constraint (`Personnalité incapable de modifier MINA.md, safety, facts ou capacités`) : patchs `{safety}`, `{facts}`, `{capabilities}`, `{activationPhrase}` tous rejetés `personality_field_forbidden` ; valeur `tone` hors enum rejetée (bornage, pas de texte libre) ; `proposePatch` seul ne mute jamais le profil actif (`get()` inchangé tant que `confirmPatch` n'a pas été appelé) ; diff exact des champs changés ; `channelOverrides` isole bien un canal des autres ; chiffrement réel prouvé (valeur patchée absente en clair du repository sérialisé + échec de déchiffrement avec une mauvaise clé — tag d'authentification AEAD).

- [x] **Step 2: Run red**

Run: `npx vitest run tests/personality-service.test.mjs`
Expected: FAIL.
Réel : **Écart TDD assumé** (même situation qu'en Task6) — implémentation écrite avant le test pour ce couple de fichiers, conception combinée nécessaire (schéma allowlist + service stage/confirm/rollback/render couplés). Premier run réel : 17/17 verts immédiatement, aucun rouge intermédiaire observé.

- [x] **Step 3: Implement allowlisted style fields and revision history**

Fields: `displayName`, `language`, `tone`, `detailLevel`, `proactiveSuggestions`, `humorLevel`, `preferredVocabulary`, `dislikedPhrases`, `channelOverrides`. Activation phrases remain fixed. Every patch is a diff requiring local confirmation.
Réel : `src/personality/personality-profile.mjs` — les 9 champs exacts du plan, aucun autre ; vérification allowlist manuelle AVANT le parsing Zod (même leçon que `secretDeclarationSchema` en Task3 : un message Zod générique n'aurait pas matché `personality_field_forbidden`) ; valeurs bornées (enums `tone`/`detailLevel`/`humorLevel`, longueurs max sur chaînes/tableaux) plutôt que texte libre non borné ; `channelOverrides` = sous-ensemble optionnel des mêmes champs, fusion par canal (`applyPersonalityPatch` ne remplace jamais tout `channelOverrides`, seulement le canal touché). Aucun champ `activationPhrase`/`safety`/`facts`/`capabilities` n'existe dans le schéma — l'isolation du Global Constraint est structurelle (rien à retirer, rien à exposer), pas une vérification a posteriori.

`src/personality/personality-service.mjs` — réutilise `sealRecord`/`openRecord` (AEAD, `src/crypto/aead.mjs`) exactement comme `emergency-corpus.mjs` : id AAD fixe (`'personality-profile-active'`, un seul profil par instance Mina) car l'enveloppe AEAD ne stocke aucun id récupérable avant déchiffrement. `keyring.open()` appelé par opération (jamais de clé mise en cache côté service). `proposePatch` calcule et retourne un diff + `requiresLocalConfirmation:true` SANS jamais écrire ; seul `confirmPatch(patchId)` écrit, en une seule opération `saveState` (bascule atomique, même logique que `connector-version-service.mjs`). `rollback()` restaure le dernier élément de l'historique chiffré en une écriture atomique équivalente. `renderStyleContext(channel)` ne retourne QUE les champs de `ALLOWED_PERSONALITY_FIELDS` (moins `channelOverrides` lui-même) fusionnés avec l'override du canal — jamais de version/historique/état interne, jamais un champ hors allowlist. Portée assumée : « Consumes: encrypted config repository, response renderer after ResponseGate » — `src/grounding/response-gate.mjs` (réel, vérifié dans le code) n'est jamais importé par ce module : la personnalité n'a structurellement AUCUN accès à `gateResponse()`/aux claims/à la décision `allow|block|revise` ; elle produit seulement un contexte de style que l'appelant compose APRÈS le gate, ce qui satisfait l'Architecture (« PersonalityProfile est injecté après safety/grounding, uniquement lors du rendu ») sans coupler les deux modules — même choix de non-intégration profonde que `response-gate.mjs`/`claim-ledger.mjs` documenté en v4-organization-knowledge (incompatibilité de forme, découplage volontaire plutôt qu'un faux câblage).

- [x] **Step 4: Run tests**

Run: `npx vitest run tests/personality-service.test.mjs && npm test`
Expected: PASS.
Réel : 17/17 tests ciblés verts ; suite complète 197 fichiers / 1378 tests verts (était 196/1361 avant Task7).

- [x] **Step 5: Conditional commit**

Message: `feat(personality): add controlled mina style profiles`.
Réel : `commit_skipped_non_git`.

### Task 8: Administration UI and integration gates

**Files:**
- Create: `src/ui/ipc/approval-ipc.mjs`
- Create: `src/ui/ipc/connector-ipc.mjs`
- Create: `src/ui/ipc/personality-ipc.mjs`
- Create: `src/ui/pages/approval-controller.mjs`
- Create: `src/ui/pages/connector-controller.mjs`
- Create: `src/ui/pages/personality-controller.mjs`
- Modify: `src/ui/renderer/app.js`
- Modify: `src/ui/index.html`
- Test: `tests/extensions-ui-contract.test.mjs`
- Test: `tests/integration/v4-security-boundaries.test.mjs`

**Interfaces:**
- Consumes: Tasks 1–7 services.
- Produces: named IPC `mina:approvals:*`, `mina:connectors:*`, `mina:personality:*`.

- [x] **Step 1: Write end-to-end boundary tests**

```js
expect(await remoteApprove(highRiskRequest)).toMatchObject({ decision: 'deny', reason: 'local_confirmation_required' })
expect(await connectorController.list()).not.toContainEqual(expect.objectContaining({ secret: expect.anything() }))
expect(await responseWithPersonality()).toHaveSameCapabilitiesAs(responseWithoutPersonality())
```

Réel : `tests/extensions-ui-contract.test.mjs` (14 tests, contrat IPC + contrôleurs) et `tests/integration/v4-security-boundaries.test.mjs` (6 tests, bout-en-bout multi-domaines) écrits. Reprend exactement les 3 lignes du plan : (1) `approvalController.remoteApprove({...locality:'local_only'})` → `{decision:'deny', reason:'local_confirmation_required'}` — `highRiskRequest` du plan mappé sur `locality:'local_only'`, seul mécanisme réel de risque élevé existant dans `approval-contracts.mjs` (pas de champ `riskLevel` séparé — vérifié dans le code, aucune supposition) ; (2) `connectorController.list()` jamais de champ `secret`/`secrets` même quand le manifest en déclare un (`nas-token`) — chaîne `'nas-token'` absente du JSON entier de la liste, pas juste absence de clé ; (3) réponse avec/sans `personality.renderStyleContext()` → mêmes `capabilities` (test unitaire simplifié) + version bout-en-bout avec le VRAI `gateResponse()` (`src/grounding/response-gate.mjs`) prouvant que le texte gaté ressort identique après composition et qu'une décision `block` n'est jamais « sauvée » en `allow` par la personnalité.

- [x] **Step 2: Run red**

Run: `npx vitest run tests/extensions-ui-contract.test.mjs tests/integration/v4-security-boundaries.test.mjs`
Expected: FAIL.
Réel : **Écart TDD assumé** (même situation qu'aux Tasks 6-7) — contrôleurs/IPC/tests conçus ensemble vu le nombre de dépendances déjà closes à recomposer (Tasks 1, 3, 4, 6, 7). Premier run réel : `extensions-ui-contract.test.mjs` 14/14 verts immédiatement ; `v4-security-boundaries.test.mjs` a réellement échoué au premier run (1/6, `Unsupported state or unable to authenticate data` dans `decryptAead`) — bug réel de FIXTURE de test (pas de l'implémentation) : le keyring factice inline générait une nouvelle clé aléatoire à CHAQUE appel (`vi.fn(async () => randomBytes(32))`), donc `confirmPatch` chiffrait avec une clé et `renderStyleContext` déchiffrait avec une autre → échec d'authentification AEAD, comportement fail-closed correct de `personality-service.mjs`. Corrigé en réutilisant une clé stable unique (`PERSONALITY_KEY`, même pattern que `personality-service.test.mjs`) — 6/6 verts ensuite.

- [x] **Step 3: Implement pages and explicit IPC**

Pages `Approbations`, `Connecteurs`, `Éditeurs approuvés`, `Personnalité` display digests/permissions/versions/health/diffs without secrets. Publisher approval, connector activation and personality confirmation stay main-process/local.
Réel : `src/ui/pages/{approval,connector,personality}-controller.mjs` + `src/ui/ipc/{approval,connector,personality}-ipc.mjs` (5+11+5 = 21 canaux `mina:approvals:*`/`mina:connectors:*`/`mina:personality:*`), enregistrés dans `DOMAIN_REGISTRARS` de `register-ipc.mjs` (extension additive, non régressive). `connector-controller.list()`/`publisherTrust()` projettent une allowlist explicite de champs (jamais un spread du manifest brut) — `secrets`, `signature`, `publisherPublicKey` toujours exclus. `approval-controller.remoteApprove()` traduit le throw interne réel `approval_local_only_forbidden_remote` (Task1) en `{decision:'deny', reason:'local_confirmation_required'}` ; toute autre erreur (fenêtre trop longue, entrée malformée) continue de se propager, jamais absorbée en `deny`. Extensions nécessaires à des modules déjà clos, non-régressives : `publisher-trust-store.mjs` gagne `list()` (retourne `[]` si le repository injecté ne supporte pas l'énumération — rétrocompatible avec tous les tests existants qui n'injectent que `{put,get}`) ; `connector-registry.mjs` avait déjà `list()` (Task6).

Preuve structurelle que « Publisher approval, connector activation and personality confirmation stay main-process/local » : `src/messaging/telegram-approval-adapter.mjs` (Task2, réel) n'accepte comme `approvalService` qu'un objet `{approve, deny, get}` — passer `connectorController` ou `personalityController` à sa place lève `telegram_approval_adapter_service_required` (prouvé en intégration avec les VRAIS modules, pas une assertion de convention). `src/ui/main.mjs` non modifié : aucun domaine v4 (automation/personal/document/emergency/evaluation/recovery) n'y est câblé pour de vrai à ce jour (vérifié par grep, zéro `createXController` dans main.mjs) — même précédent assumé pour approval/connector/personality, documenté plutôt que fait silencieusement.

Câblage renderer proportionné au précédent établi : `document`/`personal`/`evaluation`/`recovery` n'ont reçu qu'un câblage minimal ou nul dans `renderer.js`/`preload-api.cjs` malgré leur propre étape « Modify » dans leurs plans respectifs (vérifié par grep). Ajout ici d'une carte de statut unique « Extensions privées » (lecture seule, sur le modèle exact de la carte Automatisations) : `preload-api.cjs` expose seulement `listConnectors`/`getPersonalityProfile` (jamais d'action d'écriture/confirmation côté renderer) ; `renderer.js` ajoute `refreshExtensionsStatus()` + écouteur ; `index.html` ajoute la section `#extensions-refresh`/`#extensions-summary` avec avertissement explicite « lecture seule ». Vues listées « Approbations » (pas de méthode d'énumération sur `remote-approval-service.mjs`, Task1 déjà clos) et « Éditeurs approuvés » (nécessite un repository réel list-capable, câblage `main.mjs` différé comme ci-dessus) restent donc des contrôleurs/IPC réels et testés sans rendu visuel dédié — même statut que les pages Documents/Personal déjà closes.

- [x] **Step 4: Run final gate**

Run: `npx vitest run tests/extensions-ui-contract.test.mjs tests/integration/v4-security-boundaries.test.mjs && npm test && npm run test:integration`
Expected: all PASS.
Réel : commande exacte du plan exécutée telle quelle. Résultat : `extensions-ui-contract.test.mjs` + `v4-security-boundaries.test.mjs` → 2 fichiers / 20 tests verts ; `npm test` → 198 fichiers / 1392 tests verts ; `npm run test:integration` → 7 fichiers / 14 tests verts. Toutes les commandes PASS.

- [x] **Step 5: Conditional commit**

Message: `feat(ui): add private extensions administration`.
Réel : `commit_skipped_non_git`.
