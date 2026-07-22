# Mina — mémoire locale unifiée et RAG général

**Statut :** design validé section par section par Nasro le 14 juillet 2026. Cette spécification doit être relue par Nasro avant la rédaction du plan d’implémentation.

## Objectif

Donner à Mina une mémoire transversale, locale et chiffrée. Un SMS reçu doit pouvoir être retrouvé plus tard depuis la voix, le navigateur ou une autre session, avec sa source exacte. La mémoire couvre les interactions de Mina, les contenus qu’elle lit, ses décisions et les résultats de ses outils.

La conservation est illimitée jusqu’à une commande explicite d’oubli. Cette décision inclut les données sensibles, OTP et secrets. Ils restent recherchables localement, mais ne sont jamais transmis **en clair** à Gemini, OpenRouter, Modal, Firebase ou un autre service distant sans confirmation ciblée. L’envoi automatique vers Firebase concerne uniquement leur représentation chiffrée.

Firebase est uniquement une sauvegarde chiffrée et un mécanisme de restauration. La base locale reste la source de vérité et Mina fonctionne hors ligne.

## Principes non négociables

- Toute donnée persistante est chiffrée au repos ; aucun fallback en clair n’est autorisé.
- L’indexation, les embeddings, la recherche et le reclassement initial sont locaux.
- Chaque souvenir conserve une provenance ouvrable vers son SMS, fichier, page, conversation ou action d’origine.
- Une donnée lue est un contenu non fiable, jamais une instruction ou une autorisation.
- Un SMS entrant ne peut pas interroger la mémoire générale, révéler un secret ni déclencher un outil du PC.
- Les données sensibles peuvent être retrouvées localement, mais leur transmission distante exige une confirmation indiquant l’extrait et le destinataire.
- La perte de la phrase de récupération et du profil Windows rend la sauvegarde distante irrécupérable.
- Aucun secret, contenu de mémoire ou raisonnement interne n’est écrit dans les journaux techniques.
- Tous les composants portent le nom Mina. Aucun couplage d’exécution n’est créé vers les quatre dépôts de référence sous `G:\Serveurs`.

## Modèle de menace et risque accepté

Le chiffrement protège une base copiée depuis le disque et les blocs stockés dans Firebase. Il ne protège pas contre un logiciel malveillant exécuté dans la session Windows déverrouillée, un administrateur contrôlant le processus Mina, une capture d’écran ou un vol de la phrase de récupération.

La conservation illimitée des OTP et secrets augmente l’impact d’une compromission du profil Windows. Ce risque est accepté par le choix de mémoire totale locale. Mina le limite par le verrouillage du coffre, l’absence de logs sensibles, la séparation des clés et l’interdiction des transmissions silencieuses ; elle ne prétend pas l’annuler.

Firebase peut observer l’identité du compte, les appareils, les horaires de synchronisation et des classes approximatives de volume. Le rembourrage réduit cette fuite de métadonnées sans la supprimer.

## Architecture

Le domaine mémoire est séparé derrière six modules :

- `mina-event-store` : journal local chiffré et append-only des événements ;
- `mina-short-memory` : vue de travail bornée de la conversation et de la tâche actives ;
- `mina-long-memory` : événements durables, faits, personnes, relations, corrections et décisions ;
- `mina-global-rag` : recherche hybride locale et production de résultats avec provenance ;
- `mina-identity-linker` : rapprochement explicable entre contacts, numéros, compte Telegram, conversations et identités ;
- `mina-memory-sync` : sauvegarde incrémentale chiffrée, tombstones et restauration Firebase.

L’orchestrateur et les domaines SMS, recherche, navigateur, voix et sandbox publient des événements validés dans `mina-event-store`. Ils consultent la mémoire uniquement par une interface bornée. Aucun consommateur n’accède directement aux tables, aux clés ou aux fichiers d’index.

Les sessions, affirmations, preuves, contradictions, checkpoints et raisons de fin suivent [Mina — grounding anti-hallucination et cycle de session](2026-07-14-mina-grounding-sessions-design.md) et rejoignent le même journal chiffré.

