import { describe, expect, it, vi } from 'vitest';
import { createAdbMdnsPeerKeeper, findAdbMdnsEndpoint } from '../src/executors/adb-mdns-peer.mjs';

const MDNS = `List of discovered mdns services
adb-SAMSUNGTESTSERIAL-a80QcZ\t_adb-tls-connect._tcp\t192.168.1.10:39509
adb-HUAWEITESTSERIAL\t_adb._tcp\t192.168.1.11:5555
adb-PIXELTESTSERIAL\t_adb._tcp\t192.168.1.13:5555
`;

describe('ADB mDNS peer keeper', () => {
  it('selects only the Samsung serial and never another network device', () => {
    expect(findAdbMdnsEndpoint(MDNS, 'SAMSUNGTESTSERIAL')).toBe('192.168.1.10:39509');
    expect(findAdbMdnsEndpoint(MDNS, 'UNKNOWN')).toBeNull();
  });

  it('connects the discovered TLS endpoint and verifies the hardware serial', async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ stdout: MDNS, stderr: '' })
      .mockResolvedValueOnce({ stdout: 'connected to 192.168.1.10:39509', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'SAMSUNGTESTSERIAL\n', stderr: '' });
    const statuses = [];
    const keeper = createAdbMdnsPeerKeeper({
      run, adbPath: 'adb.exe', serial: 'SAMSUNGTESTSERIAL', role: 'samsung', onStatus: (value) => statuses.push(value),
    });

    await expect(keeper.tick()).resolves.toMatchObject({ connected: true, role: 'samsung', endpoint: '192.168.1.10:39509' });
    expect(run).toHaveBeenNthCalledWith(1, 'adb.exe', ['mdns', 'services'], { binary: false });
    expect(run).toHaveBeenNthCalledWith(2, 'adb.exe', ['connect', '192.168.1.10:39509'], { binary: false });
    expect(run).toHaveBeenNthCalledWith(3, 'adb.exe', ['-s', '192.168.1.10:39509', 'shell', 'getprop', 'ro.serialno'], { binary: false });
    expect(statuses.at(-1)).toMatchObject({ connected: true, role: 'samsung' });
  });

  it('disconnects an endpoint whose reported serial does not match', async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ stdout: MDNS, stderr: '' })
      .mockResolvedValueOnce({ stdout: 'connected', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'WRONG-SERIAL\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'disconnected', stderr: '' });
    const keeper = createAdbMdnsPeerKeeper({ run, adbPath: 'adb.exe', serial: 'SAMSUNGTESTSERIAL', role: 'samsung' });

    await expect(keeper.tick()).rejects.toThrow('adb_mdns_peer_identity_mismatch');
    expect(run).toHaveBeenLastCalledWith('adb.exe', ['disconnect', '192.168.1.10:39509'], { binary: false });
  });
});
