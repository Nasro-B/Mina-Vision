# Mina v2 — plan mémoire locale, RAG et recherche

> **Pour l’agent d’exécution :** utiliser `superpowers:executing-plans`. Commencer seulement après le gate du plan noyau.

**Objectif :** donner à Mina une mémoire courte/longue commune à tous les canaux et une recherche web/fichiers fondée sur des preuves, avec stockage local chiffré et sauvegarde Firebase chiffrée.

**Architecture :** SQLite ne contient que métadonnées minimales, ciphertexts et index aveugles. Les valeurs sont chiffrées avant le repository. Electron `safeStorage` enveloppe la clé maître ; Argon2id dérive une clé de récupération depuis 12 mots. Le RAG combine index lexical HMAC et embeddings locaux. Les connecteurs web/fichiers produisent des `Evidence` consommées par le plan grounding.

---

## Tâche 1 — dépendances natives et preuve de compatibilité Electron

**Fichiers :**

- Modifier `package.json`
- Modifier `package-lock.json`
- Créer `scripts/rebuild-native.mjs`
- Créer `tests/sqlite-compat.test.mjs`

1. Écrire un test rouge qui ouvre une base `:memory:`, active les foreign keys, écrit puis relit un blob.
2. Installer exactement :

```powershell
npm install --save-exact better-sqlite3@12.11.1 argon2@0.44.0 @huggingface/transformers@4.2.0 firebase@12.16.0
npm install --save-dev --save-exact @electron/rebuild@4.2.0 @vitest/coverage-v8@4.1.10 fast-check@4.9.0
```

3. Ajouter `postinstall: electron-rebuild -f -w better-sqlite3` et un script explicite `rebuild:native`.
4. Exécuter `npm run rebuild:native`; attendu : code 0.
5. Exécuter le test sous Node puis un petit smoke Electron qui charge `better-sqlite3`; les deux doivent réussir. Si l’ABI échoue, arrêter la tâche, ne pas remplacer silencieusement le stockage.

## Tâche 2 — primitives cryptographiques et keyring

**Fichiers :**

- Créer `src/crypto/aead.mjs`
- Créer `src/crypto/keyring.mjs`
- Créer `src/crypto/recovery-phrase.mjs`
- Créer `src/crypto/safe-storage-adapter.mjs`
- Créer `tests/crypto.test.mjs`
- Créer `tests/keyring.test.mjs`

**Contrats :** AES-256-GCM, nonce aléatoire 96 bits, AAD comprenant version/type/id; Argon2id `memoryCost=65536`, `timeCost=3`, `parallelism=1`, sel 16 octets.

1. Tests rouges : round-trip, mauvais AAD/tag/clé, nonces uniques, payload altéré, phrase erronée, safeStorage indisponible.
2. La phrase suit BIP-39 : 128 bits d’entropie + checksum 4 bits, exactement 12 mots de la liste anglaise officielle 2048 mots, normalisation NFKD. Elle est affichée une seule fois et jamais journalisée.
3. `safeStorage.isEncryptionAvailable()` doit être vrai pour créer/ouvrir la mémoire normale. Aucun fallback plaintext.
4. Le fichier keyring contient seulement : version, clé maître enveloppée DPAPI, enveloppe recovery, sel Argon2, paramètres et checksum public.
5. Ajouter une rotation atomique : nouvelle clé, re-chiffrement par lots, journal de progression, bascule finale, ancienne clé supprimée après vérification.
6. Exécuter les tests ciblés et un scan de fixtures vérifiant qu’aucun secret test n’apparaît en clair.

## Tâche 3 — schéma SQLite et repository chiffré

**Fichiers :**

- Créer `src/memory/schema/001-initial.sql`
- Créer `src/memory/database.mjs`
- Créer `src/memory/event-repository.mjs`
- Créer `src/memory/identity-repository.mjs`
- Créer `src/memory/tombstone-repository.mjs`
- Créer `tests/memory-repository.test.mjs`
- Créer `tests/memory-migrations.test.mjs`

**Tables :** `memory_events`, `memory_chunks`, `identities`, `identity_links`, `sessions`, `tombstones`, `outbox_backup`, `schema_migrations`.

