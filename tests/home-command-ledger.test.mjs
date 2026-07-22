import { describe, expect, it } from 'vitest';
import { createSmartHomeCommandLedger, createSmartHomeCommandId } from '../src/home/home-command-ledger.mjs';

describe('smart home command ledger: idempotence and expiration', () => {
  it('generates a fresh UUID v4 command id each time', () => {
    const a = createSmartHomeCommandId();
    const b = createSmartHomeCommandId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu);
    expect(a).not.toBe(b);
  });

  it('rejects registering a command without expiresAt in the future', () => {
    const ledger = createSmartHomeCommandLedger({ now: () => 1_000 });
    expect(() => ledger.begin({ commandId: createSmartHomeCommandId(), expiresAt: 500 })).toThrow('smart_home_command_expired');
  });

  it('returns the existing receipt for a duplicate command id instead of running twice', () => {
    const ledger = createSmartHomeCommandLedger({ now: () => 1_000 });
    const commandId = createSmartHomeCommandId();
    const begun = ledger.begin({ commandId, expiresAt: 61_000 });
    expect(begun.status).toBe('new');
    const receipt = Object.freeze({ commandId, state: 'state_confirmed', verified: true });
    ledger.finish(commandId, receipt);

    const again = ledger.begin({ commandId, expiresAt: 61_000 });
    expect(again).toEqual({ status: 'duplicate', receipt });
  });

  it('reports an in-flight command as pending rather than allowing a concurrent second execution', () => {
    const ledger = createSmartHomeCommandLedger({ now: () => 1_000 });
    const commandId = createSmartHomeCommandId();
    ledger.begin({ commandId, expiresAt: 61_000 });
    expect(ledger.begin({ commandId, expiresAt: 61_000 })).toEqual({ status: 'pending' });
  });

  it('never lets a retried command silently become a different action (toggle guard)', () => {
    const ledger = createSmartHomeCommandLedger({ now: () => 1_000 });
    const commandId = createSmartHomeCommandId();
    ledger.begin({ commandId, expiresAt: 61_000, action: 'turn_on' });
    expect(() => ledger.begin({ commandId, expiresAt: 61_000, action: 'turn_off' })).toThrow('smart_home_command_action_mismatch');
  });
});
