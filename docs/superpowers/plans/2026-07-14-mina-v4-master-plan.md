# Mina v4 Extensions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Tout sous-agent exige l’autorisation explicite préalable de Nasro, avec annonce du nombre d’agents et de leur rôle.

**Goal:** Ajouter à Mina une autonomie simulée puis configurable, un centre de fiabilité, une organisation personnelle unifiée, des opérations documentaires hors ligne et un système d’extensions privées sûres.

**Architecture:** Les extensions v4 reposent sur les fondations v3 sans les dupliquer. `CapabilityBroker` autorise, `AutomationPolicy` restreint, les services métier exécutent, `ActionVerifier` prouve l’effet et les ledgers permettent la récupération sans rejeu. Les quatre sous-plans restent testables indépendamment et ne touchent le composition root/UI qu’à leur dernière tâche.

**Tech Stack:** Node 22, Electron 43, JavaScript ESM, Vitest 4, SQLite chiffré v2, UI HTML/CSS/JS vanilla, Telegram via le Huawei Kotlin, modèles et budgets v3.

## Global Constraints

- Toute automatisation commence en `draft` ou `shadow`; aucune promotion automatique.
- Une policy est explicite, bornée, digestée, expirante et révocable.
- `CapabilityBroker` reste l’unique autorité ; une automation ou un connecteur ne peut qu’ajouter des restrictions.
- Les actions à effet utilisent une clé d’idempotence et une preuve après exécution ; sinon état `unknown`.
- Aucun message, modèle, page ou événement entrant ne peut créer/activer/modifier une policy.
- Risques `local_only` jamais approuvés par Telegram.
- Connecteurs importés localement, signés, quarantainés, testés puis activés en mode ombre.
- Le mode urgence fonctionne sans cloud et n’abaisse aucune confirmation sensible.
- Aucune donnée personnelle brute dans les fixtures committées.
- Aucun `git init`, commit, push ou déploiement sans ordre explicite. Les étapes commit sont conditionnelles.

---

## Prerequisite Gates