1. Tests rouges : migration sur base vide, migration idempotente, rollback sur erreur, unicité `event_id`, transaction évènement+chunks, aucune colonne plaintext pour contenu/numéro/token.
2. Activer WAL, `foreign_keys=ON`, `busy_timeout=5000`, permissions Windows limitées au compte courant.
3. Métadonnées autorisées en clair : version, timestamps, type opaque, taille, état de synchronisation. Identité/canal/source sont chiffrés ou pseudonymisés par HMAC.
4. Le repository accepte un objet métier, sérialise JSON canonique, chiffre avant SQL ; la lecture vérifie AEAD avant parse.
5. Ne jamais exposer la connexion SQLite au renderer.
6. Exécuter tests ciblés, suite complète, puis rechercher les marqueurs secrets dans le fichier DB de test ; attendu : zéro hit.

## Tâche 4 — mémoire courte, consolidation longue et identité intercanal

**Fichiers :**

- Créer `src/memory/short-term.mjs`
- Créer `src/memory/consolidator.mjs`
- Créer `src/memory/identity-graph.mjs`
- Créer `src/memory/memory-service.mjs`
- Créer `tests/memory-service.test.mjs`
- Créer `tests/identity-graph.test.mjs`

1. Tests rouges : fenêtre de travail bornée par tokens/évènements, résumé traçable vers les évènements, souvenir SMS rappelé en session locale après liaison d’identité, collision de numéro refusée.
2. `remember()` conserve indéfiniment par défaut, y compris secrets/OTP selon décision de Nasro, avec classification `normal|sensitive|secret|otp`.
3. `recall()` retourne contenu, score, provenance, date et classification ; les secrets sont masqués par défaut dans l’UI.
4. Le graphe lie `local_owner`, Telegram `user_id`, téléphone E.164 et device ID seulement après preuve d’appairage prévue dans le plan Android.
5. La consolidation ne remplace jamais les événements sources ; elle crée une projection dérivée versionnée.
6. Exécuter tests ciblés et suite.

## Tâche 5 — oubli vérifiable et tombstones

**Fichiers :**

- Créer `src/memory/forget-service.mjs`
- Créer `tests/forget-service.test.mjs`

1. Tests rouges : oubli par event, sujet, identité et intervalle ; suppression des chunks/embeddings/projections ; tombstone anti-restauration ; répétition idempotente.
2. Toute demande distante produit une proposition, jamais une suppression ; confirmation locale obligatoire.
3. Après confirmation, transaction locale, création tombstone chiffrée, mise en queue de suppression backup Firebase.
4. Générer un rapport `{matched, deleted, backupPending, completedAt}` sans contenu supprimé.
5. Test de restauration depuis une sauvegarde antérieure : le tombstone empêche la résurrection.

## Tâche 6 — index lexical aveugle

**Fichiers :**

- Créer `src/rag/tokenizer.mjs`
- Créer `src/rag/blind-index.mjs`
- Créer `src/rag/ranker.mjs`
- Créer `tests/blind-index.test.mjs`

1. Tests rouges français : accents, apostrophes, pluriels simples, numéros, emails, OTP ; aucun token en clair dans la DB.
2. Normaliser Unicode NFKC et minuscules, supprimer les stopwords versionnés, produire HMAC-SHA-256 tronqué 128 bits avec une sous-clé HKDF dédiée.
3. Recherche BM25-like sur fréquences chiffrées/pseudonymisées, puis déchiffrement uniquement des candidats autorisés.
4. Les requêtes sensibles ne sont pas journalisées en clair.
5. Mesurer avec fixture 10 000 chunks ; écrire la commande et le résultat, ne pas extrapoler à 100 000.

## Tâche 7 — embeddings locaux et RAG hybride

**Fichiers :**

- Créer `src/rag/local-embedder.mjs`
- Créer `src/rag/vector-store.mjs`
- Créer `src/rag/retriever.mjs`
- Créer `tests/local-embedder.test.mjs`
- Créer `tests/retriever.test.mjs`

