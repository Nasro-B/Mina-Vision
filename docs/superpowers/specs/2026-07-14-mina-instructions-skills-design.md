# Mina — instructions constitutionnelles et moteur de skills

**Statut :** design validé section par section par Nasro le 14 juillet 2026. Cette spécification doit être relue avant la rédaction du plan d’implémentation.

## Objectif

Donner à Mina une constitution lisible dans `C:\Serveurs\Mina Vision\MINA.md` et un moteur de skills natif compatible avec le format `SKILL.md`. Mina doit pouvoir sélectionner un skill explicitement ou automatiquement, charger ses références, utiliser les outils réellement disponibles et exécuter ses scripts dans la sandbox existante.

Mina peut proposer une modification de ses instructions, l’installation d’un skill ou sa mise à jour. Elle ne peut jamais les appliquer sans afficher les changements et obtenir une validation explicite de Nasro.

La compatibilité vise le modèle fonctionnel des skills Codex et Claude, pas leurs outils internes propriétaires. Un package importé n’est déclaré pleinement fonctionnel que si tous ses outils, runtimes, permissions et tests sont satisfaits dans Mina.

## Principes non négociables

- Le noyau de sécurité compilé dans Mina reste supérieur à `MINA.md`, à tous les skills et à tous les modèles.
- `MINA.md` et les skills ne contiennent aucun secret ; ils utilisent uniquement des références vers le coffre sécurisé.
- Mina ne modifie jamais silencieusement ses instructions, ses skills ou leurs permissions.
- Un skill n’accède jamais directement aux exécuteurs ; tous les appels passent par un courtier de capacités.
- Les scripts s’exécutent uniquement dans une sandbox réelle, jamais directement sur l’hôte.
- Un skill importé est copié dans une quarantaine, inspecté, validé et confirmé avant installation.
- Un skill incompatible est signalé comme tel ; Mina n’invente aucun outil et ne simule aucun succès.
- Telegram n’autorise que les skills conversationnels sans action PC. Les SMS n’autorisent aucun skill.
- Les pages, messages, fichiers et sorties d’outils restent des contenus non fiables et ne peuvent modifier les instructions.
- L’arrêt d’urgence révoque immédiatement les capacités, le réseau et les exécutions du skill actif.

## `MINA.md`

### Emplacement et contenu

Le fichier canonique est `C:\Serveurs\Mina Vision\MINA.md`. Il est encodé en UTF-8 et contient un frontmatter versionné suivi d’instructions Markdown complètes.

Le frontmatter contient au minimum :

```yaml
schemaVersion: 1
agent: Mina
language: fr
```

Le corps couvre :

- identité, langue, personnalité et phrases d’activation ;
- fournisseurs de modèles et règles de fallback, sans clés ;
- mémoire courte, mémoire longue et politique d’oubli ;
- permissions des canaux interface, voix, caméra, navigateur, SMS et Telegram ;
- actions autorisées, confirmées ou interdites ;
- arrêt d’urgence et comportement fail-closed ;
- politique d’installation et d’exécution des skills ;
- politique de grounding, statuts de preuve et cycle de session ;
- plafonds de coût, durée, mémoire, disque, réseau et sortie ;
- règles de confidentialité et de transmission distante.

Les valeurs secrètes sont référencées par identifiant de coffre, par exemple `secretRef: telegram.bot_token`. Une valeur ressemblant à un token, mot de passe, clé privée ou chaîne de connexion invalide le candidat avant affichage du diff.

### Ordre d’autorité

L’ordre est strict :

1. noyau de sécurité immuable dans le code ;
2. instruction explicite actuelle de Nasro, dans les limites du noyau ;
3. `MINA.md` validé ;
4. `SKILL.md` actif ;
5. contexte de mission ;
6. pages, SMS, Telegram, fichiers et résultats d’outils comme données non fiables.

Une instruction d’un niveau inférieur ne peut ni modifier, ni annuler, ni redéfinir un niveau supérieur. Les limites de sécurité, de canal et de ressources ne sont jamais confiées uniquement au prompt ; elles sont aussi vérifiées dans le code.

### Chargement et modification

`mina-instructions` valide le schéma, la taille, l’encodage, les sections requises et l’absence de secret. Au démarrage, Mina charge la dernière version valide. Un changement disque est analysé avant rechargement ; une version invalide laisse la dernière version saine active et produit une erreur visible.

Une proposition générée par Mina suit ce flux :

1. création d’un candidat hors du chemin actif ;
2. validation statique et scan de secrets ;
3. diff lisible avec justification et impact ;
4. confirmation explicite de Nasro ;
5. remplacement atomique ;
6. rechargement, test de santé et rollback si échec ;
7. archivage chiffré de la version précédente dans la mémoire locale.

