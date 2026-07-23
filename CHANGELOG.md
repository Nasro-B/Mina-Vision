# Changelog Mina

Ce fichier distingue strictement les capacités livrées (tests automatisés verts, gate franchi) des évolutions encore planifiées. Une capacité ne passe de « planifiée » à « livrée » que lorsque son plan d'exécution est intégralement coché avec preuve réelle — jamais par anticipation.

> Les plans d'exécution et spécifications de conception qui documentent ce processus sont des documents de travail internes, non publiés (ils contiennent des chemins machine et l'historique détaillé du développement). Ce changelog reste la source de vérité publique sur ce qui est livré.

## Livré (2026-07-22 après-midi — plan de réconciliation, vagues 0-4 amendées)

Exécution du plan de réconciliation exhaustive (document interne) dans sa version amendée (git au lieu de robocopy, journal double couche au lieu de la perte des textes, R-02 reformulé en durcissement, R-17 résolu par décision documentée). Un commit git par tâche — le projet est un **dépôt git local** depuis cette vague (aucun remote, aucun push).

- **R-01 — Le Capability Broker est l'autorité de chaque action Computer Use** : sans grant de session borné (mission + durée), AUCUNE action n'atteint l'exécuteur (`authorization_denied`) ; toute action sensible exige une confirmation locale liée cryptographiquement au digest exact de l'action, consommée une seule fois. L'arrêt dur (`classifyAction`) reste devant le broker.
- **Task 2 — Contrat d'action** : le provider OpenAI-compatible exige `intent` (but de l'action) et `safety_decision` (`allowed`/`require_confirmation`/`blocked`) dans chaque action ; `allowed` ne débloque rien, `blocked` n'est jamais « réparé ». (Le provider Gemini utilise le tool natif de l'API — schéma serveur, son `safety_decision` natif était déjà exploité.)
- **R-02 — Anti-bombe d'archives** : ratio de décompression >100:1 et tailles incohérentes refusés AVANT toute décompression (installeur de skills ET quarantaine mail) ; `adm-zip` 0.6.0, `diff` 9. L'advisory adm-zip « 4 GB allocation » (sans correctif publié) est précisément mitigée par ces limites.
- **Task 4 / R-03-R-04 — Credentials et ACL** : les documents credentials (clients OAuth, comptes de service, clés privées, caches de tokens, bases navigateur) sont interdits de lecture par chemin ET par contenu, même renommés ; le dossier du journal est restreint au seul utilisateur (icacls) ; les racines de lecture approuvées passent de « C:\ et G:\ entiers » au projet + `Documents\Mina Vision` (ajouts explicites via `MINA_APPROVED_READ_ROOTS`), le reste en one-shot confirmé.
- **Task 5 — Journal double couche** : plus aucun texte utilisateur en clair sur disque — la couche 1 (JSONL) garde `charCount` + digest, la couche 2 chiffre le texte intégral (AES-256-GCM, clé HKDF dérivée du coffre au déverrouillage, tampon RAM borné avant). `lire_journal` restitue le texte exact coffre ouvert, et le dit honnêtement coffre fermé. Rétention 7 jours inchangée.
- **R-06** : les racines de l'ancien projet (`G:\Serveurs\Mina AI/API/APP/Modal`) ne sont plus des racines d'écriture de confiance — grep-contract permanent.
- **R-07 — Anti-SSRF** : politique d'URL sur la recherche Web (localhost, `.local`, credentials d'URL, toutes classes IP privées IPv4/IPv6, résolution DNS vérifiée, redirection finale revérifiée), branchée dans la composition réelle.
- **Améliorations A/C/D/E** : catalogue readiness/health/capabilities (`mina:capability-catalog`) ; stores JSON versionnés fail-closed (quarantaine `.perdu-` sur version inconnue, appliqué à l'endpoint ADB) ; budgets opérationnels centralisés ; arrêt d'urgence réellement transversal (voix Gemini + repli Deepgram + audio renderer + portes vocales remises à zéro + mission/code/desktop/runtime).
- **Task 18** : contrat d'intégration desktop réaligné (JPEG `ffd8ff`) ; **`npm test` = gate complet** (unitaire + intégration) — `npm run test:unit` reste la boucle rapide.
- **R-16** : dépendances mortes retirées (`@google/generative-ai`, `mqtt`, `ws`).
- **R-17 + SBOM** : [docs/LICENCES.md](docs/LICENCES.md) — inventaire des licences (une seule GPL : `espeak-ng`, conservé, app privée non distribuée, gate de release repose la question) + les 12 avis `npm audit` qualifiés par chemin d'atteignabilité avec décision.
- **Amélioration B** : 10 invariants sécurité exécutables (`tests/security-invariants.test.mjs`) — débrancher une défense fait échouer la suite.

## Livré (2026-07-22 soir — fin du plan : Tasks 8-16, 19, 21, 22, 23-24)

Suite et FIN du plan de réconciliation (demande Nasro : « il faut absolument tout finir »). Un incident réel attrapé et corrigé en chemin : le durcissement ACL automatique du boot (vague après-midi) cassait les permissions du journal sur fichiers ouverts — ACL réparées, durcissement auto remplacé par une inspection sans modification.

- **Task 9 — IPC unifié et gardé** : `registerMinaIpc` devient LE point d'enregistrement des domaines — garde sender-frame (seule la fenêtre principale peut invoquer), limite de payload 1 MiB (16 MiB pour l'enrôlement caméra, limites par canal). Un doublon de canal réel (`mina:printing:discover`, attrapé par un boot de vérification) a été résolu en gardant les handlers historiques porteurs de la confirmation locale.
- **Task 8 — Catalogue de vérité runtime** : chaque domaine publie son état RÉEL au boot (`available`/`degraded`/`unavailable` avec raison obligatoire, preuves sensibles refusées), lisible via `mina:capabilities:list`.
- **Tasks 11-13 — Domaines composés en réel** : personnel (briefing du jour + routines persistantes + graphe personnel SQLite migré + contacts Google si connectés), documents (réception en quarantaine réelle + impression, confirmations locales préservées), personnalité (service scellé par le coffre).
- **Tasks 10/14/15/16 — Verdict de vérité** : automation, recovery, evaluation, emergency, approvals PC et connectors ont des dépendances runtime qui n'existent pas dans le code (`domain_registry.invoke`, `budget_estimator`, `disclosure_classifier`, `model_router.route`, `network_policy`, `device_guard`, `state_observer`, `zip_inspector`) → publiés **indisponibles avec la dépendance manquante nommée** — jamais composés sur des simulacres. Home reste dégradé (aucun connecteur), biométrie indisponible (pipeline non implémenté), backup selon la configuration Firebase réelle. Les approbations distantes Telegram restent servies par la passerelle Android.
- **Task 21 — Profils navigateur** : inventaire read-only ([scripts/inventory-browser-profiles.mjs](scripts/inventory-browser-profiles.mjs), jamais le contenu) + [docs/operations/BROWSER-PROFILE-MIGRATION.md](docs/operations/BROWSER-PROFILE-MIGRATION.md). État réel : `profiles/` legacy 150 Mo (18/07) vs profil actif 118 Mo — décision d'archivage en attente Nasro (§ ci-dessous).
- **Task 22 — Accessibilité ciblée** : label explicite sur la phrase de récupération (placeholder seul avant), plancher de largeur 900→320 px, contrat exécutable (boutons icon-only nommés, reduced-motion, visually-hidden).
- **Task 19 (partiel assumé)** : la composition est verrouillée par contrat de test plutôt que par extraction totale de `main.mjs` — l'extraction complète reste un refactor de confort, sans enjeu de sécurité.
- **Tasks 23-24** : ce CHANGELOG est la matrice de vérité (statuts alignés sur le catalogue runtime) ; gate de release = `npm test` complet vert + boot Electron réel vérifié sain (`memory_auto_unlock ok:true`, zéro crash).

