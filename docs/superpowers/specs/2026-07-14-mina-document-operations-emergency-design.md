# Mina — opérations documentaires et mode urgence hors ligne

## Objectif

Permettre à Mina de scanner, lire, classer, remplir, convertir, télécharger et imprimer des documents, tout en fournissant un mode urgence réellement local lorsque le réseau ou les fournisseurs cloud sont indisponibles.

Cette spécification complète :

- [recherche et lecture de fichiers](2026-07-14-mina-research-sms-design.md) ;
- [sandbox de code](2026-07-14-mina-code-sandbox-design.md) ;
- [moteurs OCR/vision locaux](2026-07-14-mina-local-model-runtime-settings-design.md) ;
- [caméra Huawei](2026-07-14-mina-local-model-runtime-settings-design.md#caméra-du-téléphone-fusion-écran-et-reconnaissance-de-nasro) ;
- [gouvernance des automatisations](2026-07-14-mina-automation-governance-reliability-design.md).

## Principes

- Tout document entrant est non fiable.
- Le type réel prime sur l’extension et le nom.
- Aucun macro, script, exécutable ou contenu actif n’est exécuté pendant la lecture.
- Les fichiers sont traités en quarantaine avant promotion dans un dossier autorisé.
- OCR, parsing et classification produisent des preuves localisables.
- Remplir, signer, envoyer, écraser, télécharger ou imprimer sont des effets distincts.
- Une impression n’est pas réussie parce que le spooler accepte le job ; Mina suit l’état disponible et annonce ses limites.
- Le mode urgence ne prétend jamais qu’une donnée locale ancienne est actuelle.
- Aucun fournisseur cloud, Firebase ou API distante n’est requis pour ouvrir le corpus d’urgence.

## Architecture documentaire

- `DocumentIntake` reçoit fichier, scanner, caméra ou téléchargement.
- `DocumentQuarantine` vérifie chemin, type, taille, archive et digest.
- `DocumentParserRegistry` choisit un lecteur sans exécuter de contenu actif.
- `DocumentEvidenceStore` conserve pages, blocs, cellules, coordonnées et source.
- `DocumentClassifier` propose type, projet, sensibilité et destination.
- `FormService` construit un diff de champs avant écriture.
- `DocumentConverter` produit PDF/images/texte via outils allowlistés.
- `PrintService` découvre les imprimantes enregistrées et soumet des jobs typés.
- `DownloadService` gère destinations, conflits de noms et provenance.
- `EmergencyCorpus` maintient un paquet local signé, chiffré et versionné.

## Pipeline

```text
entrée
→ quarantaine
→ type réel + digest + limites
→ antivirus disponible + politique
→ parsing/OCR local
→ preuves structurées
→ classification proposée
→ aperçu/diff
→ autorisation
→ effet
→ vérification
→ stockage et mémoire optionnelle
```

Un antivirus indisponible ne transforme pas un fichier en sûr. Les types exécutables, macros et archives complexes restent bloqués ou confinés à l’analyse sans promotion.

## Entrées

### Fichiers PC

La mission fournit un chemin ou une ressource explicitement autorisée. Mina résout le chemin réel, bloque les échappements par lien/junction et applique taille, extension, type et classification.

### Scanner et caméra

Le scanner réseau ou USB doit être enregistré comme connecteur. La caméra Huawei capture seulement après indication visible. Les frames non retenues sont détruites ; le document final est séparé du flux biométrique.

### Téléchargements

Le navigateur fournit URL finale, en-têtes non secrets, nom suggéré, taille et digest. Le contenu reste en quarantaine jusqu’à validation de type. Les téléchargements automatiques d’un site non allowlisté restent en mode ombre ou demandent confirmation.

## Parsing et preuves

Chaque lecteur retourne :

```text
DocumentObservation
  documentId
  mediaType
  pageCount
  sections[]
  blocks[]
  tables[]
  fields[]
  sourceOffsets[]
  confidence
  parserId
  parserVersion
```

Une réponse factuelle cite page, zone, cellule ou offset. Un OCR incertain conserve le texte brut observé, la confiance et l’image de zone référencée localement.

## Classement et mémoire

`DocumentClassifier` propose projet, catégorie, personnes liées, dates, sensibilité et durée de conservation. La destination finale est un dossier allowlisté. La mémoire/RAG reçoit uniquement les chunks autorisés, avec provenance et classification ; elle ne reçoit pas automatiquement l’intégralité du fichier.

## Formulaires et modifications

Mina travaille sur une copie versionnée et affiche :

- champs existants ;
- valeurs proposées ;
- source de chaque valeur ;
- champs manquants ou ambigus ;
- zones modifiées ;
- fichier de sortie et digest.

Signature numérique, paraphe, données bancaires, santé, identité et engagement contractuel exigent confirmation locale. Mina ne fabrique jamais une signature manuscrite ni une donnée manquante.

## Conversion

Les convertisseurs sont allowlistés et exécutés avec durée, mémoire, sortie et dossier bornés. Aucun accès réseau. Les conversions conservent l’original, le digest, l’outil/version et le rapport d’erreurs. Une conversion visuellement dégradée est signalée et ne remplace pas l’original.

## Impression

Une imprimante doit être découverte puis approuvée localement. Son binding contient nom stable, pilote, emplacement, capacités et dernière santé.

```text
PrintProposal
  documentDigest
  printerId
  pages
  copies
  duplex
  color
  media
  estimatedSheets
```

Avant soumission, Mina affiche aperçu, pages, copies, imprimante et coût papier estimé. Le résultat distingue `accepted_by_spooler`, `printing`, `completed`, `failed` et `state_unknown` selon les informations réellement disponibles. Un retry utilise le job ID et ne duplique pas silencieusement l’impression.

## Mode urgence hors ligne

### Contenu

Nasro sélectionne explicitement :

- contacts et numéros importants ;
- procédures PC, réseau, Huawei et maison ;
- notices d’appareils ;
- documents administratifs nécessaires ;
- informations médicales choisies ;
- plans et emplacements utiles ;
- modèles locaux nécessaires ;
- derniers états locaux avec horodatage.

### Paquet

`EmergencyCorpus` produit un manifeste signé contenant digests, versions, classifications et date de dernière synchronisation. Le paquet est chiffré par le keyring, vérifié avant ouverture et lisible sans réseau. Une exportation vers support externe exige une phrase/clé dédiée et une confirmation locale.

### Comportement

En urgence :

- réseau et automatisations externes coupés ;
- modèles cloud indisponibles ;
- RAG limité au corpus local autorisé ;
- caméra/micro désactivés par défaut, activables explicitement ;
- diagnostic PC local disponible ;
- données affichées avec date/fraîcheur ;
- aucune action physique sensible débloquée par le mode urgence.

Le bouton d’urgence peut suspendre réseau, caméra, micro, automatisations, email sortant, messagerie sortante et maison connectée. Les diagnostics et la consultation du corpus restent disponibles.

## Défaillances

- fichier trop grand ou type incohérent : quarantaine maintenue ;
- archive chiffrée : mot de passe demandé localement, jamais envoyé au modèle ;
- OCR faible : zones incertaines présentées ;
- écriture interrompue : sortie temporaire supprimée ou conservée comme incomplète, original intact ;
- spooler accepté sans état final : `state_unknown` ;
- imprimante hors ligne : aucune boucle de retry ;
- manifeste urgence altéré : corpus refusé, dernière version valide conservée ;
- données urgence anciennes : date visible, aucune affirmation d’actualité.

## Interface

- `Documents` : quarantaine, preuves, classification, versions et mémoire ;
- `Formulaires` : champs, sources et diff ;
- `Impression` : imprimantes, aperçu, jobs et états ;
- `Téléchargements` : provenance, type et destination ;
- `Urgence` : corpus, fraîcheur, vérification et bouton de coupure.

## Tests obligatoires

- type réel différent de l’extension ;
- ZIP traversal, bombe, macro, exécutable et lien/junction ;
- OCR avec coordonnées, confiance et provenance ;
- remplissage sans invention et diff exact ;
- conversion timeout/mémoire/sortie bornés ;
- impression acceptée, échouée, inconnue et retry idempotent ;
- aucune donnée biométrique dans les documents ;
- corpus urgence chiffré, signé, offline et altération détectée ;
- fraîcheur visible ;
- arrêt d’urgence sans perte du journal de récupération.

## Critères d’acceptation

1. Aucun document actif n’est exécuté pendant l’analyse.
2. Toute extraction factuelle conserve une preuve localisable.
3. Les modifications travaillent sur une copie et affichent un diff avant effet.
4. Téléchargements et impressions sont idempotents et vérifiés selon les preuves disponibles.
5. Le corpus urgence fonctionne sans réseau ni fournisseur cloud.
6. Une donnée locale ancienne est toujours datée et jamais présentée comme actuelle.
7. Le mode urgence ne réduit aucune exigence de confirmation sensible.

