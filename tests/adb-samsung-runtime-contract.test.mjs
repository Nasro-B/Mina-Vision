import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Samsung ADB Wi-Fi runtime wiring', () => {
  it('keeps only the configured Samsung hardware serial connected through mDNS', () => {
    const main = readFileSync(new URL('../src/ui/main.mjs', import.meta.url), 'utf8');

    expect(main).toContain("from '../executors/adb-mdns-peer.mjs'");
    expect(main).toContain('process.env.MINA_SAMSUNG_ADB_SERIAL');
    expect(main).toContain("role: 'samsung'");
    expect(main).toContain('samsungAdbWifiKeeper.start()');
    expect(main).toContain('samsungAdbWifiKeeper?.stop()');
  });
});
