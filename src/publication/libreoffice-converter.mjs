import { basename, extname, join } from 'node:path';

// Conversion Office → PDF via LibreOffice LOCAL uniquement (jamais un service cloud). Bornée :
// seules les conversions allowlistées vers PDF sont permises ; le binaire n'est pris qu'à un chemin
// configuré ou détecté ; l'invocation est `--headless --safe-mode --norestore` (aucune macro), avec
// timeout et sortie plafonnée. Si LibreOffice est absent, on ÉCHOUE explicitement
// (`libreoffice_unavailable`) plutôt que de simuler un PDF vide.

const ALLOWED = new Map([
  ['.docx', 'pdf'], ['.pptx', 'pdf'], ['.xlsx', 'pdf'],
  ['.odt', 'pdf'], ['.odp', 'pdf'], ['.ods', 'pdf'],
]);

export function createLibreOfficeConverter({
  runProcess, access, readFile, hash, sofficePath = null, timeoutMs = 90_000, maxBytes = 512 * 1024 * 1024,
} = {}) {
  if (typeof runProcess !== 'function' || typeof access !== 'function' || typeof readFile !== 'function' || typeof hash !== 'function') {
    throw new TypeError('libreoffice_converter_dependencies_required');
  }

  async function locate() {
    for (const candidate of [sofficePath].filter(Boolean)) {
      try { await access(candidate); return candidate; } catch { /* essai suivant */ }
    }
    return null;
  }

  return Object.freeze({
    supported: () => Object.fromEntries(ALLOWED),
    async convert({ inputPath, outputFormat, outputDirectory } = {}) {
      if (typeof inputPath !== 'string' || !inputPath) throw new Error('publication_conversion_input_required');
      if (typeof outputDirectory !== 'string' || !outputDirectory) throw new Error('publication_conversion_outdir_required');
      const ext = extname(inputPath).toLowerCase();
      if (ALLOWED.get(ext) !== outputFormat) throw new Error(`publication_conversion_unsupported:${ext}->${outputFormat}`);

      const soffice = await locate();
      if (!soffice) throw new Error('libreoffice_unavailable');

      const result = await runProcess(soffice, [
        '--headless', '--safe-mode', '--norestore',
        '--convert-to', outputFormat, '--outdir', outputDirectory, inputPath,
      ], { timeoutMs });
      if (!result || result.code !== 0) throw new Error('publication_conversion_failed');

      const outPath = join(outputDirectory, `${basename(inputPath, ext)}.${outputFormat}`);
      const bytes = await readFile(outPath);
      if (!bytes || bytes.length === 0) throw new Error('publication_conversion_empty_output');
      if (bytes.length > maxBytes) throw new Error('publication_conversion_output_too_large');
      return Object.freeze({ filePath: outPath, format: outputFormat, bytes: bytes.length, sha256: hash(bytes) });
    },
  });
}
