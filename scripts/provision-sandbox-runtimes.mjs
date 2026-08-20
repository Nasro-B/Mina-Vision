#!/usr/bin/env node
// Provisionne les 3 runtimes du bac à sable Windows (python / javascript / powershell) attendus
// par src/sandbox/runtime-manifest.mjs, débloquant « sandbox_runtimes_unavailable ».
//
// ⚠️ TÉLÉCHARGE des binaires (~120 Mo) depuis des sources OFFICIELLES. Action gated par
//    l'autorisation de Nasro : lance-le toi-même.
//
//   node scripts/provision-sandbox-runtimes.mjs --dry-run     # montre le plan, ne télécharge rien
//   node scripts/provision-sandbox-runtimes.mjs --python-sha256=<hex depuis python.org>
//
// Chaîne de confiance (JAMAIS de hash inventé — RÈGLE N°1) :
//   • Node       → vérifié contre https://nodejs.org/dist/vX/SHASUMS256.txt (officiel).
//   • PowerShell → vérifié contre le hashes.sha256 de la release GitHub officielle.
//   • Python     → python.org ne publie pas de fichier SHASUMS téléchargeable pour l'embeddable ;
//                  passe le sha256 lu SUR la page officielle via --python-sha256=… . Sans lui, le
//                  script télécharge, AFFICHE le hash calculé + l'URL à vérifier, puis s'arrête.
//
// Le manifeste produit est RE-VÉRIFIÉ par le vrai createRuntimeManifest avant de déclarer succès.

import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, rm, writeFile, readFile, cp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { resolveStorageRoots } from '../src/system/storage-roots.mjs';
import { createRuntimeManifest } from '../src/sandbox/runtime-manifest.mjs';
import {
  buildRuntimeManifest,
  decodeChecksumBytes,
  expectedChecksumFor,
  parseChecksumsFile,
  selectLatestNodeLts,
} from '../src/sandbox/runtime-provisioning.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const GUEST_RUNNER_FILE = 'mina-runner.mjs';
const BOOTSTRAP_NODE_PATH = 'javascript/node.exe';

// ── Versions pinnées (patch résolu dynamiquement quand une source d'index existe) ────────────
const NODE_MAJOR = 22;                 // ligne LTS (règle Nasro : Node 22)
const PYTHON_VERSION = '3.12.7';       // embeddable amd64 ; hash validé par Nasro via --python-sha256
const PWSH_MAJOR_MINOR = '7.4';        // dernière 7.4.x résolue via l'API GitHub

const log = (...a) => console.log('[provision]', ...a);
const die = (msg) => { console.error('[provision] ERREUR:', msg); process.exit(1); };

function arg(name) {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return null;
  const eq = hit.indexOf('=');
  return eq === -1 ? true : hit.slice(eq + 1);
}

async function fetchBuffer(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
  return Buffer.from(await res.arrayBuffer());
}
async function fetchText(url) { return (await fetchBuffer(url)).toString('utf8'); }
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function installGuestBootstrap(runtimeRoot, manifest) {
  await copyFile(join(ROOT, 'src', 'sandbox', 'guest-runner.mjs'), join(runtimeRoot, GUEST_RUNNER_FILE));
  const javascript = manifest?.runtimes?.find?.((runtime) => runtime.language === 'javascript');
  if (!javascript?.path) throw new Error('runtime_javascript_missing');
  await mkdir(join(runtimeRoot, 'javascript'), { recursive: true });
  await copyFile(join(runtimeRoot, ...javascript.path.split('/')), join(runtimeRoot, ...BOOTSTRAP_NODE_PATH.split('/')));
}

// Extrait un zip et retourne le dossier de destination. Localise l'exécutable attendu (récursif,
// insensible à la casse) et renvoie son chemin relatif POSIX sous destRoot.
async function unzipAndLocate(zipBuffer, destDir, exeName) {
  await mkdir(destDir, { recursive: true });
  new AdmZip(zipBuffer).extractAllTo(destDir, true);
  const zip = new AdmZip(zipBuffer);
  const entry = zip.getEntries().find((e) => !e.isDirectory && e.entryName.split('/').pop().toLowerCase() === exeName.toLowerCase());
  if (!entry) throw new Error(`${exeName} introuvable dans l'archive`);
  return entry.entryName; // chemin relatif POSIX dans le zip == arborescence extraite
}

