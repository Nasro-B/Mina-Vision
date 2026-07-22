import { describe, expect, it } from 'vitest';
import { createOAuthLoopbackServer } from '../src/mail/oauth/oauth-loopback-server.mjs';

async function fetchLocal(port, pathAndQuery) {
  const response = await fetch(`http://127.0.0.1:${port}${pathAndQuery}`);
  return { status: response.status, text: await response.text() };
}

describe('createOAuthLoopbackServer: constructor guards', () => {
  it('requires an expectedState', () => {
    expect(() => createOAuthLoopbackServer({})).toThrow('oauth_loopback_state_required');
  });
});

describe('createOAuthLoopbackServer: captures the redirect and resolves waitForCode', () => {
  it('resolves with the code once Google redirects back with a matching state', async () => {
    const server = createOAuthLoopbackServer({ expectedState: 'state-123' });
    const { port } = await server.start();
    expect(port).toBeGreaterThan(0);

    const waiting = server.waitForCode();
    const response = await fetchLocal(port, '/oauth/callback?code=abc123&state=state-123');
    expect(response.status).toBe(200);
    expect(response.text).toContain('Mina Vision');

    const result = await waiting;
    expect(result).toEqual({ code: 'abc123', state: 'state-123' });
    await server.stop();
  });

  it('rejects waitForCode when the state does not match (CSRF protection)', async () => {
    const server = createOAuthLoopbackServer({ expectedState: 'state-123' });
    const { port } = await server.start();
    const waiting = server.waitForCode();
    const response = await fetchLocal(port, '/oauth/callback?code=abc123&state=wrong-state');
    expect(response.status).toBe(400);
    await expect(waiting).rejects.toThrow('oauth_loopback_state_mismatch');
    await server.stop();
  });

  it('rejects waitForCode when Google reports an error (e.g. access_denied)', async () => {
    const server = createOAuthLoopbackServer({ expectedState: 'state-123' });
    const { port } = await server.start();
    const waiting = server.waitForCode();
    const response = await fetchLocal(port, '/oauth/callback?error=access_denied&state=state-123');
    expect(response.status).toBe(200);
    await expect(waiting).rejects.toThrow('oauth_loopback_denied:access_denied');
    await server.stop();
  });

  it('times out waitForCode if nothing calls back within timeoutMs', async () => {
    const server = createOAuthLoopbackServer({ expectedState: 'state-123', timeoutMs: 50 });
    await server.start();
    await expect(server.waitForCode()).rejects.toThrow('oauth_loopback_timeout');
    await server.stop();
  });

  it('ignores a request to an unrelated path without resolving or crashing', async () => {
    const server = createOAuthLoopbackServer({ expectedState: 'state-123', timeoutMs: 200 });
    const { port } = await server.start();
    const waiting = server.waitForCode();
    const response = await fetchLocal(port, '/favicon.ico');
    expect(response.status).toBe(404);
    await expect(waiting).rejects.toThrow('oauth_loopback_timeout');
    await server.stop();
  });

  it('stop() is idempotent and safe to call twice', async () => {
    const server = createOAuthLoopbackServer({ expectedState: 'state-123' });
    await server.start();
    await server.stop();
    await expect(server.stop()).resolves.toBeUndefined();
  });
});
