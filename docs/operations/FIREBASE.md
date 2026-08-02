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
- `firebase.json` and `.firebaserc` explicitly target the `mina-vision` project and the versioned `firebase/firestore.rules` / `firebase.storage.rules` rules.
- Backup requires `google-services.json` from the same project and either `MINA_FIREBASE_SERVICE_ACCOUNT` (an ignored file whose `project_id` strictly equals `FIREBASE_PROJECT_ID`) or `MINA_BACKUP_TOKEN_ENDPOINT`. An account from another project is rejected before any signing attempt (`firebase_service_account_project_mismatch`).
- A coherent local configuration remains `firebase_cloud_unverified`: it does not prove authentication or a remote write.
- For a local recipe that does not write to the cloud: `npm run test:firebase:emulator`. It starts Auth, Firestore and Storage on loopback, verifies denied Firestore/Storage rules, then destroys its ephemeral data. Firebase CLI 15 requires JDK 21 or newer for the Firestore emulator.
- Rules deployment is a separate remote action: `firebase deploy --only firestore:rules,storage`. It must only run after explicit validation of the project configuration and rules to publish.
- No test in this repository makes a real Firebase call. All tests (unit and integration) use an injected fake backend.
- Firebase remains **entirely optional**: `npm run rebuild:native`, the Android build (`assembleDebug`) and the unit tests all work without `google-services.json`.
- No live test runs until the owner has explicitly created the Firebase project and provided its configuration.

## Outage or unavailability

See `docs/operations/SECURITY.md` § Firebase outage — in short: no degradation of the main function (USB/LAN keep working); only the fallback for a simultaneous loss of both becomes unavailable.