async function provisionNode(stageDir) {
  log('Node : résolution de la dernière LTS', `${NODE_MAJOR}.x…`);
  const index = JSON.parse(await fetchText('https://nodejs.org/dist/index.json'));
  const picked = selectLatestNodeLts(index, NODE_MAJOR);
  if (!picked) die(`aucune LTS Node ${NODE_MAJOR}.x dans l'index officiel`);
  const dir = `node-v${picked.semver}-win-x64`;
  const zipName = `${dir}.zip`;
  const base = `https://nodejs.org/dist/v${picked.semver}`;
  const sourceUrl = `${base}/${zipName}`;
  log('Node : téléchargement', sourceUrl);
  const [zipBuf, shaBytes] = await Promise.all([fetchBuffer(sourceUrl), fetchBuffer(`${base}/SHASUMS256.txt`)]);
  const expected = expectedChecksumFor(parseChecksumsFile(decodeChecksumBytes(shaBytes)), zipName);
  if (!expected) die(`Node : ${zipName} absent de SHASUMS256.txt`);
  if (sha256(zipBuf) !== expected) die('Node : sha256 du zip ≠ checksum officiel — téléchargement rejeté');
  log('Node : zip vérifié contre SHASUMS256.txt ✔');
  const relInZip = await unzipAndLocate(zipBuf, join(stageDir, 'javascript'), 'node.exe');
  const exeBuf = await readFile(join(stageDir, 'javascript', ...relInZip.split('/')));
  return { language: 'javascript', version: picked.semver, sha256: sha256(exeBuf), sourceUrl, path: `javascript/${relInZip}`, stageSub: 'javascript' };
}

async function provisionPowerShell(stageDir) {
  log('PowerShell : résolution de la dernière', `${PWSH_MAJOR_MINOR}.x…`);
  const releases = JSON.parse(await fetchText('https://api.github.com/repos/PowerShell/PowerShell/releases?per_page=40'));
  const rel = releases.find((r) => !r.prerelease && String(r.tag_name).startsWith(`v${PWSH_MAJOR_MINOR}.`));
  if (!rel) die(`aucune release PowerShell ${PWSH_MAJOR_MINOR}.x stable trouvée`);
  const version = String(rel.tag_name).replace(/^v/u, '');
  const zipName = `PowerShell-${version}-win-x64.zip`;
  const asset = rel.assets.find((a) => a.name === zipName);
  const hashAsset = rel.assets.find((a) => a.name === 'hashes.sha256');
  if (!asset) die(`PowerShell : ${zipName} absent des assets de la release`);
  const sourceUrl = asset.browser_download_url;
  log('PowerShell : téléchargement', sourceUrl);
  const zipBuf = await fetchBuffer(sourceUrl);
  if (hashAsset) {
    // hashes.sha256 de PowerShell est en UTF-16 : décodage explicite, sinon aucune entrée ne matche.
    const expected = expectedChecksumFor(parseChecksumsFile(decodeChecksumBytes(await fetchBuffer(hashAsset.browser_download_url))), zipName);
    if (!expected) die(`PowerShell : aucune entrée pour ${zipName} dans hashes.sha256 — vérification impossible, rejeté`);
    if (sha256(zipBuf) !== expected) die('PowerShell : sha256 du zip ≠ hashes.sha256 officiel — rejeté');
    log('PowerShell : zip vérifié contre hashes.sha256 ✔');
  } else {
    die('PowerShell : pas de hashes.sha256 dans la release — vérification impossible, rejeté');
  }
  const relInZip = await unzipAndLocate(zipBuf, join(stageDir, 'powershell'), 'pwsh.exe');
  const exeBuf = await readFile(join(stageDir, 'powershell', ...relInZip.split('/')));
  return { language: 'powershell', version, sha256: sha256(exeBuf), sourceUrl, path: `powershell/${relInZip}`, stageSub: 'powershell' };
}

