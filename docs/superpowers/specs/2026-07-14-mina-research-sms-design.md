# Mina — recherche locale/web, grounding, sandbox, mémoire, skills et passerelles SMS/Telegram fiables

> Extensions validées : rôle Samsung/Huawei et ADB Wi‑Fi dans `2026-07-14-mina-multi-device-connectivity-design.md` ; passerelle e-mail multicomptes dans `2026-07-14-mina-email-gateway-design.md`.

**Statut :** design validé par Nasro le 14 juillet 2026. Cette spécification doit encore être relue par Nasro avant la rédaction du plan d’implémentation.

## Objectif

Étendre Mina avec sept capacités séparées :

1. comprendre les pages web et les fichiers accessibles sur le PC sans dépendre de la caméra ;
2. lire les SMS reçus par le Huawei connecté, préparer une réponse, demander confirmation ou répondre automatiquement selon une politique stricte ;
3. exécuter explicitement du code multilangage dans une sandbox jetable, bornée et isolée.
4. conserver une mémoire locale unifiée, chiffrée et intercanal, sauvegardée sous forme chiffrée dans Firebase.
5. charger ses instructions depuis `MINA.md` et exécuter des skills validés derrière des permissions explicites.
6. vérifier ses affirmations et actions, puis encadrer chaque activité dans un cycle de session récupérable.
7. converser avec Nasro depuis un bot Telegram privé et reconnaître ses numéros SMS vérifiés.

Les sept capacités restent sous le contrôle de l’orchestrateur et du moteur de sécurité de Mina. Un contenu lu — page, fichier, SMS ou Telegram — est toujours considéré comme une donnée non fiable, jamais comme une instruction autorisée.

## Principes non négociables

- Tous les nouveaux composants, écrans et services portent le nom **Mina**. Aucun autre nom de produit n’est introduit.
- L’accès aux fichiers et aux pages est en lecture seule par défaut.
- Modifier, déplacer, supprimer, télécharger, imprimer, exécuter ou transmettre exige une demande explicite et la confirmation prévue par la politique de sécurité.
- Un SMS entrant n’a accès à aucun outil : ni souris, ni clavier, ni navigateur, ni fichiers, ni impression, ni terminal.
- Aucun secret n’est placé en dur, journalisé ou envoyé en clair à Firebase.
- Les réponses automatiques sont désactivables immédiatement et restent visibles tant qu’elles sont actives.
- USB et réseau local sont prioritaires. Firebase est un secours, jamais une dépendance unique.
- L’exécution de code exige une demande explicite, une sandbox réelle et une confirmation ; l’absence d’isolation bloque l’action.
- Les concepts utiles des projets DocEngine et Orchestrator sont réécrits dans Mina derrière des interfaces locales. Aucun import ni couplage d’exécution vers ces projets n’est autorisé.
- `MINA.md` et les skills restent subordonnés au noyau de sécurité ; toute modification ou installation exige une validation explicite.
- Telegram est limité à la conversation propriétaire, à la mémoire non sensible et aux skills sans action ; aucun contrôle du PC n’est autorisé.

## Architecture générale

L’application Electron existante reste l’interface principale. L’orchestrateur Node.js demeure l’unique autorité pour planifier une mission, demander une confirmation et autoriser une action.

Les nouveaux modules sont répartis en sept domaines indépendants :

### Domaine recherche

- `mina-browser-reader` : extrait la structure d’une page ouverte ;
- `mina-file-reader` : lit un fichier demandé sans le modifier ;
- `mina-local-index` : indexe uniquement les dossiers autorisés ;
- `mina-doc-intelligence` : découpe, classe et relie les éléments extraits ;
- `mina-secret-guard` : détecte et masque les données sensibles avant tout appel distant ;
- `mina-plan-engine` : transforme une question de recherche en étapes bornées ;
- `mina-evidence` : conserve la provenance précise des affirmations.

### Domaine SMS

