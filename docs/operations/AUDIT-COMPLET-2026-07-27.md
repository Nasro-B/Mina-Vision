# Audit technique complet Mina Vision — 2026-07-27

> ## ✅ Suivi des corrections — **12/12 findings traités** (Claude, 2026-07-27)
>
> Chaque finding a été **rejoué contre le code avant correction** (règle projet : jamais appliquer
> un finding d'un autre agent sans re-preuve), corrigé en TDD (test rouge d'abord), puis vérifié.
>
> | ID | Sévérité | État | Preuve |
> |---|---|---|---|
> | F-01 | CRITIQUE | ✅ **CORRIGÉ** `bcdb89d` | `.gitignore` ancré `/emergency/`, 4 modules versionnés, `tests/repo-completeness.test.mjs` (rouge → vert), export git propre importe le graphe de boot |
> | F-02 | ÉLEVÉE | ✅ **CORRIGÉ** `2422538` | Revalidation `isApproved` + époque courante à chaque trame **et** `disconnectDevice` sur révocation ; 2 tests du scénario exact ; famille chat 113/113 |
> | F-03 | MOYENNE | ✅ **CORRIGÉ** `d50ce49` | Manifeste conforme au schéma réel, digest calculé par `computeSkillManifest` ; le registre expose 6 skills ; test dédié (1er skill de référence avec script) |
> | F-04 | MOYENNE | ✅ **CORRIGÉ** `2c216a0` | Concurrence bornée (`maxWorkers: 2`) plutôt que timeouts gonflés ; **`npm test` complet vert : 377 fichiers / 3114 tests + 17 / 48 intégration** |
> | F-05 | MOYENNE | ✅ **CORRIGÉ** `c6d3df3` | Bloc `referenced_evidence` séparé et marqué non fiable côté OpenAI-compatible ; `evidence` propagée dans `continue` (OpenAI + local) ; 32 tests Computer Use verts |
> | F-06 | MOYENNE | ✅ **CORRIGÉ** `80e488f` | `onProcessingError` (fin du `catch` vide) + `persistInbound` optionnel ; **503 au lieu de 202 si rien n'a été conservé** ; branché au journal technique ; 3 tests |
> | F-07 | MOYENNE | ✅ **CORRIGÉ** `bb00230` | `.github/workflows/ci.yml` : Windows + Node 22 + `npm ci` (clone propre) + gate F-01 + `npm test`, et job Android (JVM/lint/APK). ⚠️ *exécution bloquée par un problème de facturation du compte GitHub — action Nasro* |
> | F-08 | MOYENNE | ✅ **CORRIGÉ** `0feedd5` | `coverage.all: true` → dénominateur honnête : 450 fichiers (vs 441), `main.mjs` et workers PRÉSENTS à 0 % ; taux réel 73,98 % statements (l'écart masqué apparaît) |
> | F-09 | MOYENNE | ✅ **VÉRIFIÉ** `bde4ed9` | Re-mesuré : 12 avis (5 high, 7 moderate). `npm audit fix` exécuté → **aucun changement possible** ; 10/12 sans correctif publié. Décisions inchangées (LICENCES §3) |
> | F-10 | FAIBLE | ✅ **CORRIGÉ** `6dec2aa` | Chiffre re-mesuré moi-même (12, pas 13) et corrigé dans les 4 documents |
> | F-11 | FAIBLE | ✅ **CORRIGÉ** `6dec2aa` | Échantillon 10 → 40 mesures + percentile par interpolation R-7 ; vérifié : p95 307,35 ≠ max 346,02, champ `p95DistinctFromMax` |
> | F-12 | FAIBLE | ✅ **CORRIGÉ** `bde4ed9` | **Cause supprimée** (fixtures assemblées à l'exécution) plutôt qu'alerte acquittée ; plus aucun littéral de forme clé Google dans src/ ni tests/ |
>
> **Actions restant à Nasro** (hors code, impossibles depuis ici) :
> 1. débloquer la facturation GitHub pour que le CI s'exécute, puis rendre ses checks obligatoires
>    sur `master` et activer Dependabot Security Updates (complément de F-07) ;
> 2. fermer l'alerte Secret Scanning #1 en « used in tests » — elle n'a plus de source dans le code (F-12) ;
> 3. autoriser l'appareil ADB pour l'instrumentation Android (§6, non exécuté par l'audit).
>
> Le verdict d'origine ci-dessous reste le texte de l'audit ; il n'est pas réécrit — seules les
> lignes d'état ci-dessus sont tenues à jour.

**Verdict : non publiable en l’état.** Le code contient un défaut **CRITIQUE** qui rend un clone
Git propre inutilisable et un défaut **ÉLEVÉ** qui permet à un appareil déjà appairé de continuer
à échanger avec Mina après sa révocation tant que sa WebSocket reste ouverte.

Périmètre final : `f2c99d9f79374a126a314d30919dc8341bd78b70`, identique à
`origin/master` au moment de la clôture. Aucun code applicatif n’a été modifié par cet audit,
aucun commit, push ou déploiement n’a été effectué.

Toutes les commandes et sorties brutes citées ci-dessous sont dans
[PREUVES-COMMANDES.md](audit-2026-07-27/PREUVES-COMMANDES.md).

## 1. Résumé des constats

| ID | Sévérité | Statut | Constat |
|---|---|---|---|
| F-01 | **CRITIQUE** | Confirmé, reproduit | Quatre modules `src/emergency` requis au boot sont ignorés et absents de Git ; import impossible dans un clone propre |
| F-02 | **ÉLEVÉE** | Confirmé, reproduit | Un appareil révoqué mais encore connecté peut envoyer un message, obtenir un ACK et recevoir la réponse chiffrée de Mina |
| F-03 | **MOYENNE** | Confirmé | Le nouveau skill `pianiste-volonte-lumiere` a un manifeste invalide et n’est jamais enregistré |
| F-04 | **MOYENNE** | Confirmé | La commande officielle `npm test` échoue par timeouts dans la configuration parallèle actuelle ; le même corpus passe en série |
| F-05 | **MOYENNE** | Confirmé, reproduit | Les preuves de mission ne sont pas envoyées au fournisseur Computer Use OpenAI-compatible, ni aux tours suivants du fournisseur local |
| F-06 | **MOYENNE** | Confirmé | Une panne d’écriture du SMS httpSMS est avalée, non journalisée et acquittée `202`, donc le message peut être perdu sans retry |
| F-07 | **MOYENNE** | Confirmé live | `master` n’a aucun workflow, check ou review obligatoire ; Dependabot Security Updates est désactivé |
| F-08 | **MOYENNE** | Confirmé | Le taux de couverture publié inclut quatre fichiers ignorés et omet cinq fichiers trackés, dont `src/ui/main.mjs` |
| F-09 | **MOYENNE** | Confirmé | `npm audit` mesure 12 avis : 5 high et 7 moderate, principalement transitifs et sans correctif disponible |
| F-10 | **FAIBLE** | Confirmé | Les documents de sécurité/licences annoncent encore 13 avis au lieu des 12 mesurés |
| F-11 | **FAIBLE** | Confirmé | Le benchmark vectoriel nomme « p95 » une valeur qui est toujours le maximum avec ses 10 mesures |
| F-12 | **FAIBLE** | Confirmé | L’alerte GitHub Secret Scanning reste ouverte alors que le candidat courant est une fixture invalide |

Comptage : **1 critique, 1 élevée, 7 moyennes, 3 faibles**. Aucun autre constat n’est élevé au
rang de finding sans reproduction ou preuve positive.

## 2. Couverture réelle de l’audit

### Code JavaScript

- 1 074 fichiers trackés au total au SHA final.
- 446 modules source JavaScript : 444 `.mjs`, 1 `.js`, 1 `.cjs`.
- 42 137 fins de ligne mesurées dans ces modules.
- 4 837 nœuds de fonction Acorn inventoriés, sans erreur de parsing.
- 393 fichiers de test : 376 unitaires/architecture/code et 17 intégration.
- 417 modules ont au moins un importeur de test direct ; 29 n’en ont pas.
- 441/446 modules trackés apparaissent dans la couverture.

Annexes exhaustives :

- [modules.csv](audit-2026-07-27/modules.csv) : chemin, taille, hash, imports, imports manquants,
  compte de fonctions, couverture et tests importeurs pour chacun des 446 modules.
- [functions.csv](audit-2026-07-27/functions.csv) : les 4 837 fonctions avec type, nom et lignes.

### Android

- 92 fichiers source : 87 Kotlin et 5 Java.
- 462 déclarations détectées : 447 Kotlin et 15 Java.
- 68 fichiers `main`, 23 fichiers `test`, 1 fichier `androidTest`.

Annexes :

- [android-modules.csv](audit-2026-07-27/android-modules.csv)
- [android-function-declarations.csv](audit-2026-07-27/android-function-declarations.csv)

La détection Android repose sur un regex assaini, pas sur un AST Kotlin. Elle a été
contre-vérifiée : 11 vrais positifs Kotlin espacés dans l’arbre, plus rapprochement avec `rg`.
Le premier passage omettait trois méthodes Java ; elles ont été ajoutées avant publication.

### Limite non négociable

Il serait faux d’affirmer que « chaque fonction a été testée E2E ». Les E2E valident des parcours,
pas des fonctions isolées. La couverture instrumentée prouve 3 460/4 429 fonctions couvertes
dans 441 fichiers, soit 78,12 %, et cinq fichiers trackés ne sont pas instrumentés. L’audit
fournit donc l’inventaire de chaque fonction et la preuve dynamique disponible, mais refuse de
transformer une absence de preuve en faux résultat vert.

## 3. Matrice des tests exécutés

| Surface | Commande / méthode | Résultat |
|---|---|---|
| Gate officiel | `npm test` | **Échec** : 6 fichiers / 6 tests en timeout, 370 fichiers et 3 089 tests passés, 9 skipped |
| Rejeu des six fichiers | Vitest série, timeouts explicites | **6/6 fichiers, 35/35 tests verts** |
| Unitaire + couverture | Vitest série | **376/376 fichiers, 3 104/3 104 tests verts** |
| Intégration | `npm run test:integration` | **17/17 fichiers, 48/48 tests verts** |
| Critique | `npm run test:critical` | **16/16 fichiers, 182/182 tests verts** |
| Electron réel | Playwright Electron, profil/userData isolés | Bienvenue, profil, mémoire, six vues et IPC validés ; 0 erreur renderer |
| Android JVM | Gradle `test --rerun-tasks` | **182 exécutions cumulées** : 91 debug + 91 release, 0 échec |
| Android build | `test lintDebug assembleDebug` | `BUILD SUCCESSFUL`, APK généré |
| Android lint | 7 rapports XML | 69 warnings, **0 erreur** |
| Android instrumenté | `connectedDebugAndroidTest` | **Non exécuté sur appareil** : ADB `unauthorized`, aucun device online |
| Dépendances | audit, signatures, arbre, outdated | 12 avis ; 0 signature invalide/manquante ; arbre direct valide |
| Fournisseurs live | Auth + une inférence Computer Use | Gemini/OpenRouter/Groq/Deepgram auth 200 ; Gemini et OpenRouter inférence acceptée ; Modal 503 |

Le parcours Electron a généré une phrase de récupération de **12 mots** et n’a jamais journalisé
son contenu. Les préférences de la vraie fenêtre étaient :
`nodeIntegration=false`, `contextIsolation=true`, `sandbox=true`, `webSecurity=true`,
`allowRunningInsecureContent=false`.

## 4. Findings détaillés

### F-01 — CRITIQUE — le dépôt ne contient pas quatre modules requis au boot

`src/core/compose-governance-domains.mjs:15-18` importe :

- `src/emergency/network-policy.mjs`
- `src/emergency/device-guard.mjs`
- `src/emergency/emergency-mode.mjs`
- `src/emergency/emergency-corpus.mjs`

`src/ui/main.mjs:117` importe statiquement ce composeur. Or `.gitignore:39` contient
`emergency/`, motif qui ignore aussi `src/emergency/`. Les quatre fichiers existent sur le disque
de développement mais :

- `git ls-files` en trouve 0 ;
- `git log --all -- src/emergency` ne trouve aucun commit ;
- un clone exact de `f2c99d9` contient 0 fichier sous ce chemin ;
- l’import Node du composeur y termine avec `ERR_MODULE_NOT_FOUND`, exit 1.

**Impact confirmé :** un nouveau poste, une CI ou un utilisateur du dépôt public ne peut pas
charger ce graphe de boot. Le smoke local passe uniquement parce que les fichiers ignorés sont
présents hors Git.

**Correction attendue :** décider si ces modules doivent être source officielle. Si oui, corriger
le motif `.gitignore`, ajouter les quatre fichiers et ajouter un test exécuté depuis un export Git
propre. Ne pas supprimer les imports pour masquer le symptôme.

### F-02 — ÉLEVÉE — une révocation n’invalide pas une session WebSocket active

`chat-channel.revoke()` appelle `registry.revoke()` et persiste l’état, mais ne ferme pas la
session. `chat-server.handleEvent()` ne revalide pas `registry.isApproved(session.deviceId)` et
accepte l’ancienne `event.keyEpoch`.

Le harnais réel prouve la séquence :

1. appareil appairé, époque 1, WebSocket connectée ;
2. révocation : appareil non approuvé, époque 2, socket toujours connectée ;
3. envoi signé/chiffré avec l’époque 1 ;
4. serveur renvoie `ack`, exécute `respond()` et livre une réponse déchiffrable.

**Portée exacte :** il faut avoir été appairé et conserver la connexion ouverte. Une reconnexion
après révocation n’est pas démontrée comme possible.

**Correction attendue :** fermer immédiatement la socket du device révoqué, revalider
l’approbation et l’époque sur chaque trame, puis ajouter ce scénario exact à
`tests/chat-server.test.mjs`.

Reproduction : [repro-chat-revocation.mjs](audit-2026-07-27/repro-chat-revocation.mjs).

### F-03 — MOYENNE — le skill pianiste est livré mais invisible pour Mina

Le commit `fd5866d` ajoute cinq fichiers fonctionnels. Le script Python produit une piste MIDI
valide et refuse un pitch invalide. En revanche, `SKILL.md` ne déclare que `name` et
`description`, alors que `skill-schema.mjs` exige les champs exacts de version, triggers,
capacités, canaux, compatibilité, budgets, digest et entrypoints.

Résultat réel :

```text
audit error = skill_metadata_fields_invalid
pianistRegistered = false
```

Le correctif de résilience `1377861` fonctionne : le registre ignore ce dossier au lieu de tuer le
boot. Cela évite le crash, mais ne rend pas le skill utilisable.

**Correction attendue :** produire un manifeste conforme, calculer le vrai digest, déclarer le
script et ajouter le skill au test `reference-skills`.

### F-04 — MOYENNE — le gate officiel échoue dans sa configuration actuelle

`npm test` lance l’unitaire en parallélisme Vitest par défaut. Dans la passe mesurée, six tests ou
hooks ont dépassé 10/30/180 secondes. Les six fichiers exacts passent ensuite en série, puis les
376 fichiers et 3 104 tests passent en série avec couverture.

**Ce qui est prouvé :** le gate officiel est rouge dans cette exécution et le corpus est vert en
série. **Ce qui n’est pas prouvé :** la cause interne exacte de chaque timeout. La contention est
une explication plausible, pas une conclusion profilée.

**Correction attendue :** choisir un gate reproductible dans `package.json`, mesurer les tests
lents et fixer leur budget. Ne pas augmenter aveuglément tous les timeouts.

### F-05 — MOYENNE — perte des preuves dans deux routes Computer Use

Le pipeline runtime collecte et transmet bien `evidence` jusqu’au fournisseur routé.

- OpenAI-compatible : `start()` stocke la preuve dans sa session, mais `userContent()` ne reçoit
  jamais ce champ ; la preuve est absente au démarrage et au tour suivant.
- Local : le démarrage transmet bien la preuve, mais `continueInteraction()` l’omet.
- Gemini : cas positif testé, preuve séparée du but et marquée comme source non fiable.

Le marqueur injecté par le harnais est absent des deux prompts OpenAI et du deuxième prompt local.
Cela prouve une perte de grounding, pas une hallucination précise en production.

**Correction attendue :** inclure un bloc de preuve borné, séparé et explicitement non fiable dans
chaque tour ; ajouter des assertions analogues au test Gemini.

Reproduction :
[repro-computer-use-evidence.mjs](audit-2026-07-27/repro-computer-use-evidence.mjs).

### F-06 — MOYENNE — un SMS httpSMS peut être perdu silencieusement

Après signature, anti-rejeu, normalisation et bornes de taille, le serveur appelle
`onInboundMessage`. Toute exception est attrapée par un `catch` vide, puis une réponse `202` est
envoyée. La composition réelle commence par `memoryController.rememberRemoteMessage`.

Le test existant confirme volontairement `202` quand le callback lance
`memory_write_failed`. Mais aucune file durable, aucun retry interne et aucun log d’échec ne sont
présents. Le commentaire « handled internally » ne correspond pas à une implémentation visible.

**Impact :** panne locale de stockage après authentification = fournisseur informé que le message
est accepté, alors que Mina ne l’a pas mémorisé.

**Correction attendue :** acquitter rapidement mais écrire d’abord dans une inbox durable
idempotente, traiter ensuite, journaliser et rejouer les échecs.

### F-07 — MOYENNE — aucun contrôle automatisé obligatoire sur `master`

État GitHub live :

- dépôt public, branche par défaut `master` ;
- 0 workflow Actions ;
- aucun required status check, aucune required review ;
- signatures obligatoires désactivées ;
- Dependabot Security Updates désactivé ;
- Secret Scanning et Push Protection activés.

`allow_force_pushes=false` et `allow_deletions=false` sont des contrôles positifs : ils ne sont pas
présentés comme failles.

**Correction attendue :** CI sur clone propre, tests série reproductibles, build Android, audit
licence/secrets ; rendre les checks et au moins une review obligatoires selon le mode de travail
retenu.

### F-08 — MOYENNE — la couverture affichée n’est pas celle du dépôt tracké

Le rapport V8 annonce 80,04 % statements, mais :

- il inclut les quatre modules `src/emergency` ignorés ;
- il omet cinq modules trackés, dont le processus principal Electron et deux workers ;
- la couverture trackée recalculée est 80,03 % statements, 74,92 % branches, 78,12 % fonctions,
  85,06 % lignes.

Le problème principal n’est pas l’écart de 0,01 point : c’est l’absence complète de cinq surfaces
du dénominateur.

**Correction attendue :** instrumenter `main.mjs`, les workers/factories et faire échouer la
couverture si un fichier source tracké manque du rapport.

### F-09 — MOYENNE — 12 avis de dépendances

Mesure actuelle :

- 0 critique ;
- 5 high : chaînes Hugging Face, ONNX Runtime, `adm-zip`, `sharp`, Kokoro ;
- 7 moderate : chaîne Jimp/Nut et `file-type` ;
- aucun correctif disponible pour les chaînes principales ;
- 0 signature npm invalide ou manquante ;
- 37 dépendances directes, arbre `npm ls` valide ;
- 13 directes ont une version plus récente.

La sévérité de ce finding est **MOYENNE**, même si npm étiquette cinq nœuds high : aucun exploit
applicatif n’a été reproduit et plusieurs chemins sont transitifs/install-time. Il ne faut pas
promettre que `npm audit fix` résout ces chaînes.

**Correction attendue :** suivre les versions amont, réduire les entrées non fiables vers les
parseurs concernés et réévaluer chaque chemin avant release.

### F-10 — FAIBLE — documentation npm périmée

`LICENCES.md`, `LICENCES.fr.md`, `SECURITY-AUDIT.md` et sa version française annoncent 13 avis
(6 high, 7 moderate). La mesure du 2026-07-27 est 12 avis (5 high, 7 moderate). Les analyses de
licence et de distribution restent autrement cohérentes avec la release actuelle.

### F-11 — FAIBLE — « p95 » égal au maximum par construction

Après deux warmups, le benchmark trie dix mesures et prend l’index
`ceil(10 × 0,95) - 1 = 9`, soit le dernier élément. Les deux exécutions confirment
`p95Ms == maxMs`. Renommer en max ou augmenter fortement l’échantillon avant d’utiliser cette
métrique comme gate.

### F-12 — FAIBLE — alerte Secret Scanning ouverte sur une fixture

GitHub conserve une alerte « Google API Key » ouverte et `publicly_leaked=true`. Les trois
locations sont des tests/documents de prépublication. Le seul candidat Google tracké :

- diffère de la clé Gemini configurée ;
- reçoit HTTP 400 `API_KEY_INVALID`.

GitHub ne renvoie pas la valeur brute de l’alerte : l’identité entre l’alerte et ce candidat est
une **inférence fondée sur les trois locations**, pas une comparaison de valeurs. Aucun secret
actif n’est confirmé par ce scan. Si l’alerte correspond bien à cette fixture, la fermer comme faux
positif améliorerait le signal opérationnel.

## 5. Intégrations et plugins : état confirmé

### Matrice de vérification

| Surface | Preuve automatisée exécutée | Preuve live/matérielle |
|---|---|---|
| Gemini texte/live/Computer Use | Tests Gemini verts dans la suite série | Auth 200, Computer Use accepté |
| OpenAI-compatible / OpenRouter | Tests texte et Computer Use verts | Auth 200, Computer Use accepté |
| Groq recherche web | `web-answer.test.mjs` vert | Auth 200 uniquement |
| Deepgram STT | `deepgram-stt.test.mjs` vert | Auth 200, pas de flux micro live |
| Modal | Contrat OpenAI-compatible testé | Endpoint live 503 |
| LM Studio texte/embedding | Trois fichiers LM Studio verts | Serveur loopback inaccessible |
| Chat `mina_app` WebSocket/crypto/média | Toute la famille `chat-*` verte | F-02 reproduit sur vrai serveur local |
| SMS natif/httpSMS | Client, HMAC/replay, routage et deux intégrations verts | httpSMS non configuré ; F-06 confirmé |
| Mail Gmail/Graph/IMAP-SMTP | Adaptateurs, policies, sync, IPC verts | Aucun compte live testé |
| Google Calendar/Tasks/Contacts | Connector, OAuth et services verts | Aucun compte live testé |
| Maison HA/MQTT/Google Home | Adaptateurs et domaine verts | Non configuré / SDK absent |
| Telegram | Routeur, approbations, mail/home et intégration verts | Owner chat id absent |
| YouTube | Data client et contrat UI verts | API key absente |
| Firebase backup/transport | Backup et transport simulés verts | Projet/bucket absents |
| Impression | Service, spooler Windows et contrat main verts | Aucune impression physique lancée |
| Documents | Intake, quarantaine, parsing, conversion, mémoire et UI verts | Pas de suite Office externe live |
| Sandbox code/Windows | Runner, stream, launcher et contrats main verts | Aucun job destructif/externe lancé |
| Caméra/biométrie | Clients, IPC, runtime, modèle et reconnaissance verts | Instrumentation Huawei bloquée |
| Skills | Registre, installateur, sandbox et références verts | 5 valides ; pianiste invalide (F-03) |

### Fournisseurs cloud

| Intégration | Configuration | Sonde live | Conclusion bornée |
|---|---:|---:|---|
| Gemini | Oui | HTTP 200 + inférence Computer Use acceptée | Fonctionnel pendant la passe |
| OpenRouter | Oui | HTTP 200 + inférence acceptée | Fonctionnel pendant la passe |
| Groq | Oui | HTTP 200 | Auth valide ; aucune réponse métier E2E revendiquée |
| Deepgram | Oui | HTTP 200 | Auth valide ; aucun flux audio live revendiqué |
| Modal | Oui | HTTP 503 | Indisponible pendant la passe |
| DeepSeek | Non | Non lancé | Non testé live |

### Intégrations non configurées ou matériel absent

LM Studio, transport Android/Wi-Fi et SDK Google Home n’étaient pas prêts. `npm run verify`
rapporte les comptes mail comme « not yet configurable from CLI ». Firebase, httpSMS, Telegram
propriétaire, YouTube Data, Home Assistant et MQTT n’étaient pas configurés. Leurs tests
mockés/intégration passent là où ils existent, mais aucune réussite live n’est affirmée.

### Firebase

Les règles Firestore autorisent toute session authentifiée à lire/créer un document conforme et
à supprimer n’importe quel document `relay`. Cela autorise un déni de disponibilité si
l’authentification anonyme est ouverte. Le design documente toutefois Firebase comme transport
non fiable ; contenu et intégrité reposent sur AES-GCM/P-256. Firebase n’étant pas configuré, ce
point est un **risque conditionnel**, pas une vulnérabilité live confirmée.

Les règles Storage sont mieux cloisonnées par `request.auth.uid == ownerId`.

### Skills

Cinq skills sont installables et sans script/exécutable/dépendance détecté :
`file-analysis`, `massage-robot-domicile`, `mythos`, `research-summary`, `sandbox-code`.
Leur licence est `unknown`, car aucun fichier de licence n’est inclus. Le sixième, pianiste, est
F-03.

## 6. Android : ce qui reste non confirmé

Le build, les tests JVM, l’APK et lint sont vérifiés. Le téléphone répond
`192.168.X.X:5555 unauthorized`, donc les scénarios suivants restent **non exécutés** :

- lancement/upgrade réel de l’APK ;
- Room + Android Keystore instrumentés ;
- CameraX avant/arrière ;
- SMS/Telegram réels ;
- USB/LAN/Firebase sur le Huawei ;
- comportement exact API 29.

Lint signale en outre `FOREGROUND_SERVICE_TYPE_CAMERA` (API 30) derrière une condition
`SDK_INT >= 29`. Aucun crash API 29 n’a été reproduit ; ce point reste `[À VÉRIFIER SUR API 29]`
et n’est pas compté comme finding confirmé.

## 7. Supply chain, licences et secrets

- `npm audit signatures` : 0 signature invalide, 0 manquante.
- Une seule licence directe non permissive : `espeak-ng@1.0.2`, GPL-3.0-or-later, importé dans le
  worker voix local.
- La release GitHub live contient uniquement `Mina.Vision.apk`, sans dépendances Node.
- Aucune violation GPL actuelle n’est prouvée.
- Un futur installeur Electron qui embarque `node_modules/espeak-ng` reste un gate juridique avant
  distribution.
- Secret Scanning et Push Protection GitHub sont activés.
- Aucun secret actif n’a été imprimé ou confirmé pendant l’audit.

## 8. Analyse des commits ajoutés pendant l’audit

### `fd5866d` — skill pianiste

Structure de fichiers et script MIDI fonctionnels, manifeste Mina invalide : F-03.

### `56178b8` — documentation bilingue

- 32 fichiers modifiés ;
- 16 fichiers français et 16 homologues anglais trackés ;
- 16/16 paires présentes ;
- 87 liens relatifs de l’ensemble des 54 Markdown trackés : 0 cible manquante ;
- `git diff --check` : exit 0.

Ce contrôle ne constitue pas une certification professionnelle de traduction juridique ou
linguistique.

### `f2c99d9` — licence et inventaire bilingues

- `LICENSE` canonique française inchangée ;
- `LICENSE.en.md` clairement marquée traduction de courtoisie ;
- test de protection de licence : 4/4 vert ;
- liens Markdown : 0 cible relative manquante ;
- dette restante : F-10, chiffre npm périmé.

Les commits documentaires n’ont modifié ni `src`, ni `tests`, ni `android`, ni
`package-lock.json`, preuve faite par les hashes d’arbre Git.

## 9. Priorité de réparation

1. **F-01** : rendre les quatre modules emergency réellement versionnés et ajouter un gate clone
   propre.
2. **F-02** : invalider/fermer les sessions révoquées et tester l’ancienne époque.
3. **F-03** : rendre le manifeste pianiste conforme et auditable.
4. **F-05** : propager les preuves à tous les tours Computer Use.
5. **F-06** : inbox durable/idempotente pour httpSMS.
6. **F-04 + F-07** : gate de test reproductible puis CI/checks obligatoires.
7. **F-08** : couvrir le main process et les workers, contrôler le dénominateur.
8. **F-09 à F-12** : dépendances, docs, métrique benchmark et alerte GitHub.
9. Autoriser l’appareil ADB, puis exécuter l’instrumentation Android et les parcours matériels.

Toute réparation de code doit suivre TDD : test rouge reproduisant exactement le défaut, diff
minimal, suites verte avant/après. Aucun finding n’est marqué « corrigé » dans ce rapport.
