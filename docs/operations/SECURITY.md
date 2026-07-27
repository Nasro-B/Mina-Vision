> 🇬🇧 **English** · [🇫🇷 Français](SECURITY.fr.md)

# Operational security — Mina Vision

## Key rotation

- **Single vault**: `src/crypto/keyring.mjs`. `ProviderSecretStore` (`src/security/provider-secret-store.mjs`) and the other facades use separate key domains within the same vault — never a second key file.
- Rotation is atomic (`src/crypto/keyring.mjs`): new key generated, existing records re-encrypted in batches, progress journal, final switch, old key deleted only after full verification. An interrupted rotation resumes at the last confirmed batch — never a silent loss.
- Provider API keys (`provider/<id>/api-key`) are rotated independently through the Settings screen (`mina:settings:set-secret` / `mina:settings:revoke-secret`) — never by editing `.env` directly for a sensitive value.

## Recovery phrase

- Generated exactly once at memory initialization (BIP-39, 12 words, official English 2048-word list, NFKD normalization).
- Displayed **exactly once** on screen (`elements.recoveryOutput`, `src/ui/renderer.js`) — structurally verified by `tests/ui-security-contract.test.mjs` (`recoveryOutput.textContent` is assigned in a single place in the file).
- Never journaled, never returned over IPC after the initial screen. Afterwards the exposed state is only `recovery configured` / `not configured`.
- If lost: no recovery is possible on Mina's side — the local memory stays locked forever for that vault. Only an earlier Firebase restore (if configured) with a **different** phrase remains possible.

## Verifiable forgetting

- `src/memory/forget-service.mjs`: any remote request (Telegram `/forget`) only ever produces a **proposal** (`proposeForget`) — never a direct deletion.
- The actual deletion requires `confirmForget({ proposalId, confirmedLocally: true })` — the `confirmedLocally` flag must be explicitly `true`, set only from the local screen.
- An encrypted tombstone is created for every forgotten event; a later restore from an older backup honors the tombstone and never resurrects the item (`src/backup/restore-service.mjs`, proven by `tests/integration/memory-backup-restore.test.mjs`).

## Diagnostic export

- `src/audit/export.mjs`: only on explicit request (never automatic), a size-bounded zip archive (`audit_export_too_large` beyond the limit), whose content is strictly the redacted report from `src/audit/diagnostics.mjs` (event types, counters, timestamps) — never event contents (`payload`), never memory nor secrets.
- The audit journal itself (`src/audit/audit-log.mjs`) is encrypted, hash-chained (sequence + previous entry hash) and append-only. `verifyChain()` detects a missing entry, a tampered entry or a chain break. Known and accepted limit: the hash chain alone cannot prove the absence of truncation at the very end of the journal without an external anchor — not implemented in this plan.

## Lost phone

1. From the local Mina Vision screen (never from the lost phone), revoke the associated Telegram token via BotFather (`/revoke` or token regeneration), then set the new token into the replacement phone's Android Keystore.
2. `src/devices/physical-device-registry.mjs`: the lost phone stays in the registry until an explicit `markUnhealthy` or a new pairing — physical possession of the phone grants no PC/smart-home capability by itself (the Telegram/SMS identity never grants a PC capability directly).
3. Secrets stored in the lost phone's Android Keystore (Telegram token, pairing credentials) are never synced in the clear to Firebase or the PC — their exposure stays limited to the physical phone itself.

## Compromised token (Telegram, provider)

1. Revoke immediately at the source (BotFather for Telegram, the provider dashboard for an API key).
2. Set the new value through the Settings screen (never paste into `.env`, never commit).
3. Check the audit (`src/audit/diagnostics.mjs`) for any suspicious `send_accepted`/`capability_deny` event within the presumed compromise window.
4. A leak of the keyring key itself (worst case) voids the audit journal's integrity guarantee (the attacker could re-seal entries) — `verifyChain()` would still detect a sequence or hash break except under a total, consistent forgery of the chain, which is beyond what a purely local audit system can protect against.

## Firebase outage

- Firebase is an **encrypted fallback transport only** (`src/devices/firebase-transport.mjs`) — never a mandatory path. `directAvailable()` must return `false` before any `enqueue()`: if USB or LAN works, Firebase is refused (`firebase_direct_transport_available`), never used as a shortcut.
- No capability is ever granted via Firebase — it stores encrypted envelopes, never directly usable content (`FORBIDDEN_KIND` explicitly rejects `camera.*`, `face.*`, `email.body`, `secret.*`).
- Total Firebase outage (unavailable, quota exceeded, project deleted): USB and LAN keep working normally, no degradation of the main function. Only the fallback for a simultaneous USB+LAN loss becomes unavailable.

## Restore

- `src/backup/restore-service.mjs`: atomic restore into a temporary target, never directly into the active database. An invalid manifest signature (wrong recovery phrase) leaves the target completely untouched.
- Tombstones newer than the restored backup are applied **before** the effective restore — an item forgotten after the backup date never reappears.
