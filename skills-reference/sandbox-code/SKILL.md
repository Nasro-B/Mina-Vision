---
name: sandbox-code
description: Transforme une demande explicite locale en proposition de job sandbox strictement bornée.
version: 1.0.0
triggers:
  - exécute ce code dans la sandbox
  - lance ce script isolé
capabilities:
  - sandbox.propose
channels:
  - local
  - voice
compatibility:
  mina: ">=3"
  platforms:
    - win32
entrypoints:
  instructions: SKILL.md
  references: []
  scripts: []
budgets:
  maxDurationMs: 300000
  maxCostMicros: 10000
  maxTokens: 16384
digest: sha256:2b04efa31b09249a612f8a5b538495554855999fc7aeac4b8f2ab754e0ff7023
---

# Sandbox code

Produire uniquement une proposition structurée conforme au schéma de job. Ne jamais exécuter de code ni importer un module depuis le skill.

Exiger deux confirmations locales distinctes et non réutilisables :

1. copie des sources confirmées par digest dans le workspace jetable ;
2. lancement de Windows Sandbox avec les limites affichées.

Si Windows Sandbox, la virtualisation, NTFS, un runtime portable ou un digest manque, répondre `sandbox_unavailable`. Ne jamais utiliser Python, Node ou PowerShell de l’hôte comme fallback.
