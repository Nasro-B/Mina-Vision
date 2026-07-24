# Mina Vision — Document source pour la vidéo NotebookLM

Document de travail à usage unique : à téléverser tel quel comme source dans NotebookLM
(Google), puis à utiliser avec le prompt de la Partie A ci-dessous, à coller dans le champ
« Personnaliser » du générateur de Video Overview. Rédigé exclusivement à partir du code et de
la documentation réels du projet (README, CHANGELOG, constitution MINA.md, guide utilisateur
intégré, code source des modules cités) — aucune fonction décrite ici n'est supposée ou
extrapolée. Les points restés ambigus après lecture des sources sont marqués « (à vérifier) ».

---

## Partie A — Prompt à coller dans NotebookLM

> Crée une vidéo complète, chapitrée et enthousiaste — mais toujours strictement factuelle,
> fondée uniquement sur les documents fournis en source, sans jamais inventer une fonction ou
> une capacité qui n'y figure pas — qui présente « Mina Vision » comme une véritable révolution :
> une assistante IA complète qui vit sur l'ordinateur de son utilisateur plutôt que dans le cloud
> d'une entreprise. La vidéo est en français, pour un public grand public et curieux de
> technologie, pas seulement pour des développeurs : vulgarise sans trahir les faits, explique
> les termes techniques (chiffrement, bac à sable, broker) en une phrase simple avant de les
> utiliser. Ton : chaleureux, enthousiaste, fier du travail accompli, mais jamais survendeur —
> chaque affirmation doit rester démontrable par les sources. Structure la vidéo en chapitres
> clairs, dans cet ordre : (1) l'idée et pourquoi c'est une révolution, (2) la voix et la
> présence temps réel, (3) les missions pilotées (navigateur, bureau Windows, téléphone Android),
> (4) la mémoire chiffrée et la conscience de soi, (5) le téléphone compagnon (application
> chiffrée, SMS, Telegram, caméra, appels), (6) Mina Code, les documents et l'apprentissage de ses
> erreurs, (7) l'organisation personnelle, les automatisations et les skills, (8) la sécurité et
> la confiance, (9) une conclusion avec le nom du créateur et le contact. Insiste tout
> particulièrement sur les mots « local », « privé » et « souverain » : la mémoire et les
> conversations de l'utilisateur ne quittent jamais sa machine, sauf choix explicite et chiffré.
> Vise une durée longue et complète qui couvre réellement l'ampleur du projet, pas un teaser de
> quatre-vingt-dix secondes. Termine en mentionnant que Mina Vision est créée par Nasro Berkoun,
> en collaboration avec Sol et Fable, sous licence source disponible qui protège ces noms.

---

## Partie B — Le récit de la révolution

### B1. L'idée

Mina Vision part d'une question simple : une assistante IA doit-elle forcément vivre dans le
cloud d'une entreprise pour être capable ? Mina Vision répond que non. C'est un agent vocal
local qui tourne entièrement sur l'ordinateur Windows de son utilisateur : elle écoute et parle
en temps réel, elle voit ce qui se passe à l'écran, et elle agit — dans le navigateur, dans
n'importe quelle application Windows, et jusque sur un téléphone Android connecté. Sa mémoire
n'est pas un journal de conversation quelque part sur un serveur : c'est un coffre chiffré dont
l'utilisateur seul détient la clé, sous la forme d'une phrase de douze mots qu'il note une seule
fois à l'initialisation. Mina Vision n'est pas un chatbot auquel on pose des questions : c'est
une paire d'yeux et de mains qui agit pour son utilisateur, sous son autorité et sous son
contrôle, à la voix comme au clavier.

### B2. Pourquoi c'est une révolution

