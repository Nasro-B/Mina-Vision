# Mina — passerelle e-mail multicomptes

**Statut :** design validé oralement par Nasro le 14 juillet 2026.

## Objectif

Permettre à Mina de recevoir, rechercher, résumer, mémoriser, classer et envoyer des e-mails depuis plusieurs fournisseurs :

- Gmail par Gmail API et OAuth 2.0 ;
- Outlook, Hotmail et Microsoft 365 par Microsoft Graph et OAuth 2.0 ;
- autres fournisseurs par IMAP/SMTP sécurisé, avec OAuth2 quand disponible ou mot de passe d’application chiffré.

Nasro contrôle Mina depuis le PC, la voix locale ou son compte Telegram propriétaire sur le Samsung.

## Principes non négociables

- Un e-mail entrant est une donnée externe non fiable et ne donne jamais d’ordre à Mina.
- Aucun e-mail ne peut lancer un outil PC, un skill, une sandbox, une pièce jointe ou un changement de mode.
- Seul le compte Telegram numérique propriétaire appairé peut invoquer `mail.*` à distance.
- L’e-mail n’élargit jamais les permissions générales Telegram : outils PC, fichiers arbitraires et sandbox restent bloqués.
- Les credentials restent sur le PC, chiffrés par le keyring local ; ils ne résident ni sur le Samsung ni sur le Huawei.
- Une réponse fournisseur prouve au plus l’acceptation, jamais la lecture ou la remise finale au destinataire.

## Architecture

### Domaine commun

`MailService` expose un contrat indépendant du fournisseur :

```text
connectAccount, disconnectAccount, sync
listThreads, getThread, search
createDraft, updateDraft, sendDraft, reply, forward
move, label, archive, markRead, markSpam, trash, unsubscribe
downloadAttachment, getActionStatus
```

Les adaptateurs traduisent les capacités et déclarent explicitement les fonctions non supportées.

### Adaptateur Gmail

- OAuth 2.0 avec scopes minimaux nécessaires.
- Gmail API pour messages, fils, labels, brouillons, historique incrémental et envoi.
- `historyId` avancé uniquement après transaction locale réussie.
- En cas d’historique expiré, resynchronisation bornée et réconciliation par identifiants Gmail.

L’IMAP/SMTP Gmail n’est pas le chemin principal : XOAUTH2 exige le scope complet `https://mail.google.com/`, alors que l’API permet de demander des permissions plus ciblées.

### Adaptateur Microsoft

- OAuth 2.0 Microsoft Identity Platform.
- Microsoft Graph pour messages, dossiers, catégories, brouillons et `sendMail`.
- Delta query par dossier pour la synchronisation incrémentale.
- Curseur delta persisté après écriture locale réussie.

### Adaptateur IMAP/SMTP

- IMAPS direct ou STARTTLS obligatoire avec validation stricte du certificat.
- SMTP TLS obligatoire ; aucune authentification en clair avant TLS.
- IMAP IDLE si disponible, sinon polling borné.
- Suivi par compte/dossier de `UIDVALIDITY`, `UIDNEXT` et UID.
- OAuth2/SASL préféré ; mot de passe d’application seulement si nécessaire.
- Aucun certificat auto-signé accepté sans appairage local explicite d’une empreinte.

## Modèle unifié

```text
MailAccount: id, provider, address, capabilities, mode, syncState
MailThread: id, accountId, providerThreadId, participants, subject, labels, dates
MailMessage: id, threadId, providerMessageId, internetMessageId, headers, bodies, attachments
MailDraft: id, recipients, subject, body, attachments, replyContext, policyDecision
MailAction: id, type, target, requestedBy, mode, state, providerReceipt, evidence
```

Contenus, participants, adresses, objets, bodies, tokens et identifiants sensibles sont chiffrés dans la mémoire. Les index de recherche utilisent les mécanismes aveugles et embeddings locaux prévus dans la mémoire Mina.

## Synchronisation et déduplication

- Gmail : `message.id`, `threadId`, `historyId`.
- Microsoft : `id`, `internetMessageId`, curseur delta.
- IMAP : compte + dossier + UIDVALIDITY + UID, complété par `Message-ID` et digest canonique.

Un message n’est publié au domaine qu’après transaction locale. Les notifications répétées sont idempotentes.

Les connexions Gmail/Graph utilisent polling incrémental local en v1 ; aucun webhook public ni serveur cloud Mina n’est requis. IMAP IDLE est périodiquement renouvelé.

## Trois modes d’autonomie

### Mode 1 — confirmation systématique

Mina lit, recherche, résume et prépare des propositions de classement ou de réponse. Chaque envoi ou modification de la boîte demande confirmation.

