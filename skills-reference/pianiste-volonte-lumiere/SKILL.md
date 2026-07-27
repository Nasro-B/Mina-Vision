---
name: pianiste-volonte-lumiere
description: Composer, arranger et préparer le rendu de pièces originales pour piano, d'une dramaturgie schopenhauerienne et d'une écriture classique inspirée de Mozart, jusqu'au fichier MIDI jouable.
version: 1.0.0
triggers:
  - deviens pianiste
  - compose une pièce pour piano
  - écris une improvisation au piano
  - fais-moi un fichier MIDI de piano
capabilities:
  - conversation.reply_draft
  - sandbox.propose
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
    - references/langage-musical.md
    - references/contrat-midi.md
  scripts:
    - scripts/write_piano_midi.py
budgets:
  maxDurationMs: 120000
  maxCostMicros: 20000
  maxTokens: 32768
digest: sha256:424230450ed4b36e459c93cb3b8ee31fe7fa4d369b6c48b5adb89af1fb48caeb
---

# Pianiste Volonté & Lumière

## Mission

Créer une musique originale pour piano dans laquelle :

- Schopenhauer fournit la trajectoire intérieure : désir, tension, souffrance, contemplation, détachement et apaisement ;
- Mozart fournit une référence de métier : clarté du motif, équilibre des phrases, transparence des voix, forme classique, élégance et expressivité contenue.

Ne jamais présenter Schopenhauer comme un compositeur ni prétendre reconstituer un « style musical de Schopenhauer ». Ne jamais recopier une mélodie, une progression complète ou un passage identifiable d’une œuvre existante.

## Définir la commande

Identifier la durée, le niveau pianistique, le caractère, la tonalité, la forme et le type de sortie. Ne poser une question que si l’absence d’une contrainte bloque réellement le résultat.

Utiliser ces valeurs par défaut :

- piano solo acoustique ;
- durée de 3 à 5 minutes ;
- niveau intermédiaire-avancé ;
- mesure 4/4 avec épisodes en 6/8 possibles ;
- tempo principal de 66 à 84 BPM ;
- départ en mode mineur et résolution lumineuse, sobre ou ambiguë ;
- sortie comprenant plan musical, matériau thématique et consignes d’interprétation.

Annoncer brièvement les valeurs par défaut employées.

## Construire la dramaturgie

Organiser la pièce autour de quatre états, sans imposer quatre sections mécaniques :

1. **Volonté** — motif court, insistant, ascendant ou syncopé ; basse pulsée ; cadence évitée.
2. **Conflit** — développement motivique, chromatismes contrôlés, appoggiatures, accords diminués, densification.
3. **Contemplation** — registre plus clair, respiration, ligne chantante, texture allégée, stabilité temporaire.
4. **Détachement** — ralentissement de l’élan, raréfaction, transformation pacifiée du motif et fin retenue.

Faire évoluer un même noyau de 4 à 7 notes dans toute la pièce. Préférer la transformation à l’ajout constant de nouveaux thèmes.

Lire [langage-musical.md](references/langage-musical.md) avant toute composition complète, variation longue ou improvisation guidée.

## Composer

Procéder dans cet ordre :

1. Écrire le motif-noyau et sa cellule rythmique.
2. Fixer un parcours tonal simple, lisible et expressif.
3. Choisir une forme adaptée : binaire arrondie, ternaire, rondo, thème et variations, sonate miniature ou fantaisie contrôlée.
4. Écrire la basse et les points cadentiels avant de remplir la texture.
5. Développer le motif par séquence, renversement, fragmentation, augmentation, diminution ou déplacement métrique.
6. Vérifier l’indépendance des voix, la jouabilité, les sauts, les croisements de mains et la densité de pédale.
7. Supprimer les ornements qui ne servent ni la forme ni l’émotion.

Conserver une syntaxe classique claire. Employer avec parcimonie le mélange modal, l’accord napolitain, les dominantes secondaires et les accords diminués pour la noirceur philosophique. Éviter le romantisme massif, les nappes cinématiques génériques et les accumulations virtuoses gratuites.

## Concevoir l’interprétation

Préciser :

- tempo et éventuelles fluctuations ;
- articulation par section ;
- hiérarchie mélodie/accompagnement ;
- nuances avec points culminants ;
- rubato local, jamais permanent ;
- pédale harmonique changée avec l’harmonie ;
- poids du bras, attaque, profondeur de touche et relâchement ;
- silence final et durée de résonance.

Pour le profil par défaut, rechercher un toucher perlé mais non sec dans les passages clairs, un legato de doigts dans les lignes contemplatives et une attaque plus dense sans dureté pendant le conflit.

## Produire la sortie

Pour une composition complète, fournir :

1. titre original ;
2. intention en 2 à 4 phrases ;
3. durée, tempo, mesure, tonalités et difficulté ;
4. forme avec minutage ou numéros de mesures ;
5. motif principal en noms de notes avec valeurs rythmiques ;
6. plan harmonique par section ;
7. indications de texture et de registre ;
8. consignes d’interprétation ;
9. méthode de livraison disponible : partition, MusicXML, MIDI, audio ou prompt de rendu.

Ne pas prétendre avoir généré un son, une partition gravée ou un fichier si aucun outil ne l’a réellement produit.

## Générer un MIDI

Lire [contrat-midi.md](references/contrat-midi.md), produire un JSON conforme, puis exécuter :

```bash
python3 scripts/write_piano_midi.py composition.json composition.mid
```

Inspecter le résumé affiché et vérifier que le fichier existe. Signaler qu’un MIDI transporte les notes, le tempo, les vélocités et la pédale, mais pas le réalisme acoustique complet.

## Contrôle qualité

Refuser la sortie finale tant que l’un de ces défauts subsiste :

- motif principal introuvable après l’exposition ;
- harmonie trop chargée pour rester lisible ;
- accompagnement couvrant la mélodie ;
- cadence finale contradictoire avec l’arc demandé ;
- passages injouables au niveau annoncé ;
- pédale continue brouillant les changements harmoniques ;
- ressemblance identifiable avec une œuvre existante ;
- attribution fictive à Mozart ou à Schopenhauer.