async function provisionPython(stageDir) {
  const zipName = `python-${PYTHON_VERSION}-embed-amd64.zip`;
  const sourceUrl = `https://www.python.org/ftp/python/${PYTHON_VERSION}/${zipName}`;
  log('Python : téléchargement', sourceUrl);
  const zipBuf = await fetchBuffer(sourceUrl);
  const actual = sha256(zipBuf);
  const provided = arg('python-sha256');
  if (typeof provided !== 'string' || provided.toLowerCase() !== actual) {
    console.error('\n[provision] Python : hash du zip NON confirmé.');
    console.error('  Fichier   :', zipName);
    console.error('  sha256    :', actual);
    console.error('  À vérifier:', `https://www.python.org/downloads/release/python-${PYTHON_VERSION.replace(/\./gu, '')}/`);
    console.error('  Puis relance avec : --python-sha256=' + actual + '\n');
    die('Python : fournis --python-sha256 après vérification sur python.org (RÈGLE N°1, aucun hash supposé)');
  }
  log('Python : hash confirmé par Nasro ✔');
  const relInZip = await unzipAndLocate(zipBuf, join(stageDir, 'python'), 'python.exe');
  const exeBuf = await readFile(join(stageDir, 'python', ...relInZip.split('/')));
  return { language: 'python', version: PYTHON_VERSION, sha256: sha256(exeBuf), sourceUrl, path: `python/${relInZip}`, stageSub: 'python' };
}

async function main() {
  const dryRun = Boolean(arg('dry-run'));
  const userData = process.env.MINA_USERDATA_PATH ?? join(process.env.APPDATA ?? join(process.env.USERPROFILE ?? ROOT, 'AppData', 'Roaming'), 'Mina Vision');
  const { sandboxRuntimeRoot } = resolveStorageRoots({ userDataPath: userData });

  log('Cible du runtime sandbox :', sandboxRuntimeRoot);
  log('Plan : Python', PYTHON_VERSION, '· Node LTS', `${NODE_MAJOR}.x`, '· PowerShell', `${PWSH_MAJOR_MINOR}.x`);
  if (dryRun) { log('--dry-run : rien téléchargé. Retire le flag pour provisionner.'); return; }
  if (arg('runner-only')) {
    await mkdir(sandboxRuntimeRoot, { recursive: true });
    const manifest = JSON.parse(await readFile(join(sandboxRuntimeRoot, 'runtime-manifest.json'), 'utf8'));
    await installGuestBootstrap(sandboxRuntimeRoot, manifest);
    const verifier = createRuntimeManifest({ manifestPath: join(sandboxRuntimeRoot, 'runtime-manifest.json'), runtimeRoot: sandboxRuntimeRoot });
    const result = await verifier.verify();
    if (!result.available) die(`runner copié mais runtime rejeté par le vérificateur : ${result.reason}`);
    log('✔ Runner invité sandbox installé et runtime vérifié.');
    return;
  }

  const stageDir = await mkdtemp(join(tmpdir(), 'mina-sandbox-rt-'));
  try {
    // Python d'abord : il peut s'arrêter proprement en réclamant --python-sha256, avant de tirer
    // les ~90 Mo de Node/PowerShell pour rien.
    const python = await provisionPython(stageDir);
    const [node, pwsh] = await Promise.all([provisionNode(stageDir), provisionPowerShell(stageDir)]);
    const entries = [python, node, pwsh];

    // Publication atomique : on assemble sous un dossier .staging puis on bascule.
    const manifest = buildRuntimeManifest(entries.map(({ stageSub, ...e }) => e));
    await mkdir(sandboxRuntimeRoot, { recursive: true });
    for (const entry of entries) {
      const from = join(stageDir, entry.stageSub);
      const to = join(sandboxRuntimeRoot, entry.stageSub);
      await rm(to, { recursive: true, force: true });
      await cp(from, to, { recursive: true });
    }
    await installGuestBootstrap(sandboxRuntimeRoot, manifest);
    await writeFile(join(sandboxRuntimeRoot, 'runtime-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

    // Preuve : le VRAI vérificateur du sandbox doit dire available:true.
    const verifier = createRuntimeManifest({ manifestPath: join(sandboxRuntimeRoot, 'runtime-manifest.json'), runtimeRoot: sandboxRuntimeRoot });
    const result = await verifier.verify();
    if (!result.available) die(`manifeste écrit mais rejeté par le vérificateur : ${result.reason}`);
    for (const entry of entries) {
      const s = await stat(join(sandboxRuntimeRoot, ...entry.path.split('/')));
      log(`  ${entry.language} v${entry.version} → ${entry.path} (${(s.size / 1024).toFixed(0)} Kio)`);
    }
    log('✔ Runtimes sandbox provisionnés et vérifiés. Redémarre Mina : la sonde « runtimes » passera au vert.');
  } finally {
    await rm(stageDir, { recursive: true, force: true });
  }
}

main().catch((error) => die(error?.stack ?? String(error)));
