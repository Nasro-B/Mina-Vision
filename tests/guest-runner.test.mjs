import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runGuestJob } from '../src/sandbox/guest-runner.mjs';

let root;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'mina-guest-runner-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function fixture({ outputBytes = 1024 } = {}) {
  const sourceRoot = join(root, 'src');
  const outRoot = join(root, 'out');
  const runtimeRoot = join(root, 'runtime');
  await Promise.all([mkdir(sourceRoot), mkdir(outRoot), mkdir(runtimeRoot)]);
  const source = Buffer.from('print("ok")\n');
  const runtime = Buffer.from('fake-runtime');
  await Promise.all([
    writeFile(join(sourceRoot, 'main.py'), source),
    writeFile(join(runtimeRoot, 'python.exe'), runtime),
  ]);
  const job = {
    jobId: 'job-1', language: 'python', entrypoint: 'main.py', args: [], network: false,
    sourceDigest: `sha256:${'a'.repeat(64)}`, exports: [],
    sourceFiles: [{ path: 'main.py', digest: `sha256:${digest(source)}`, mode: 'read-only' }],
    limits: { wallMs: 5_000, memoryMiB: 256, outputBytes },
  };
  const manifest = { runtimes: [{ language: 'python', path: 'python.exe', sha256: digest(runtime) }] };
  await Promise.all([
    writeFile(join(sourceRoot, 'job.json'), JSON.stringify(job)),
    writeFile(join(runtimeRoot, 'runtime-manifest.json'), JSON.stringify(manifest)),
  ]);
  return { sourceRoot, outRoot, runtimeRoot };
}

function successfulChild(text = 'MINA_OK') {
  const child = new EventEmitter();
  child.pid = 42;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  queueMicrotask(() => {
    child.stdout.end(`${text}\n`);
    child.stderr.end();
    child.emit('close', 0);
  });
  return child;
}

describe('guest sandbox runner', () => {
  it('verifies source/runtime digests, streams output, and writes a terminal receipt', async () => {
    const paths = await fixture();
    const spawnChild = vi.fn(() => successfulChild());

    const receipt = await runGuestJob({ ...paths, spawnChild, memoryProbe: async () => 10 });

    expect(receipt).toMatchObject({ schemaVersion: 1, jobId: 'job-1', exitCode: 0 });
    const events = (await readFile(join(paths.outRoot, 'events.jsonl'), 'utf8')).trim().split(/\r?\n/u).map(JSON.parse);
    expect(events.map(({ type }) => type)).toEqual(['started', 'stdout', 'usage', 'completed']);
    expect(events[1].text).toContain('MINA_OK');
    expect(JSON.parse(await readFile(join(paths.outRoot, 'guest-receipt.json'), 'utf8'))).toMatchObject({ exitCode: 0 });
  });

  it('kills a process whose streamed output exceeds the declared bound and still writes a failed receipt', async () => {
    const paths = await fixture({ outputBytes: 4 });
    let child;
    const receipt = await runGuestJob({
      ...paths,
      spawnChild: () => { child = successfulChild('TOO_LONG'); return child; },
      memoryProbe: async () => 10,
    });

    expect(receipt.exitCode).toBe(1);
    expect(child.kill).toHaveBeenCalled();
    const events = await readFile(join(paths.outRoot, 'events.jsonl'), 'utf8');
    expect(events).toContain('sandbox_output_limit_exceeded');
  });
});
