# Firebase — Mina Vision

Firebase remplit deux rôles strictement séparés dans Mina Vision : **transport de secours** (messages, ≤ 24 h) et **sauvegarde durable chiffrée** (mémoire, ≥ 24 h, sans limite de durée fixe). Aucun des deux ne reçoit jamais de contenu en clair.

## Transport de secours (≤ 24 h)

- `src/devices/firebase-transport.mjs`. Utilisé uniquement quand USB **et** LAN sont indisponibles (`directAvailable()` doit retourner `false` — sinon `firebase_direct_transport_available`, jamais un raccourci).
- TTL maximum 24 heures (`MAX_TTL_MS`) — dépassé, l'enveloppe expire et est refusée à la réception (`firebase_envelope_expired`), supprimée du backend.
- Champs interdits explicitement : `camera.*`, `face.*`, `email.body`, `secret.*` (`FORBIDDEN_KIND`) — un envoi de ce type est rejeté avant toute écriture (`firebase_payload_forbidden`).
- Aucune clé en clair n'est acceptée : `plaintext`, `body`, `text`, `content`, `audio`, `frame`, `embedding`, `token`, `secret` sont détectés et rejetés (`firebase_plaintext_forbidden`) même si l'enveloppe est par ailleurs correctement formée.
- Réception idempotente : un `envelopeId` déjà consommé retourne `{ duplicate: true }` plutôt que de re-livrer.

## Sauvegarde durable chiffrée

- `src/backup/backup-service.mjs` / `src/backup/restore-service.mjs`. Seul le ciphertext quitte le PC — jamais un contenu lisible, jamais un token lexical ou un embedding en clair.
- Chaque objet est déduplicé par snapshot ; un même snapshot rejoué n'uploade rien de plus.
- Le manifeste de sauvegarde est signé ; une clé de récupération incorrecte fait échouer la restauration (`backup_manifest_signature_invalid`) sans jamais modifier la cible.
- Les tombstones (éléments oubliés) sont publiés séparément et appliqués **avant** toute restauration, y compris depuis un snapshot antérieur à l'oubli — voir `docs/operations/RECOVERY.md`.

## Configuration

- `.env.example` ne documente que des identifiants publics Firebase vides — jamais de clé de service.
- Aucun test de ce dépôt n'effectue d'appel Firebase réel. Tous les tests (unitaires et d'intégration) utilisent un backend factice injecté.
- Firebase reste **entièrement optionnel** : `npm run rebuild:native`, l'assemblage Android (`assembleDebug`) et les tests unitaires fonctionnent sans `google-services.json`.
- Aucun test live n'est exécuté avant que Nasro ait créé explicitement le projet Firebase et fourni sa configuration.

## Panne ou indisponibilité

Voir `docs/operations/SECURITY.md` § Panne Firebase — en résumé : aucune dégradation de la fonction principale (USB/LAN continuent), seul le secours en cas de coupure simultanée des deux devient indisponible.
