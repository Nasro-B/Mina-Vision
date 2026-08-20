import { describe, expect, it, vi } from 'vitest';

describe('createLibreOfficeDocumentConversionPort', () => {
  it('wraps LibreOffice output as a document converter result and removes the temporary output directory', async () => {
    const { createLibreOfficeDocumentConversionPort } = await import('../src/documents/libreoffice-document-conversion-port.mjs');
    const outputBytes = Buffer.from('%PDF-1.7 converted');
    const digestHex = 'a'.repeat(64);
    const libreOfficeConverter = {
      convert: vi.fn(async () => ({ filePath: 'C:\\Temp\\mina-doc\\source.pdf', format: 'pdf', bytes: outputBytes.length, sha256: digestHex })),
    };
    const removeDir = vi.fn(async () => {});
    const port = createLibreOfficeDocumentConversionPort({
      libreOfficeConverter,
      makeTempDir: vi.fn(async () => 'C:\\Temp\\mina-doc'),
      readFile: vi.fn(async () => outputBytes),
      removeDir,
    });

    await expect(port.convert({ inputPath: 'C:\\Docs\\source.docx', fromFormat: 'docx', toFormat: 'pdf' }))
      .resolves.toEqual({ outputBytes, outputDigest: `sha256:${digestHex}`, outputType: 'application/pdf' });
    expect(libreOfficeConverter.convert).toHaveBeenCalledWith({
      inputPath: 'C:\\Docs\\source.docx',
      outputFormat: 'pdf',
      outputDirectory: 'C:\\Temp\\mina-doc',
    });
    expect(removeDir).toHaveBeenCalledWith('C:\\Temp\\mina-doc');
  });

  it('rejects mismatched source format before invoking LibreOffice', async () => {
    const { createLibreOfficeDocumentConversionPort } = await import('../src/documents/libreoffice-document-conversion-port.mjs');
    const libreOfficeConverter = { convert: vi.fn() };
    const port = createLibreOfficeDocumentConversionPort({
      libreOfficeConverter,
      makeTempDir: vi.fn(async () => 'C:\\Temp\\mina-doc'),
      readFile: vi.fn(),
      removeDir: vi.fn(),
    });

    await expect(port.convert({ inputPath: 'C:\\Docs\\source.xlsx', fromFormat: 'docx', toFormat: 'pdf' }))
      .rejects.toThrow('document_conversion_format_mismatch');
    expect(libreOfficeConverter.convert).not.toHaveBeenCalled();
  });
});
