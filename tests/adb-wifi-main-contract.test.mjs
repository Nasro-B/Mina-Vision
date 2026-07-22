import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Mina Vision ADB Wi-Fi lifecycle contract', () => {
  it('starts the persistent keeper and stops it during application shutdown', async () => {
    const main = await readFile(new URL('../src/ui/main.mjs', import.meta.url), 'utf8');
    expect(main).toContain('createAdbWifiEndpointStore');
    expect(main).toContain('createAdbWifiKeeper');
    expect(main).toContain("'mina-adb-wifi.json'");
    expect(main).toContain('adbWifiKeeper.start()');
    expect(main).toContain('adbWifiKeeper?.stop()');
    expect(main).toContain("type: 'adb_wifi_status'");
  });
});
