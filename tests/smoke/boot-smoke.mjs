// Smoke boot (plan de durcissement T2.2). Le seul test qui prouve « vert = démarre ». Lance la VRAIE
// application Electron et vérifie qu'elle s'ouvre puis se ferme proprement — ce qu'aucun test
// unitaire ne peut faire (main.mjs n'est pas importable hors Electron ; c'est précisément le trou
// par lequel le boot mort du 27/07 est passé).
//
// Isolation SANS hook de sécurité : on passe le flag Electron STANDARD `--user-data-dir=<temp>`.
// Il déplace `app.getPath('userData')` ET le verrou d'instance unique (`requestSingleInstanceLock`
// est scopé au userData) vers un dossier jetable — donc aucune collision avec la Mina réelle de
// l'utilisateur, et aucun besoin des variables d'audit `MINA_AUDIT_USER_DATA` /
// `MINA_AUDIT_ALLOW_MULTI_INSTANCE` (dont le plan signalait le risque : elles détournent le coffre
// par l'environnement). `--mina-smoke` fait quitter l'app 1,2 s après l'ouverture de la fenêtre.
//
// Contrat : boot sain → sortie 0 sous la limite de temps. Boot mort (fenêtre jamais ouverte) → pas
// d'auto-quit → dépassement → échec. `MINA_SMOKE_SELFTEST=fault` injecte un throw avant la fenêtre
// pour PROUVER que ce test vire au rouge quand le boot meurt (auto-vérification du garde-fou).

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const electronBinary = createRequire(import.meta.url)('electron');
const lockHolder = join(ROOT, 'tests', 'smoke', 'profile-lock-holder.mjs');
const BOOT_LIMIT_MS = 45_000; // large : premier démarrage à froid (modules natifs, migrations).
const LOCK_HOLDER_LIMIT_MS = 15_000;
const selfTestFault = process.env.MINA_SMOKE_SELFTEST === 'fault';

function launch(userDataDir, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  // Auto-test : casser volontairement le boot pour prouver que le smoke devient ROUGE.
  if (selfTestFault) env.MINA_BOOT_FAULT = 'boot:start';
  else delete env.MINA_BOOT_FAULT;

  const child = spawn(electronBinary, ['.', '--mina-smoke', `--user-data-dir=${userDataDir}`], {
    cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  let stdout = '';
  child.stdout.on('data', (chunk) => { stdout += String(chunk); });
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });

  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => {
      // Aucune sortie dans le budget = boot mort (la fenêtre ne s'est pas ouverte, donc pas
      // d'auto-quit). On tue et on signale l'échec.
      child.kill('SIGKILL');
      resolvePromise({ timedOut: true, code: null, stdout, stderr });
    }, BOOT_LIMIT_MS);
    child.on('exit', (code) => { clearTimeout(timer); resolvePromise({ timedOut: false, code, stdout, stderr }); });
  });
}

function holdNamedProfileLock(namedUserData) {
  const child = spawn(electronBinary, [lockHolder, `${'--mina-lock-holder-user-data='}${namedUserData}`], {
    cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  let stdout = '';

  return new Promise((resolvePromise) => {
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(result);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      settle({ child, ready: false, stdout, stderr, timedOut: true });
    }, LOCK_HOLDER_LIMIT_MS);
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
      if (stdout.includes('MINA_SMOKE_LOCK_HELD')) settle({ child, ready: true, stdout, stderr, timedOut: false });
    });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('exit', (code) => settle({ child, ready: false, code, stdout, stderr, timedOut: false }));
  });
}

async function stopLockHolder(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolvePromise) => {
    child.once('exit', resolvePromise);
    child.kill('SIGKILL');
  });
}

const appDataDir = await mkdtemp(join(tmpdir(), 'mina-smoke-app-data-'));
const userDataDir = await mkdtemp(join(tmpdir(), 'mina-smoke-'));
let lockHolderProcess = null;
try {
  const lock = await holdNamedProfileLock(join(appDataDir, 'Mina Vision'));
  if (!lock.ready) {
    console.error(`SMOKE ÉCHOUÉ : le titulaire du verrou de profil n'est pas prêt (${lock.timedOut ? 'timeout' : `sortie ${lock.code}`}).\n${lock.stderr.slice(-800)}`);
    process.exitCode = 1;
  } else {
    lockHolderProcess = lock.child;
  }

  const result = lockHolderProcess
    ? await launch(userDataDir, { APPDATA: appDataDir })
    : { timedOut: false, code: null, stdout: '', stderr: '' };
  const fatal = /FATAL|ERR_MODULE_NOT_FOUND|Cannot find module|SyntaxError/u.test(result.stderr);
  // La VRAIE preuve du boot : la fenêtre PRINCIPALE (index.html) a chargé et imprimé son marqueur.
  // Une sortie 0 seule ne suffit pas — un boot dégradé en écran de crash sort aussi 0.
  const windowReady = result.stdout.includes('MINA_SMOKE_WINDOW_OK');

  if (selfTestFault) {
    // On ATTEND un échec : boot cassé (faute avant la fenêtre principale) → PAS de marqueur.
    if (windowReady) {
      console.error('SMOKE SELFTEST ÉCHOUÉ : la fenêtre principale s\'est ouverte malgré la faute — le garde-fou ne verrait pas un boot mort.');
      process.exitCode = 1;
    } else {
      console.log(`SMOKE SELFTEST OK : boot cassé bien détecté (fenêtre principale absente : ${result.timedOut ? 'timeout' : `sortie ${result.code}`}).`);
    }
  } else if (!windowReady) {
    console.error(`SMOKE ÉCHOUÉ : la fenêtre principale ne s'est pas ouverte (${result.timedOut ? 'timeout' : `sortie ${result.code}`}, pas de marqueur).\n${result.stderr.slice(-800)}`);
    process.exitCode = 1;
  } else if (result.timedOut) {
    console.error('SMOKE ÉCHOUÉ : fenêtre ouverte mais l\'app ne s\'est pas fermée (blocage au shutdown ?).');
    process.exitCode = 1;
  } else if (result.code !== 0) {
    console.error(`SMOKE ÉCHOUÉ : sortie ${result.code}.\n${result.stderr.slice(-800)}`);
    process.exitCode = 1;
  } else if (fatal) {
    console.error(`SMOKE ÉCHOUÉ : erreur fatale au démarrage.\n${result.stderr.slice(-800)}`);
    process.exitCode = 1;
  } else {
    console.log('SMOKE OK : Mina ouvre sa fenêtre principale (marqueur reçu) et se ferme proprement (sortie 0).');
  }
} finally {
  await stopLockHolder(lockHolderProcess);
  await rm(userDataDir, { recursive: true, force: true });
  await rm(appDataDir, { recursive: true, force: true });
}