**La souveraineté des données d'abord.** Tout tourne par défaut sur la machine de
l'utilisateur : la mémoire est un coffre chiffré local (dérivation de clé argon2, chiffrement
authentifié), et la seule façon de le rouvrir si le chiffrement Windows change (réinstallation,
migration) est une phrase de récupération que l'utilisateur est seul à connaître — il n'existe
aucune porte dérobée. Les modèles d'intelligence artificielle eux-mêmes sont un choix : cloud
(plusieurs fournisseurs, jamais un seul obligatoire), ou entièrement locaux via LM Studio, jusqu'à
un mode où aucun appel réseau d'IA n'est jamais passé.

**L'honnêteté structurelle ensuite.** Un principe traverse tout le projet : l'affichage dit la
vérité. Un domaine qui ne fonctionne pas s'affiche « indisponible » avec la dépendance exacte qui
manque — jamais un état optimiste, jamais une réponse inventée. Quand on lui demande ce qu'elle
sait faire, Mina répond depuis son état réel du moment (les skills vraiment installés, le bac à
sable disponible ou non, le téléphone connecté ou non) et non depuis une liste figée à l'avance.
Une capacité qu'elle n'a pas, elle le dit — jamais une simulation de résultat d'outil.

**La sécurité par construction.** Aucune action sur la machine ne s'exécute sans une
autorisation de session bornée dans le temps ; une action sensible exige une confirmation liée
cryptographiquement à l'action exacte, à usage unique. Les gestionnaires de mots de passe et les
outils de sécurité sont refusés au niveau du code, quelle que soit la demande formulée. Un
contenu externe non fiable — un e-mail, une page web, un message reçu — ne peut jamais accorder
de permission ni déclencher un outil de sa propre initiative.

**La continuité multi-canaux.** Une même Mina reste joignable par la voix sur le PC, par une
application téléphone en conversation chiffrée de bout en bout, par SMS (y compris sans
connexion internet), et par Telegram — chaque canal recevant exactement le périmètre de
confiance que son identité peut réellement garantir : large en local à la voix, strictement
borné à la conversation par SMS ou Telegram, jamais un accès direct au PC depuis un canal dont
l'identité peut être imitée.

**L'auto-analyse et l'apprentissage.** Mina s'audite elle-même : elle indexe et relit son propre
code, lance ses propres tests, se soumet à une revue de sécurité — sans jamais pouvoir publier
(« push ») une modification. Chaque échec technique réel devient une leçon appliquée avant la
prochaine opération semblable, jamais une capacité en plus inventée après coup.

### B3. Le point SMS — joignable sans aucune connexion internet

Un SMS voyage par le réseau cellulaire ordinaire, pas par une connexion de données : n'importe
qui peut envoyer un texto au téléphone-passerelle de Mina et recevoir sa réponse sans avoir
besoin de Wi-Fi ni de forfait data sur son propre téléphone — exactement comme un SMS classique.
Le message atteint ensuite l'ordinateur par câble USB ou par le réseau local, et s'il ne peut
emprunter ni l'un ni l'autre, un relais chiffré prend le relais le temps que la connexion directe
revienne. Par prudence, un numéro qui écrit par SMS n'obtient jamais, par cette seule identité,
un accès au PC, aux fichiers ou aux outils : une identité de canal aussi facilement imitable
qu'un numéro de téléphone ne se transforme jamais en autorisation d'agir sur la machine — ce
canal reste volontairement limité à la conversation et à un brouillon de réponse.

---

## Partie C — Catalogue exhaustif des fonctions

### 1. Voix temps réel, interruption et repli local

Mina écoute en continu une fois activée, comprend la parole et répond avec une voix naturelle et
chaleureuse, en temps réel — la conversation ressemble à un échange, pas à un enchaînement de
questions-réponses figées. On peut la couper en pleine phrase : elle se tait immédiatement et
continue d'écouter, sans jamais perdre le fil de la conversation en cours. Si le service vocal
principal a un incident, une voie de secours prend le relais et la réponse est malgré tout
toujours prononcée par un moteur de synthèse vocale local, sans dépendre d'un service extérieur
pour simplement parler.

