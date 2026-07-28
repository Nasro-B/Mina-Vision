import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { stringify } from 'yaml';
import { computeSkillManifest, readSkillMetadata } from './skill-loader.mjs';
import { createSkillRegistry } from './skill-registry.mjs';
import { SKILL_NAME_PATTERN, validateSkillRelativePath } from './skill-schema.mjs';

// Générateur de skills SÛR (plan de durcissement T0.3).
//
// Cause réelle : le 2026-07-27, Mina a généré `pianiste-volonte-lumiere/pianiste-volonte-lumiere/
// SKILL.md` — un skill imbriqué deux fois. `refresh()` rejetait AVANT `createWindow()` et
// l'application démarrait sans aucune fenêtre, sans message. Le registre tolère désormais un
// dossier mal formé (commit 1377861), mais tolérer n'est pas empêcher : rien n'interdisait
// d'ÉCRIRE la structure fautive. Ce module est la barrière manquante côté écriture.
//
// Trois garanties, dans cet ordre :
//   1. structure exacte      — `<root>/<slug>/SKILL.md`, jamais imbriqué, manifeste sans mensonge ;
//   2. auto-validation       — le skill est bâti dans un dossier de préparation, relu par le vrai
//                              lecteur PUIS re-scanné par le vrai registre ; rien n'entre dans
//                              `root` tant que le registre ne le voit pas ;
//   3. confirmation humaine  — Mina ne s'auto-étend pas : sans « oui » local, aucune écriture.

const PLACEHOLDER_DIGEST = 'sha256:manifest-placeholder';
const DIGEST_LINE = /^digest:\s*sha256:(?:[a-f0-9]{64}|manifest-placeholder)\s*$/mu;