- `mina-sms-policy` : décide entre blocage, brouillon, confirmation et envoi automatique ;
- `mina-sms-store` : file locale chiffrée et états des messages côté PC ;
- `mina-sms-link` : sélectionne USB, LAN ou Firebase ;
- `mina-sms-android` : application Android dédiée installée sur le Huawei ;
- `mina-sms-firebase` : relais chiffré et réveil FCM ;
- `mina-sms-service` : petit service Windows optionnel, distinct de l’agent visuel.

### Domaine Telegram et identité

- `mina-telegram-android` : polling Bot API et token Android Keystore ;
- `mina-owner-identity` : compte Telegram et numéros E.164 vérifiés ;
- `mina-telegram-policy` : formats, commandes, quotas et frontières ;
- `mina-phone-transport` : primitives USB/LAN/Firebase partagées avec SMS ;
- `mina-telegram-channel` : sessions, mémoire et modèles côté PC ;
- `mina-local-asr` : transcription locale des notes vocales.

Le design détaillé est défini dans [Mina — canal Telegram propriétaire et identité téléphonique](2026-07-14-mina-telegram-identity-design.md). Le Huawei reste l’unique consommateur du bot et Firebase ne reçoit que des enveloppes chiffrées.

### Domaine exécution sandboxée

- `mina-code-request` : demande multilangage structurée ;
- `mina-model-profiles` : profils de modèles et fallbacks ;
- `mina-code-budget` : plafonds de coût, durée, mémoire, sortie et disque ;
- `mina-windows-sandbox` : environnement jetable sans réseau ;
- `mina-sandbox-protocol` : sorties JSONL diffusées en temps réel ;
- `mina-session-history` : historique chiffré et borné ;
- `mina-code-controller` : confirmations, exécution, arrêt et export.

Le design détaillé est défini dans [Mina — exécution multilangage sandboxée](2026-07-14-mina-code-sandbox-design.md). Ce domaine ne peut être invoqué que par une demande explicite de Nasro et n’est pas accessible au domaine SMS.

### Domaine mémoire

- `mina-event-store` : journal local chiffré de tous les événements ;
- `mina-short-memory` : contexte de travail borné et intercanal ;
- `mina-long-memory` : faits, personnes, relations, corrections et preuves durables ;
- `mina-global-rag` : recherche lexicale et sémantique locale ;
- `mina-identity-linker` : rapprochement explicable des identités et conversations ;
- `mina-memory-sync` : sauvegarde chiffrée et restauration Firebase.

Le design détaillé est défini dans [Mina — mémoire locale unifiée et RAG général](2026-07-14-mina-memory-rag-design.md). Firebase ne reçoit que des blocs chiffrés ; la mémoire locale reste l’autorité.

`mina-local-index` indexe les sources autorisées et publie leurs fragments dans la mémoire unifiée. `mina-global-rag` fournit ensuite l’interface de recherche commune aux fichiers, pages, SMS et autres événements ; les deux modules ne maintiennent pas deux copies divergentes du même corpus.

### Domaine instructions et skills

- `mina-instructions` : charge et valide `MINA.md` ;
- `mina-skill-registry` : inventorie les packages et leur compatibilité ;
- `mina-skill-router` : sélection explicite ou automatique ;
- `mina-skill-installer` : quarantaine, audit et installation confirmée ;
- `mina-tool-broker` : permissions, canaux, budgets et confirmations ;
- `mina-skill-runner` : instructions, outils et scripts sandboxés.

Le design détaillé est défini dans [Mina — instructions constitutionnelles et moteur de skills](2026-07-14-mina-instructions-skills-design.md). Les SMS ne peuvent invoquer aucun skill et Telegram reste limité aux skills conversationnels sans action PC.

### Domaine grounding et sessions

- `mina-claim-ledger` : affirmations, statuts et preuves ;
- `mina-evidence-validator` : source, fraîcheur et empreinte ;
- `mina-action-verifier` : état avant/après et critère de réussite ;
- `mina-response-gate` : blocage des affirmations non soutenues ;
- `mina-session-manager` : sessions système et travail ;
- `mina-hook-runner` : hooks bornés et ordonnés ;
- `mina-checkpoint-manager` : reprise transactionnelle sans rejeu.

