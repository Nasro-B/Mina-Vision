# Mina v2 — plan noyau, grounding et sessions

> **Pour l’agent d’exécution :** utiliser `superpowers:executing-plans`. Sous-agents interdits sans procédure d’autorisation explicite de Nasro.

**Objectif :** introduire le cycle runtime/work-session et empêcher Mina d’affirmer un fait ou une action sans preuve structurée.

**Architecture :** les modules sont purs et injectés dans l’orchestrateur. `SessionManager` publie les hooks, `ClaimLedger` trace les affirmations, `EvidenceValidator` applique les politiques de preuve, `ResponseGate` produit la réponse autorisée. `ActionVerifier` compare l’état avant/après. Le renderer ne reçoit que des projections sérialisables.

**Prérequis :** baseline `npm test` verte avec 93 tests. Aucun changement de dépendance requis avant la tâche 2.

## État d’exécution

- [x] Tâche 1 — contrats versionnés : `zod@4.4.3`, 20 tests ciblés.
- [x] Tâche 2 — runtime/work sessions : 7 tests ciblés.
- [x] Tâche 3 — registre d’affirmations et preuves : 12 tests ciblés.
- [x] Tâche 4 — fait JSON structuré, contradictions déterministes et gate de réponse.
- [x] Tâche 5 — vérification après action et intégration orchestrateur.
- [x] Tâche 6 — capability broker, politiques de canal et confirmations one-shot.
- [x] Tâche 7 — composition runtime, IPC en lecture seule et affichage des statuts.

Checkpoint du 15 juillet 2026 : `npm test` = 28 fichiers / 180 tests verts ; `npm run test:integration` = 2/2 verts ; `npm run smoke` = code `0`. Le test manuel dry-run avec une mission réelle n’a pas été exécuté.

---

## Tâche 1 — contrats versionnés et tests de validation

**Fichiers :**

- Créer `src/contracts/envelope.mjs`
- Créer `src/contracts/events.mjs`
- Créer `src/contracts/claims.mjs`
- Créer `tests/contracts.test.mjs`

**Interfaces :** `parseEnvelope`, `parseSessionEvent`, `parseClaim`, constantes `CLAIM_STATUS` et `CHANNELS`.

1. Écrire les tests rouges : rejet des clés inconnues, chaîne vide, date invalide, canal inconnu, statut inconnu, ciphertext trop grand et expiration antérieure à création.
2. Exécuter `npx vitest run tests/contracts.test.mjs` ; attendu : échec `ERR_MODULE_NOT_FOUND`.
3. Ajouter `zod@4.4.3` avec `npm install --save-exact zod@4.4.3`.
4. Implémenter des schémas stricts et immuables ; limites : payload 1 MiB, identifiants 128 caractères, type 80, horodatages ISO, version exactement `1`.
5. Exécuter le test ciblé puis `npm test` ; attendu : tous verts.
6. Contrôler `npm ls zod` ; attendu : `zod@4.4.3`, aucune duplication majeure.

## Tâche 2 — runtime session et work session

**Fichiers :**

- Créer `src/sessions/session-manager.mjs`
- Créer `src/sessions/session-store.mjs`
- Créer `tests/session-manager.test.mjs`

**Interfaces :**

```js
createSessionManager({ store, clock, ids, hooks, checkpointEveryMs })
// startRuntime(), ready(), startWork({ channel, identityId, goal })
// beforeTurn(), afterTurn(), checkpoint(), endWork(), endRuntime(), recover()
```

1. Tests rouges : ordre des hooks, un seul runtime actif, work sessions imbriquées interdites pour une même clé de canal, Telegram expire après 30 min d’inactivité, SMS est une micro-session, `recover()` clôt une session crashée sans rejouer un hook d’action.
2. Exécuter `npx vitest run tests/session-manager.test.mjs` ; attendu : module absent.
3. Implémenter une machine à états `created → active → ending → ended`, et `crashed` pour la récupération.
4. Le store de cette tâche est un port en mémoire append-only ; aucune base persistante avant le plan mémoire.
5. Hooks exacts : `runtime_start`, `runtime_ready`, `work_session_start`, `before_turn`, `after_turn`, `before_tool`, `after_tool`, `checkpoint`, `work_session_end`, `runtime_end`.
6. Exécuter test ciblé puis suite complète.

## Tâche 3 — registre d’affirmations et preuves

**Fichiers :**

- Créer `src/grounding/claim-ledger.mjs`
- Créer `src/grounding/evidence-validator.mjs`
- Créer `src/grounding/source-policy.mjs`
- Créer `tests/claim-ledger.test.mjs`
- Créer `tests/evidence-validator.test.mjs`

**Interfaces :**

```js
ledger.add({ sessionId, text, kind, sourceRefs, status })
validator.validate(claim, evidence[]) // { status, acceptedEvidence, reasons }
```

1. Tests rouges couvrant `verified`, `inference`, `uncertain`, `not_found`, `unsupported`, `stale`.
2. Prouver qu’un texte du modèle sans `sourceRef` devient `unsupported`.
3. Prouver qu’une donnée live (`current_state`) fondée uniquement sur un document devient `stale`.
4. Prouver qu’une absence exige une preuve avec `scope`, `query`, `executedAt`, résultat vide et source exhaustive.
5. Implémenter la matrice : source observée > extraction structurée > inférence déclarée ; aucune promotion automatique d’inférence en vérifié.
6. Chaque preuve contient `sourceId`, `locator`, `capturedAt`, `contentDigest`, `freshnessClass`, `extract`, `method`.
7. Exécuter tests ciblés puis suite.