*Exemple : dire « stop », « chut » ou « tais-toi » coupe la parole de Mina sur-le-champ, à
n'importe quel moment de sa phrase.*

### 2. Modèles d'intelligence artificielle 100 % locaux (LM Studio)

Mina peut fonctionner avec des modèles hébergés entièrement sur la machine, sans aucune clé
cloud, pour trois usages indépendants : la conversation elle-même, l'analyse d'images ou de
captures d'écran, et la recherche sémantique dans la mémoire. Un réglage global choisit la
priorité — local d'abord avec repli cloud, ou un mode strictement local où aucun appel réseau
d'intelligence artificielle n'est jamais émis. C'est optionnel : Mina démarre normalement sans
modèle local et bascule alors sur le cloud.

### 3. Missions Computer Use — navigateur, bureau Windows, téléphone Android

Une instruction en texte ou à la voix devient une mission : Mina observe l'écran, propose une
action à la fois — un clic, une saisie, une navigation, le lancement de n'importe quelle
application Windows — puis chaque action passe par une validation, une confirmation si
nécessaire, une exécution, et enfin une vérification que l'effet réel s'est bien produit. Jamais
d'action à l'aveugle. La même logique s'étend au bureau Windows dans son ensemble et à un
téléphone Android connecté. Une panne réseau ou technique est réessayée automatiquement ; un
refus de sécurité ne l'est jamais.

*Exemple : « Mina, ouvre YouTube et cherche une recette » lance directement la mission dans le
bon environnement, sans formulaire à remplir.*

### 4. Pilotage vocal des pages déjà ouvertes

Pendant qu'une page reste ouverte — une recherche, une vidéo en cours — les phrases suivantes la
pilotent directement plutôt que de relancer une recherche à chaque fois : changer de titre,
mettre en pause, passer à la suite. Une instruction dite pendant qu'une mission tourne déjà
n'ouvre jamais une seconde mission concurrente : elle est transmise à la mission en cours, dans
la même fenêtre, à la souris et au clavier. La compréhension n'est pas un lexique figé : des
formulations jamais répertoriées sont comprises tout aussi bien.

*Exemples réels : « mets cheb hasni », « la chanson 2 », « mets sur pause », « chanson suivante »,
ou encore « balance-moi du raï » et « fous la vidéo en pause ».*

### 5. Mémoire chiffrée, recherche et continuité entre sessions

Tout ce qu'on dit à Mina est mémorisé avec sa source, son canal et sa date, dans un coffre
chiffré local. Cette mémoire ne repart jamais de zéro : elle se déverrouille automatiquement à
chaque démarrage et reste consultable et cherchable d'une session à l'autre. Sur une tâche
longue, le contexte est automatiquement compacté — rien n'est perdu, seulement résumé. Une
recherche dans cette mémoire, comme une lecture de fichier ou de page web, sert toujours de
preuve citée : jamais une affirmation sans source.

### 6. Conscience de soi — un modèle d'elle-même fondé sur des faits

Mina tient un modèle d'elle-même dérivé uniquement d'événements réels de son fonctionnement —
jamais un texte qu'elle inventerait sur son propre compte. Elle sait à tout moment quels skills
sont vraiment installés, si le bac à sable est disponible, si un téléphone est connecté, si sa
mémoire est déverrouillée, et peut décrire ses propres outils vocaux ainsi que ses réglages non
sensibles. Interrogée sur ce qu'elle sait faire, sa réponse est composée depuis cet état réel du
moment, jamais depuis une liste préécrite.

*Exemple : « que sais-tu faire », ou « quels sont tes outils/compétences/skills ».*

### 7. Application Mina sur téléphone — conversation chiffrée de bout en bout

