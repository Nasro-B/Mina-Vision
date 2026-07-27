> [🇬🇧 English](SECURITY-AUDIT.md) · 🇫🇷 **Français**

# Rapport d'audit de sécurité — Mina Vision

- **Origine** : audit initial par Antigravity / Gemini (mode Mythos).
- **Vérification** : chaque affirmation vérifiable a été **rejouée contre le code source** par Claude (Opus) le 2026-07-25 — références `fichier:ligne` ci-dessous. Deux imprécisions du rapport d'origine ont été corrigées (voir « Corrections »).
- **Statut** : structure de sécurité solide, vérifiée. Aucun secret réel dans le code (audit pré-publication + purge historique du faux fixture DeepSeek).

> Ce document est un **instantané daté**. Les décomptes de vulnérabilités et l'état de distribution évoluent — la source de vérité runtime reste `LICENCES.md §3` (dépendances) et **Config → Capacités** (état des domaines).

## Corrections apportées au rapport d'origine

1. **Nombre de vulnérabilités npm : 13, pas 12.** Le « 12 » était le décompte du 2026-07-22 ; après le retour de `ws` en dépendance directe (canal `mina_app`), le ré-audit du 2026-07-24 donne **13 avis** (7 moderate, 6 high, 0 critical). Source : `LICENCES.md §3`.
2. **La mention « strictement local et mono-utilisateur » est caduque.** Depuis le 2026-07-24, le dépôt est **public** (GitHub), l'**APK compagnon est publié** (release v0.1.0), et l'application est **multi-utilisateurs** (fenêtre de bienvenue + profils). Le modèle de sécurité reste correct (Nasro = unique propriétaire/autorité), mais « mono-utilisateur / non distribué » est faux — voir « Contexte de distribution ».

---

## 1. Modèle de menace & invariants système

Mina Vision s'exécute en local avec les privilèges de l'utilisateur Windows. La défense repose sur le moindre privilège appliqué à l'exécution de code tiers, au confinement de l'environnement et à l'isolation réseau. **Toute règle la plus restrictive gagne** ; une confirmation ne vaut que pour une action, un digest et une durée déterminés (`MINA.md`).

Les invariants sont **exécutables** : `tests/security-invariants.test.mjs` verrouille **10 règles** (vérifié : 10 cas de test). Débrancher une défense fait échouer la suite. Les plus critiques :

1. **Anti-SSRF** (`src/research/url-policy.mjs`) — loopback, `.local`, credentials d'URL, toutes classes d'IP privées IPv4/IPv6, résolution DNS vérifiée et redirection finale revérifiée.
2. **Protection des fichiers sensibles** (`src/system/storage-roots.mjs` + ACL credentials) — accès refusé par chemin ET par contenu aux documents credentials (clients OAuth, comptes de service, clés privées, bases navigateur), même renommés ; racines de lecture bornées au projet + `Documents\Mina Vision`.
3. **Capability Broker** (autorité des actions Computer Use) — sans grant de session borné (mission + durée), aucune action n'atteint l'exécuteur ; toute action sensible exige une confirmation locale liée cryptographiquement au digest exact de l'action, consommée une seule fois.

## 2. Audit des dépendances (npm audit)

**13 avis** (7 moderate, 6 high, 0 critical) au ré-audit du 2026-07-24. La majorité est **transitive ou sans correctif publié** ; décision par chemin d'atteignabilité réel (détail complet : `LICENCES.md §3`).

| Paquet | Sévérité | Vulnérabilité | Chemin d'impact | Statut |
| :--- | :--- | :--- | :--- | :--- |
| `sharp` (libvips) | Élevée | Exécution de code / DoS | Encode **uniquement** les captures d'écran locales du worker desktop | Contrôlé (`sharp` 0.35.3 direct) ; surveillé, monté dès correctif |
| `onnxruntime` / `@huggingface/transformers` / `kokoro-js` | Élevée | via adm-zip embarqué / modèles | Décompression de **modèles locaux** installés par Nasro — aucune entrée non fiable | Accepté, surveillé |
| `file-type` (chaîne `nut-js` → `jimp`) | Modérée | Boucle infinie (DoS) format ASF | Vision locale — pas d'ingestion de fichier web non fiable | Négligeable |
| `ws` (8.0.0–8.20.1) | Élevée | Fuite mémoire / DoS fragments | `chat-server.mjs` — frames d'un téléphone appairé (LAN/USB, jamais Internet ouvert) | **Mitigé** : `ws` 8.21.1 (hors plage), tests verts |

