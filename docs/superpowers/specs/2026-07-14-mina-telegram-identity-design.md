# Mina — canal Telegram propriétaire et identité téléphonique

> Extension multi-téléphones validée : le Samsung est le terminal Telegram de Nasro et le Huawei reste la passerelle fixe. Voir `2026-07-14-mina-multi-device-connectivity-design.md`. Le domaine e-mail pilotable depuis Telegram est défini dans `2026-07-14-mina-email-gateway-design.md`.

**Statut :** design validé section par section par Nasro le 14 juillet 2026. Cette spécification doit être relue avant la rédaction du plan d’implémentation.

## Objectif

Permettre à Nasro de converser avec Mina depuis Telegram sur son téléphone, sans ouvrir le contrôle du PC à un canal distant. Mina doit reconnaître de façon vérifiée le compte Telegram propriétaire et les numéros personnels utilisés pour lui envoyer des SMS.

La première version accepte le texte et les notes vocales, répond en texte, consulte uniquement la mémoire transmissible et expose des commandes bornées. Le Huawei connecté sert de passerelle Telegram principale. Le token BotFather sera créé plus tard par Nasro et ne sera jamais placé dans le code, Git, `MINA.md`, les logs ou la mémoire conversationnelle.

## Principes non négociables

- Conversation Telegram privée avec le propriétaire vérifié uniquement.
- L’identité repose sur l’identifiant Telegram numérique et une preuve d’appairage, jamais sur le nom ou le `@username`.
- Un numéro SMS n’est propriétaire qu’après vérification croisée et normalisation E.164.
- Le Huawei est l’unique consommateur des mises à jour du bot ; aucun polling concurrent sur le PC.
- Le token est stocké dans Android Keystore après provisionnement local.
- Le téléphone persiste chaque mise à jour avant de l’accuser ou de la transférer.
- USB puis LAN puis Firebase chiffré sont utilisés ; Firebase ne reçoit pas le message Telegram en clair.
- Telegram ne peut invoquer ni outil PC, ni sandbox, ni skill d’action, ni export.
- Les secrets et souvenirs sensibles ne sont jamais renvoyés dans Telegram.
- Une réponse de modèle et un accusé d’API suivent le grounding ; « envoyé » ne signifie pas « livré » ou « lu ».
- L’arrêt d’urgence coupe les sessions et sorties Telegram sans supprimer les entrées déjà persistées.

## Limites de confidentialité Telegram

Les conversations avec un bot Telegram ne sont pas chiffrées de bout en bout. Telegram traite donc le contenu envoyé au bot. Mina réduit les expositions supplémentaires : aucune Cloud Function ne reçoit le texte en clair et les données sensibles ne sont pas transmises automatiquement à Gemini, OpenRouter ou Modal.

Le canal affiche cette limite pendant l’appairage et via `/help`. Un message sensible peut être conservé chiffré localement selon la politique de mémoire totale, mais sa réponse utilise un traitement local ou reste bloquée si aucun traitement local compatible n’est disponible.

## Architecture

- `mina-telegram-android` : Bot API, polling, téléchargement borné et envoi des réponses ;
- `mina-telegram-store` : file Room chiffrée, offsets et états Android ;
- `mina-owner-identity` : compte propriétaire, numéros vérifiés et révocations ;
- `mina-telegram-policy` : formats, commandes, quotas, sensibilité et interdictions ;
- `mina-phone-transport` : enveloppes chiffrées et sélection USB/LAN/Firebase ;
- `mina-telegram-channel` : adaptateur desktop vers sessions, mémoire et modèles ;
- `mina-telegram-session` : session de travail Telegram et délai d’inactivité ;
- `mina-local-asr` : transcription locale interchangeable des notes vocales ;
- `mina-telegram-renderer` : échappement, découpage et suivi des réponses ;
- `mina-telegram-audit` : événements techniques nettoyés et mémoire chiffrée.

`mina-sms-link` et Telegram partagent les primitives de `mina-phone-transport`, mais conservent des politiques, files et schémas distincts. Un message Telegram ne peut jamais être interprété comme un SMS et inversement.

## Flux principal

