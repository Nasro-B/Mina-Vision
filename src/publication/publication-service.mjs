import { createPublicationReceipt } from './publication-receipt.mjs';
import { normalizePresentationSpec } from './presentation-schema.mjs';
import { normalizePublicationRequest } from './publication-schema.mjs';

// Point d'entrée UNIQUE de la publication : valide la requête, choisit le générateur, écrit de façon
// ATOMIQUE (fichier temporaire → rename, jamais d'écrasement), vérifie les magic bytes du résultat,
// calcule le SHA-256 et rend un reçu. Journalise format/tailles/hash/template/provenances — JAMAIS
// le contenu. Toutes les dépendances (fs, hash, id, horloge) injectées : testable sans disque.

const TEXT_FORMATS = new Set(['md', 'html', 'csv', 'json']);

function slugify(title) {
  return String(title ?? 'document')
    .normalize('NFD').replace(/[̀-ͯ]/gu, '')
    .replace(/[^a-zA-Z0-9]+/gu, '-').replace(/^-+|-+$/gu, '')
    .slice(0, 60).toLowerCase() || 'document';
}
const two = (value) => String(value).padStart(2, '0');
function stamp(date) {
  const d = date instanceof Date ? date : new Date(0);
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
}

// Preuve que le générateur a produit le bon type de fichier — jamais un faux succès / fichier vide.
function verifyMagic(format, buffer) {
  if (format === 'pdf') {
    if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('publication_output_corrupt:pdf');
  } else if (format === 'docx' || format === 'pptx' || format === 'xlsx') {
    if (buffer.subarray(0, 2).toString('latin1') !== 'PK') throw new Error(`publication_output_corrupt:${format}`);
  } else if (TEXT_FORMATS.has(format)) {
    if (buffer.length === 0) throw new Error(`publication_output_corrupt:${format}`);
  }
}

export function createPublicationService({
  generators, filesystem, hash, baseDir, randomId, clock = () => new Date(0), onEvent = () => {},
} = {}) {
  if (!generators || !filesystem || typeof filesystem.writeFile !== 'function' || typeof filesystem.rename !== 'function'
    || typeof filesystem.mkdir !== 'function' || typeof filesystem.access !== 'function'
    || typeof hash !== 'function' || typeof randomId !== 'function' || typeof baseDir !== 'string' || !baseDir) {
    throw new TypeError('publication_service_dependencies_required');
  }
  const base = baseDir.replace(/[\\/]+$/u, '');

  async function uniquePath(slug, format) {
    const at = stamp(clock());
    let candidate = `${base}/${slug}-${at}.${format}`;
    let suffix = 2;
    for (;;) {
      try { await filesystem.access(candidate); candidate = `${base}/${slug}-${at}-${suffix}.${format}`; suffix += 1; }
      catch { return candidate; }
    }
  }

  async function atomicWrite(finalPath, buffer) {
    const tmp = `${finalPath}.tmp-${randomId()}`;
    await filesystem.writeFile(tmp, buffer);
    if (typeof filesystem.fsync === 'function') { try { await filesystem.fsync(tmp); } catch { /* best effort */ } }
    await filesystem.rename(tmp, finalPath);
  }

  return Object.freeze({
    async publish(rawRequest = {}) {
      const format = String(rawRequest.format ?? '');
      const createdAt = (clock() instanceof Date ? clock() : new Date(0)).toLocaleString('fr-FR');
      let buffer;
      let templateId = null;
      let assets = [];

      if (format === 'pptx') {
        buffer = await generators.pptx.generate(normalizePresentationSpec(rawRequest));
        templateId = rawRequest.templateId ? String(rawRequest.templateId) : null;
      } else if (format === 'xlsx') {
        buffer = await generators.xlsx({ title: rawRequest.title, sheets: rawRequest.sheets });
      } else {
        const normalized = normalizePublicationRequest(rawRequest);
        assets = normalized.assets;
        templateId = normalized.templateId;
        if (format === 'pdf') buffer = await generators.pdf({ title: normalized.title, blocks: normalized.blocks, assets, theme: normalized.theme, author: normalized.author, createdAt });
        else if (format === 'docx') buffer = await generators.docx({ title: normalized.title, blocks: normalized.blocks, assets, author: normalized.author, createdAt });
        else if (TEXT_FORMATS.has(format)) buffer = generators.text(format, normalized);
        else throw new Error(`publication_format_invalid:${format}`);
      }

      if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
      verifyMagic(format, buffer);

      await filesystem.mkdir(base, { recursive: true });
      const filePath = await uniquePath(slugify(rawRequest.title), format);
      await atomicWrite(filePath, buffer);
      const sha256 = hash(buffer);
      const receipt = createPublicationReceipt({
        filePath, format, bytes: buffer.length, sha256, templateId,
        assets: assets.map((asset) => ({ assetId: asset.assetId ?? null, provenance: asset.provenance ?? null })),
      });
      onEvent({ type: 'publication_written', format, bytes: buffer.length, sha256, templateId, assets: receipt.assets.length });
      return receipt;
    },
  });
}