## 3. Coffre & cryptographie

Coffre unique `src/crypto/keyring.mjs` :

- **Double couche d'enveloppe** : clé maîtresse enveloppée en local sous la protection Windows **DPAPI** (`safeStorage`).
- **Dérivation Argon2id** (vérifié `keyring.mjs:8-10`) : `type: argon2id`, `memoryCost: 65 536` (**64 Mo**), `timeCost: 3`, `parallelism: 1`. Si DPAPI est perdu (réinstallation, rotation du profil Windows), réinitialisation par phrase **BIP39** 12 mots (liste anglaise 2048 mots, normalisation NFKD).
- **Rotation atomique** (`keyring.mjs`, cf. `SECURITY.md`) : nouvelle clé générée, re-chiffrement par lots, journal de progression, bascule finale, ancienne clé supprimée **après** vérification complète. Une interruption reprend au dernier lot confirmé — jamais de perte silencieuse ni de secret « brické ».
- **Phrase de récupération** : affichée **une seule fois**, jamais journalisée, jamais renvoyée par IPC après l'écran initial.

## 4. Confinement & virtualisation (Windows Sandbox)

Exécution de code tiers dans des machines jetables Windows Sandbox (WSB) :

- **Robustesse PowerShell** : la détection système valide la lettre de lecteur par un motif regex strict `^[A-Za-z]:$` (vérifié `src/sandbox/windows-sandbox.mjs:30`) — pas d'injection d'argument ni de contournement de restriction.
- **Validation de traversée** : import/export via `within()` (vérifié `src/sandbox/guest-runner.mjs` + `src/sandbox/job-workspace.mjs`) — toute tentative d'écriture hors du répertoire temporaire de la sandbox échoue (`sandbox_source_escape`, `sandbox_runtime_escape`, `sandbox_entrypoint_escape`, `sandbox_artifact_escape`, `sandbox_workspace_escape`).
- **Isolation invité** : réseau, presse-papiers, imprimante, caméra, micro, vGPU, profil utilisateur et projet inaccessibles dans l'invité (`MINA.md`).

## 5. Base de données locale

Toutes les requêtes SQLite locales utilisent des **requêtes préparées à valeurs liées** (vérifié `src/usage/analytics-query.mjs:68` — `db.prepare(...).all(parameters)`) : le risque d'injection SQL sur les valeurs est éliminé. Les fragments de clause `WHERE` sont construits à partir d'un ensemble de colonnes fixe côté code, jamais depuis une entrée utilisateur brute.

## 6. Contexte de distribution *(remplace la mention « R15 mono-utilisateur » du rapport d'origine)*

- **Distribution** : le code source est **public** (dépôt GitHub) et l'**APK compagnon est publié** (release v0.1.0, sideload). Ce ne sont pas des artefacts « mono-poste » — voir la note GPL/espeak-ng (`LICENCES.md §1`) sur les conditions d'un futur installeur packagé.
- **Multi-utilisateurs** : l'application supporte **plusieurs profils** (nom, pronoms, langue, ton, thème) via la fenêtre de bienvenue. Ces profils sont de la **personnalisation** — ils n'accordent **aucun privilège** et ne modifient jamais `MINA.md`.
- **Propriétaire / autorité = Nasro** (`MINA.md`) : seul le propriétaire, par **confirmation locale sur le PC**, autorise une action sensible. Une identité distante (téléphone, Telegram) doit être **liée et vérifiée** avant tout accès, et ne peut jamais autoriser une action `local_only` à distance. Un profil actif ≠ un propriétaire.
- **Multi-tenant SaaS (SATIM, Vike SSR, isolation de tenants)** : **N/A** — Mina Vision n'est pas un service SaaS ; ces préoccupations concernent d'autres projets et sont hors périmètre de ce dépôt.

---

*Voir aussi : [`SECURITY.md`](SECURITY.md) (runbook opérationnel), [`LICENCES.md`](../../LICENCES.md) (dépendances + §3 vulnérabilités), [`AUDIT-PRE-PUBLICATION.md`](AUDIT-PRE-PUBLICATION.md) (confidentialité du dépôt).*