```text
Telegram Bot API
  -> Huawei Mina Android
  -> persistance locale chiffrée
  -> enveloppe authentifiée
  -> USB / LAN / Firebase chiffré / attente locale
  -> identité propriétaire + politique Telegram
  -> session de travail + mémoire autorisée + grounding
  -> réponse chiffrée vers le Huawei
  -> Bot API Telegram
```

Le téléphone confirme un offset Telegram uniquement après persistance durable. Le PC accuse l’enveloppe après ingestion idempotente. Le téléphone supprime sa copie transport seulement après accusé final et conserve l’état nécessaire à la déduplication.

## Bot et token

Nasro crée le bot final plus tard avec BotFather. Un bot distinct est utilisé pendant les tests supervisés.

Le provisionnement final suit ce flux :

1. saisie du token dans une fenêtre locale protégée ;
2. validation bornée avec `getMe` et affichage de l’identité du bot ;
3. confirmation par Nasro ;
4. transfert chiffré au Huawei appairé, de préférence par USB ;
5. stockage dans Android Keystore ;
6. effacement des buffers et champs desktop ;
7. démarrage du polling Android après contrôle de l’absence de webhook actif.

Le PC ne persiste pas le token après provisionnement. Une rotation exige un nouveau token BotFather, une confirmation locale et un nouveau provisionnement. Une révocation supprime l’entrée Keystore et arrête le canal.

Le service utilise `getUpdates` avec une liste fermée de types utiles. Webhook et polling ne sont jamais actifs simultanément. Un webhook inconnu, un conflit de consommateur ou une réponse d’authentification invalide arrête le canal et demande une rotation ou une réparation locale.

Le polling rejoint le service de premier plan Mina déjà prévu sur Android au lieu de créer un second service permanent. Room conserve l’offset et WorkManager réarme le traitement après redémarrage. Les réglages EMUI de démarrage automatique et d’activité en arrière-plan restent vérifiés pendant l’installation.

## Appairage propriétaire

### Compte Telegram

Mina génère localement 256 bits aléatoires encodés en base64url, utilisables dans un paramètre `/start` de longueur compatible. Le jeton est à usage unique, valable 10 minutes et conservé uniquement sous forme d’empreinte.

1. Mina affiche localement un QR code et un lien vers le bot ;
2. Nasro ouvre la conversation privée et valide `/start <jeton>` ;
3. le Huawei transmet la demande d’appairage au PC ;
4. Mina vérifie jeton, expiration, usage, type de chat et identifiant expéditeur ;
5. le bot présente un bouton de partage volontaire du contact ;
6. Mina exige que le `user_id` du contact corresponde à l’expéditeur ;
7. une confirmation locale finalise l’identité Telegram.

Avant appairage, seul un `/start` portant un jeton valide est traité. Tous les autres messages sont ignorés sans exposer l’état du système.

### Numéro SMS propriétaire

Le numéro partagé est normalisé au format E.164 et reste candidat tant qu’il n’est pas vérifié.

Mina génère un code à six chiffres avec générateur cryptographique, valable 10 minutes et limité à cinq tentatives. Le code est affiché dans Telegram puis envoyé par Nasro au Huawei depuis le numéro à reconnaître. La réception associe l’expéditeur E.164 au compte propriétaire si code, délai et tentative sont valides.

Si Telegram et la SIM à reconnaître sont sur le même téléphone et que l’envoi à soi-même est impossible, la preuve alternative exige simultanément : contact Telegram partagé, Huawei physiquement appairé et confirmation locale sur le PC montrant le numéro exact.

Plusieurs numéros propriétaires peuvent être ajoutés par la même procédure. Chaque numéro possède méthode, date, appareil de preuve et état `active`, `revoked` ou `pending`. Un nom de contact Android ne constitue jamais une preuve.

### Identité persistée

L’enregistrement chiffré contient :

```text
ownerId
telegramUserId
telegramPrivateChatId
verifiedPhoneNumbers[]
pairingMethod
verifiedAt
revokedAt
```

Les identifiants sont comparés comme entiers sûrs ou chaînes décimales exactes, jamais convertis de façon susceptible de perdre de la précision. Modifier le compte propriétaire ou supprimer le dernier numéro exige une confirmation locale.

## Formats et commandes