Une application Android permet d'écrire à Mina depuis un téléphone appairé. L'appairage se fait
une fois : sur le PC, un code à six chiffres s'affiche, valable cinq minutes et une seule
utilisation ; sur le téléphone, on saisit l'adresse du PC et ce code — être sur le même Wi-Fi ne
suffit pas à lui seul. La clé de conversation n'est jamais transmise telle quelle : elle est
enveloppée par une clé dérivée d'un échange cryptographique entre les deux appareils, si bien
qu'un observateur du réseau qui capterait tout l'appairage ne pourrait pas la reconstituer.
Chaque message est signé, et cette signature est vérifiée avant toute tentative de
déchiffrement. Le téléphone ne stocke que du texte chiffré ; si la mémoire du PC est verrouillée,
l'application l'annonce clairement au lieu de laisser croire qu'elle attend une réponse. Si le PC
est éteint, le message part dans une file d'attente sur le téléphone et repart dès le retour du
PC — rien n'est perdu, et personne ne répond à la place de Mina. Un message reçu deux fois (une
retransmission réseau) ne déclenche jamais deux réponses. Le chemin normal passe par le réseau
local ; quand le téléphone est ailleurs (4G, autre Wi-Fi), un relais chiffré prend le relais sans
jamais voir le contenu en clair. Révoquer un appareil ouvre une nouvelle génération de clé : il ne
lit plus les messages suivants.

### 8. Verrou biométrique du téléphone

Sur le téléphone, un verrou optionnel exige l'empreinte ou le visage avant d'afficher la
conversation — une barrière locale utile si le téléphone déverrouillé est prêté ou emprunté. Si
aucune biométrie n'est enregistrée sur l'appareil, le verrou reste sans effet plutôt que
d'enfermer l'utilisateur dehors : on ne peut jamais se retrouver bloqué par cette protection.

### 9. SMS — réception, réponse confirmée, garde-fous

Le téléphone-passerelle reçoit les SMS et Mina peut préparer une réponse, mais l'envoi réel exige
toujours une confirmation locale au préalable. Les envois automatiques, quand ils sont activés,
restent encadrés par une liste de numéros autorisés, des heures calmes, et des plafonds d'envoi
par minute et par jour. Ce canal reste volontairement réduit à la conversation et au brouillon de
réponse : jamais d'accès au PC, aux fichiers, aux skills, au bac à sable, à l'e-mail ou à la
maison connectée depuis un SMS, quel que soit l'expéditeur.

### 10. httpSMS — passerelle de secours quand le téléphone est hors ligne

Quand le téléphone-passerelle est injoignable, un service de secours optionnel (httpSMS, cloud ou
auto-hébergé) prend le relais pour continuer à envoyer et recevoir des SMS. Sans configuration,
Mina utilise uniquement le SMS natif du téléphone appairé — httpSMS n'ajoute rien tant qu'il n'est
pas explicitement activé. Chaque appel entrant de ce service est vérifié par signature avant
d'être traité ; un appel non signé est purement et simplement rejeté.

### 11. Telegram

Mina peut converser en privé avec son propriétaire via un bot Telegram, avec mémoire et rappel
autorisés par défaut. Les bots Telegram ne sont pas chiffrés de bout en bout et ne garantissent
aucun accusé de lecture fiable : Mina ne prétend jamais qu'un message a été lu, seulement qu'il a
été transmis. Des capacités distantes supplémentaires ne s'ajoutent que si elles ont été activées
et bornées explicitement depuis l'écran du PC ; le contrôle du PC ou du bac à sable reste
absolument hors de portée de ce canal.

### 12. Caméra du téléphone — avant et arrière

Un flux vidéo signé depuis le téléphone appairé, objectif avant ou arrière au choix, avec bascule
automatique si l'image reçue est noire ou floue, et arrêt possible à tout moment. L'adresse
réseau du téléphone n'est jamais affichée à l'écran.

### 13. Détection du téléphone — USB et Wi-Fi

