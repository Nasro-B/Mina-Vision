// RESTAURATION DE L'ANCIENNE MÉMOIRE DE MINA — à lancer UNIQUEMENT sur décision de Nasro.
//
// Contexte (diagnostic prouvé du 2026-07-22) : le coffre actuel (créé 20/07 02:25) est
// indéchiffrable — sa clé os_crypt a été écrasée pendant la migration de userData. Sans la
// phrase de récupération du 20/07, ses données (mémoire du 20 au 22/07) sont irrécupérables.
// L'ANCIEN coffre (agentvisionsourire, ≤ 19/07) reste déchiffrable par l'ancienne clé.
//
// Ce script (lancé avec l'ANCIEN userData, seul contexte qui déchiffre l'ancien coffre) :
//   1. Sauvegarde le coffre et la base mémoire ACTUELS (suffixe .perdu-<date>) — rien n'est détruit.
//   2. Déchiffre la master key de l'ANCIEN coffre (en mémoire uniquement, jamais affichée).
//   3. Génère une NOUVELLE phrase de récupération + nouvelle enveloppe pour cette master key.
//   4. Écrit le coffre restauré dans « Mina Vision » (wrap DPAPI volontairement laissé mort :
//      le premier déverrouillage PAR PHRASE le répare automatiquement — self-heal du keyring).
//   5. Copie l'ancienne base mémoire à la place de l'actuelle.
//   6. Affiche la NOUVELLE phrase — À NOTER IMMÉDIATEMENT.
//
// Usage :  npx electron scripts/restore-old-memory-vault.mjs
// Préalable : fermer Mina Vision.

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { app, safeStorage } from 'electron';
import { encryptAead, createAad } from '../src/crypto/aead.mjs';
import { generateRecoveryPhrase, normalizeRecoveryPhrase } from '../src/crypto/recovery-phrase.mjs';
import argon2 from 'argon2';

const OLD_DIR = 'C:/Users/Nasro/AppData/Roaming/agentvisionsourire';
const NEW_DIR = 'C:/Users/Nasro/AppData/Roaming/Mina Vision';
const RECOVERY_AAD = createAad({ version: 1, type: 'keyring_recovery', id: 'master' });

app.setPath('userData', OLD_DIR);

app.whenReady().then(async () => {
  try {
    const stamp = new Date().toISOString().slice(0, 10);

    // 1. Sauvegardes de l'état actuel — réversible à la main.
    for (const name of ['mina-keyring.json', 'mina-memory.sqlite']) {
      const current = `${NEW_DIR}/${name}`;
      if (existsSync(current)) {
        copyFileSync(current, `${current}.perdu-${stamp}`);
        console.log(`sauvegardé : ${name} -> ${name}.perdu-${stamp}`);
      }
    }

    // 2. Déchiffre l'ancienne master key (contexte = ancien userData, prouvé fonctionnel).
    const oldRecord = JSON.parse(readFileSync(`${OLD_DIR}/mina-keyring.json`, 'utf8'));
    const decoded = safeStorage.decryptString(Buffer.from(oldRecord.wrappedMasterKey, 'base64'));
    const masterKey = Buffer.from(decoded, 'base64');
    if (masterKey.length !== 32) throw new Error('master key invalide');
    const checksum = createHash('sha256').update(masterKey).digest('base64url');
    if (checksum !== oldRecord.checksum) throw new Error('checksum de l\'ancien coffre incohérent');

    // 3. Nouvelle phrase + nouvelle enveloppe (indépendante de DPAPI).
    const recoveryPhrase = generateRecoveryPhrase();
    const recoverySalt = randomBytes(16);
    const recoveryKey = Buffer.from(await argon2.hash(normalizeRecoveryPhrase(recoveryPhrase), {
      type: argon2.argon2id,
      memoryCost: oldRecord.argon2.memoryCost,
      timeCost: oldRecord.argon2.timeCost,
      parallelism: oldRecord.argon2.parallelism,
      hashLength: oldRecord.argon2.hashLength,
      raw: true,
      salt: recoverySalt,
    }));

    // 4. Coffre restauré : wrap DPAPI laissé tel quel (mort pour la nouvelle app) — le premier
    //    déverrouillage par la nouvelle phrase déclenche le re-wrap automatique (self-heal).
    const restored = {
      ...oldRecord,
      recoveryEnvelope: encryptAead({ key: recoveryKey, plaintext: masterKey, aad: RECOVERY_AAD }),
      recoverySalt: recoverySalt.toString('base64'),
    };
    writeFileSync(`${NEW_DIR}/mina-keyring.json`, JSON.stringify(restored, null, 2), 'utf8');
    masterKey.fill(0);
    recoveryKey.fill(0);
    console.log('coffre restauré écrit dans « Mina Vision »');

    // 5. Ancienne base mémoire remise en place.
    copyFileSync(`${OLD_DIR}/mina-memory.sqlite`, `${NEW_DIR}/mina-memory.sqlite`);
    console.log('base mémoire ≤ 19/07 restaurée');

    // 6. La phrase — remise au propriétaire via un FICHIER local (jamais dans une console
    //    potentiellement journalisée). À lire, noter ailleurs, puis SUPPRIMER.
    const phraseFile = 'C:/Users/Nasro/Documents/Mina Vision/PHRASE-RECUPERATION-A-LIRE-PUIS-SUPPRIMER.txt';
    const { mkdirSync } = await import('node:fs');
    mkdirSync('C:/Users/Nasro/Documents/Mina Vision', { recursive: true });
    writeFileSync(phraseFile, [
      'NOUVELLE PHRASE DE RÉCUPÉRATION du coffre mémoire de Mina Vision',
      `(générée le ${new Date().toLocaleString('fr-FR')})`,
      '',
      recoveryPhrase,
      '',
      '1. Noter cette phrase dans un endroit sûr (papier, gestionnaire de mots de passe).',
      '2. Dans Mina : « Déverrouiller » en collant cette phrase — la réparation du',
      '   déverrouillage automatique se fait toute seule au premier déverrouillage.',
      '3. SUPPRIMER ce fichier immédiatement après.',
    ].join('\n'), 'utf8');
    console.log('');
    console.log(`PHRASE ÉCRITE DANS : ${phraseFile}`);
    console.log('La lire, la noter, déverrouiller Mina avec, puis SUPPRIMER le fichier.');
  } catch (error) {
    console.error('ÉCHEC restauration :', String(error?.message ?? error));
    console.error('Rien d\'irréversible : les fichiers .perdu-<date> contiennent l\'état d\'avant.');
  } finally {
    app.exit(0);
  }
});
