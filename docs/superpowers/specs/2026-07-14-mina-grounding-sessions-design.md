# Mina — grounding anti-hallucination et cycle de session

**Statut :** design validé section par section par Nasro le 14 juillet 2026. Cette spécification doit être relue avant la rédaction du plan d’implémentation.

## Objectif

Ajouter à Mina un système exécutable de réduction des hallucinations et un cycle de session transactionnel. Les instructions de `MINA.md` restent utiles, mais elles ne constituent pas une preuve. Les affirmations factuelles, résultats de recherche, souvenirs et actions doivent être contrôlés par des composants déterministes et reliés à des éléments réellement observés.

Mina utilise deux niveaux imbriqués : une session système du lancement à la fermeture de l’application, et une session de travail pour chaque activation, mission ou conversation distante authentifiée. Des hooks bornés encadrent le début, chaque tour, chaque outil, les checkpoints et la fin.

## Principes non négociables

- Une réponse de modèle est une proposition, jamais une preuve.
- Un fait important référence une source réellement ouverte ou un résultat d’outil réellement reçu.
- Une inférence, une incertitude et une absence de résultat sont affichées comme telles.
- Mina ne déclare jamais une action réussie sans observation et critère de réussite vérifié.
- Une donnée actuelle est vérifiée contre une source actuelle ; une documentation ne prouve pas l’état live.
- Une erreur, un timeout ou une sortie absente ne peut jamais être converti en succès.
- Les hooks de sécurité et de persistance sont exécutables dans le code, pas uniquement décrits dans le prompt.
- Un hook ne peut augmenter ni permission, ni budget, ni canal, ni durée.
- Une session interrompue n’est jamais reprise par répétition automatique de la dernière action.
- Les preuves, sessions et checkpoints rejoignent la mémoire locale chiffrée sans secret dans les logs techniques.

## Périmètre du grounding

Le moteur s’applique aux faits provenant d’une page, d’un fichier, d’un SMS, de Telegram ou de la mémoire ; aux informations temporellement instables ; aux comptages et recherches d’absence ; à l’état Git, base de données, Firebase, réseau, téléphone et système ; aux résultats de scripts, tests, impressions et actions UI ; ainsi qu’aux synthèses factuelles de fin de session.

Les conversations sociales, opinions annoncées et tâches créatives n’exigent pas de citation systématique. Elles restent soumises aux règles de sécurité, de confidentialité et d’identité.

## Architecture du grounding

- `mina-claim-ledger` : registre des affirmations, statuts et preuves ;
- `mina-evidence-validator` : validation de source, date, empreinte et sortie d’outil ;
- `mina-source-policy` : hiérarchie des sources selon le type d’affirmation ;
- `mina-freshness-policy` : détection des données susceptibles d’avoir changé ;
- `mina-contradiction-detector` : conflits entre sources, mémoire et état actuel ;
- `mina-action-verifier` : observation avant/après et critères de réussite ;
- `mina-response-gate` : blocage, étiquetage ou reformulation avant réponse ;
- `mina-grounding-audit` : événement chiffré expliquant le statut sans raisonnement interne.

Le modèle peut proposer des affirmations et des requêtes de vérification. Seuls ces composants attribuent les statuts finaux et autorisent leur rendu factuel.

## Registre d’affirmations

Chaque affirmation vérifiable possède :

```text
claimId
sessionId
text
claimType
status
evidenceIds[]
sourcePolicy
freshnessDeadline
sensitivity
createdAt
```

Les statuts autorisés sont :

- `verified` : preuve suffisante selon la politique de source ;
- `inference` : conclusion raisonnable mais non directement observée ;
- `uncertain` : preuves faibles, contradictoires ou incomplètes ;
- `not_found` : recherche exécutée sans résultat dans le périmètre annoncé ;
- `unsupported` : aucune preuve acceptable ;
- `stale` : preuve trop ancienne pour le type de fait.

Un score de confiance fourni par le modèle n’est jamais une preuve. Le statut dépend des sources, de leur portée, de leur fraîcheur et des validations réellement exécutées.

## Politique de preuve

### Source réellement consultée

Une citation n’est valide que si un lecteur Mina a ouvert la source et enregistré une preuve bornée : URL et horodatage, chemin et empreinte, ligne/page/section, message et conversation, ou identifiant d’appel d’outil. Une source seulement mentionnée par le modèle n’est pas citée comme consultée.

### Données actuelles et état live

