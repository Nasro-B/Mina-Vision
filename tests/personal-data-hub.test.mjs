import { describe, expect, it, vi } from 'vitest';
import { createPersonalDataHub } from '../src/personal/personal-data-hub.mjs';

function fakeAdapter(id, overrides = {}) {
  return { id, health: vi.fn(async () => ({ available: true })), sync: vi.fn(async () => ({ items: [], cursor: null, hasMore: false })), ...overrides };
}

describe('createPersonalDataHub: constructor guards', () => {
  it('requires an adapters array', () => {
    expect(() => createPersonalDataHub({})).toThrow('personal_data_hub_adapters_required');
  });

  it('rejects duplicate adapter ids', () => {
    expect(() => createPersonalDataHub({ adapters: [fakeAdapter('google'), fakeAdapter('google')] }))
      .toThrow('personal_data_hub_adapter_id_duplicate:google');
  });
});

describe('createPersonalDataHub.adapter', () => {
  it('returns the registered adapter by id', () => {
    const google = fakeAdapter('google');
    const hub = createPersonalDataHub({ adapters: [google, fakeAdapter('microsoft')] });
    expect(hub.adapter('google')).toBe(google);
  });

  it('throws adapter_not_found for an unregistered id', () => {
    const hub = createPersonalDataHub({ adapters: [fakeAdapter('google')] });
    expect(() => hub.adapter('caldav-carddav')).toThrow('adapter_not_found');
  });
});

describe('createPersonalDataHub.health', () => {
  it('runs health on every adapter and returns the results in order', async () => {
    const google = fakeAdapter('google', { health: vi.fn(async () => ({ available: true })) });
    const microsoft = fakeAdapter('microsoft', { health: vi.fn(async () => ({ available: false, reason: 'token_revoked' })) });
    const hub = createPersonalDataHub({ adapters: [google, microsoft] });
    const results = await hub.health();
    expect(results).toEqual([{ available: true }, { available: false, reason: 'token_revoked' }]);
    expect(google.health).toHaveBeenCalledTimes(1);
    expect(microsoft.health).toHaveBeenCalledTimes(1);
  });
});
