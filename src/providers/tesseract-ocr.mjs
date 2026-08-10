import { spawn } from 'node:child_process';

const MAX_INPUT_BYTES = 25 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_BLOCKS = 10_000;
const MAX_TEXT_LENGTH = 100_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const LANGUAGE_NAME = /^[A-Za-z0-9_]{1,32}$/u;
const IMAGE_MIME = /^image\/(?:png|jpeg|webp)$/u;

const defaultExecutablePath = process.platform === 'win32'
  ? 'C:\\Program Files\\Tesseract-OCR\\tesseract.exe'
  : 'tesseract';

function abortReason(signal) {
  return signal?.reason ?? new Error('tesseract_ocr_aborted');
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortReason(signal);
}

function clearChunk(chunk) {
  try { chunk.fill?.(0); } catch {}
}

function clearChunks(chunks) {
  chunks.forEach(clearChunk);
  chunks.length = 0;
}

export function createTesseractProcessRunner({ spawnProcess = spawn } = {}) {
  if (typeof spawnProcess !== 'function') throw new TypeError('tesseract_ocr_spawn_required');

  return function runTesseract({ executablePath, args, input = null, timeoutMs = DEFAULT_TIMEOUT_MS, signal } = {}) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortReason(signal));
        return;
      }
      let child;
      try {
        child = spawnProcess(executablePath, args, {
          shell: false,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } catch {
        reject(new Error('tesseract_spawn_failed'));
        return;
      }
      let done = false;
      let timer = null;
      let abort = null;
      let stdoutSize = 0;
      let stderrSize = 0;
      const stdout = [];
      const stderr = [];
      let onChildError = null;
      let onStdout = null;
      let onStderr = null;
      let onClose = null;
      let onStdinError = null;
      let stdinErrorListenerReleased = false;
      let releaseStdinErrorListener = null;
      const terminate = () => {
        try { child.kill(); } catch {}
      };
      const cleanup = () => {
        if (timer !== null) clearTimeout(timer);
        if (abort) signal?.removeEventListener?.('abort', abort);
        if (onChildError) child.removeListener?.('error', onChildError);
        if (onStdout) child.stdout?.removeListener?.('data', onStdout);
        if (onStderr) child.stderr?.removeListener?.('data', onStderr);
        if (onClose) child.removeListener?.('close', onClose);
        clearChunks(stdout);
        clearChunks(stderr);
      };
      const finish = (callback) => {
        if (done) return;
        done = true;
        cleanup();
        callback();
      };
      const fail = (error) => finish(() => reject(error));
      abort = () => {
        fail(abortReason(signal));
        terminate();
      };
      timer = setTimeout(() => {
        fail(new Error('tesseract_timeout'));
        terminate();
      }, timeoutMs);
      signal?.addEventListener?.('abort', abort, { once: true });
      if (signal?.aborted) {
        abort();
        return;
      }
      onChildError = () => fail(new Error('tesseract_spawn_failed'));
      onStdout = (chunk) => {
        stdoutSize += chunk.length;
        if (stdoutSize > MAX_OUTPUT_BYTES) {
          clearChunk(chunk);
          fail(new Error('tesseract_output_too_large'));
          terminate();
          return;
        }
        stdout.push(chunk);
      };
      onStderr = (chunk) => {
        if (stderrSize >= 32_768) {
          clearChunk(chunk);
          return;
        }
        const kept = Buffer.from(chunk.subarray(0, 32_768 - stderrSize));
        clearChunk(chunk);
        stderrSize += kept.length;
        stderr.push(kept);
      };
      onClose = (code) => {
        const result = {
          code,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
        };
        finish(() => resolve(result));
      };
      onStdinError = () => {
        if (done) return;
        fail(new Error('tesseract_stdin_failed'));
        terminate();
      };
      releaseStdinErrorListener = () => {
        if (stdinErrorListenerReleased) return;
        stdinErrorListenerReleased = true;
        child.stdin?.removeListener?.('error', onStdinError);
        child.stdin?.removeListener?.('close', releaseStdinErrorListener);
        child.removeListener?.('close', releaseStdinErrorListener);
      };
      child.once('error', onChildError);
      child.stdout.on('data', onStdout);
      child.stderr.on('data', onStderr);
      child.once('close', onClose);
      child.stdin.on('error', onStdinError);
      child.stdin.once('close', releaseStdinErrorListener);
      child.once('close', releaseStdinErrorListener);
      try {
        child.stdin.end(input ?? undefined);
      } catch {
        fail(new Error('tesseract_stdin_failed'));
        terminate();
      }
    });
  };
}

const defaultRunner = createTesseractProcessRunner();

