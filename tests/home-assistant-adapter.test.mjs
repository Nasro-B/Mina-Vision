import { describe, expect, it, vi } from 'vitest';
import { createHomeAssistantConnector } from '../src/home/adapters/home-assistant.mjs';

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const BINDING = Object.freeze({ entityId: 'light.chambre', domain: 'light' });

function harness(overrides = {}) {
  const fetchImpl = vi.fn(async () => jsonResponse({ message: 'API running.' }));
  const connector = createHomeAssistantConnector({
    baseUrl: 'https://ha.local:8123', token: 'secret-long-lived-token', fetchImpl, ...overrides,
  });
  return { connector, fetchImpl };
}

describe('Home Assistant connector: explicit local configuration only', () => {
  it('rejects a non-HTTPS, non-local base URL instead of ever scanning the LAN', () => {
    expect(() => createHomeAssistantConnector({ baseUrl: 'http://ha.local:8123', token: 't', fetchImpl: vi.fn() }))
      .toThrow('home_assistant_base_url_invalid');
  });

  it('accepts an explicit https local base URL and token', () => {
    expect(() => createHomeAssistantConnector({ baseUrl: 'https://ha.local:8123', token: 'secret', fetchImpl: vi.fn() })).not.toThrow();
  });
});

describe('Home Assistant connector: bearer auth on every request', () => {
  it('sends the configured token as a bearer header on health checks', async () => {
    const { connector, fetchImpl } = harness();
    const health = await connector.health();
    expect(health.available).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith('https://ha.local:8123/api/', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer secret-long-lived-token' }),
    }));
  });

  it('reports unavailable, never throwing, when authentication fails', async () => {
    const { connector } = harness({ fetchImpl: vi.fn(async () => jsonResponse({ message: 'Unauthorized' }, 401)) });
    await expect(connector.health()).resolves.toEqual({ available: false });
  });
});

describe('Home Assistant connector: entity discovery', () => {
  it('lists entities from /api/states for the discovery flow', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([
      { entity_id: 'light.chambre', state: 'off', attributes: { friendly_name: 'Chambre' } },
      { entity_id: 'sensor.temp', state: '21.5', attributes: {} },
    ]));
    const { connector } = harness({ fetchImpl });
    const entities = await connector.discoverEntities();
    expect(entities).toEqual([{ entityId: 'light.chambre', domain: 'light', friendlyName: 'Chambre', state: 'off' }]);
  });
});

describe('Home Assistant connector: mapped service calls and state reread', () => {
  it('calls light.turn_on and rereads state after an accepted command', async () => {
    const fetchImpl = vi.fn(async (url) => (
      String(url).includes('/api/services/') ? jsonResponse([{}]) : jsonResponse({ entity_id: 'light.chambre', state: 'on', attributes: {} })
    ));
    const { connector } = harness({ fetchImpl });

    const accepted = await connector.execute(BINDING, { action: 'turn_on', desiredState: { on: true } });
    expect(accepted).toEqual({ accepted: true });
    expect(fetchImpl).toHaveBeenCalledWith('https://ha.local:8123/api/services/light/turn_on', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ entity_id: 'light.chambre' }),
    }));

    const state = await connector.readState(BINDING);
    expect(state).toEqual({ on: true });
  });

  it('maps set_brightness to light.turn_on with a brightness_pct payload', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([{}]));
    const { connector } = harness({ fetchImpl });
    await connector.execute(BINDING, { action: 'set_brightness', desiredState: { brightness: 60 } });
    expect(fetchImpl).toHaveBeenCalledWith('https://ha.local:8123/api/services/light/turn_on', expect.objectContaining({
      body: JSON.stringify({ entity_id: 'light.chambre', brightness_pct: 60 }),
    }));
  });

  it('rejects an action with no allowlisted domain/service mapping', async () => {
    const { connector } = harness();
    await expect(connector.execute({ entityId: 'lock.porte', domain: 'lock' }, { action: 'turn_on', desiredState: { on: true } }))
      .rejects.toThrow('home_assistant_action_unmapped');
  });

  it('reports supports() false for a domain/action combination with no mapping', () => {
    const { connector } = harness();
    expect(connector.supports({ entityId: 'lock.porte', domain: 'lock' }, 'turn_on')).toBe(false);
    expect(connector.supports(BINDING, 'turn_on')).toBe(true);
  });
});

describe('Home Assistant connector: request timeout', () => {
  it('aborts a request that never resolves within the configured timeout', async () => {
    const fetchImpl = vi.fn((_url, { signal } = {}) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const { connector } = harness({ fetchImpl, timeoutMs: 20 });
    await expect(connector.readState(BINDING)).rejects.toThrow('home_assistant_request_timeout');
  });
});

describe('Home Assistant connector: WebSocket state subscription with reconnect', () => {
  it('authenticates over the websocket and reconnects after an unexpected close', async () => {
    const sockets = [];
    class FakeSocket {
      constructor(url) {
        this.url = url;
        this.listeners = {};
        sockets.push(this);
      }
      on(event, handler) { (this.listeners[event] ??= []).push(handler); }
      send() {}
      close() { this.emit('close'); }
      emit(event, ...args) { (this.listeners[event] ?? []).forEach((handler) => handler(...args)); }
    }
    const { connector } = harness({ webSocketFactory: (url) => new FakeSocket(url), reconnectDelayMs: 5 });

    const updates = [];
    connector.subscribeState({ entityId: 'light.chambre', onUpdate: (state) => updates.push(state) });
    expect(sockets).toHaveLength(1);
    sockets[0].emit('open');
    sockets[0].emit('message', JSON.stringify({ type: 'auth_required' }));
    sockets[0].emit('message', JSON.stringify({ type: 'auth_ok' }));
    sockets[0].emit('message', JSON.stringify({
      type: 'event', event: { event_type: 'state_changed', data: { entity_id: 'light.chambre', new_state: { state: 'on', attributes: {} } } },
    }));
    expect(updates).toEqual([{ on: true }]);

    sockets[0].emit('close');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sockets.length).toBeGreaterThanOrEqual(2);
  });
});
