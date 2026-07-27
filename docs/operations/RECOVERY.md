> 🇬🇧 **English** · [🇫🇷 Français](RECOVERY.fr.md)

# Recovery — Mina Vision

Step-by-step procedures for loss/failure scenarios. For the security reasoning behind each guarantee, see `docs/operations/SECURITY.md`.

## Local memory locked / recovery phrase lost

1. Without the recovery phrase, the local vault (`src/crypto/keyring.mjs`) cannot be reopened — there is no backdoor.
2. If a Firebase backup exists with a **different phrase** (or the same one, if it was written down elsewhere): use `src/backup/restore-service.mjs` to restore into a new local vault. The signed manifest guarantees that a wrong key fails cleanly without touching the target.
3. Without a recovery phrase or a usable backup: the local memory is permanently lost. Mina restarts with an empty memory and a new phrase generated at the next initialization.

## Restoring a backup while honoring a confirmed forget

1. Identify the `snapshotId` to restore and the target (new database or existing one).
2. Make sure all tombstones later than that snapshot have been published (`backup.publishTombstone`) — otherwise an item forgotten after the snapshot date **would reappear**. In normal use, publication follows every local forget confirmation automatically; check the audit (`src/audit/diagnostics.mjs`) if in doubt.
3. Run `restore.restore({ snapshotId, target })`. The restore is atomic: either the whole tombstone-filtered snapshot applies, or nothing does.
4. After restoring, verify that a previously forgotten item does not reappear (`memoryService.recall(...)` on the relevant identity must stay empty).

Automated proof of this guarantee: `tests/integration/memory-backup-restore.test.mjs`.

## Diagnostic export (for support/debugging)

1. From the local screen, explicitly request a diagnostic export — never automatic.
2. `src/audit/export.mjs` produces a size-bounded zip containing only the redacted report (`src/audit/diagnostics.mjs`): counters per event type, timestamps, audit chain validity — never event contents.
3. The archive's SHA-256 digest is returned with the path — keep it to verify the integrity of the transmitted file.

## Lost or stolen phone

See `docs/operations/SECURITY.md` § Lost phone for the full procedure (Telegram revocation, `markUnhealthy`, no secret persistence to PC/Firebase).

## Firebase outage during a restore

A Firebase outage during `restore.restore(...)` fails cleanly (network error propagated, target never partially written thanks to restore atomicity). Rerun `restore.restore(...)` once Firebase is available again — the operation is read-idempotent (no destructive write until the target transaction commits).

## Full reinstall

1. Follow `docs/operations/INSTALLATION.md` for a clean install.
2. If a Firebase backup exists: restore immediately after the first memory initialization (before any new activity), with the original recovery phrase.
3. Re-pair the phone — the physical identity is never restored automatically from a memory backup; it requires a fresh local validation.
4. Re-provision the Telegram token (`docs/operations/TELEGRAM.md`) — tokens are never included in an encrypted memory backup (distinct key domain, never mixed).