Les faits susceptibles d’avoir changé déclenchent une vérification actuelle. Pour Git, base, Firebase, endpoint, téléphone ou système, la source canonique est l’outil qui interroge l’état réel. Un document, commentaire ou souvenir décrit une intention passée et ne prouve pas cet état.

### Comptages et absences

Un compte vient de la sortie exacte d’une opération mesurable. Mina distingue le nombre de correspondances du nombre d’éléments réels et contrôle un échantillon lorsque le motif peut produire des faux positifs.

Une affirmation « absent », « aucun », « seulement » ou « partout » exige une recherche couvrant le périmètre annoncé. Si ce périmètre n’a pas été couvert, la réponse devient `uncertain` ou indique sa limite.

### Contradictions

Deux sources incompatibles restent séparées. L’état live prime pour un état opérationnel, la source primaire pour un fait publié et la preuve la plus récente pour une donnée temporelle. Si cette hiérarchie ne tranche pas, Mina affiche la contradiction.

Une correction utilisateur crée une nouvelle preuve et marque l’ancien fait comme remplacé sans effacer silencieusement son historique.

## Vérification des actions

Avant une action, `mina-action-verifier` enregistre l’état observé, le résultat attendu, le critère de réussite, l’outil, la permission, le budget, la confirmation et le risque de répétition.

Après l’appel, il contrôle la sortie structurée puis effectue une nouvelle observation indépendante lorsque l’environnement le permet. Un retour `{ executed: true }` ne suffit pas.

Exemples :

- navigation : URL et contenu attendu visibles ;
- fichier : chemin, empreinte et existence après écriture ;
- impression : job accepté par la file avec identifiant, sans prétendre que la feuille physique est sortie ;
- SMS : accusés envoyé/livré selon Android et l’opérateur ; Telegram : succès API limité à `accepted`, livraison et lecture restant inconnues ;
- code : code de sortie, budgets, artefacts et tests réellement exécutés ;
- souris : changement d’état de l’interface, pas la seule absence d’erreur du clic.

Si la vérification échoue, l’action reste `unverified` ou `failed`. Mina ne répète une action non idempotente qu’après confirmation ciblée.

## Contrôle des réponses

Avant affichage, `mina-response-gate` :

1. extrait les affirmations factuelles proposées ;
2. associe les preuves présentes ;
3. applique fraîcheur, source et contradiction ;
4. retire ou reformule les affirmations `unsupported` ;
5. étiquette `inference`, `uncertain`, `not_found` et `stale` ;
6. ajoute des liens ouvrables vers les preuves autorisées ;
7. applique `mina-secret-guard` avant toute transmission distante.

Une seconde passe de modèle peut rechercher des incohérences pour un cas sensible, mais elle ne remplace jamais une preuve primaire ou un résultat d’outil.

## Sessions imbriquées

### Session système

La session système commence quand le processus principal Mina obtient le verrou d’instance et se termine à sa fermeture. Elle possède un `runtimeSessionId`, une empreinte de configuration et un journal transactionnel.

`runtime_start` exécute dans cet ordre :

1. validation minimale de la configuration et de la dernière version saine de `MINA.md` ;
2. ouverture du coffre mémoire ;
3. création ou reprise sûre du journal chiffré ;
4. analyse de la session interrompue précédente sans relancer d’action ;
5. chargement et validation du registre de skills ;
6. initialisation du noyau de sécurité et des budgets globaux ;
7. contrôles de santé bornés des fournisseurs, Firebase, ADB et Telegram ;
8. émission de `runtime_ready` ou état dégradé explicite.

Le registre des fournisseurs, les moteurs locaux et leurs états de santé sont définis dans [Mina — moteurs locaux spécialisés, routage dynamique, voix et paramètres](2026-07-14-mina-local-model-runtime-settings-design.md). Un modèle installé n’est déclaré disponible qu’après un contrôle réel du runtime et de sa capacité.

`runtime_end` refuse toute nouvelle session, termine ou annule les travaux avec délai borné, coupe les entrées et outils, écrit les derniers checkpoints, met la synchronisation Firebase en file, révoque les permissions temporaires, ferme le coffre puis marque la session terminée.

### Session de travail

Une session de travail commence pour une activation vocale suivie d’une demande, une mission UI, le premier message Telegram propriétaire après absence de session active, ou le traitement isolé d’un SMS entrant.

Elle contient `workSessionId`, canal, identité, objectif, budgets, skill actif, confirmations, contexte court, registre d’affirmations et références de preuves.