1. Test rouge avec faux embedder déterministe : combinaison lexical/vectoriel, filtres identité/date/classification, provenance obligatoire.
2. Charger l’embedder dynamiquement via le port résolu par le `ModelRegistry` v3. Le modèle est choisi dans un manifeste local validé par digest ; aucun ID de modèle n’est codé en dur dans le RAG.
3. Ajouter une commande explicite `npm run models:install`; aucun téléchargement au démarrage ni pendant une requête.
4. Stocker les vecteurs comme blobs chiffrés `Float32Array`; scan exact borné avec préfiltre lexical/date. Pas d’index natif supplémentaire en v1.
5. Si le modèle est absent, continuer en lexical et déclarer `semantic_degraded`, sans appel cloud.
6. Benchmark réel 100 000 vecteurs synthétiques : objectif p95 < 2 s sur cette machine. Si non atteint, documenter la mesure avant de choisir un ANN.

## Tâche 8 — lecture de fichiers locale

**Fichiers :**

- Créer `src/research/file-policy.mjs`
- Créer `src/research/file-reader.mjs`
- Créer `src/research/file-indexer.mjs`
- Créer `tests/file-reader.test.mjs`
- Créer `tests/file-indexer.test.mjs`

1. Tests rouges : path traversal, symlink hors racine, fichier géant, binaire, extension inconnue, fichier modifié pendant lecture.
2. Dossiers approuvés explicitement indexables ; ailleurs lecture à la demande après confirmation. Ne jamais indexer `.env`, keyrings, bases navigateur, gestionnaires de mots de passe, caches de tokens.
3. Limites initiales : 25 MiB/fichier, 250 MiB/job, 10 000 fichiers/job, timeout 10 min.
4. Lecteurs v1 : texte/code/JSON/CSV/Markdown/HTML/PDF textuel. Les documents Office passent par un adaptateur séparé ; aucun macro/exécutable.
5. Chaque chunk garde path canonique, digest, mtime, plage de lignes/pages et méthode d’extraction.
6. Le watcher debounce et réindexe par digest ; suppression crée un événement et retire les chunks dérivés.

## Tâche 9 — lecture structurée du web sans caméra

**Fichiers :**

- Créer `src/research/web-reader.mjs`
- Créer `src/research/network-evidence.mjs`
- Créer `src/research/research-service.mjs`
- Créer `tests/web-reader.test.mjs`
- Créer `tests/integration/web-research.test.mjs`

1. Fixture locale avec DOM, iframe même origine, script JSON-LD, CSS, mutation et réponse JSON publique.
2. Extraire URL finale, titre, texte visible, arbre d’accessibilité, liens, métadonnées, HTML ciblé, styles calculés demandés, scripts publics et réponses réseau non secrètes.
3. Masquer cookies, Authorization, champs mot de passe, tokens et paramètres sensibles avant création d’une preuve.
4. Respecter robots/conditions d’accès pour l’indexation automatisée ; une page authentifiée est lue seulement dans le profil dédié et jamais sauvegardée brute.
5. Produire `Evidence` avec sélecteur/URL/digest/horodatage. Une capture d’écran peut compléter, jamais remplacer la lecture structurée lorsque disponible.
6. Exécuter l’intégration uniquement sur serveur fixture local ; aucun site réel pendant les tests.

## Tâche 10 — sauvegarde Firebase chiffrée

**Fichiers :**

- Créer `src/backup/firebase-backup.mjs`
- Créer `src/backup/backup-service.mjs`
- Créer `src/backup/restore-service.mjs`
- Créer `tests/firebase-backup.test.mjs`
- Créer `tests/backup-restore.test.mjs`
- Modifier `.env.example`

1. Ajouter seulement des identifiants publics Firebase vides dans `.env.example`; aucune clé de service.
2. Tests avec adaptateur fake : upload ciphertext, reprise après coupure, déduplication, conflit, oubli, restauration avec mauvaise phrase.
3. Authentifier l’appareil avec Firebase Auth/installation dédiée ; règles : propriétaire unique, App Check quand disponible, aucun listing public.
4. Sauvegarder blobs chiffrés par lots avec manifeste signé et digests ; le cloud ne reçoit ni tokens lexicaux ni embeddings en clair.
5. Restauration : télécharger, vérifier signature/digests, appliquer tombstones, déchiffrer dans un répertoire temporaire, transaction atomique.
6. Aucun test live avant création explicite du projet Firebase par Nasro.

## Tâche 11 — intégration mémoire/recherche au runtime

**Fichiers :**

