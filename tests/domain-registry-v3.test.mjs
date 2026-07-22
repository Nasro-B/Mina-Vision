import { describe, expect, it, vi } from 'vitest';
import { createDomainRegistry } from '../src/core/domain-registry.mjs';

function domain(id, overrides = {}) {
  return {
    id,
    start: vi.fn(async () => ({ id, ready: true })),
    stop: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('domain registry: dependency order', () => {
  it('starts domains in the exact declared order and exposes each instance by id', async () => {
    const order = [];
    const a = domain('keyring', { start: vi.fn(async () => { order.push('keyring'); return { id: 'keyring' }; }) });
    const b = domain('database', { start: vi.fn(async () => { order.push('database'); return { id: 'database' }; }) });
    const registry = createDomainRegistry({ domains: [a, b] });

    await registry.startAll();
    expect(order).toEqual(['keyring', 'database']);
    expect(registry.get('keyring')).toEqual({ id: 'keyring' });
  });

  it('gives each domain access to already-started domains through the start context', async () => {
    const keyring = domain('keyring');
    const database = domain('database', {
      start: vi.fn(async ({ get }) => ({ usesKeyring: get('keyring')?.ready === true })),
    });
    const registry = createDomainRegistry({ domains: [keyring, database] });

    await registry.startAll();
    expect(registry.get('database')).toEqual({ usesKeyring: true });
  });

  it('rejects a duplicate domain id at construction', () => {
    expect(() => createDomainRegistry({ domains: [domain('keyring'), domain('keyring')] }))
      .toThrow('domain_registry_duplicate');
  });
});

describe('domain registry: partial init rollback', () => {
  it('stops every already-started domain in reverse order when a required domain fails to start', async () => {
    const stopOrder = [];
    const keyring = domain('keyring', { stop: vi.fn(async () => { stopOrder.push('keyring'); }) });
    const database = domain('database', { stop: vi.fn(async () => { stopOrder.push('database'); }) });
    const config = domain('config', { start: vi.fn(async () => { throw new Error('disk_full'); }) });
    const registry = createDomainRegistry({ domains: [keyring, database, config] });

    await expect(registry.startAll()).rejects.toThrow('domain_registry_start_failed:config:disk_full');
    expect(stopOrder).toEqual(['database', 'keyring']);
    expect(registry.status()).toBe('idle');
  });
});

describe('domain registry: degraded optional domains', () => {
  it('keeps local core startup working when an optional domain fails, marking it degraded', async () => {
    const keyring = domain('keyring');
    const mail = domain('mail', { optional: true, start: vi.fn(async () => { throw new Error('no_accounts_configured'); }) });
    const registry = createDomainRegistry({ domains: [keyring, mail] });

    await expect(registry.startAll()).resolves.toBeUndefined();
    expect(registry.status()).toBe('ready');
    expect(registry.isDegraded('mail')).toBe(true);
    expect(registry.get('mail')).toBeNull();
    expect(registry.get('keyring')).not.toBeNull();
  });

  it('never marks a required domain degraded, it always rolls back instead', async () => {
    const config = domain('config', { start: vi.fn(async () => { throw new Error('missing_env'); }) });
    const registry = createDomainRegistry({ domains: [config] });
    await expect(registry.startAll()).rejects.toThrow();
    expect(registry.status()).toBe('idle');
  });
});

describe('domain registry: double close and emergency stop', () => {
  it('is safe to call stopAll twice, the second call is a no-op', async () => {
    const keyring = domain('keyring');
    const registry = createDomainRegistry({ domains: [keyring] });
    await registry.startAll();

    await registry.stopAll();
    await expect(registry.stopAll()).resolves.toBeUndefined();
    expect(keyring.stop).toHaveBeenCalledTimes(1);
  });

  it('continues stopping remaining domains even when one domain fails to stop cleanly', async () => {
    const stopped = [];
    const keyring = domain('keyring', { stop: vi.fn(async () => { stopped.push('keyring'); }) });
    const database = domain('database', { stop: vi.fn(async () => { throw new Error('handle_busy'); }) });
    const registry = createDomainRegistry({ domains: [keyring, database] });
    await registry.startAll();

    await expect(registry.stopAll()).resolves.toBeUndefined();
    expect(stopped).toEqual(['keyring']);
  });
});