« Détecter le téléphone » cherche l'appareil aussi bien par câble USB que par Wi-Fi : sur
Android 11 et plus, Mina découvre un téléphone dont le débogage sans fil est actif et s'y
connecte sans câble, après avoir vérifié son identité signée. Un second appareil peut rester
connecté en Wi-Fi en parallèle. Mina retrouve la dernière adresse connue si l'annonce réseau
devient silencieuse, toujours avec une nouvelle vérification d'identité avant de faire confiance.

### 14. Garde d'appels téléphoniques — le composeur, jamais le décroché

Pour passer un appel, le mode par défaut ouvre simplement le composeur du téléphone, pré-rempli :
c'est toujours l'humain qui appuie sur le bouton d'appel, Mina n'émettant jamais d'appel
automatique dans ce mode. Des modes plus permissifs existent (confirmation à l'écran avant
chaque appel, ou appel automatique vers une liste de numéros autorisés dans une fenêtre horaire
et sous un plafond quotidien) mais restent verrouillés derrière plusieurs conditions cumulatives :
retirer une seule condition suffit à repasser en confirmation humaine. Répondre à un appel
entrant à la place de l'utilisateur n'existe dans aucun mode : Mina ne décroche jamais.

### 15. Mina Code — Mina s'analyse elle-même

Mina indexe et analyse son propre code source (pas un projet externe) : recherche de symboles,
graphe d'appels, statut Git, lancement de ses propres tests, revue de code et scanner de
sécurité. La lecture et l'analyse ne demandent pas de confirmation ; toute écriture de fichier en
demande une, et la fonctionnalité « push » Git est structurellement absente du code — pas
seulement désactivée, elle n'existe pas.

*Exemples de commandes vocales : « analyse le code », « cherche un symbole dans le code »,
« statut Git », « lance les tests », « revue du code ».*

### 16. Génération de documents PDF et Word

« Génère-moi un PDF ou un Word sur… » : Mina rédige le contenu et crée un vrai fichier, avec
pagination automatique pour les PDF, rangé dans un dossier dédié de documents avec un nom
horodaté — jamais l'écrasement d'un fichier déjà existant.

### 17. Documents reçus, quarantaine et mode urgence

Les documents reçus passent par une réception en quarantaine avant classification, sans jamais
écraser l'original. Un mode urgence permet de couper d'un seul geste le réseau et les
automatisations externes.

### 18. Analyseur d'erreurs techniques

Chaque erreur technique que Mina relit à voix haute vient accompagnée d'une explication en
français et d'un remède concret — jamais un code d'erreur brut réservé aux développeurs.

*Commande vocale : « lis-moi les erreurs techniques ».*

### 19. Leçons — apprendre de ses propres erreurs

Chaque échec technique réel (délai dépassé, ressource indisponible, refus de sécurité) devient
une leçon appliquée avant la prochaine opération semblable : ralentir, changer de voie, ou
revérifier — jamais une capacité supplémentaire inventée après coup. Une leçon se met en veille
après plusieurs succès d'affilée, et toute rechute la réactive aussitôt.

### 20. Journal d'activité à double couche

Le journal technique garde une trace des événements (compteurs, horodatages) sans jamais écrire
de texte de conversation en clair sur le disque : le contenu intégral n'est déchiffrable qu'avec
la clé du coffre mémoire, au moment où celui-ci est déverrouillé. Coffre fermé, le journal le dit
honnêtement plutôt que d'afficher un contenu inventé.

### 21. Bac à sable Windows — exécution de code isolée

Mina peut exécuter du code Python, JavaScript ou PowerShell, mais jamais directement sur la
machine réelle : uniquement dans un Windows Sandbox jetable, une machine virtuelle temporaire
détruite à la fin de chaque exécution. Cette machine virtuelle n'a accès ni au réseau, ni au
presse-papiers, ni à l'imprimante, ni à la caméra, ni au microphone, ni au profil de
l'utilisateur. Écrire dans son espace de travail et lancer une exécution demandent deux
confirmations distinctes. Si Windows Sandbox n'est pas activé ou qu'un composant manque, Mina
l'indique clairement plutôt que d'exécuter quoi que ce soit sur l'hôte.

