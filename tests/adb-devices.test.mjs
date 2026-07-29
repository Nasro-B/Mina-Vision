import { describe, expect, it } from 'vitest';
import { parseAuthorizedAdbTransports } from '../src/devices/adb-devices.mjs';

describe('ADB device transport report', () => {
  it('reports the actual transports of authorized endpoints only', () => {
    const stdout = [
      'List of devices attached',
      'USB123\tdevice',
      '192.168.1.10:44841\tdevice',
      '192.168.1.11:5555\toffline',
      '',
    ].join('\n');

    expect(parseAuthorizedAdbTransports(stdout)).toEqual(['usb', 'lan']);
  });
});
