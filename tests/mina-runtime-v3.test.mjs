import { describe, expect, it, vi } from 'vitest';
import { createMinaRuntime } from '../src/core/mina-runtime.mjs';
import { createDomainRegistry } from '../src/core/domain-registry.mjs';
import { createClaimLedger } from '../src/grounding/claim-ledger.mjs';
import { createSessionManager } from '../src/sessions/session-manager.mjs';
import { createSessionStore } from '../src/sessions/session-store.mjs';

function harness({ domains = [] } = {}) {
  let id = 0;
  const sessionManager = createSessionManager({
    store: createSessionStore(), clock: () => Date.parse('2026-07-15T00:00:00.000Z'), ids: (kind) => `${kind}-${++id}`,
  });
  const claimLedger = createClaimLedger({ clock: () => Date.parse('2026-07-15T00:00:00.000Z'), ids: () => `claim-${++id}` });
  const domainRegistry = createDomainRegistry({ domains });
  const runtime = createMinaRuntime({ sessionManager, claimLedger, domainRegistry });
  return { runtime, domainRegistry };
}

describe('Mina runtime v3: deterministic domain composition', () => {
  it('starts declared domains before the runtime itself becomes ready', async () => {
    const startOrder = [];
    const keyring = { id: 'keyring', start: vi.fn(async () => { startOrder.push('keyring'); return {}; }) };
    const mail = { id: 'mail', start: vi.fn(async () => { startOrder.push('mail'); return {}; }) };
    const { runtime, domainRegistry } = harness({ domains: [keyring, mail] });

    await runtime.start();
    expect(startOrder).toEqual(['keyring', 'mail']);
    expect(domainRegistry.status()).toBe('ready');
    expect(runtime.getSessionState().runtimeStatus).toBe('ready');
  });

  it('degrades gracefully when an optional domain such as mail fails to start', async () => {
    const keyring = { id: 'keyring', start: vi.fn(async () => ({})) };
    const mail = { id: 'mail', optional: true, start: vi.fn(async () => { throw new Error('no_accounts_configured'); }) };
    const { runtime, domainRegistry } = harness({ domains: [keyring, mail] });

    await runtime.start();
    expect(runtime.getSessionState().runtimeStatus).toBe('ready');
    expect(domainRegistry.isDegraded('mail')).toBe(true);
  });

  it('stops domains, in reverse order, as part of runtime shutdown', async () => {
    const stopOrder = [];
    const keyring = { id: 'keyring', start: vi.fn(async () => ({})), stop: vi.fn(async () => { stopOrder.push('keyring'); }) };
    const mail = { id: 'mail', start: vi.fn(async () => ({})), stop: vi.fn(async () => { stopOrder.push('mail'); }) };
    const { runtime, domainRegistry } = harness({ domains: [keyring, mail] });
    await runtime.start();

    await runtime.shutdown();
    expect(stopOrder).toEqual(['mail', 'keyring']);
    expect(domainRegistry.status()).toBe('idle');
  });

  it('never fails runtime construction when no domain registry is provided, for backward compatibility', async () => {
    let id = 0;
    const sessionManager = createSessionManager({ store: createSessionStore(), ids: (kind) => `${kind}-${++id}` });
    const claimLedger = createClaimLedger({ ids: () => `claim-${++id}` });
    const runtime = createMinaRuntime({ sessionManager, claimLedger });
    await expect(runtime.start()).resolves.toBeUndefined();
  });
});
