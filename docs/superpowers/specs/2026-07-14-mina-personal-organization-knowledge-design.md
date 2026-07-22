# Mina — organisation personnelle et graphe de connaissances

## Objectif

Relier routines, calendriers, contacts, tâches, projets, messages et documents afin que Mina prépare la journée, retrouve les engagements et propose des actions cohérentes entre canaux.

Cette spécification dépend de :

- [gouvernance des automatisations](2026-07-14-mina-automation-governance-reliability-design.md) ;
- [mémoire locale et RAG](2026-07-14-mina-memory-rag-design.md) ;
- [email](2026-07-14-mina-email-gateway-design.md) ;
- [Telegram et identité](2026-07-14-mina-telegram-identity-design.md).

## Principes

- Le graphe personnel est une projection de données existantes, pas une copie intégrale des contenus.
- Chaque fait ou relation conserve provenance, date, classification et confiance.
- Deux personnes ne sont jamais fusionnées sur le seul nom, numéro partiel ou adresse proche.
- Une routine utilise des actions typées déclarées à l’avance ; un événement entrant ne peut pas inventer une action.
- Lire un agenda n’autorise pas à créer, déplacer ou annuler un événement.
- Les invitations, participants externes et modifications visibles sont des effets vérifiés.
- Les connecteurs calendrier/contacts/tâches ne donnent aucune capacité PC générale.
- L’oubli dans Mina ne supprime pas automatiquement la donnée chez le fournisseur ; une action fournisseur distincte est requise.

## Architecture

### Domaines

- `RoutineRegistry` conserve définitions et versions de routines.
- `RoutineScheduler` produit des déclenchements temporels idempotents.
- `PersonalDataHub` unifie les ports calendrier, contacts et tâches.
- `CalendarService`, `ContactService` et `TaskService` appliquent leurs politiques métier.
- `PersonalGraph` projette entités et relations avec provenance.
- `EntityResolver` propose les fusions et expose les ambiguïtés.
- `DailyBriefingService` compose un briefing fondé sur les sources disponibles.

Les adaptateurs fournisseurs restent séparés : Google, Microsoft et CalDAV/CardDAV. Le domaine ne dépend d’aucun SDK spécifique.

## Routines

### Définition

```text
RoutineDefinition
  routineId: UUID
  name: string
  triggers: time | calendar | mail | sms | telegram | home_state | device_health
  conditions: typed predicates[]
  steps: typed domain actions[]
  automationId: UUID
```

Un déclencheur `mail` peut filtrer compte, expéditeur lié, dossier, catégorie ou présence d’une pièce jointe. Il ne peut pas transformer le corps de l’email en commande. De même, un SMS ou événement domotique fournit des valeurs, jamais du code ou une nouvelle étape.

### Exemples autorisés

- briefing matinal : agenda, tâches, emails prioritaires, météo et santé des services ;
- rappel de préparation avant rendez-vous ;
- proposition de tâche depuis un engagement explicitement reconnu ;
- résumé de fin de journée ;
- notification si le Huawei n’est plus connecté ou si un service Mina est arrêté.

Chaque exemple commence en mode ombre et hérite de l’`AutomationPolicy` commune.

## Calendriers

### Port unifié

```text
CalendarAdapter
  health()
  listCalendars()
  sync(cursor)
  getEvent(eventId)
  createDraft(event)
  commitDraft(draftId, expectedRevision)
  update(eventId, patch, expectedRevision)
  cancel(eventId, expectedRevision)
```

Les adaptateurs utilisent synchronisation incrémentale et réconciliation après curseur expiré. Toute écriture conserve l’identifiant fournisseur et relit l’événement après action.

Risques :

- lecture et recherche : faible ;
- événement personnel sans participant : moyen configurable ;
- invitation, annulation, changement de participants/lieu ou événement partagé : confirmation requise ;
- suppression définitive ou modification de sécurité du compte : interdite.

## Contacts

Un contact unifié distingue identité humaine, organisation et endpoint :

```text
Person
  personId
  displayName
  verifiedEndpoints[]
  candidateEndpoints[]
  organizations[]
  provenance[]
```

Numéro E.164, Telegram `user_id`, emails et fiches fournisseur sont liés seulement après preuve ou validation de Nasro. La reconnaissance faciale ne lie pas automatiquement un contact.

Créer, fusionner ou supprimer un contact est une action distincte et vérifiée. Mina n’envoie jamais un message à un endpoint seulement candidat.

