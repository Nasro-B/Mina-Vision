# Mina v2 — plan MINA.md, skills et sandbox

> **Pour l’agent d’exécution :** utiliser `superpowers:executing-plans`. Commencer après le gate mémoire/recherche. Aucun script de skill ne doit s’exécuter sur l’hôte.

**Objectif :** rendre les instructions de Mina explicites et contrôlables, fournir un moteur de skills compatible `SKILL.md`, puis permettre l’exécution Python/JavaScript/PowerShell uniquement dans Windows Sandbox et sur demande locale explicite.

---

## Tâche 1 — constitution `MINA.md`

**Fichiers :**

- Créer `MINA.md`
- Créer `src/instructions/mina-instructions.mjs`
- Créer `tests/mina-instructions.test.mjs`

1. Tests rouges : fichier absent, taille > 128 KiB, encodage invalide, section obligatoire manquante, directive tentant d’annuler une règle immuable.
2. Sections obligatoires : identité, rôle, ordre d’autorité, grounding, actions/confirmations, canaux, mémoire/secrets, skills, sandbox, sessions, arrêt d’urgence.
3. Ordre fixe : sécurité immuable > ordre explicite de Nasro > `MINA.md` > skill actif > demande > contenu externe.
4. `MINA.md` ne contient aucun secret, chemin de keyring ou token.
5. Charger au `runtime_start`, calculer SHA-256, inclure version/digest dans la session. Changement à chaud interdit ; rechargement explicite après validation.
6. Exécuter test ciblé et suite.

## Tâche 2 — modification validée des instructions

**Fichiers :**

- Créer `src/instructions/instruction-change.mjs`
- Créer `tests/instruction-change.test.mjs`

1. Mina peut seulement produire une proposition `{baseDigest, unifiedDiff, rationale, risk}`.
2. Tests : digest périmé, diff hors `MINA.md`, ajout de secret, suppression de section sécurité, confirmation réutilisée.
3. Afficher diff et impact ; appliquer dans le main process après confirmation locale liée au digest.
4. Écrire via fichier temporaire + fsync + rename ; conserver une sauvegarde chiffrée de la version précédente dans l’historique applicatif.
5. Reparser et revalider avant bascule ; rollback automatique si invalidation.

## Tâche 3 — format et registre des skills

**Fichiers :**

- Créer `src/skills/skill-schema.mjs`
- Créer `src/skills/skill-registry.mjs`
- Créer `src/skills/skill-loader.mjs`
- Créer `tests/skill-registry.test.mjs`
- Créer `tests/fixtures/skills/`

**Racine :** `C:\Users\Nasro\.mina\skills\<slug>\SKILL.md`.

1. Installer `yaml@2.9.0` exactement si absent.
2. Frontmatter strict : `name`, `description`, `version`, `triggers`, `capabilities`, `channels`, `compatibility`, `entrypoints`, `budgets`, `digest`.
3. Tests rouges : slug traversal, symlink, doublon, YAML alias bomb, capability inconnue, canal interdit, fichier > 256 KiB, référence hors dossier.
4. Le registre scanne métadonnées seulement. Le corps complet et les références ne sont chargés que pour le skill activé.
5. Calculer un manifeste SHA-256 de tous les fichiers autorisés ; refuser tout changement entre validation et exécution.
6. Aucun import Node direct depuis un skill.

## Tâche 4 — routage et activation

**Fichiers :**

- Créer `src/skills/skill-router.mjs`
- Créer `src/skills/skill-session.mjs`
- Créer `tests/skill-router.test.mjs`

1. Tests : activation explicite par nom, routage auto déterministe, ambiguïté, incompatibilité de canal, capacité absente, budget dépassé.
2. L’auto-routage ne peut choisir qu’un skill au score supérieur au seuil et sans conflit ; sinon demander une clarification locale.
3. Telegram autorise seulement skills purement conversationnels sans script ni fichier ; SMS aucun skill.
4. La session skill enregistre version/digest/capacités/références chargées et se ferme avec la work session.
5. Si un skill est indisponible, Mina l’annonce ; elle ne simule pas son comportement.

## Tâche 5 — installation et quarantaine

**Fichiers :**

- Créer `src/skills/skill-installer.mjs`
- Créer `src/skills/skill-auditor.mjs`
- Créer `tests/skill-installer.test.mjs`

