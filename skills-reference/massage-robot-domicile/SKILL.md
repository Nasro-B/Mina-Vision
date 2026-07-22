---
name: massage-robot-domicile
description: Conception de séances, prompts, procédures et garde-fous pour un robot de massage à domicile — protocoles non médicaux, limites de pression/durée/zones, questionnaire de sécurité, sessions supervisées.
version: 1.0.0
triggers:
  - prépare une séance de massage
  - robot de massage
  - massage robotisé
  - checklist sécurité massage
capabilities:
  - conversation.reply_draft
channels:
  - local
  - voice
compatibility:
  mina: ">=3"
  platforms:
    - win32
entrypoints:
  instructions: SKILL.md
  references:
    - references/securite.md
  scripts: []
budgets:
  maxDurationMs: 30000
  maxCostMicros: 5000
  maxTokens: 8192
digest: sha256:cd5be9d713e04ef04d8baa5b50065c75498fd3ab4a5c3bf95617ea0360445d1c
---

# Massage Robot Domicile

## Principe

PrÃ©parer des sÃ©ances de massage robotisÃ© prudentes, non mÃ©dicales et supervisÃ©es. Ne jamais prÃ©senter le robot comme capable de diagnostiquer, traiter une pathologie, manipuler la colonne, corriger une blessure, ou remplacer un professionnel de santÃ©.

Avant de produire une sÃ©quence exÃ©cutable, lire `references/securite.md`.

## Workflow

1. Identifier le contexte: objectif de la sÃ©ance, Ã¢ge approximatif, zone ciblÃ©e, durÃ©e souhaitÃ©e, niveau de douleur ou tension, antÃ©cÃ©dents pertinents, grossesse, chirurgie rÃ©cente, traitement anticoagulant, troubles neurologiques, peau fragile, fiÃ¨vre, infection, blessure, varices importantes, pacemaker ou implant mÃ©dical.
2. Identifier les capacitÃ©s rÃ©elles du robot: zones accessibles, actionneurs, plage de pression, vitesse, chaleur, vibration, capteurs de force, camÃ©ra, micro, bouton d'arrÃªt, contrÃ´le vocal, journalisation, limite logicielle et limite matÃ©rielle.
3. Trier le risque:
   - Refuser la sÃ©ance et recommander un avis mÃ©dical si un drapeau rouge est prÃ©sent.
   - Proposer une sÃ©ance trÃ¨s lÃ©gÃ¨re si l'utilisateur est incertain mais sans drapeau rouge net.
   - Autoriser un protocole standard uniquement si consentement, supervision et arrÃªt d'urgence sont confirmÃ©s.
4. Choisir un protocole conservateur: dÃ©tente gÃ©nÃ©rale, nuque/Ã©paules douce, dos haut sans colonne, lombaires lÃ©gÃ¨res, jambes rÃ©cupÃ©ration douce, pieds mains, ou respiration-relaxation sans contact.
5. DÃ©finir les paramÃ¨tres: durÃ©e courte, pression basse au dÃ©part, progression lente, zones interdites explicites, pause de feedback, critÃ¨re d'arrÃªt immÃ©diat.
6. Produire une sortie actionnable: briefing utilisateur, checklist robot, protocole minute par minute, limites, phrases vocales, et journal minimal.

## RÃ¨gles De SÃ©curitÃ©

Toujours exiger un consentement explicite avant contact physique. Toujours prÃ©voir une commande d'arrÃªt simple comme "stop", un bouton physique accessible, et un arrÃªt automatique si la personne dit douleur, vertige, engourdissement, malaise, brÃ»lure, peur, ou "arrÃªte".

Ne jamais masser directement:

