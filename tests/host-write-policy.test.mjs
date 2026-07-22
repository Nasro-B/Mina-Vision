import { describe, expect, it, vi } from 'vitest';
import { createHostWritePolicy } from '../src/files/host-write-policy.mjs';

const trustedRoots = [
  'C:\\Serveurs\\Mina Vision',
  'C:\\Users\\Nasro\\AppData\\Roaming\\agentvisionsourire',
  'G:\\Programmes Installés\\caches\\MinaVision',
  'G:\\Serveurs\\Mina AI',
];

describe('host write policy', () => {
  it('allows Mina Vision roots and classifies every other local path for confirmation', () => {
    const policy = createHostWritePolicy({ trustedRoots, confirmLocal: vi.fn() });

    expect(policy.classify('C:\\Serveurs\\Mina Vision\\notes\\session.md')).toBe('allow');
    expect(policy.classify('G:\\Serveurs\\Mina AI\\output.json')).toBe('allow');
    expect(policy.classify('C:\\Users\\Nasro\\Desktop\\note.md')).toBe('confirm');
    expect(policy.classify('G:\\Docs\\rapport.pdf')).toBe('confirm');
  });

  it('requires a path-specific local confirmation outside Mina Vision roots', async () => {
    const confirmLocal = vi.fn(async () => true);
    const policy = createHostWritePolicy({ trustedRoots, confirmLocal });

    await expect(policy.authorize('G:\\Docs\\rapport.pdf')).resolves.toBe('G:\\Docs\\rapport.pdf');
    expect(confirmLocal).toHaveBeenCalledWith(expect.objectContaining({
      reason: expect.stringContaining('G:\\Docs\\rapport.pdf'),
      action: expect.objectContaining({ name: 'files.write', path: 'G:\\Docs\\rapport.pdf' }),
    }));
  });

  it('refuses an external write when the creator declines confirmation', async () => {
    const policy = createHostWritePolicy({ trustedRoots, confirmLocal: vi.fn(async () => false) });

    await expect(policy.authorize('C:\\Users\\Nasro\\Desktop\\note.md'))
      .rejects.toThrow('host_write_confirmation_refused');
  });

  it('preflights file-changing missions while leaving reads unrestricted', () => {
    const policy = createHostWritePolicy({ trustedRoots, confirmLocal: vi.fn() });

    expect(policy.requiresMissionConfirmation({
      environment: 'desktop', goal: 'Crée G:\\Docs\\note.md',
    })).toBe(true);
    expect(policy.requiresMissionConfirmation({
      environment: 'desktop', goal: 'Crée G:\\Serveurs\\Mina AI\\note.md',
    })).toBe(false);
    expect(policy.requiresMissionConfirmation({
      environment: 'desktop', goal: 'Crée un fichier Markdown sur le PC',
    })).toBe(true);
    expect(policy.requiresMissionConfirmation({
      environment: 'desktop', goal: 'Lis G:\\Docs\\note.md',
    })).toBe(false);
  });
});
