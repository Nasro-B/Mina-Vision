import { describe, expect, it } from 'vitest';
import { createSandboxStreamParser } from '../src/sandbox/stream-parser.mjs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

describe('bounded sandbox JSONL stream', () => {
  it('parses partial UTF-8 chunks and emits only known frozen events', () => {
    const events = [];
    const parser = createSandboxStreamParser({ maxOutputBytes: 1024, onEvent: (event) => events.push(event) });
    const bytes = Buffer.from([
      JSON.stringify({ type: 'started', jobId: 'job-1', at: '2026-07-15T08:00:00.000Z' }),
      JSON.stringify({ type: 'stdout', text: 'Bonjou😀r' }),
      JSON.stringify({ type: 'usage', cpuMs: 12, memoryPeakMiB: 20 }),
      JSON.stringify({ type: 'completed', exitCode: 0 }),
      '',
    ].join('\n'));
    parser.push(bytes.subarray(0, 91));
    parser.push(bytes.subarray(91, 103));
    parser.push(bytes.subarray(103));
    parser.end();

    expect(events.map(({ type }) => type)).toEqual(['started', 'stdout', 'usage', 'completed']);
    expect(events[1].text).toBe('Bonjou😀r');
    expect(events.every(Object.isFrozen)).toBe(true);
  });

  it('rejects invalid UTF-8, oversized lines, output spam and unknown events', () => {
    expect(() => {
      const parser = createSandboxStreamParser({ maxOutputBytes: 100 });
      parser.push(Buffer.from([0xff, 0x0a]));
    }).toThrow('sandbox_stream_invalid_utf8');
    expect(() => {
      const parser = createSandboxStreamParser({ maxOutputBytes: 100_000 });
      parser.push(Buffer.from(`${'x'.repeat(64 * 1024 + 1)}\n`));
    }).toThrow('sandbox_stream_line_too_large');
    expect(() => {
      const parser = createSandboxStreamParser({ maxOutputBytes: 3 });
      parser.push(Buffer.from(`${JSON.stringify({ type: 'stdout', text: '1234' })}\n`));
    }).toThrow('sandbox_stream_output_exceeded');
    expect(() => {
      const parser = createSandboxStreamParser({ maxOutputBytes: 100 });
      parser.push(Buffer.from(`${JSON.stringify({ type: 'host_command', command: 'calc.exe' })}\n`));
    }).toThrow('sandbox_stream_event_unknown:host_command');
  });

  it('strips ANSI/control sequences and rejects data after a terminal event', () => {
    const events = [];
    const parser = createSandboxStreamParser({ maxOutputBytes: 1024, onEvent: (event) => events.push(event) });
    parser.push(Buffer.from(`${JSON.stringify({ type: 'stderr', text: '\u001b[31mERREUR\u001b[0m\u0000' })}\n`));
    expect(events[0].text).toBe('ERREUR');
    parser.push(Buffer.from(`${JSON.stringify({ type: 'failed', category: 'runtime', message: 'échec' })}\n`));
    expect(() => parser.push(Buffer.from(`${JSON.stringify({ type: 'stdout', text: 'late' })}\n`)))
      .toThrow('sandbox_stream_after_terminal');
  });
});

describe('fixed guest bootstrap', () => {
  it('verifies inputs and runtimes, enforces bounds, kills process trees and leaves signing to the host', async () => {
    const filename = fileURLToPath(new URL('../sandbox/bootstrap/mina-runner.ps1', import.meta.url));
    const script = await readFile(filename, 'utf8');

    expect(script).toContain('Get-FileHash');
    expect(script).toContain('runtime-manifest.json');
    expect(script).toContain('outputBytes');
    expect(script).toContain('memoryMiB');
    expect(script).toContain('wallMs');
    expect(script).toContain('taskkill.exe');
    expect(script).toContain("signatureState = 'awaiting_host_signature'");
    expect(script).not.toMatch(/Invoke-Expression|Start-Process|DownloadString|Invoke-WebRequest|curl\.exe/iu);
  });
});