```text
SMS / voix / navigateur / fichiers / outils
                    |
                    v
          mina-event-store chiffré
              |              |
              v              v
      mémoire courte   mémoire longue
              \              /
               mina-global-rag
                      |
                      v
             réponse avec preuve

mina-event-store -> blocs chiffrés -> Firebase
```

## Modèle d’événement

Chaque événement possède au minimum :

```text
eventId
schemaVersion
sourceType
sourceId
occurredAt
ingestedAt
actorId
conversationId
sensitivity
payloadCiphertext
provenance
contentHash
supersedes[]
tombstoneFor[]
```

`sourceType` distingue notamment `sms`, `telegram`, `voice`, `browser`, `file`, `tool`, `skill`, `sandbox`, `user_correction` et `assistant`. Les identifiants externes ne servent jamais seuls à la déduplication : le domaine source fournit aussi une empreinte stable et son contexte.

Le contenu, les numéros, chemins, URL privées, noms de contact et extraits sont chiffrés. Les métadonnées laissées hors charge utile sont limitées au routage local et ne doivent pas permettre de reconstruire une conversation. Une suppression est un nouvel événement tombstone ; l’ancien événement n’est physiquement retiré que pendant un compactage transactionnel.

Les schémas sont versionnés. Une migration transforme une copie transactionnelle, conserve un point de reprise et ne supprime l’ancienne représentation qu’après validation.

## Mémoire courte

La mémoire courte est une vue dérivée et bornée, pas une seconde source de vérité. Elle contient la conversation active, la tâche en cours et les événements récents ou explicitement épinglés utiles à cette tâche.

La sortie de cette vue ne supprime rien. Un élément plus ancien est retrouvé par `mina-global-rag`. La taille de la vue est bornée par un budget de jetons et un nombre maximal d’événements afin d’éviter une croissance silencieuse du contexte envoyé aux modèles.

Avant tout appel distant, la vue passe dans `mina-secret-guard`. Une donnée marquée sensible est retirée ou remplacée par une référence locale, sauf confirmation ciblée de Nasro.

## Mémoire longue

La mémoire longue conserve sans expiration automatique :

- les événements bruts ;
- les faits durables et préférences ;
- les personnes, sujets, documents et relations ;
- les décisions, actions et résultats ;
- les contradictions et corrections ;
- la provenance et le niveau de confiance de chaque fait dérivé.

Un fait dérivé référence toujours un ou plusieurs événements. Un modèle ne peut pas créer un « souvenir » sans preuve. Les extractions sensibles sont réalisées par des règles déterministes ou par un petit modèle local chargé à la demande. Un fournisseur distant peut être utilisé uniquement après confirmation ciblée.

Une correction n’efface pas silencieusement l’historique. Elle ajoute un événement `user_correction`, marque le fait précédent comme remplacé et conserve les deux preuves. Le résultat de recherche présente le fait actuel et signale la contradiction lorsque celle-ci reste pertinente.

## RAG général local

Le runtime d’embeddings local, son chargement à la demande et les presets de routage sont définis dans [Mina — moteurs locaux spécialisés, routage dynamique, voix et paramètres](2026-07-14-mina-local-model-runtime-settings-design.md). Les embeddings restent locaux par défaut dans tous les presets.

La recherche suit ce pipeline :

1. normalisation locale de la requête et résolution des identités connues ;
2. recherche lexicale sur un index de jetons protégés par HMAC ;
3. recherche sémantique avec embeddings multilingues calculés localement ;
4. fusion et reclassement par pertinence, date, personne, source et fiabilité ;
5. déchiffrement en mémoire des seuls candidats nécessaires ;
6. contrôle de politique avant affichage ou transmission à un modèle ;
7. réponse accompagnée de la provenance exacte.

Les vecteurs et leurs métadonnées sont chiffrés au repos. Ils peuvent être déchiffrés dans un index en mémoire ou chargés depuis un snapshot chiffré. L’indisponibilité du moteur sémantique dégrade Mina vers la recherche lexicale et l’affiche clairement ; elle n’active jamais un service d’embeddings cloud en silence.

