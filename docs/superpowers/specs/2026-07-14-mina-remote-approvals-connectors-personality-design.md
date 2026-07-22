# Mina — approbations distantes, connecteurs privés et personnalité

## Objectif

Permettre à Nasro d’approuver certaines actions depuis son Samsung via Telegram, d’étendre Mina par des connecteurs privés signés et de personnaliser son comportement conversationnel sans affaiblir les règles constitutionnelles.

Cette spécification dépend de :

- [Telegram propriétaire](2026-07-14-mina-telegram-identity-design.md) ;
- [instructions et skills](2026-07-14-mina-instructions-skills-design.md) ;
- [sandbox](2026-07-14-mina-code-sandbox-design.md) ;
- [gouvernance des automatisations](2026-07-14-mina-automation-governance-reliability-design.md) ;
- [maison connectée](2026-07-14-mina-smart-home-design.md).

## Principes

- Une approbation distante n’est pas une authentification générale du PC.
- Seul le Telegram numérique propriétaire appairé peut recevoir ou répondre à une demande.
- L’approbation est liée au digest exact de l’action, à l’état observé et à une expiration courte.
- Les actions à risque élevé restent confirmées localement.
- Un connecteur ne peut jamais demander ou recevoir plus de capacités que son manifeste validé.
- La signature prouve l’origine/intégrité d’un paquet, pas sa sûreté ; analyse, quarantaine et policy restent obligatoires.
- Les connecteurs déclaratifs sont privilégiés ; le code exécutable est exceptionnel et isolé.
- La personnalité modifie présentation et préférences non sensibles, jamais `MINA.md`, broker, policies, preuves ou confirmations.
- Aucun catalogue public ne s’installe automatiquement.

## Approbation Samsung

### Composants

- `ApprovalRequestBuilder` produit le résumé et le digest.
- `RemoteApprovalService` persiste, expire et consomme les demandes.
- `TelegramApprovalAdapter` affiche et reçoit les boutons.
- `ApprovalVerifier` revalide identité, signature, état et digest avant consommation.

### Contrat

```text
ApprovalRequest
  approvalId: UUID
  sessionId: UUID
  ownerIdentityId: string
  capability: string
  resourceDigest: sha256
  actionDigest: sha256
  observedStateDigest: sha256
  summary: string
  expectedEffect: object
  disclosedData: DataDisclosure[]
  risk: low | medium | high
  createdAt: timestamp
  expiresAt: timestamp
  nonce: string
  signature: string
  status: pending | approved | denied | expired | invalidated | consumed
```

`summary` est une représentation ; les digests et la payload structurée font foi. Un bouton Telegram ne transporte pas un verbe arbitraire, seulement `approve:<approvalId>` ou `deny:<approvalId>` signé/corrélé.

### Contenu présenté

- action exacte et domaine ;
- ressource, compte, destinataire ou appareil ;
- état actuel et effet attendu ;
- fichiers/champs/données transmis ;
- modèle ou connecteur utilisé ;
- coût estimé ;
- risque et expiration ;
- accès aux preuves détaillées.

### Politique

Une approbation Telegram peut être activée localement pour les risques faibles et moyens d’un domaine précis. Restent locaux : paiement, secret/credential, accès physique, sécurité, signature, suppression définitive, changement de compte/MFA, actions de santé critiques et toute capacité classée `local_only`.

L’approbation expire au maximum après cinq minutes et une seule utilisation. Tout changement de contenu, destinataire, montant, fichier, appareil, état ou policy l’invalide.

Perte de connexion après approbation ne provoque pas de retry aveugle ; le ledger réconcilie l’action.

## Catalogue privé de connecteurs

### Types

1. `declarative-rest` : endpoints, méthodes, schémas et auth déclarés.
2. `declarative-mqtt` : topics exacts, payloads et état allowlistés.
3. `local-adapter` : imprimante, NAS, logiciel ou service local via commandes typées.
4. `isolated-code` : code signé exécuté dans une frontière isolée et bornée.

Le type `isolated-code` n’est accepté que si les trois premiers ne peuvent pas représenter l’intégration.

### Manifeste

```text
ConnectorManifest
  connectorId: reverse-dns string
  name: string
  version: semver
  publisherKeyId: string
  packageDigest: sha256
  connectorType: enum
  capabilities: CapabilityDescriptor[]
  networkAllowlist: EndpointRule[]
  filesystemScopes: PathRule[]
  secretRequirements: SecretDescriptor[]
  inputSchemas: SchemaRef[]
  outputSchemas: SchemaRef[]
  verificationMethods: VerificationDescriptor[]
  resourceLimits: ResourceLimits
  minMinaVersion: semver
  license: string
  signature: string
```