Le design détaillé est défini dans [Mina — grounding anti-hallucination et cycle de session](2026-07-14-mina-grounding-sessions-design.md). Une réponse de modèle n’est jamais une preuve et une action n’est terminée qu’après vérification.

Les interfaces entre modules utilisent des objets structurés validés. Aucun module de lecture ni de SMS ne reçoit directement un exécuteur de souris, de clavier ou de commande système.

## Recherche et compréhension sans caméra

### Lecture des pages web

Mina privilégie une lecture structurée dans cet ordre :

1. URL, titre, type de document et métadonnées publiques ;
2. arbre d’accessibilité et DOM rendu ;
3. texte visible, liens, formulaires, tableaux et éléments interactifs ;
4. HTML, CSS et JavaScript publics chargés par la page lorsque la question l’exige ;
5. réponses réseau publiques utiles à la page, sans capturer les en-têtes d’authentification ni les cookies ;
6. capture visuelle uniquement si la structure ne suffit pas.

Les scripts, commentaires HTML, textes de page et réponses réseau sont des données non fiables. Une phrase telle que « ignore les règles précédentes » trouvée dans une page est citée comme contenu et n’est jamais exécutée comme instruction.

Mina respecte la session déjà ouverte dans son profil Chrome dédié. Elle ne contourne ni authentification, ni paywall, ni CAPTCHA, ni restriction d’accès.

### Lecture des fichiers du PC

Deux modes sont prévus :

- **indexation autorisée** : seuls les dossiers sélectionnés par Nasro sont surveillés et indexés ;
- **lecture à la demande** : Mina peut ouvrir ailleurs un chemin explicitement demandé si le compte Windows y a déjà accès.

Les formats initiaux comprennent : texte, code source, JSON, YAML, XML, CSV, Markdown, HTML, PDF, Word, Excel, PowerPoint, archives listables et images avec OCR lorsque nécessaire. Les extracteurs lourds sont chargés dynamiquement.

Pour un logiciel installé, Mina peut lire les sources disponibles, fichiers de configuration, journaux, bundles web, source maps, manifeste, version, signature et métadonnées du binaire. La décompilation ou le désassemblage d’un binaire n’est pas automatique ; il exige une mission explicite et une conception séparée.

Les fichiers dépassant 100 Mio sont exclus de l’indexation automatique par défaut, mais restent lisibles à la demande par blocs après confirmation. Les archives sont listées avant extraction et ne sont jamais exécutées. Une archive dépassant 10 000 entrées ou 2 Gio annoncés après décompression exige une confirmation avant extraction. Les liens symboliques, chemins réseau et jonctions sont résolus puis revalidés pour empêcher une sortie silencieuse du périmètre autorisé.

### Index local

L’index conserve uniquement ce qui est nécessaire à la recherche :

- chemin canonique et identifiant du fichier ;
- empreinte de contenu ;
- date de modification et type détecté ;
- fragments textuels bornés ;
- symboles, imports, routes et références lorsque le langage est reconnu ;
- provenance permettant de rouvrir la source exacte.

L’indexation incrémentale compare empreinte et date de modification. La suppression d’un fichier retire ses fragments de l’index. Le contenu complet n’est pas dupliqué lorsqu’un pointeur vers la source suffit.

Le premier moteur est lexical et local. Une recherche sémantique locale peut être ajoutée derrière la même interface, sans rendre un fournisseur cloud obligatoire.

### Protection des secrets

Avant toute transmission à Gemini, OpenRouter, Modal ou un autre fournisseur distant, `mina-secret-guard` détecte et masque notamment :

- clés API, jetons, mots de passe et chaînes de connexion ;
- cookies, en-têtes d’autorisation et fichiers d’identifiants ;
- clés privées et certificats avec clé privée ;
- OTP et codes de récupération ;
- données financières ou personnelles manifestement sensibles.

Si le masquage retire une information indispensable, Mina explique le blocage et demande une confirmation ciblée. Une confirmation ne désactive pas globalement la protection pour les lectures suivantes.

### Réponses fondées sur des preuves