## Tâche 4 — contradictions et gate de réponse

**Fichiers :**

- Créer `src/grounding/contradiction-detector.mjs`
- Créer `src/grounding/response-gate.mjs`
- Créer `tests/response-gate.test.mjs`

**Interfaces :** `detectContradictions(claims)` et `gateResponse({ draft, claims, citations, channel })`.

1. Tests rouges : deux valeurs incompatibles pour une même clé ; source plus récente ; absence contradite par présence ; citation inconnue ; claim factuel absent du ledger.
2. Le gate doit soit retourner `{ decision:'allow', response }`, soit `{ decision:'revise', issues }`, soit `{ decision:'block', safeResponse }`.
3. En `allow`, chaque claim vérifiable est relié à au moins une preuve acceptée ; les inférences portent le libellé français `Inférence`.
4. En cas d’incertitude non dangereuse, autoriser une réponse explicitement incertaine. En matière d’action, sécurité, identité ou secret, bloquer.
5. Exécuter `npx vitest run tests/response-gate.test.mjs` puis suite complète.

## Tâche 5 — vérification des actions

**Fichiers :**

- Créer `src/grounding/action-verifier.mjs`
- Modifier `src/core/orchestrator.mjs`
- Modifier `tests/orchestrator.test.mjs`
- Créer `tests/action-verifier.test.mjs`

**Interfaces :**

```js
verifyAction({ action, before, result, after, expectedEffect })
// { status:'verified'|'failed'|'unknown', evidence, reason }
```

1. Ajouter un test rouge dans `orchestrator.test.mjs` : un exécuteur répond `{executed:true}` mais l’observation après reste identique ; Mina ne doit pas annoncer l’action terminée.
2. Tester impression/téléchargement/envoi avec un reçu structuré ; `executed:true` seul vaut `unknown`.
3. Implémenter des vérificateurs par effet : changement DOM/accessibilité, fichier apparu avec digest, job d’impression accepté avec ID, message accepté avec ID distant, état UI modifié.
4. Modifier minimalement l’orchestrateur : capturer `before`, exécuter, capturer `after`, valider, transmettre le résultat vérifié au modèle et au ledger.
5. Après trois échecs consécutifs de vérification, conserver le comportement d’arrêt existant.
6. Exécuter tests ciblés, intégration navigateur, puis suite complète.

## Tâche 6 — capability broker et politique par canal

**Fichiers :**

- Créer `src/safety/capability-broker.mjs`
- Créer `src/safety/channel-policy.mjs`
- Modifier `src/safety/policy.mjs`
- Créer `tests/capability-broker.test.mjs`
- Modifier `tests/safety-policy.test.mjs`

1. Tests rouges : SMS refuse toute capacité sauf `conversation.reply_draft`, `conversation.reply_send` selon politique ; Telegram autorise conversation/mémoire et refuse `computer.*`, `filesystem.*`, `skill.execute`, `sandbox.execute`.
2. Test de confirmation liée à un digest et consommable une seule fois.
3. Test : un hook/skill demandant une permission supérieure reçoit `deny` sans dialogue de confirmation.
4. Implémenter l’intersection `base policy ∩ channel policy ∩ session grants ∩ resource scope`.
5. Garder les blocages existants (terminal, gestionnaire de mots de passe, sécurité Windows).
6. Exécuter tests ciblés puis suite.

## Tâche 7 — intégration Electron des sessions et du gate

**Fichiers :**

- Créer `src/core/mina-runtime.mjs`
- Modifier `src/ui/main.mjs`
- Modifier `src/ui/preload.cjs`
- Modifier `src/ui/renderer.js`
- Créer `tests/mina-runtime.test.mjs`
- Modifier `tests/ui-controller.test.mjs`

1. Tests rouges : démarrage runtime avant fenêtre prête, work session à chaque mission, fin normale/erreur/arrêt d’urgence, renderer ne peut pas publier lui-même un évènement de preuve.
2. Construire `createMinaRuntime()` comme composition root testable ; réduire `main.mjs` à Electron/lifecycle.
3. IPC en lecture seule pour `mina:session-state`, `mina:claims`, `mina:grounding-status`; aucune API renderer pour falsifier un claim.
4. Afficher dans l’UI `Vérifié`, `Inférence`, `Incertain`, `Action non vérifiée` sans exposer les extraits secrets.
5. Sur `before-quit`, checkpoint borné puis `runtime_end`; au-delà de 2 s, marquer crash-recovery et quitter.
6. Exécuter `npm test`, `npm run test:integration`, `npm run smoke`.

## Gate de fin du plan 1

- Tous les nouveaux tests verts, aucune régression des 93 tests initiaux.
- Test manuel local en mode dry-run : une mission crée une work session et affiche son état.
- Une fausse réussite simulée ne passe pas le gate.
- Aucun stockage durable ni mémoire distante encore activé.
