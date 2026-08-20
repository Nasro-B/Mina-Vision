const ALLOWED_CONVERSIONS = Object.freeze({
  docx: new Set(['pdf']),
  odt: new Set(['pdf']),
  xlsx: new Set(['pdf']),
  ods: new Set(['pdf']),
  png: new Set(['pdf']),
  jpeg: new Set(['pdf']),
});

const EXPECTED_MEDIA_TYPE = Object.freeze({ pdf: 'application/pdf' });

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MEMORY_LIMIT_MB = 512;
const DEFAULT_MAX_OUTPUT_BYTES = 50 * 1024 * 1024;

export function createDocumentConverter({ sandboxRunner = null, conversionPort = null, fileWriter, clock } = {}) {
  if (!sandboxRunner?.run && !conversionPort?.convert) throw new TypeError('document_converter_sandbox_runner_required');
  if (!fileWriter?.writeAtomic) throw new TypeError('document_converter_file_writer_required');
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('document_converter_clock_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());

  return Object.freeze({
    async convert({ documentId, inputPath, fromFormat, toFormat, destinationPath }) {
      if (!ALLOWED_CONVERSIONS[fromFormat]?.has(toFormat)) {
        throw new Error(`document_conversion_unsupported:${fromFormat}->${toFormat}`);
      }

      const result = conversionPort?.convert
        ? await conversionPort.convert({ inputPath, fromFormat, toFormat })
        : await sandboxRunner.run({
          inputPath, timeoutMs: DEFAULT_TIMEOUT_MS, memoryLimitMb: DEFAULT_MEMORY_LIMIT_MB,
          maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES, networkOff: true,
        });
      if (!result?.outputBytes || !result?.outputDigest || !result?.outputType) {
        throw new Error('document_conversion_result_invalid');
      }
      if (result.outputBytes.length > DEFAULT_MAX_OUTPUT_BYTES) throw new Error('document_conversion_output_too_large');
      const expectedType = EXPECTED_MEDIA_TYPE[toFormat];
      if (expectedType && result.outputType !== expectedType) throw new Error('document_conversion_output_type_mismatch');

      const path = destinationPath ?? `documents/converted/${documentId}.${toFormat}`;
      await fileWriter.writeAtomic({ path, content: result.outputBytes, encoding: null });
      return Object.freeze({
        documentId, path, outputDigest: result.outputDigest, outputType: result.outputType, convertedAt: new Date(now()).toISOString(),
      });
    },
  });
}