Une réponse de recherche distingue :

- **fait vérifié** : lié à une source ouverte et une position précise ;
- **inférence** : conclusion explicitement signalée ;
- **élément non vérifié** : impossible à confirmer avec les accès disponibles.

Pour un fichier, la preuve contient chemin, type, empreinte de version et ligne, page, feuille ou section. Pour une page web, elle contient URL, titre, horodatage et sélecteur ou extrait borné. Mina ne prétend jamais avoir lu une source qui n’a pas été ouverte par un lecteur.

## Passerelle SMS Android

### Comportement utilisateur

À la réception d’un SMS, Mina :

1. enregistre immédiatement le message dans la file chiffrée du téléphone ;
2. le transmet au PC par le meilleur canal disponible ;
3. prépare un brouillon sans aucun accès aux outils du PC ;
4. applique `mina-sms-policy` ;
5. affiche le brouillon pour confirmation ou envoie automatiquement s’il est admissible ;
6. suit les états `queued`, `sent`, `delivered`, `failed` et `expired`.

Le mode normal demande toujours confirmation. Le mode automatique peut répondre à tous les numéros, y compris inconnus, mais seulement à une conversation déjà initiée par un SMS entrant. Mina n’initie jamais automatiquement une nouvelle conversation.

### Politique d’envoi automatique

Un message n’est envoyé automatiquement que si toutes les conditions suivantes sont vraies :

- il répond à un SMS reçu et non encore traité ;
- le contenu est conversationnel, non ambigu et ne contient aucune demande sensible ;
- la réponse ne contient ni secret, ni information extraite du PC, ni URL générée, ni pièce jointe ;
- aucune action, promesse contractuelle ou représentation risquée de Nasro n’est engagée ;
- les quotas ne dépassent pas 3 réponses automatiques par conversation sur 10 minutes, 20 par conversation sur 24 heures et 100 au total sur 24 heures ;
- le mode automatique est actif et visible dans l’interface.

Dépasser un quota transforme la réponse en brouillon à confirmer ; le message entrant n’est pas perdu. Activer le mode automatique vaut autorisation continue de transmettre au modèle configuré le contenu non sensible strictement nécessaire à la réponse. Le filtre local bloque ou masque les contenus sensibles avant cet appel.

Le mode automatique bloque systématiquement :

- OTP, mot de passe, récupération de compte et secret technique ;
- banque, paiement, remboursement, coordonnées bancaires et cryptoactifs ;
- contrat, commande, engagement commercial ou juridique ;
- santé, diagnostic ou donnée médicale ;
- menace, harcèlement, litige ou urgence ;
- lien douteux, raccourci ou redirection inconnue ;
- demande d’ouvrir un fichier, cliquer, naviguer, imprimer, télécharger ou exécuter ;
- message trop court, incomplet, contradictoire ou insuffisamment compris.

Dans ces cas, Mina conserve un brouillon et demande confirmation. Un score de modèle ne peut jamais contourner une règle déterministe bloquante.

### Ordre des transports

`mina-sms-link` tente les canaux dans cet ordre :

1. **USB** : tunnel local créé avec `adb reverse`, surveillé et recréé après reconnexion ;
2. **LAN** : WebSocket TLS authentifié lorsque téléphone et PC partagent le réseau ;
3. **Firebase** : file chiffrée de secours lorsque le transport local est indisponible ;
4. **file locale** : conservation jusqu’au retour d’au moins un canal.

Le changement de canal ne change pas l’identifiant du message. Les accusés de réception sont idempotents. Recevoir deux fois la même enveloppe ne provoque jamais deux analyses ni deux envois.

### Protocole et chiffrement

Chaque enveloppe contient au minimum :

- `messageId` aléatoire et unique ;
- version du protocole ;
- direction et état ;
- date de création et date d’expiration ;
- numéro de tentative ;
- charge utile chiffrée ;
- nonce et tag d’authentification.

Le numéro de téléphone, le contenu, la SIM et les brouillons restent dans la charge utile chiffrée. L’identifiant et les données de routage ne permettent pas de reconstruire une conversation.