### 22. Organisation personnelle — mail, tâches, agenda, contacts

Dans une section dédiée, Mina présente tâches, événements et contacts, chacun avec sa source et
sa date d'observation — une information vieille de plus de vingt-quatre heures est signalée comme
telle plutôt que présentée comme à jour. Un compte Google (Gmail, Calendrier, Contacts, Tâches)
peut être connecté par le consentement officiel Google, ouvert dans le propre navigateur de
l'utilisateur : Mina ne voit jamais le mot de passe de ce compte. Un panneau e-mail dédié permet
de retrouver les comptes connectés et d'y effectuer une recherche.
*(à vérifier : au moment de la rédaction de ce document, la connexion d'un compte Google
enregistre bien les accès de façon chiffrée, mais le branchement complet de ces données dans les
réponses quotidiennes de Mina restait, selon la documentation interne, un chantier encore en
cours de finalisation plutôt qu'une fonction entièrement terminée.)*

### 23. Maison connectée

Mina peut lister des appareils domestiques, vérifier la santé de ses connecteurs et exécuter une
commande simple, avec des connecteurs prévus vers des solutions domotiques usuelles. Fidèle au
principe d'honnêteté du projet, ce domaine s'affiche pour l'instant comme dégradé tant qu'aucun
connecteur n'est réellement configuré par l'utilisateur — jamais une fausse liste d'appareils
inventée pour faire joli.

### 24. Automatisations gouvernées

Les définitions d'automatisation, leur historique de récupération et des sondes de santé sont
consultables depuis l'interface. La création ou le changement d'état d'une automatisation reste
volontairement réservé au processus principal de l'application, jamais accessible depuis un
canal distant.

### 25. Skills — des compétences additionnelles, installées une par une

Des compétences supplémentaires peuvent être chargées depuis un fichier de définition audité et
signé. Elles doivent être installées une par une depuis la section dédiée avant de devenir
utilisables : Mina n'en a aucune tant qu'elles n'ont pas été installées, même si les fichiers
existent sur le disque. Un skill ne peut jamais élargir ses propres capacités ni exécuter un
script directement sur la machine de l'utilisateur.

### 26. Analyses IA vérifiées — coûts et tokens réels

Les jetons et les coûts réellement consommés sont suivis par fournisseur et par période, et
peuvent être exportés — jamais une estimation présentée comme un fait acquis.

### 27. Thème jour et nuit

Un bouton dans l'en-tête ou une commande vocale bascule entre les deux thèmes, avec le même
niveau de soin apporté aux deux.

*Commandes vocales : « je veux la version nuit », « version jour ».*

### 28. Démarrage avec Windows et zone de notification

Une case dans les réglages active le lancement automatique de Mina à l'ouverture de la session
Windows, de façon discrète et sans voler le focus — réversible en un clic, et sans élévation de
droits ni tâche système. Fermer la fenêtre principale ne quitte pas Mina : elle se réduit dans la
zone de notification et continue d'écouter et de surveiller ses passerelles en arrière-plan ; un
clic droit sur son icône permet de la rouvrir ou de vraiment la quitter.

### 29. Arrêt d'urgence

Un raccourci clavier global, actif même quand la fenêtre n'a pas le focus, annule immédiatement
missions, recherches, envois et travaux en cours dans le bac à sable ; dire « Mina, arrête »
produit le même effet. Cet arrêt est prioritaire sur toute file d'attente, confirmation ou
automatisation en cours, et rien ne redémarre tout seul après un arrêt.

*Raccourci : Ctrl + Alt + Échap.*

### 30. Les interdits structurels — pas des bugs, des règles

Une liste de choses que Mina ne fait jamais, par construction et non par oubli : elle ne contrôle
jamais directement la souris ou le clavier sans passer par validation, confirmation puis
vérification de l'effet réel ; elle ne coupe jamais le Wi-Fi, un adaptateur réseau ou le pare-feu
Windows ; elle ne simule jamais un résultat d'outil ; elle ne réessaie jamais automatiquement une
action refusée par un garde-fou de sécurité ; elle ne voit, n'affiche, ne journalise et n'envoie
jamais un mot de passe ou un secret à un modèle ou à un skill ; elle ne crée jamais de compte à la
place de l'utilisateur et n'entre jamais un mot de passe pour lui ; un changement de sa
constitution ne s'applique jamais à chaud, seulement après confirmation locale et une nouvelle
session.

---

## Partie D — Sécurité & confiance

**Le chiffrement, de bout en bout où c'est possible.** La mémoire locale est protégée par une
dérivation de clé argon2 et un chiffrement authentifié ; la phrase de récupération de douze mots
n'est affichée qu'une seule fois, jamais journalisée. Le journal d'activité chiffre le texte
intégral des conversations avec une clé dérivée du coffre au déverrouillage (AES-256-GCM) — sans
ce coffre ouvert, le contenu reste inaccessible, y compris à Mina elle-même. La conversation avec
le téléphone compagnon utilise un échange de clé cryptographique (ECDH sur courbe P-256) pour que
la clé de conversation ne transite jamais en clair sur le réseau, chaque message étant en plus
signé et cette signature vérifiée avant toute tentative de déchiffrement. Révoquer un appareil
fait passer la conversation dans une nouvelle génération de clé (une nouvelle « époque ») :
l'appareil révoqué ne lit plus rien de ce qui suit, sans prétendre effacer ce qu'il a déjà lu. La
rotation des clés du coffre est atomique : une interruption en cours de route reprend au dernier
lot confirmé, sans jamais de perte silencieuse.

**Une autorité unique pour chaque action.** Aucune action sur la machine — un clic, une frappe,
un lancement d'application — n'atteint jamais l'exécuteur sans passer par un composant central,
le capability broker, qui vérifie l'autorisation de la session en cours et exige une confirmation
liée cryptographiquement à l'action exacte pour tout ce qui est sensible, une confirmation qui ne
peut servir qu'une seule fois. Un contenu externe non fiable — page web, e-mail, message reçu, ou
même un skill installé — reste une donnée à lire, jamais une instruction cachée capable de
déclencher un outil de sa propre initiative. Des interdits durs, comme l'usage de gestionnaires
de mots de passe ou d'outils de sécurité, sont refusés au niveau du code lui-même, quelle que soit
la façon dont la demande est formulée.

**La confidentialité par défaut.** Une politique anti-usurpation d'adresses web refuse les
adresses privées, les boucles locales et les adresses de métadonnées cloud lors d'une recherche
en ligne. Le journal d'audit interne est lui-même chiffré et chaîné par empreinte cryptographique,
de sorte qu'une entrée manquante ou modifiée reste détectable.

**Une licence qui protège le nom et l'attribution.** Mina Vision est publiée sous une licence
source disponible : l'usage, l'étude, la modification et la redistribution sont largement
autorisés, mais les noms « Mina », « Mina Vision » et « Nasro Berkoun » sont des éléments protégés
qui ne peuvent être ni retirés, ni remplacés, ni détournés dans le logiciel lui-même. Une version
dérivée publiée doit porter un nom distinct et créditer clairement l'origine : « Basé sur Mina
Vision, créé par Nasro Berkoun, en collaboration avec Sol et Fable ».

**Contact et service client.** Pour toute réclamation, question ou demande dépassant le cadre de
la licence : mina.vision.ai@gmail.com.

---

## Partie E — Plan de montage suggéré

Chapitrage indicatif pour une vidéo longue et complète (environ quatorze minutes) ; les minutages
sont des repères, pas des contraintes strictes pour NotebookLM.

**00:00 – 00:40 — Ouverture**
- Accroche : « Et si votre assistante IA vivait chez vous, et seulement chez vous ? »
- Nom du projet à l'écran : Mina Vision.
- Promesse de la vidéo : tout ce qu'elle fait réellement, rien de plus.

**00:40 – 02:30 — Chapitre 1 : L'idée et la révolution**
- Un agent vocal local, pas un chatbot cloud.
- Les cinq piliers : souveraineté, honnêteté structurelle, sécurité par construction, continuité
  multi-canaux, auto-analyse et apprentissage.
- Visuel suggéré : coffre chiffré, phrase de récupération, panneau « Capacités » avec des états
  honnêtes (disponible / dégradé / indisponible).

**02:30 – 03:30 — Chapitre 2 : La voix et la présence**
- Conversation temps réel, interruption immédiate, voix chaleureuse.
- Repli local pour la synthèse vocale ; modèles 100 % locaux en option via LM Studio.
- Démonstration suggérée : couper Mina en pleine phrase, elle se tait et écoute.

**03:30 – 06:00 — Chapitre 3 : Les missions pilotées**
- Navigateur, bureau Windows (n'importe quelle application), téléphone Android.
- Le cycle validation → confirmation → exécution → vérification, jamais d'action à l'aveugle.
- Pilotage vocal d'une page déjà ouverte (musique, recherche en cours).
- Démonstration suggérée : « Mina, ouvre YouTube et cherche une recette », puis « chanson
  suivante » pendant la lecture.

**06:00 – 06:45 — Chapitre 4 : Mémoire et conscience de soi**
- Mémoire chiffrée, recherche, continuité entre sessions.
- Le self-model : Mina décrit son état réel, jamais une liste figée.

**06:45 – 09:15 — Chapitre 5 : Le téléphone compagnon**
- Application chiffrée de bout en bout, appairage par code à six chiffres.
- Verrou biométrique optionnel.
- SMS et le point clé : joignable sans aucune connexion internet.
- httpSMS en secours, Telegram, caméra avant/arrière, détection USB et Wi-Fi.
- Garde d'appels : le composeur, jamais le décroché.
- Visuel suggéré : schéma simple du chemin d'un SMS (réseau cellulaire → téléphone-passerelle →
  PC), et de la conversation chiffrée (clé jamais transmise en clair).

**09:15 – 10:30 — Chapitre 6 : Mina Code, documents et apprentissage**
- Mina Code : auto-analyse, tests, revue de sécurité, jamais de push.
- Génération de vrais PDF et Word ; documents reçus mis en quarantaine.
- Analyseur d'erreurs en français ; les leçons apprises de ses propres échecs.
- Journal d'activité à double couche : jamais de texte en clair sur le disque.

**10:30 – 11:30 — Chapitre 7 : Organisation, automatisations et skills**
- Bac à sable Windows pour exécuter du code sans risque, sans réseau.
- Organisation personnelle (tâches, agenda, contacts, e-mail) et maison connectée honnêtement
  affichée « dégradée » sans connecteur.
- Automatisations gouvernées et skills installés un par un.
- Analyses IA vérifiées (coûts et tokens réels).

**11:30 – 12:15 — Chapitre 8 : Le confort du quotidien**
- Thème jour/nuit, démarrage avec Windows, zone de notification.
- Arrêt d'urgence global (Ctrl + Alt + Échap ou « Mina, arrête »).

**12:15 – 13:30 — Chapitre 9 : Sécurité et confiance**
- Le broker comme autorité unique de chaque action.
- Chiffrement (AES-256-GCM, ECDH, époques de clé, signature des événements).
- Les interdits structurels : jamais de mot de passe vu, jamais de push, jamais de fausse
  interface.
- La licence : noms protégés, usage et étude libres.

**13:30 – 14:00 — Conclusion**
- Rappel de la promesse : une assistante capable, mais chez vous et pour vous.
- Créateur : Nasro Berkoun, en collaboration avec Sol et Fable.
- Contact : mina.vision.ai@gmail.com.
