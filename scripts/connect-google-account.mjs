// Outil réel de connexion d'un compte Google à Mina Vision (Gmail + Calendrier + Contacts + Tâches).
// Doit être lancé via Electron (safeStorage requiert un process Electron), jamais via `node` seul :
//   npm run connect:google
//
// Ne demande et ne voit jamais le mot de passe Google de Nasro : la connexion se fait dans SON
// navigateur par défaut, via l'écran de consentement officiel Google. Toute la logique de décision
// vit dans src/mail/oauth/google-account-connector.mjs (testée à fond, tests/google-account-connector.test.mjs)
// — ce fichier ne fait que fournir les dépendances réelles liées à Electron et afficher les messages.
import { app, clipboard, safeStorage, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import dotenv from 'dotenv';
import { createKeyring } from '../src/crypto/keyring.mjs';
import { createKeyringFileStorage } from '../src/crypto/keyring-file-storage.mjs';
import { createMailAccountStore } from '../src/mail/mail-account-store.mjs';
import { GMAIL_SCOPES } from '../src/mail/oauth/google-oauth.mjs';
import { createGoogleAccountConnector } from '../src/mail/oauth/google-account-connector.mjs';
import { createOAuthLoopbackServer } from '../src/mail/oauth/oauth-loopback-server.mjs';
import {
  checkGoogleClientProjectMatch,
  loadGoogleClientConfigFromEnvDir,
} from '../src/mail/oauth/google-client-config-file.mjs';
import { resolveUserDataStrategy } from '../src/ui/user-data-path.mjs';

// Scopes couvrant Gmail (déjà câblé) + Calendrier/Contacts/Tâches (adaptateurs prêts, jamais encore
// connectés à un vrai compte) — un seul écran de consentement pour tout, jamais répété.
const SCOPES = Object.freeze([
  GMAIL_SCOPES.readonly, GMAIL_SCOPES.modify, GMAIL_SCOPES.send, GMAIL_SCOPES.compose, GMAIL_SCOPES.labels,
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/contacts',
  'https://www.googleapis.com/auth/tasks',
]);

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

app.setName('Mina Vision');
{
  const { preserveExplicitUserData, namedUserData } = resolveUserDataStrategy({
    argv: process.argv,
    appDataPath: app.getPath('appData'),
  });
  if (!preserveExplicitUserData) app.setPath('userData', namedUserData);
}

// Saisie visible dans ce terminal local uniquement (readline n'a pas de mode masqué portable sans
// dépendance native) — jamais journalisée, jamais transmise ailleurs.
async function promptStdin(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

async function resolveGoogleAddress() {
  const configuredAddress = process.env.MINA_GOOGLE_ACCOUNT?.trim();
  if (configuredAddress) return configuredAddress;
  const typedAddress = await promptStdin("Adresse Gmail à connecter : ");
  return typedAddress.trim();
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
      const project = fileConfig.projectId ? ` Projet Google Cloud détecté : ${fileConfig.projectId}.` : '';
      console.log(`Client ID/Secret Google trouvés automatiquement dans env/ (fichier téléchargé depuis Google Cloud Console) — utilisation directe.${project}\n`);
      return fileConfig.clientId;
    }
    if (calls === 2) return fileConfig.clientSecret;
    return promptStdin(question);
  };
}

function oauthTimeoutMs() {
  const parsed = Number.parseInt(process.env.MINA_GOOGLE_OAUTH_TIMEOUT_MS ?? '600000', 10);
  return Number.isInteger(parsed) && parsed >= 120_000 ? parsed : 600_000;
}

function printDeniedHelp(reason) {
  const value = String(reason ?? '');
  if (!value.includes('access_denied') && !value.includes('oauth_loopback_timeout')) return;
  console.error('Si Chrome affiche « Accès bloqué : Mina Vision n’a pas terminé la procédure de validation de Google »,');
  console.error('ajoute l’adresse Gmail utilisée comme utilisateur de test OAuth dans Google Cloud Console :');
  console.error('APIs & Services → OAuth consent screen → Audience/Test users → Add users, puis relance cette commande.\n');
}

function printProjectMismatchHelp({ oauthProjectId, firebaseProjectId }) {
  console.error(`Client OAuth Google invalide pour cette installation : projet OAuth "${oauthProjectId}", projet Firebase attendu "${firebaseProjectId}".`);
  console.error('Remplace le fichier client_secret_*.json dans env/ par un client OAuth Desktop créé dans le projet Google Cloud/Firebase attendu,');
  console.error('ou ajoute le compte Gmail comme testeur OAuth dans le projet qui possède réellement ce Client ID si ce projet est volontaire.\n');
}

async function main() {
  await app.whenReady();

  const storage = createKeyringFileStorage({ filename: path.join(app.getPath('userData'), 'mina-keyring.json') });
  const keyring = createKeyring({ storage, safeStorage });
  const mailAccountStore = createMailAccountStore({ keyring });
  const envDir = path.join(ROOT, 'env');
  const fileConfig = loadGoogleClientConfigFromEnvDir(envDir, { readdirSync: fs.readdirSync, readFileSync: fs.readFileSync });
  const projectCheck = checkGoogleClientProjectMatch({
    googleClientConfig: fileConfig,
    expectedProjectId: process.env.FIREBASE_PROJECT_ID,
  });
  if (!projectCheck.ok) {
    printProjectMismatchHelp(projectCheck);
    app.exit(1);
    return;
  }
  const prompt = buildPrompt(envDir);
  const address = await resolveGoogleAddress();

  if (!address) {
    console.error("Adresse Google requise. Définis MINA_GOOGLE_ACCOUNT ou saisis une adresse Gmail.");
    app.exit(1);
    return;
  }

  console.log('\nCréer un client OAuth desktop dans Google Cloud Console si pas déjà fait (une seule fois) :');
  console.log('console.cloud.google.com → APIs & Services → Identifiants → Créer des identifiants → ID client OAuth');
  console.log('→ type « Application de bureau ». Détail complet : docs/operations/GOOGLE-ACCOUNT.md\n');

  const connector = createGoogleAccountConnector({
    storage, keyring, mailAccountStore, prompt,
    createLoopbackServer: ({ expectedState }) => createOAuthLoopbackServer({ expectedState, timeoutMs: oauthTimeoutMs() }),
    openExternal: (url) => shell.openExternal(url),
    onConsentUrl: (url) => {
      console.log('URL de secours OAuth Google (si Chrome ne s’ouvre pas ou reste sur la mauvaise page) :');
      console.log(url);
      try {
        clipboard.writeText(url);
        console.log('URL OAuth copiée dans le presse-papiers.\n');
      } catch {
        console.log('');
      }
    },
    scopes: SCOPES,
    accountId: 'google-primary',
    // Le compte vient de l'environnement — jamais d'adresse en dur dans le dépôt public.
    address,
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
      printDeniedHelp(result.reason);
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