La clé de paire est créée lors d’un appairage local. Elle est stockée dans Android Keystore sur le téléphone et protégée par DPAPI/Windows Credential Manager sur le PC. Elle n’est jamais envoyée à Firebase. Le chiffrement authentifié couvre aussi l’identifiant, la direction, la version et l’expiration afin d’empêcher leur modification.

### Firebase comme fallback

Le fallback utilise un projet Firebase nommé Mina, indépendant de la configuration du ZIP httpSMS :

- Firebase Authentication associe le PC et le téléphone au même compte propriétaire, avec deux sessions d’appareil distinctes ;
- Realtime Database transporte les enveloppes déjà chiffrées et conserve les écritures hors ligne ;
- une Cloud Function déclenche FCM lorsqu’une commande attend le téléphone ;
- FCM transporte uniquement un identifiant d’enveloppe et un type d’événement, jamais le SMS ;
- l’accusé de réception supprime l’enveloppe distante ;
- une purge planifiée élimine tout reliquat après 24 heures.

Les règles Firebase refusent l’accès anonyme, exigent l’UID propriétaire et limitent chaque session aux chemins de ses appareils appairés. Le client PC n’embarque aucune clé de compte de service. Les opérations administratives FCM restent dans la Cloud Function.

Une notification visible accompagne les réveils FCM prioritaires afin de limiter leur dépriorisation par Android. Firebase ne peut rien transmettre si le téléphone n’a ni Internet, ni USB, ni LAN ; dans ce cas la file locale reste l’autorité et se synchronise plus tard.

### Application Android

Le module Android de `httpsms-main.zip` sert uniquement de référence technique pour la réception SMS, `SmsManager`, `WorkManager`, FCM et le service de premier plan. Le code Mina remplace son API publique, son identité, ses analytics et sa télémétrie.

L’application Mina Android :

- cible le Huawei actuellement sous Android 10 tout en restant compatible avec les règles Android modernes ;
- demande seulement les permissions SMS, réseau, notification, démarrage et veille nécessaires ;
- désactive `allowBackup` et exclut les données sensibles des sauvegardes ;
- persiste les files avec Room avant tout accès réseau ;
- utilise un `BroadcastReceiver` court, puis `WorkManager` ou le service de premier plan ;
- répond avec la même SIM que celle ayant reçu le message lorsque l’information est certaine ;
- demande confirmation si le choix de SIM est ambigu ;
- affiche en permanence « Mina SMS actif » lorsque l’écoute automatique fonctionne ;
- redémarre après le téléphone uniquement si Nasro a laissé le service actif.

Sur EMUI, l’installation inclut une vérification guidée de l’autorisation de démarrage automatique, d’exécution secondaire, d’activité en arrière-plan et d’exclusion de l’optimisation batterie.

### Persistance après redémarrage

Le mode automatique reste actif jusqu’à désactivation manuelle, y compris après redémarrage du téléphone ou de Windows.

Cette règle crée une exception limitée à la conception initiale de Mina :

- le service léger `Mina SMS` peut démarrer avec Windows quand le mode automatique est actif ;
- il affiche une icône de zone de notification et un bouton d’arrêt immédiat ;
- il ne démarre ni caméra, ni micro, ni navigateur, ni contrôle du bureau ;
- l’application visuelle complète reste lancée à la demande ;
- désactiver le mode automatique retire le démarrage automatique du service SMS.

L’arrêt d’urgence de Mina désactive immédiatement l’envoi automatique, annule les brouillons non envoyés et conserve seulement les SMS reçus nécessaires à la reprise manuelle.

## Stockage et journalisation

Les files Android et Windows sont chiffrées au repos. Le journal utilisateur contient : identifiant court, date, direction, transport, décision de politique et état opérateur. Il n’affiche pas les secrets et n’enregistre pas le raisonnement interne du modèle.

La rétention technique du transport est :

- enveloppe Firebase : suppression sur accusé, maximum 24 heures ;
- journal technique sans contenu : 30 jours ;
- FCM : aucun contenu conversationnel.

