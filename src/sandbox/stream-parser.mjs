const TYPES = new Set(['started', 'stdout', 'stderr', 'usage', 'artifact', 'completed', 'failed']);
const TERMINAL = new Set(['completed', 'failed']);
const ANSI = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/gu;

function cleanText(value, name) {
  if (typeof value !== 'string') throw new TypeError(`sandbox_stream_${name}_invalid`);
  return value.replace(ANSI, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '');
}

function validate(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event) || !TYPES.has(event.type)) {
    throw new Error(`sandbox_stream_event_unknown:${event?.type ?? 'invalid'}`);
  }
  if (event.type === 'started' && (typeof event.jobId !== 'string' || !Number.isFinite(Date.parse(event.at)))) throw new TypeError('sandbox_stream_started_invalid');
  if (['stdout', 'stderr'].includes(event.type)) return Object.freeze({ type: event.type, text: cleanText(event.text, 'text') });
  if (event.type === 'usage' && (!Number.isFinite(event.cpuMs) || event.cpuMs < 0 || !Number.isFinite(event.memoryPeakMiB) || event.memoryPeakMiB < 0)) {
    throw new TypeError('sandbox_stream_usage_invalid');
  }
  if (event.type === 'completed' && !Number.isSafeInteger(event.exitCode)) throw new TypeError('sandbox_stream_completed_invalid');
  if (event.type === 'failed') return Object.freeze({ type: 'failed', category: cleanText(event.category, 'category'), message: cleanText(event.message, 'message') });
  return Object.freeze({ ...event });
}

export function createSandboxStreamParser({ maxOutputBytes, onEvent = () => {} } = {}) {
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || typeof onEvent !== 'function') throw new TypeError('sandbox_stream_dependencies_required');
  let buffered = Buffer.alloc(0);
  let outputBytes = 0;
  let terminal = false;
  let ended = false;

  function parseLine(bytes) {
    if (bytes.byteLength > 64 * 1024) throw new Error('sandbox_stream_line_too_large');
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (error) {
      throw new Error('sandbox_stream_invalid_utf8', { cause: error });
    }
    let raw;
    try { raw = JSON.parse(text); } catch (error) { throw new Error('sandbox_stream_json_invalid', { cause: error }); }
    if (terminal) throw new Error('sandbox_stream_after_terminal');
    const event = validate(raw);
    if (['stdout', 'stderr'].includes(event.type)) {
      outputBytes += Buffer.byteLength(event.text, 'utf8');
      if (outputBytes > maxOutputBytes) throw new Error('sandbox_stream_output_exceeded');
    }
    if (TERMINAL.has(event.type)) terminal = true;
    onEvent(event);
  }

  function push(chunk) {
    if (ended) throw new Error('sandbox_stream_ended');
    const bytes = Buffer.from(chunk ?? []);
    buffered = Buffer.concat([buffered, bytes]);
    let newline;
    while ((newline = buffered.indexOf(0x0a)) >= 0) {
      let line = buffered.subarray(0, newline);
      buffered = buffered.subarray(newline + 1);
      if (line.at(-1) === 0x0d) line = line.subarray(0, -1);
      if (line.length) parseLine(line);
    }
    if (buffered.byteLength > 64 * 1024) throw new Error('sandbox_stream_line_too_large');
  }

  function end() {
    if (ended) return;
    if (buffered.length) parseLine(buffered);
    buffered = Buffer.alloc(0);
    ended = true;
    if (!terminal) throw new Error('sandbox_stream_terminal_missing');
  }

  return Object.freeze({ push, end });
}