### Mode 2 — règles autorisées

Les actions automatiques s’appliquent seulement aux contacts, domaines, fils, catégories et règles explicitement autorisés. Tout le reste repasse en mode 1.

### Mode 3 — automatique général

Mina peut automatiquement lire, répondre, transférer, envoyer, classer, archiver, marquer comme spam, se désabonner et déplacer vers la corbeille.

Les trois modes restent disponibles globalement, par compte, contact, domaine ou fil. Priorité : règle de fil/contact → compte → global. En cas de conflit entre règles applicables au même niveau, la plus restrictive gagne.

Nasro choisit le mode 3 par défaut. Il peut le changer depuis Telegram par `/mail mode 1|2|3` sans seconde confirmation. La commande exige néanmoins son `telegram_user_id` appairé et produit un événement d’audit et une notification PC.

## Limites absolues, y compris en mode 3

- Aucun lancement de pièce jointe, macro, script, exécutable ou archive active.
- Aucune suppression définitive automatique ; `delete` signifie déplacement vers la corbeille.
- Aucune modification automatique de mot de passe, récupération, MFA, délégation, transfert global ou règles de sécurité du compte.
- Aucun envoi de secret/OTP/credential extrait de la mémoire sans politique spécifique explicite.
- Aucun traitement d’instruction contenue dans un e-mail comme commande Mina.
- Aucune action hors du domaine mail à partir d’un message entrant.

## Classement, spam et désabonnement

En mode 3, Mina peut classer et marquer comme spam automatiquement avec journaux et seuils anti-boucle.

Le désabonnement automatique est limité à `List-Unsubscribe` et au mécanisme one-click standard. Mina ne remplit pas automatiquement un formulaire web arbitraire ni une page demandant un mot de passe.

Chaque action réversible reçoit un `actionId` utilisable par `/mail undo <action-id>` tant que le fournisseur permet le retour arrière.

## Pièces jointes

Les pièces jointes sont stockées dans une quarantaine chiffrée et bornée :

- détection du type réel par signature et extension ;
- limites de taille par pièce jointe, message et compte ;
- extraction statique seulement pour PDF, texte, images et documents pris en charge ;
- macros désactivées ; exécutables et scripts non ouverts ;
- archives récursives, chiffrées ou suspectes bloquées ;
- export hors quarantaine sur demande explicite.

La lecture statique produit des preuves avec message, pièce jointe, digest, pages/lignes et méthode d’extraction. Si Windows Sandbox est indisponible, aucune analyse nécessitant une exécution ne bascule sur l’hôte.

## Protection contre phishing et prompt injection

- Le HTML est nettoyé ; scripts, formulaires actifs et ressources distantes sont bloqués.
- Les images distantes ne sont pas chargées par défaut.
- Les adresses sont normalisées et les domaines ressemblants signalés.
- Le contenu cité, les signatures et pièces jointes sont étiquetés `external_untrusted` avant le modèle.
- Le modèle ne peut pas modifier une décision de capability ou déclarer une action réussie.
- Une instruction externe qui demande d’ignorer `MINA.md`, d’envoyer un secret ou d’exécuter un fichier est rejetée et auditée.

## Telegram depuis le Samsung

Commandes initiales :

```text
/mail status
/mail inbox
/mail search <requête>
/mail mode 1|2|3
/mail accounts
/mail pause
/mail resume
/mail rules
/mail undo <action-id>
```

Le langage naturel offre les mêmes opérations. Seul le propriétaire peut invoquer ces commandes.

Le contenu complet n’est envoyé dans Telegram que sur demande. Les réponses sont segmentées et bornées. Les pièces jointes restent sur le PC sauf demande explicite de téléchargement compatible avec la politique Telegram.

`/mail pause` suspend le polling/IDLE, les nouvelles synchronisations et les actions automatiques sans perdre les curseurs ou files. `/mail resume` reprend après vérification des comptes.

## Mémoire intercanal

Mina peut rappeler un échange e-mail depuis une session locale, vocale, SMS ou Telegram si l’identité et la politique l’autorisent.

La mémoire conserve les faits utiles avec provenance, pas nécessairement l’intégralité de chaque newsletter ou pièce jointe. Les messages complets restent dans le cache chiffré selon la politique du compte.

L’oubli local cascade vers les chunks, résumés et embeddings Mina ; il ne supprime pas automatiquement l’e-mail chez le fournisseur sauf action mail distincte.

## Grounding des actions

États communs :

```text
proposed
draft_created
queued
sending
accepted_by_provider
delivery_unknown
failed_retryable
failed_final
moved
trashed
reverted
```