Pour une donnée sensible, Mina peut afficher localement l’extrait original sans appel au modèle. Si une réponse exige un raisonnement cloud sur cet extrait, l’interface indique le fournisseur, le contenu transmis et la finalité, puis demande confirmation.

## Identités et mémoire intercanal

`mina-identity-linker` relie les identités avec des preuves : identifiant Android du contact, identifiant Telegram numérique, numéro normalisé, nom fourni par Nasro, conversation et alias. Un rapprochement ambigu reste une suggestion et n’est pas fusionné automatiquement. L’identité propriétaire Telegram/SMS suit [Mina — canal Telegram propriétaire et identité téléphonique](2026-07-14-mina-telegram-identity-design.md).

Flux attendu :

```text
SMS reçu de Karim
  -> événement chiffré
  -> lien vers le contact et la conversation
  -> index lexical et sémantique local

Plus tard : « Mina, qu’est-ce que Karim avait dit sur la livraison ? »
  -> résolution de Karim
  -> recherche générale
  -> SMS retrouvé
  -> réponse avec date et source
```

Le générateur de brouillon SMS peut consulter l’historique de la même conversation après filtrage. Un SMS entrant ne peut pas demander à Mina de fouiller une autre conversation, les fichiers, les secrets ou la mémoire générale. Une utilisation plus large doit être initiée dans l’interface locale par Nasro et confirmée selon la politique existante.

## Chiffrement et gestion des clés

Le coffre utilise un chiffrement authentifié AES-256-GCM avec nonce unique. Une clé maîtresse aléatoire est créée localement. Sa copie locale est enveloppée par Windows DPAPI pour le profil de Nasro.

Les contenus utilisent des clés de données distinctes enveloppées par la clé maîtresse. Les index exacts utilisent une sous-clé dédiée dérivée par HKDF ; les clés d’index, de synchronisation et de manifeste sont séparées. Une altération de ciphertext, de nonce, de métadonnée authentifiée ou de manifeste bloque la lecture.

La phrase de récupération n’est jamais stockée. Mina génère douze mots aléatoires à forte entropie, les affiche une seule fois et exige une vérification avant d’activer la sauvegarde. Ils ne sont ni copiés automatiquement dans le presse-papiers, ni imprimés, ni journalisés. Une clé de récupération est dérivée localement par Argon2id avec sel et paramètres versionnés. Elle enveloppe une copie de la clé maîtresse destinée à la restauration. Firebase conserve le sel, les paramètres et la clé enveloppée, mais ni les mots ni une clé lisible.

Les clés déchiffrées restent en mémoire le moins longtemps possible. Le verrouillage de session, l’arrêt de Mina et l’arrêt d’urgence ferment le coffre et effacent les caches de clés selon les capacités du runtime.

## Firebase comme sauvegarde de secours

Firebase Authentication identifie le propriétaire et les appareils appairés. Cloud Storage conserve les blocs chiffrés durables ; Realtime Database conserve uniquement le manifeste chiffré, les séquences, accusés et tombstones nécessaires à la synchronisation. Une Cloud Function peut nettoyer les versions orphelines, mais ne possède aucune clé de déchiffrement.

La synchronisation est locale-first :

1. transaction et chiffrement locaux ;
2. ajout dans une file persistante ;
3. envoi incrémental lorsque le réseau revient ;
4. vérification du manifeste signé ;
5. accusé puis compactage local de la file.

Les blocs sont rembourrés par classes de taille afin de réduire les fuites de volume. Les règles Firebase refusent l’accès anonyme, isolent chaque UID et limitent les appareils aux chemins appairés. Le client desktop n’embarque aucune clé de compte de service.

La restauration sur un nouveau PC exige l’authentification Firebase et la phrase de récupération. Mina vérifie le manifeste avant tout déchiffrement, restaure dans une nouvelle base, valide les compteurs et les tombstones, puis bascule atomiquement. Une mauvaise phrase, un manifeste incomplet ou une altération bloque la restauration sans modifier la base locale existante.

Le transport SMS Firebase et la sauvegarde mémoire sont deux espaces séparés. Les enveloppes de transport SMS restent éphémères et purgées sous 24 heures ; la sauvegarde mémoire chiffrée suit la conservation illimitée choisie par Nasro.

