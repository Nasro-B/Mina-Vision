import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createLibreOfficeConverter } from '../src/publication/libreoffice-converter.mjs';

const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');

describe('libreoffice-converter', () => {
  it('échoue explicitement si LibreOffice est absent (jamais un faux PDF)', async () => {
    const converter = createLibreOfficeConverter({
      runProcess: vi.fn(), access: async () => { throw new Error('nope'); }, readFile: vi.fn(), hash,
    });
    await expect(converter.convert({ inputPath: 'x.docx', outputFormat: 'pdf', outputDirectory: 'out' }))
      .rejects.toThrow('libreoffice_unavailable');
  });

  it('refuse une conversion hors allowlist', async () => {
    const converter = createLibreOfficeConverter({ runProcess: vi.fn(), access: async () => {}, readFile: vi.fn(), hash, sofficePath: 'soffice' });
    await expect(converter.convert({ inputPath: 'x.docx', outputFormat: 'docx', outputDirectory: 'out' }))
      .rejects.toThrow('publication_conversion_unsupported');
    await expect(converter.convert({ inputPath: 'x.txt', outputFormat: 'pdf', outputDirectory: 'out' }))
      .rejects.toThrow('publication_conversion_unsupported');
  });

  it('convertit docx→pdf via soffice borné (--headless --safe-mode) et rend un reçu hashé', async () => {
    const pdfBytes = Buffer.from('%PDF-1.4 contenu simulé');
    const runProcess = vi.fn(async (_bin, args) => {
      expect(args).toEqual(expect.arrayContaining(['--headless', '--safe-mode', '--norestore', '--convert-to', 'pdf', '--outdir']));
      return { code: 0 };
    });
    const converter = createLibreOfficeConverter({
      runProcess, access: async () => {}, readFile: async () => pdfBytes, hash, sofficePath: '/usr/bin/soffice',
    });
    const receipt = await converter.convert({ inputPath: 'dir/rapport.docx', outputFormat: 'pdf', outputDirectory: 'out' });
    expect(receipt.format).toBe('pdf');
    expect(receipt.sha256).toBe(hash(pdfBytes));
    expect(receipt.filePath).toContain('rapport.pdf');
    expect(runProcess).toHaveBeenCalledOnce();
  });

  it('exige ses dépendances', () => {
    expect(() => createLibreOfficeConverter({})).toThrow('libreoffice_converter_dependencies_required');
  });
});