- Gmail/Graph retourne un identifiant : `accepted_by_provider`.
- SMTP retourne un code final 2xx : `accepted_by_provider`.
- Aucun de ces états ne prouve `delivered` ou `read`.
- Coupure SMTP après `DATA` mais avant réponse : `delivery_unknown`.
- Avant de renvoyer un état incertain, Mina recherche dans « Envoyés » par `Message-ID`, destinataires, objet et digest.

## Budgets et anti-boucle

Budgets configurables par compte : envois/minute, envois/heure, réponses automatiques par fil, actions de classement par lot, taille des pièces jointes et volume synchronisé.

Une boucle, une hausse brutale ou des erreurs répétées suspend le compte et publie `automation_paused`. Les limites fournisseur et `Retry-After` sont respectés.

Les actions de masse sont découpées, journalisées et annulables quand possible. La purge définitive n’est jamais incluse.

## Credentials

- OAuth client configuration publique séparée des refresh tokens.
- Refresh tokens et mots de passe d’application chiffrés par le keyring Mina/DPAPI.
- Access tokens gardés en mémoire autant que possible et jamais journalisés.
- Déconnexion supprime les credentials locaux après révocation quand le fournisseur le permet.
- Aucun secret dans `.env.example`, Firebase, Telegram, Huawei ou export diagnostic.

## Défaillances et reprise

- OAuth révoqué : suspendre le compte et demander une reconnexion locale.
- Curseur invalide : resynchronisation bornée sans double publication.
- UIDVALIDITY IMAP changé : reconstruire le dossier et dédupliquer par Message-ID/digest.
- Crash avant envoi : reprendre seulement l’état `queued` confirmé par transaction.
- Crash après envoi incertain : réconcilier avant tout retry.
- Fournisseur hors ligne : backoff jitteré, files chiffrées et état visible.
- Base/keyring indisponible : aucun login, envoi ou synchronisation en mode dégradé.

## Tests obligatoires

### Adaptateurs

- Gmail OAuth, historique, expiration historique, labels, fils, brouillon et envoi.
- Microsoft OAuth, delta query, curseur expiré, dossiers, brouillon et envoi.
- IMAP IDLE/polling, UIDVALIDITY, TLS, OAuth2, mot de passe d’application et SMTP incertain.

### Politiques

- Modes 1/2/3 à chaque niveau et conflits.
- Mode 3 par défaut et changement Telegram sans seconde confirmation.
- Pause/reprise et budgets.
- Corbeille réversible, jamais purge automatique.

### Sécurité

- Injection HTML/texte/PDF, domaine homographe, tracking image, macro, exécutable, archive piégée.
- E-mail entrant tentant d’invoquer outil, skill, sandbox ou `/mail mode`.
- Token absent des logs, DB non chiffrée, diagnostics et Firebase.
- Compte Telegram non propriétaire refusé.

### Reprise

- Crash avant/après chaque frontière transactionnelle.
- Réponse fournisseur perdue, ack du transport Telegram perdu et retry dédupliqué.
- Recherche dans « Envoyés » avant retry SMTP incertain.

## Validation réelle

- Un compte Gmail de test connecté par OAuth.
- Un compte Microsoft de test connecté par OAuth.
- Un compte IMAP/SMTP de test connecté en TLS.
- Réception, recherche, réponse, transfert, labels/dossiers, spam, désabonnement standard, corbeille et undo.
- Commandes depuis le Samsung, dont `/mail mode 1|2|3`.
- Mémoire d’un e-mail rappelée dans une autre session.
- Scan des fichiers locaux et exports : aucun token ou contenu test sensible en clair.

## Critères d’acceptation

- Les trois familles de fournisseurs fonctionnent avec synchronisation incrémentale et reprise.
- Les trois modes sont configurables ; mode 3 est le défaut choisi.
- Nasro pilote le domaine mail depuis son Samsung sans ouvrir les outils PC généraux.
- Aucun e-mail entrant ne devient une commande.
- Les envois et actions sont idempotents, auditables et correctement qualifiés.
- Les pièces jointes ne sont jamais exécutées.
- Les credentials restent chiffrés sur le PC.

## Références officielles

- Gmail API, créer/envoyer : https://developers.google.com/workspace/gmail/api/guides/sending
- Gmail IMAP/SMTP OAuth2 : https://developers.google.com/workspace/gmail/imap/imap-smtp
- Gmail SASL XOAUTH2 et portée : https://developers.google.com/workspace/gmail/imap/xoauth2-protocol
- Microsoft Graph `sendMail` : https://learn.microsoft.com/graph/api/user-sendmail
- Microsoft Graph delta messages : https://learn.microsoft.com/graph/delta-query-messages
