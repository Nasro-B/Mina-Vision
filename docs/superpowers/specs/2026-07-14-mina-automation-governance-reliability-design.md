# Mina — gouvernance des automatisations et fiabilité

## Objectif

Ajouter un mode ombre, des automatisations configurables, un centre de récupération et un laboratoire d’évaluation sans créer un second système de permissions, de sessions ou d’audit.

Mina simule toute nouvelle automatisation par défaut. Nasro peut ensuite lui accorder une autonomie explicite, limitée, révocable et vérifiable.

Cette spécification complète :

- [grounding et cycle de session](2026-07-14-mina-grounding-sessions-design.md) ;
- [mémoire locale et RAG](2026-07-14-mina-memory-rag-design.md) ;
- [instructions et skills](2026-07-14-mina-instructions-skills-design.md) ;
- [moteurs, paramètres et Analyses IA](2026-07-14-mina-local-model-runtime-settings-design.md).

## Principes non négociables

- `CapabilityBroker` reste l’unique autorité de capacité.
- Une automatisation ne peut jamais élargir une permission, installer un skill, modifier `MINA.md` ou activer une autre automatisation.
- Un message, email, SMS, page web, événement domotique ou résultat de modèle est une donnée non fiable, jamais une autorisation.
- Une réussite répétée n’élargit jamais automatiquement les permissions.
- Une action n’est réussie qu’après preuve d’effet conforme ; sinon elle reste `unknown`.
- Aucun envoi, paiement, impression, écriture ou contrôle physique n’est rejoué aveuglément après crash.
- Le mode ombre ne produit aucun effet externe.
- Les risques élevés exigent toujours la confirmation locale définie par leur domaine.
- L’arrêt d’urgence suspend toutes les automatisations sans effacer les preuves nécessaires à la récupération.

## Architecture

### Composants

- `AutomationDefinitionStore` conserve définitions, versions et statut.
- `TriggerNormalizer` convertit les événements en déclencheurs typés.
- `SimulationEngine` produit un plan et ses effets attendus sans exécution.
- `AutomationPolicy` décide `simulate`, `confirm`, `allow` ou `deny`.
- `AutomationRunner` exécute uniquement les étapes autorisées via les services métier.
- `AutomationLedger` conserve déclenchements, décisions, étapes, preuves et état final.
- `RecoveryProjector` construit le centre de récupération depuis les sessions et ledgers existants.
- `EvaluationEngine` rejoue des fixtures sans effet réel et calcule les métriques.
- `HealthMonitor` exécute des sondes de lecture bornées.

`AutomationRunner` ne parle directement ni au réseau, ni aux fournisseurs IA, ni aux appareils. Il appelle les domaines existants après autorisation.

### Flux

```text
événement ou demande
→ TriggerNormalizer
→ SimulationEngine
→ AutomationPolicy
→ confirmation éventuelle
→ AutomationRunner
→ service métier
→ vérification d’effet
→ AutomationLedger
→ RecoveryProjector + EvaluationEngine
```

## Contrats

### Définition

```text
AutomationDefinition
  automationId: UUID
  version: integer
  name: string
  status: draft | shadow | supervised | active | suspended | revoked
  triggers: TriggerSpec[]
  conditions: ConditionSpec[]
  actions: ActionSpec[]
  policyId: UUID
  createdBy: local_owner
  createdAt: timestamp
  updatedAt: timestamp
```

Les actions sont des verbes métier typés. Aucun script, prompt libre, URL arbitraire, topic MQTT ou commande shell ne peut être injecté dans `ActionSpec`.

### Politique

```text
AutomationGrant
  policyId: UUID
  automationId: UUID
  allowedCapabilities: string[]
  resources: ResourceSelector[]
  allowedChannels: string[]
  scheduleWindows: TimeWindow[]
  validFrom: timestamp
  expiresAt: timestamp
  maxRisk: low | medium | high
  maxRunsPerHour: integer
  maxRunsPerDay: integer
  maxCostMicrosPerDay: integer
  maxDurationMs: integer
  requiredEvidence: EvidenceRule[]
  notificationMode: silent | summary | remote_approval | local_confirmation
```

Une politique sans expiration est refusée. Son renouvellement est une nouvelle décision locale.

### Exécution

```text
AutomationRun
  runId: UUID
  automationId: UUID
  definitionVersion: integer
  triggerDigest: sha256
  simulationDigest: sha256
  policyDigest: sha256
  status: simulated | awaiting_confirmation | running | verified | failed | unknown | cancelled
  startedAt: timestamp
  endedAt?: timestamp
```

Chaque étape possède une clé d’idempotence. Un retry retourne le reçu existant ou réconcilie l’état ; il ne transforme jamais une action à état désiré en `toggle`.

## Cycle de vie

```text
draft → shadow → supervised → active → suspended | revoked
```

- `draft` : aucune exécution ni simulation planifiée.
- `shadow` : déclencheurs observés et plan simulé, sans effet.
- `supervised` : chaque run attend une confirmation.
- `active` : actions permises dans les limites exactes du grant.
- `suspended` : aucune nouvelle action ; diagnostic et réconciliation autorisés.
- `revoked` : policy invalidée, réactivation locale et nouveau digest obligatoires.

