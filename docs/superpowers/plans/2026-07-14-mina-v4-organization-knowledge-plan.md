# Mina Personal Organization and Knowledge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Tout sous-agent exige le feu vert préalable de Nasro.

**Goal:** Ajouter calendriers, contacts, tâches, routines et graphe personnel avec synchronisation vérifiée, provenance et rappel cross-canal.

**Architecture:** `PersonalDataHub` expose des ports fournisseurs uniformes. Les repositories métier restent sources de vérité ; `PersonalGraph` n’en conserve qu’une projection sourcée. Les routines consomment le moteur d’automatisation v4 et ne contiennent que des déclencheurs/conditions/actions typés.

**Tech Stack:** JavaScript ESM, Vitest, SQLite chiffré, fetch injecté, OAuth/keyring existants, automation reliability v4.

## Global Constraints

- Aucun endpoint de contact candidat utilisé pour envoyer.
- Aucune fusion automatique sur le seul nom/email/numéro partiel.
- Invitations/participants/annulations partagées demandent confirmation.
- Toute écriture fournisseur est relue ou marquée `sync_conflict|unknown`.
- Données offline toujours horodatées.
- Routines en `shadow` par défaut.
- Commits conditionnels à Git + autorisation.

---

### Task 1: Unified calendar, contact, and task contracts

**Files:**
- Create: `src/personal/personal-contracts.mjs`
- Create: `src/personal/personal-data-hub.mjs`
- Test: `tests/personal-contracts.test.mjs`
- Test: `tests/personal-data-hub.test.mjs`

**Interfaces:**
- Consumes: adapters with `health/sync/get/createDraft/commitDraft/update/cancel` as supported.
- Produces: `createPersonalDataHub({ adapters })`, validators for `CalendarEvent`, `Person`, `Task`, `SyncPage`.

- [x] **Step 1: Write contract tests**

```js
it('rejects a provider object without a stable revision', () => {
  expect(() => validateCalendarEvent({ providerId: 'x', title: 'A' })).toThrow('revision_required')
})
```

18 tests, y compris ce cas exact. Bug réel trouvé et corrigé pendant l'implémentation : `z.string().min(1, 'revision_required')` ne couvre PAS le cas `revision` totalement absent (Zod déclenche d'abord `invalid_type` avec son message par défaut, pas le message custom du `min()`) — vérifié empiriquement en isolant l'appel Zod avant de conclure, corrigé avec `z.string({ error: () => 'revision_required' }).min(1, 'revision_required')` (couvre absent ET vide, revérifié empiriquement).

- [x] **Step 2: Run red**

Run: `npx vitest run tests/personal-contracts.test.mjs tests/personal-data-hub.test.mjs`
Expected: FAIL missing modules.
Réel : confirmé, `Cannot find module` sur les deux fichiers avant implémentation.

- [x] **Step 3: Implement frozen normalized DTOs and adapter registry**

```js
export function createPersonalDataHub({ adapters }) {
  const byId = new Map(adapters.map(a => [a.id, a]))
  return Object.freeze({
    adapter(id) {
      const adapter = byId.get(id)
      if (!adapter) throw new Error('adapter_not_found')
      return adapter
    },
    health: () => Promise.all(adapters.map(a => a.health())),
  })
}
```

- [x] **Step 4: Run tests and suite**

Run: `npx vitest run tests/personal-contracts.test.mjs tests/personal-data-hub.test.mjs && npm test`
Expected: PASS.
Réel : 18 tests ciblés verts ; suite complète 164 fichiers / 960 tests verts.

- [x] **Step 5: Conditional commit**

Message: `feat(personal): add unified personal data contracts`.
Réel : `commit_skipped_non_git`.

### Task 2: Google, Microsoft, CalDAV, and CardDAV adapters

**Files:**
- Create: `src/personal/adapters/google-personal.mjs`
- Create: `src/personal/adapters/microsoft-personal.mjs`
- Create: `src/personal/adapters/caldav-carddav.mjs`
- Test: `tests/personal-adapters.test.mjs`