Après activation locale explicite, le propriétaire vérifié peut recevoir les capacités bornées `home.read` et `home.low_risk` définies dans [Mina — maison connectée locale et Google Home](2026-07-14-mina-smart-home-design.md). Elles n’accordent aucun outil PC général. Les actions moyennes exigent une confirmation locale et les actions élevées restent bloquées par défaut.

### Formats initiaux

- texte UTF-8 borné à 8 Kio après normalisation ;
- note vocale de 2 minutes et 10 Mio maximum ;
- réponse texte découpée selon les limites courantes de Telegram ;
- contact uniquement pendant l’appairage demandé par Mina.

Photos, vidéos, documents, localisations, stickers, messages transférés et autres contacts sont refusés dans la première version. Une URL reste du texte non fiable et n’est jamais ouverte automatiquement.

`mina-local-asr` transcrit les notes vocales sur le PC avec un moteur local chargé à la demande. L’audio est transféré chiffré, vérifié par type détecté et supprimé du cache transport après ingestion. Aucun fallback cloud silencieux n’est autorisé.

### Commandes

- `/help` : capacités, confidentialité et limites ;
- `/status` : état minimal du canal et disponibilité de Mina ;
- `/memory <requête>` : recherche de mémoire non sensible avec provenance bornée ;
- `/forget <requête>` : prépare une demande d’oubli, sans l’exécuter ;
- `/end` : ferme immédiatement la session Telegram.

Les commandes inconnues affichent l’aide sans suggérer d’outils interdits. Les alias, commandes éditées et callbacks sont normalisés puis validés par schéma.

## Sessions et mémoire

Le premier message propriétaire ouvre une session de travail Telegram. Elle se termine après 30 minutes d’inactivité, `/end`, révocation, erreur terminale ou arrêt d’urgence.

Une nouvelle session peut interroger la mémoire longue, mais ne récupère ni confirmation, ni permission, ni skill de la session précédente. Les événements Telegram, transcriptions, réponses et preuves rejoignent la mémoire locale chiffrée avec `sourceType: telegram`.

Les messages sont conservés sans expiration automatique selon le choix de mémoire totale locale. La file de transport Android/Firebase reste distincte : chaque enveloppe distante est supprimée après accusé et une purge élimine tout reliquat après 24 heures maximum.

## Politique de réponse

Le canal peut :

- converser sur du contenu non sensible ;
- rechercher et résumer la mémoire non sensible ;
- fournir des preuves autorisées ;
- exécuter des skills de classe `instruction` ;
- préparer une demande ou un brouillon sans l’envoyer ailleurs ;
- invoquer le domaine borné `mail.*` pour le propriétaire vérifié, y compris lecture, classement et envoi selon le mode e-mail actif défini dans `2026-07-14-mina-email-gateway-design.md` ;
- afficher un statut minimal.

Le canal ne peut pas :

- contrôler souris, clavier, navigateur actif, caméra, téléphone ou imprimante ;
- lire librement les fichiers du PC ;
- exécuter un script ou ouvrir la sandbox ;
- exporter, télécharger ou joindre un fichier hors des opérations e-mail explicitement bornées par la politique mail ;
- envoyer un SMS ou message à un tiers hors du domaine e-mail autorisé ;
- confirmer une suppression, un oubli, une dépense ou une action PC ;
- renvoyer OTP, mot de passe, clé, donnée bancaire, médicale ou document privé.

`/forget` produit une proposition visible sur le PC. L’oubli n’est exécuté qu’après confirmation locale. Une information sensible retrouvée renvoie une indication générique invitant à ouvrir Mina localement, sans révéler son contenu ni confirmer inutilement sa nature.

Les messages non sensibles peuvent être envoyés au profil de modèle configuré après `mina-secret-guard`. Activer le canal vaut autorisation continue pour ce contenu strictement nécessaire. Un message classé sensible reste local ; si aucun modèle local compatible n’est disponible, Mina explique le blocage.

## Fonctionnement lorsque le PC est hors ligne

Le Huawei continue le polling et persiste les messages. Il peut envoyer une réponse déterministe minimale : « Mina est hors ligne, message enregistré. » Aucun modèle, mémoire PC ou outil n’est appelé.

Au retour du PC, les enveloppes sont transférées dans l’ordre, dédupliquées puis rattachées à une nouvelle session ou à la session encore valide. Mina indique que la réponse est différée et n’imite pas un temps de réponse instantané.

