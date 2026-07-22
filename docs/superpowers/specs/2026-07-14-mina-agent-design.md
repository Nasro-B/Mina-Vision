# Mina — agent visuel local

## Objectif

Transformer `Mina Vision` en agent local multimodal nommé **Mina**, lancé à la demande par un raccourci Windows. Mina reçoit des objectifs à la voix ou par une interface visible, observe l’écran et la caméra d’un Huawei P30 lite connecté par USB, puis contrôle les interfaces autorisées de façon autonome avec confirmations obligatoires pour les actions sensibles.

Le produit conserve la mission métier existante de tri d’assets dentaires dans Google Photos et ajoute un mode général de contrôle visuel.

## Périmètre fonctionnel

### Lancement et arrêt

- Mina ne démarre jamais avec Windows.
- Un raccourci lance l’application locale et son interface visible.
- Fermer l’application coupe le micro, la caméra et toute automatisation.
- `Ctrl+Alt+Échap` interrompt immédiatement la mission et désactive les entrées automatisées.
- La commande « Mina, arrête » interrompt la mission courante sans fermer l’application.

### Identité et voix

- Nom de l’agent : **Mina**.
- Phrases d’activation reconnues :
  - « Salut Mina » ;
  - « Bonjour Mina » ;
  - « Mina, comment ça va ? ».
- Après activation, Mina confirme vocalement qu’elle écoute, reçoit l’objectif, puis annonce le résultat ou le blocage.
- Les conversations audio transitent uniquement pendant une session active. Aucun audio n’est enregistré sur disque par défaut.

### Interface

L’interface propose trois actions principales :

1. **Agent général** ;
2. **Tri Google Photos** ;
3. **Arrêter**.

Elle affiche l’état courant : inactif, écoute, analyse, action, confirmation requise, terminé ou erreur. Un journal borné montre les intentions et résultats sans secrets, contenu de mots de passe ni images persistantes.

### Mode Agent général

Mina suit une boucle bornée : capture de l’environnement, décision Gemini, contrôle de sécurité, action locale, vérification visuelle. Elle peut cliquer, double-cliquer, déplacer le pointeur, scroller, sélectionner, saisir du texte et utiliser des raccourcis autorisés.

Les appareils de la maison utilisent une surface séparée et allowlistée, définie dans [Mina — maison connectée locale et Google Home](2026-07-14-mina-smart-home-design.md). Un modèle ne contrôle jamais directement le réseau ou un appareil.

La mission s’arrête lorsque l’objectif est atteint, après trois erreurs consécutives, après dépassement de la durée ou du nombre maximal d’actions, sur décision de sécurité bloquante, ou sur demande de Nasro.

### Mode Tri Google Photos

Mina ouvre un profil Chrome dédié et authentifié par Nasro, puis :

1. accède à la recherche Google Photos dentaire ;
2. ignore la section « les plus pertinents » selon une règle explicitement testée ;
3. analyse les miniatures visibles sans doublons ;
4. classe chaque asset OUI/NON selon les critères Sourire Concept ;
5. sélectionne les correspondances ;
6. demande confirmation avant tout téléchargement ;
7. fournit le nombre d’assets analysés, retenus, rejetés et en erreur.

Le premier test réel est limité à un petit lot et ne télécharge rien.

## Architecture

### Application locale

Une interface Electron pilote un orchestrateur Node.js. Les composants sont isolés derrière des interfaces stables :

- `config` : validation de la configuration et des secrets ;
- `voice` : détection des phrases d’activation, session Gemini Live et restitution audio ;
- `orchestrator` : machine à états, budgets d’actions et cycle de mission ;
- `computer-use` : dialogue avec Gemini Computer Use et validation des actions proposées ;
- `browser-executor` : actions Chrome via Playwright ;
- `desktop-executor` : actions Windows locales autorisées ;
- `phone-bridge` : détection ADB, lancement et supervision de `scrcpy` pour l’écran ; bridge CameraX dédié pour le capteur du Huawei Android 10 ;
- `dental-vision` : classification métier et chaîne de secours ;
- `safety` : politiques bloquantes et confirmations ;
- `ui` : menu, états, confirmations et arrêt d’urgence.

### Modèles et routage

Le routage cloud/local, les moteurs spécialisés, DeepSeek, LM Studio et la page de paramètres sont définis dans [Mina — moteurs locaux spécialisés, routage dynamique, voix et paramètres](2026-07-14-mina-local-model-runtime-settings-design.md). Cette spécification remplace l’hypothèse d’un contrôle nécessairement distant : en `local-only`, un planificateur vision local utilise le même broker d’actions et les mêmes confirmations.

- **Décision et contrôle principal en `auto`** : Gemini avec Computer Use et détection d’injection visuelle activée, puis planificateur vision local selon le routeur validé.
- **Audio** : STT/TTS local par défaut ; Gemini Live reste un fournisseur optionnel lorsque le preset et la confidentialité l’autorisent.
- **Classification dentaire principale** : Gemini.
- **Secours classification** : OpenRouter, puis Modal si l’endpoint et son authentification ont été validés.
- OpenRouter et Modal ne prennent jamais le contrôle direct du poste dans la première version.

