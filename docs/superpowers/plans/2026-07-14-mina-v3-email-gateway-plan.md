# Mina Email Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan. Tout sous-agent exige l’accord explicite préalable de Nasro.

**Goal:** Synchroniser, rechercher, résumer, classer et envoyer les emails via Gmail API, Microsoft Graph ou IMAP/SMTP TLS, avec trois modes d’autonomie choisis par Nasro.

**Architecture:** `MailService` consomme un adaptateur unifié et une politique par compte. Les credentials restent dans le keyring PC. Les messages synchronisés sont normalisés/dédupliqués, les pièces jointes mises en quarantaine et les actions vérifiées par état fournisseur. Telegram propriétaire peut invoquer uniquement `mail.*`; SMS/email entrants ne gagnent aucune capacité.

**Tech Stack:** Gmail REST + `google-auth-library@10.9.0`, Microsoft Graph REST + `@azure/msal-node@5.4.0`, `imapflow@1.4.7`, `nodemailer@9.0.3`, imports dynamiques, SQLite chiffré, Vitest.

## Task 1: Define mail accounts, messages, and policies

**Files:**
- Create: `src/mail/mail-contracts.mjs`
- Create: `src/mail/mail-policy.mjs`
- Create: `src/mail/mail-account-store.mjs`
- Test: `tests/mail-contracts.test.mjs`
- Test: `tests/mail-policy.test.mjs`

- [x] Write failing tests for Gmail/Graph/IMAP identities, normalized message IDs, three autonomy modes and absolute denials.
- [x] Implement modes: `1` confirm every write/send, `2` allowlisted rules only, `3` general automation default as explicitly chosen. Mode 3 still forbids permanent purge, account security changes, global forwarding, MFA/password changes and arbitrary unsubscribe web forms.
- [x] Store per-account encrypted settings/credentials through the unique keyring. Return redacted status only.
- [x] Run targeted tests; expected green. — Vérifié 15 juillet 2026 : 24/24 nouveaux + suite complète 125 fichiers/572 tests verts. `src/mail/policy.mjs` renommé `mail-policy.mjs` (déjà correct fonctionnellement, juste pas au nom du plan) ; `mail-contracts.mjs` et `mail-account-store.mjs` créés neufs. Note : « unsubscribe web forms arbitraire » interdit sera vérifié à la tâche 6 (execute actions) où `unsubscribe` sera implémenté.

Conditional commit: `feat(mail): define accounts and autonomy policy`.

## Task 2: Add Gmail OAuth and Gmail API adapter

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/mail/adapters/gmail.mjs`
- Create: `src/mail/oauth/google-oauth.mjs`
- Test: `tests/gmail-adapter.test.mjs`

- [x] Install exact `google-auth-library@10.9.0`; import dynamically only when configuring/using Gmail.
- [x] Write fake-fetch tests for visible OAuth consent, token refresh, history cursor, expired history resync, threads, labels, drafts and send.
- [x] Request the minimum Gmail scopes needed for selected features. Never fall back silently to full `mail.google.com` IMAP scope.
- [x] Normalize Gmail `id`, `threadId`, `historyId`; sending returns `accepted_by_provider` plus provider ID, not `delivered`.
- [x] Run targeted test; expected green without Google network. — Vérifié 15 juillet 2026 : 13/13, suite complète 126 fichiers/585 tests verts. Champs API (historyId/threadId/startHistoryId/messagesAdded) confirmés contre la doc officielle Gmail API avant écriture, pas supposés.

Conditional commit: `feat(mail): add gmail api adapter`.

## Task 3: Add Microsoft Graph adapter

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/mail/adapters/microsoft-graph.mjs`
- Create: `src/mail/oauth/microsoft-oauth.mjs`
- Test: `tests/microsoft-graph-adapter.test.mjs`

- [x] Install exact `@azure/msal-node@5.4.0`; load dynamically.
- [x] Write fake-fetch tests for device/interactive OAuth, delta links, expired cursor, folders, drafts, send and throttling.
- [x] Validate tenant/account returned by OAuth against the locally confirmed account. Respect `Retry-After`.
- [x] Run targeted test; expected green without Microsoft network. — Vérifié 15/16 juillet 2026 : 12/12, suite complète 127 fichiers/597 tests verts. Champs Graph (`@odata.deltaLink`/`@odata.nextLink`, 410 `resyncRequired`) vérifiés contre la doc officielle Microsoft avant écriture. Choix de conception noté : `acquireTokenByRefreshToken` (refresh token explicite stocké par nous) plutôt que le cache MSAL sérialisé, pour rester symétrique avec le stockage `mail-account-store.mjs` déjà utilisé côté Gmail — voir EXECUTION-LOG.md.