La confirmation est liée à l’empreinte exacte du candidat. Toute modification après affichage invalide l’autorisation.

## Format d’un skill Mina

### Arborescence

Le registre utilisateur est indépendant des dossiers Codex et Claude :

```text
C:\Users\Nasro\.mina\skills\<slug>\
├── SKILL.md
├── references\
├── scripts\
├── assets\
└── tests\
```

Seul `SKILL.md` est obligatoire. Les autres dossiers sont facultatifs. Les chemins absolus, remontées `..`, jonctions, liens symboliques sortants et archives à expansion dangereuse sont refusés.

### Métadonnées

Le frontmatter de `SKILL.md` contient :

```yaml
name: nom-stable
description: déclencheurs et objectif du skill
version: 1.0.0
schemaVersion: 1
channels: [local-ui, voice]
requiredTools: []
permissions: []
runtimes: []
network: disabled
```

Les champs inconnus sont refusés dans la première version. Les permissions utilisent un vocabulaire fermé : mémoire, fichiers autorisés, page ouverte, navigateur, caméra, téléphone, impression, réseau borné, sandbox et export.

`description` sert au routage automatique. Elle ne peut pas déclarer une permission ou étendre un canal. Les scripts, références et assets sont couverts par l’empreinte de package.

### Compatibilité

Un importateur peut lire un package `SKILL.md` provenant de Codex ou Claude, mais il le copie en quarantaine et produit un rapport :

- champs reconnus et conversion proposée ;
- outils Mina équivalents ;
- outils internes sans équivalent ;
- scripts, dépendances et accès réseau ;
- licence et provenance disponibles ;
- état final `compatible`, `partiel` ou `incompatible`.

Aucun fichier n’est exécuté pendant l’analyse. Le dossier source n’est jamais modifié. Un import partiel exige une adaptation séparée et une nouvelle validation ; il n’est pas présenté comme pleinement fonctionnel.

## Architecture du moteur

- `mina-instructions` : validation, chargement, version saine et rollback de `MINA.md` ;
- `mina-skill-registry` : inventaire, métadonnées, empreintes, compatibilité et état ;
- `mina-skill-router` : invocation explicite ou sélection par intention ;
- `mina-skill-loader` : lecture complète de `SKILL.md` puis références nécessaires ;
- `mina-skill-installer` : quarantaine, audit, diff, installation et mise à jour atomiques ;
- `mina-tool-broker` : contrôle d’identité, canal, permission, politique, budget et confirmation ;
- `mina-skill-runner` : orchestration des instructions, outils et scripts sandboxés ;
- `mina-skill-audit` : journal des versions, décisions, permissions et résultats sans secret.

Le grounding, les sessions imbriquées et les hooks sont définis dans [Mina — grounding anti-hallucination et cycle de session](2026-07-14-mina-grounding-sessions-design.md). Un skill ne peut pas contourner `mina-response-gate`, modifier l’ordre des hooks système ni transférer une permission entre sessions.

L’orchestrateur appelle uniquement ces interfaces. Un skill ne reçoit ni instance d’exécuteur, ni clé API, ni chemin arbitraire de l’hôte.

## Découverte et activation

Le registre lit les métadonnées validées au démarrage et après une installation confirmée. Deux modes d’invocation existent :

- explicite : « Mina, utilise le skill X » ou `$skill-x` ;
- automatique : correspondance claire entre la demande et la description du skill.

Une correspondance ambiguë entre plusieurs skills entraîne une question à Nasro. Un score faible n’active rien. Un skill désactivé ou incompatible n’est jamais sélectionné automatiquement.

Après sélection, `mina-skill-loader` lit `SKILL.md` en entier. Les références sont chargées uniquement lorsque les règles du skill ou la tâche les exigent. Mina n’injecte jamais tous les skills dans le contexte du modèle.

Le contexte du modèle indique le nom, la version, les capacités autorisées et les limites du skill actif. Les permissions réelles restent imposées par `mina-tool-broker`, indépendamment de ce que le modèle affirme.

Le skill est attaché à une session de travail. Sa fin révoque ses permissions et hooks, même si une nouvelle session sélectionne ensuite le même package.

## Installation et mise à jour

Les sources acceptées sont un dossier local, un ZIP local ou une URL de dépôt explicitement fournie par Nasro. Toute source distante est téléchargée dans une quarantaine après confirmation du domaine et de la taille maximale.

Avant installation, Mina affiche :