## Conservation et oubli

Aucune expiration automatique n’est appliquée au journal, aux faits ou aux souvenirs. La mémoire courte peut évincer un élément de son cache, mais l’événement reste dans la mémoire longue.

Les commandes d’oubli couvrent :

- un message ou événement ;
- une personne, conversation ou source ;
- un sujet ou une période ;
- toute la mémoire.

L’interface affiche l’étendue estimée avant confirmation. L’oubli crée d’abord un tombstone durable, puis supprime les faits dérivés, liens, jetons, vecteurs, snapshots et clés de données concernés. Le tombstone est synchronisé avant le compactage des anciennes versions distantes afin d’empêcher une restauration obsolète par Mina.

La suppression des objets Firebase actifs est demandée immédiatement et rejouée jusqu’à accusé. Les sauvegardes internes éventuelles de l’opérateur restent soumises aux politiques de rétention de Google ; Mina ne prétend pas pouvoir effacer un support auquel Firebase ne donne pas accès. La destruction locale des clés et les tombstones rendent néanmoins ces éléments inaccessibles par l’application.

## Intégration avec les projets Mina existants

Les quatre dossiers sous `G:\Serveurs` sont des références, pas des dépendances runtime :

- `Mina API` apporte des idées de recherche hybride et de schéma pgvector, réécrites localement. Ses chaînes de connexion historiques doivent être retirées et les identifiants concernés tournés avant toute réutilisation du dépôt.
- `Mina AI` peut servir plus tard aux corpus, évaluations et outils d’ingestion. Son Qdrant n’est pas requis par la mémoire locale desktop.
- `Mina APP` peut inspirer l’affichage des sessions et sources. Elle ne devient pas l’interface de Mina et son isolation anonyme doit être corrigée séparément avant tout usage.
- `Mina Modal` reste un fournisseur d’inférence optionnel. Il n’héberge ni la mémoire ni les embeddings sensibles et ne reçoit du contenu qu’après confirmation.

Aucun code, migration, secret ou nom d’un ancien produit n’est copié automatiquement. Les interfaces sont réécrites dans `Mina Vision` et testées contre ses contraintes Electron/Node réelles.

## Défaillances et reprise

- coffre verrouillé, DPAPI invalide ou clé absente : blocage fail-closed, aucun stockage en clair ;
- disque plein : arrêt de l’ingestion avec alerte, sans écraser la dernière transaction valide ;
- base corrompue : ouverture en lecture seule si possible, diagnostic puis restauration explicite ;
- moteur d’embeddings absent : recherche lexicale locale et état dégradé visible ;
- Firebase indisponible : file locale persistante et retry avec backoff borné ;
- authentification Firebase expirée : sauvegarde suspendue, mémoire locale disponible ;
- répétition, reprise ou restauration concurrente : fusion des ajouts par identifiant et priorité aux tombstones ; la synchronisation temps réel entre plusieurs PC actifs reste hors périmètre ;
- bloc ou manifeste altéré : restauration refusée ;
- perte de phrase et du profil Windows : sauvegarde irrécupérable, sans contournement administratif ;
- interruption pendant migration, oubli ou restauration : reprise idempotente à partir du journal d’opération.

Le service SMS léger peut publier des événements et vider la file de sauvegarde lorsque le mode automatique est actif. Il ne démarre ni caméra, ni micro, ni navigateur, ni sandbox. L’application complète recharge la mémoire courte depuis le journal à son ouverture.

## Tests obligatoires

Toute implémentation suit TDD : suite existante verte, test rouge, changement minimal, test vert, puis suite complète verte.

### Chiffrement et stockage

- chiffrement/déchiffrement, nonce unique et données associées ;
- altération du ciphertext, du nonce, des métadonnées et du manifeste ;
- enveloppement DPAPI et restauration par phrase dans un profil de test ;
- mauvaise phrase, mauvaise identité Firebase et mauvaise clé ;
- absence de contenu, OTP, secret ou clé dans les logs ;
- migration interrompue et reprise transactionnelle.

### Mémoire et RAG

