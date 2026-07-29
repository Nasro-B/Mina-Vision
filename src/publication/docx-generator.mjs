import {
  AlignmentType, Document, Footer, HeadingLevel, ImageRun, PageNumber, Packer,
  Paragraph, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';

// Générateur DOCX de publication : consomme des blocs normalisés + assets résolus. L'Unicode est
// NATIF (le lecteur Word/LibreOffice rend la police — aucune TTF à embarquer, contrairement au PDF).
// Styles Title/Heading/Body/Caption, listes, citations, tableaux, images légendées, pied de page
// numéroté et métadonnées. Aucune macro, aucun lien automatique, aucun code embarqué. 100 % local.

const IMAGE_TYPE = Object.freeze({ 'image/png': 'png', 'image/jpeg': 'jpg' });

function buildTable(rows) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((row, rowIndex) => new TableRow({
      children: row.map((cell) => new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: String(cell ?? ''), bold: rowIndex === 0, size: 20 })] })],
      })),
    })),
  });
}

function buildImage(block, assetById) {
  const asset = assetById.get(block.assetId);
  const type = asset?.bytes ? IMAGE_TYPE[asset.mimeType] : null;
  if (!type) return null;
  const maxW = 540;
  const width = asset.dimensions?.width || asset.width || 480;
  const height = asset.dimensions?.height || asset.height || 320;
  const scale = Math.min(maxW / width, 1);
  const children = [new ImageRun({ data: asset.bytes, type, transformation: { width: Math.round(width * scale), height: Math.round(height * scale) } })];
  if (block.caption) children.push(new TextRun({ break: 1, text: block.caption, italics: true, size: 16, color: '6b7280' }));
  return new Paragraph({ children });
}

export async function generateDocx({ title = '', blocks = [], assets = [], author = 'Mina Vision', createdAt = '' } = {}) {
  const assetById = new Map(assets.map((asset) => [asset.assetId, asset]));
  const children = [new Paragraph({ text: String(title), heading: HeadingLevel.TITLE })];
  if (createdAt) {
    children.push(new Paragraph({ children: [new TextRun({ text: `${author} — ${createdAt}`, italics: true, size: 18, color: '6b7280' })] }));
  }
  children.push(new Paragraph({ text: '' }));

  for (const block of blocks) {
    switch (block.kind) {
      case 'title':
        children.push(new Paragraph({ text: block.text, heading: HeadingLevel.TITLE })); break;
      case 'heading':
        children.push(new Paragraph({ text: block.text, heading: block.level >= 3 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_1 })); break;
      case 'paragraph':
        children.push(new Paragraph({ children: [new TextRun({ text: block.text, size: 22 })] })); break;
      case 'quote':
        children.push(new Paragraph({ indent: { left: 360 }, children: [new TextRun({ text: block.text, italics: true, size: 22, color: '6b7280' })] })); break;
      case 'bullets':
        for (const item of block.items) children.push(new Paragraph({ text: item, bullet: { level: 0 } }));
        break;
      case 'pageBreak':
        children.push(new Paragraph({ children: [], pageBreakBefore: true })); break;
      case 'table':
        children.push(buildTable(block.rows)); children.push(new Paragraph({ text: '' })); break;
      case 'image': {
        const paragraph = buildImage(block, assetById);
        if (paragraph) children.push(paragraph);
        break;
      }
      default: break;
    }
  }

  const document = new Document({
    creator: String(author).slice(0, 120),
    title: String(title).slice(0, 200),
    description: 'Généré par Mina Vision',
    sections: [{
      children,
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: `Mina Vision${createdAt ? ` · ${createdAt}` : ''} · `, size: 16, color: '9ca3af' }),
              new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '9ca3af' }),
            ],
          })],
        }),
      },
    }],
  });
  return Packer.toBuffer(document);
}
