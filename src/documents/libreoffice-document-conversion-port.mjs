import { extname } from 'node:path';

const FORMAT_EXTENSION = Object.freeze({
  docx: '.docx',
  odt: '.odt',
  xlsx: '.xlsx',
  ods: '.ods',
  png: '.png',
  jpeg: '.jpeg',
});

const OUTPUT_TYPE = Object.freeze({ pdf: 'application/pdf' });
const DIGEST_HEX = /^[a-f0-9]{64}$/u;

export function createLibreOfficeDocumentConversionPort({
  libreOfficeConverter, makeTempDir, readFile, removeDir,
} = {}) {
  if (!libreOfficeConverter?.convert || typeof makeTempDir !== 'function'
    || typeof readFile !== 'function' || typeof removeDir !== 'function') {
    throw new TypeError('libreoffice_document_conversion_port_dependencies_required');
  }

  return Object.freeze({
    async convert({ inputPath, fromFormat, toFormat } = {}) {
      const expectedExtension = FORMAT_EXTENSION[fromFormat];
      if (!expectedExtension || extname(String(inputPath ?? '')).toLowerCase() !== expectedExtension) {
        throw new Error('document_conversion_format_mismatch');
      }
      const outputType = OUTPUT_TYPE[toFormat];
      if (!outputType) throw new Error(`document_conversion_unsupported:${fromFormat}->${toFormat}`);

      const outputDirectory = await makeTempDir();
      try {
        const receipt = await libreOfficeConverter.convert({ inputPath, outputFormat: toFormat, outputDirectory });
        const bytes = await readFile(receipt.filePath);
        if (!DIGEST_HEX.test(receipt.sha256 ?? '')) throw new Error('document_conversion_result_invalid');
        return Object.freeze({
          outputBytes: bytes,
          outputDigest: `sha256:${receipt.sha256}`,
          outputType,
        });
      } finally {
        await removeDir(outputDirectory);
      }
    },
  });
}
