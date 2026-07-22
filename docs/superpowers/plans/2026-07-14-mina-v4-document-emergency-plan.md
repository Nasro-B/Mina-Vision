# Mina Document Operations and Emergency Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Tout sous-agent exige le feu vert préalable de Nasro.

**Goal:** Construire une chaîne documentaire sûre (quarantaine, preuves, modifications, téléchargement, impression) et un corpus d’urgence entièrement local.

**Architecture:** Chaque entrée est promue de quarantaine uniquement après vérification du type réel et des limites. Les parsers/OCR retournent une observation sourcée ; les effets travaillent sur une copie versionnée et passent par l’automation/broker. `EmergencyCorpus` est un paquet chiffré/signé distinct du cloud.

**Tech Stack:** JavaScript ESM, Vitest, readers/OCR locaux v3, sandbox v2, SQLite/keyring, Windows print APIs derrière un port injecté.

## Global Constraints

- Aucun macro/script/exécutable exécuté pendant l’analyse.
- Chemin réel vérifié après résolution des liens/junctions.
- Original jamais écrasé par défaut.
- Impression/téléchargement idempotents et vérifiés.
- Corpus urgence utilisable avec réseau coupé.
- Date/fraîcheur visible sur toute donnée offline.
- Commits conditionnels à Git + autorisation.

---

### Task 1: Intake and quarantine

**Files:**
- Create: `src/documents/document-intake.mjs`
- Create: `src/documents/document-quarantine.mjs`
- Create: `src/documents/document-contracts.mjs`
- Test: `tests/document-intake.test.mjs`
- Test: `tests/document-quarantine.test.mjs`

**Interfaces:**
- Consumes: realpath provider, magic/type detector, antivirus port, bounded filesystem port, clock.
- Produces: `intake({ source, path|bytes, declaredName, signal })`, `inspect(documentId)`, `promote(documentId, destination)`.

- [x] **Step 1: Write malicious-file tests**

```js
it('keeps a macro document quarantined when antivirus is unavailable', async () => {
  const item = await intake.intake({ source: 'download', bytes: macroFixture, declaredName: 'facture.pdf' })
  expect(item.detectedType).not.toBe('application/pdf')
  expect(item.status).toBe('quarantined')
})
```

Cover ZIP traversal/bomb, executable, junction escape, oversized and duplicate digest.
14 tests (`document-intake.test.mjs`, y compris ce cas exact et les 5 dimensions demandées) + 13 tests (`document-quarantine.test.mjs`).

