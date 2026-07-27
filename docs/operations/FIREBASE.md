> 🇬🇧 **English** · [🇫🇷 Français](FIREBASE.fr.md)

# Firebase — Mina Vision

Firebase plays two strictly separated roles in Mina Vision: **fallback transport** (messages, ≤ 24 h) and **durable encrypted backup** (memory, ≥ 24 h, no fixed duration limit). Neither ever receives plaintext content.

## Fallback transport (≤ 24 h)

- `src/devices/firebase-transport.mjs`. Used only when USB **and** LAN are unavailable (`directAvailable()` must return `false` — otherwise `firebase_direct_transport_available`, never a shortcut).
- Maximum TTL 24 hours (`MAX_TTL_MS`) — past it, the envelope expires and is refused on receipt (`firebase_envelope_expired`), then deleted from the backend.
- Explicitly forbidden fields: `camera.*`, `face.*`, `email.body`, `secret.*` (`FORBIDDEN_KIND`) — such a send is rejected before any write (`firebase_payload_forbidden`).
- No plaintext key is accepted: `plaintext`, `body`, `text`, `content`, `audio`, `frame`, `embedding`, `token`, `secret` are detected and rejected (`firebase_plaintext_forbidden`) even when the envelope is otherwise well-formed.
- Idempotent receipt: an already-consumed `envelopeId` returns `{ duplicate: true }` instead of re-delivering.

## Durable encrypted backup

- `src/backup/backup-service.mjs` / `src/backup/restore-service.mjs`. Only ciphertext ever leaves the PC — never readable content, never a lexical token or a plaintext embedding.
- Every object is deduplicated per snapshot; replaying the same snapshot uploads nothing more.
- The backup manifest is signed; a wrong recovery key makes the restore fail (`backup_manifest_signature_invalid`) without ever touching the target.
- Tombstones (forgotten items) are published separately and applied **before** any restore, including from a snapshot older than the forget — see `docs/operations/RECOVERY.md`.

## Configuration

- `.env.example` documents only empty public Firebase identifiers — never a service key.
- No test in this repository makes a real Firebase call. All tests (unit and integration) use an injected fake backend.
- Firebase remains **entirely optional**: `npm run rebuild:native`, the Android build (`assembleDebug`) and the unit tests all work without `google-services.json`.
- No live test runs until the owner has explicitly created the Firebase project and provided its configuration.

## Outage or unavailability

See `docs/operations/SECURITY.md` § Firebase outage — in short: no degradation of the main function (USB/LAN keep working); only the fallback for a simultaneous loss of both becomes unavailable.