## Livré (2026-07-22 — demandes directes, TDD et vérification réelle à chaque étape)

- **Mina Code** (46 modules `src/code/` + `src/ui/code/`) : indexation du code (AST, graphe d'appels, graphe de dépendances, recherche), édition structurée par patch avec rollback AST, intégration Git en lecture (`git push` structurellement absent du code), boucle TDD, revue de code + scanner de sécurité, routeur multi-fournisseurs. Domaine additif (`createMinaOrchestrator({ domain: 'code' })`) : zéro changement de comportement sans ce paramètre. Auto-analyse de Mina Vision elle-même, pas un projet externe. Outils vocaux : `analyser_le_code`, `chercher_dans_le_code`, `statut_git_du_projet`, `lancer_les_tests_du_projet`, `revue_du_code`.
- **Générateur de documents** : PDF (pagination automatique) et DOCX réels, générés à la voix (`generer_document`), dans `Documents\Mina Vision\`, jamais d'écrasement d'un fichier existant.
- **Lancement de n'importe quelle application Windows** (`launch_app` desktop) : nom d'application validé anti-injection, applications sensibles (terminaux, gestionnaires de mots de passe) bloquées au lancement comme au premier plan. Alias clavier menu Démarrer (Win, flèches) réparés.
- **Analyseur d'erreurs** : chaque erreur technique lue à la voix (`lire_erreurs_techniques`) est désormais accompagnée d'une explication et d'un remède concret en français, pas seulement un code brut.
- **Skills au format `.skill`** : l'installeur accepte l'extension `.skill` en plus de `.zip` ; convertisseur (`scripts/convert-claude-skill.mjs`) pour tout skill au format Claude → format Mina, empreinte de sécurité recalculée par le mécanisme officiel.
- **Fiabilité vocale** : reprise automatique de session (coupures Gemini Live), classification des coupures de connexion comme transitoires (retry automatique au lieu d'un échec instantané), lecture audio avec coussin anti-gigue (micro-coupures supprimées), latence des missions bureau divisée (délais clavier/souris par défaut écrasés, captures d'écran allégées 5×).
- **Mot d'arrêt vocal fiable** (« stop », « chut », « tais-toi », « silence ») : coupure de parole immédiate et garantie par le code, y compris en tout début de réponse.
- **Mode pause vocal** (« mets-toi en pause ») : silence total garanti par le code — audio, outils et routage coupés, voix ambiantes ignorées — jusqu'à ce que le nom « Mina » soit prononcé.
- **Coffre mémoire** : auto-réparation du chiffrement Windows (self-heal) au premier déverrouillage par phrase de récupération ; déverrouillage automatique à chaque démarrage, avec résultat journalisé.
- **Téléphone Android Samsung** en complément du Huawei USB : appairage Wi-Fi (`MINA_SAMSUNG_ADB_SERIAL`) avec repli sur la dernière adresse connue si l'annonce réseau reste muette, vérification d'identité systématique.

## Livré (gates automatisés franchis, 2026-07-15/16)

- **Noyau, grounding, sessions, mémoire/RAG, skills, sandbox** (plans v2) : capability broker, response gate anti-hallucination, mémoire courte/longue chiffrée avec RAG hybride lexical+vectoriel, MINA.md versionné, moteur de skills `SKILL.md`, exécution Windows Sandbox fail-closed.
- **Routage fournisseurs, modèles locaux, usage/budgets, voix locale** (plans v3) : `ProviderRegistry`/`CapabilityRouter` sans fournisseur cloud obligatoire, adaptateur DeepSeek v4, `BudgetGuard` unique, STT/TTS local interruptible.
- **Passerelle Android Kotlin** (`fr.mina.gateway`) : identité physique unique USB/LAN/Firebase, enveloppes chiffrées interopérables PC↔Android, SMS et Telegram sous frontières de capacité strictes (voir ci-dessous), Firebase en secours chiffré ≤ 24 h. 27 tests Kotlin unitaires, `BUILD SUCCESSFUL`, 0 erreur de lint.
- **Caméra Huawei et biométrie**, **e-mail** (Gmail/Microsoft/IMAP), **maison connectée** (Google Home/Home Assistant/MQTT, sous réserve du SDK Google Home posé par Nasro) : plans v3, gates automatisés franchis côté code ; validation matérielle réelle en attente d'action Nasro pour les tâches qui l'exigent explicitement.
- **Gouvernance des automatisations, mode ombre, recovery, laboratoire d'évaluation, santé** ; **organisation personnelle, routines, graphe de connaissance** ; **documents, impression, corpus d'urgence** ; **approbations distantes Samsung, connecteurs privés signés, personnalité isolée de la sécurité** (plans v4) : 4 plans complets, 40+40+35+40 tâches, suite complète verte à chaque clôture.
- **Intégration/durcissement v2** (ce plan) : composition root testée, routeur omnicanal + mémoire commune inter-canal, classification/rédaction de secrets avant tout appel modèle, journal d'audit chiffré chaîné par hash, rate-limiter/backpressure/arrêt d'urgence v2, durcissement Electron (CSP stricte, navigation/nouvelles fenêtres bloquées, permission handler restreint), 5 tests d'intégration, seuils de couverture 90 %/95 % vérifiés sur les nouveaux modules sécurité/audit/messagerie.

### Telegram — ce qui est réellement livré

Le canal Telegram décrit ci-dessous a été implémenté et passe ses gates (voir passerelle Android Kotlin ci-dessus + `src/messaging/telegram-approval-adapter.mjs`) :

- Conversation privée propriétaire uniquement (groupes/canaux/inconnus refusés).
- Mémoire et rappel autorisés par défaut ; `mail.*`, `home.read`, `home.low_risk` uniquement après activation locale explicite et scopée.
- Approbations one-shot distantes pour des actions **`remote_eligible`** explicitement qualifiées (fenêtre ≤ 5 minutes, digest lié à l'action exacte, jamais rejouable) — **`local_only` reste refusé à distance dans tous les cas**, sans exception. Ce n'est donc pas « toute approbation distante interdite » (texte de planification initial, maintenant dépassé sur ce point précis) mais une catégorie strictement bornée.
- Token stocké uniquement dans Android Keystore, jamais dans ce dépôt ; rotation/révocation disponibles depuis un écran local confirmé.
- Les bots Telegram ne sont pas E2EE et ne garantissent aucun accusé de lecture fiable — voir `docs/operations/TELEGRAM.md`.

### Telegram — évolution planifiée, non implémentée

Spécification d'origine (contexte historique) : [canal Telegram propriétaire et identité téléphonique](docs/superpowers/specs/2026-07-14-mina-telegram-identity-design.md).

#### Objectif initial

- Converser avec Mina depuis le téléphone dans une discussion privée Telegram.
- Retrouver la mémoire autorisée, demander un statut, terminer une session et préparer des brouillons.
- Reconnaître Nasro par son identifiant Telegram numérique et ses numéros SMS vérifiés.
- Interdire tout contrôle du PC, script, impression, fichier libre ou action sensible depuis Telegram.

#### Architecture téléphone-first

- Le service Android Mina sur le Huawei est l’unique consommateur des mises à jour du bot.
- Le token BotFather sera créé plus tard par Nasro, provisionné localement puis stocké dans Android Keystore.
- Les messages sont persistés dans une file Android chiffrée avant transfert.
- Ordre de transport vers le PC : USB, LAN, Firebase chiffré, puis attente locale.
- Firebase ne reçoit jamais le message Telegram en clair.
- Si le PC est hors ligne, le téléphone accuse réception et conserve le message ; la réponse utilisant mémoire et modèles attend le retour du PC.
- Si le téléphone est lui-même hors ligne, la rétention des mises à jour dépend de Telegram et n’est pas garantie au-delà de 24 heures.

#### Appairage propriétaire

- QR code ou lien local avec jeton unique valable 10 minutes.
- Liaison à l’identifiant Telegram numérique dans une conversation privée ; le `@username` n’est pas une identité fiable.
- Partage volontaire du contact Telegram puis normalisation du numéro au format E.164.
- Vérification croisée par code à six chiffres envoyé par SMS au Huawei depuis le numéro à reconnaître.
- Alternative si l’envoi à soi-même est impossible : contact Telegram partagé, Huawei physiquement appairé et confirmation locale sur le PC.
- Plusieurs numéros propriétaires pourront être ajoutés ultérieurement par la même procédure.

#### Capacités de la première version

- messages texte ;
- notes vocales transcrites localement ;
- réponses texte de Mina ;
- commandes `/status`, `/memory`, `/forget`, `/end` et `/help` ;
- session de travail clôturée par `/end` ou après 30 minutes d’inactivité ;
- continuité entre sessions par la mémoire locale chiffrée ;
- statuts factuels soumis au moteur de grounding et aux preuves disponibles.

#### Sécurité

- Conversation privée propriétaire uniquement ; groupes, canaux et utilisateurs inconnus refusés.
- Déduplication par identifiant de mise à jour et file d’envoi idempotente.
- Limites de fréquence, taille et durée ; coupe-circuit commun à Mina.
- Aucun skill depuis SMS ; sur Telegram, skills conversationnels et mémoire autorisée uniquement.
- Aucun accès Telegram à la souris, au clavier, aux fichiers libres, au navigateur actif, à la caméra, au téléphone, à l’impression, à la sandbox ou à l’export.
- Token absent du code, de Git, de `MINA.md`, des logs et de la mémoire conversationnelle.
- Rotation ou révocation du token disponible depuis une procédure locale confirmée.
- Les bots Telegram ne fournissent pas de chiffrement de bout en bout ; Telegram voit le contenu échangé avec le bot.

#### Validation avant livraison

- Tests avec un bot Telegram de test distinct du bot final.
- Firebase Emulator et transports USB/LAN factices pour les tests automatisés.
- Tests d’identité, rejeu, quotas, messages dupliqués, téléphone/PC hors ligne et reprise.
- Tests prouvant l’impossibilité d’utiliser un outil PC ou la sandbox depuis Telegram.
- Validation supervisée sur le Huawei avec données non sensibles.
- Aucun statut « livré » avant suite automatisée verte et scénario réel supervisé réussi.

#### Évolutions ultérieures soumises à une nouvelle validation

- réception de photos ou documents après analyse de contenu, limites et confirmation ;
- réponses vocales générées par Mina ;
- gestion de plusieurs appareils Telegram propriétaires ;
- notifications configurables par sujet et niveau d’urgence ;
- mode cloud lorsque PC et téléphone sont hors ligne, uniquement après une nouvelle décision de confidentialité ;
- extension du périmètre d'approbation distante au-delà des actions `remote_eligible` déjà livrées (voir § Telegram — ce qui est réellement livré) — `local_only` restera refusé à distance dans tous les cas, quelle que soit une évolution future.

## Livré (2026-07-23 — application Mina sur téléphone, conversation chiffrée de bout en bout)

Une application Android permet désormais d'écrire à Mina depuis un téléphone appairé. Le canal
`mina_app` est autorisé par la constitution (MINA.md) pour **conversation, mémoire et médias
uniquement** — aucune action externe implicite.

- **Appairage explicite** : un téléphone ne parle à Mina que si Nasro a ouvert l'appairage sur
  le PC et saisi un code à 6 chiffres — à usage unique, valable 5 minutes, 5 tentatives
  maximum. Être sur le même Wi-Fi ne suffit pas.
- **Clé de conversation jamais transmise** : elle est enveloppée par une clé dérivée en ECDH
  P-256 à partir des identités des deux appareils. Un observateur du réseau qui capture tout
  l'appairage ne peut pas la reconstituer. L'interopérabilité Node ↔ Kotlin est verrouillée par
  un vecteur de test partagé, lu par les deux plateformes.
- **Vérifier avant de déchiffrer** : la signature de chaque événement est contrôlée avant toute
  tentative de déchiffrement, et le contexte (fil, expéditeur, époque, dates) est lié au
  chiffrement — déplacer un message chiffré vers un autre en-tête casse au lieu de passer
  inaperçu.
- **Le téléphone ne stocke que du chiffré** : la base locale (Room) ne contient aucun texte en
  clair. Coffre verrouillé, l'application affiche « verrouillé » au lieu d'un contenu inventé.
- **PC éteint = message en attente, pas message perdu** : une file d'envoi durable garde le
  message et l'envoie au retour du PC. Personne ne répond à la place de Mina. Après 12 essais
  espacés, l'échec est affiché plutôt qu'une file qui tourne en silence.
- **Une seule réponse par question** : un message livré deux fois ne déclenche qu'une
  génération, et le registre PC survit à un redémarrage — un message redélivré ne reçoit pas une
  seconde réponse, différente de la première.
- **Mémoire verrouillée = canal fermé**, annoncé tel quel dans l'onglet Système. Les clés de
  conversation dérivent du coffre : Mina ne répond pas depuis le téléphone avec une mémoire
  amputée.
- **Révocation** : retirer un appareil ouvre une nouvelle époque de clé — il ne lit plus les
  messages suivants. On ne prétend pas effacer ce qu'il a déjà lu.
- **Dictée** : le message peut être dicté ; la reconnaissance est locale au téléphone, et le
  texte dicté est chiffré comme tout autre message. Sans moteur de reconnaissance sur
  l'appareil, l'application le dit au lieu d'afficher un micro inerte.
- **Notification** à l'arrivée d'une réponse, uniquement quand l'écran de conversation n'est pas
  déjà affiché.

Vérifié par exécution réelle : 2 911 tests unitaires + 48 tests d'intégration Node, 55 tests
Kotlin, APK debug assemblée, et démarrage Electron réel confirmant le canal ouvert
(`chat_app_canal listening:true port:8771`).

Deux défauts n'ont été trouvés que par exécution réelle, jamais par les tests unitaires : la
bibliothèque WebSocket réémet les erreurs du serveur HTTP sur une autre instance (un port occupé
tuait le processus), et Room nomme ses colonnes d'après le champ Kotlin si on ne l'annote pas.

## Livré (2026-07-23 — app Windows complétée, licence, préparation GitHub)

- **Démarrage automatique avec Windows** (manque signalé par Nasro) : case dans **Config → Système Windows**. API Electron officielle (clé de démarrage de la session courante — aucune tâche système, aucune élévation), lancement discret, réversible en un clic. Fail-loud : si Windows n'applique pas le réglage, Mina le dit au lieu de faire semblant.
- **Catalogue de capacités visible** : les 20 domaines publiés par le runtime (créés la veille) n'étaient exposés dans aucune interface. Ils s'affichent désormais avec leur état réel — disponible / dégradé / indisponible — et la dépendance manquante nommée.
- **Domaines livrés mais invisibles, rendus accessibles** : un audit outillé des 124 méthodes du preload a montré que 50 n'étaient jamais appelées par l'interface. Ajoutés : **e-mail** (comptes, recherche), **organisation personnelle** (briefing du jour, tâches, routines, contacts), **impression** (détection, autorisation, envoi d'un fichier), **maison connectée** (appareils, santé des connecteurs, exécution d'une commande), **personnalité**, et le **droit à l'oubli** de la mémoire — suppression définitive propagée aux sauvegardes, sous confirmation locale. Chaque panneau affiche « Indisponible — raison » plutôt qu'une liste vide trompeuse.
- **Licence de protection du nom** : [LICENSE](LICENSE) — usage, étude, modification et redistribution libres, mais les noms « Mina », « Mina Vision » et « Nasserallah Berkoun » ne peuvent être ni retirés, ni remplacés, ni détournés ; une œuvre dérivée publiée doit porter un nom distinct et créditer l'origine ; toute violation résilie les droits. Quatre tests verrouillent la clause.
- **Portabilité (bloquant pour une publication mondiale)** : des chemins d'un disque secondaire étaient en dur dans le code — l'application n'aurait pas démarré sur une autre machine. Tout vit désormais sous le dossier utilisateur par défaut, avec des variables pour déporter les caches lourds.
- **Audit de confidentialité** : [docs/operations/AUDIT-PRE-PUBLICATION.md](docs/operations/AUDIT-PRE-PUBLICATION.md) — 945 fichiers suivis analysés, aucun secret réel, données personnelles anonymisées, prototypes morts dépubliés.
- **Chat natif Android** : constitution amendée (canal `mina_app` autorisé par Nasro) et modules Android `core:chat` / `feature:chat` / `feature:voice` déclarés. Le reste du chantier (protocole, crypto, transport, Firebase) reste à construire — le canal est inactif tant que le code runtime ne le branche pas.

## En attente côté Nasro (actions et décisions — consigné ICI, pas dans un fichier séparé)

- **Application téléphone — premier appairage** : ouvrir l'appairage dans *Configuration &
  mémoire* › *Système Windows*, installer l'APK (`android/app/build/outputs/apk/debug/`) sur le
  téléphone, puis saisir l'adresse du PC (IP locale) et le code affiché. L'APK n'a été installée
  sur aucun appareil : la décision d'installer reste à Nasro.
- **Pare-feu Windows** : autoriser le port `8771` sur le réseau privé, sinon le téléphone ne
  joindra pas le PC (l'application affichera « PC injoignable », ce qui sera exact).


### Publication GitHub

- **Créer le dépôt GitHub** et le connecter (`git remote add origin …`). Le dépôt est local, sans remote : aucun push n'est possible tant que tu ne le fais pas.
- **Vérifier le nom d'utilisateur des commits** : l'historique porte ton nom et ton adresse e-mail réelle. Si tu ne veux pas exposer cette adresse publiquement, configure une adresse GitHub `noreply` **avant** le premier push.
- ~~Décider du sort des plans internes~~ : **fait le 2026-07-23** — `docs/superpowers/plans/`, `specs/` et `EXECUTION-LOG.md` sont exclus de la publication (43 fichiers retirés du suivi git, conservés sur ton disque).
- ~~Modèles volumineux~~ : **vérifié le 2026-07-23** — le dépôt suivi pèse 2,3 Mo au total ; les fichiers `config/models/*.json` sont des descripteurs (id, source, licence), pas des poids, et la voix locale `assets/voices/ff_siwis.bin` fait 510 Ko. Rien à exclure.


> Décision Nasro 2026-07-22 : `Pour Nasro.md` est réservé aux AUTRES projets — pour Mina
> Vision, tout ce qui attend une action ou une décision de Nasro vit dans CE changelog.

### Actions immédiates

- Relancer Mina proprement : fermer TOUTES les fenêtres Mina d'abord, attendre ~5 secondes,
  puis `Lancer Mina.cmd` (deux instances simultanées = fenêtre « Initialisation » morte,
  verrou single-instance). L'incident ACL du 2026-07-22 est réparé et le durcissement
  automatique retiré du boot.
- Vérifier à l'usage qu'une mission ordinaire ne demande PAS plus de confirmations qu'avant
  (seules les actions sensibles en demandent, liées à l'action exacte). Un dialogue sur un
  simple clic = bug de calibrage à me signaler.

### Décisions en attente

- **Racines de lecture** : Mina ne lit librement que le projet et `Documents\Mina Vision` ;
  autre dossier = confirmation par fichier. Dossiers de confiance permanents →
  `MINA_APPROVED_READ_ROOTS` (chemins séparés par `;`).
- **Anciens transcripts en clair** : `logs/activity-*.jsonl` antérieurs au 2026-07-22
  s'auto-purgent d'ici au 2026-07-29 (rétention 7 jours). Purge immédiate sur demande.
- **mythos.skill** : clic final d'installation dans le panneau Skills (staging + audit faits).
- **MCP Mina ↔ Claude** (pont de test) : design prêt, en attente du « vas-y ».
- **5 outils vocaux** de l'analyse d'écart (chercher_souvenirs, briefing_du_jour,
  piloter_maison, combien_ca_coute/sante_technique, imprimer_document) : en attente du « vas-y ».
- **Idées extensions VS Code** validées : LM Studio provider texte 100 % local ; accept/reject
  par hunk dans le diff ; mode « réseau coupé » par mission code ; profils de rôle. Dire
  lesquelles.
- **Profil navigateur legacy `profiles/`** (150 Mo, dernier usage 18/07, aucune base Chromium
  détectée à la racine) : archiver en quarantaine récupérable ou garder ? Voir
  [docs/operations/BROWSER-PROFILE-MIGRATION.md](docs/operations/BROWSER-PROFILE-MIGRATION.md).
- **Domaines publiés « indisponibles »** au catalogue (automation, recovery, evaluation,
  emergency, approvals PC, connectors — leurs dépendances runtime n'existent pas dans le code,
  chacune nommée dans la raison) : dire si on IMPLÉMENTE ces dépendances (vrai chantier par
  domaine) ou s'ils restent honnêtement indisponibles.

### Vigilance permanente

- **espeak-ng est GPL-3.0** : zéro obligation tant que Mina Vision reste privée ; AVANT toute
  distribution, relire [docs/LICENCES.md](docs/LICENCES.md) §1.
- **Dépôt git local** depuis le 2026-07-22 (1 tâche = 1 commit, aucun remote — `git push`
  impossible par construction). Revenir en arrière = demander le revert.

### Validation matérielle (code/tests livrés, preuve physique non faite)

- SDK Google Home 1.9 à déposer ; validation matérielle maison connectée (Huawei + lumière réelle).
- Validation matérielle caméra (flux visible, coupure USB < 10 s).
- Pairing USB+LAN réel de la passerelle Android (installation APK + activation debug Wi-Fi volontaire).
- Comptes de test e-mail réels (Gmail/Microsoft/IMAP).
- Token BotFather réel pour le canal Telegram propriétaire.
- Activation Windows Sandbox (virtualisation firmware + fonctionnalité Windows).