function parseInstalledLanguages(output) {
  return new Set(String(output ?? '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((language) => LANGUAGE_NAME.test(language)));
}

function parseNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseTsv(output) {
  const rows = String(output ?? '').split(/\r?\n/u).filter(Boolean);
  if (rows.length === 0) return Object.freeze({ text: '', blocks: Object.freeze([]) });
  const header = rows.shift().split('\t');
  const field = Object.fromEntries(header.map((name, index) => [name, index]));
  const required = ['level', 'page_num', 'block_num', 'par_num', 'line_num', 'word_num', 'left', 'top', 'width', 'height', 'conf', 'text'];
  if (!required.every((name) => Number.isInteger(field[name]))) throw new Error('tesseract_ocr_result_invalid');

  const lines = new Map();
  for (const row of rows) {
    const columns = row.split('\t');
    if (columns[field.level] !== '5') continue;
    const text = columns.slice(field.text).join('\t').replace(/\s+/gu, ' ').trim();
    if (!text) continue;
    const left = parseNumber(columns[field.left]);
    const top = parseNumber(columns[field.top]);
    const width = parseNumber(columns[field.width]);
    const height = parseNumber(columns[field.height]);
    if (left === null || top === null || width === null || height === null || width < 0 || height < 0) continue;
    const key = ['page_num', 'block_num', 'par_num', 'line_num'].map((name) => columns[field[name]]).join(':');
    const current = lines.get(key) ?? { words: [], index: lines.size };
    current.words.push({
      text,
      order: parseNumber(columns[field.word_num]) ?? current.words.length,
      left,
      top,
      right: left + width,
      bottom: top + height,
      confidence: parseNumber(columns[field.conf]),
    });
    lines.set(key, current);
  }

  if (lines.size > MAX_BLOCKS) throw new Error('tesseract_ocr_result_invalid');
  const blocks = [...lines.values()].map((line) => {
    const words = line.words.sort((left, right) => left.order - right.order);
    const confidenceValues = words.map((word) => word.confidence).filter((value) => value !== null && value >= 0);
    return Object.freeze({
      text: words.map((word) => word.text).join(' '),
      box: Object.freeze([
        Math.min(...words.map((word) => word.left)),
        Math.min(...words.map((word) => word.top)),
        Math.max(...words.map((word) => word.right)),
        Math.max(...words.map((word) => word.bottom)),
      ]),
      confidence: confidenceValues.length === 0
        ? 0
        : confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length / 100,
    });
  });
  const text = blocks.map((block) => block.text).join('\n');
  if (text.length > MAX_TEXT_LENGTH || !blocks.every((block) => block.text.length <= 10_000)) {
    throw new Error('tesseract_ocr_result_invalid');
  }
  return Object.freeze({ text, blocks: Object.freeze(blocks) });
}

export function createTesseractOcrProvider({
  executablePath = defaultExecutablePath,
  languagePreference = ['fra', 'eng'],
  runner = defaultRunner,
  clock = performance.now.bind(performance),
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const preferredLanguages = [...new Set(languagePreference.map((language) => String(language).trim()))];
  if (typeof executablePath !== 'string' || executablePath.length === 0 || typeof runner !== 'function'
    || typeof clock !== 'function' || !preferredLanguages.every((language) => LANGUAGE_NAME.test(language))
    || !Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) {
    throw new TypeError('tesseract_ocr_configuration_invalid');
  }
  let installedLanguages = null;

  async function availableLanguages(signal) {
    if (installedLanguages) return installedLanguages;
    throwIfAborted(signal);
    let result;
    try {
      result = await runner({ executablePath, args: ['--list-langs'], timeoutMs, signal });
    } catch {
      if (signal?.aborted) throw abortReason(signal);
      throw new Error('tesseract_unavailable');
    }
    throwIfAborted(signal);
    if (result?.code !== 0) throw new Error('tesseract_unavailable');
    installedLanguages = parseInstalledLanguages(result.stdout);
    return installedLanguages;
  }

  async function recognize({ image, mimeType, signal } = {}) {
    throwIfAborted(signal);
    if ((!Buffer.isBuffer(image) && !(image instanceof Uint8Array)) || image.length === 0
      || image.length > MAX_INPUT_BYTES || !IMAGE_MIME.test(mimeType ?? '')) {
      throw new TypeError('tesseract_ocr_input_invalid');
    }
    const languages = await availableLanguages(signal);
    const language = preferredLanguages.find((candidate) => languages.has(candidate));
    if (!language) throw new Error('tesseract_language_unavailable');
    const bytes = Buffer.from(image);
    const started = Number(clock());
    try {
      let result;
      try {
        result = await runner({
          executablePath,
          args: ['stdin', 'stdout', '-l', language, 'tsv'],
          input: bytes,
          timeoutMs,
          signal,
        });
      } catch {
        if (signal?.aborted) throw abortReason(signal);
        throw new Error('tesseract_ocr_failed');
      }
      throwIfAborted(signal);
      if (result?.code !== 0) throw new Error('tesseract_ocr_failed');
      const parsed = parseTsv(result.stdout);
      return Object.freeze({
        ...parsed,
        modelId: `tesseract:${language}`,
        usage: Object.freeze({
          inputImages: 1,
          localComputeMs: Math.max(0, Number(clock()) - started),
        }),
      });
    } finally {
      clearChunk(bytes);
    }
  }

  return Object.freeze({
    id: 'tesseract-ocr',
    locality: 'local',
    network: 'none',
    capabilities: Object.freeze(['ocr.extract']),
    recognize,
    invoke: recognize,
  });
}