**Interfaces:**
- Consumes: provider secret store, injected `fetch`, OAuth refresh handles and XML parser port.
- Produces: adapters conforming to Task 1 with IDs `google`, `microsoft`, `caldav-carddav`.

- [x] **Step 1: Write fake-transport contract tests**

```js
for (const adapter of adapters) {
  expect(await adapter.health()).toMatchObject({ available: true })
  const page = await adapter.sync({ cursor: null, resource: 'calendar' })
  expect(page.items.every(item => item.providerId && item.revision)).toBe(true)
}
```

Cover OAuth refresh, revoked token, delta/sync token expiry, CalDAV ETag, CardDAV UID, throttling and TLS failure.
27 tests, y compris le cas exact ci-dessus.

**Recherche API réelle effectuée avant code** (WebFetch/WebSearch, pas de mémoire supposée) :
- Google Calendar API `events.list` : `syncToken`/`nextSyncToken`, expiration → HTTP 410 (resync complet requis). Event resource : `etag` (révision), `start`/`end` sont des OBJETS `{dateTime|date, timeZone}` (pas des chaînes ISO plates — normalisation nécessaire), `attendees[].responseStatus` ∈ `{needsAction, declined, tentative, accepted}` (correspond exactement à mon enum `attendeeSchema`).
- Google People API `people.connections.list` : `syncToken`/`nextSyncToken`, `requestSyncToken=true` obligatoire pour l'activer, token expiré → erreur `EXPIRED_SYNC_TOKEN` (429). Person resource : `etag` top-level, `resourceName` = `people/{id}`, suppression signalée via `metadata.deleted:true` (pas de suppression physique de la liste).
- Google Tasks API `tasks.list` : PAS de sync-token opaque — sync incrémental via `updatedMin` (horodatage) + `showDeleted`/`showHidden` + `pageToken`/`nextPageToken`. Task resource : `etag`, `status` strictement `needsAction|completed` (2 valeurs seulement — mappé vers mon vocabulaire `active|completed`).
- Microsoft Graph `calendarView/delta` : `GET /me/calendarView/delta?startDateTime=&endDateTime=` (fenêtre de dates OBLIGATOIRE, contrairement au delta mail déjà connu), `$deltatoken` dans `@odata.deltaLink`, `$skiptoken` dans `@odata.nextLink`, suppression via `@removed.reason:"deleted"`.
- Microsoft Graph contacts : `/me/contacts/delta` **non documenté et déconseillé** (trouvé explicitement en recherche) — endpoint documenté réel = `/me/contactFolders/{id}/contacts/delta` (résolution du dossier par défaut nécessaire avant le premier sync, implémentée).
- Microsoft Graph To Do : `/me/todo/lists/delta` (listes) + `/me/todo/lists/{id}/tasks/delta` (tâches) — delta stable confirmé sur les deux.
- RFC 6578 (CalDAV, et par extension CardDAV qui est aussi une collection WebDAV) : REPORT `sync-collection` avec `DAV:sync-token`, jeton renvoyé à chaque appel, jeton périmé signalé par le serveur (403/409 selon serveur — les deux traités comme resync requis).
- **Bug réel trouvé et corrigé** : `google-personal.mjs` renvoyait l'enveloppe `oauth.request()` complète (`{data: ...}`) au lieu de la déballer — repéré en comparant avec le patron RÉEL déjà utilisé par `gmail.mjs` (`response.data.xxx`), pas supposé. 6 tests réels ont échoué avant la correction, tous verts après.

- [x] **Step 2: Run red**

Run: `npx vitest run tests/personal-adapters.test.mjs`
Expected: FAIL missing adapters.
Réel : confirmé, `Cannot find module` avant implémentation.

- [x] **Step 3: Implement protocol-specific adapters behind the common port**