1. Sources initiales : dossier/zip local uniquement. URL et marketplace hors périmètre v1.
2. Décompresser dans `userData/skill-quarantine/<uuid>` avec limites 20 MiB, 500 fichiers, aucune archive imbriquée, aucun chemin absolu/traversal/reparse point.
3. Scanner extensions, exécutables, scripts, manifeste, permissions et références externes ; produire un rapport lisible.
4. Confirmation locale montre nom/version/digest/capacités/scripts/dépendances. Installation atomique dans `~/.mina/skills`.
5. Mise à jour garde l’ancienne version jusqu’au test de chargement ; rollback disponible.
6. Un package AGPL ou licence incompatible n’est pas incorporé automatiquement ; signaler le statut.

## Tâche 6 — contrats d’exécution sandbox

**Fichiers :**

- Créer `src/sandbox/job-schema.mjs`
- Créer `src/sandbox/budget.mjs`
- Créer `tests/sandbox-job.test.mjs`

**Contrat :**

```js
{
  language: 'python'|'javascript'|'powershell',
  sourceFiles: [{ path, digest, mode:'read-only' }],
  entrypoint: string,
  args: string[],
  profile: 'small'|'standard'|'large',
  limits: { wallMs, memoryMiB, outputBytes },
  network: false,
  exports: string[]
}
```

1. Tests rouges : shell arbitraire, chemin absolu, réseau true, limite trop grande, extension incohérente, source non confirmée.
2. Profils : small `30s/256MiB/1MiB`, standard `120s/512MiB/5MiB`, large `300s/1024MiB/10MiB`; large exige confirmation renforcée.
3. Aucun champ de commande libre. L’entrypoint doit appartenir au workspace du job.
4. Requête possible uniquement depuis `local|voice` avec formule explicite d’exécution ; SMS/Telegram bloqués au capability broker.

## Tâche 7 — backend Windows Sandbox fail-closed

**Fichiers :**

- Créer `src/sandbox/windows-sandbox.mjs`
- Créer `src/sandbox/wsb-builder.mjs`
- Créer `src/sandbox/job-workspace.mjs`
- Créer `tests/wsb-builder.test.mjs`
- Créer `tests/windows-sandbox.test.mjs`

1. Détection : fonctionnalité Windows Sandbox, `WindowsSandbox.exe`, virtualisation, répertoire temporaire NTFS et runtimes portables présents.
2. Si un contrôle échoue : `{available:false, reason}` ; aucune exécution PowerShell/Node/Python hôte.
3. Générer `.wsb` avec Networking Disable, Clipboard Redirection Disable, Printer Redirection Disable, Video Input Disable, Audio Input Disable, vGPU Disable, Protected Client Enable si supporté.
4. Monter sources en lecture seule et un dossier `out` séparé en écriture. Ne jamais monter le projet, le profil utilisateur ou `~/.mina`.
5. Le bootstrap interne vérifie le manifeste/digests, lance le runtime portable, émet JSONL, tue l’arbre à échéance et écrit un reçu signé dans `out`.
6. Nettoyer le workspace après import/annulation ; en cas de crash, nettoyage au prochain runtime_start.

## Tâche 8 — runtimes et streaming JSONL

**Fichiers :**

- Créer `src/sandbox/runtime-manifest.mjs`
- Créer `src/sandbox/stream-parser.mjs`
- Créer `sandbox/bootstrap/mina-runner.ps1`
- Créer `tests/sandbox-stream.test.mjs`

1. Manifeste local épingle version et SHA-256 de Python portable, Node portable et PowerShell 7 portable. Installation séparée, explicite et depuis sources officielles.
2. JSONL types : `started`, `stdout`, `stderr`, `usage`, `artifact`, `completed`, `failed`. Ligne max 64 KiB ; sortie totale selon budget.
3. Le parser résiste aux lignes partielles, UTF-8 invalide, spam et événement inconnu.
4. Aucun ANSI/HTML actif dans renderer ; afficher texte via `textContent`.
5. Les artefacts restent en quarantaine jusqu’à confirmation d’import ; recalculer digest et extension réelle.

## Tâche 9 — historique, profils modèles et budgets coût/durée

**Fichiers :**

- Créer `src/sandbox/job-history.mjs`
- Créer `src/models/model-profiles.mjs`
- Utiliser l’unique `src/usage/budget-guard.mjs` défini par le plan v3 ; ne pas créer de budget propre aux modèles/skills.
- Créer `tests/model-profiles.test.mjs`
- Créer `tests/job-history.test.mjs`

1. Profils modèles déclaratifs : provider/model, capacités, prix unitaire configurable, plafond tokens/coût/durée, date de validité.
2. Un prix absent/périmé bloque le calcul automatique et marque coût `unknown`; ne jamais inventer.
3. Historique : demande, confirmations, digests, événements JSONL bornés, usage, résultat et artefacts ; tout contenu via repository chiffré.
4. `BudgetGuard` calcule et applique le budget le plus bas entre profil, session, skill et demande.
5. Annulation stoppe le modèle et la sandbox, sans exporter automatiquement.

