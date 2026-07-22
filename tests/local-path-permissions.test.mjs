import { describe, expect, it, vi } from 'vitest';
import { createLocalPathPermissions } from '../src/security/local-path-permissions.mjs';

describe('local path permissions (Task 4 / R-04)', () => {
  it('harden restreint au seul utilisateur + SYSTEM, héritage coupé, récursif', async () => {
    const runIcacls = vi.fn(async () => '');
    const permissions = createLocalPathPermissions({ runIcacls, ownerAccount: 'PC\\Nasro' });
    await expect(permissions.harden('C:\\data\\logs')).resolves.toMatchObject({ hardened: true });
    expect(runIcacls).toHaveBeenCalledWith([
      'C:\\data\\logs', '/inheritance:r',
      '/grant:r', 'PC\\Nasro:(OI)(CI)F',
      '/grant:r', 'SYSTEM:(OI)(CI)F',
      '/T', '/C', '/Q',
    ]);
  });

  it('refuse une racine de volume ou un chemin réseau — jamais icacls sur tout C:', async () => {
    const runIcacls = vi.fn();
    const permissions = createLocalPathPermissions({ runIcacls, ownerAccount: 'PC\\Nasro' });
    await expect(permissions.harden('C:\\')).rejects.toThrow('acl_target_invalid');
    await expect(permissions.harden('\\\\serveur\\partage')).rejects.toThrow('acl_target_invalid');
    expect(runIcacls).not.toHaveBeenCalled();
  });

  it('échec icacls = fail-soft rapporté, jamais une exception', async () => {
    const permissions = createLocalPathPermissions({
      runIcacls: vi.fn(async () => { throw new Error('access denied'); }),
      ownerAccount: 'PC\\Nasro',
    });
    await expect(permissions.harden('C:\\data\\logs')).resolves.toMatchObject({
      hardened: false,
      error: expect.stringContaining('access denied'),
    });
  });

  it('inspect liste les comptes et signale les groupes trop larges sans rien modifier', async () => {
    const runIcacls = vi.fn(async () => [
      'C:\\data\\logs PC\\Nasro:(OI)(CI)(F)',
      '                BUILTIN\\Users:(RX)',
      '                NT AUTHORITY\\SYSTEM:(F)',
    ].join('\n'));
    const permissions = createLocalPathPermissions({ runIcacls, ownerAccount: 'PC\\Nasro' });
    const report = await permissions.inspect('C:\\data\\logs');
    expect(report.accounts).toContain('PC\\Nasro');
    expect(report.broadGroups).toContain('BUILTIN\\Users');
    expect(runIcacls).toHaveBeenCalledWith(['C:\\data\\logs']);
  });
});