Si le Huawei est lui-même hors ligne, Telegram conserve les mises à jour selon ses propres limites, actuellement annoncées à 24 heures maximum. Mina ne prétend pas garantir la réception au-delà sans un futur relais webhook, lequel exige une nouvelle décision de confidentialité.

## Transport et chiffrement

Chaque enveloppe contient :

```text
envelopeId
telegramUpdateId
direction
createdAt
expiresAt
attempt
payloadCiphertext
nonce
authTag
```

L’identifiant Telegram, le chat, le texte, le fichier vocal et la transcription restent dans la charge utile chiffrée. Les champs de routage sont couverts comme données associées authentifiées.

L’ordre de transport est :

1. USB via tunnel local authentifié ;
2. WebSocket TLS sur LAN appairé ;
3. Firebase Realtime Database avec enveloppe déjà chiffrée ;
4. attente dans la file Room locale.

Le même `telegramUpdateId` transmis par plusieurs canaux n’est traité qu’une fois. Les réponses utilisent une clé d’idempotence stable pour éviter les doubles envois après crash.

## Budgets et anti-abus

Valeurs initiales :

- 20 messages entrants par minute ;
- 200 messages par heure ;
- une seule session Telegram active ;
- texte 8 Kio ;
- note vocale 2 minutes / 10 Mio ;
- transcription 120 secondes ;
- réponse modèle limitée par le profil Mina ;
- cinq tentatives pour chaque challenge d’appairage.

Les limites Telegram renvoyées par l’API, notamment `retry_after`, sont respectées dynamiquement. Les quotas locaux ne tentent pas de remplacer les limites de la plateforme. Une rafale met les messages en attente ou refuse proprement sans lancer plusieurs modèles en parallèle.

Les utilisateurs non appairés, groupes, canaux et bots sont ignorés avant modèle, mémoire et stockage durable, à l’exception du minimum technique nécessaire à l’anti-abus.

## Grounding

Chaque réponse factuelle suit [Mina — grounding anti-hallucination et cycle de session](2026-07-14-mina-grounding-sessions-design.md).

- un souvenir cité référence l’événement source autorisé ;
- un statut système vient d’un contrôle de santé actuel ;
- un succès Bot API prouve seulement l’acceptation par Telegram ; la première version ne prétend jamais connaître la livraison ou la lecture ;
- un message différé indique ses dates de réception et de traitement ;
- une transcription locale est présentée comme transcription et peut être corrigée ;
- une information non vérifiable reste `uncertain` ou `unsupported`.

## Défaillances et reprise

- token absent : canal désactivé ;
- `401` ou identité de bot inattendue : token considéré invalide et rotation demandée ;
- webhook actif ou polling concurrent : arrêt fail-closed ;
- `429` : respect du délai Telegram et reprise bornée ;
- réseau téléphone absent : file locale ;
- PC absent : accusé minimal et réponse différée ;
- Firebase absent : USB/LAN ou attente locale ;
- note vocale invalide ou trop longue : refus sans transcription ;
- moteur ASR absent : texte disponible, voix marquée indisponible ;
- challenge expiré ou tentatives dépassées : invalidation et nouvelle procédure locale ;
- identité différente : message ignoré sans accès au modèle ou à la mémoire ;
- crash après envoi avant accusé local : réconciliation idempotente ;
- arrêt d’urgence : sessions et sorties stoppées, entrées persistées conservées.

## Tests obligatoires

Toute implémentation suit TDD : suite existante verte, test rouge, changement minimal, test vert, puis suite complète verte.

### Identité

- jeton d’appairage valide, expiré, rejoué et modifié ;
- chat privé versus groupe/canal ;
- contact dont le `user_id` correspond ou non ;
- code SMS correct, incorrect, bruteforce, expiré et déjà utilisé ;
- normalisation E.164, format invalide et plusieurs numéros ;
- changement de `@username` sans perte d’identité ;
- alternative même téléphone avec confirmation locale ;
- révocation du compte et d’un numéro ;
- identifiants Telegram sans perte de précision.

### Bot et transport

