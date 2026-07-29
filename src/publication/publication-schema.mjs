// Contrat déterministe de TOUTE publication Mina Vision. AUCUNE fonction ici n'appelle un LLM : le
// contenu vient de l'utilisateur, d'un modèle de données ou d'un template versionné. La validation
// est STRUCTURELLE — un format hors liste, un tableau hors limites, un schéma dangereux
// (javascript:, data:, file:, vbscript:) ou un chemin absolu / lien distant en destination est
// REFUSÉ avec un code stable, jamais nettoyé en silence. Chaque générateur (pdf/docx/pptx/xlsx/texte)
// ne consomme QUE ce résultat normalisé et gelé, jamais un chemin utilisateur arbitraire.

export const OUTPUT_FORMATS = Object.freeze(['pdf', 'docx', 'pptx', 'xlsx', 'md', 'html', 'csv', 'json']);
const OUTPUT_FORMAT_SET = new Set(OUTPUT_FORMATS);

export const BLOCK_KINDS = Object.freeze(['title', 'heading', 'paragraph', 'bullets', 'table', 'image', 'chart', 'quote', 'pageBreak']);
const BLOCK_KIND_SET = new Set(BLOCK_KINDS);

export const SUPPORTED_LOCALES = Object.freeze(['fr-FR', 'en-US']);

export const LIMITS = Object.freeze({
  title: 120, blocks: 100, textTotal: 200_000, assets: 30,
  tableRows: 100, tableCols: 20, bullets: 200, bulletLength: 2_000,
});

const REQUEST_KEYS = new Set(['title', 'format', 'templateId', 'locale', 'blocks', 'assets', 'destination', 'author', 'theme']);
const DANGEROUS_SCHEME = /^\s*(?:javascript|data|vbscript|file):/iu;
// Distant (http(s)://, //host) OU absolu (C:\, \\share, /etc) : une destination doit rester relative.
const REMOTE_OR_ABSOLUTE = /^(?:[a-z][a-z0-9+.-]*:\/\/|\/\/|[a-zA-Z]:[\\/]|\\\\|\/)/u;

function rejectUnexpectedKeys(input, allowed, scope) {
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`publication_unexpected_key:${scope}:${key}`);
  }
}

// Un texte destiné au document : refuse un schéma exécutable AVANT toute utilisation. Ne « nettoie »
// pas — refuse, pour qu'une injection ne passe jamais en silence dans un PDF/HTML généré.
function safeText(value, field) {
  const text = String(value ?? '');
  if (DANGEROUS_SCHEME.test(text)) throw new Error(`publication_${field}_scheme_forbidden`);
  return text;
}

function blockTextLength(block) {
  if (typeof block.text === 'string') return block.text.length;
  if (Array.isArray(block.items)) return block.items.join('').length;
  if (Array.isArray(block.rows)) return block.rows.reduce((sum, row) => sum + row.join('').length, 0);
  return 0;
}

export function normalizePublicationBlock(input = {}) {
  if (!input || typeof input !== 'object') throw new Error('publication_block_invalid');
  const kind = String(input.kind ?? '');
  if (!BLOCK_KIND_SET.has(kind)) throw new Error(`publication_block_kind_invalid:${kind}`);
  switch (kind) {
    case 'pageBreak':
      return Object.freeze({ kind });
    case 'title':
    case 'paragraph':
    case 'quote':
      return Object.freeze({ kind, text: safeText(input.text, 'text') });
    case 'heading':
      return Object.freeze({ kind, text: safeText(input.text, 'text'), level: Math.min(Math.max(Number(input.level) || 1, 1), 6) });
    case 'bullets': {
      const items = Array.isArray(input.items) ? input.items : [];
      if (items.length > LIMITS.bullets) throw new Error('publication_bullets_too_many');
      return Object.freeze({ kind, items: Object.freeze(items.map((item) => safeText(item, 'text').slice(0, LIMITS.bulletLength))) });
    }
    case 'table': {
      const rows = Array.isArray(input.rows) ? input.rows : [];
      if (rows.length > LIMITS.tableRows) throw new Error('publication_table_too_large');
      const cols = rows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);
      if (cols > LIMITS.tableCols) throw new Error('publication_table_too_large');
      return Object.freeze({
        kind,
        rows: Object.freeze(rows.map((row) => Object.freeze((Array.isArray(row) ? row : []).map((cell) => safeText(cell, 'text'))))),
      });
    }
    case 'image': {
      const assetId = String(input.assetId ?? '');
      if (!assetId) throw new Error('publication_image_asset_required');
      return Object.freeze({ kind, assetId, caption: input.caption ? safeText(input.caption, 'text') : '' });
    }
    case 'chart':
      return Object.freeze({
        kind,
        title: input.title ? safeText(input.title, 'text') : '',
        chart: Object.freeze({ ...(input.chart ?? {}) }),
      });
    default:
      throw new Error(`publication_block_kind_invalid:${kind}`);
  }
}

export function normalizePublicationRequest(input = {}) {
  if (!input || typeof input !== 'object') throw new Error('publication_request_invalid');
  rejectUnexpectedKeys(input, REQUEST_KEYS, 'request');

  const format = String(input.format ?? '');
  if (!OUTPUT_FORMAT_SET.has(format)) throw new Error(`publication_format_invalid:${format}`);

  const title = safeText(input.title, 'title').trim();
  if (title.length > LIMITS.title) throw new Error('publication_title_too_long');

  const locale = input.locale === undefined ? 'fr-FR' : String(input.locale);
  if (!SUPPORTED_LOCALES.includes(locale)) throw new Error(`publication_locale_invalid:${locale}`);

  const rawBlocks = Array.isArray(input.blocks) ? input.blocks : [];
  if (rawBlocks.length > LIMITS.blocks) throw new Error('publication_blocks_too_many');
  const blocks = rawBlocks.map((block) => normalizePublicationBlock(block));
  const textTotal = blocks.reduce((sum, block) => sum + blockTextLength(block), 0);
  if (textTotal > LIMITS.textTotal) throw new Error('publication_text_too_long');

  const rawAssets = Array.isArray(input.assets) ? input.assets : [];
  if (rawAssets.length > LIMITS.assets) throw new Error('publication_assets_too_many');
  const assets = rawAssets.map((asset) => Object.freeze({ ...asset }));

  let destination = null;
  if (input.destination !== undefined && input.destination !== null && input.destination !== '') {
    destination = String(input.destination);
    if (REMOTE_OR_ABSOLUTE.test(destination) || DANGEROUS_SCHEME.test(destination)) {
      throw new Error('publication_destination_absolute_forbidden');
    }
  }

  return Object.freeze({
    title,
    format,
    templateId: input.templateId === undefined || input.templateId === null ? null : String(input.templateId),
    locale,
    blocks: Object.freeze(blocks),
    assets: Object.freeze(assets),
    destination,
    author: input.author ? safeText(input.author, 'text').slice(0, LIMITS.title) : 'Mina Vision',
    theme: input.theme ? String(input.theme) : null,
  });
}