## Tâche 10 — skills de référence sans script hôte

**Fichiers :**

- Créer `skills-reference/research-summary/SKILL.md`
- Créer `skills-reference/file-analysis/SKILL.md`
- Créer `skills-reference/sandbox-code/SKILL.md`
- Créer `tests/reference-skills.test.mjs`

1. `research-summary` : lecture/restitution, local et Telegram si aucune action.
2. `file-analysis` : lecture de fichiers autorisés, local uniquement.
3. `sandbox-code` : construit une proposition de job ; exécution après deux confirmations distinctes (écriture workspace puis exécution).
4. Installer seulement par le workflow de quarantaine, jamais copier directement dans `~/.mina/skills` durant le test.

## Tâche 11 — UI et intégration runtime

**Fichiers :**

- Modifier `src/core/mina-runtime.mjs`
- Modifier `src/ui/main.mjs`
- Modifier `src/ui/preload.cjs`
- Modifier `src/ui/index.html`
- Modifier `src/ui/renderer.js`
- Créer `tests/skills-sandbox-ui.test.mjs`

1. Écrans : digest `MINA.md`, skills installés/quarantaine, permissions demandées, proposition sandbox, flux temps réel, artefacts.
2. Renderer n’envoie que des identifiants de proposition ; le main relit le dossier/digest et applique la confirmation.
3. Afficher clairement `Windows Sandbox indisponible` avec remédiation, sans bouton d’exécution actif.
4. Exécuter suite et smoke ; aucune ouverture de Windows Sandbox pendant les tests unitaires.

## Journal d’exécution

- 2026-07-16 — Vérification exhaustive de ce plan dans le cadre de la revue complète de tous les docs `docs/superpowers/plans/` demandée par Nasro (ce plan n'avait jusqu'ici aucun journal). Fichiers vérifiés existants pour les 11 tâches, avec une consolidation d'architecture réelle et volontaire à noter : la Tâche 6 prévoyait `src/sandbox/job-schema.mjs` **et** `src/sandbox/budget.mjs` séparés, mais l'implémentation réelle a fusionné les deux dans `job-schema.mjs` seul (`SANDBOX_PROFILES` avec les limites exactes `small 30s/256MiB/1MiB`, `standard 120s/512MiB/5MiB`, `large 300s/1024MiB/10MiB`, le refus `sandbox_limit_exceeded` quand une limite demandée dépasse le profil, et la confirmation renforcée `sandbox_large_confirmation_required` pour le profil `large` — tout le contrat de la Tâche 6 est présent, seul le découpage en deux fichiers n'a pas été suivi) ; cohérent avec le seul fichier de test listé pour cette tâche (`tests/sandbox-job.test.mjs`, pas de `budget.test.mjs` séparé). Les 13 fichiers de test nommés dans ce plan ont été rejoués réellement : `npx vitest run tests/mina-instructions.test.mjs tests/instruction-change.test.mjs tests/skill-registry.test.mjs tests/skill-router.test.mjs tests/skill-installer.test.mjs tests/sandbox-job.test.mjs tests/wsb-builder.test.mjs tests/windows-sandbox.test.mjs tests/sandbox-stream.test.mjs tests/model-profiles.test.mjs tests/job-history.test.mjs tests/reference-skills.test.mjs tests/skills-sandbox-ui.test.mjs` → 13 fichiers / 53 tests verts. Tâches 1 à 11 considérées vérifiées sur cette base réelle. Aucune ligne de code réécrite lors de cette vérification.
- Le « Gate manuel obligatoire Windows Sandbox » ci-dessous reste explicitement NON vérifié : il exige l'activation BIOS/UEFI de la virtualisation + la fonctionnalité Windows Sandbox par Nasro (élévation admin), déjà documenté comme bloqué côté Nasro dans `EXECUTION-LOG.md` et `Pour Nasro.md`. Aucune des 5 preuves physiques listées n'a été rejouée — ce serait une supposition, pas une vérification.

## Gate manuel obligatoire Windows Sandbox

Après activation BIOS/UEFI + fonctionnalité Windows et redémarrage :

1. Exécuter un script Python qui écrit seulement dans `out` ; résultat importable après confirmation.
2. Vérifier absence réseau par tentative DNS/HTTPS ; attendu : échec.
3. Vérifier presse-papiers, imprimante, caméra, micro et dossier projet inaccessibles.
4. Dépasser temps/sortie ; processus tué, historique `budget_exceeded`.
5. Tenter un lancement depuis Telegram/SMS ; refus avant création du job.

Sans ces cinq preuves, le plan 3 reste incomplet.