Le manifeste n’inclut aucune valeur de secret. Les endpoints avec wildcard global, désactivation TLS ou commande shell libre sont refusés.

### Installation

```text
import local explicite
→ quarantaine
→ digest + signature + publisher trust
→ analyse archive/dépendances/licence
→ validation manifeste et schémas
→ tests contractuels sur fake
→ diff des permissions
→ confirmation locale
→ installation versionnée
→ mode ombre
→ activation éventuelle
```

Le catalogue est local et privé. Une source distante peut signaler une version, mais Mina ne télécharge ni n’installe automatiquement. Les clés éditeur sont approuvées localement et révocables.

### Runtime

Un connecteur reçoit uniquement :

- payload validée par son schéma ;
- secrets demandés via handle non sérialisable ;
- transport réseau filtré ;
- dossier temporaire borné si déclaré ;
- budget, timeout et `AbortSignal` ;
- logger redacted.

Il ne reçoit ni objet Electron, ni keyring général, ni base mémoire, ni IPC générique, ni accès au renderer. Ses résultats sont des données non fiables validées avant usage.

### Mise à jour et révocation

Chaque version coexiste jusqu’à migration réussie. Mise à jour : vérification complète, diff permissions, tests, shadow et activation. Une permission nouvelle exige confirmation. Rollback atomique vers la dernière version validée. Signature/éditeur révoqué : connecteur suspendu immédiatement, automatisations dépendantes suspendues et diagnostic affiché.

## Personnalité contrôlée

### Couches

1. `MINA.md` : constitution et interdictions, non modifiable par la personnalité.
2. `SafetyPolicy` : broker, risques, confirmations et canaux.
3. `PersonalityProfile` : ton, densité, vocabulaire et préférences.
4. `SessionStyle` : ajustement temporaire sans persistance implicite.

### Profil

```text
PersonalityProfile
  displayName: Mina
  language: fr
  tone: direct | chaleureux | professionnel | concis
  detailLevel: 1..5
  proactiveSuggestions: boolean
  humorLevel: 0..3
  preferredVocabulary: string[]
  dislikedPhrases: string[]
  channelOverrides: object
  revision: integer
```

Les phrases d’activation restent `Salut Mina`, `Bonjour Mina`, `Mina comment ça va`. Le profil peut influer sur formulation, rythme vocal et choix d’affichage, pas sur le modèle de risque, les faits, les outils ou la mémoire accessible.

Toute proposition d’évolution est un diff local. Un modèle peut suggérer une préférence, mais ne la persiste jamais sans validation. Historique et rollback sont disponibles.

## Défaillances

- Telegram non propriétaire : refus sans détail sensible ;
- bouton rejoué/expiré : refus et audit ;
- état modifié : demande invalidée et nouvelle simulation ;
- signature connecteur invalide : quarantaine maintenue ;
- dépendance vulnérable/absente : installation bloquée ;
- connecteur timeout/spam : processus annulé, sortie bornée, automatisations suspendues ;
- update échouée : version active intacte ;
- profil invalide : dernière révision valide conservée.

## Interface

- `Approbations` : demandes, risque, preuves, état et historique ;
- `Connecteurs` : catalogue local, permissions, versions, santé, shadow et révocation ;
- `Éditeurs approuvés` : clés, empreintes et révocations ;
- `Personnalité` : aperçu, diff, test vocal/texte, historique et rollback.

## Tests obligatoires

- approbation owner/non-owner, expiration, replay et consommation unique ;
- invalidation sur changement de chaque champ critique ;
- risque élevé refusé à distance ;
- signature/digest/zip traversal/dépendance/connecteur malveillant ;
- manifeste demandant wildcard réseau, shell ou keyring général refusé ;
- runtime borné en temps, mémoire et sortie ;
- update avec nouvelle permission exige confirmation ;
- révocation suspend les automatisations dépendantes ;
- personnalité incapable de modifier safety, facts ou capacités ;
- rollback profil et connecteur.

## Critères d’acceptation

1. Une approbation Samsung est signée, expirante, one-shot et liée à l’état/action exacts.
2. Les risques `local_only` ne sont jamais confirmés par Telegram.
3. Aucun connecteur ne s’installe sans import/validation locale et mode ombre.
4. Aucun secret n’apparaît dans manifeste, logs ou catalogue.
5. Un connecteur ne possède aucun accès général au PC, à Electron ou à la mémoire.
6. Mise à jour, rollback et révocation sont déterministes et audités.
7. La personnalité ne peut modifier aucune règle constitutionnelle ou de sécurité.

