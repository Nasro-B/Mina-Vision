import { createHash } from 'node:crypto';

// Illustrations vectorielles SANS RÉSEAU ni IA : fonds, grilles d'icônes, graphiques (barres/lignes),
// frises, diagrammes de processus et cartes de citation, calculés localement à partir de données
// fournies. Toute chaîne est échappée XML (aucune injection dans le SVG) et toute couleur doit
// correspondre à /^#[0-9a-fA-F]{6}$/. Sortie déterministe → même entrée, même octets, même SHA-256.

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/u;
const KINDS = new Set(['background', 'icon-grid', 'bar-chart', 'line-chart', 'timeline', 'process-diagram', 'quote-card']);
const MIN_DIM = 16;
const MAX_DIM = 8192;

function escapeXml(value) {
  return String(value ?? '').replace(/[<>&"']/gu, (char) => (
    { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[char]
  ));
}

function assertColor(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (!HEX_COLOR.test(value)) throw new Error(`publication_illustration_color_invalid:${value}`);
  return value;
}

function clampDim(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.round(number), MIN_DIM), MAX_DIM);
}

function numericSeries(values, count) {
  const list = Array.isArray(values) ? values.map((value) => (Number.isFinite(Number(value)) ? Number(value) : 0)) : [];
  return list.slice(0, count);
}

const renderers = {
  background: ({ w, h, from, to }) => `
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
    </linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>`,

  'icon-grid': ({ w, h, from, accent, data }) => {
    const cols = Math.min(Math.max(Number(data.cols) || 6, 1), 24);
    const rows = Math.min(Math.max(Number(data.rows) || 4, 1), 24);
    const cellW = w / cols;
    const cellH = h / rows;
    let dots = '';
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const cx = c * cellW + cellW / 2;
        const cy = r * cellH + cellH / 2;
        dots += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(Math.min(cellW, cellH) / 4).toFixed(1)}" fill="${(r + c) % 2 === 0 ? accent : from}"/>`;
      }
    }
    return `<rect width="${w}" height="${h}" fill="#ffffff"/>${dots}`;
  },

  'bar-chart': ({ w, h, from, accent, data }) => {
    const values = numericSeries(data.values, 24);
    const labels = Array.isArray(data.labels) ? data.labels : [];
    const max = Math.max(1, ...values);
    const pad = 40;
    const chartH = h - pad * 2;
    const barW = values.length ? (w - pad * 2) / values.length : 0;
    let bars = '';
    values.forEach((value, index) => {
      const barH = (value / max) * chartH;
      const x = pad + index * barW + barW * 0.15;
      const y = pad + chartH - barH;
      bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(barW * 0.7).toFixed(1)}" height="${barH.toFixed(1)}" fill="${accent}"/>`;
      const label = labels[index];
      if (label !== undefined) {
        bars += `<text x="${(x + barW * 0.35).toFixed(1)}" y="${(h - pad / 2).toFixed(1)}" font-size="12" text-anchor="middle" fill="${from}">${escapeXml(label)}</text>`;
      }
    });
    return `<rect width="${w}" height="${h}" fill="#ffffff"/><line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="${from}" stroke-width="1"/>${bars}`;
  },

  'line-chart': ({ w, h, from, accent, data }) => {
    const values = numericSeries(data.values, 100);
    const max = Math.max(1, ...values);
    const pad = 40;
    const chartH = h - pad * 2;
    const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
    const points = values.map((value, index) => `${(pad + index * step).toFixed(1)},${(pad + chartH - (value / max) * chartH).toFixed(1)}`).join(' ');
    return `<rect width="${w}" height="${h}" fill="#ffffff"/><line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="${from}" stroke-width="1"/><polyline points="${points}" fill="none" stroke="${accent}" stroke-width="3"/>`;
  },

  timeline: ({ w, h, from, accent, data }) => {
    const steps = (Array.isArray(data.steps) ? data.steps : []).slice(0, 8);
    const y = h / 2;
    const gap = steps.length ? (w - 80) / Math.max(steps.length - 1, 1) : 0;
    let nodes = `<line x1="40" y1="${y}" x2="${w - 40}" y2="${y}" stroke="${from}" stroke-width="2"/>`;
    steps.forEach((step, index) => {
      const cx = 40 + index * gap;
      nodes += `<circle cx="${cx.toFixed(1)}" cy="${y}" r="8" fill="${accent}"/>`;
      nodes += `<text x="${cx.toFixed(1)}" y="${(y - 20).toFixed(1)}" font-size="13" text-anchor="middle" fill="${from}">${escapeXml(step)}</text>`;
    });
    return `<rect width="${w}" height="${h}" fill="#ffffff"/>${nodes}`;
  },

  'process-diagram': ({ w, h, from, accent, data }) => {
    const steps = (Array.isArray(data.steps) ? data.steps : []).slice(0, 6);
    const boxW = steps.length ? (w - 40) / steps.length - 16 : 0;
    const y = h / 2 - 30;
    let boxes = '';
    steps.forEach((step, index) => {
      const x = 20 + index * (boxW + 16);
      boxes += `<rect x="${x.toFixed(1)}" y="${y}" width="${boxW.toFixed(1)}" height="60" rx="8" fill="${accent}" opacity="0.15" stroke="${accent}" stroke-width="2"/>`;
      boxes += `<text x="${(x + boxW / 2).toFixed(1)}" y="${(y + 35).toFixed(1)}" font-size="13" text-anchor="middle" fill="${from}">${escapeXml(step)}</text>`;
      if (index < steps.length - 1) {
        boxes += `<text x="${(x + boxW + 8).toFixed(1)}" y="${(y + 38).toFixed(1)}" font-size="18" text-anchor="middle" fill="${from}">→</text>`;
      }
    });
    return `<rect width="${w}" height="${h}" fill="#ffffff"/>${boxes}`;
  },

  'quote-card': ({ w, h, from, to, accent, data }) => {
    const quote = escapeXml(String(data.quote ?? '').slice(0, 280));
    const author = escapeXml(String(data.author ?? '').slice(0, 80));
    return `
      <defs><linearGradient id="q" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
      </linearGradient></defs>
      <rect width="${w}" height="${h}" fill="url(#q)"/>
      <text x="40" y="70" font-size="64" fill="${accent}">&#8220;</text>
      <text x="60" y="${(h / 2).toFixed(1)}" font-size="24" fill="#ffffff">${quote}</text>
      <text x="60" y="${(h - 50).toFixed(1)}" font-size="16" fill="${accent}">${author}</text>`;
  },
};

export function createIllustration({ kind, palette = {}, data = {}, width = 1280, height = 720 } = {}) {
  if (!KINDS.has(kind)) throw new Error(`publication_illustration_kind_invalid:${kind}`);
  const w = clampDim(width, 1280);
  const h = clampDim(height, 720);
  const colors = {
    from: assertColor(palette.from, '#1f2937'),
    to: assertColor(palette.to, '#111827'),
    accent: assertColor(palette.accent, '#10b981'),
  };
  const body = renderers[kind]({ w, h, ...colors, data });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
  const bytes = Buffer.from(svg, 'utf8');
  return Object.freeze({
    bytes,
    mimeType: 'image/svg+xml',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    provenance: 'procedural',
  });
}

export const ILLUSTRATION_KINDS = Object.freeze([...KINDS]);