async function exists(target) {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

// Le YAML est produit à partir d'une copie SANS référence partagée : deux clés pointant le même
// objet feraient émettre une ancre `&`/`*` à `stringify`, que `parseSkillDocument` rejette
// (skill_yaml_alias_forbidden). Le générateur ne doit pas pouvoir produire un skill que le
// lecteur refuse.
function frontmatterOf(metadata) {
  const { digest: _ignored, ...rest } = structuredClone(metadata);
  const yaml = stringify(rest, { aliasDuplicateObjects: false, lineWidth: 0 });
  if (/(?:^|\s)[&*][A-Za-z0-9_-]+/mu.test(yaml)) throw new Error('skill_yaml_alias_forbidden');
  // La ligne `digest:` est écrite à la main, jamais par le sérialiseur : c'est la SEULE ligne que
  // `computeSkillManifest` neutralise pour rendre le condensat stable, et elle doit matcher sa
  // regex au caractère près. La laisser au sérialiseur, c'est parier sur son style de citation.
  return `---\n${yaml}digest: ${PLACEHOLDER_DIGEST}\n---\n`;
}

function planFiles({ slug, metadata, body, references, scripts }) {
  const declared = { references: metadata?.entrypoints?.references, scripts: metadata?.entrypoints?.scripts };
  const files = new Map([['SKILL.md', `${frontmatterOf(metadata)}${body}`]]);

  for (const [kind, provided] of [['reference', references], ['script', scripts]]) {
    for (const file of provided) {
      const path = validateSkillRelativePath(file?.path, kind);
      if (typeof file.content !== 'string') throw new TypeError(`skill_${kind}_content_invalid`);
      // Anti-imbrication, la cause exacte du boot mort : un fichier rangé sous un dossier portant
      // le nom du skill reproduit `<slug>/<slug>/…`, et un second SKILL.md en profondeur rend la
      // racine du skill ambiguë. Les deux sont refusés à la génération, pas au chargement.
      if (path.split('/')[0] === slug) throw new Error('skill_nested_slug_forbidden');
      if (path.split('/').pop() === 'SKILL.md') throw new Error('skill_nested_document_forbidden');
      if (files.has(path)) throw new Error(`skill_file_duplicate:${path}`);
      files.set(path, file.content);
    }
  }

  // Un manifeste qui déclare autre chose que ce qu'il embarque produit un skill installable puis
  // introuvable (`skill_reference_missing` au chargement). Les deux listes doivent coïncider
  // exactement, dans les deux sens.
  for (const [kind, paths] of [['reference', declared.references], ['script', declared.scripts]]) {
    for (const path of paths ?? []) {
      if (!files.has(path)) throw new Error(`skill_declared_${kind}_missing:${path}`);
    }
  }
  const declaredAll = new Set([...(declared.references ?? []), ...(declared.scripts ?? [])]);
  for (const path of files.keys()) {
    if (path !== 'SKILL.md' && !declaredAll.has(path)) throw new Error(`skill_undeclared_file:${path}`);
  }
  return files;
}

async function writeTree(directory, files) {
  for (const [path, content] of files) {
    const target = join(directory, ...path.split('/'));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  }
}

// Le condensat ne peut être calculé qu'une fois les octets sur le disque : il couvre TOUS les
// fichiers du skill, pas seulement le document. On écrit donc avec le marqueur, on mesure, puis on
// scelle — `computeSkillManifest` neutralisant la ligne `digest:`, le condensat reste valide après
// réécriture, ce que l'étape de re-vérification prouve au lieu de le supposer.
async function sealDigest(directory) {
  const { digest, files } = await computeSkillManifest({ directory });
  const document = join(directory, 'SKILL.md');
  const content = await readFile(document, 'utf8');
  if (!DIGEST_LINE.test(content)) throw new Error('skill_digest_field_missing');
  await writeFile(document, content.replace(DIGEST_LINE, `digest: ${digest}`), 'utf8');
  return { digest, files };
}

async function proveLoadable({ workspace, slug, digest }) {
  const directory = join(workspace, slug);
  const parsed = await readSkillMetadata(directory);
  if (parsed.metadata.digest !== digest) throw new Error('skill_manifest_digest_mismatch');
  const resealed = await computeSkillManifest({ directory });
  if (resealed.digest !== digest) throw new Error('skill_manifest_digest_unstable');
  // Preuve de bout en bout : le VRAI registre, celui du démarrage, doit lister ce skill. Le parse
  // seul ne suffit pas — `scan()` ignore silencieusement un dossier illisible et rejette encore un
  // condensat resté au marqueur, donc seul son résultat démontre que le skill sera visible.
  const listed = await createSkillRegistry({ root: workspace }).scan();
  const entry = listed.find((candidate) => candidate.name === parsed.metadata.name);
  if (!entry) throw new Error('skill_registry_rejected');
  if (entry.slug !== slug) throw new Error('skill_registry_slug_mismatch');
  return entry;
}

async function publish({ staged, destination, workspace, slug }) {
  if (!await exists(destination)) {
    await rename(staged, destination);
    return;
  }
  // Remplacement réversible : l'ancienne version est mise de côté avant la bascule et n'est
  // détruite qu'une fois la nouvelle en place. Un échec en cours de route laisse le skill
  // précédent installé plutôt qu'un dossier absent.
  const previous = join(workspace, `${slug}.previous`);
  await rename(destination, previous);
  try {
    await rename(staged, destination);
  } catch (error) {
    await rename(previous, destination);
    throw error;
  }
  await rm(previous, { recursive: true, force: true });
}

export function createSkillGenerator({ root, confirm, workspaceRoot } = {}) {
  if (!root) throw new TypeError('skill_root_required');
  // Fail-closed : sans fonction de confirmation, le générateur ne s'installe pas en mode
  // silencieux — il refuse d'exister. Mina ne peut pas s'étendre par omission de câblage.
  if (typeof confirm !== 'function') throw new TypeError('skill_confirmation_required');

  async function generate({ slug, metadata, body = '', references = [], scripts = [] } = {}) {
    if (typeof slug !== 'string' || !SKILL_NAME_PATTERN.test(slug)) throw new TypeError('skill_slug_invalid');
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new TypeError('skill_metadata_invalid');
    // Le disque indexe par slug, le registre par `name` : les laisser diverger produit un skill
    // que l'on ne retrouve pas depuis son propre dossier. Contrainte du GÉNÉRATEUR uniquement,
    // plus stricte que le schéma — qui autorise la divergence, et `skills-reference/
    // mythos-mina-skill` s'appelle `mythos` depuis toujours. Un skill neuf n'a rien à y gagner ;
    // les skills historiques restent valides et chargeables, ils ne passent simplement pas par ici.
    if (metadata.name !== slug) throw new Error('skill_name_slug_mismatch');
    if (typeof body !== 'string') throw new TypeError('skill_body_invalid');
    if (!Array.isArray(references) || !Array.isArray(scripts)) throw new TypeError('skill_entrypoint_files_invalid');

    const rootReal = resolve(root);
    const files = planFiles({ slug, metadata, body, references, scripts });
    const workspace = await mkdtemp(join(workspaceRoot ?? dirname(rootReal), '.mina-skill-staging-'));

    try {
      const staged = join(workspace, slug);
      await writeTree(staged, files);
      const sealed = await sealDigest(staged);
      const entry = await proveLoadable({ workspace, slug, digest: sealed.digest });

      const destination = join(rootReal, slug);
      const action = await exists(destination) ? 'update' : 'create';
      const decision = await confirm(Object.freeze({
        action,
        slug,
        name: entry.name,
        version: entry.version,
        description: entry.description,
        capabilities: entry.capabilities,
        channels: entry.channels,
        digest: sealed.digest,
        files: sealed.files,
        destination,
      }));
      if (decision !== true) throw new Error('skill_generation_not_confirmed');

      await mkdir(rootReal, { recursive: true });
      await publish({ staged, destination, workspace, slug });
      return Object.freeze({ slug, action, digest: sealed.digest, directory: destination, files: sealed.files });
    } finally {
      // Un refus, une validation ratée ou un plantage ne laissent jamais de skill à moitié écrit :
      // tout se passe hors de `root`, et la préparation disparaît quoi qu'il arrive.
      await rm(workspace, { recursive: true, force: true });
    }
  }

  return Object.freeze({ generate });
}
