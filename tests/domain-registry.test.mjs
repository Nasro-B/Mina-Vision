import { describe, expect, it, vi } from 'vitest';
import { createDomainRegistry } from '../src/core/domain-registry.mjs';

function domain(id, overrides = {}) {
  return { id, start: vi.fn(async () => ({ id })), stop: vi.fn(async () => {}), ...overrides };
}

describe('createDomainRegistry: definition guards', () => {
  it('rejects a definition missing an id', () => {
    expect(() => createDomainRegistry({ domains: [{ start: async () => {} }] })).toThrow('domain_registry_definition_invalid');
  });

  it('rejects a definition whose start is not a function', () => {
    expect(() => createDomainRegistry({ domains: [{ id: 'keyring', start: 'nope' }] })).toThrow('domain_registry_definition_invalid');
  });

  it('rejects two domains sharing the same id', () => {
    expect(() => createDomainRegistry({ domains: [domain('db'), domain('db')] })).toThrow('domain_registry_duplicate');
  });
});

describe('createDomainRegistry.startAll: strict order, keyring -> DB -> sessions -> ... -> UI ready', () => {
  it('starts domains in declaration order and exposes each instance via get()', async () => {
    const order = [];
    const domains = ['keyring', 'db', 'sessions', 'grounding', 'memory', 'research', 'skills', 'messaging', 'ui'].map((id) => domain(id, {
      start: vi.fn(async () => { order.push(id); return { id, ready: true }; }),
    }));
    const registry = createDomainRegistry({ domains });
    await registry.startAll();
    expect(order).toEqual(['keyring', 'db', 'sessions', 'grounding', 'memory', 'research', 'skills', 'messaging', 'ui']);
    expect(registry.get('db')).toEqual({ id: 'db', ready: true });
    expect(registry.status()).toBe('ready');
  });

  it('rejects starting twice without a stop in between', async () => {
    const registry = createDomainRegistry({ domains: [domain('keyring')] });
    await registry.startAll();
    await expect(registry.startAll()).rejects.toThrow('domain_registry_already_started');
  });

  it('rolls back everything already started when a required domain fails partway through (partial init never left running)', async () => {
    const started = [];
    const stopped = [];
    const domains = [
      domain('keyring', { start: vi.fn(async () => { started.push('keyring'); return {}; }), stop: vi.fn(async () => { stopped.push('keyring'); }) }),
      domain('db', { start: vi.fn(async () => { throw new Error('disk_full'); }) }),
    ];
    const registry = createDomainRegistry({ domains });
    await expect(registry.startAll()).rejects.toThrow('domain_registry_start_failed:db:disk_full');
    expect(started).toEqual(['keyring']);
    expect(stopped).toEqual(['keyring']);
    expect(registry.status()).toBe('idle');
  });

  it('a domain marked optional degrades instead of aborting the whole startup', async () => {
    const domains = [
      domain('keyring'),
      domain('home', { optional: true, start: vi.fn(async () => { throw new Error('google_home_sdk_absent'); }) }),
      domain('ui', { start: vi.fn(async ({ isDegraded }) => ({ homeDegraded: isDegraded('home') })) }),
    ];
    const registry = createDomainRegistry({ domains });
    await registry.startAll();
    expect(registry.isDegraded('home')).toBe(true);
    expect(registry.get('ui')).toEqual({ homeDegraded: true });
    expect(registry.status()).toBe('ready');
  });
});

describe('createDomainRegistry.stopAll: reverse order, best-effort, never blocks on one failure', () => {
  it('stops domains in reverse start order', async () => {
    const order = [];
    const domains = ['keyring', 'db', 'sessions'].map((id) => domain(id, {
      stop: vi.fn(async () => { order.push(id); }),
    }));
    const registry = createDomainRegistry({ domains });
    await registry.startAll();
    await registry.stopAll();
    expect(order).toEqual(['sessions', 'db', 'keyring']);
    expect(registry.status()).toBe('idle');
  });

  it('one domain failing to stop cleanly does not block the others from stopping', async () => {
    const order = [];
    const domains = [
      domain('keyring', { stop: vi.fn(async () => { order.push('keyring'); }) }),
      domain('db', { stop: vi.fn(async () => { throw new Error('stop_failed'); }) }),
    ];
    const registry = createDomainRegistry({ domains });
    await registry.startAll();
    await expect(registry.stopAll()).resolves.toBeUndefined();
    expect(order).toEqual(['keyring']);
  });

  it('calling stopAll twice (double close) is a safe no-op the second time', async () => {
    const registry = createDomainRegistry({ domains: [domain('keyring')] });
    await registry.startAll();
    await registry.stopAll();
    await expect(registry.stopAll()).resolves.toBeUndefined();
  });

  it('a fresh registry that was never started can be stopped safely (idle no-op)', async () => {
    const registry = createDomainRegistry({ domains: [domain('keyring')] });
    await expect(registry.stopAll()).resolves.toBeUndefined();
  });
});
