import { describe, expect, it, vi } from 'vitest';
import { createDocumentConverter } from '../src/documents/document-converter.mjs';

function fakeSandboxRunner(result) {
  return { run: vi.fn(async () => result) };
}

function fakeFileWriter() {
  const writes = [];
  return { writes, writeAtomic: vi.fn(async ({ path, content }) => { writes.push({ path, content }); return { bytes: content?.length ?? 0 }; }) };
}

const goodResult = Object.freeze({ outputBytes: Buffer.from('%PDF-1.7 mock'), outputDigest: 'sha256:abc', outputType: 'application/pdf' });

describe('createDocumentConverter: constructor guards', () => {
  it('requires a sandboxRunner', () => {
    expect(() => createDocumentConverter({ fileWriter: fakeFileWriter(), clock: () => 0 })).toThrow('document_converter_sandbox_runner_required');
  });
});

describe('createDocumentConverter.convert: allowlisted conversions only', () => {
  it('rejects an unsupported conversion pair without ever invoking the sandbox', async () => {
    const sandboxRunner = fakeSandboxRunner(goodResult);
    const converter = createDocumentConverter({ sandboxRunner, fileWriter: fakeFileWriter(), clock: () => 0 });
    await expect(converter.convert({ documentId: 'd1', inputPath: 'in.exe', fromFormat: 'exe', toFormat: 'pdf' }))
      .rejects.toThrow('document_conversion_unsupported:exe->pdf');
    expect(sandboxRunner.run).not.toHaveBeenCalled();
  });

  it('converts a docx to pdf and writes the validated output', async () => {
    const sandboxRunner = fakeSandboxRunner(goodResult);
    const fileWriter = fakeFileWriter();
    const converter = createDocumentConverter({ sandboxRunner, fileWriter, clock: () => 1_700_000_000_000 });
    const result = await converter.convert({ documentId: 'd1', inputPath: 'in.docx', fromFormat: 'docx', toFormat: 'pdf' });
    expect(result).toMatchObject({ documentId: 'd1', outputDigest: 'sha256:abc', outputType: 'application/pdf' });
    expect(fileWriter.writes[0].path).toBe('documents/converted/d1.pdf');
  });

  it('converts through a real conversion port before writing the validated output', async () => {
    const outputBytes = Buffer.from('%PDF-1.7 from port');
    const outputDigest = `sha256:${'c'.repeat(64)}`;
    const conversionPort = {
      convert: vi.fn(async () => ({ outputBytes, outputDigest, outputType: 'application/pdf' })),
    };
    const fileWriter = fakeFileWriter();
    const converter = createDocumentConverter({ conversionPort, fileWriter, clock: () => 1_700_000_000_000 });
    const result = await converter.convert({ documentId: 'd1', inputPath: 'in.docx', fromFormat: 'docx', toFormat: 'pdf' });

    expect(result).toMatchObject({ documentId: 'd1', outputDigest, outputType: 'application/pdf' });
    expect(conversionPort.convert).toHaveBeenCalledWith({ inputPath: 'in.docx', fromFormat: 'docx', toFormat: 'pdf' });
    expect(fileWriter.writes[0]).toEqual({ path: 'documents/converted/d1.pdf', content: outputBytes });
  });
});

describe('createDocumentConverter.convert: sandbox invocation is bounded (one input, network off, limits)', () => {
  it('always requests networkOff:true and explicit timeout/memory/output limits', async () => {
    const sandboxRunner = fakeSandboxRunner(goodResult);
    const converter = createDocumentConverter({ sandboxRunner, fileWriter: fakeFileWriter(), clock: () => 0 });
    await converter.convert({ documentId: 'd1', inputPath: 'in.docx', fromFormat: 'docx', toFormat: 'pdf' });
    expect(sandboxRunner.run).toHaveBeenCalledWith(expect.objectContaining({
      inputPath: 'in.docx', networkOff: true, timeoutMs: expect.any(Number), memoryLimitMb: expect.any(Number), maxOutputBytes: expect.any(Number),
    }));
  });
});

describe('createDocumentConverter.convert: promote only after digest/type validation', () => {
  it('rejects a sandbox result missing outputDigest, never writing anything', async () => {
    const sandboxRunner = fakeSandboxRunner({ outputBytes: Buffer.from('x'), outputType: 'application/pdf' });
    const fileWriter = fakeFileWriter();
    const converter = createDocumentConverter({ sandboxRunner, fileWriter, clock: () => 0 });
    await expect(converter.convert({ documentId: 'd1', inputPath: 'in.docx', fromFormat: 'docx', toFormat: 'pdf' })).rejects.toThrow('document_conversion_result_invalid');
    expect(fileWriter.writeAtomic).not.toHaveBeenCalled();
  });

  it('rejects an output whose real type does not match the requested toFormat', async () => {
    const sandboxRunner = fakeSandboxRunner({ outputBytes: Buffer.from('x'), outputDigest: 'sha256:abc', outputType: 'application/zip' });
    const converter = createDocumentConverter({ sandboxRunner, fileWriter: fakeFileWriter(), clock: () => 0 });
    await expect(converter.convert({ documentId: 'd1', inputPath: 'in.docx', fromFormat: 'docx', toFormat: 'pdf' })).rejects.toThrow('document_conversion_output_type_mismatch');
  });

  it('rejects an output exceeding the max output byte limit', async () => {
    const sandboxRunner = fakeSandboxRunner({ outputBytes: Buffer.alloc(60 * 1024 * 1024), outputDigest: 'sha256:abc', outputType: 'application/pdf' });
    const converter = createDocumentConverter({ sandboxRunner, fileWriter: fakeFileWriter(), clock: () => 0 });
    await expect(converter.convert({ documentId: 'd1', inputPath: 'in.docx', fromFormat: 'docx', toFormat: 'pdf' })).rejects.toThrow('document_conversion_output_too_large');
  });
});
