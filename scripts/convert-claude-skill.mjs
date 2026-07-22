// Convertisseur de skill « format Claude » (.skill/.zip avec SKILL.md name+description) vers le
// format Mina Vision (front-matter complet : version, triggers, capabilities, channels,
// compatibility, entrypoints, budgets, digest sha256 réel calculé par le loader officiel).
// Le CORPS du skill n'est jamais modifié — seule l'en-tête est complétée.
//
// Usage : node scripts/convert-claude-skill.mjs <archive.skill|.zip> [dossier-sortie]
// Sortie : <dossier-sortie>/<nom>.mina.skill (zip installable par Mina) + dossier extrait.

import AdmZip from 'adm-zip';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { computeSkillManifest } from '../src/skills/skill-loader.mjs';

const [, , archivePath, outputRoot = 'C:/Serveurs'] = process.argv;
if (!archivePath) {
  console.error('Usage : node scripts/convert-claude-skill.mjs <archive.skill> [dossier-sortie]');
  process.exit(1);
}

function parseFrontMatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u);
  if (!match) throw new Error('SKILL.md sans front-matter');
  const fields = {};
  for (const line of match[1].split(/\r?\n/u)) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/u);
    if (kv) fields[kv[1]] = kv[2].replace(/^"|"$/gu, '');
  }
  return { fields, body: match[2] };
}

const zip = new AdmZip(await readFile(archivePath));
const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
const skillEntry = entries.find((entry) => entry.entryName.endsWith('SKILL.md'));
if (!skillEntry) throw new Error('SKILL.md introuvable dans l\'archive');
const rootPrefix = skillEntry.entryName.slice(0, -'SKILL.md'.length);

const original = zip.readAsText(skillEntry);
const { fields, body } = parseFrontMatter(original);
if (!fields.name) throw new Error('champ name manquant');
const slug = fields.name.toLowerCase().replace(/[^a-z0-9-]+/gu, '-');

// Extraction à plat du contenu du skill.
const workDir = join(outputRoot, `${slug}-mina-skill`);
await mkdir(workDir, { recursive: true });
const references = [];
for (const entry of entries) {
  if (!entry.entryName.startsWith(rootPrefix)) continue;
  const relative = entry.entryName.slice(rootPrefix.length);
  if (!relative || relative === 'SKILL.md') continue;
  const target = join(workDir, ...relative.split('/'));
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, entry.getData());
  if (relative.endsWith('.md')) references.push(relative);
}

// Front-matter complet au format Mina — corps INTACT. Triggers dérivés du nom (le champ
// description Claude est trop long pour des triggers ; le nom suffit à l'activation vocale).
const description = (fields.description ?? `Skill ${fields.name}`).slice(0, 300);
const minaHeader = [
  '---',
  `name: ${slug}`,
  `description: ${JSON.stringify(description)}`,
  `version: ${fields.version ?? '1.0.0'}`,
  'triggers:',
  `  - ${slug}`,
  `  - mode ${slug}`,
  `  - active ${slug}`,
  'capabilities:',
  '  - conversation.reply_draft',
  'channels:',
  '  - local',
  'compatibility:',
  '  mina: ">=3"',
  '  platforms:',
  '    - win32',
  'entrypoints:',
  '  instructions: SKILL.md',
  references.length > 0 ? `  references:\n${references.map((ref) => `    - ${ref}`).join('\n')}` : '  references: []',
  '  scripts: []',
  'budgets:',
  '  maxDurationMs: 60000',
  '  maxCostMicros: 20000',
  '  maxTokens: 16384',
  'digest: sha256:manifest-placeholder',
  '---',
  '',
].join('\n');
await writeFile(join(workDir, 'SKILL.md'), minaHeader + body, 'utf8');

// Digest RÉEL via l'algorithme officiel du loader (placeholder remplacé au hachage).
const manifest = await computeSkillManifest({ directory: workDir });
const withDigest = (minaHeader + body).replace('digest: sha256:manifest-placeholder', `digest: ${manifest.digest}`);
await writeFile(join(workDir, 'SKILL.md'), withDigest, 'utf8');

// Zip final installable.
const output = new AdmZip();
async function addDirectory(directory, prefix) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) await addDirectory(absolute, `${prefix}${entry.name}/`);
    else output.addFile(`${prefix}${entry.name}`, await readFile(absolute));
  }
}
await addDirectory(workDir, `${slug}/`);
const outputPath = join(outputRoot, `${slug}.mina.skill`);
output.writeZip(outputPath);
console.log(`converti : ${basename(archivePath)} -> ${outputPath}`);
console.log(`digest   : ${manifest.digest}`);
console.log(`fichiers : SKILL.md + ${references.length} référence(s) : ${references.join(', ')}`);
