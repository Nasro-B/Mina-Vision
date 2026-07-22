import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createDesktopClient } from '../src/executors/desktop-client.mjs';

function createFakeWorker() {
  const stdout = new PassThrough();
  const stdin = new PassThrough();
  const requests = [];
  let input = '';

  stdin.on('data', (chunk) => {
    input += chunk.toString('utf8');
    const lines = input.split('\n');
    input = lines.pop();
    for (const line of lines.filter(Boolean)) requests.push(JSON.parse(line));
  });

  return {
    stdout,
    stdin,
    requests,
    killed: false,
    kill() { this.killed = true; },
    reply(response) { stdout.write(`${JSON.stringify(response)}\n`); },
  };
}

describe('createDesktopClient', () => {
  it('correlates worker responses', async () => {
    const worker = createFakeWorker();
    const client = createDesktopClient({ spawnWorker: () => worker });
    const pending = client.execute({ name: 'click', x: 10, y: 20 });
    await new Promise((resolve) => setImmediate(resolve));

    worker.reply({ id: worker.requests[0].id, ok: true, result: { executed: true } });

    await expect(pending).resolves.toEqual({ executed: true });
    client.close();
  });

  it('rejects timed out requests', async () => {
    const worker = createFakeWorker();
    const client = createDesktopClient({ spawnWorker: () => worker, requestTimeoutMs: 5 });

    await expect(client.observe()).rejects.toThrow('Délai dépassé');
    client.close();
  });

  it('aborts pending work before releasing inputs', async () => {
    const worker = createFakeWorker();
    const client = createDesktopClient({ spawnWorker: () => worker });
    const pending = client.execute({ name: 'click', x: 1, y: 2 });
    await new Promise((resolve) => setImmediate(resolve));

    const stopping = client.emergencyStop();
    await expect(pending).rejects.toThrow('Arrêt d’urgence');
    await new Promise((resolve) => setImmediate(resolve));
    const release = worker.requests.find((request) => request.method === 'release_all_inputs');
    worker.reply({ id: release.id, ok: true, result: { released: true } });

    await expect(stopping).resolves.toEqual({ released: true });
    client.close();
  });

  it('delegates virtual cursor preview without sending it to the input worker', async () => {
    const worker = createFakeWorker();
    const previewAction = vi.fn(async () => ({ visible: true }));
    const hideCursor = vi.fn(async () => ({ visible: false }));
    const client = createDesktopClient({ spawnWorker: () => worker, previewAction, hideCursor });

    await expect(client.previewAction({ name: 'click', x: 10, y: 20 }, { environment: 'desktop' }))
      .resolves.toEqual({ visible: true });
    await expect(client.hideCursor()).resolves.toEqual({ visible: false });
    expect(worker.requests).toEqual([]);
    client.close();
  });

  it('accepts a realistic multi-megabyte screenshot response instead of killing the mission', async () => {
    // Regression: observe() returns a full-screen PNG as base64 — 2 to 6 MB on a busy screen.
    // A 1 MB response cap rejected EVERY desktop mission at its first observation with
    // « Réponse worker trop volumineuse » before a single action ran.
    const worker = createFakeWorker();
    const client = createDesktopClient({ spawnWorker: () => worker });
    const pending = client.observe();
    await new Promise((resolve) => setImmediate(resolve));

    const imageBase64 = 'A'.repeat(5_000_000);
    worker.reply({ id: worker.requests[0].id, ok: true, result: { imageBase64, mimeType: 'image/png', width: 1920, height: 1080 } });

    await expect(pending).resolves.toMatchObject({ mimeType: 'image/png', width: 1920 });
    client.close();
  });
});
