import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// Générateur PDF de publication : consomme des blocs déjà normalisés (publication-schema) et des
// assets résolus (bytes en mémoire), rend un PDF paginé A4 avec titre, hiérarchie, paragraphes,
// listes, citations, tableaux (jamais tronqués — scindés/reportés), images légendées, en-tête/pied,
// numéro de page, date, auteur et métadonnées. 100 % local, zéro réseau.
//
// UNICODE : si des polices TTF sont fournies (fonts.regular/bold + fontkit), elles sont EMBARQUÉES →
// Unicode complet (accents, symboles, arabe, CJK). Sinon on retombe sur Helvetica standard (Latin-1 /
// français / €) et tout glyphe non encodable est remplacé par « ? » plutôt que de faire planter la
// génération. Déposer assets/fonts/NotoSans-Regular.ttf + Bold (voir assets/fonts/LICENSES.md) active
// l'Unicode complet sans changer une ligne de code.

const A4 = Object.freeze({ width: 595.28, height: 841.89 });
const MARGIN = 56;

export const PDF_THEMES = Object.freeze({
  'mina-light-v1': { bg: null, ink: rgb(0.09, 0.13, 0.19), muted: rgb(0.45, 0.48, 0.55), accent: rgb(0.06, 0.72, 0.51), rule: rgb(0.85, 0.87, 0.9) },
  'mina-dark-v1': { bg: rgb(0.07, 0.09, 0.13), ink: rgb(0.92, 0.94, 0.96), muted: rgb(0.6, 0.64, 0.7), accent: rgb(0.31, 0.8, 0.62), rule: rgb(0.2, 0.24, 0.3) },
  'corporate-blue-v1': { bg: null, ink: rgb(0.1, 0.15, 0.28), muted: rgb(0.4, 0.46, 0.58), accent: rgb(0.15, 0.39, 0.92), rule: rgb(0.8, 0.85, 0.95) },
  'minimal-paper-v1': { bg: rgb(0.99, 0.98, 0.96), ink: rgb(0.12, 0.12, 0.12), muted: rgb(0.5, 0.5, 0.48), accent: rgb(0.15, 0.15, 0.15), rule: rgb(0.86, 0.85, 0.82) },
});
const DEFAULT_THEME = 'mina-light-v1';

const SIZE = Object.freeze({ title: 22, h1: 16, h2: 13, body: 11, caption: 9, footer: 8 });
const LEADING = 1.45;

// Cache par police : un glyphe encodable est gardé, sinon remplacé. Évite de tester chaque caractère
// répété. (Sans police custom, Helvetica ne code que WinAnsi ; l'arabe deviendrait un throw.)
function makeSanitizer(font, custom) {
  if (custom) return (text) => String(text ?? '');
  const cache = new Map();
  return (text) => {
    let out = '';
    for (const char of String(text ?? '')) {
      let ok = cache.get(char);
      if (ok === undefined) {
        try { font.widthOfTextAtSize(char, 10); ok = true; } catch { ok = false; }
        cache.set(char, ok);
      }
      out += ok ? char : (char === ' ' ? ' ' : '?');
    }
    return out;
  };
}

function wrap(text, font, size, maxWidth) {
  const lines = [];
  for (const rawLine of String(text).split('\n')) {
    let line = '';
    for (const word of rawLine.split(/\s+/u).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth || line === '') line = candidate;
      else { lines.push(line); line = word; }
    }
    lines.push(line);
  }
  return lines.length ? lines : [''];
}