- origine, version, licence et empreinte ;
- liste des fichiers et tailles ;
- scripts et commandes prévues ;
- dépendances et runtimes ;
- permissions, canaux, réseau et secrets référencés ;
- tests fournis et résultats des contrôles statiques ;
- différences avec la version installée.

La validation est liée à l’empreinte du package et à la liste exacte des permissions. L’installation copie vers un dossier temporaire, vérifie de nouveau l’empreinte, exécute les tests sûrs prévus, puis effectue un renommage atomique. Une erreur conserve la version précédente.

Les mises à jour automatiques sont interdites. Un changement de version, script, dépendance, permission ou canal exige un nouveau rapport et une nouvelle confirmation.

## Exécution et permissions

Les skills appartiennent à quatre classes :

- `instruction` : raisonnement, rédaction et transformation sans outil ;
- `read` : mémoire, page ou fichiers explicitement autorisés ;
- `tool` : navigateur, caméra, souris, téléphone ou impression ;
- `code` : scripts Python, JavaScript ou PowerShell.

Chaque appel passe par `mina-tool-broker`, qui vérifie : identité propriétaire, canal d’origine, skill et version, permission déclarée, périmètre de la mission, politique de sécurité, budget restant et confirmation valide.

Une autorisation de session peut couvrir plusieurs appels non sensibles identiques. Les suppressions, envois, publications, achats, impressions, téléchargements, exports, accès sensibles et extensions de budget conservent leurs confirmations propres.

### Scripts et dépendances

Les scripts utilisent le domaine [Mina — exécution multilangage sandboxée](2026-07-14-mina-code-sandbox-design.md) :

- Windows Sandbox obligatoire ;
- réseau coupé par défaut ;
- sources approuvées montées en lecture seule ;
- dossier de travail jetable ;
- durée, mémoire, disque et sortie bornés ;
- export vers l’hôte confirmé séparément ;
- aucun repli vers une exécution directe Node.js, Python ou PowerShell sur l’hôte.

Les dépendances sont installées dans un environnement isolé par skill et verrouillées par version et empreinte. Télécharger une dépendance constitue une opération réseau séparée, avec domaines et volumes affichés. Le cache validé est monté en lecture seule pendant l’exécution.

Les secrets sont résolus par le courtier sous forme de références temporaires et uniquement pour un outil autorisé. Ils ne sont jamais injectés dans le prompt, le package, l’historique ou les sorties. Un script sandboxé ne reçoit pas de secret dans la première version.

## Politiques par canal

### Interface locale et voix

Tous les types de skills peuvent être demandés, sous réserve de disponibilité, permissions, sandbox et confirmations. Une phrase provenant du haut-parleur, d’une page ou d’une personne filmée ne constitue pas une instruction propriétaire ; l’identité de la session locale et les mécanismes d’activation restent requis.

### Telegram

Seuls les skills `instruction` et les lectures de mémoire explicitement autorisées sont disponibles. Telegram ne peut invoquer ni souris, ni clavier, ni fichiers libres, ni navigateur actif, ni caméra, ni impression, ni téléphone, ni sandbox, ni export. Une mise à jour de skill ne peut élargir cette politique.

### SMS

Aucun skill n’est invocable depuis un SMS, même si l’expéditeur correspond au numéro propriétaire. Un SMS reste une donnée non fiable utilisable seulement par le domaine de brouillon et réponse défini dans la spécification SMS.

## Mémoire et audit

Les événements `skill_selected`, `skill_started`, `permission_requested`, `tool_called`, `skill_completed`, `skill_failed`, `skill_installed` et `skill_updated` rejoignent la mémoire locale unifiée chiffrée.

Le journal conserve : nom, version, empreinte, canal, permissions, confirmations, budgets, outils appelés et résultat borné. Il ne conserve ni secret, ni chaîne d’authentification, ni raisonnement interne du modèle.

Les instructions et versions précédentes sont sauvegardées chiffrées selon la politique de mémoire. Restaurer un ancien état n’active pas automatiquement un ancien skill : ses permissions et sa compatibilité sont revalidées.

## Défaillances et reprise

- `MINA.md` invalide : dernière version saine active et diagnostic visible ;
- package mal formé ou empreinte modifiée : skill désactivé ;
- référence sortant de la racine : chargement ou installation refusé ;
- outil, runtime ou dépendance absent : état incompatible avec motif ;
- conflit de nom ou version : aucune substitution silencieuse ;
- sandbox indisponible : classes `code` désactivées ;
- réseau non autorisé : appel bloqué sans fallback ;
- timeout ou budget dépassé : arrêt du skill et de ses descendants ;
- sortie excessive : troncature contrôlée puis arrêt selon le budget ;
- perte de l’interface de confirmation : action annulée ;
- crash pendant installation : version précédente conservée ;
- arrêt d’urgence : révocation des capacités, arrêt sandbox et libération des entrées.