Après ingestion, les messages et brouillons appartiennent à la mémoire unifiée et sont conservés sans expiration jusqu’à une commande d’oubli. Nasro peut les supprimer depuis l’interface avec confirmation explicite ; la suppression est propagée aux index et à la sauvegarde chiffrée.

## Défaillances et reprise

- ADB absent ou tunnel perdu : tentative LAN, puis Firebase, sans perdre l’enveloppe locale.
- LAN instable : reconnexion avec backoff borné et jitter.
- Firebase indisponible : maintien local et nouvelle tentative ultérieure.
- téléphone hors ligne : commande conservée côté PC jusqu’à expiration ; aucun faux état `sent`.
- processus tué pendant l’envoi : réconciliation par `messageId` et état opérateur avant toute répétition.
- SMS refusé par Android ou l’opérateur : état `failed`, motif borné, aucune boucle infinie.
- accusé `delivered` absent : état `sent` conservé ; Mina ne prétend pas que le destinataire l’a reçu.
- base locale illisible : arrêt fail-closed de l’auto-envoi et diagnostic visible.
- règle Firebase invalide ou authentification expirée : fallback local uniquement, sans ouverture anonyme.
- modèle indisponible : brouillon non produit, aucun envoi automatique.

## Tests obligatoires

Toute implémentation suit TDD : test rouge, changement minimal, test vert, puis suite complète.

### Recherche

- extraction DOM, accessibilité, HTML, CSS et JavaScript depuis une page locale contrôlée ;
- résistance à une injection d’instructions présente dans une page ou un document ;
- lecture par blocs, limites de taille et annulation ;
- résolution sûre des chemins, jonctions, liens symboliques et partages réseau ;
- extracteurs de documents avec provenance exacte ;
- masquage de secrets sans fuite dans les logs ou erreurs ;
- indexation initiale, mise à jour, suppression et recherche à la demande ;
- citations distinguant fait, inférence et non-vérifié.

### SMS

- réception et persistance avant transport ;
- déduplication d’enveloppes identiques sur plusieurs canaux ;
- priorité USB, bascule LAN, puis Firebase ;
- interruption et reprise à chaque étape de la machine d’état ;
- correspondance de la SIM et cas ambigu ;
- accusés `sent`, `delivered`, `failed` et expiration ;
- blocage déterministe de chaque catégorie sensible ;
- absence totale d’outil dans le générateur de réponse SMS ;
- quotas, coupe-circuit et arrêt d’urgence ;
- persistance contrôlée du mode automatique après redémarrage ;
- chiffrement, altération d’enveloppe, rejeu et rotation de clé ;
- règles Firebase testées avec l’émulateur : accès anonyme refusé, isolation utilisateur et purge ;
- simulation Doze/veille, perte réseau et reconnexion ;
- test supervisé sur le Huawei avec un SMS de test non sensible.

### Telegram et identité

- appairage par jeton, contact Telegram et confirmation locale ;
- challenge SMS, E.164, expiration, tentatives et révocation ;
- polling Android, persistance avant offset et déduplication ;
- texte, note vocale et commandes bornées ;
- PC hors ligne, réponse différée et reprise ;
- mémoire sensible bloquée et `/forget` confirmé localement ;
- aucun outil PC, sandbox ou skill d’action ;
- token absent du code, des logs et de la mémoire.

### Instructions et skills

- priorité entre noyau, demande, `MINA.md`, skill et contenu externe ;
- modification de `MINA.md` confirmée et rollback atomique ;
- import en quarantaine, protections de chemin et empreinte ;
- routage explicite et automatique ;
- permissions liées au skill, à sa version et au canal ;
- scripts uniquement dans Windows Sandbox ;
- aucun skill depuis SMS et aucun outil PC depuis Telegram.

### Grounding et sessions

- fait vérifié, inférence, incertitude, absence bornée et preuve périmée ;
- état live distinct de la documentation ;
- action sans effet malgré un retour outil positif ;
- ordre, idempotence, timeout et erreur des hooks ;
- checkpoint et récupération sans répétition de l’action ;
- révocation des permissions à la fin de session ;
- délai Telegram de 30 minutes et micro-session SMS isolée.

