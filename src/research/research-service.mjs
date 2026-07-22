function fileEvidence(output) {
  if (!output?.path || !output.digest || typeof output.text !== 'string') return [];
  const capturedAt = new Date(Number(output.mtime) || Date.now()).toISOString();
  return [Object.freeze({
    sourceId: `file-${output.digest.slice(0, 20)}`,
    locator: `${output.path}:${output.lineStart ?? 1}-${output.lineEnd ?? 1}`,
    capturedAt,
    contentDigest: `sha256:${output.digest}`,
    freshnessClass: 'current',
    extract: output.text.slice(0, 4_000),
    method: output.method ?? 'file_text',
  })];
}

export function createResearchService({ fileReader, webReader } = {}) {
  if (!fileReader?.read || !webReader?.read) throw new TypeError('research_readers_required');

  async function invoke(reader, input, { localFile = false } = {}) {
    const output = await reader.read(input);
    const { evidence: suppliedEvidence, text: _text, ...result } = output;
    const evidence = suppliedEvidence ?? (localFile ? fileEvidence(output) : []);
    return Object.freeze({ evidence, result });
  }

  return Object.freeze({
    readFile: (input) => invoke(fileReader, input, { localFile: true }),
    readWeb: (input) => invoke(webReader, input),
  });
}
