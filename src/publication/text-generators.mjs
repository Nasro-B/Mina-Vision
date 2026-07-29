// Générateurs texte déterministes : Markdown, HTML, CSV et JSON. Consomment une requête normalisée
// (publication-schema). Zéro réseau, zéro script.
// - HTML : tout texte échappé, feuille de style locale intégrée, JAMAIS de <script>, iframe ou URL distante.
// - CSV : délimiteur « ; », BOM UTF-8, cellules commençant par = + - @ neutralisées (anti-injection tableur).
// - JSON : sérialise uniquement la requête normalisée + une note d'origine.

const TEXT_FORMATS = new Set(['md', 'html', 'csv', 'json']);

function escapeHtml(value) {
  return String(value ?? '').replace(/[<>&"']/gu, (char) => (
    { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[char]
  ));
}

function csvEscapeCell(value) {
  let cell = String(value ?? '');
  if (/^[=+\-@\t\r]/u.test(cell)) cell = `'${cell}`; // neutralise une formule injectée
  if (/[";\n]/u.test(cell)) cell = `"${cell.replace(/"/gu, '""')}"`;
  return cell;
}

function toMarkdown(request) {
  const lines = [];
  if (request.title) lines.push(`# ${request.title}`, '');
  for (const block of request.blocks ?? []) {
    switch (block.kind) {
      case 'title': lines.push(`# ${block.text}`, ''); break;
      case 'heading': lines.push(`${'#'.repeat(Math.min((block.level ?? 1) + 1, 6))} ${block.text}`, ''); break;
      case 'paragraph': lines.push(block.text, ''); break;
      case 'quote': lines.push(`> ${block.text}`, ''); break;
      case 'bullets': for (const item of block.items) lines.push(`- ${item}`); lines.push(''); break;
      case 'table':
        if (block.rows.length) {
          lines.push(`| ${block.rows[0].join(' | ')} |`, `| ${block.rows[0].map(() => '---').join(' | ')} |`);
          for (const row of block.rows.slice(1)) lines.push(`| ${row.join(' | ')} |`);
          lines.push('');
        }
        break;
      case 'pageBreak': lines.push('---', ''); break;
      default: break;
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function toHtml(request) {
  const body = [];
  for (const block of request.blocks ?? []) {
    switch (block.kind) {
      case 'title': body.push(`<h1>${escapeHtml(block.text)}</h1>`); break;
      case 'heading': { const level = Math.min((block.level ?? 1) + 1, 6); body.push(`<h${level}>${escapeHtml(block.text)}</h${level}>`); break; }
      case 'paragraph': body.push(`<p>${escapeHtml(block.text)}</p>`); break;
      case 'quote': body.push(`<blockquote>${escapeHtml(block.text)}</blockquote>`); break;
      case 'bullets': body.push(`<ul>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`); break;
      case 'table':
        body.push(`<table>${block.rows.map((row, rowIndex) => `<tr>${row.map((cell) => {
          const tag = rowIndex === 0 ? 'th' : 'td';
          return `<${tag}>${escapeHtml(cell)}</${tag}>`;
        }).join('')}</tr>`).join('')}</table>`);
        break;
      case 'pageBreak': body.push('<hr>'); break;
      default: break;
    }
  }
  const style = 'body{font-family:system-ui,-apple-system,sans-serif;max-width:820px;margin:2rem auto;padding:0 1rem;color:#1f2937;line-height:1.6}'
    + 'h1{font-size:1.9rem}table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{border:1px solid #d1d5db;padding:6px 10px;text-align:left}'
    + 'th{background:#f3f4f6}blockquote{border-left:3px solid #10b981;margin:1rem 0;padding-left:1rem;color:#6b7280}footer{margin-top:2rem;color:#9ca3af;font-size:.85rem}';
  return `<!doctype html>\n<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<title>${escapeHtml(request.title)}</title><style>${style}</style></head><body>`
    + `<h1>${escapeHtml(request.title)}</h1>${body.join('')}<footer>Généré par Mina Vision</footer></body></html>\n`;
}

function toCsv(request) {
  const rows = [];
  for (const block of request.blocks ?? []) {
    if (block.kind === 'table') for (const row of block.rows) rows.push(row);
  }
  const body = rows.map((row) => (Array.isArray(row) ? row : [row]).map(csvEscapeCell).join(';')).join('\r\n');
  return `﻿${body}\r\n`;
}

export function generateText(format, request = {}) {
  if (!TEXT_FORMATS.has(format)) throw new Error(`publication_text_format_invalid:${format}`);
  switch (format) {
    case 'md': return Buffer.from(toMarkdown(request), 'utf8');
    case 'html': return Buffer.from(toHtml(request), 'utf8');
    case 'csv': return Buffer.from(toCsv(request), 'utf8');
    case 'json': return Buffer.from(`${JSON.stringify({ generatedBy: 'Mina Vision', request }, null, 2)}\n`, 'utf8');
    default: throw new Error(`publication_text_format_invalid:${format}`);
  }
}
