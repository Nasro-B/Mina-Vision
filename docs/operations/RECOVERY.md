# Récupération — Mina Vision

Procédures pas à pas pour les scénarios de perte/panne. Pour le raisonnement de sécurité derrière chaque garantie, voir `docs/operations/SECURITY.md`.

## Mémoire locale verrouillée / phrase de récupération perdue

1. Sans la phrase de récupération, le coffre local (`src/crypto/keyring.mjs`) ne peut pas être rouvert — il n'existe aucune porte dérobée.
2. Si une sauvegarde Firebase existe avec une **phrase différente** (ou la même, si elle a été notée ailleurs) : utiliser `src/backup/restore-service.mjs` pour restaurer dans un nouveau coffre local. Le manifeste signé garantit qu'une mauvaise clé échoue proprement sans toucher la cible.
3. Sans phrase de récupération ni sauvegarde exploitable : la mémoire locale est définitivement perdue. Mina redémarre avec une mémoire vide et une nouvelle phrase générée à la prochaine initialisation.

## Restaurer une sauvegarde tout en respectant un oubli confirmé

1. Identifier le `snapshotId` à restaurer et la cible (nouvelle base ou base existante).
2. S'assurer que tous les tombstones postérieurs à ce snapshot ont été publiés (`backup.publishTombstone`) — sinon un élément oublié après la date du snapshot **réapparaîtrait**. En usage normal, la publication suit automatiquement chaque confirmation d'oubli locale ; vérifier l'audit (`src/audit/diagnostics.mjs`) en cas de doute.
3. Lancer `restore.restore({ snapshotId, target })`. La restauration est atomique : soit tout le snapshot filtré par les tombstones est appliqué, soit rien.
4. Vérifier après restauration qu'un élément précédemment oublié ne réapparaît pas (`memoryService.recall(...)` sur l'identité concernée doit rester vide).

Preuve automatisée de cette garantie : `tests/integration/memory-backup-restore.test.mjs`.

## Export diagnostic (pour support/débogage)

1. Depuis l'écran local, demander explicitement un export diagnostic — jamais automatique.
2. `src/audit/export.mjs` produit un zip borné en taille contenant uniquement le rapport redacté (`src/audit/diagnostics.mjs`) : compteurs par type d'événement, horodatages, validité de la chaîne d'audit — jamais le contenu des événements.
3. Le digest SHA-256 de l'archive est retourné avec le chemin — à conserver pour vérifier l'intégrité du fichier transmis.

## Téléphone perdu ou volé

Voir `docs/operations/SECURITY.md` § Perte du téléphone pour la procédure complète (révocation Telegram, `markUnhealthy`, non-persistance des secrets vers le PC/Firebase).

## Panne Firebase pendant une restauration

Une panne Firebase pendant `restore.restore(...)` échoue proprement (erreur réseau propagée, cible jamais partiellement écrite grâce à l'atomicité de la restauration). Relancer `restore.restore(...)` une fois Firebase de nouveau disponible — l'opération est idempotente côté lecture (aucune écriture destructive tant que la transaction cible n'a pas committé).

## Réinstallation complète

1. Suivre `docs/operations/INSTALLATION.md` pour une installation propre.
2. Si une sauvegarde Firebase existe : restaurer immédiatement après la première initialisation de la mémoire (avant toute nouvelle activité), avec la phrase de récupération d'origine.
3. Réappairer le Huawei (`docs/runbooks/huawei-pairing.md`) — l'identité physique n'est jamais restaurée automatiquement depuis une sauvegarde mémoire ; elle nécessite une nouvelle validation locale.
4. Reprovisionner le token Telegram (`docs/operations/TELEGRAM.md`) — les tokens ne sont jamais inclus dans une sauvegarde mémoire chiffrée (domaine de clés distinct, jamais mélangé).
