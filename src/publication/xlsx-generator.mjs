import ExcelJS from 'exceljs';

// Générateur de classeur XLSX local (exceljs). Feuilles nommées (≤ 31 car, caractères interdits
// retirés), en-tête en gras + filtre auto, première ligne gelée, formules LOCALES uniquement. Toute
// formule contenant « [ » ou « ] » est REFUSÉE (référence à un classeur externe = fuite/lien). Aucune
// macro. 100 % hors-ligne.

const EXTERNAL_REF = /[[\]]|\b(?:HYPERLINK|WEBSERVICE)\s*\(/iu;
const FORBIDDEN_SHEET_CHARS = /[\\/*?:[\]]/gu;

export async function generateXlsx({ title = '', sheets = [], author = 'Mina Vision' } = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = String(author).slice(0, 120);
  workbook.title = String(title).slice(0, 200);
  workbook.created = undefined;

  const list = Array.isArray(sheets) && sheets.length > 0 ? sheets : [{ name: 'Feuille 1', rows: [] }];
  list.slice(0, 50).forEach((sheetSpec, index) => {
    const name = (String(sheetSpec?.name ?? '').replace(FORBIDDEN_SHEET_CHARS, ' ').trim().slice(0, 31)) || `Feuille ${index + 1}`;
    const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });

    const rows = Array.isArray(sheetSpec?.rows) ? sheetSpec.rows : [];
    rows.forEach((row) => sheet.addRow(Array.isArray(row) ? row : [row]));

    if (rows.length > 0) {
      sheet.getRow(1).font = { bold: true };
      const cols = Math.max(1, ...rows.map((row) => (Array.isArray(row) ? row.length : 1)));
      sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols } };
    }

    for (const entry of Array.isArray(sheetSpec?.formulas) ? sheetSpec.formulas : []) {
      const formula = String(entry?.formula ?? '');
      if (EXTERNAL_REF.test(formula)) throw new Error('publication_xlsx_external_reference_forbidden');
      if (typeof entry?.cell === 'string' && entry.cell) sheet.getCell(entry.cell).value = { formula };
    }
  });

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}
