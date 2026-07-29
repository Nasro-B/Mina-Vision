// Contrat déterministe d'une présentation (PPTX). Aucun LLM : les slides viennent de l'utilisateur ou
// d'un template. Validation structurelle + bornes strictes (60 slides, 12 puces/slide, 160 car/puce,
// 20 lignes de tableau, 4 images/slide) et refus des schémas exécutables. Résultat gelé, consommé tel
// quel par le générateur PPTX.

export const SLIDE_KINDS = Object.freeze([
  'cover', 'section', 'bullets', 'two-columns', 'image-left', 'image-right',
  'chart-bar', 'chart-line', 'table', 'quote', 'timeline', 'process', 'closing',
]);
const SLIDE_KIND_SET = new Set(SLIDE_KINDS);

export const PRESENTATION_THEMES = Object.freeze({
  'mina-light-v1': { bg: 'FFFFFF', ink: '1F2937', accent: '10B981', muted: '6B7280' },
  'mina-dark-v1': { bg: '0F1720', ink: 'ECF0F4', accent: '4FCFA0', muted: '94A3B8' },
  'corporate-blue-v1': { bg: 'FFFFFF', ink: '17233F', accent: '2563EB', muted: '64748B' },
  'minimal-paper-v1': { bg: 'FCFAF6', ink: '1F1F1F', accent: '111111', muted: '7A7A73' },
});
const DEFAULT_THEME = 'mina-light-v1';

export const PRESENTATION_LIMITS = Object.freeze({ slides: 60, bullets: 12, bulletLength: 160, tableRows: 20, tableCols: 12, images: 4, steps: 8, series: 8 });

const DANGEROUS_SCHEME = /^\s*(?:javascript|data|vbscript|file):/iu;

function safeText(value, max = Infinity) {
  const text = String(value ?? '');
  if (DANGEROUS_SCHEME.test(text)) throw new Error('publication_presentation_text_scheme_forbidden');
  return Number.isFinite(max) ? text.slice(0, max) : text;
}
const clampList = (value, count, max) => (Array.isArray(value) ? value : []).slice(0, count).map((item) => safeText(item, max));

function normalizeSlide(input = {}) {
  const kind = String(input.kind ?? '');
  if (!SLIDE_KIND_SET.has(kind)) throw new Error(`publication_slide_kind_invalid:${kind}`);
  const base = { kind, title: input.title ? safeText(input.title, 200) : '' };
  const L = PRESENTATION_LIMITS;
  switch (kind) {
    case 'cover':
    case 'section':
    case 'closing':
      return Object.freeze({ ...base, subtitle: input.subtitle ? safeText(input.subtitle, 300) : '' });
    case 'bullets':
      return Object.freeze({ ...base, bullets: Object.freeze(clampList(input.bullets, L.bullets, L.bulletLength)) });
    case 'two-columns':
      return Object.freeze({
        ...base,
        left: Object.freeze(clampList(input.left, L.bullets, L.bulletLength)),
        right: Object.freeze(clampList(input.right, L.bullets, L.bulletLength)),
      });
    case 'image-left':
    case 'image-right':
      return Object.freeze({
        ...base,
        images: Object.freeze((Array.isArray(input.images) ? input.images : (input.assetId ? [input.assetId] : [])).slice(0, L.images).map(String)),
        bullets: Object.freeze(clampList(input.bullets, L.bullets, L.bulletLength)),
      });
    case 'chart-bar':
    case 'chart-line': {
      const chart = input.chart ?? {};
      return Object.freeze({
        ...base,
        chart: Object.freeze({
          labels: Object.freeze(clampList(chart.labels, 60, 60)),
          series: Object.freeze((Array.isArray(chart.series) ? chart.series : []).slice(0, L.series).map((serie) => Object.freeze({
            name: safeText(serie?.name, 60),
            values: Object.freeze((Array.isArray(serie?.values) ? serie.values : []).slice(0, 60).map((value) => (Number.isFinite(Number(value)) ? Number(value) : 0))),
          }))),
        }),
      });
    }
    case 'table': {
      const rows = (Array.isArray(input.rows) ? input.rows : []).slice(0, L.tableRows)
        .map((row) => Object.freeze((Array.isArray(row) ? row : []).slice(0, L.tableCols).map((cell) => safeText(cell, 500))));
      return Object.freeze({ ...base, rows: Object.freeze(rows) });
    }
    case 'quote':
      return Object.freeze({ ...base, quote: safeText(input.quote, 500), author: input.author ? safeText(input.author, 120) : '' });
    case 'timeline':
    case 'process':
      return Object.freeze({ ...base, steps: Object.freeze(clampList(input.steps, L.steps, 120)) });
    default:
      return Object.freeze(base);
  }
}

export function normalizePresentationSpec(input = {}) {
  if (!input || typeof input !== 'object') throw new Error('publication_presentation_invalid');
  const rawSlides = Array.isArray(input.slides) ? input.slides : [];
  if (rawSlides.length > PRESENTATION_LIMITS.slides) throw new Error('publication_presentation_too_many_slides');
  return Object.freeze({
    title: input.title ? safeText(input.title, 160) : '',
    themeId: PRESENTATION_THEMES[input.themeId] ? input.themeId : DEFAULT_THEME,
    slides: Object.freeze(rawSlides.map(normalizeSlide)),
    speakerNotes: Object.freeze((Array.isArray(input.speakerNotes) ? input.speakerNotes : []).map((note) => safeText(note, 4_000))),
  });
}
