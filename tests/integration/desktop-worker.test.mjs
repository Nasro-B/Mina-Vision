import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workerPath = fileURLToPath(new URL('../../src/executors/desktop-worker.mjs', import.meta.url));

async function requestWorker(method, params = {}) {
  const child = spawn(process.execPath, [workerPath], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  let errors = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString('utf8'); });
  child.stderr.on('data', (chunk) => { errors += chunk.toString('utf8'); });
  child.stdin.write(`${JSON.stringify({ id: 'test', method, params })}\n`);
  const exit = once(child, 'exit').then(([code]) => {
    throw new Error(`worker exited ${code}: ${errors}`);
  });

  while (!output.includes('\n')) {
    await Promise.race([
      once(child.stdout, 'data'),
      exit,
    ]);
  }
  child.kill();
  return JSON.parse(output.trim().split('\n')[0]);
}

describe('desktop worker integration', () => {
  it('returns an in-memory desktop PNG without moving input', async () => {
    const response = await requestWorker('observe');

    expect(response.ok).toBe(true);
    expect(response.result.width).toBeGreaterThan(0);
    expect(response.result.height).toBeGreaterThan(0);
    expect(Buffer.from(response.result.imageBase64, 'base64').subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });
});
