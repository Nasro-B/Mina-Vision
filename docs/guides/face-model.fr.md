> [🇬🇧 English](face-model.md) · 🇫🇷 **Français**

# Reconnaissance faciale locale — provisionner un modèle

La reconnaissance faciale de Mina est **locale** (aucune image ne part sur Internet) et **optionnelle**.
Tant qu'aucun modèle n'est provisionné, la capacité `biometrics.face` reste honnêtement
« indisponible » et **aucune reconnaissance ne peut jamais renvoyer un faux positif** (fail-closed).

## Pourquoi tu fournis le modèle toi-même

C'est une capacité de **sécurité**. Un modèle inadapté ou un préprocessing erroné donnerait une
authentification faciale dangereuse. Mina ne télécharge donc **pas** un modèle au hasard : tu choisis
un modèle ONNX d'embedding facial que tu as validé (ex. **ArcFace** ou **MobileFaceNet**, largement
disponibles au format ONNX), et tu déclares ses paramètres exacts. Le script vérifie tout avant de
l'activer.

## Étapes

1. Récupère un modèle d'embedding facial au format `.onnx` (112×112 en général, sortie 512-D).
2. Repère les noms EXACTS de ses tenseurs d'entrée/sortie (avec Netron, ou `onnxruntime`).
3. Lance le provisionnement (tu exécutes toi-même — le script lit/copie un fichier local) :

```bash
node scripts/provision-face-model.mjs --model=chemin/vers/arcface.onnx --input=input.1 --output=683 --width=112 --height=112 --mean=0.5,0.5,0.5 --std=0.5,0.5,0.5 --layout=nchw
```

Le script :
- copie le modèle sous `%APPDATA%\Mina Vision\cache\models\face\`,
- calcule son `sha256`,
- **charge réellement** le modèle (vérifie checksum + signature des tenseurs),
- **exécute un embedding de test** sur une image neutre (échoue si la sortie est absurde),
- écrit `manifest.json` seulement si tout passe.

4. Redémarre Mina. La capacité `biometrics.face` passe « available ».

## Paramètres

| Option | Rôle |
|--------|------|
| `--input` / `--output` | noms exacts des tenseurs ONNX (doivent correspondre au modèle, sinon refus) |
| `--width` / `--height` | taille d'entrée du modèle (défaut 112×112) |
| `--mean` / `--std` | normalisation par canal RGB (défaut 0.5,0.5,0.5 — plage [-1,1]) |
| `--layout` | `nchw` (défaut, [1,3,H,W]) ou `nhwc` ([1,H,W,3]) |

Si les noms de tenseurs ou la normalisation ne correspondent pas au modèle, le script **refuse**
d'écrire le manifeste — jamais de biométrie à moitié configurée.

## Sécurité

- Le modèle est vérifié par `sha256` à chaque chargement au runtime : un fichier altéré est refusé.
- Les profils faciaux enregistrés sont chiffrés dans le coffre (comme la mémoire).
- L'embedding se fait entièrement sur le PC (onnxruntime CPU) : aucune image, aucun gabarit facial
  ne quitte la machine.
