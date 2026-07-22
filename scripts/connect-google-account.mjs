// Outil réel de connexion d'un compte Google à Mina Vision (Gmail + Calendrier + Contacts + Tâches).
// Doit être lancé via Electron (safeStorage requiert un process Electron), jamais via `node` seul :
//   npm run connect:google
//
// Ne demande et ne voit jamais le mot de passe Google de Nasro : la connexion se fait dans SON
// navigateur par défaut, via l'écran de consentement officiel Google. Toute la logique de décision
// vit dans src/mail/oauth/google-account-connector.mjs (testée à fond, tests/google-account-connector.test.mjs)
// — ce fichier ne fait que fournir les dépendances réelles liées à Electron et afficher les messages.
import { app, safeStorage, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { createKeyring } from '../src/crypto/keyring.mjs';
import { createKeyringFileStorage } from '../src/crypto/keyring-file-storage.mjs';
import { createMailAccountStore } from '../src/mail/mail-account-store.mjs';
import { GMAIL_SCOPES } from '../src/mail/oauth/google-oauth.mjs';
import { createGoogleAccountConnector } from '../src/mail/oauth/google-account-connector.mjs';
import { loadGoogleClientConfigFromEnvDir } from '../src/mail/oauth/google-client-config-file.mjs';

// Scopes couvrant Gmail (déjà câblé) + Calendrier/Contacts/Tâches (adaptateurs prêts, jamais encore
// connectés à un vrai compte) — un seul écran de consentement pour tout, jamais répété.
const SCOPES = Object.freeze([
  GMAIL_SCOPES.readonly, GMAIL_SCOPES.modify, GMAIL_SCOPES.send, GMAIL_SCOPES.compose, GMAIL_SCOPES.labels,
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/contacts',
  'https://www.googleapis.com/auth/tasks',
]);

// Saisie visible dans ce terminal local uniquement (readline n'a pas de mode masqué portable sans
// dépendance native) — jamais journalisée, jamais transmise ailleurs.
async function promptStdin(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

// Si un fichier client_secret_*.json (téléchargement standard Google Cloud Console, type
// « Application de bureau ») a été déposé dans env/, on l'utilise directement au lieu de demander
// à Nasro de retaper clientId/clientSecret à la main — mêmes deux appels que le connecteur attend,
// jamais de valeur affichée ou journalisée.
function buildPrompt(envDir) {
  const fileConfig = loadGoogleClientConfigFromEnvDir(envDir, { readdirSync: fs.readdirSync, readFileSync: fs.readFileSync });
  if (!fileConfig) return promptStdin;
  let calls = 0;
  return async (question) => {
    calls += 1;
    if (calls === 1) {
      console.log('Client ID/Secret Google trouvés automatiquement dans env/ (fichier téléchargé depuis Google Cloud Console) — utilisation directe.\n');
      return fileConfig.clientId;
    }
    if (calls === 2) return fileConfig.clientSecret;
    return promptStdin(question);
  };
}

async function main() {
  await app.whenReady();

  const storage = createKeyringFileStorage({ filename: path.join(app.getPath('userData'), 'mina-keyring.json') });
  const keyring = createKeyring({ storage, safeStorage });
  const mailAccountStore = createMailAccountStore({ keyring });
  const envDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'env');
  const prompt = buildPrompt(envDir);

  console.log('\nCréer un client OAuth desktop dans Google Cloud Console si pas déjà fait (une seule fois) :');
  console.log('console.cloud.google.com → APIs & Services → Identifiants → Créer des identifiants → ID client OAuth');
  console.log('→ type « Application de bureau ». Détail complet : docs/operations/GOOGLE-ACCOUNT.md\n');

  const connector = createGoogleAccountConnector({
    storage, keyring, mailAccountStore, prompt,
    openExternal: (url) => shell.openExternal(url),
    scopes: SCOPES,
    accountId: 'google-primary',
    address: 'mina.vision.ai@gmail.com',
  });

  const result = await connector.connect();

  switch (result.status) {
    case 'vault_not_initialized':
      console.log('Le coffre local de Mina Vision n\'est pas encore initialisé.');
      console.log('Étape requise AVANT de continuer : ouvrir Mina Vision (icône bureau), section « Mémoire »,');
      console.log('cliquer « Initialiser », noter la phrase de récupération affichée UNE SEULE FOIS, puis relancer cet outil.\n');
      app.exit(1);
      return;
    case 'client_config_required':
      console.error('Client ID / Client Secret requis.\n');
      app.exit(1);
      return;
    case 'denied':
      console.error(`Connexion échouée ou refusée : ${result.reason}\n`);
      app.exit(1);
      return;
    case 'connected':
      console.log('\nCompte Google connecté et jeton de rafraîchissement chiffré dans le coffre local.');
      console.log(`Identifiant de compte enregistré : ${result.accountId} (Gmail, Calendrier, Contacts, Tâches).`);
      console.log('Câblage réel dans l\'application (main.mjs) pour Gmail/Calendrier/Contacts/Tâches reste une');
      console.log('étape séparée non encore faite — les identifiants sont prêts et attendent ce câblage.\n');
      app.exit(0);
      return;
    default:
      console.error(`Statut inattendu : ${result.status}\n`);
      app.exit(1);
  }
}

main().catch((error) => {
  console.error(`connect-google-account: échec — ${error.message}`);
  app.exit(1);
});