- SMS reçu dans une session puis retrouvé depuis la voix dans une autre ;
- recherche exacte par nom, numéro, URL et terme ;
- recherche sémantique multilingue avec formulation différente ;
- fusion lexicale/sémantique, récence et provenance ;
- identité ambiguë non fusionnée automatiquement ;
- correction d’un fait avec conservation de l’ancienne preuve ;
- déduplication de deux transports portant le même SMS ;
- fallback lexical lorsque le moteur vectoriel est indisponible ;
- résultat sensible affiché localement sans appel réseau.

### Frontières de sécurité

- mocks de transport prouvant qu’aucun contenu sensible ne part sans confirmation ;
- confirmation bornée à un extrait et à un fournisseur ;
- injection d’instructions dans un SMS, une page ou un document traitée comme contenu ;
- impossibilité pour un SMS d’interroger les fichiers, secrets, sandbox ou mémoire générale ;
- absence d’import direct entre domaine SMS et outils PC.

### Firebase et oubli

- fonctionnement hors ligne puis reprise incrémentale ;
- retry, déduplication, séquences concurrentes et idempotence ;
- règles Firebase avec émulateurs : accès anonyme refusé et isolation UID/appareil ;
- restauration complète dans une base neuve ;
- refus d’un bloc modifié ou d’un manifeste incomplet ;
- oubli en cascade du contenu, faits, liens, index, clés et objets distants ;
- restauration ancienne neutralisée par un tombstone plus récent ;
- séparation prouvée entre transport SMS éphémère et sauvegarde mémoire durable.

Les tests automatisés n’utilisent aucun SMS réel ni donnée personnelle. Les scénarios de restauration emploient un projet Firebase Emulator et des clés éphémères. Une validation supervisée sur le Huawei et le compte Firebase Mina intervient seulement après la suite automatisée.

## Critères d’acceptation

La capacité est prête lorsque :

1. Mina retrouve depuis un autre canal un SMS d’une session précédente avec date et preuve ;
2. la recherche exacte et sémantique reste locale et fonctionne hors ligne ;
3. les données sensibles sont recherchables localement sans transmission silencieuse ;
4. la mémoire survit au redémarrage de Windows et de Mina ;
5. Firebase reçoit uniquement des blocs chiffrés et permet une restauration avec la phrase ;
6. une mauvaise phrase ou une sauvegarde altérée ne modifie pas la base locale ;
7. une commande d’oubli supprime les dérivés et reste effective après restauration ;
8. un SMS entrant reste incapable d’utiliser la mémoire générale ou un outil PC ;
9. la recherche chaude répond en moins de deux secondes au 95e percentile sur un corpus de test de 100 000 événements sur cette machine ;
10. les suites unitaires, d’intégration, Firebase Emulator et les validations supervisées sont vertes.

## Hors périmètre initial

- indexation silencieuse de tout le disque sans dossiers autorisés ni demande explicite ;
- mémoire partagée en clair entre plusieurs utilisateurs Windows ;
- consultation ou recherche du contenu côté Firebase ;
- synchronisation temps réel entre plusieurs PC actifs ;
- entraînement d’un modèle sur les souvenirs personnels ;
- sauvegarde ou restauration sans authentification et phrase de récupération ;
- exposition de la mémoire à un SMS, une page web ou du code sandboxé ;
- garantie d’effacement des sauvegardes internes inaccessibles de l’opérateur cloud.

## Ordre d’implémentation recommandé

1. interfaces d’événements, schémas versionnés et tests d’architecture ;
2. coffre local, DPAPI, clés de données et migrations ;
3. mémoire courte dérivée et ingestion SMS/voix/navigation ;
4. index lexical protégé et provenance ;
5. embeddings multilingues locaux, index vectoriel chiffré et fusion RAG ;
6. faits, corrections et résolution d’identité ;
7. garde de transmission distante et confirmations ciblées ;
8. sauvegarde Firebase chiffrée, manifestes et émulateurs ;
9. phrase de récupération et restauration atomique ;
10. oubli en cascade, tombstones, compactage et tests de restauration ancienne ;
11. intégration au service SMS léger et validation intercanal supervisée ;
12. benchmark de 100 000 événements, durcissement et documentation utilisateur.