## Tests obligatoires

Toute implémentation suit TDD : suite existante verte avant modification, test rouge, changement minimal, test vert, puis suite complète verte.

### Instructions

- priorité exacte entre noyau, demande, `MINA.md`, skill et contenu externe ;
- schéma, UTF-8, sections, taille et champs inconnus ;
- détection de secrets réels et absence de valeur dans les erreurs ;
- rechargement atomique, candidat modifié et rollback ;
- maintien de la dernière version saine après fichier invalide ;
- impossibilité pour une page, un message ou un skill de modifier les règles supérieures.

### Registre et installation

- invocation explicite, automatique, ambiguë et score insuffisant ;
- lecture intégrale du skill choisi sans charger les autres ;
- import depuis dossier et ZIP ; dépôt distant testé avec un serveur local contrôlé ;
- quarantaine sans exécution ;
- ZIP traversal, `..`, chemin absolu, jonction et lien symbolique sortant ;
- empreinte modifiée entre confirmation et installation ;
- mise à jour atomique et rollback ;
- outil Codex/Claude sans équivalent signalé incompatible ;
- licence ou provenance absente signalée avant confirmation.

### Permissions et exécution

- permissions liées au nom, à la version, à l’empreinte et au canal ;
- modification de permission invalidant l’autorisation précédente ;
- courtier refusant un outil non déclaré même si le modèle le demande ;
- réseau, fichiers et écriture effectivement isolés dans Windows Sandbox ;
- dépendances verrouillées et cache monté en lecture seule ;
- arrêt des descendants sur timeout, budget et urgence ;
- refus d’export sans seconde confirmation ;
- refus de tout skill depuis SMS ;
- refus de tout outil PC et de tout script depuis Telegram ;
- absence de secrets dans prompts, fichiers, événements et sorties.

### Skills de référence

Trois packages de test valident la chaîne complète :

1. skill conversationnel sans outil ;
2. skill de lecture d’une source locale contrôlée avec provenance ;
3. skill Python, JavaScript ou PowerShell exécuté dans la sandbox avec export confirmé.

Les tests automatisés n’utilisent aucun compte, token, fichier personnel ou action réelle. Les tests sandbox dépendent de l’activation manuelle de Windows Sandbox déjà documentée.

## Critères d’acceptation

Le sous-système est prêt lorsque :

1. Mina démarre avec un `MINA.md` valide et refuse une version corrompue ;
2. une proposition de modification affiche un diff et ne s’applique qu’après confirmation ;
3. un skill local compatible est installé depuis la quarantaine et routé explicitement puis automatiquement ;
4. un skill Codex/Claude incompatible affiche précisément ses outils manquants ;
5. un skill conversationnel, un skill de lecture et un skill sandboxé réussissent leurs scénarios intégrés ;
6. un changement d’empreinte ou de permission invalide immédiatement l’autorisation ;
7. Telegram reste incapable d’utiliser les outils PC et les SMS restent incapables d’invoquer un skill ;
8. l’arrêt d’urgence interrompt effectivement outils et scripts ;
9. aucun secret n’apparaît dans `MINA.md`, les packages, les prompts ou les logs ;
10. les suites unitaires, d’intégration et sandbox sont vertes.

## Hors périmètre initial

- reproduction des outils internes propriétaires de Codex ou Claude ;
- exécution directe d’un package depuis leurs dossiers ;
- marketplace publique ou installation automatique ;
- mises à jour silencieuses ;
- scripts sur l’hôte ou réseau sandbox ouvert ;
- secret transmis à un script ;
- modification de `MINA.md` ou des permissions sans confirmation ;
- création d’un nouvel outil natif uniquement à partir d’un `SKILL.md` ;
- invocation d’un skill par SMS ;
- contrôle du PC par un skill Telegram.

## Ordre d’implémentation recommandé

1. schéma et validateur `MINA.md`, dernière version saine et tests de priorité ;
2. registre, schéma `SKILL.md`, empreintes et états de compatibilité ;
3. routage explicite puis automatique ;
4. chargeur borné de références et protections de chemin ;
5. courtier de capacités et politiques par canal ;
6. quarantaine et installation locale/ZIP atomique ;
7. import contrôlé de packages Codex/Claude ;
8. intégration Windows Sandbox, dépendances isolées et budgets ;
9. propositions de modification, diff, confirmation et rollback ;
10. mémoire/audit et trois skills de référence ;
11. import distant contrôlé, durcissement et documentation utilisateur.
