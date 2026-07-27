# Contrat JSON pour le MIDI

Le script `scripts/write_piano_midi.py` accepte un objet JSON UTF-8 :

```json
{
  "title": "La volonté suspendue",
  "tempo_bpm": 72,
  "time_signature": [4, 4],
  "ticks_per_beat": 480,
  "program": 0,
  "notes": [
    {"pitch": "C4", "start": 0, "duration": 1, "velocity": 72},
    {"pitch": "Eb4", "start": 1, "duration": 0.5, "velocity": 68}
  ],
  "pedal": [
    {"start": 0, "duration": 2, "value": 96}
  ]
}
```

## Champs

- `title` : titre de piste, chaîne facultative.
- `tempo_bpm` : entier ou décimal de 20 à 300.
- `time_signature` : deux entiers ; le dénominateur doit être 1, 2, 4, 8, 16 ou 32.
- `ticks_per_beat` : entier de 96 à 9600 ; 480 par défaut.
- `program` : programme General MIDI de 0 à 127 ; 0 correspond au piano acoustique.
- `notes` : tableau obligatoire.
- `pitch` : nom de note de `C-1` à `G9`, avec `#` ou `b`, ou numéro MIDI de 0 à 127.
- `start` et `duration` : positions exprimées en noires, valeurs positives ou nulles ; `duration` doit être strictement positive.
- `velocity` : entier de 1 à 127.
- `pedal` : tableau facultatif d’actions de pédale forte MIDI CC64.
- `value` : valeur de pédale de 64 à 127 ; le script remet automatiquement la pédale à zéro à la fin de chaque durée.

## Règles musicales

- Ordonner les notes par `start`.
- Ne pas quantifier plus finement que 1/16 de noire sans nécessité.
- Éviter les chevauchements de la même hauteur, sauf trille ou répétition volontaire.
- Donner à la mélodie une vélocité supérieure de 6 à 18 points à l’accompagnement.
- Changer la pédale sur chaque changement harmonique réel.
- Laisser au moins 0,25 noire de résonance après la dernière attaque si la fin le permet.

Le fichier produit contient une piste MIDI standard de type 0. Le réalisme final dépend du piano virtuel, de la banque de sons, de la réverbération et de l’interprétation appliquée au MIDI.