- [x] Exécuter et valider [Mina v3 master](2026-07-14-mina-v3-master-plan.md) jusqu’aux domaines utilisés : sessions, keyring, DB, memory/RAG, broker, models, usage/budgets, Android/Telegram, documents/fichiers et UI controllers.
Réel : les 12 plans de son « Mandatory Execution Order » sont vérifiés à jour (2026-07-16) : `v2-core-grounding-sessions` (déjà coché), `v2-memory-research` (vérification rétroactive, 17 fichiers/83 tests), `v3-provider-routing-settings` (vérification rétroactive, 11 fichiers/28 tests), `v3-local-models-computer-use`/`v3-usage-analytics-budgets`/`v3-local-voice` (déjà cochés), `v2-skills-sandbox` (vérification rétroactive, 13 fichiers/53 tests), `v3-android-kotlin-gateway` (vérification rétroactive, Gradle rejoué à neuf, 27 tests Kotlin), `v3-camera-biometrics`/`v3-email-gateway`/`v3-smart-home`/`v3-integration-launch` (déjà faits, dans l'« Ordre d'exécution retenu » d'`EXECUTION-LOG.md`). Voir la section « Revue exhaustive de tous les docs » d'`EXECUTION-LOG.md` pour le détail complet.
- [x] Vérifier `npm test` vert et `npm run test:integration` vert.
Réel : `npm test` → 210 fichiers / 1529 tests verts ; `npm run test:integration` → 13 fichiers / 34 tests verts (2026-07-16, rejoué frais).
- [x] Vérifier que `git rev-parse --is-inside-work-tree` échoue encore ; si oui, ignorer tous les commits conditionnels sans initialiser Git.
Réel : rejoué directement (pas supposé) → `fatal: not a git repository (or any of the parent directories): .git`, code de sortie 128. Tous les commits de ce plan et de ses sous-plans restent `commit_skipped_non_git`.

## Mandatory Execution Order

1. [Automation governance, shadow mode, recovery, evaluation and health](2026-07-14-mina-v4-automation-reliability-plan.md).
2. [Personal organization, routines and knowledge graph](2026-07-14-mina-v4-organization-knowledge-plan.md).
3. [Document operations, printing and emergency corpus](2026-07-14-mina-v4-document-emergency-plan.md).
4. [Samsung approvals, private connectors and personality](2026-07-14-mina-v4-approvals-connectors-personality-plan.md).

Plan 1 est obligatoire avant les trois autres. Plans 2 et 3 peuvent être indépendants logiquement, mais restent séquentiels dans ce projet afin d’éviter les collisions sur DB, IPC et renderer. Plan 4 arrive après skills/sandbox/Telegram et consomme la gouvernance du plan 1.

## Canonical Cross-Plan Interfaces

```js
automationPolicy.evaluate({ definition, grant, trigger, simulation, context })
// -> { decision: 'simulate'|'confirm'|'allow'|'deny', reasons, limits }

simulationEngine.simulate({ definition, trigger, context, signal })
// -> { simulationId, digest, proposedActions, disclosures, uncertainties }

automationRunner.run({ definition, grant, trigger, simulation, confirmation, signal })
// -> { runId, status, receipts, evidence }

remoteApprovalService.request({ capabilityRequest, action, observedState, expiresAt })
// -> { approvalId, digest, status: 'pending' }

connectorRegistry.invoke({ connectorId, capability, input, signal })
// -> { receipt, output, verificationHint }
```

## Delivery Milestones

| Jalon | Résultat observable | Gate |
|---|---|---|
| V4-1 | Une routine simulée ne produit aucun effet ; une policy expirée bloque | tests gouvernance + recovery |
| V4-2 | Briefing, calendrier/tâches et graphe avec provenance | tests adapters fake + cross-channel |
| V4-3 | Document OCR/parse/diff/print et corpus urgence offline | tests fixtures + fake spooler |
| V4-4 | Approbation Samsung one-shot, connecteur signé shadow, personnalité sans influence safety | tests adversariaux |
| V4-5 | Pages Automatisations/Récupération/Laboratoire/Aujourd’hui/Documents/Connecteurs | smoke Electron |

## Specification Coverage Matrix

| Requirement | Implementation task |
|---|---|
| Lifecycle `draft→shadow→supervised→active→suspended/revoked` | Automation plan Task 1 |
| Effect-free simulation and disclosures | Automation plan Task 2 |
| Expiring grants, budgets and most-restrictive-wins | Automation plan Task 3 |
| Idempotent execution and recovery without replay | Automation plan Tasks 4–5 |
| Evaluation laboratory and read-only health | Automation plan Tasks 6–7 |
| Google/Microsoft/CalDAV/CardDAV adapters | Organization plan Task 2 |
| Calendars, contacts, tasks and identity endpoints | Organization plan Tasks 1, 3–5 |
| Provenance-aware personal graph | Organization plan Task 6 |
| Typed routines and grounded briefing | Organization plan Tasks 7–8 |
| Quarantine, parsing evidence and selected RAG | Document plan Tasks 1–3 |
| Form diff, conversion, download and printing | Document plan Tasks 4–5 |
| Signed offline emergency corpus | Document plan Task 6 |
| One-shot Samsung approvals | Extensions plan Tasks 1–2 |
| Signed connector install/runtime/update/revocation | Extensions plan Tasks 3–6 |
| Personality isolated from safety | Extensions plan Task 7 |
| All administration pages and security gates | Final task of each sub-plan |

## Final Verification

```powershell
Set-Location 'C:\Serveurs\Mina Vision'
npm test
npm run test:integration
npm run verify
```

Expected: exit `0`. Tests réels de calendrier, imprimante, Samsung et connecteur restent opt-in, utilisent des ressources non critiques et consignent `pass|fail|not_run` avec preuve.

**Réel (2026-07-16)** : les 3 commandes rejouées fraîchement. `npm test` → 210 fichiers / 1529 tests verts. `npm run test:integration` → 13 fichiers / 34 tests verts. `npm run verify` → exit 0, sortie JSON honnête (`androidTransport.ready:true`, Huawei USB détecté en direct ; `allRequiredReady:false` avec chaque raison explicite : clés cloud non tournées, LM Studio désactivé, Wi-Fi ADB non connecté, SDK Google Home absent, comptes mail non configurables en CLI — tous déjà documentés comme bloqués côté Nasro dans `EXECUTION-LOG.md`/`Pour Nasro.md`, aucune surprise). Les 4 plans v4 (automatisations/fiabilité, organisation/connaissances, documents/urgence, approbations/connecteurs/personnalité) sont tous les 4 intégralement terminés — voir `docs/superpowers/EXECUTION-LOG.md` pour le détail tâche par tâche de chacun.
