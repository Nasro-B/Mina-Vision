import { readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createBrowserExecutor } from '../../src/executors/browser-executor.mjs';

const fixtureUrl = new URL('../fixtures/control-page.html', import.meta.url);

describe('browser control integration', () => {
  it('controls a dedicated Chrome profile on a local fixture', async () => {
    const html = await readFile(fixtureUrl);
    const server = createServer((request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(html);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address();
    const profileDir = `G:\\MinaTests\\chrome-${process.pid}`;
    const executor = await createBrowserExecutor({ profileDir });

    try {
      await executor.execute({ name: 'navigate', url: `http://127.0.0.1:${port}/` });
      await executor.execute({ name: 'click', x: 35, y: 20 });
      await expect(executor.currentContext()).resolves.toMatchObject({ url: expect.stringContaining('#clicked') });
      await executor.execute({ name: 'scroll', x: 300, y: 300, scrollX: 0, scrollY: 300 });
      const observation = await executor.observe();
      expect(observation.imageBase64.length).toBeGreaterThan(100);
    } finally {
      await executor.close();
      server.close();
      await rm(profileDir, { recursive: true, force: true });
    }
  }, 60_000);
});