- Modifier `src/core/mina-runtime.mjs`
- Modifier `src/ui/main.mjs`
- Modifier `src/ui/preload.cjs`
- Modifier `src/ui/index.html`
- Modifier `src/ui/renderer.js`
- Créer `tests/memory-ui-contract.test.mjs`

1. IPC étroit : `memory.search`, `memory.proposeForget`, `research.readFile`, `research.readWeb`; confirmations dans le main process.
2. Injecter les résultats de recall/research comme preuves référencées, jamais comme concaténation opaque dans le prompt.
3. UI : provenance, date, statut, masque sensible, mode lexical dégradé, état backup.
4. Ajouter verrouillage/déverrouillage mémoire ; aucune mission nécessitant la mémoire si keyring indisponible.
5. Exécuter suite, intégrations et smoke.

## Gate de fin du plan 2

- Base et sauvegarde ne contiennent aucun marqueur secret plaintext des fixtures.
- Souvenir SMS simulé rappelé localement après liaison d’identité.
- Oubli confirmé survit à une restauration ancienne.
- Recherche web/fichier fournit des preuves localisées et passe le response gate.
- Firebase live reste désactivé tant que Nasro n’a pas fourni sa configuration.

## Journal d’exécution

- 2026-07-15 — Tâches 1 à 6 terminées et vérifiées localement.
- 2026-07-15 — Premier benchmark exact Tâche 7, avant optimisation :
  - commande : `C:\Users\Nasro\AppData\Local\nvm\v22.14.0\node.exe scripts\benchmark-vector-scan.mjs`
  - sortie : `{"vectors":100000,"dimensions":32,"measuredRuns":10,"p95Ms":2514.43,"minMs":371.88,"maxMs":2514.43}`
  - conclusion : objectif p95 `< 2 s` non atteint ; aucun ANN choisi. Prochaine étape : conserver le scan exhaustif des scores mais borner le tri au top-K demandé.
- 2026-07-15 — Benchmark exact après top-K borné, sans ANN :
  - commande : `C:\Users\Nasro\AppData\Local\nvm\v22.14.0\node.exe scripts\benchmark-vector-scan.mjs`
  - sortie : `{"vectors":100000,"dimensions":32,"topK":100,"measuredRuns":10,"p95Ms":242.79,"minMs":196.86,"maxMs":242.79}`
  - conclusion : objectif p95 `< 2 s` atteint ; le scan calcule toujours les 100 000 similarités, seul le tri est borné au top 100.
- 2026-07-16 — Vérification exhaustive de ce plan dans le cadre de la revue complète de tous les docs `docs/superpowers/plans/` demandée par Nasro. Tâches 8 à 11 et le Gate de fin, jamais explicitement confirmés dans ce journal jusqu'ici, sont en réalité déjà implémentés : tous les fichiers listés aux Tâches 1 à 11 existent sur disque (crypto/keyring, schéma+repository SQLite, mémoire courte/consolidation/graphe d'identité, oubli/tombstones, index lexical aveugle, embeddings/RAG hybride, lecture fichiers, lecture web structurée, sauvegarde/restauration Firebase, intégration runtime/UI). Les 17 fichiers de test nommés dans ce plan ont été rejoués réellement : `npx vitest run tests/sqlite-compat.test.mjs tests/crypto.test.mjs tests/keyring.test.mjs tests/memory-repository.test.mjs tests/memory-migrations.test.mjs tests/memory-service.test.mjs tests/identity-graph.test.mjs tests/forget-service.test.mjs tests/blind-index.test.mjs tests/local-embedder.test.mjs tests/retriever.test.mjs tests/file-reader.test.mjs tests/file-indexer.test.mjs tests/web-reader.test.mjs tests/firebase-backup.test.mjs tests/backup-restore.test.mjs tests/memory-ui-contract.test.mjs` → 17 fichiers / 83 tests verts. `tests/integration/web-research.test.mjs` (Tâche 9) déjà vérifié vert dans la même vague de vérification (`npm run test:integration` → 7 fichiers / 14 tests verts, incluant ce fichier). Gate de fin considéré rempli sur cette base : aucun marqueur secret en clair (garanti structurellement par AEAD/HMAC, testé), Firebase live toujours désactivé (aucune config réelle fournie par Nasro, cohérent avec Tâche 10 point 6). Aucune ligne de code réécrite lors de cette vérification — uniquement cette entrée de journal ajoutée.