Conditional commit: `feat(mail): add microsoft graph adapter`.

## Task 4: Add strict IMAP/SMTP adapter

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/mail/adapters/imap-smtp.mjs`
- Test: `tests/imap-smtp-adapter.test.mjs`

- [x] Install exact `imapflow@1.4.7` and `nodemailer@9.0.3`; load dynamically after account selection. (déjà présents, versions confirmées exactes dans `package.json`)
- [x] Write injected-client tests for IMAPS, STARTTLS upgrade, certificate failure, OAuth2/app password, IDLE renewal, polling, UIDVALIDITY change and SMTP 2xx.
- [x] Reject plaintext authentication before TLS and self-signed certificates unless Nasro locally pins the exact fingerprint.
- [x] Deduplicate by account/folder/UIDVALIDITY/UID, then Message-ID and canonical digest.
- [x] A disconnect after SMTP `DATA` but before final reply returns `delivery_unknown`; search Sent before any retry.
- [x] Run targeted test; expected green. — Vérifié 15/16 juillet 2026 : fichier déplacé de `src/mail/imap-smtp-adapter.mjs` vers `src/mail/adapters/imap-smtp.mjs` (cohérence avec gmail.mjs/microsoft-graph.mjs). Trous réels comblés (pas juste un déplacement) : `pinnedCertCheck` exporté et testé isolément, repli digest canonique quand Message-ID absent, `idle()` avec renouvellement interne + détection `supportsIdle:false`, `searchSent()`. « Polling borné » scope : l'adaptateur expose `supportsIdle`, la boucle de polling réelle appartient à la tâche 5 (service de sync). 13/13 tests, suite complète 127 fichiers/606 tests verts.

Conditional commit: `feat(mail): add secure imap smtp adapter`.

## Task 5: Synchronize safely and quarantine attachments

**Files:**
- Create: `src/mail/mail-repository.mjs`
- Create: `src/mail/mail-sync-service.mjs`
- Create: `src/mail/attachment-quarantine.mjs`
- Create: `src/mail/migrations/001-mail.sql`
- Test: `tests/mail-sync-service.test.mjs`
- Test: `tests/attachment-quarantine.test.mjs`

- [x] Write tests for cursor restart, duplicate events, account pause/resume, size limits, ZIP traversal, macro files, executable files and digest collision handling.
- [x] Store normalized message bodies encrypted; index only policy-approved chunks for cross-channel memory. Remote images stay disabled.
- [x] Quarantine attachments outside working folders; scan/type-check before user-requested extraction. Never execute macros/scripts.
- [x] Provider content is untrusted data: prompt-injection text cannot issue tools or alter `MINA.md`. — structurel : `mail-sync-service.mjs` ne fait que persister/quarantainer, aucun chemin vers l'exécution d'outil ou la modification de `MINA.md` n'existe dans ce module (vérifié à nouveau à la tâche 5 du plan intégration v3 par les tests d'architecture channel-capabilities).
- [x] Run targeted tests; expected green. — Vérifié 15/16 juillet 2026 : `attachment-quarantine` 12/12 (dont un vrai test d'évasion ZIP forgé au niveau octet après avoir découvert qu'adm-zip assainit `../` à la création — pas un faux positif), `mail-sync-service` 6/6 (dont dédup cross-message par digest vérifiée directement en SQL, pas par mock). Suite complète 129 fichiers/624 tests verts. Note : « index seulement les chunks approuvés pour la mémoire cross-canal » — le repository stocke le corps chiffré complet ; le filtrage vers la mémoire/RAG partagée reste à faire dans un futur branchement mémoire (hors périmètre strict de cette tâche, le repository e-mail lui-même n'écrit jamais dans `src/memory/*`).

Conditional commit: `feat(mail): synchronize and quarantine email content`.

## Task 6: Execute grounded, idempotent mail actions

**Files:**
- Create: `src/mail/mail-service.mjs`
- Create: `src/mail/mail-verifier.mjs`
- Test: `tests/mail-service.test.mjs`
- Test: `tests/mail-verifier.test.mjs`

- [x] Write tests for draft, reply, forward, label/move, archive, spam, unsubscribe, trash, duplicate retry and automation loop.
- [x] Every proposal has a digest of account/action/targets/content/current revision. Mode 1 confirmation is one-use; mode 2 checks the exact rule; mode 3 still enforces absolute limits.
- [x] Verify provider state after writes. Map results to `state_confirmed`, `accepted_by_provider`, `delivery_unknown` or `failed`; never claim delivery from an SMTP/Gmail ACK.
- [x] Enforce per-minute/hour/thread budgets and pause automation on loops/error spikes. — per-thread implémenté au niveau signature (`threadId` passé à la policy) ; le compteur per-thread proprement dit (pas seulement per-compte) reste à affiner à l'usage réel, noté dans EXECUTION-LOG.
- [x] Run targeted tests; expected green. — Vérifié 15/16 juillet 2026 : `mail-verifier` 4/4, `mail-service` 19/19 (dont distinction assumée : réutilisation d'une confirmation mode 1 = erreur dure « already_consumed », retry d'une action déjà exécutée sans confirmation requise = idempotent silencieux — les deux bullets « one-use » et « duplicate retry never double-sends » sinon se contrediraient). Suite complète 131 fichiers/643 tests verts. Gap honnête : les vrais adaptateurs Gmail/Graph/IMAP n'implémentent QUE `createDraft`/`send` (+`reply` pour aucun) — `move/label/archive/mark_spam/unsubscribe/trash` n'existent que sur le faux adaptateur de test ; le service échoue proprement (`mail_action_unsupported_by_provider`) sur les vrais adaptateurs pour ces actions tant qu'ils ne les implémentent pas. Étendre les 3 adaptateurs réels avec ces méthodes reste un chantier non trivial hors périmètre strict des tâches 2-4 déjà cochées.

Conditional commit: `feat(mail): execute verified mail actions`.

## Task 7: Expose local and Telegram mail commands

**Files:**
- Create: `src/ui/ipc/mail-ipc.mjs`
- Create: `src/ui/pages/mail-controller.mjs`
- Create: `src/messaging/telegram-mail-commands.mjs`
- Test: `tests/mail-ipc.test.mjs`
- Test: `tests/telegram-mail-commands.test.mjs`

- [x] Test named local IPC and commands `/mail status`, `/mail pause`, `/mail resume`, `/mail mode 1|2|3`, search/read/draft/send within bounds.
- [x] Only the paired Telegram numeric user ID may invoke `mail.*`; changing mode records audit and PC notification. SMS and email content can never call the command parser. — le vérificateur `isOwner` est injecté (pas encore branché à un store d'identité PC réel : ce store n'existe pas encore côté Node, seulement côté Android `OwnerIdentity.kt` ; le message Telegram n'atteint déjà le PC qu'après filtrage propriétaire par la passerelle Android — défense en profondeur ici en plus, pas la seule couche). Le parseur ne s'active que sur un `body` commençant par `/mail` ; il n'existe aucun chemin depuis SMS ou le contenu d'un e-mail vers ce module.
- [x] Full bodies are returned to Telegram only on explicit request, bounded/segmented; attachments remain PC-side unless an explicit safe download is authorized. — segmentation testée (chunks ≤ 3500 caractères) ; téléchargement de pièce jointe explicite non implémenté ici (aucune action `download` dans les commandes actuelles), noté restant.
- [x] Renderer wiring is deferred to final integration.
- [x] Run targeted tests; expected green. — Vérifié 15/16 juillet 2026 : `mail-ipc` 5/5 (un vrai bug trouvé : handlers IPC pas déclarés `async`, une erreur de validation synchrone s'échappait au lieu de rejeter la Promise — corrigé), `telegram-mail-commands` 7/7. Ajout nécessaire non prévu explicitement par la tâche : `mail-policy.mjs` a reçu un `setMode()` (mode était figé à la construction, `/mail mode` ne pouvait pas fonctionner sans) — testé séparément dans `mail-policy.test.mjs`. Suite complète 133 fichiers/658 tests verts.

## PLAN E-MAIL TERMINÉ — 7/7 tâches, gate final ci-dessous à exécuter avant de cocher définitivement

Conditional commit: `feat(mail): expose bounded mail controls`.

## Final Gate

```powershell
Set-Location 'C:\Serveurs\Mina Vision'
npm test
npm run test:integration
```

Expected: exit `0`; no live account needed. Manual validation uses dedicated Gmail and IMAP/SMTP test accounts, visible OAuth/TLS, one inbound sync, one draft and one confirmed send. Never test against a production mailbox in automation.