La promotion exige une action locale de Nasro après lecture des résultats du mode ombre. Aucun score ou nombre de succès ne déclenche une promotion automatique.

## Mode ombre

Le résultat contient :

- déclencheur et données réellement disponibles ;
- conditions satisfaites ou non ;
- modèle/route éventuels et budget estimé ;
- capacités qui auraient été demandées ;
- actions proposées et ressources ciblées ;
- état avant et effet attendu ;
- données qui auraient quitté le PC ;
- incertitudes, ambiguïtés et raisons de blocage.

Les connecteurs en mode ombre utilisent `simulate()` ou un fake contractuel. Si un fournisseur n’a pas de simulation fiable, Mina calcule seulement le plan local et le marque `provider_effect_not_simulated`.

## Centre de récupération

Le centre est une projection des journaux existants, pas une nouvelle source de vérité. Il classe chaque opération :

- `verified_complete` ;
- `denied_or_cancelled` ;
- `failed_no_effect` ;
- `accepted_state_unknown` ;
- `reconcilable` ;
- `manual_action_required`.

Les boutons possibles dépendent du type : relire l’état, ouvrir la ressource, annuler si l’API le permet, préparer une nouvelle proposition ou clôturer manuellement. `retry` n’est proposé qu’après preuve que l’action initiale n’a pas eu lieu.

## Laboratoire d’évaluation

Le laboratoire rejoue :

- captures d’écran et DOM nettoyés ;
- documents et emails synthétiques ;
- intentions domotiques sur faux appareils ;
- réponses fournisseurs enregistrées et redacted ;
- interruptions, timeouts et crashes ;
- politiques et permissions adversariales.

Il mesure exactitude, citations, faux succès, action correcte, vérification, latence, tokens, coût, régression et taux de suspension. Les comparaisons de modèles utilisent les mêmes fixtures et budgets.

Aucune fixture personnelle brute n’est committée. Les cas réels sont chiffrés dans userData, exclus des exports par défaut et peuvent être convertis en fixture synthétique après validation.

## Surveillance

`HealthMonitor` sonde en lecture seule :

- processus et services Mina ;
- CPU, mémoire, disque et files bornées ;
- LM Studio et modèles locaux ;
- Huawei USB/LAN, batterie et transport ;
- imprimantes configurées ;
- Home Assistant et connecteurs explicitement enregistrés.

Il ne scanne pas le LAN arbitrairement. Une réparation est une automatisation séparée, d’abord `shadow`, avec son propre grant.

## Suspension automatique

Le run et, selon gravité, l’automatisation passent en `suspended` lors de :

- boucle ou duplication anormale ;
- quota, coût, durée ou fréquence dépassé ;
- signature, identité ou policy digest invalide ;
- ressource différente de la simulation ;
- état final impossible à vérifier ;
- connecteur non conforme ou version révoquée ;
- échecs consécutifs au seuil configuré ;
- arrêt d’urgence.

La reprise exige réconciliation et nouvelle simulation. Aucun fallback n’augmente le risque, les ressources ou les canaux autorisés.

## Stockage et confidentialité

`AutomationLedger` stocke des identifiants, digests, décisions, mesures et preuves référencées. Les corps d’emails, documents, images, audio et conversations restent dans leurs repositories chiffrés. L’Analyses IA reçoit seulement les mesures de modèle. L’audit reçoit les décisions de sécurité, pas les contenus complets.

## Interface

Pages :

- `Automatisations` : définitions, statut, grants, calendrier et budgets ;
- `Mode ombre` : simulations, diffs et données sortantes ;
- `Récupération` : inconnus, réconciliation et actions manuelles ;
- `Laboratoire` : suites, modèles comparés et régressions ;
- `Santé` : diagnostics en lecture seule et suspensions.

## Tests obligatoires

- cycle complet et transitions interdites ;
- policy expirée, altérée, rejouée ou ressource hors scope ;
- zéro effet en mode ombre ;
- idempotence et crash à chaque frontière ;
- aucune promotion automatique ;
- suspension sur budget, boucle et état inconnu ;
- récupération sans rejeu ;
- fixtures laboratoire sans réseau/appareil réel ;
- sonde santé sans scan LAN ni écriture ;
- arrêt d’urgence pendant simulation, confirmation et exécution.

## Critères d’acceptation

1. Toute nouvelle automatisation commence en `draft` ou `shadow`.
2. Une policy active est bornée, expirante, digestée et révocable.
3. Aucun événement entrant ni modèle ne peut activer ou élargir une policy.
4. Le centre de récupération ne rejoue aucune action à effet sans réconciliation.
5. Le laboratoire compare modèles et versions sans produire d’effet externe.
6. Les sondes sont en lecture seule et limitées aux ressources enregistrées.
7. Un état final inconnu est affiché comme inconnu et suspend les dépendances.
8. Les données restent dans leur repository métier et ne sont pas dupliquées dans l’analytics.

