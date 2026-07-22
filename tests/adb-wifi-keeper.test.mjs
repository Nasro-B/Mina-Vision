import { describe, expect, it, vi } from 'vitest';
import * as phoneBridgeModule from '../src/executors/phone-bridge.mjs';

describe('ADB Wi-Fi keeper', () => {
  it('persists only a validated private endpoint and restores it after restart', async () => {
    expect(typeof phoneBridgeModule.createAdbWifiEndpointStore).toBe('function');
    let stored = '';
    const store = phoneBridgeModule.createAdbWifiEndpointStore({
      filename: 'C:\\state\\mina-adb-wifi.json',
      readText: vi.fn(async () => stored),
      writeAtomic: vi.fn(async (_filename, content) => { stored = content; }),
      now: () => 123_000,
    });

    await store.saveEndpoint('192.168.1.11:5555', 'huawei-primary');
    expect(JSON.parse(stored)).toEqual({
      version: 1, endpoint: '192.168.1.11:5555', deviceId: 'huawei-primary', updatedAtMs: 123_000,
    });
    await expect(store.loadEndpoint()).resolves.toEqual({ endpoint: '192.168.1.11:5555', deviceId: 'huawei-primary' });
    await expect(store.saveEndpoint('8.8.8.8:5555', 'huawei-primary')).rejects.toThrow('adb_wifi_endpoint_invalid');
  });

  it('reconnects immediately, persists the verified endpoint and keeps monitoring', async () => {
    expect(typeof phoneBridgeModule.createAdbWifiKeeper).toBe('function');
    const scheduled = [];
    const bridge = {
      ensureWifiConnection: vi.fn(async () => ({
        connected: true, endpoint: '192.168.1.11:5555', deviceId: 'huawei-primary', transports: ['usb', 'lan'],
      })),
    };
    const saveEndpoint = vi.fn(async () => {});
    const keeper = phoneBridgeModule.createAdbWifiKeeper({
      bridge,
      loadEndpoint: vi.fn(async () => null),
      saveEndpoint,
      setIntervalFn: (callback, milliseconds) => { scheduled.push({ callback, milliseconds }); return 42; },
      clearIntervalFn: vi.fn(),
    });

    await expect(keeper.start()).resolves.toMatchObject({ connected: true, endpoint: '192.168.1.11:5555' });
    expect(saveEndpoint).toHaveBeenCalledWith('192.168.1.11:5555', 'huawei-primary');
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].milliseconds).toBe(5_000);
    await scheduled[0].callback();
    expect(bridge.ensureWifiConnection).toHaveBeenCalledTimes(2);
  });

  it('continues monitoring after a temporary failure without overlapping reconnect attempts', async () => {
    expect(typeof phoneBridgeModule.createAdbWifiKeeper).toBe('function');
    let release;
    const bridge = { ensureWifiConnection: vi.fn(() => new Promise((resolve) => { release = resolve; })) };
    let scheduled;
    const statuses = [];
    const keeper = phoneBridgeModule.createAdbWifiKeeper({
      bridge,
      loadEndpoint: vi.fn(async () => ({ endpoint: '192.168.1.11:5555', deviceId: 'huawei-primary' })),
      saveEndpoint: vi.fn(async () => {}),
      setIntervalFn: (callback) => { scheduled = callback; return 7; },
      clearIntervalFn: vi.fn(),
      onStatus: (status) => statuses.push(status),
    });

    const starting = keeper.start();
    await Promise.resolve();
    await scheduled();
    expect(bridge.ensureWifiConnection).toHaveBeenCalledTimes(1);
    release({ connected: true, endpoint: '192.168.1.11:5555', deviceId: 'huawei-primary', transports: ['lan'] });
    await starting;
    expect(statuses.at(-1)).toMatchObject({ connected: true });
  });
});