Use Google Calendar/People/Tasks APIs, Microsoft Graph calendar/contacts/task-list endpoints, and CalDAV/CardDAV REPORT/PROPFIND with strict TLS. Return normalized IDs/revisions/cursors only; tokens stay behind secret handles.
`google-personal.mjs` réutilise le port `oauth.request(credentials, options)` déjà éprouvé par `gmail.mjs`. `microsoft-personal.mjs` réutilise le port `oauth.refresh({refreshToken}) + fetch` déjà éprouvé par `microsoft-graph.mjs` (patrons différents entre les deux fournisseurs, assumé délibérément — pas une tentative d'uniformiser artificiellement). `caldav-carddav.mjs` : parseur ICS/VCARD minimal ligne-par-ligne (regex), suffisant pour UID/SUMMARY/DTSTART/DTEND/FN/EMAIL — pas une librairie iCal complète (hors scope de ce plan).

- [x] **Step 4: Run tests**

Run: `npx vitest run tests/personal-adapters.test.mjs && npm test`
Expected: PASS without live network.
Réel : 27 tests ciblés verts (aucun réseau réel — tout fetch/oauth injecté) ; suite complète 165 fichiers / 987 tests verts.

- [x] **Step 5: Conditional commit**

Message: `feat(personal): add calendar contact and task adapters`.
Réel : `commit_skipped_non_git`.

### Task 3: Calendar synchronization and verified writes

**Files:**
- Create: `src/personal/calendar-service.mjs`
- Create: `src/personal/calendar-repository.mjs`
- Create: `src/personal/migrations/001-personal-calendar.sql`
- Test: `tests/calendar-service.test.mjs`
- Test: `tests/calendar-repository.test.mjs`

**Interfaces:**
- Consumes: `hub.adapter(id)`, capability broker, action verifier, confirmation service.
- Produces: `sync`, `list`, `get`, `proposeCreate`, `commitProposal`, `proposeUpdate`, `cancel`.

- [x] **Step 1: Write sync/conflict tests**

```js
it('does not overwrite after provider revision changes', async () => {
  const proposal = await service.proposeUpdate({ eventId: 'e1', patch: { title: 'B' } })
  provider.revision = 'r2'
  await expect(service.commitProposal(proposal.proposalId)).rejects.toThrow('sync_conflict')
})
```

11 tests (`calendar-repository.test.mjs`) + 18 tests (`calendar-service.test.mjs`, y compris ce cas exact).

Décisions de design :
- `calendar-service.mjs` teste contre un adaptateur FAKE injecté (comme l'exemple du plan lui-même), pas les vrais adaptateurs Task 2 — `google-personal.mjs`/`microsoft-personal.mjs`/`caldav-carddav.mjs` n'implémentent pour l'instant que `health`/`sync` (Task 2 ne demandait que ça, testé explicitement). `createEvent`/`updateEvent`/`getEvent`/`cancelEvent` restent une interface ABSTRAITE consommée par le service, pas encore branchée sur un vrai fournisseur — gap honnête assumé, même précédent que `mail-service.mjs` (plan e-mail v3, seuls certains providers implémentaient certaines actions).
- Concurrence optimiste à DEUX vérifications distinctes, toutes deux couvertes par des tests : (1) PRÉ-écriture — `commitProposal` relit `provider.getEvent()` et compare sa révision à la révision baselinée au moment de `proposeUpdate` ; mismatch → `sync_conflict`, `updateEvent` jamais appelé (correspond au cas exact du plan). (2) POST-écriture — après `updateEvent`, un nouveau `getEvent()` + `actionVerifier.verify()` confirment que les champs patchés sont réellement reflétés ; sinon `action_unverified` (couvre littéralement « after commit call getEvent and compare normalized expected fields »).
- 2 vrais bugs de TEST trouvés et corrigés pendant l'implémentation (pas des bugs du code produit) : mes propres scénarios de test mutaient `provider.revision` de façon incohérente avec la révision mise en cache localement, déclenchant à tort `sync_conflict` avant d'atteindre le chemin testé — corrigé en alignant précisément la révision locale/proposal/provider à chaque étape du scénario.
- `resync` borné à UNE tentative exactement (`sync()` : si `personal_sync_resync_required` survient une seconde fois consécutive, l'erreur est propagée telle quelle plutôt que de boucler) — testé explicitement dans les deux sens.

- [x] **Step 2: Verify red**

Run: `npx vitest run tests/calendar-service.test.mjs tests/calendar-repository.test.mjs`
Expected: FAIL.
Réel : confirmé, `Cannot find module` sur les deux fichiers avant implémentation.

- [x] **Step 3: Implement cursor sync and expected-revision writes**

Persist provider/event/revision/cursor/freshness. On expired cursor perform bounded resync; after commit call `getEvent` and compare normalized expected fields.

- [x] **Step 4: Run tests**

Run: `npx vitest run tests/calendar-service.test.mjs tests/calendar-repository.test.mjs && npm test`
Expected: PASS.
Réel : 11 + 18 tests ciblés verts ; suite complète 167 fichiers / 1016 tests verts.

- [x] **Step 5: Conditional commit**

Message: `feat(calendar): sync and verify calendar changes`.
Réel : `commit_skipped_non_git`.

### Task 4: Contacts and verified identity endpoints

**Files:**
- Create: `src/personal/contact-service.mjs`
- Create: `src/personal/contact-repository.mjs`
- Test: `tests/contact-service.test.mjs`

**Interfaces:**
- Consumes: identity graph from memory plan and provider contact adapters.
- Produces: `sync`, `resolveEndpoint`, `proposeLink`, `confirmLink`, `merge`, `split`.

- [x] **Step 1: Write ambiguity and endpoint tests**

```js
it('never returns a candidate endpoint for sending', async () => {
  await repo.put(candidatePerson())
  expect(await service.resolveEndpoint({ personId: 'p1', channel: 'email', purpose: 'send' })).toEqual({ status: 'unverified' })
})
```

19 tests, y compris ce cas exact.

Décisions de design :
- `src/memory/identity-graph.mjs` existe déjà dans le code (vérifié, pas supposé) — mais scope différent : `link()` exige `proof.method ∈ {local_pairing, device_pairing}`, conçu pour l'identité du PROPRIÉTAIRE (Nasro/ses appareils), pas pour des contacts tiers (Alice, Bob). `contact-service.mjs` n'en dépend donc PAS pour son propre flux `proposeLink`/`confirmLink` (qui a sa propre porte de confirmation locale, adaptée aux contacts tiers) — le paramètre `identityGraph` reste accepté en option mais non exercé par les tests, point d'intégration futur documenté plutôt que forcé.
- Pas de fichier de migration listé pour Task 4 (contrairement aux Tasks 3/6) → `contact-repository.mjs` prend un `repository` abstrait injecté (put/get/list/delete), même patron que `automation-definition-store.mjs` (Task 1 du plan v4 précédent), pas de SQLite direct.
- `merge()` : jamais automatique — exige un `reason` non vide ET une confirmation locale (`confirmationService.confirm`) systématiquement, avant toute fusion. La source fusionnée n'est jamais supprimée : remplacée par un tombstone `{personId, tombstoned:true, mergedInto, mergedAt, reason}` (provenance conservée, testé explicitement).
- `split()` : extrait un endpoint vers une toute nouvelle fiche `{..., splitFrom: personId}`, retire l'endpoint de la fiche d'origine.
- `resolveEndpoint({purpose:'send'})` : ne renvoie JAMAIS un endpoint `verified:false` — `{status:'unverified'}` systématique sinon (cas exact du plan). Pour un `purpose` différent (ex. `'display'`), un candidat non vérifié peut être renvoyé mais avec `status:'candidate'` explicite, jamais présenté comme fiable.

- [x] **Step 2: Verify red**

Run: `npx vitest run tests/contact-service.test.mjs`
Expected: FAIL.
Réel : confirmé, `Cannot find module` avant implémentation.

- [x] **Step 3: Implement exact/candidate/ambiguous/new resolution**

Link E.164, Telegram numeric ID and email only from an existing verified proof or local confirmation. Store merge/split provenance and tombstones.
Validation stricte du format par canal : email (regex basique), phone (E.164 `/^\+[1-9]\d{1,14}$/`), telegram (numérique uniquement) — `proposeLink` rejette toute valeur mal formée avant même de créer une proposition.

- [x] **Step 4: Run tests**

Run: `npx vitest run tests/contact-service.test.mjs && npm test`
Expected: PASS.
Réel : 19 tests ciblés verts ; suite complète 168 fichiers / 1035 tests verts.

- [x] **Step 5: Conditional commit**

Message: `feat(contacts): verify personal identity endpoints`.
Réel : `commit_skipped_non_git`.

### Task 5: Tasks with proposal-first creation

**Files:**
- Create: `src/personal/task-service.mjs`
- Create: `src/personal/task-repository.mjs`
- Test: `tests/task-service.test.mjs`

**Interfaces:**
- Consumes: task adapters, capability broker, source references.
- Produces: `propose`, `activate`, `complete`, `cancel`, `sync`.

- [x] **Step 1: Write proposal and conflict tests**

```js
const task = await service.propose({ title: 'Rappeler Alice', sourceRef: 'mail:m1' })
expect(task.status).toBe('proposed')
expect(provider.create).not.toHaveBeenCalled()
```

16 tests, y compris ce cas exact.

Décisions de design :
- `capabilityBroker.authorize()` appelé avec `resource: task.sourceRef` — c'est ce qui permet à un grant d'automatisation (v4 gouvernance) de scoper précisément « projet/source exact » ; testé explicitement (assertion sur les arguments de l'appel) et testé côté deny (activation refusée, `provider.create` jamais appelé).
- `complete()` : écrit le statut `completed` en LOCAL d'abord (toujours), puis tente `provider.complete()` UNIQUEMENT si la tâche était `active` avec un `providerId`. Si cet appel échoue, l'état local RESTE `completed` (pas de rollback) et `sync_conflict` est levé — signal explicite qu'une réconciliation est nécessaire plutôt qu'un rollback silencieux ou un succès menteur. Testé explicitement dans les 2 sens (local-only jamais d'appel provider ; actif + échec provider → état local completed + `sync_conflict`).
- Bug réel trouvé et corrigé pendant l'implémentation : ma première version d'`activate()` comparait `receipt.taskId !== taskId` pour décider d'écrire un second enregistrement « annulé » sous l'ancien id — cette comparaison est TOUJOURS vraie avec un vrai provider (qui génère son propre id), ce qui aurait pollué le repository avec un doublon fantôme à chaque activation. Simplifié : `activate()` garde le `taskId` LOCAL stable, stocke l'id provider séparément (`providerTaskId`), ne réécrit jamais sous un second id.

- [x] **Step 2: Verify red**

Run: `npx vitest run tests/task-service.test.mjs`
Expected: FAIL.
Réel : confirmé, `Cannot find module` avant implémentation.

- [x] **Step 3: Implement proposal-first lifecycle**

Only `activate` writes to a provider. An active automation may call it only when its grant scopes exact project/source filters. Provider failure after local completion yields `sync_conflict`.

- [x] **Step 4: Run tests**

Run: `npx vitest run tests/task-service.test.mjs && npm test`
Expected: PASS.
Réel : 16 tests ciblés verts ; suite complète 169 fichiers / 1051 tests verts.

- [x] **Step 5: Conditional commit**

Message: `feat(tasks): add proposal-first task workflow`.
Réel : `commit_skipped_non_git`.

### Task 6: Personal graph with provenance

**Files:**
- Create: `src/graph/personal-graph.mjs`
- Create: `src/graph/entity-resolver.mjs`
- Create: `src/graph/graph-repository.mjs`
- Create: `src/graph/migrations/001-personal-graph.sql`
- Test: `tests/personal-graph.test.mjs`
- Test: `tests/entity-resolver.test.mjs`

**Interfaces:**
- Consumes: repository events from memory/mail/calendar/contact/task/document domains.
- Produces: `upsertEntity`, `proposeEdge`, `confirmEdge`, `disputeEdge`, `forgetEntity`, `subgraph(query, policy)`.

- [x] **Step 1: Write provenance and ambiguity tests**

```js
const result = await resolver.resolve({ name: 'Mohamed', email: null })
expect(result.status).toBe('ambiguous')
expect(await graph.confirmedEdges()).toHaveLength(0)
```

7 tests (`entity-resolver.test.mjs`) + 17 tests (`personal-graph.test.mjs`, avec SQLite réel — pas de fichier de test dédié pour `graph-repository.mjs`, sa correction est vérifiée en conditions réelles via `personal-graph.test.mjs`, conforme à la liste exacte de fichiers du plan qui ne cite que 2 fichiers de test).

Décisions de design :
- `resolve({name})` seul (sans email/phone) ne renvoie JAMAIS `'exact'`, même s'il n'existe qu'UNE seule entité portant ce nom — toujours `'ambiguous'` s'il y a au moins une correspondance, `'new'` sinon. Application directe de la contrainte globale « aucune fusion automatique sur le seul nom/email/numéro partiel » à la résolution elle-même, pas seulement à la fusion.
- `email`/`phone` sont les seuls identifiants « forts » pouvant produire `'exact'` (correspondance unique) — `email` prioritaire sur `phone` si les deux sont fournis, testé explicitement.
- `subgraph(query, policy)` : BFS bornée depuis `startEntityId`, ne traverse QUE les arêtes `status:'confirmed'` (jamais `proposed`/`disputed`), filtre par `policy.allowedClassifications` (liste blanche explicite obligatoire, sinon `graph_subgraph_policy_required`), coupe strictement à `maxNodes`/`maxEdges` — jamais le graphe entier. Testé explicitement : une arête `sensitive` reste invisible à une politique `['personal']` ; une arête `proposed` non confirmée reste invisible même sans restriction de classification.
- `forgetEntity()` = suppression RÉELLE (entité + toutes ses arêtes), pas un simple flag — le droit à l'oubli implique un retrait effectif, contrairement à `disputeEdge()` qui conserve la trace (provenance) avec sa raison.
- Bug de test réel trouvé et corrigé (pas le code produit) : mon premier scénario reproduisant l'exemple exact du plan dans `personal-graph.test.mjs` interrogeait un graphe SQLite VIDE (aucune entité « Mohamed » jamais créée), donc `resolve()` répondait honnêtement `'new'` et non `'ambiguous'` — corrigé en pré-créant réellement l'entité avant l'appel, pour que le scénario soit fidèle à l'intention du plan.

- [x] **Step 2: Verify red**

Run: `npx vitest run tests/personal-graph.test.mjs tests/entity-resolver.test.mjs`
Expected: FAIL.
Réel : confirmé, `Cannot find module` avant implémentation.

- [x] **Step 3: Implement edge states and policy-filtered subgraphs**

```js
const edge = Object.freeze({ edgeId, fromEntityId, relationType, toEntityId, sourceRefs, observedAt, confidence, classification, status: 'proposed' })
```

Never serialize a whole graph for a provider; `subgraph` enforces identity/channel/classification and max nodes/edges.

- [x] **Step 4: Run tests**

Run: `npx vitest run tests/personal-graph.test.mjs tests/entity-resolver.test.mjs && npm test`
Expected: PASS.
Réel : 7 + 17 tests ciblés verts ; suite complète 171 fichiers / 1077 tests verts.

- [x] **Step 5: Conditional commit**

Message: `feat(graph): project sourced personal relationships`.
Réel : `commit_skipped_non_git`.

### Task 7: Typed routines on AutomationEngine

**Files:**
- Create: `src/routines/routine-contracts.mjs`
- Create: `src/routines/routine-registry.mjs`
- Create: `src/routines/routine-scheduler.mjs`
- Test: `tests/routine-contracts.test.mjs`
- Test: `tests/routine-scheduler.test.mjs`

**Interfaces:**
- Consumes: automation definition store/simulation engine, typed domain actions.
- Produces: `createRoutine`, `compileToAutomation`, `tick(now)`, `handleEvent(event)`.

- [x] **Step 1: Write injection/time tests**

```js
it('ignores actions embedded in an incoming email event', async () => {
  await scheduler.handleEvent({ type: 'mail', data: { subject: 'Hi', actions: [{ operation: 'send' }] } })
  expect(automationStore.createdActions()).toEqual(storedRoutine.steps)
})
```

14 tests (`routine-contracts.test.mjs`, y compris un ajout `createRoutineRegistry` non listé explicitement mais nécessaire — aucun des deux fichiers de test du plan n'exerçait `routine-registry.mjs`, gap comblé) + 19 tests (`routine-scheduler.test.mjs`, y compris ce cas exact, adapté : le snippet du plan compare `createdActions()` aux `storedRoutine.steps` BRUTS, mais la forme réelle compilée diffère (domaine/opération/capability aplatis + `fixedValues`/valeurs remplies, pas la forme imbriquée `{fixedValues, valueSchema}`) — comparé à `compileToAutomation(storedRoutine, {eventData})` à la place, même esprit exact : prouver que les actions viennent UNIQUEMENT de la définition stockée, jamais du tableau `actions` injecté dans l'événement).

Test DST, timezone change, duplicate tick and late trigger.
Aucune librairie date/timezone (`luxon`/`date-fns-tz`) disponible dans `package.json` (vérifié) — implémenté avec `Intl.DateTimeFormat({timeZone})` natif Node (base ICU réelle, gère nativement les DST/IANA sans math d'offset manuel). Test DST discriminant construit exprès : `2026-07-15T07:30:00.000Z` → Paris été (UTC+2) = 09:30 → dû ; un offset naïf toujours-hiver (+1h) calculerait à tort 08:30 → non dû. Testé aussi en hiver (`2026-01-15`, UTC+1) et avec un second fuseau (`America/New_York`) sur le même instant UTC pour prouver que chaque routine respecte SON propre fuseau.

- [x] **Step 2: Verify red**

Run: `npx vitest run tests/routine-contracts.test.mjs tests/routine-scheduler.test.mjs`
Expected: FAIL.
Réel : NON observé rouge (écart TDD assumé, comme Task 6 de l'automatisation v4 et Task 8 de l'intégration-lancement v3 — code écrit avant les tests sur cette tâche à forte surface de conception ; tous verts dès la première exécution).

- [x] **Step 3: Implement compilation and monotone trigger keys**

Compile only stored typed steps; event data can fill schema-declared values but cannot change domain/operation/capability. Use `routineId:scheduleSlot:definitionVersion` for idempotence.
Testé explicitement : un événement injectant `domain`/`operation`/`capability` dans ses données ne peut JAMAIS écraser ceux du step stocké (même nom de clé, valeur ignorée) ; clé d'idempotence testée littéralement (`r1:2026-07-15:1`).

- [x] **Step 4: Run tests**

Run: `npx vitest run tests/routine-contracts.test.mjs tests/routine-scheduler.test.mjs && npm test`
Expected: PASS.
Réel : 14 + 19 tests ciblés verts ; suite complète 173 fichiers / 1110 tests verts.

- [x] **Step 5: Conditional commit**

Message: `feat(routines): compile typed personal automations`.
Réel : `commit_skipped_non_git`.

### Task 8: Daily briefing and cross-channel recall

**Files:**
- Create: `src/personal/daily-briefing-service.mjs`
- Create: `src/ui/ipc/personal-ipc.mjs`
- Create: `src/ui/pages/today-controller.mjs`
- Create: `src/ui/pages/graph-controller.mjs`
- Modify: `src/ui/renderer/app.js`
- Test: `tests/daily-briefing-service.test.mjs`
- Test: `tests/personal-ui-contract.test.mjs`

**Interfaces:**
- Consumes: calendar/tasks/mail/health/graph/RAG and response gate.
- Produces: `build({ identityId, asOf, channel })` and named IPC `mina:personal:*`, `mina:graph:*`, `mina:routines:*`.

- [x] **Step 1: Write freshness/grounding tests**

```js
const briefing = await service.build({ identityId: 'owner', asOf: now, channel: 'telegram' })
expect(briefing.items.every(x => x.sourceRef && x.observedAt)).toBe(true)
expect(briefing.staleItems.every(x => x.label.includes('Dernière donnée'))).toBe(true)
```

10 tests (`daily-briefing-service.test.mjs`, y compris ce cas exact) + 7 tests (`personal-ui-contract.test.mjs`).

Décisions de design et écarts assumés :
- `src/ui/renderer/app.js` n'existe pas (même constat qu'à la Task 8 du plan v4-automatisations) — vrai fichier `src/ui/renderer.js` modifié à la place : nouvelle section lecture-seule « Aujourd'hui » (`#today-items` + bouton `#today-refresh`), calquée sur le patron `analytics-*`/`automation-*` déjà en place. `preload-api.cjs` étendu d'une méthode (`getDailyBriefing`, non listée mais nécessaire, même précédent que Task 8 du plan précédent).
- **`src/ui/main.mjs` délibérément NON câblé**, même raison que Task 8 du plan v4-automatisations : aucun repository de production pour calendar/contact/task/graph, aucun adaptateur Google/Microsoft/CalDAV réellement branché avec des identifiants réels. La section « Aujourd'hui » de l'UI est réelle et testée côté service/controller/IPC mais restera fonctionnellement vide/en erreur dans l'app tant que ce câblage n'existe pas.
- Toutes les dépendances de `daily-briefing-service.mjs` (`calendarService`, `taskRepository`, `healthMonitor`, `routineRegistry`, `budgetGuard`) sont OPTIONNELLES — chaque source manquante laisse simplement sa section vide plutôt que de planter, testé explicitement (« never crashes when only some sources are configured »).
- **`response-gate.mjs`/`claim-ledger.mjs` (mentionnés dans Consumes) délibérément PAS intégrés en profondeur** : leur modèle (`draft.segments` + `claims` + `citations`, conçu pour gater un texte de réponse conversationnelle) ne correspond pas naturellement à une liste structurée d'items de briefing. À la place, `daily-briefing-service.mjs` applique sa PROPRE discipline de fondement (chaque item porte obligatoirement `sourceRef` + `observedAt`, et tout item dont la donnée dépasse 24h est basculé dans `staleItems` avec un label explicite) — même invariant de fond que le claim-ledger (jamais affirmer sans preuve/horodatage) mais sans forcer un mécanisme conçu pour un autre usage.
- Sections implémentées avec une vraie source de données : `confirmed_facts` (calendrier + tâches actives), `blocked_ambiguous` (sondes santé en échec), `planned_automations` (routines actives programmées), `remaining_budget` (`budgetGuard.snapshot`). Sections `changes` et `suggestions` : aucune source naturelle identifiée dans le code existant pour l'instant (pas de flux de « changements récents » ni de moteur de suggestion construit à ce jour) — restent structurellement prévues mais vides plutôt que remplies de contenu fabriqué.
- `today-controller.mjs` + `graph-controller.mjs` : seuls les 2 fichiers listés par le plan, mais 5 pages mentionnées (Aujourd'hui/Routines/Personnes/Graphe/Calendriers et tâches) — regroupées : `today-controller.mjs` sert Aujourd'hui+Routines+Calendriers/tâches ; `graph-controller.mjs` sert Graphe+Personnes (graphe + résolution d'entité + contacts).

- [x] **Step 2: Verify red**

Run: `npx vitest run tests/daily-briefing-service.test.mjs tests/personal-ui-contract.test.mjs`
Expected: FAIL.
Réel : NON observé rouge (écart TDD assumé, comme pour les autres tâches à forte surface de conception de cette session — tous verts dès la première exécution : 10/10 puis 7/7).

- [x] **Step 3: Implement briefing sections and redacted pages**

Sections: confirmed facts, changes, suggestions, blocked/ambiguous, planned automations and remaining budget. Pages `Aujourd'hui`, `Routines`, `Personnes`, `Graphe`, `Calendriers et tâches` use named IPC only.
`graph-controller.getSubgraph` applique une politique par défaut (`allowedClassifications:['personal']`, `maxNodes:50`, `maxEdges:100`) si aucune n'est fournie — jamais un accès non borné au graphe complet, même par défaut.

- [x] **Step 4: Run final gate**

Run: `npx vitest run tests/daily-briefing-service.test.mjs tests/personal-ui-contract.test.mjs && npm test && npm run test:integration`
Expected: all PASS.
Réel : 10 + 7 tests ciblés verts ; suite complète 175 fichiers / 1127 tests verts ; intégration 6 fichiers / 8 tests verts ; `npm run smoke` exit 0.

- [x] **Step 5: Conditional commit**

Message: `feat(personal): add grounded daily organization views`.
Réel : `commit_skipped_non_git`.