Elle se termine par objectif atteint, échec terminal, annulation, arrêt d’urgence, commande explicite ou délai d’inactivité. Telegram utilise 30 minutes d’inactivité par défaut et `/end` clôt immédiatement la session. Une nouvelle session retrouve l’historique dans la mémoire longue sans réutiliser les anciennes permissions.

Le traitement d’un SMS reste une micro-session sans skill ni outil PC et se termine après brouillon, envoi, mise en attente ou rejet.

## Hooks de cycle de vie

La liste fermée est :

```text
runtime_start
runtime_ready
work_session_start
before_turn
after_turn
before_tool
after_tool
checkpoint
work_session_end
runtime_end
```

`mina-session-manager` crée et ferme les sessions. `mina-hook-runner` exécute les hooks. `mina-session-journal` garantit ordre et idempotence. `mina-checkpoint-manager` persiste l’état récupérable.

L’ordre d’un événement est : hooks de sécurité immuables, hooks système Mina, hooks déclaratifs validés de `MINA.md`, hooks du skill actif limités à sa session, puis validation finale du noyau.

Chaque exécution possède `hookEventId`, séquence, deadline et budget. Rejouer le même identifiant ne reproduit pas un effet déjà validé.

## Capacités des hooks

Un hook peut valider des métadonnées, créer un checkpoint, demander une preuve ou confirmation, réduire un budget ou une permission, arrêter la session et produire un événement d’audit borné.

Un hook ne peut pas augmenter une permission ou un budget, changer une action après confirmation, lire un secret sans capacité dédiée, enregistrer du code permanent, contourner `mina-tool-broker`/`mina-response-gate` ou exécuter un script sur l’hôte.

Les hooks de skill existent seulement tant que le skill est actif. Un script de hook passe par Windows Sandbox et les confirmations applicables. Les hooks bloquants du noyau et du système sont des fonctions internes testées, sans modèle distant.

## Checkpoints et fin de session

Un checkpoint transactionnel est créé après validation de l’identité et des budgets, avant/après chaque outil, après chaque tour accepté, lors d’une confirmation, avant fermeture ou arrière-plan et périodiquement pendant une mission longue.

`work_session_end` :

1. bloque tout nouvel outil ;
2. attend ou annule les opérations selon leur politique ;
3. libère les capacités et références temporaires ;
4. finalise les affirmations et actions sans inventer de succès ;
5. produit localement un résumé sourcé ;
6. promeut en mémoire longue les faits avec statut et provenance ;
7. conserve incertitudes et contradictions comme telles ;
8. ajoute la synchronisation chiffrée à la file Firebase ;
9. marque la session terminée avec sa raison.

Le résumé ne bloque pas la fermeture au-delà de son budget. Si le modèle local est indisponible, Mina conserve un résumé déterministe des événements et preuves.

## Crash et récupération

Le journal est append-only logique avec écritures transactionnelles. Au démarrage, Mina détecte toute session sans événement de fin.

La récupération marque l’ancienne session `interrupted`, libère les verrous obsolètes, réconcilie les outils dont l’état est consultable, ne répète aucun envoi/impression/écriture/clic/script, présente les opérations à état final inconnu et crée une nouvelle session pour toute reprise volontaire.

Une opération idempotente peut être proposée de nouveau, mais exige une nouvelle décision et les confirmations applicables.

## Mémoire et confidentialité

Les sessions, affirmations, preuves, contradictions, checkpoints et raisons de fin rejoignent `mina-event-store`. Les données sensibles suivent le chiffrement, la rétention et l’oubli de la mémoire unifiée.

Le journal technique contient uniquement identifiants courts, types, statuts, durées et codes d’erreur nettoyés. Il ne contient ni preuve brute sensible, ni secret, ni prompt complet, ni raisonnement interne.

Une commande d’oubli supprime aussi les résumés, affirmations, preuves et index dérivés de la session concernée. Les tombstones empêchent leur retour après restauration Firebase.

## Défaillances

- preuve absente, périmée ou altérée : blocage ou statut non vérifié ;
- sources contradictoires : contradiction visible ;
- sortie d’outil invalide : action non vérifiée ;
- hook obligatoire en erreur ou timeout : opération annulée ;
- hook secondaire en erreur : état dégradé visible ;
- crash pendant une action : état interrompu, aucune répétition automatique ;
- mémoire transactionnelle indisponible : nouvelle action sensible bloquée ;
- Firebase hors ligne : checkpoint conservé localement ;
- fermeture forcée : récupération depuis le dernier journal valide ;
- résumé local impossible : résumé déterministe sans perte des événements ;
- délai Telegram atteint : fin de session, permissions révoquées et mémoire conservée.