La suite existante doit être verte avant la première modification et après chaque tranche. Aucun SMS réel n’est envoyé pendant les tests automatisés. Le premier envoi réel est supervisé, vers un numéro contrôlé par Nasro, mode automatique désactivé.

## Critères d’acceptation

La capacité recherche est prête lorsque Mina peut répondre à une question croisant une page web et plusieurs fichiers autorisés, fournir des preuves ouvrables, masquer les secrets et ne rien modifier.

La capacité multilangage est prête lorsque les critères de [Mina — exécution multilangage sandboxée](2026-07-14-mina-code-sandbox-design.md) sont tous vérifiés : demande explicite, double confirmation exécution/export, streaming, historique, budgets, réseau coupé et aucun repli sur l’hôte.

La passerelle SMS est prête lorsque :

- un SMS reçu est enregistré puis visible sur le PC malgré une coupure temporaire ;
- le même message transmis par USB et Firebase n’est traité qu’une fois ;
- le brouillon exige une confirmation en mode normal ;
- le mode automatique répond à un message banal mais bloque les catégories sensibles ;
- aucune phrase reçue par SMS ne déclenche une action PC ;
- un redémarrage du téléphone et de Windows restaure uniquement le service SMS autorisé ;
- l’arrêt d’urgence empêche tout nouvel envoi ;
- les états envoyés/livrés restent fidèles aux accusés Android/opérateur ;
- la suite automatisée et les validations supervisées sont vertes.

Le canal Telegram est prêt lorsque les critères de [Mina — canal Telegram propriétaire et identité téléphonique](2026-07-14-mina-telegram-identity-design.md) sont vérifiés : compte et numéro appairés, texte et voix locaux, reprise hors ligne sans doublon, mémoire sensible bloquée, aucun outil PC et token limité à Android Keystore.

## Hors périmètre

- contournement d’une permission Windows, Android ou web ;
- surveillance par caméra ou micro au démarrage de Windows ;
- contrôle du PC déclenché depuis un SMS ;
- contrôle ou approbation d’une action PC depuis Telegram ;
- groupes, canaux et pièces jointes Telegram dans la première version ;
- campagne SMS, prospection ou nouveau message automatique sans SMS entrant ;
- MMS et pièces jointes dans la première tranche ;
- décompilation automatique de logiciels propriétaires ;
- conservation cloud lisible ou indexable des conversations ;
- réutilisation du serveur, du compte Firebase, de Sentry ou de l’interface publique httpSMS.

## Ordre d’implémentation recommandé

1. lecteurs web/fichiers, preuves et garde-secrets ;
2. `MINA.md`, priorité des instructions et dernière version saine ;
3. sessions, hooks, checkpoints et récupération sans rejeu ;
4. schémas d’événements, coffre local et mémoire unifiée ;
5. registre d’affirmations, validation de preuves et vérification d’actions ;
6. index lexical, embeddings locaux et RAG général ;
7. registre de skills, routage et courtier de capacités ;
8. demandes structurées, profils de modèles, budgets et historique de sandbox ;
9. Windows Sandbox, scripts de skills, runtimes et export confirmé ;
10. application Android Mina avec file locale et transport USB ;
11. transport LAN et déduplication multi-canal ;
12. brouillons, confirmations et règles d’auto-réponse ;
13. Firebase Authentication, transport SMS, sauvegarde mémoire chiffrée et restauration ;
14. passerelle Telegram Android, token Keystore et appairage propriétaire ;
15. sessions Telegram, texte, ASR local, commandes et reprise hors ligne ;
16. service Windows persistant, interface et tests de redémarrage ;
17. validation réelle supervisée puis activation volontaire des modes distants.

Le dépôt `Nassreallah-B/httpsms` est sous licence AGPL-3.0. Toute portion de code effectivement adaptée doit conserver les mentions et obligations applicables dans `THIRD_PARTY_NOTICES` et les sources distribuées. Une réécriture indépendante des concepts est privilégiée pour réduire le couplage et la surface héritée.
