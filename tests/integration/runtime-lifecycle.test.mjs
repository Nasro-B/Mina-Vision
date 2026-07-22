import { describe, expect, it, vi } from 'vitest';
import { createMinaRuntime } from '../../src/core/mina-runtime.mjs';
import { createDomainRegistry } from '../../src/core/domain-registry.mjs';
import { createSessionManager } from '../../src/sessions/session-manager.mjs';
import { createSessionStore } from '../../src/sessions/session-store.mjs';
import { createClaimLedger } from '../../src/grounding/claim-ledger.mjs';

function domain(id, overrides = {}) {
  return { id, start: vi.fn(async () => ({ id })), stop: vi.fn(async () => {}), ...overrides };
}

function buildRuntime(domains, extra = {}) {
  let counter = 0;
  const store = createSessionStore();
  const sessionManager = createSessionManager({ store, clock: () => Date.parse('2026-07-16T00:00:00.000Z'), ids: (kind) => `${kind}-${++counter}` });
  const claimLedger = createClaimLedger({ clock: () => Date.parse('2026-07-16T00:00:00.000Z'), ids: () => `claim-${++counter}` });
  const domainRegistry = createDomainRegistry({ domains });
  const runtime = createMinaRuntime({ sessionManager, claimLedger, domainRegistry, ...extra });
  return { runtime, store, domainRegistry };
}

describe('v2 integration: full composition root lifecycle through the real runtime', () => {
  it('missing runtime dependencies fail fast, before any domain is ever started', () => {
    expect(() => createMinaRuntime({})).toThrow('runtime_dependencies_required');
  });

  it('starts domains in keyring -> db -> sessions -> ... order, then the session runtime, then becomes ready', async () => {
    const order = [];
    const domains = ['keyring', 'db', 'sessions', 'grounding', 'memory', 'research', 'skills', 'messaging', 'ui'].map((id) => domain(id, {
      start: vi.fn(async () => { order.push(id); return { id }; }),
    }));
    const { runtime, store } = buildRuntime(domains);

    await runtime.start();

    expect(order).toEqual(['keyring', 'db', 'sessions', 'grounding', 'memory', 'research', 'skills', 'messaging', 'ui']);
    const runtimeEvents = store.list().map((event) => event.type);
    expect(runtimeEvents.slice(0, 2)).toEqual(['runtime_start', 'runtime_ready']);
    expect(runtime.getSessionState().runtimeStatus).toBe('ready');
  });

  it('a required domain crashing partway through startup rolls back everything already started, and the runtime never reaches ready', async () => {
    const started = [];
    const stopped = [];
    const domains = [
      domain('keyring', { start: vi.fn(async () => { started.push('keyring'); return {}; }), stop: vi.fn(async () => { stopped.push('keyring'); }) }),
      domain('db', { start: vi.fn(async () => { throw new Error('sqlite_locked'); }) }),
    ];
    const { runtime, store } = buildRuntime(domains);

    await expect(runtime.start()).rejects.toThrow('domain_registry_start_failed:db:sqlite_locked');
    expect(started).toEqual(['keyring']);
    expect(stopped).toEqual(['keyring']);
    expect(store.list().some((event) => event.type === 'runtime_ready')).toBe(false);
  });

  it('a domain marked optional degrades without blocking the rest of startup, and the runtime still becomes ready', async () => {
    const domains = [
      domain('keyring'),
      domain('home', { optional: true, start: vi.fn(async () => { throw new Error('google_home_sdk_absent'); }) }),
      domain('ui'),
    ];
    const { runtime, domainRegistry } = buildRuntime(domains);
    await runtime.start();
    expect(runtime.getSessionState().runtimeStatus).toBe('ready');
    expect(domainRegistry.isDegraded('home')).toBe(true);
  });

  it('reverses domain stop order on shutdown, after ending the runtime session, and double-close is a safe no-op', async () => {
    const order = [];
    const domains = ['keyring', 'db', 'sessions'].map((id) => domain(id, { stop: vi.fn(async () => { order.push(id); }) }));
    const { runtime, store } = buildRuntime(domains);
    await runtime.start();

    const first = await runtime.shutdown();
    expect(first.status).toBe('ended');
    expect(order).toEqual(['sessions', 'db', 'keyring']);
    expect(store.list().some((event) => event.type === 'runtime_end')).toBe(true);

    const second = await runtime.shutdown();
    expect(second.status).toBe('ended');
    expect(order).toEqual(['sessions', 'db', 'keyring']); // stop() was not invoked again
  });
});
