#!/usr/bin/env node
// Provisionne le modèle d'EMBEDDING FACIAL utilisé par la reconnaissance locale de Mina.
//
// La biométrie faciale est une capacité de SÉCURITÉ : un modèle ou un préprocessing erroné donnerait
// une auth dangereuse. Ce script NE TÉLÉCHARGE PAS un modèle au hasard — c'est TOI qui fournis un
// modèle ONNX que tu as choisi et validé (ex. ArcFace / MobileFaceNet), avec ses paramètres exacts.
// Le script vérifie le fichier, calcule son sha256 et écrit le manifeste que le runtime attend.
//
//   node scripts/provision-face-model.mjs \
//     --model=chemin/vers/arcface.onnx \
//     --input=input.1 --output=683 \
//     --width=112 --height=112 \
//     --mean=0.5,0.5,0.5 --std=0.5,0.5,0.5 --layout=nchw
//
// Détails et modèles recommandés : docs/guides/face-model.md

import { createHash } from 'node:crypto';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveStorageRoots } from '../src/system/storage-roots.mjs';
import { createFaceModelLoader } from '../src/biometrics/face-model-loader.mjs';
import { createFaceEmbedder } from '../src/biometrics/face-embedder.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const die = (msg) => { console.error('[face-model] ERREUR:', msg); process.exit(1); };
const arg = (name, def = null) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};
const triplet = (value, label) => {
  const parts = String(value ?? '').split(',').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) die(`${label} doit être 3 nombres séparés par des virgules`);
  return parts;
};

async function main() {
  const modelPath = arg('model');
  if (!modelPath) die('--model=<chemin vers le .onnx> requis');
  const inputName = arg('input') || die('--input=<nom du tenseur d\'entrée> requis');
  const outputName = arg('output') || die('--output=<nom du tenseur de sortie> requis');
  const width = Number(arg('width', '112'));
  const height = Number(arg('height', '112'));
  const layout = arg('layout', 'nchw');
  const mean = triplet(arg('mean', '0.5,0.5,0.5'), 'mean');
  const std = triplet(arg('std', '0.5,0.5,0.5'), 'std');
  if (!['nchw', 'nhwc'].includes(layout)) die('--layout doit être nchw ou nhwc');

  const userData = process.env.MINA_USERDATA_PATH
    ?? join(process.env.APPDATA ?? join(process.env.USERPROFILE ?? ROOT, 'AppData', 'Roaming'), 'Mina Vision');
  const { modelsRoot } = resolveStorageRoots({ userDataPath: userData });
  const installPath = join(modelsRoot, 'face');
  await mkdir(installPath, { recursive: true });

  const modelFile = basename(modelPath).replace(/[^A-Za-z0-9._-]/gu, '_') || 'model.onnx';
  const destModel = join(installPath, modelFile);
  await copyFile(modelPath, destModel);
  const sha256 = createHash('sha256').update(await readFile(destModel)).digest('hex');

  const manifest = {
    id: 'face-embedder',
    installPath,
    modelFile,
    sha256,
    tensorSignature: { inputs: [inputName], outputs: [outputName] },
    inputName,
    outputName,
    preprocess: { inputWidth: width, inputHeight: height, mean, std, layout },
  };

  // Vérification RÉELLE : le loader doit charger le modèle (checksum + signature de tenseurs) et
  // l'embedder doit produire un vecteur sur une image de test — sinon on n'écrit pas le manifeste.
  const loader = createFaceModelLoader();
  await loader.load(manifest).catch((error) => die(`le modèle ne se charge pas : ${error.message} (vérifie --input/--output contre la vraie signature du .onnx)`));
  const { default: sharp } = await import('sharp');
  const { default: ort } = await import('onnxruntime-node');
  const embedder = createFaceEmbedder({ loader, manifest, sharpImpl: sharp, createTensor: (t, d, dims) => new ort.Tensor(t, d, dims) });
  const probe = await sharp({ create: { width, height, channels: 3, background: { r: 128, g: 128, b: 128 } } }).jpeg().toBuffer();
  const vector = await embedder.embed({ image: probe }).catch((error) => die(`l'embedder échoue sur une image de test : ${error.message}`));
  if (!Array.isArray(vector) || vector.length < 16) die(`sortie d'embedding suspecte (${vector?.length} dimensions) — mauvais --output ?`);

  await writeFile(join(installPath, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`[face-model] OK — modèle installé (${modelFile}, sha256 ${sha256.slice(0, 12)}…), embedding ${vector.length}D.`);
  console.log('[face-model] Redémarre Mina : la reconnaissance faciale passe « available ».');
}

main().catch((error) => die(error?.stack ?? String(error)));