export async function generatePdf({
  title = '', blocks = [], assets = [], theme = DEFAULT_THEME, author = 'Mina Vision',
  createdAt = '', fonts = null, fontkit = null,
} = {}) {
  const palette = PDF_THEMES[theme] ?? PDF_THEMES[DEFAULT_THEME];
  const pdf = await PDFDocument.create();
  pdf.setTitle(String(title).slice(0, 200));
  pdf.setAuthor(String(author).slice(0, 120));
  pdf.setCreator('Mina Vision');
  pdf.setProducer('Mina Vision');

  let font;
  let bold;
  let custom = false;
  if (fonts?.regular && fonts?.bold && fontkit) {
    pdf.registerFontkit(fontkit);
    font = await pdf.embedFont(fonts.regular, { subset: true });
    bold = await pdf.embedFont(fonts.bold, { subset: true });
    custom = true;
  } else {
    font = await pdf.embedFont(StandardFonts.Helvetica);
    bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  }
  const clean = makeSanitizer(font, custom);
  const usable = A4.width - MARGIN * 2;

  const assetById = new Map(assets.map((asset) => [asset.assetId, asset]));
  const pages = [];
  let page;
  let cursorY = 0;

  const newPage = () => {
    page = pdf.addPage([A4.width, A4.height]);
    if (palette.bg) page.drawRectangle({ x: 0, y: 0, width: A4.width, height: A4.height, color: palette.bg });
    pages.push(page);
    cursorY = A4.height - MARGIN;
  };
  const ensureRoom = (needed) => { if (cursorY - needed < MARGIN + 24) newPage(); };
  const lineHeight = (size) => size * LEADING;

  const drawParagraph = (text, usedFont, size, color) => {
    for (const line of wrap(clean(text), usedFont, size, usable)) {
      ensureRoom(lineHeight(size));
      page.drawText(line, { x: MARGIN, y: cursorY - size, size, font: usedFont, color });
      cursorY -= lineHeight(size);
    }
  };

  newPage();
  // Titre + méta.
  drawParagraph(title, bold, SIZE.title, palette.ink);
  cursorY -= 4;
  if (createdAt) { drawParagraph(`${author} — ${createdAt}`, font, SIZE.caption, palette.muted); }
  cursorY -= 10;

  for (const block of blocks) {
    switch (block.kind) {
      case 'title':
        cursorY -= 6; drawParagraph(block.text, bold, SIZE.title, palette.ink); cursorY -= 6; break;
      case 'heading':
        cursorY -= 8; drawParagraph(block.text, bold, block.level >= 3 ? SIZE.h2 : SIZE.h1, palette.ink); cursorY -= 4; break;
      case 'paragraph':
        drawParagraph(block.text, font, SIZE.body, palette.ink); cursorY -= 6; break;
      case 'quote':
        cursorY -= 4;
        drawParagraph(`“${block.text}”`, bold, SIZE.body, palette.muted); cursorY -= 6; break;
      case 'bullets':
        for (const item of block.items) { drawParagraph(`•  ${item}`, font, SIZE.body, palette.ink); }
        cursorY -= 6; break;
      case 'pageBreak':
        newPage(); break;
      case 'table':
        drawTable(block.rows); cursorY -= 8; break;
      case 'image':
        await drawImage(block); cursorY -= 8; break;
      case 'chart':
        // Le SVG du chart est fourni comme asset image (rendu en amont) ; sinon on saute proprement.
        if (block.assetId && assetById.has(block.assetId)) await drawImage({ ...block });
        break;
      default: break;
    }
  }

  function drawTable(rows) {
    if (!rows.length) return;
    const cols = rows.reduce((max, row) => Math.max(max, row.length), 0);
    const colW = usable / cols;
    const size = SIZE.body - 1;
    for (const row of rows) {
      const cellLines = row.map((cell) => wrap(clean(cell), font, size, colW - 8));
      const rowLines = Math.max(1, ...cellLines.map((lines) => lines.length));
      const rowHeight = rowLines * lineHeight(size) + 6;
      if (cursorY - rowHeight < MARGIN + 24) newPage(); // JAMAIS tronqué : la ligne entière repart en page suivante.
      const top = cursorY;
      row.forEach((_, index) => {
        cellLines[index].forEach((line, lineIndex) => {
          page.drawText(line, { x: MARGIN + index * colW + 4, y: top - size - lineIndex * lineHeight(size), size, font, color: palette.ink });
        });
      });
      cursorY = top - rowHeight;
      page.drawLine({ start: { x: MARGIN, y: cursorY + 2 }, end: { x: MARGIN + usable, y: cursorY + 2 }, thickness: 0.5, color: palette.rule });
    }
  }

  async function drawImage(block) {
    const asset = assetById.get(block.assetId);
    if (!asset?.bytes) return;
    let embedded = null;
    try {
      if (asset.mimeType === 'image/png') embedded = await pdf.embedPng(asset.bytes);
      else if (asset.mimeType === 'image/jpeg') embedded = await pdf.embedJpg(asset.bytes);
    } catch { embedded = null; }
    if (!embedded) return;
    const maxW = usable;
    const scale = Math.min(maxW / embedded.width, 1);
    const w = embedded.width * scale;
    const h = embedded.height * scale;
    ensureRoom(h + (block.caption ? lineHeight(SIZE.caption) : 0));
    page.drawImage(embedded, { x: MARGIN, y: cursorY - h, width: w, height: h });
    cursorY -= h + 4;
    if (block.caption) drawParagraph(block.caption, font, SIZE.caption, palette.muted);
  }

  // Pied de page sur chaque page : Mina Vision · date · n/N.
  const total = pages.length;
  pages.forEach((current, index) => {
    const label = clean(`Mina Vision${createdAt ? ` · ${createdAt}` : ''}`);
    current.drawText(label, { x: MARGIN, y: MARGIN - 18, size: SIZE.footer, font, color: palette.muted });
    const num = `${index + 1} / ${total}`;
    current.drawText(num, { x: A4.width - MARGIN - font.widthOfTextAtSize(num, SIZE.footer), y: MARGIN - 18, size: SIZE.footer, font, color: palette.muted });
  });

  return Buffer.from(await pdf.save());
}