- Colonne vertÃ©brale, cou antÃ©rieur, gorge, abdomen profond, organes gÃ©nitaux, poitrine, visage sauf dispositif validÃ© pour cela.
- Plaie, bleu important, brÃ»lure, infection cutanÃ©e, zone inflammÃ©e, fracture suspectÃ©e, articulation instable.
- Varices douloureuses ou saillantes, zone de thrombose suspectÃ©e, mollet douloureux et gonflÃ©.
- Implant mÃ©dical, pacemaker, cathÃ©ter, pompe, cicatrice rÃ©cente, zone opÃ©rÃ©e sans accord mÃ©dical.

Ne jamais utiliser chaleur ou vibration sans compatibilitÃ© matÃ©rielle confirmÃ©e et accord utilisateur.

## ParamÃ¨tres Conservateurs

Utiliser ces bornes par dÃ©faut si le robot n'a pas de protocole fabricant plus strict:

| ParamÃ¨tre | DÃ©butant | Standard prudent | Maximum sans avis pro |
|---|---:|---:|---:|
| DurÃ©e totale | 5-8 min | 10-15 min | 20 min |
| Pression | 10-20% | 20-35% | 40% |
| Progression | +5% max | +5% par pause | jamais brusque |
| Pause feedback | toutes les 2 min | toutes les 3 min | obligatoire |
| Douleur tolÃ©rÃ©e | 0/10 | 0-2/10 | arrÃªter si >2/10 |

Si le robot mesure la force en newtons, ne convertir les pourcentages qu'avec la documentation fabricant. Ne pas inventer d'Ã©quivalence.

## Protocoles Types

### DÃ©tente GÃ©nÃ©rale

Objectif: relaxation, stress, fatigue lÃ©gÃ¨re.

SÃ©quence: respiration guidÃ©e 60 s, Ã©paules trapÃ¨zes 3 min, dos haut paravertÃ©bral sans toucher la colonne 4 min, jambes lÃ©gÃ¨res 4 min, fin douce 60 s. Pression 20-30%, sans chaleur par dÃ©faut.

### Nuque Et Ã‰paules Douces

Objectif: tension de bureau sans douleur aiguÃ«.

SÃ©quence: trapÃ¨zes 2 min par cÃ´tÃ©, Ã©paules postÃ©rieures 2 min, haut du dos 4 min. Ã‰viter cou antÃ©rieur, vertÃ¨bres cervicales et base du crÃ¢ne si le robot n'est pas conÃ§u pour cette zone.

### Jambes RÃ©cupÃ©ration Douce

Objectif: fatigue musculaire simple.

SÃ©quence: cuisses 3 min par cÃ´tÃ©, mollets 2 min par cÃ´tÃ© avec pression basse. Refuser si mollet gonflÃ©, chaud, rouge, douloureux, ou risque thrombotique.

## Format De Sortie RecommandÃ©

RÃ©pondre avec:

1. Statut: autorisÃ©, Ã  allÃ©ger, ou refusÃ©.
2. Raison courte.
3. Checklist avant sÃ©ance.
4. Protocole minute par minute.
5. Limites robot Ã  configurer.
6. Phrases d'arrÃªt et de feedback.
7. Journal minimal: date, protocole, durÃ©e, zones, pression max, incidents, ressenti final.

## Exemples De Commandes Utilisateur

- "CrÃ©e une sÃ©ance de massage robot pour Ã©paules tendues aprÃ¨s ordinateur."
- "Ã‰cris le prompt systÃ¨me d'un agent qui pilote un robot de massage Ã  domicile."
- "Audite ce protocole de robot masseur et dis-moi ce qui est dangereux."
- "PrÃ©pare une checklist sÃ©curitÃ© avant massage robotisÃ©."

## Refus Type

Si la demande est risquÃ©e, refuser clairement la partie dangereuse et proposer une alternative sÃ»re:

"Je ne peux pas valider un massage robotisÃ© sur cette zone/situation. Risque: [raison]. Option sÃ»re: sÃ©ance sans contact, respiration guidÃ©e, ou massage uniquement sur zones non concernÃ©es aprÃ¨s avis mÃ©dical."
