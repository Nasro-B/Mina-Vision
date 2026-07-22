// Générateur de documents locaux de Mina : PDF (pdf-lib) et DOCX (docx), 100 % hors-ligne.
// Sortie dans un dossier dédié, nom horodaté — JAMAIS d'écrasement d'un fichier existant.
// Le contenu accepte soit un texte brut (paragraphes séparés par des lignes vides), soit des
// sections structurées [{ heading, paragraphs }].

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';

const FORMATS = new Set(['pdf', 'docx']);
const MAX_TITLE_CHARS = 120;
const MAX_CONTENT_CHARS = 200_000;

// A4 en points PDF.
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const BODY_SIZE = 11;
const HEADING_SIZE = 15;
const TITLE_SIZE = 20;
const LINE_HEIGHT = 16;

export function slugifyTitle(title) {
  return String(title ?? 'document')
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .replace(/[^a-zA-Z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 60)
    .toLowerCase() || 'document';
}

export function normalizeSections({ content, sections } = {}) {
  if (Array.isArray(sections) && sections.length > 0) {
    return sections.map((section) => ({
      heading: typeof section?.heading === 'string' && section.heading.trim() ? section.heading.trim() : null,
      paragraphs: (Array.isArray(section?.paragraphs) ? section.paragraphs : [])
        .map((paragraph) => String(paragraph ?? '').trim())
        .filter(Boolean),
    })).filter((section) => section.heading !== null || section.paragraphs.length > 0);
  }
  const text = String(content ?? '').trim();
  if (!text) return [];
  // Texte brut : blocs séparés par ligne vide = paragraphes ; « ## Titre » = section.
  const result = [];
  let current = { heading: null, paragraphs: [] };
  for (const block of text.split(/\n\s*\n/u)) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const headingMatch = trimmed.match(/^#{1,3}\s+(.+)$/u);
    if (headingMatch) {
      if (current.heading !== null || current.paragraphs.length > 0) result.push(current);
      current = { heading: headingMatch[1].trim(), paragraphs: [] };
    } else {
      current.paragraphs.push(trimmed.replace(/\s*\n\s*/gu, ' '));
    }
  }
  if (current.heading !== null || current.paragraphs.length > 0) result.push(current);
  return result;
}

// Coupe un paragraphe en lignes tenant dans la largeur utile (mesure réelle de la police).
function wrapText(text, font, size, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/u)) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || line === '') {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function buildPdf({ title, sections, createdAt }) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const usable = PAGE_WIDTH - MARGIN * 2;

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let cursorY = PAGE_HEIGHT - MARGIN;
  const ensureRoom = (needed) => {
    if (cursorY - needed < MARGIN) {
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      cursorY = PAGE_HEIGHT - MARGIN;
    }
  };
  const drawLines = (lines, usedFont, size, color = rgb(0.09, 0.13, 0.19)) => {
    for (const line of lines) {
      ensureRoom(LINE_HEIGHT);
      page.drawText(line, { x: MARGIN, y: cursorY - size, size, font: usedFont, color });
      cursorY -= LINE_HEIGHT;
    }
  };

  drawLines(wrapText(title, bold, TITLE_SIZE, usable), bold, TITLE_SIZE);
  cursorY -= 4;
  drawLines([`Généré par Mina Vision — ${createdAt}`], font, 9, rgb(0.45, 0.48, 0.55));
  cursorY -= 10;

  for (const section of sections) {
    if (section.heading) {
      cursorY -= 6;
      drawLines(wrapText(section.heading, bold, HEADING_SIZE, usable), bold, HEADING_SIZE);
      cursorY -= 2;
    }
    for (const paragraph of section.paragraphs) {
      drawLines(wrapText(paragraph, font, BODY_SIZE, usable), font, BODY_SIZE);
      cursorY -= 6;
    }
  }
  return Buffer.from(await pdf.save());
}

async function buildDocx({ title, sections, createdAt }) {
  const children = [
    new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
    new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [new TextRun({ text: `Généré par Mina Vision — ${createdAt}`, italics: true, size: 18, color: '6b7280' })],
    }),
    new Paragraph({ text: '' }),
  ];
  for (const section of sections) {
    if (section.heading) {
      children.push(new Paragraph({ text: section.heading, heading: HeadingLevel.HEADING_1 }));
    }
    for (const paragraph of section.paragraphs) {
      children.push(new Paragraph({ children: [new TextRun({ text: paragraph, size: 22 })] }));
      children.push(new Paragraph({ text: '' }));
    }
  }
  const document = new Document({ sections: [{ children }] });
  return Packer.toBuffer(document);
}

export function createDocumentGenerator({ outputDirectory, fs, now = () => new Date() } = {}) {
  if (typeof outputDirectory !== 'string' || outputDirectory.length === 0) {
    throw new TypeError('document_generator_output_directory_required');
  }
  if (!fs || typeof fs.writeFile !== 'function' || typeof fs.mkdir !== 'function' || typeof fs.access !== 'function') {
    throw new TypeError('document_generator_fs_required');
  }
  const base = outputDirectory.replace(/[\\/]+$/u, '');

  async function uniquePath(slug, extension, stamp) {
    let candidate = `${base}/${slug}-${stamp}.${extension}`;
    let suffix = 2;
    // Jamais d'écrasement : si le nom existe déjà (deux générations dans la même seconde), suffixe.
    for (;;) {
      try {
        await fs.access(candidate);
        candidate = `${base}/${slug}-${stamp}-${suffix}.${extension}`;
        suffix += 1;
      } catch {
        return candidate;
      }
    }
  }

  return Object.freeze({
    async generate({ format, title, content, sections } = {}) {
      const normalizedFormat = String(format ?? '').toLowerCase();
      if (!FORMATS.has(normalizedFormat)) {
        throw new Error(`document_generator_format_invalid: ${format} (pdf ou docx)`);
      }
      const cleanTitle = String(title ?? '').trim().slice(0, MAX_TITLE_CHARS);
      if (!cleanTitle) throw new Error('document_generator_title_required');
      if (typeof content === 'string' && content.length > MAX_CONTENT_CHARS) {
        throw new Error('document_generator_content_too_large');
      }
      const normalizedSections = normalizeSections({ content, sections });
      if (normalizedSections.length === 0) throw new Error('document_generator_content_required');

      const date = now();
      const createdAt = date.toLocaleString('fr-FR');
      const stamp = [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
      ].join('') + '-' + [
        String(date.getHours()).padStart(2, '0'),
        String(date.getMinutes()).padStart(2, '0'),
        String(date.getSeconds()).padStart(2, '0'),
      ].join('');

      const buffer = normalizedFormat === 'pdf'
        ? await buildPdf({ title: cleanTitle, sections: normalizedSections, createdAt })
        : await buildDocx({ title: cleanTitle, sections: normalizedSections, createdAt });

      await fs.mkdir(base, { recursive: true });
      const filePath = await uniquePath(slugifyTitle(cleanTitle), normalizedFormat, stamp);
      await fs.writeFile(filePath, buffer);
      return Object.freeze({
        filePath,
        format: normalizedFormat,
        bytes: buffer.length,
        sections: normalizedSections.length,
        title: cleanTitle,
      });
    },
  });
}
