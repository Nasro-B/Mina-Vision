import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { generateXlsx } from '../src/publication/xlsx-generator.mjs';

async function load(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

describe('xlsx-generator', () => {
  it('génère un XLSX avec feuille, tableau et formule locale', async () => {
    const buffer = await generateXlsx({
      title: 'Suivi',
      sheets: [{ name: 'CA', rows: [['Mois', 'Montant'], ['Janvier', 120]], formulas: [{ cell: 'B3', formula: 'SUM(B2:B2)' }] }],
    });
    const workbook = await load(buffer);
    const sheet = workbook.getWorksheet('CA');
    expect(sheet.getCell('B3').formula).toBe('SUM(B2:B2)');
    expect(sheet.getCell('A1').value).toBe('Mois');
    expect(sheet.getCell('B2').value).toBe(120);
  });

  it('refuse une formule à référence de classeur externe (crochets)', async () => {
    await expect(generateXlsx({
      sheets: [{ name: 'X', rows: [[1]], formulas: [{ cell: 'A2', formula: "'[Budget.xlsx]Feuil1'!A1" }] }],
    })).rejects.toThrow('publication_xlsx_external_reference_forbidden');
  });

  it('refuse les fonctions de formule qui peuvent charger une ressource distante', async () => {
    await expect(generateXlsx({
      sheets: [{ name: 'X', rows: [[1]], formulas: [{ cell: 'A2', formula: 'HYPERLINK("https://example.test", "ouvrir")' }] }],
    })).rejects.toThrow('publication_xlsx_external_reference_forbidden');
  });

  it('tronque un nom de feuille > 31 caractères et retire les caractères interdits', async () => {
    const buffer = await generateXlsx({ sheets: [{ name: `${'a'.repeat(40)}/*?:`, rows: [[1]] }] });
    const workbook = await load(buffer);
    expect(workbook.worksheets[0].name.length).toBeLessThanOrEqual(31);
    expect(workbook.worksheets[0].name).not.toMatch(/[\\/*?:[\]]/u);
  });
});