Une réponse invalide, ambiguë ou vide produit un échec sûr ; elle n’est jamais interprétée comme une autorisation d’agir.

### Flux d’une action

1. Nasro donne un objectif par la voix ou l’interface.
2. L’orchestrateur capture uniquement l’environnement nécessaire.
3. Gemini retourne une intention et une action structurée.
4. Le moteur de sécurité classe l’action : autorisée, confirmation requise ou interdite.
5. L’exécuteur concerné réalise au maximum une unité d’action atomique.
6. Une nouvelle capture vérifie le résultat.
7. La boucle continue dans les budgets configurés ou s’arrête proprement.

## Sécurité

### Actions exigeant toujours une confirmation

- suppression ou déplacement destructif de données ;
- upload ou téléchargement ;
- envoi de message, publication ou formulaire représentant Nasro ;
- achat, abonnement ou transaction financière ;
- authentification, saisie ou sauvegarde de mot de passe ;
- modification de permissions ou de paramètres système ;
- installation ou exécution d’un logiciel nouvellement téléchargé ;
- accès ou transmission d’informations sensibles.

### Applications et zones interdites

- gestionnaires de mots de passe ;
- Sécurité Windows et antivirus ;
- terminaux et consoles de commande pilotés par l’interface ;
- écrans de paiement sans confirmation explicite ;
- toute interface que la politique Gemini bloque.

### Données et secrets

- Aucun secret n’est commité, journalisé ou affiché.
- `.env` reste local et doit être couvert par `.gitignore` avant toute initialisation Git.
- Les valeurs Gemini, OpenRouter et Modal actuellement présentes doivent être **rotées** avant le premier lancement, car elles ont été exposées dans une sortie technique de cette session.
- Les captures écran, webcam et audio ne sont pas persistées par défaut.
- Les requêtes distantes envoient uniquement les données nécessaires à la mission active.

## Gestion des erreurs

- Caméra absente : Mina passe en mode écran uniquement et l’indique.
- Téléphone ADB non autorisé : aucune tentative de contournement ; instruction de déverrouillage affichée.
- `scrcpy` interrompu : une relance maximum, puis arrêt du canal caméra.
- Réseau absent : les capacités locales validées continuent ; seules les étapes exigeant réellement le réseau sont suspendues.
- Quota Gemini : classification dentaire vers OpenRouter puis Modal selon le preset ; Computer Use vers le planificateur vision local validé, sinon suspension explicite.
- Erreur d’exécution : vérification visuelle, une correction maximum, puis compteur d’échecs.
- Trois échecs consécutifs : arrêt sûr et diagnostic visible.
- Fenêtre ou contexte inattendu : aucune coordonnée ancienne n’est réutilisée.

## Tests et critères d’acceptation

### Tests automatisés

- validation de configuration sans divulgation de secret ;
- machine à états et budgets d’actions ;
- reconnaissance des trois phrases d’activation et rejet des faux positifs ;
- routage Gemini → OpenRouter → Modal pour la classification uniquement ;
- parsing strict OUI/NON ;
- blocage et confirmation des catégories sensibles ;
- traduction des actions Gemini vers chaque exécuteur ;
- déduplication et progression du tri Google Photos ;
- déconnexion/reconnexion caméra, ADB et `scrcpy` ;
- absence de persistance des captures et de données sensibles dans les logs.

### Validation intégrée

- suite existante lancée avant modification ; elle est actuellement absente et doit être créée avant le code comportemental ;
- chaque comportement est introduit par un test qui échoue puis passe ;
- test du raccourci d’arrêt d’urgence ;
- test navigateur sur une page locale contrôlée ;
- test Google Photos limité, supervisé et sans téléchargement ;
- test caméra du téléphone avec aperçu visible ;
- lancement final uniquement lorsque toute la suite est verte.

### Définition de terminé

Mina est considérée prête lorsque le raccourci lance l’interface, que les trois phrases l’activent, qu’une mission locale non sensible peut être exécutée et vérifiée, que le tri limité fonctionne sans téléchargement, que les confirmations bloquent réellement les actions sensibles, que l’arrêt d’urgence fonctionne et que les tests sont verts.

## Hors périmètre initial

- démarrage automatique avec Windows ;
- surveillance permanente ou en arrière-plan ;
- enregistrement audio/vidéo ;
- contrôle autonome de transactions, messages ou suppressions ;
- déploiement ou modification automatique du service Modal ;
- application mobile dédiée ;
- contrôle distant du poste ; le canal conversationnel Telegram est conçu séparément et ne possède aucun exécuteur PC.

## Contraintes de livraison

- Le projet n’est actuellement pas un dépôt Git ; aucune initialisation ou publication distante n’est implicite.
- Aucun `git push` ni déploiement Modal/Vercel n’est autorisé sans ordre explicite.
- Les changements doivent être minimaux, testés avant et après, et ne doivent pas détruire le comportement métier existant.
