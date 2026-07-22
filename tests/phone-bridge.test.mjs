import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createPhoneBridge } from '../src/executors/phone-bridge.mjs';

function fakeRun(outputs = []) {
  const run = vi.fn(async () => outputs.shift() ?? { stdout: '', stderr: '' });
  return run;
}

function pngFixture(width = 1080, height = 2340) {
  const png = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(png, 0);
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  return png;
}

const resolveIdentity = vi.fn(async () => ({ deviceId: 'huawei-primary', verified: true }));

describe('phone bridge', () => {
  it('accepts exactly one authorized device', async () => {
    const run = fakeRun([{ stdout: 'List of devices attached\nSERIAL device product:MAR-LX1AEEA model:MAR_LX1A device:HWMAR\n' }]);
    const bridge = createPhoneBridge({ run, resolveDeviceIdentity: resolveIdentity });

    await expect(bridge.detect()).resolves.toMatchObject({ serial: 'SERIAL', model: 'MAR_LX1A', deviceId: 'huawei-primary' });
  });

  it('rejects unauthorized or multiple devices', async () => {
    const unauthorized = createPhoneBridge({ run: fakeRun([{ stdout: 'List of devices attached\nA unauthorized\n' }]), resolveDeviceIdentity: resolveIdentity });
    await expect(unauthorized.detect()).rejects.toThrow('autorisé');

    const multiple = createPhoneBridge({
      run: fakeRun([{ stdout: 'List of devices attached\nA device\nB device\n' }]),
      resolveDeviceIdentity: vi.fn(async ({ serial }) => ({ deviceId: serial === 'A' ? 'first' : 'second', verified: true })),
    });
    await expect(multiple.detect()).rejects.toThrow('identité physique');
  });

  it('accepts USB and Wi-Fi endpoints for the same signed identity and prefers USB', async () => {
    const run = fakeRun([{ stdout: 'List of devices attached\nHUAWEITESTSERIAL device model:MAR_LX1A\n192.168.1.16:5555 device model:MAR_LX1A\n' }]);
    const bridge = createPhoneBridge({ run, resolveDeviceIdentity: resolveIdentity });

    await expect(bridge.detect()).resolves.toMatchObject({
      serial: 'HUAWEITESTSERIAL', deviceId: 'huawei-primary', transports: ['usb', 'lan'],
    });
  });

  it('ignores other authorized ADB phones that do not carry the signed Mina Gateway identity', async () => {
    const run = fakeRun([{ stdout: 'List of devices attached\nSAMSUNG device model:SM_A715F\n192.168.1.11:5555 device model:MAR_LX1A\n' }]);
    const bridge = createPhoneBridge({
      run,
      resolveDeviceIdentity: vi.fn(async ({ serial }) => {
        if (serial === 'SAMSUNG') throw new Error('Identité Mina Gateway illisible.');
        return { deviceId: 'huawei-primary', verified: true };
      }),
    });

    await expect(bridge.detect()).resolves.toMatchObject({
      serial: '192.168.1.11:5555', deviceId: 'huawei-primary', transports: ['lan'],
    });
  });

  it('enables ADB Wi-Fi from the signed USB Huawei and verifies the LAN identity', async () => {
    let lanConnected = false;
    const run = vi.fn(async (_file, args) => {
      if (args[0] === 'devices') {
        return {
          stdout: `List of devices attached\nHUAWEITESTSERIAL device model:MAR_LX1A\n${lanConnected ? '192.168.1.11:5555 device model:MAR_LX1A\n' : ''}`,
        };
      }
      if (args.includes('ip')) return { stdout: '34: wlan0: <UP>\n    inet 192.168.1.11/24 scope global wlan0\n' };
      if (args[0] === 'connect') { lanConnected = true; return { stdout: 'connected to 192.168.1.11:5555\n' }; }
      return { stdout: '' };
    });
    const bridge = createPhoneBridge({ run, adbPath: 'adb.exe', resolveDeviceIdentity: resolveIdentity, wait: async () => {} });

    await expect(bridge.ensureWifiConnection()).resolves.toMatchObject({
      connected: true, endpoint: '192.168.1.11:5555', deviceId: 'huawei-primary', transports: ['usb', 'lan'],
    });
    expect(run).toHaveBeenCalledWith('adb.exe', ['-s', 'HUAWEITESTSERIAL', 'tcpip', '5555'], expect.any(Object));
    expect(run).toHaveBeenCalledWith('adb.exe', ['connect', '192.168.1.11:5555'], expect.any(Object));
  });

  it('reconnects a persisted private LAN endpoint after the PC ADB server restarts', async () => {
    let lanConnected = false;
    const run = vi.fn(async (_file, args) => {
      if (args[0] === 'devices') return {
        stdout: `List of devices attached\n${lanConnected ? '192.168.1.11:5555 device model:MAR_LX1A\n' : ''}`,
      };
      if (args[0] === 'connect') { lanConnected = true; return { stdout: 'connected\n' }; }
      return { stdout: '' };
    });
    const bridge = createPhoneBridge({ run, adbPath: 'adb.exe', resolveDeviceIdentity: resolveIdentity });

    await expect(bridge.ensureWifiConnection({ rememberedEndpoint: '192.168.1.11:5555' })).resolves.toMatchObject({
      connected: true, endpoint: '192.168.1.11:5555', transports: ['lan'],
    });
    expect(run).not.toHaveBeenCalledWith('adb.exe', expect.arrayContaining(['tcpip']), expect.anything());
  });

  it('disconnects a persisted endpoint when its signed identity is not the paired Huawei', async () => {
    let lanConnected = false;
    const run = vi.fn(async (_file, args) => {
      if (args[0] === 'devices') return {
        stdout: `List of devices attached\n${lanConnected ? '192.168.1.11:5555 device model:OTHER\n' : ''}`,
      };
      if (args[0] === 'connect') { lanConnected = true; return { stdout: 'connected\n' }; }
      return { stdout: '' };
    });
    const bridge = createPhoneBridge({
      run,
      adbPath: 'adb.exe',
      resolveDeviceIdentity: vi.fn(async () => ({ deviceId: 'different-signed-device', verified: true })),
    });

    await expect(bridge.ensureWifiConnection({
      rememberedEndpoint: '192.168.1.11:5555', expectedDeviceId: 'huawei-primary',
    })).rejects.toThrow('adb_wifi_identity_mismatch');
    expect(run).toHaveBeenCalledWith('adb.exe', ['disconnect', '192.168.1.11:5555'], expect.any(Object));
  });

  it('runs the complete camera path over a Wi-Fi-only ADB endpoint', async () => {
    const jpeg = Buffer.from('ffd8ff0102ffd9', 'hex');
    const run = fakeRun([
      { stdout: 'List of devices attached\n192.168.1.11:5555 device model:MAR_LX1A\n' },
      { stdout: '' }, { stdout: '' }, { stdout: 'Starting: Intent' },
      { stdout: '{"version":1,"file":"frame-9.jpg"}' }, { stdout: jpeg },
    ]);
    const bridge = createPhoneBridge({ run, adbPath: 'adb.exe', resolveDeviceIdentity: resolveIdentity });

    await bridge.startSensorCameraStream({ lens: 'front', maxFps: 5 });
    await expect(bridge.readLatestCameraFrame()).resolves.toEqual({ envelope: { version: 1, file: 'frame-9.jpg' }, jpeg });
    expect(run.mock.calls.slice(1).every(([, args]) => args[1] === '192.168.1.11:5555')).toBe(true);
  });

  it('starts the camera and observes a PNG without shell interpolation', async () => {
    const run = fakeRun([
      { stdout: 'List of devices attached\nSERIAL device model:MAR_LX1A\n' },
      { stdout: 'Starting: Intent' },
      { stdout: pngFixture(), stderr: '' },
    ]);
    const bridge = createPhoneBridge({ run, adbPath: 'adb.exe', resolveDeviceIdentity: resolveIdentity });

    await bridge.openSystemCameraPreview();
    const observation = await bridge.observe();

    expect(run).toHaveBeenNthCalledWith(2, 'adb.exe', ['-s', 'SERIAL', 'shell', 'am', 'start', '-a', 'android.media.action.STILL_IMAGE_CAMERA'], expect.any(Object));
    expect(run).toHaveBeenNthCalledWith(3, 'adb.exe', ['-s', 'SERIAL', 'exec-out', 'screencap', '-p'], expect.any(Object));
    expect(observation).toMatchObject({ mimeType: 'image/png', width: 1080, height: 2340 });
  });

  it('streams bounded sensor frames through private signed app files', async () => {
    const jpeg = Buffer.from('ffd8ff0102ffd9', 'hex');
    const envelope = { version: 1, file: 'frame-7.jpg' };
    const run = fakeRun([
      { stdout: 'List of devices attached\nSERIAL device model:MAR_LX1A\n' },
      { stdout: '' },
      { stdout: '' },
      { stdout: 'Starting: Intent' },
      { stdout: JSON.stringify(envelope) },
      { stdout: jpeg },
      { stdout: '' },
      { stdout: 'Starting: Intent' },
    ]);
    const bridge = createPhoneBridge({ run, adbPath: 'adb.exe', resolveDeviceIdentity: resolveIdentity });

    await bridge.startSensorCameraStream({ lens: 'front', maxFps: 5 });
    await expect(bridge.readLatestCameraFrame()).resolves.toEqual({ envelope, jpeg });
    await bridge.touchCameraKeepalive();
    await bridge.stopSensorCameraStream();

    expect(run.mock.calls[1][1].at(-1)).toBe(
      "'umask 077; mkdir -p files/camera-stream; rm -f files/camera-stream/latest.json files/camera-stream/frame-*.jpg; touch files/camera-stream/transport.keepalive'",
    );
    // Screen wake-up (display on only — never unlocks/bypasses the keyguard) happens right before the
    // camera-start intent, since a sleeping screen was confirmed live to block CameraX from opening.
    expect(run.mock.calls[2][1]).toEqual(['-s', 'SERIAL', 'shell', 'input', 'keyevent', 'KEYCODE_WAKEUP']);
    expect(run.mock.calls[3][1]).toEqual([
      '-s', 'SERIAL', 'shell', 'am', 'start', '-n', 'fr.mina.gateway/.MainActivity',
      '-f', '0x20000000', '-a', 'fr.mina.gateway.camera.START', '--es', 'lens', 'front',
    ]);
    expect(run.mock.calls[5][1]).toEqual([
      '-s', 'SERIAL', 'exec-out', 'run-as', 'fr.mina.gateway', 'cat', 'files/camera-stream/frame-7.jpg',
    ]);
  });

  it('uses fixed ADB argument arrays for mobile actions', async () => {
    const run = fakeRun([
      { stdout: 'List of devices attached\nSERIAL device model:MAR_LX1A\n' },
      { stdout: '' },
      { stdout: '' },
      { stdout: '' },
    ]);
    const bridge = createPhoneBridge({ run, resolveDeviceIdentity: resolveIdentity });

    await bridge.execute({ name: 'click', x: 100, y: 200 });
    await bridge.execute({ name: 'drag', x: 1, y: 2, endX: 3, endY: 4, durationMs: 500 });
    await bridge.execute({ name: 'scroll', x: 500, y: 1000, scrollX: 0, scrollY: 300 });

    expect(run.mock.calls[1][1]).toEqual(['-s', 'SERIAL', 'shell', 'input', 'tap', '100', '200']);
    expect(run.mock.calls[2][1]).toEqual(['-s', 'SERIAL', 'shell', 'input', 'swipe', '1', '2', '3', '4', '500']);
    expect(run.mock.calls[3][1]).toEqual(['-s', 'SERIAL', 'shell', 'input', 'swipe', '500', '1000', '500', '700', '350']);
  });

  it('types Unicode through a structured base64 gateway command and validates key/app requests', async () => {
    const run = fakeRun([
      { stdout: 'List of devices attached\nSERIAL device model:MAR_LX1A\n' },
      { stdout: '' }, { stdout: '' }, { stdout: '' },
    ]);
    const bridge = createPhoneBridge({ run, resolveDeviceIdentity: resolveIdentity });
    await bridge.execute({ name: 'type_text', text: 'recette gâteau' });
    await bridge.execute({ name: 'key_event', keyCode: 'KEYCODE_ENTER' });
    await bridge.execute({ name: 'launch_app', packageName: 'com.android.chrome', activityName: 'com.google.android.apps.chrome.Main' });

    expect(run.mock.calls[1][1]).toEqual([
      '-s', 'SERIAL', 'shell', 'am', 'broadcast', '-a', 'fr.mina.gateway.ACTION_TYPE_TEXT',
      '--es', 'text_base64', Buffer.from('recette gâteau').toString('base64'),
    ]);
    expect(run.mock.calls[2][1]).toEqual(['-s', 'SERIAL', 'shell', 'input', 'keyevent', 'KEYCODE_ENTER']);
    expect(run.mock.calls[3][1]).toEqual([
      '-s', 'SERIAL', 'shell', 'am', 'start', '-n', 'com.android.chrome/com.google.android.apps.chrome.Main',
    ]);
    await expect(bridge.execute({ name: 'launch_app', packageName: 'x;rm', activityName: 'Main' }))
      .rejects.toThrow('Action téléphone invalide');
  });

  it('accepts normalized Computer Use aliases for typing, Enter, navigation, and Back', async () => {
    const run = fakeRun([
      { stdout: 'List of devices attached\nSERIAL device model:MAR_LX1A\n' },
      { stdout: '' }, { stdout: '' }, { stdout: '' }, { stdout: '' },
    ]);
    const bridge = createPhoneBridge({ run, resolveDeviceIdentity: resolveIdentity });

    await bridge.execute({ name: 'type', text: 'Mina Vision' });
    await bridge.execute({ name: 'key', keys: ['ENTER'] });
    await bridge.execute({ name: 'navigate', url: 'https://youtube.com/' });
    await bridge.execute({ name: 'go_back' });

    expect(run.mock.calls[1][1]).toEqual([
      '-s', 'SERIAL', 'shell', 'am', 'broadcast', '-a', 'fr.mina.gateway.ACTION_TYPE_TEXT',
      '--es', 'text_base64', Buffer.from('Mina Vision').toString('base64'),
    ]);
    expect(run.mock.calls[2][1]).toEqual(['-s', 'SERIAL', 'shell', 'input', 'keyevent', 'KEYCODE_ENTER']);
    expect(run.mock.calls[3][1]).toEqual([
      '-s', 'SERIAL', 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'https://youtube.com/',
    ]);
    expect(run.mock.calls[4][1]).toEqual(['-s', 'SERIAL', 'shell', 'input', 'keyevent', 'KEYCODE_BACK']);
  });

  it('streams confirmed SMS commands over stdin without putting message text in ADB arguments', async () => {
    const run = fakeRun([
      { stdout: 'List of devices attached\nSERIAL device model:MAR_LX1A\n' },
      { stdout: '{"version":1,"id":"cmd-0123456789abcdef0123456789abcdef","state":"queued"}' },
      { stdout: '' },
    ]);
    let streamedPayload;
    const runInput = vi.fn(async (_file, _args, input) => {
      streamedPayload = Buffer.from(input);
      return { stdout: '', stderr: '' };
    });
    const bridge = createPhoneBridge({
      run,
      runInput,
      resolveDeviceIdentity: resolveIdentity,
      createCommandId: () => 'cmd-0123456789abcdef0123456789abcdef',
      now: () => 1_000,
    });

    await expect(bridge.sendSmsConfirmed({
      sourceMessageId: 'sms-42', recipientE164: '+33600000000', text: 'Bien reçu Nasro',
    })).resolves.toMatchObject({ state: 'queued' });

    const [, args] = runInput.mock.calls[0];
    expect(args.join(' ')).not.toContain('Bien reçu Nasro');
    expect(JSON.parse(streamedPayload.toString('utf8'))).toMatchObject({
      action: 'sms.send', confirmed: true, sourceMessageId: 'sms-42', text: 'Bien reçu Nasro',
    });
  });

  it('pulls private phone messages and acknowledges them only after the caller accepts the batch', async () => {
    const run = fakeRun([
      { stdout: 'List of devices attached\nSERIAL device model:MAR_LX1A\n' },
      { stdout: '{"version":1,"id":"pull-0123456789abcdef0123456789abcdef","state":"ok","expiresAtMs":61000,"messages":[{"id":"opaque-1","channel":"sms","sender":"+33600000000","body":"Bonjour Mina","sentAtMs":2000}]}' },
      { stdout: '' },
      { stdout: '{"version":1,"id":"pull-fedcba9876543210fedcba9876543210","state":"ok","expiresAtMs":61000,"acked":1}' },
      { stdout: '' },
    ]);
    const payloads = [];
    const runInput = vi.fn(async (_file, _args, input) => {
      payloads.push(JSON.parse(Buffer.from(input).toString('utf8')));
      return { stdout: '', stderr: '' };
    });
    const ids = ['pull-0123456789abcdef0123456789abcdef', 'pull-fedcba9876543210fedcba9876543210'];
    const bridge = createPhoneBridge({
      run,
      runInput,
      resolveDeviceIdentity: resolveIdentity,
      createTransferId: () => ids.shift(),
      now: () => 1_000,
    });

    const batch = await bridge.pullPendingMessages({ limit: 10 });
    expect(batch.messages).toEqual([expect.objectContaining({ id: 'opaque-1', body: 'Bonjour Mina' })]);
    await expect(bridge.ackPendingMessages({ messageIds: batch.messages.map(({ id }) => id) }))
      .resolves.toMatchObject({ acked: 1 });
    expect(payloads.map(({ action }) => action)).toEqual(['messages.pull', 'messages.ack']);
  });

  it('ensures the Huawei foreground gateway is running before message polling', async () => {
    const run = fakeRun([
      { stdout: 'List of devices attached\nSERIAL device model:MAR_LX1A\n' },
      { stdout: 'Starting service: Intent' },
      { stdout: 'ServiceRecord{42 fr.mina.gateway/.messaging.MinaGatewayService}' },
    ]);
    const bridge = createPhoneBridge({ run, adbPath: 'adb.exe', resolveDeviceIdentity: resolveIdentity });

    await expect(bridge.ensureGatewayService()).resolves.toEqual({ running: true });
    expect(run).toHaveBeenNthCalledWith(2, 'adb.exe', [
      '-s', 'SERIAL', 'shell', 'am', 'broadcast',
      '-a', 'fr.mina.gateway.action.KEEPALIVE',
      '-n', 'fr.mina.gateway/.messaging.GatewayKeepaliveReceiver',
    ], expect.any(Object));
    expect(run).toHaveBeenNthCalledWith(3, 'adb.exe', [
      '-s', 'SERIAL', 'shell', 'dumpsys', 'activity', 'services', 'fr.mina.gateway',
    ], expect.any(Object));
  });

  it('opens the signed Huawei gateway activity only when the foreground service is absent', async () => {
    const run = fakeRun([
      { stdout: 'List of devices attached\nSERIAL device model:MAR_LX1A\n' },
      { stdout: 'Broadcast completed: result=0' },
      { stdout: '' },
      { stdout: 'Starting: Intent' },
    ]);
    const bridge = createPhoneBridge({ run, adbPath: 'adb.exe', resolveDeviceIdentity: resolveIdentity });

    await expect(bridge.ensureGatewayService()).resolves.toEqual({ running: true, recoveredWithActivity: true });
    expect(run).toHaveBeenNthCalledWith(4, 'adb.exe', [
      '-s', 'SERIAL', 'shell', 'am', 'start', '-n', 'fr.mina.gateway/.MainActivity', '-f', '0x20000000',
    ], expect.any(Object));
  });

  it('sends a bounded Telegram reply through the Huawei without exposing the bot token', async () => {
    const run = fakeRun([
      { stdout: 'List of devices attached\nSERIAL device model:MAR_LX1A\n' },
      { stdout: '{"version":1,"id":"msg-0123456789abcdef0123456789abcdef","state":"accepted_by_provider","providerMessageId":"42","expiresAtMs":61000}' },
      { stdout: '' },
    ]);
    let payload;
    const bridge = createPhoneBridge({
      run,
      runInput: vi.fn(async (_file, _args, input) => { payload = JSON.parse(Buffer.from(input).toString('utf8')); }),
      resolveDeviceIdentity: resolveIdentity,
      createTelegramCommandId: () => 'msg-0123456789abcdef0123456789abcdef',
      now: () => 1_000,
    });

    await expect(bridge.sendTelegramMessage({
      sourceMessageId: 'opaque-1', chatId: '123456789', text: 'Bonjour Nasro',
    })).resolves.toEqual({
      id: 'msg-0123456789abcdef0123456789abcdef', state: 'accepted_by_provider', providerMessageId: '42',
    });
    expect(payload).toMatchObject({ action: 'telegram.send', chatId: '123456789', text: 'Bonjour Nasro' });
    expect(JSON.stringify(payload)).not.toContain('bot_token');
  });

  it('surfaces only the bounded Android technical reason when Telegram sending fails', async () => {
    const run = fakeRun([
      { stdout: 'List of devices attached\nSERIAL device model:MAR_LX1A\n' },
      { stdout: '{"version":1,"id":"msg-0123456789abcdef0123456789abcdef","state":"failed","reason":"telegram_chat_not_owned","expiresAtMs":61000}' },
      { stdout: '' },
    ]);
    const bridge = createPhoneBridge({
      run,
      runInput: vi.fn(async () => ({ stdout: '', stderr: '' })),
      resolveDeviceIdentity: resolveIdentity,
      createTelegramCommandId: () => 'msg-0123456789abcdef0123456789abcdef',
      now: () => 1_000,
    });

    await expect(bridge.sendTelegramMessage({
      sourceMessageId: 'opaque-1', chatId: '123456789', text: 'Bonjour',
    })).rejects.toThrow('message_command_failed:telegram_chat_not_owned');
  });

  it('starts and stops a fixed scrcpy preview', async () => {
    const process = new EventEmitter();
    process.kill = vi.fn();
    const spawnPreview = vi.fn(() => process);
    const run = fakeRun([{ stdout: 'List of devices attached\nSERIAL device model:MAR_LX1A\n' }]);
    const bridge = createPhoneBridge({ run, spawnPreview, scrcpyPath: 'scrcpy.exe', resolveDeviceIdentity: resolveIdentity });

    await bridge.startPreview();
    bridge.stopPreview();

    expect(spawnPreview).toHaveBeenCalledWith('scrcpy.exe', ['--serial', 'SERIAL', '--no-audio', '--window-title', 'Mina — caméra téléphone']);
    expect(process.kill).toHaveBeenCalledTimes(1);
  });
});