## Tests obligatoires

Toute implémentation suit TDD : suite existante verte, test rouge, changement minimal, test vert, puis suite complète verte.

### Grounding

- fait soutenu, non soutenu, inférence, incertitude et contenu créatif ;
- source mentionnée mais non ouverte ; preuve périmée ; citation incorrecte ;
- compte exact, correspondances versus éléments et faux positifs ;
- absence avec périmètre complet puis incomplet ;
- état live différent de la documentation ;
- contradiction entre SMS, mémoire, fichier et page actuelle ;
- sortie de modèle très confiante sans preuve ;
- second modèle concordant mais sans preuve primaire ;
- secret présent dans une preuve et absent du rendu distant.

### Actions

- outil retournant succès sans changement observé ;
- clic sans effet, mauvaise URL et fichier avec mauvaise empreinte ;
- états SMS envoyés/livrés distincts, et Telegram `accepted` sans inventer livraison ou lecture ;
- impression acceptée distincte de sortie physique ;
- tests non exécutés empêchant le statut validé ;
- action non idempotente non répétée après réponse perdue.

### Sessions et hooks

- ordre exact et exécution unique de tous les hooks ;
- deux sessions de travail successives sous une session système ;
- budgets et confirmations non transférés ;
- hook de skill incapable d’ajouter un hook système ou une permission ;
- timeout et erreur à chaque étape obligatoire et secondaire ;
- checkpoint avant/après outil et reprise après crash à chaque frontière ;
- aucune répétition automatique après récupération ;
- libération souris, clavier, caméra, micro, navigateur et sandbox ;
- délai Telegram de 30 minutes avec horloge simulée et `/end` ;
- micro-session SMS sans skill ni outil PC ;
- fermeture avec Firebase indisponible et file locale intacte ;
- absence de secrets dans événements, résumés et diagnostics.

Les tests utilisent des horloges, outils, sources, modèles et transports factices. Les tests intégrés emploient seulement des pages, fichiers et comptes contrôlés. Aucun SMS, Telegram, impression ou action réelle n’est produit automatiquement.

## Critères d’acceptation

Le sous-système est prêt lorsque :

1. Mina produit une réponse factuelle avec preuves ouvrables réellement consultées ;
2. elle refuse ou étiquette une affirmation invérifiable ;
3. elle distingue fait, inférence, incertitude et absence bornée ;
4. elle vérifie le résultat réel d’une action avant de la déclarer réussie ;
5. les hooks s’exécutent dans l’ordre, une seule fois et dans leurs budgets ;
6. une session système contient plusieurs sessions de travail isolées ;
7. la fin de session libère les capacités et sauvegarde un résumé sourcé ;
8. un crash est récupéré sans répéter l’action interrompue ;
9. Telegram clôt après 30 minutes ou `/end` et SMS reste une micro-session isolée ;
10. les suites unitaires, d’intégration et de récupération sont vertes.

## Hors périmètre initial

- garantie mathématique d’absence totale d’hallucination ;
- usage d’un second modèle comme preuve ;
- citation obligatoire pour une conversation créative ou sociale ;
- reprise automatique d’une action interrompue ;
- hook arbitraire exécuté directement sur l’hôte ;
- hook de skill permanent au démarrage système ;
- transfert de permissions ou confirmations entre sessions ;
- attente réseau illimitée pendant la fermeture ;
- conservation de secrets dans les journaux techniques.

## Ordre d’implémentation recommandé

1. schémas session, hook, affirmation et preuve ;
2. journal transactionnel, identifiants et machine à états de session ;
3. hooks internes `runtime_start/end` et `work_session_start/end` ;
4. checkpoints avant/après outil et récupération sans rejeu ;
5. registre d’affirmations, validation de source et statuts ;
6. politiques de fraîcheur, état live, comptage et absence ;
7. vérificateur d’action et critères de réussite ;
8. détecteur de contradiction et porte de réponse ;
9. hooks déclaratifs `MINA.md` puis hooks du skill actif ;
10. résumés sourcés, promotion mémoire et oubli en cascade ;
11. sessions Telegram/SMS, tests de crash et durcissement.