- token absent, `getMe` inattendu, `401`, webhook et polling concurrent ;
- persistance avant progression d’offset ;
- déduplication d’un update sur plusieurs transports ;
- ordre USB, LAN, Firebase, file locale ;
- idempotence d’une réponse après crash ;
- redémarrage Android, PC absent et reprise différée ;
- `429` et respect de `retry_after` ;
- token absent de chaque log, erreur, mémoire et snapshot de test.

### Formats et politique

- texte limite, UTF-8 invalide et message édité ;
- note vocale valide, taille/durée/type invalides et transcription locale ;
- refus photo, document, localisation, sticker, transfert et URL exécutable ;
- `/help`, `/status`, `/memory`, `/forget`, `/end` et commande inconnue ;
- secret et mémoire sensible bloqués ;
- `/forget` impossible sans confirmation PC ;
- contenu non sensible envoyé au modèle après garde-secrets ;
- aucun modèle appelé pour utilisateur inconnu, PC hors ligne ou message bloqué.

### Frontières

- aucun import d’exécuteur PC, sandbox, impression, fichier libre ou skill d’action ;
- session 30 minutes avec horloge simulée ;
- permissions non transférées entre sessions ;
- arrêt d’urgence pendant polling, transfert, transcription et réponse ;
- grounding distinguant une mise à jour reçue et une réponse acceptée, tout en laissant livraison et lecture `unknown` ;
- Firebase Emulator prouvant isolation UID/appareil et ciphertext uniquement.

Les tests utilisent un faux serveur Bot API local, Firebase Emulator, transports et horloges factices. Aucun token final, SMS réel ou message Telegram réel n’est utilisé automatiquement. La validation finale est supervisée avec un bot de test et des données non sensibles.

## Critères d’acceptation

Le canal est prêt lorsque :

1. le compte Telegram propriétaire est appairé par jeton et confirmation locale ;
2. un numéro SMS est reconnu seulement après preuve croisée ;
3. texte et note vocale fonctionnent, et toute réponse factuelle est sourcée ;
4. un redémarrage ou transport dupliqué ne produit pas deux réponses ;
5. le PC hors ligne provoque un accusé minimal puis une réponse différée ;
6. secrets et mémoire sensible ne sortent pas dans Telegram ;
7. `/forget` exige réellement le PC ;
8. Telegram reste incapable d’utiliser un outil PC général, la sandbox ou un skill d’action ; seules les capacités bornées `mail.*`, `home.read` et `home.low_risk` du propriétaire constituent les exceptions documentées ;
9. le token existe uniquement dans Android Keystore après provisionnement ;
10. les suites unitaires, Android, intégration, Firebase Emulator et validation supervisée sont vertes.

## Hors périmètre initial

- contrôle ou approbation distante d’une action PC ;
- groupes, canaux, inline mode, Business/Secretary Mode ou bot-to-bot ;
- photos, vidéos, documents, localisations et pièces jointes ;
- réponse vocale générée ;
- mémoire sensible affichée dans Telegram ;
- oubli ou suppression confirmés depuis Telegram ;
- webhook cloud recevant le texte en clair ;
- plusieurs comptes Telegram propriétaires actifs ;
- réponse IA complète lorsque le PC est hors ligne ;
- garantie de réception si le téléphone reste hors ligne plus longtemps que la rétention Telegram.

## Ordre d’implémentation recommandé

1. schémas d’identité, enveloppe Telegram, commandes et politiques ;
2. primitives partagées `mina-phone-transport` sans régression SMS ;
3. file Room, Bot API factice et polling persistant Android ;
4. provisionnement local du token et Android Keystore ;
5. appairage Telegram par jeton et contact ;
6. challenge SMS, E.164 et identité propriétaire unifiée ;
7. transport USB puis LAN et déduplication ;
8. channel desktop, sessions, texte et grounding ;
9. ASR local et notes vocales ;
10. Firebase ciphertext, PC hors ligne et reprise ;
11. commandes mémoire/statut/oubli et garde-secrets ;
12. quotas, urgence, rotation/révocation et tests de redémarrage ;
13. validation supervisée avec bot de test puis provisionnement du bot final.

## Références officielles

- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Telegram Bot Features et BotFather](https://core.telegram.org/bots/features)
- [Introduction officielle aux bots Telegram](https://core.telegram.org/bots)