Décision majeure de design : `document-intake.mjs` **réutilise directement** `src/mail/attachment-quarantine.mjs::quarantineAttachment()` (déjà construit au plan e-mail v3 — détection magic-bytes exécutable/OLE2/ZIP, traversal/bomb ZIP, macro `vbaProject.bin`) comme détecteur magic/type, au lieu de dupliquer cette logique. Fixtures de test (ZIP traversal par patch d'octets bruts post-création, car `adm-zip` assainit `../` à la création) copiées du patron déjà éprouvé dans `tests/attachment-quarantine.test.mjs`.
- Antivirus : n'est JAMAIS utilisé pour rétrograder un verdict déjà `quarantined`/`blocked` fondé sur signature — seulement pour ESCALADER un verdict `inspectable`. Un antivirus indisponible (exception) laisse le verdict signature tel quel, jamais de silencieux passage en sûr. Testé explicitement dans les deux sens.
- « Junction escape » : `realpathProvider.resolve()` injecté, vérifié explicitement avec une racine approuvée simulée (rejette un chemin hors racine, accepte un chemin dedans).
- « Duplicate digest » : `findByDigest()` sur le store rend `intake()` idempotent — un second appel avec le même contenu (même nom déclaré différent) retourne l'enregistrement existant sans re-traiter ni dupliquer.
- « Promotion requires broker authorization » (texte de l'étape 3) alors que `capabilityBroker` n'apparaît PAS dans la liste Consumes de la tâche (incohérence texte/interface, comme rencontré ailleurs dans cette session) — tranché en faveur du texte explicite : `capabilityBroker` accepté en paramètre optionnel de `promote()` uniquement.

- [x] **Step 2: Run red**

Run: `npx vitest run tests/document-intake.test.mjs tests/document-quarantine.test.mjs`
Expected: FAIL missing modules.
Réel : confirmé, `Cannot find module` sur les deux fichiers avant implémentation.

- [x] **Step 3: Implement atomic quarantine records**

```js
return Object.freeze({ documentId, digest, source, declaredName, detectedType, size, status: decision.safe ? 'inspectable' : 'quarantined', reasons, observedAt: clock.now() })
```

Write into `<userData>/quarantine/<documentId>` with no execute bit/handler invocation. Promotion requires broker authorization and a final realpath scope check.
Fichiers écrits sans extension sous `quarantine/<documentId>` (empêche l'association de type de fichier Windows), `mode:0o600` (best-effort, non contraignant sur Windows mais sans effet nocif). Écriture de promotion en `flag:'wx'` (échoue si la destination existe déjà — jamais d'écrasement silencieux).

- [x] **Step 4: Run tests and suite**

Run: `npx vitest run tests/document-intake.test.mjs tests/document-quarantine.test.mjs && npm test`
Expected: PASS.
Réel : 14 + 13 tests ciblés verts ; suite complète 177 fichiers / 1154 tests verts.

- [x] **Step 5: Conditional commit**

Message: `feat(documents): quarantine untrusted document inputs`.
Réel : `commit_skipped_non_git`.

### Task 2: Structured parsing and evidence

**Files:**
- Create: `src/documents/document-parser-registry.mjs`
- Create: `src/documents/document-evidence-store.mjs`
- Test: `tests/document-parser-registry.test.mjs`
- Test: `tests/document-evidence-store.test.mjs`

**Interfaces:**
- Consumes: local reader registry/OCR from v3; parsers expose `supports(mediaType)`, `parse({ bytes, signal })`.
- Produces: `parse(documentId) -> DocumentObservation`, `cite(documentId, locator)`.

- [x] **Step 1: Write provenance tests**

```js
const observation = await registry.parse(pdfItem)
expect(observation.blocks[0]).toMatchObject({ page: 1, text: expect.any(String), sourceOffset: expect.any(Object), confidence: expect.any(Number) })
```

11 tests (`document-parser-registry.test.mjs`, y compris ce cas exact) + 11 tests (`document-evidence-store.test.mjs`).

Décision de scope assumée : `document-parser-registry.mjs` est un registre GÉNÉRIQUE testé avec des parseurs FAKE conformes à l'interface `{id, version, supports(mediaType), parse({bytes, signal})}` — je n'ai PAS câblé de parseur réel enveloppant `src/files/document-reader.mjs`/`src/providers/local-ocr.mjs` (v3, vérifiés dans le code) dans cette tâche : ni l'un ni l'autre fichier « adaptateur parseur réel » n'est listé par le plan pour Task 2, et `document-reader.mjs` lit lui-même depuis un chemin disque (protection TOCTOU intégrée) plutôt que d'accepter des octets déjà chargés, ce qui demanderait une réconciliation d'API hors scope de cette tâche précise. Point d'intégration réel documenté, pas construit.
`document-evidence-store.mjs` : la sélection de blocs (`markSelected`/`isSelected`/`listSelected`) est le mécanisme concret derrière « crops excluded from RAG/export unless explicitly selected » — rien n'est sélectionné par défaut, testé explicitement y compris pour un bloc OCR.

- [x] **Step 2: Run red**

Run: `npx vitest run tests/document-parser-registry.test.mjs tests/document-evidence-store.test.mjs`
Expected: FAIL.
Réel : confirmé, `Cannot find module` sur les deux fichiers avant implémentation.

- [x] **Step 3: Implement normalized observations**

```js
const observation = Object.freeze({ documentId, mediaType, pageCount, sections, blocks, tables, fields, sourceOffsets, confidence, parserId, parserVersion })
```

Reject parser output without locator/provenance. OCR zones reference local crops by digest; crops are excluded from RAG/export unless explicitly selected.
`confidence` global de l'observation = moyenne des `confidence` de chaque bloc. Sortie parseur SANS `sourceOffset` ou `confidence` par bloc rejetée explicitement, testé pour chaque champ séparément.

- [x] **Step 4: Run tests**

Run: `npx vitest run tests/document-parser-registry.test.mjs tests/document-evidence-store.test.mjs && npm test`
Expected: PASS.
Réel : 11 + 11 tests ciblés verts ; suite complète 179 fichiers / 1176 tests verts.

- [x] **Step 5: Conditional commit**

Message: `feat(documents): preserve structured extraction evidence`.
Réel : `commit_skipped_non_git`.

### Task 3: Classification and controlled RAG ingestion

**Files:**
- Create: `src/documents/document-classifier.mjs`
- Create: `src/documents/document-memory-service.mjs`
- Test: `tests/document-classifier.test.mjs`
- Test: `tests/document-memory-service.test.mjs`

**Interfaces:**
- Consumes: capability router, response gate, evidence store, memory/RAG repository.
- Produces: `proposeClassification`, `confirmClassification`, `indexSelection`, `forgetDocument`.

- [x] **Step 1: Write no-auto-ingestion tests**

```js
const proposal = await classifier.proposeClassification(observation)
expect(await rag.countByDocument(observation.documentId)).toBe(0)
await memory.indexSelection({ proposalId: proposal.id, blockIds: ['b1'] })
expect(await rag.countByDocument(observation.documentId)).toBe(1)
```

7 tests (`document-classifier.test.mjs`) + 7 tests (`document-memory-service.test.mjs`, y compris ce cas exact reproduit littéralement).

Décisions et écarts assumés :
- `capabilityBroker`/`response gate` (Consumes) **non intégrés en profondeur** dans cette tâche — le seul test donné par le plan n'appelle jamais `confirmClassification` avant `indexSelection` (juste `proposeClassification` → `indexSelection` directement), ce qui montre que l'acte de SÉLECTIONNER des `blockIds` précis EST la confirmation humaine implicite ; `confirmClassification` reste une étape de correction optionnelle et séparée, jamais un préalable obligatoire à l'indexation. Un vrai portage vers `capabilityBroker.authorize()`/`gateResponse()` resterait à faire si l'indexation doit un jour être déclenchable par une automatisation plutôt qu'une action manuelle.
- `blockIds` (chaînes, ex. `'b1'`) mappées vers l'index de tableau du bloc correspondant (`b1` → index 1) — convention assumée, non donnée littéralement par le plan (les blocs de Task 2 n'ont pas de champ `blockId` propre).
- `forgetDocument` cascade réellement les chunks RAG (`ragRepository.deleteByDocument`, testé) mais PAS les arêtes du graphe personnel (« edges » du texte du plan) — aucune dépendance au graphe (`src/graph/`) n'a été câblée dans cette tâche, gap honnête plutôt que faussement complet. Ne supprime jamais le fichier source (`sourceFileDeleted:false` toujours retourné), testé explicitement.

- [x] **Step 2: Run red**

Run: `npx vitest run tests/document-classifier.test.mjs tests/document-memory-service.test.mjs`
Expected: FAIL.
Réel : confirmé, `Cannot find module` sur les deux fichiers avant implémentation.

- [x] **Step 3: Implement proposal, confirmation and sourced chunks**

Store project/category/person/date/classification/retention as a proposal. Index only confirmed blocks with document digest, locator and classification. `forgetDocument` cascades chunks/edges but does not delete the source file automatically.

- [x] **Step 4: Run tests**

Run: `npx vitest run tests/document-classifier.test.mjs tests/document-memory-service.test.mjs && npm test`
Expected: PASS.
Réel : 7 + 7 tests ciblés verts ; suite complète 181 fichiers / 1190 tests verts.

- [x] **Step 5: Conditional commit**

Message: `feat(documents): classify and index selected evidence`.
Réel : `commit_skipped_non_git`.

### Task 4: Form diffs and bounded conversions

**Files:**
- Create: `src/documents/form-service.mjs`
- Create: `src/documents/document-converter.mjs`
- Test: `tests/form-service.test.mjs`
- Test: `tests/document-converter.test.mjs`

**Interfaces:**
- Consumes: evidence store, sandbox runner, file writer, capability broker.
- Produces: `proposeFill`, `renderPreview`, `commitCopy`, `convert`.

- [x] **Step 1: Write no-invention and original-integrity tests**

```js
const proposal = await forms.proposeFill({ documentId, values: { iban: undefined } })
expect(proposal.unresolvedFields).toContain('iban')
await forms.commitCopy(proposal.id)
expect(await digest(originalPath)).toBe(originalDigest)
```

12 tests (`form-service.test.mjs`, y compris ce cas exact) + 8 tests (`document-converter.test.mjs`).

Décisions et écarts assumés :
- `commitCopy` : intégrité de l'original garantie STRUCTURELLEMENT (jamais de chemin original passé à `fileWriter.writeAtomic`, toujours un nouveau chemin `documents/filled/...`) — testé en vérifiant qu'aucune écriture ne cible le chemin original ET que son digest reste inchangé.
- Remplissage réel de formulaire PDF **non implémenté** (aucune librairie PDF-form dans `package.json`, vérifié) — `commitCopy` écrit une copie JSON structurée `{documentId, values}` plutôt qu'un PDF rempli rendu. `renderPreview` = texte lisible des diffs, pas un rendu visuel. Gap honnête, scope volontairement réduit plutôt que simulé.
- Champs sensibles (`iban`, `signature`, `ssn`, `password`, `creditCard`, `cardNumber`) : confirmation locale + autorisation broker exigées UNIQUEMENT si au moins un diff RÉEL (résolu) touche un de ces champs — un champ sensible resté `unresolvedFields` (jamais résolu en diff) n'en déclenche pas l'exigence, cohérent avec le test donné (iban `undefined` → jamais dans `diffs` → `commitCopy` sans confirmation nécessaire).
- `document-converter.mjs` consomme un `sandboxRunner` ABSTRAIT (`.run({inputPath, timeoutMs, memoryLimitMb, maxOutputBytes, networkOff:true}) -> {outputBytes, outputDigest, outputType}`), testé avec des fakes — pas branché sur le vrai sandbox Windows v2 (`src/sandbox/windows-sandbox.mjs`, vérifié existant) dans cette tâche, même logique que les autres intégrations différées de cette session (contrat testé, câblage réel = suite).
- Allowlist de conversions volontairement minimale (`docx/odt/xlsx/ods/png/jpeg → pdf`) — toute paire hors liste rejetée AVANT tout appel sandbox (testé, `sandboxRunner.run` jamais invoqué).

- [x] **Step 2: Run red**

Run: `npx vitest run tests/form-service.test.mjs tests/document-converter.test.mjs`
Expected: FAIL.
Réel : confirmé, `Cannot find module` sur les deux fichiers avant implémentation.

- [x] **Step 3: Implement sourced diffs and sandboxed conversion**

Each field has `{ oldValue, proposedValue, sourceRef, confidence }`. Sensitive fields/signature require local confirmation. Converters receive one input, one temp output, network off, timeout/memory/output limits; promote only after digest/type validation.
Validation stricte avant promotion : `outputDigest`/`outputType` requis dans le résultat sandbox (rejeté sinon), type réel comparé au type MIME attendu du format cible, taille de sortie bornée — tout testé indépendamment.

- [x] **Step 4: Run tests**

Run: `npx vitest run tests/form-service.test.mjs tests/document-converter.test.mjs && npm test`
Expected: PASS.
Réel : 12 + 8 tests ciblés verts ; suite complète 183 fichiers / 1210 tests verts.

- [x] **Step 5: Conditional commit**

Message: `feat(documents): add sourced form diffs and conversions`.
Réel : `commit_skipped_non_git`.

### Task 5: Idempotent downloads and printing

**Files:**
- Create: `src/documents/download-service.mjs`
- Create: `src/printing/printer-registry.mjs`
- Create: `src/printing/print-service.mjs`
- Test: `tests/download-service.test.mjs`
- Test: `tests/print-service.test.mjs`

**Interfaces:**
- Consumes: registered browser download, Windows spooler adapter, action verifier, automation ledger.
- Produces: `download(proposal)`, `discover`, `approvePrinter`, `proposePrint`, `submit`, `reconcile`.

- [x] **Step 1: Write duplicate-job tests**

```js
const first = await print.submit(proposal)
const second = await print.submit(proposal)
expect(spooler.submit).toHaveBeenCalledTimes(1)
expect(second.jobId).toBe(first.jobId)
```

12 tests (`print-service.test.mjs`, y compris ce cas exact et les 5 états couverts individuellement) + 7 tests (`download-service.test.mjs`).

Décisions et écarts assumés :
- « automation ledger » (Consumes) **non réutilisé littéralement** : `automation-ledger.mjs` (plan v4 automatisations) est structurellement lié aux runs d'automatisation (`runId/automationId/simulationId`), pas à des jobs d'impression — forcer sa réutilisation aurait été un décalage de schéma artificiel. `print-service.mjs` garde son propre suivi d'idempotence interne (`Map` par `proposalId`), plus simple et découplé.
- `reconcile()` : `completed` n'est renvoyé QUE si `actionVerifier.verify()` confirme réellement — un spooler qui prétend `completed` sans confirmation vérifiable retombe en `state_unknown`, jamais un faux positif. Une requête spooler qui échoue (exception) ou un statut hors du vocabulaire à 5 états retombe aussi en `state_unknown` — jamais une supposition de succès. Les 5 états testés individuellement.
- `download()` : idempotent par `(destination, digest)` — un second appel sur une destination déjà téléchargée avec le MÊME digest ne retélécharge jamais (`status:'already_present'`) ; une destination existante avec un digest DIFFÉRENT est un échec explicite (`download_destination_already_exists`), jamais un écrasement silencieux. Écriture finale en `flag:'wx'` (échoue si le fichier existe déjà, protection supplémentaire au niveau OS).

- [x] **Step 2: Run red**

Run: `npx vitest run tests/download-service.test.mjs tests/print-service.test.mjs`
Expected: FAIL.
Réel : confirmé, `Cannot find module` sur les trois fichiers avant implémentation.

- [x] **Step 3: Implement explicit proposals and state vocabulary**

Print proposal fixes digest/printer/pages/copies/duplex/color/media/estimated sheets. States: `accepted_by_spooler|printing|completed|failed|state_unknown`. Download fixes final URL/digest/destination and performs atomic rename without overwriting.
`proposePrint` refuse toute imprimante non explicitement approuvée via `printerRegistry.approvePrinter()` — jamais d'impression sur une imprimante juste « découverte ».

- [x] **Step 4: Run tests**

Run: `npx vitest run tests/download-service.test.mjs tests/print-service.test.mjs && npm test`
Expected: PASS.
Réel : 12 + 7 tests ciblés verts ; suite complète 185 fichiers / 1229 tests verts.

- [x] **Step 5: Conditional commit**

Message: `feat(printing): verify idempotent document outputs`.
Réel : `commit_skipped_non_git`.

### Task 6: Signed offline emergency corpus

**Files:**
- Create: `src/emergency/emergency-corpus.mjs`
- Create: `src/emergency/emergency-mode.mjs`
- Test: `tests/emergency-corpus.test.mjs`
- Test: `tests/emergency-mode.test.mjs`

**Interfaces:**
- Consumes: keyring, selected source exporters, network policy, domain registry, local RAG.
- Produces: `build(selection)`, `verify(bundle)`, `activate`, `deactivate`, `search`.

- [x] **Step 1: Write offline/tamper tests**

```js
const bundle = await corpus.build(selection)
network.disableAll()
await mode.activate(bundle.path)
expect(await mode.search('contact urgence')).toHaveProperty('observedAt')
await tamper(bundle.path)
await expect(mode.activate(bundle.path)).rejects.toThrow('emergency_manifest_invalid')
```

8 tests (`emergency-corpus.test.mjs`) + 8 tests (`emergency-mode.test.mjs`, y compris ce scénario exact reproduit dans un seul test bout-en-bout).

Décisions et un bug réel corrigé :
- Réutilise `sealRecord`/`openRecord` (`src/memory/record-codec.mjs`, AEAD réel, déjà utilisé pour le stockage e-mail chiffré) plutôt que réinventer un format signé — la détection d'altération est un sous-produit NATUREL de l'AEAD (tag d'authentification), pas une vérification ajoutée à la main.
- **Bug réel trouvé et corrigé avant tout test** : ma première version tentait de récupérer l'`id` d'AAD depuis l'enveloppe déchiffrée (`envelope.aad?.id`) pour rappeler `openRecord()` — mais `encryptAead()`/`decryptAead()` (vérifiés dans `src/crypto/aead.mjs`) ne stockent JAMAIS l'AAD dans l'enveloppe (seulement `{version, nonce, ciphertext, authTag}`), donc cette lecture était toujours `undefined` : un id d'AAD différent à l'ouverture aurait fait échouer TOUT déchiffrement, même un fichier non altéré. Corrigé avec un id d'AAD FIXE (`'emergency-corpus-bundle'`, sert seulement à séparer ce type d'enregistrement des autres partageant la même clé) — le vrai `bundleId` voyage à l'intérieur du contenu chiffré.
- Altération testée par inversion d'un octet du `ciphertext` (le tag d'authentification GCM échoue) ET par une clé de keyring différente (mauvais destinataire) — les deux rejettent `emergency_manifest_invalid`, jamais un déchiffrement partiel/silencieux.
- `activate()` appelle explicitement `networkPolicy.disableAll()`, `domainRegistry.disableExternal()`, `deviceGuard.disableCameraAndMic()` — les 3 testés individuellement (`toHaveBeenCalledTimes(1)`).
- « local diagnostics/RAG remain » et « sensitive confirmations unchanged » : pas de désactivation locale implémentée (rien à désactiver, ces systèmes restent actifs par absence d'action — comportement par défaut correct, pas un gap).

- [x] **Step 2: Run red**

Run: `npx vitest run tests/emergency-corpus.test.mjs tests/emergency-mode.test.mjs`
Expected: FAIL.
Réel : confirmé, `Cannot find module` sur les deux fichiers avant implémentation.

- [x] **Step 3: Implement encrypted manifest and restrictive mode**

Manifest contains item digest/version/classification/observedAt. Activation disables cloud routes, external automations and network; local diagnostics/RAG remain. Camera/micro off by default. Sensitive confirmations unchanged.

- [x] **Step 4: Run tests**

Run: `npx vitest run tests/emergency-corpus.test.mjs tests/emergency-mode.test.mjs && npm test`
Expected: PASS with network spy at zero.
Réel : 8 + 8 tests ciblés verts ; suite complète 187 fichiers / 1245 tests verts.

- [x] **Step 5: Conditional commit**

Message: `feat(emergency): add verified offline corpus`.
Réel : `commit_skipped_non_git`.

### Task 7: Document and emergency administration pages

**Files:**
- Create: `src/ui/ipc/document-ipc.mjs`
- Create: `src/ui/ipc/emergency-ipc.mjs`
- Create: `src/ui/pages/document-controller.mjs`
- Create: `src/ui/pages/emergency-controller.mjs`
- Modify: `src/ui/renderer/app.js`
- Modify: `src/ui/index.html`
- Test: `tests/document-ui-contract.test.mjs`

**Interfaces:**
- Consumes: Tasks 1–6 services.
- Produces: named IPC `mina:documents:*`, `mina:printing:*`, `mina:emergency:*`.

- [x] **Step 1: Write redaction/preview tests**

```js
expect(await controller.getDocument(id)).not.toHaveProperty('rawBytes')
expect(channels).not.toContain('mina:documents:write-raw')
expect(await emergencyController.status()).toMatchObject({ network: 'disabled' })
```

10 tests dans `tests/document-ui-contract.test.mjs`, couvrant les 3 assertions exactes ci-dessus contre de VRAIS services Task 1/6 (`document-intake`, `document-quarantine`, `emergency-corpus`, `emergency-mode`), pas seulement des fakes.

Décisions et écarts assumés (même patron que les Task 8 des deux plans v4 précédents) :
- `src/ui/renderer/app.js` n'existe pas — vrai fichier `src/ui/renderer.js` modifié : nouvelle section « Documents & urgence » (badge réseau lecture seule), réutilise le bouton `#automation-refresh` existant plutôt que d'ajouter un bouton dédié (changement minimal). `preload-api.cjs` étendu d'une méthode (`getEmergencyStatus`).
- `main.mjs` **délibérément non câblé** : aucun repository de production pour quarantaine/évidence/classification, aucun exportateur réel pour le corpus d'urgence, aucun adaptateur spooler Windows réel — même limite assumée que les Task 8 précédentes.
- Redaction de `getDocument` garantie STRUCTURELLEMENT (pas une étape de nettoyage ajoutée) : le record de quarantaine (`document-contracts.mjs`, Task 1) n'a jamais contenu `rawBytes` en premier lieu — seul `readBytes()` (jamais exposé via IPC) donne accès aux octets. Vérifié en cherchant `%PDF` (contenu réel du fixture) absent du JSON sérialisé du DTO.
- `emergencyController.status()` traduit `emergencyMode.status()` (`{active, bundleId}`) vers `{network: active ? 'disabled' : 'enabled', ...}` — testé dans les 3 états (jamais activé, activé, désactivé après activation).
- Pages `Documents`/`Formulaires`/`Impression`/`Téléchargements`/`Urgence` (texte de l'étape 3) : PAS de vues interactives complètes construites (mêmes raisons d'infra de test absente que les 2 Task 8 précédentes) — seule une section de statut lecture-seule réelle ajoutée, testée via `npm run smoke` (exit 0).

- [x] **Step 2: Run red**

Run: `npx vitest run tests/document-ui-contract.test.mjs`
Expected: FAIL.
Réel : confirmé, `Cannot find module` avant implémentation.

- [x] **Step 3: Implement pages**

Pages `Documents`, `Formulaires`, `Impression`, `Téléchargements`, `Urgence` display quarantine, sources, diffs, printer/job states and corpus freshness. Raw bytes and secrets never enter renderer.

- [x] **Step 4: Run final gate**

Run: `npx vitest run tests/document-ui-contract.test.mjs && npm test && npm run test:integration`
Expected: all PASS.
Réel : 10 tests ciblés verts ; suite complète 188 fichiers / 1255 tests verts ; intégration 6 fichiers / 8 tests verts ; `npm run smoke` exit 0.

- [x] **Step 5: Conditional commit**

Message: `feat(ui): add document and emergency controls`.
Réel : `commit_skipped_non_git`.

