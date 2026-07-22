import { describe, expect, it, vi } from 'vitest';
import { createMailVerifier } from '../src/mail/mail-verifier.mjs';

describe('mail verifier: qualified states, never fabricating delivery', () => {
  it('promotes accepted_by_provider to state_confirmed only after a consistent re-read', async () => {
    const verifier = createMailVerifier();
    const result = await verifier.verify({
      providerResult: { state: 'accepted_by_provider', providerMessageId: 'm1' },
      reread: vi.fn(async () => ({ found: true, providerMessageId: 'm1' })),
    });
    expect(result).toEqual({ state: 'state_confirmed', providerMessageId: 'm1' });
  });

  it('keeps accepted_by_provider when no re-read is available, never inventing confirmation', async () => {
    const verifier = createMailVerifier();
    const result = await verifier.verify({ providerResult: { state: 'accepted_by_provider', providerMessageId: 'm2' } });
    expect(result).toEqual({ state: 'accepted_by_provider', providerMessageId: 'm2' });
  });

  it('never upgrades delivery_unknown to a confirmed state', async () => {
    const verifier = createMailVerifier();
    const result = await verifier.verify({
      providerResult: { state: 'delivery_unknown', providerMessageId: 'm3' },
      reread: vi.fn(async () => ({ found: true, providerMessageId: 'm3' })),
    });
    expect(result.state).toBe('delivery_unknown');
  });

  it('marks failed when the re-read cannot find the expected message at all', async () => {
    const verifier = createMailVerifier();
    const result = await verifier.verify({
      providerResult: { state: 'accepted_by_provider', providerMessageId: 'm4' },
      reread: vi.fn(async () => ({ found: false })),
    });
    expect(result.state).toBe('failed');
  });
});
