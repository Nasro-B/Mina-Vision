# Licences et dépendances — Mina Vision

> Généré le 2026-07-22 (plan de réconciliation, R-17 + SBOM léger). App **privée, non
> distribuée** : Mina Vision tourne uniquement sur le poste de Nasro. Ce statut porte les
> décisions ci-dessous — **le gate de release (Wave 4) repose la question à chaque fois : «
> distribution prévue ? »** Si un jour l'app est distribuée (installeur, autre machine, tiers),
> relire la section espeak-ng AVANT tout envoi.

## 1. Décision espeak-ng (GPL-3.0-or-later)

- `espeak-ng@1.0.2` est sous **GPL-3.0-or-later** ; Mina Vision est sous licence source disponible
  propre (`package.json` : `SEE LICENSE IN LICENSE`, voir [LICENSE](LICENSE)) — ce champ disait
  encore `ISC` (défaut `npm init`) au moment de la génération de ce document (2026-07-22), corrigé
  le lendemain avec la création de la LICENSE dédiée.
- Usage réel : phonémisation pour Kokoro (TTS local). Dépendance NÉCESSAIRE au repli vocal local.
- **Décision : conservé.** Les obligations GPL (fourniture des sources, licence compatible de
  l'ensemble) se déclenchent à la **distribution** — une app privée exécutée par son seul auteur
  n'en déclenche aucune.
- **Si distribution un jour** : soit distribuer l'ensemble conformément à la GPL (sources
  incluses), soit remplacer le phonémiseur (alternatives non-GPL à évaluer à ce moment-là).

## 2. Inventaire des dépendances directes (prod)

| Paquet | Version | Licence |
|---|---|---|
| @azure/msal-node | 5.4.0 | MIT |
| @google/genai | 2.11.0 | Apache-2.0 |
| @huggingface/transformers | 4.2.0 | Apache-2.0 |
| @nut-tree-fork/nut-js | 4.2.6 | Apache-2.0 |
| @scure/bip39 | 2.2.0 | MIT |
| acorn / acorn-walk | 8.15.0 / 8.3.4 | MIT |
| adm-zip | 0.6.0 | MIT |
| argon2 | 0.44.0 | MIT |
| better-sqlite3 | 12.11.1 | MIT |
| diff | 9.0.0 | BSD-3-Clause |
| docx | 9.5.1 | MIT |
| dotenv | 17.4.2 | BSD-2-Clause |
| **espeak-ng** | **1.0.2** | **GPL-3.0-or-later** (voir §1) |
| firebase | 12.16.0 | Apache-2.0 |
| google-auth-library | 10.9.0 | Apache-2.0 |
| imapflow | 1.4.7 | MIT |
| kokoro-js | 1.2.1 | Apache-2.0 |
| mailparser | 3.9.14 | MIT |
| nodemailer | 9.0.3 | MIT-0 |
| officeparser | 7.3.0 | MIT |
| onnxruntime-node | 1.27.0 | MIT |
| openai | 6.46.0 | Apache-2.0 |
| pdf-lib | 1.17.1 | MIT |
| pdfjs-dist | 6.1.200 | Apache-2.0 |
| playwright | 1.61.1 | Apache-2.0 |
| pngjs | 7.0.0 | MIT |
| sharp | 0.35.3 | Apache-2.0 |
| ws | 8.21.1 | MIT |
| yaml | 2.9.0 | ISC |
| zod | 4.4.3 | MIT |

Dev : @electron/rebuild (MIT), @vitest/coverage-v8 (MIT), electron 43.1.0 (MIT), fast-check
(MIT), vitest (MIT). Retirées le 2026-07-22 (R-16, zéro import) : `@google/generative-ai`,
`mqtt`, `ws` — **`ws` réintroduit dès le lendemain** (canal `mina_app`, 2026-07-22 soir/23) :
`WebSocketServer` réel dans `src/devices/chat-server.mjs`, plus un import mort. Tableau
ci-dessus déjà à jour ; vulnérabilité associée en §3. `@google/generative-ai` et `mqtt` restent
absents (vérifié 2026-07-24 : zéro occurrence dans `package.json`/`src/`).

Aucune dépendance AGPL. Une seule GPL (espeak-ng, §1). Le skill-auditor refuse par ailleurs
tout skill AGPL à l'installation (`skill_license_incompatible`).

## 3. Vulnérabilités npm audit — atteignabilité et décisions (2026-07-22, ré-audité 2026-07-24)

13 avis (7 moderate, 6 high, 0 critical) — 12 au 2026-07-22, plus 1 apparu avec le retour de
`ws` en dépendance directe (voir §2). La majorité reste **transitive ou sans correctif publié**
(`fixAvailable: false` sauf mention) ; `ws` fait exception : dépendance **directe**, correctif
publié. Aucune promesse `npm audit fix` automatique — décision par chemin d'atteignabilité :

| Avis | Sévérité | Chemin d'entrée réel | Décision |
|---|---|---|---|
| adm-zip « Crafted ZIP triggers 4GB memory allocation » | high | Install de skills + quarantaine mail = SEULES surfaces qui ouvrent des zips non fiables | **Mitigé applicativement** : refus AVANT décompression (ratio >100:1, tailles incohérentes, bornes 20/25 MiB, ≤500 entrées) — la bombe n'est jamais décompressée. Suivre les releases adm-zip |
| onnxruntime-node (via son adm-zip embarqué) | high | Décompression de MODÈLES locaux installés par Nasro — aucune entrée non fiable | Acceptée, surveillée |
| sharp (CVE libvips 2026-33327/28, 35590/91) | high | sharp n'encode QUE les captures d'écran locales du worker desktop — jamais d'image externe | Acceptée, surveillée ; monter sharp dès qu'un correctif sort |
| @huggingface/transformers / kokoro-js (via onnxruntime) | high | Modèles TTS/embeddings locaux | Acceptée, surveillée |
| file-type (boucle infinie ASF) + chaîne jimp/@jimp/* / nut-js | moderate | jimp n'est utilisé par nut-js que sur des captures locales | Acceptée ; `fixAvailable: true` partiel sur la chaîne nut-tree : à reprendre quand le fork publie |
| ws « Uninitialized memory disclosure » (GHSA-58qx-3vcg-4xpx, moderate) + « Memory exhaustion DoS from tiny fragments » (GHSA-96hv-2xvq-fx4p, high), plage 8.0.0–8.20.1 | high | `src/devices/chat-server.mjs` — `WebSocketServer` réel du canal `mina_app`, reçoit des frames depuis un téléphone appairé (LAN/USB, jamais Internet ouvert) | **Mitigé le 2026-07-24** : `ws` mis à jour 8.19.0 → 8.21.1 (hors plage vulnérable), tests du serveur de chat verts après mise à jour |

Re-vérification : `npm audit --json` à chaque vague de release (gate Wave 4) — rejoué le
2026-07-24 pendant cet audit doc (13 avis, détail ci-dessus).

## 4. Régénération

```bash
npm ls --omit=dev --depth=0
```

```bash
npm audit --json
```

Licences des directes : lire `node_modules/<paquet>/package.json` (champ `license`). Mettre à
jour CE fichier à chaque ajout/retrait de dépendance — le gate de release le vérifie.
