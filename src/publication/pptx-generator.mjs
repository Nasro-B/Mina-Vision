import { PRESENTATION_THEMES } from './presentation-schema.mjs';

// Générateur PPTX local (PptxGenJS injecté via pptxFactory pour la testabilité). 16:9 (LAYOUT_WIDE),
// langue fr-FR, propriétés du fichier (titre/auteur/sujet), un master de slide, numérotation, notes.
// Les images ne viennent QUE de l'assetResolver (bytes → data URI base64) — JAMAIS d'URL distante,
// jamais de macro/lien/code embarqué. Zéro réseau.

const MIME_FOR_EXT = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' };

function dataUri(asset) {
  if (!asset?.bytes || !MIME_FOR_EXT[asset.mimeType]) return null;
  return `data:${asset.mimeType};base64,${Buffer.from(asset.bytes).toString('base64')}`;
}

function renderSlide(slide, spec, theme, assetResolver) {
  const ink = theme.ink;
  const accent = theme.accent;
  const muted = theme.muted;
  slide.background = { color: theme.bg };
  const titleOpts = { x: 0.6, y: 0.4, w: 12.1, h: 0.9, fontSize: 28, bold: true, color: ink };

  switch (spec.kind) {
    case 'cover':
    case 'closing':
      slide.addText(spec.title || '', { x: 0.8, y: 2.6, w: 11.7, h: 1.4, fontSize: 44, bold: true, color: ink });
      if (spec.subtitle) slide.addText(spec.subtitle, { x: 0.8, y: 4.0, w: 11.7, h: 0.9, fontSize: 22, color: accent });
      break;
    case 'section':
      slide.addText(spec.title || '', { x: 0.8, y: 3.0, w: 11.7, h: 1.2, fontSize: 36, bold: true, color: accent });
      if (spec.subtitle) slide.addText(spec.subtitle, { x: 0.8, y: 4.2, w: 11.7, h: 0.8, fontSize: 20, color: muted });
      break;
    case 'bullets':
      if (spec.title) slide.addText(spec.title, titleOpts);
      slide.addText(spec.bullets.map((text) => ({ text, options: { bullet: true, color: ink, fontSize: 18, paraSpaceAfter: 8 } })),
        { x: 0.8, y: 1.6, w: 11.7, h: 5.2 });
      break;
    case 'two-columns':
      if (spec.title) slide.addText(spec.title, titleOpts);
      slide.addText(spec.left.map((text) => ({ text, options: { bullet: true, color: ink, fontSize: 16 } })), { x: 0.6, y: 1.6, w: 5.9, h: 5.2 });
      slide.addText(spec.right.map((text) => ({ text, options: { bullet: true, color: ink, fontSize: 16 } })), { x: 6.8, y: 1.6, w: 5.9, h: 5.2 });
      break;
    case 'image-left':
    case 'image-right': {
      if (spec.title) slide.addText(spec.title, titleOpts);
      const uri = dataUri(assetResolver(spec.images[0]));
      const imgX = spec.kind === 'image-left' ? 0.6 : 6.9;
      const txtX = spec.kind === 'image-left' ? 6.9 : 0.6;
      if (uri) slide.addImage({ data: uri, x: imgX, y: 1.7, w: 5.8, h: 4.6, sizing: { type: 'contain', w: 5.8, h: 4.6 } });
      slide.addText(spec.bullets.map((text) => ({ text, options: { bullet: true, color: ink, fontSize: 16 } })), { x: txtX, y: 1.7, w: 5.8, h: 4.6 });
      break;
    }
    case 'chart-bar':
    case 'chart-line': {
      if (spec.title) slide.addText(spec.title, titleOpts);
      const data = spec.chart.series.map((serie) => ({ name: serie.name, labels: [...spec.chart.labels], values: [...serie.values] }));
      const type = spec.kind === 'chart-bar' ? 'bar' : 'line';
      if (data.length) slide.addChart(type, data, { x: 0.8, y: 1.7, w: 11.6, h: 5.0, showLegend: true, legendPos: 'b', chartColors: [accent.replace('#', ''), '64748B', 'F59E0B'] });
      break;
    }
    case 'table':
      if (spec.title) slide.addText(spec.title, titleOpts);
      if (spec.rows.length) {
        slide.addTable(spec.rows.map((row, rowIndex) => row.map((cell) => ({
          text: String(cell), options: { bold: rowIndex === 0, color: ink, fontSize: 12, fill: { color: rowIndex === 0 ? 'EEF2F7' : 'FFFFFF' } },
        }))), { x: 0.6, y: 1.6, w: 12.1, border: { type: 'solid', pt: 0.5, color: 'D1D5DB' } });
      }
      break;
    case 'quote':
      slide.addText(`“${spec.quote}”`, { x: 1.0, y: 2.4, w: 11.3, h: 2.4, fontSize: 30, italic: true, color: ink });
      if (spec.author) slide.addText(`— ${spec.author}`, { x: 1.0, y: 5.0, w: 11.3, h: 0.7, fontSize: 18, color: accent });
      break;
    case 'timeline':
    case 'process':
      if (spec.title) slide.addText(spec.title, titleOpts);
      spec.steps.forEach((step, index) => {
        const width = spec.steps.length ? 12.1 / spec.steps.length : 12.1;
        slide.addText(step, {
          x: 0.6 + index * width, y: 3.0, w: width - 0.2, h: 1.2, fontSize: 14, align: 'center', color: ink,
          fill: { color: 'EEF2F7' }, line: { color: accent.replace('#', ''), width: 1 },
        });
      });
      break;
    default:
      if (spec.title) slide.addText(spec.title, titleOpts);
      break;
  }
}

export function createPresentationGenerator({ pptxFactory, assetResolver = () => null, clock = () => 0 } = {}) {
  if (typeof pptxFactory !== 'function') throw new TypeError('pptx_generator_factory_required');
  return Object.freeze({
    async generate(spec = {}) {
      const theme = PRESENTATION_THEMES[spec.themeId] ?? PRESENTATION_THEMES['mina-light-v1'];
      const pptx = pptxFactory();
      try { pptx.defineLayout({ name: 'MINA_WIDE', width: 13.333, height: 7.5 }); } catch { /* certains stubs n'ont pas defineLayout */ }
      pptx.layout = 'LAYOUT_WIDE';
      pptx.author = 'Mina Vision';
      pptx.company = 'Mina Vision';
      pptx.title = String(spec.title ?? '');
      pptx.subject = String(spec.title ?? '');

      const total = spec.slides?.length ?? 0;
      (spec.slides ?? []).forEach((slideSpec, index) => {
        const slide = pptx.addSlide();
        renderSlide(slide, slideSpec, theme, assetResolver);
        // Numérotation discrète en bas.
        slide.addText(`${index + 1} / ${total}`, { x: 11.6, y: 7.0, w: 1.4, h: 0.3, fontSize: 9, align: 'right', color: theme.muted });
        const note = spec.speakerNotes?.[index];
        if (note && typeof slide.addNotes === 'function') slide.addNotes(note);
      });

      const out = await pptx.write({ outputType: 'nodebuffer' });
      return Buffer.isBuffer(out) ? out : Buffer.from(out);
    },
  });
}
