# Changelog Mina

Ce fichier distingue strictement les capacités livrées (tests automatisés verts, gate du plan correspondant franchi) des évolutions encore planifiées. Une capacité ne passe de « Planned » à « Livré » que lorsque son plan d'exécution est intégralement coché avec preuve réelle (`docs/superpowers/EXECUTION-LOG.md`) — jamais par anticipation. Les entrées ci-dessous du 2026-07-22 ont été livrées hors de ce processus de plans formels (demandes directes de Nasro, TDD et vérification réelle à chaque étape) ; elles ne figurent donc pas dans `EXECUTION-LOG.md`, propre aux plans de `docs/superpowers/plans/`.

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

## En attente de validation matérielle (code/tests livrés, preuve physique non faite)

Ces éléments ont un code testé et des gates automatisés verts, mais nécessitent une action physique de Nasro non encore réalisée — voir `Pour Nasro.md` :

- SDK Google Home 1.9 à déposer ; validation matérielle maison connectée (Huawei + lumière réelle).
- Validation matérielle caméra (flux visible, coupure USB < 10 s).
- Pairing USB+LAN réel de la passerelle Android (installation APK + activation debug Wi-Fi volontaire).
- Comptes de test e-mail réels (Gmail/Microsoft/IMAP).
- Token BotFather réel pour le canal Telegram propriétaire.
- Activation Windows Sandbox (virtualisation firmware + fonctionnalité Windows).
