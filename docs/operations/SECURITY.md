# Sécurité opérationnelle — Mina Vision

## Rotation des clés

- **Coffre unique** : `src/crypto/keyring.mjs`. `ProviderSecretStore` (`src/security/provider-secret-store.mjs`) et les autres façades utilisent des domaines de clés séparés dans le même coffre — jamais un second fichier de clés.
- La rotation est atomique (`src/crypto/keyring.mjs`) : nouvelle clé générée, re-chiffrement par lots des enregistrements existants, journal de progression, bascule finale, ancienne clé supprimée seulement après vérification complète. Une interruption en cours de rotation reprend au dernier lot confirmé — jamais de perte silencieuse.
- Les clés API fournisseurs (`provider/<id>/api-key`) sont tournées indépendamment via l'écran Paramètres (`mina:settings:set-secret` / `mina:settings:revoke-secret`) — jamais en modifiant `.env` directement pour une valeur sensible.

## Phrase de récupération

- Générée une seule fois à l'initialisation de la mémoire (BIP-39, 12 mots, liste anglaise officielle 2048 mots, normalisation NFKD).
- Affichée **une seule fois** à l'écran (`elements.recoveryOutput`, `src/ui/renderer.js`) — vérifié structurellement par `tests/ui-security-contract.test.mjs` (`recoveryOutput.textContent` n'est assigné qu'à un seul endroit dans le fichier).
- Jamais journalisée, jamais renvoyée par IPC après l'écran initial. Après cet écran, l'état exposé est seulement `recovery configured` / `not configured`.
- Si perdue : aucune récupération possible côté Mina — la mémoire locale reste verrouillée définitivement pour ce coffre. Seule une restauration Firebase antérieure (si configurée) avec une **autre** phrase reste possible.

## Oubli vérifiable

- `src/memory/forget-service.mjs` : toute demande distante (Telegram `/forget`) ne produit qu'une **proposition** (`proposeForget`) — jamais une suppression directe.
- La suppression réelle exige `confirmForget({ proposalId, confirmedLocally: true })` — le flag `confirmedLocally` doit être explicitement `true`, posé uniquement depuis l'écran local.
- Un tombstone chiffré est créé pour chaque événement oublié ; une restauration ultérieure depuis une sauvegarde plus ancienne respecte le tombstone et ne fait jamais réapparaître l'élément (`src/backup/restore-service.mjs`, prouvé par `tests/integration/memory-backup-restore.test.mjs`).

## Export diagnostic

- `src/audit/export.mjs` : uniquement sur demande explicite (jamais automatique), archive zip bornée en taille (`audit_export_too_large` si dépassement), contenu strictement le rapport redacté de `src/audit/diagnostics.mjs` (types d'événements, compteurs, horodatages) — jamais le contenu (`payload`) des événements, jamais de mémoire ni de secret.
- Le journal d'audit lui-même (`src/audit/audit-log.mjs`) est chiffré, chaîné par hash (séquence + hash de l'entrée précédente) et append-only. `verifyChain()` détecte une entrée manquante, une entrée altérée ou une rupture de chaîne. Limite connue et assumée : la seule chaîne de hash ne peut pas prouver l'absence de troncature en toute fin de journal sans un point d'ancrage externe — non implémenté dans ce plan.

## Perte du téléphone

1. Depuis l'écran local Mina Vision (jamais depuis le téléphone perdu), révoquer le token Telegram associé via BotFather (`/revoke` ou régénération du token) puis reposer le nouveau token dans Android Keystore du téléphone de remplacement.
2. `src/devices/physical-device-registry.mjs` : le téléphone perdu reste dans le registre jusqu'à `markUnhealthy` explicite ou nouvel appairage — aucune capacité PC/domotique n'est accordée par la seule possession physique du téléphone (l'identité Telegram/SMS n'accorde jamais directement de capacité PC).
3. Les secrets stockés dans Android Keystore du téléphone perdu (token Telegram, identifiants d'appairage) ne sont jamais synchronisés en clair vers Firebase ou le PC — leur exposition reste limitée au téléphone physique lui-même.

## Compromission d'un token (Telegram, provider)

1. Révoquer immédiatement côté source (BotFather pour Telegram, dashboard du fournisseur pour une clé API).
2. Reposer la nouvelle valeur via l'écran Paramètres (jamais copier-coller dans `.env`, jamais commit).
3. Vérifier l'audit (`src/audit/diagnostics.mjs`) pour tout événement `send_accepted`/`capability_deny` suspect dans la fenêtre de compromission présumée.
4. Une fuite de clé keyring elle-même (scénario le pire) invalide la garantie d'intégrité du journal d'audit (l'attaquant pourrait re-sceller des entrées) — `verifyChain()` détecterait toujours une rupture de séquence ou de hash sauf falsification totale et cohérente de la chaîne, hors périmètre de protection d'un système d'audit local seul.

## Panne Firebase

- Firebase est un **transport de secours chiffré uniquement** (`src/devices/firebase-transport.mjs`) — jamais un chemin obligatoire. `directAvailable()` doit retourner `false` avant tout `enqueue()` : si USB ou LAN fonctionne, Firebase est refusé (`firebase_direct_transport_available`), jamais utilisé comme raccourci.
- Aucune capacité n'est accordée via Firebase — il stocke des enveloppes chiffrées, jamais de contenu utilisable directement (`FORBIDDEN_KIND` rejette explicitement `camera.*`, `face.*`, `email.body`, `secret.*`).
- Panne totale de Firebase (indisponible, quota dépassé, projet supprimé) : USB et LAN continuent de fonctionner normalement, aucune dégradation de la fonction principale. Seul le mode de secours en cas de coupure simultanée USB+LAN devient indisponible.

## Restauration

- `src/backup/restore-service.mjs` : restauration atomique dans une cible temporaire, jamais directement dans la base active. Une signature de manifeste invalide (mauvaise phrase de récupération) laisse la cible totalement inchangée.
- Les tombstones plus récents que la sauvegarde restaurée sont appliqués **avant** la restauration effective — un élément oublié après la date de la sauvegarde ne réapparaît jamais.