## Tâches

```text
Task
  taskId
  title
  status: proposed | active | completed | cancelled
  dueAt?
  projectId?
  sourceRef?
  providerBindings[]
```

Une phrase ou un email ne devient pas automatiquement une tâche active. Mina peut proposer une tâche avec source et confiance. Une règle explicite peut auto-créer des tâches dans un projet/filtre borné.

La complétion est réconciliée avec le fournisseur. Une tâche terminée localement mais refusée à distance reste `sync_conflict`.

## Graphe personnel

### Entités

- personnes et organisations ;
- projets et objectifs ;
- conversations et fils ;
- documents et pièces jointes ;
- événements, tâches et engagements ;
- appareils, lieux et services.

### Relations

```text
GraphEdge
  edgeId
  fromEntityId
  relationType
  toEntityId
  sourceRefs[]
  observedAt
  confidence
  classification
  status: proposed | confirmed | disputed | forgotten
```

Le RAG peut récupérer les sous-graphes autorisés par identité, canal et classification. Le modèle reçoit seulement les entités nécessaires à la demande, avec provenance. Le graphe complet n’est jamais envoyé à un fournisseur distant.

### Résolution

`EntityResolver` retourne :

- `exact` : liaison déjà confirmée ;
- `candidate` : rapprochement proposé ;
- `ambiguous` : plusieurs entités plausibles ;
- `new` : aucune correspondance.

Seul Nasro peut confirmer une fusion ambiguë. Une séparation reconstruit les relations depuis leurs sources et tombstones sans perdre la provenance.

## Briefing personnel

Le briefing indique pour chaque élément sa source et sa fraîcheur. Il sépare :

- faits confirmés ;
- changements depuis le dernier briefing ;
- actions suggérées ;
- éléments bloqués ou ambigus ;
- automatisations prévues et budget restant.

En absence de réseau, seules les dernières données locales sont utilisées avec leur horodatage. Mina ne les présente pas comme actuelles.

## Canaux

- local/voix : lecture et actions selon policy ;
- Telegram propriétaire : briefing, recherche, tâches et commandes calendrier bornées après activation locale ;
- SMS : peut enrichir la mémoire et proposer une tâche, mais ne crée ni calendrier ni contact automatiquement ;
- email entrant : source non fiable, aucun outil direct.

## Stockage

Les corps de messages et documents restent dans leurs repositories. Le graphe stocke références, extraits minimaux chiffrés, provenance et digests. Les tokens OAuth restent dans le keyring et ne sont jamais copiés dans le graphe.

## Défaillances

- curseur expiré : resynchronisation bornée ;
- conflit de révision : action suspendue, diff présenté ;
- fusion ambiguë : aucune écriture ;
- fournisseur indisponible : lecture locale datée, écriture non prétendue ;
- routine en retard : pas de rattrapage automatique d’une action à effet ;
- changement de fuseau : recalcul et simulation avant reprise.

## Interface

- `Aujourd’hui` : briefing, agenda, tâches et alertes ;
- `Routines` : définitions, mode ombre, horaires et grants ;
- `Personnes` : endpoints vérifiés/candidats et fusions ;
- `Graphe` : sous-graphe explicable, provenance et oubli ;
- `Calendriers et tâches` : comptes, sync, conflits et diagnostics.

## Tests obligatoires

- déclencheurs temporels, fuseaux, DST et duplications ;
- événement entrant incapable de modifier une routine ;
- sync incrémentale, curseur expiré et conflit de révision ;
- invitations et participants exigeant confirmation ;
- endpoint candidat jamais utilisé pour envoyer ;
- fusion/séparation avec conservation de provenance ;
- oubli cascade dans graph/RAG sans suppression fournisseur implicite ;
- briefing offline avec fraîcheur visible ;
- routine shadow sans effet ;
- crash avant/après écriture fournisseur sans rejeu.

## Critères d’acceptation

1. Les routines ne contiennent que des déclencheurs, conditions et actions typés.
2. Calendrier, contacts et tâches fonctionnent par ports adaptables et sync vérifiée.
3. Le graphe conserve provenance et ne fusionne jamais une identité ambiguë automatiquement.
4. Mina peut rappeler un engagement entre SMS, Telegram, email et local selon la policy.
5. Le briefing distingue clairement fraîcheur, faits et suggestions.
6. Une action fournisseur est confirmée par relecture ou marquée inconnue/conflit.

