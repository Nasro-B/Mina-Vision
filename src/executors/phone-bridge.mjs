import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createPhysicalDeviceRegistry } from '../devices/physical-device-registry.mjs';
import { classifyAdbEndpoint, createAndroidTransport } from '../devices/android-transport.mjs';
import { verifyDeviceProof } from '../devices/device-identity-proof.mjs';
import { execFile as execFileArp } from 'node:child_process';
import { ouiOf, parseAdbMdnsEndpoints, parseArpTable } from './adb-mdns-peer.mjs';

// Appareils du réseau à ne JAMAIS toucher, par OUI MAC (3 premiers octets).
//   - 09:8d:05 → télé Condor de Nasro (consigne du 2026-07-24 : ne rien y installer, ne pas la
//     connecter). Extensible via MINA_ADB_EXCLUDE_OUI (séparés par « , » ou « ; »).
const DEFAULT_EXCLUDED_OUI = Object.freeze(['09:8d:05']);

const defaultReadArpTable = () => new Promise((resolve) => {
  execFileArp('arp', ['-a'], { encoding: 'utf8', windowsHide: true, timeout: 5_000 }, (error, stdout) => {
    resolve(error ? new Map() : parseArpTable(stdout));
  });
});

const SERIAL_PATTERN = /^[A-Za-z0-9._:-]+$/;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/u;
const CAMERA_FRAME_FILE = /^frame-[1-9][0-9]*\.jpg$/u;
const CAMERA_KEEPALIVE_SCRIPT = 'umask 077; mkdir -p files/camera-stream; touch files/camera-stream/transport.keepalive';
const CAMERA_START_SCRIPT = 'umask 077; mkdir -p files/camera-stream; rm -f files/camera-stream/latest.json files/camera-stream/frame-*.jpg; touch files/camera-stream/transport.keepalive';
const ANDROID_KEYS = Object.freeze({
  ENTER: 'KEYCODE_ENTER',
  RETURN: 'KEYCODE_ENTER',
  BACK: 'KEYCODE_BACK',
  HOME: 'KEYCODE_HOME',
  TAB: 'KEYCODE_TAB',
  ESC: 'KEYCODE_ESCAPE',
  ESCAPE: 'KEYCODE_ESCAPE',
  DELETE: 'KEYCODE_DEL',
  BACKSPACE: 'KEYCODE_DEL',
  SPACE: 'KEYCODE_SPACE',
});

const isPrivateIpv4 = (address) => {
  const octets = String(address).split('.').map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  return octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
};

const normalizePrivateEndpoint = (value) => {
  const match = String(value ?? '').match(/^([0-9]{1,3}(?:\.[0-9]{1,3}){3}):5555$/u);
  if (!match || !isPrivateIpv4(match[1])) return null;
  return `${match[1]}:5555`;
};

const wifiEndpointFromIpOutput = (stdout) => {
  const addresses = [...String(stdout).matchAll(/\binet\s+([0-9]{1,3}(?:\.[0-9]{1,3}){3})\//gu)];
  const address = addresses.map((match) => match[1]).find(isPrivateIpv4);
  if (!address) throw new Error('adb_wifi_private_address_unavailable');
  return `${address}:5555`;
};

const defaultRun = (file, args, { binary = false } = {}) => new Promise((resolve, reject) => {
  execFile(file, args, {
    encoding: binary ? null : 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
  }, (error, stdout, stderr) => {
    if (error) {
      reject(new Error(`Commande téléphone échouée: ${String(stderr || error.message).slice(0, 300)}`));
      return;
    }
    resolve({ stdout, stderr });
  });
});

const defaultSpawnPreview = (file, args) => spawn(file, args, {
  stdio: 'ignore',
  windowsHide: false,
});

const defaultRunInput = (file, args, input) => new Promise((resolve, reject) => {
  const child = spawn(file, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const stdout = [];
  const stderr = [];
  let outputBytes = 0;
  const collect = (target) => (chunk) => {
    outputBytes += chunk.length;
    if (outputBytes > 1024 * 1024) {
      child.kill();
      reject(new Error('Sortie commande téléphone trop volumineuse.'));
      return;
    }
    target.push(Buffer.from(chunk));
  };
  child.stdout.on('data', collect(stdout));
  child.stderr.on('data', collect(stderr));
  child.once('error', reject);
  child.once('exit', (code) => {
    const errorText = Buffer.concat(stderr).toString('utf8');
    if (code !== 0) reject(new Error(`Commande téléphone échouée: ${errorText.slice(0, 300)}`));
    else resolve({ stdout: Buffer.concat(stdout).toString('utf8'), stderr: errorText });
  });
  child.stdin.end(input);
});

const parseDevices = (stdout) => String(stdout)
  .split(/\r?\n/)
  .slice(1)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const [serial, status, ...metadata] = line.split(/\s+/);
    const modelToken = metadata.find((token) => token.startsWith('model:'));
    return { serial, status, model: modelToken?.slice(6) || null };
  });

const pngDimensions = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error('Capture téléphone PNG invalide.');
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
};

export function createPhoneBridge({
  run = defaultRun,
  runInput = defaultRunInput,
  spawnPreview = defaultSpawnPreview,
  adbPath = 'adb',
  scrcpyPath = 'scrcpy',
  physicalDeviceRegistry = createPhysicalDeviceRegistry(),
  resolveDeviceIdentity = null,
  // Packages Mina Gateway à tenter pour `run-as` : la variante debug installée est `fr.mina.gateway.debug`
  // (suffixe applicationIdSuffix). `run-as fr.mina.gateway` échoue alors « unknown package » et l'app ne
  // détecte AUCUN téléphone. On tente donc les deux (prouvé 2026-08-21 : seule .debug répond sur les tél).
  identityPackages = String(process.env.MINA_GATEWAY_PACKAGES ?? 'fr.mina.gateway,fr.mina.gateway.debug')
    .split(/[;,]/u).map((value) => value.trim()).filter(Boolean),
  createCommandId = () => `cmd-${randomBytes(16).toString('hex')}`,
  createTransferId = () => `pull-${randomBytes(16).toString('hex')}`,
  createTelegramCommandId = () => `msg-${randomBytes(16).toString('hex')}`,
  now = Date.now,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  readArpTable = defaultReadArpTable,
  excludedOui = [
    ...DEFAULT_EXCLUDED_OUI,
    ...String(process.env.MINA_ADB_EXCLUDE_OUI ?? '').split(/[;,]/u).map((value) => value.trim().toLowerCase()).filter(Boolean),
  ],
  // Hôtes ADB Wi-Fi STATIQUES (host:port) à tenter en plus du mDNS : le Samsung en mode tcpip et le
  // Huawei ne s'annoncent PAS en mDNS (prouvé 2026-07-22), donc « Détecter » ne les voyait jamais par
  // Wi-Fi. Renseigner MINA_ADB_WIFI_HOSTS=192.168.1.10:5555,192.168.1.11:5555 les rend détectables.
  wifiHosts = String(process.env.MINA_ADB_WIFI_HOSTS ?? '').split(/[;,]/u).map((value) => value.trim()).filter(Boolean),
} = {}) {
  const excludedOuiSet = new Set(excludedOui);
  const staticWifiHosts = wifiHosts.filter((host) => /^\d{1,3}(?:\.\d{1,3}){3}:\d{1,5}$/u.test(host));
  let device = null;
  let preview = null;
  // Package Mina Gateway EFFECTIF, découvert par le résolveur (fr.mina.gateway ou .debug) : TOUTES les
  // opérations (run-as, am start/broadcast, dumpsys, vérif service) doivent viser ce package, sinon
  // « unknown package » sur la variante debug. Les chaînes d'ACTION restent littérales (non suffixées).
  let activeGatewayPackage = identityPackages[0] ?? 'fr.mina.gateway';
  const gatewayComponent = (relativeClass) => `${activeGatewayPackage}/${relativeClass}`;
  const activeIdentityResolver = resolveDeviceIdentity ?? (async ({ serial }) => {
    let lastError = null;
    for (const gatewayPackage of identityPackages) {
      let stdout;
      try {
        ({ stdout } = await run(adbPath, [
          '-s', serial, 'shell', 'run-as', gatewayPackage, 'cat', 'files/device-identity.json',
        ], { binary: false }));
      } catch (error) { lastError = error; continue; } // package absent/non debuggable → tenter le suivant
      const text = String(stdout);
      // `run-as: unknown package` / `not debuggable` reviennent parfois sur stdout selon le shell.
      if (!text.trim() || /unknown package|not debuggable|is not debuggable|Package .* is unknown/iu.test(text)) {
        lastError = new Error(`run_as_unavailable:${gatewayPackage}`); continue;
      }
      if (Buffer.byteLength(text, 'utf8') > 16 * 1024) throw new Error('Identité Mina Gateway invalide.');
      let proof;
      try { proof = JSON.parse(text); } catch { lastError = new Error('Identité Mina Gateway illisible.'); continue; }
      if (proof.challenge !== 'local-pairing-v1' || !verifyDeviceProof(proof)) {
        throw new Error('Signature identité Mina Gateway invalide.');
      }
      activeGatewayPackage = gatewayPackage; // package qui a répondu → utilisé par toutes les opérations
      return { deviceId: proof.deviceId, verified: true, publicKeySpkiBase64: proof.publicKeySpkiBase64 };
    }
    throw lastError ?? new Error('Identité Mina Gateway introuvable.');
  });

  const scanDevices = async () => {
    const { stdout } = await run(adbPath, ['devices', '-l'], { binary: false });
    return parseDevices(stdout);
  };

  const detect = async () => {
    const devices = await scanDevices();
    const authorized = devices.filter((candidate) => candidate.status === 'device');

    if (devices.some((candidate) => candidate.status === 'unauthorized')) {
      throw new Error('Le téléphone doit être déverrouillé et autorisé en ADB.');
    }
    if (authorized.length < 1) throw new Error('Mina exige une identité physique ADB autorisée.');
    const transport = createAndroidTransport({ registry: physicalDeviceRegistry, verifyDeviceIdentity: activeIdentityResolver });
    const minaEndpoints = [];
    for (const candidate of authorized) {
      if (!SERIAL_PATTERN.test(candidate.serial)) throw new Error('Identifiant téléphone invalide.');
      try {
        await transport.observe({
          serial: candidate.serial,
          model: candidate.model,
          type: classifyAdbEndpoint(candidate.serial),
        });
        minaEndpoints.push(candidate.serial);
      } catch {
        // Other ADB-authorized phones may remain connected for normal use. Only a device carrying
        // Mina Gateway's signed identity is eligible for camera, SMS and Telegram transport.
      }
    }
    if (minaEndpoints.length < 1) throw new Error('Mina exige une identité Mina Gateway signée et autorisée.');
    // A serial seen in a past scan but absent from this one (USB unplugged, phone off the LAN) must
    // stop being "preferred" — without this, preferredTransport() keeps returning a dead endpoint
    // forever (USB always sorts first and defaults healthy:true at observation time).
    physicalDeviceRegistry.pruneAbsentEndpoints(minaEndpoints);
    let owner;
    try {
      owner = physicalDeviceRegistry.resolveOwnerDevice();
    } catch (error) {
      if (error.message !== 'physical_device_ambiguous') throw error;
      // PLUSIEURS téléphones Mina connectés (générique — n'importe qui peut en avoir deux). On ne casse
      // PLUS : on choisit un PRIMAIRE DÉTERMINISTE = le premier par deviceId trié (stable, jamais « le
      // premier du scan » arbitraire). Les autres restent connus dans la registry pour le multi-appareils.
      const known = physicalDeviceRegistry.listDevices();
      if (known.length === 0) throw error;
      owner = known[0];
    }
    const preferred = physicalDeviceRegistry.preferredTransport(owner.deviceId);
    device = Object.freeze({
      serial: preferred.serial,
      model: preferred.model,
      deviceId: owner.deviceId,
      transports: Object.freeze(owner.endpoints.map(({ type }) => type)),
    });
    return device;
  };

  const ensureWifiConnection = async ({ rememberedEndpoint = null, expectedDeviceId = null } = {}) => {
    const remembered = rememberedEndpoint === null ? null : normalizePrivateEndpoint(rememberedEndpoint);
    if (rememberedEndpoint !== null && !remembered) throw new TypeError('adb_wifi_endpoint_invalid');
    if (expectedDeviceId !== null && !DEVICE_ID_PATTERN.test(expectedDeviceId)) throw new TypeError('adb_wifi_device_id_invalid');
    let devices = await scanDevices();
    let authorized = devices.filter((candidate) => candidate.status === 'device');
    const currentLan = authorized.find((candidate) => classifyAdbEndpoint(candidate.serial) === 'lan');
    if (currentLan) {
      const current = await detect();
      if (expectedDeviceId && current.deviceId !== expectedDeviceId) {
        await run(adbPath, ['disconnect', currentLan.serial], { binary: false }).catch(() => {});
        throw new Error('adb_wifi_identity_mismatch');
      }
      return Object.freeze({ connected: true, endpoint: currentLan.serial, deviceId: current.deviceId, transports: current.transports });
    }

    if (remembered) {
      try {
        await run(adbPath, ['connect', remembered], { binary: false });
        const current = await detect();
        if (!current.transports.includes('lan')) throw new Error('adb_wifi_endpoint_not_visible');
        if (expectedDeviceId && current.deviceId !== expectedDeviceId) throw new Error('adb_wifi_identity_mismatch');
        return Object.freeze({ connected: true, endpoint: remembered, deviceId: current.deviceId, transports: current.transports });
      } catch (error) {
        await run(adbPath, ['disconnect', remembered], { binary: false }).catch(() => {});
        if (error?.message === 'adb_wifi_identity_mismatch') throw error;
        devices = await scanDevices();
        authorized = devices.filter((candidate) => candidate.status === 'device');
      }
    }

    const usbCandidates = authorized.filter((candidate) => classifyAdbEndpoint(candidate.serial) === 'usb');
    if (usbCandidates.length < 1) throw new Error('adb_wifi_requires_authorized_usb');
    const currentUsb = await detect();
    if (classifyAdbEndpoint(currentUsb.serial) !== 'usb') throw new Error('adb_wifi_requires_authorized_usb');
    if (expectedDeviceId && currentUsb.deviceId !== expectedDeviceId) throw new Error('adb_wifi_identity_mismatch');
    const { stdout } = await run(adbPath, [
      '-s', currentUsb.serial, 'shell', 'ip', '-4', 'addr', 'show', 'wlan0',
    ], { binary: false });
    const endpoint = wifiEndpointFromIpOutput(stdout);
    await run(adbPath, ['-s', currentUsb.serial, 'tcpip', '5555'], { binary: false });

    let lastError;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await wait(500);
      try {
        await run(adbPath, ['connect', endpoint], { binary: false });
        const current = await detect();
        if (current.deviceId !== currentUsb.deviceId || !current.transports.includes('lan')) {
          throw new Error('adb_wifi_identity_mismatch');
        }
        return Object.freeze({ connected: true, endpoint, deviceId: current.deviceId, transports: current.transports });
      } catch (error) {
        lastError = error;
      }
    }
    await run(adbPath, ['disconnect', endpoint], { binary: false }).catch(() => {});
    throw new Error(`adb_wifi_connect_failed:${String(lastError?.message ?? 'unknown').slice(0, 160)}`);
  };

  /**
   * Découverte Wi-Fi : connecte les téléphones qui s'annoncent en mDNS (débogage sans fil), sans
   * exiger l'USB. Best-effort — mDNS absent (ADB ancien, pare-feu) ou endpoint injoignable ne
   * fait JAMAIS échouer la détection, qui retombe alors sur ce qui est déjà branché.
   *
   * Aucune confiance accordée par la simple annonce : on se connecte, puis `detect()` vérifie
   * l'identité signée Mina. Un endpoint qui n'est pas un téléphone Mina est ensuite ignoré.
   */
  const discoverWifiPhones = async () => {
    let announced = [];
    try {
      const { stdout } = await run(adbPath, ['mdns', 'services'], { binary: false });
      announced = parseAdbMdnsEndpoints(stdout);
    } catch {
      // mDNS indisponible n'empêche plus la découverte : les hôtes statiques restent tentés.
      announced = [];
    }
    // Hôtes statiques d'abord (les téléphones hors mDNS), puis les annoncés — dédupliqués.
    announced = [...new Set([...staticWifiHosts, ...announced])];
    if (announced.length === 0) {
      return Object.freeze({ discovered: 0, connected: 0, excluded: 0, endpoints: Object.freeze([]) });
    }
    // Table ARP pour écarter les appareils interdits (télé Condor 09:8d:05, etc.) AVANT tout
    // adb connect : Mina ne doit ni les toucher ni rien y installer.
    const arpTable = excludedOuiSet.size > 0 ? await readArpTable().catch(() => new Map()) : new Map();
    const isExcluded = (endpoint) => {
      const oui = ouiOf(arpTable.get(endpoint.split(':')[0]));
      return oui !== null && excludedOuiSet.has(oui);
    };

    const connected = [];
    let excluded = 0;
    for (const endpoint of announced) {
      if (isExcluded(endpoint)) {
        // Appareil sur liste d'exclusion (ex. télé Condor) : jamais de connexion, jamais d'install.
        excluded += 1;
        continue;
      }
      try {
        await run(adbPath, ['connect', endpoint], { binary: false });
        connected.push(endpoint);
      } catch {
        // Annoncé mais injoignable (déjà déconnecté, non appairé) : on n'entrave pas les autres.
      }
    }
    return Object.freeze({
      discovered: announced.length,
      connected: connected.length,
      excluded,
      endpoints: Object.freeze(connected),
    });
  };

  const getDevice = async () => device || detect();

  const submitMessageCommand = async (command, expectedState = 'ok') => {
    if (!/^(?:pull|msg)-[a-f0-9]{32}$/u.test(command?.id ?? '')) throw new Error('message_command_id_invalid');
    const payload = Buffer.from(JSON.stringify(command), 'utf8');
    if (payload.length > 16 * 1024) throw new Error('message_command_too_large');
    const current = await getDevice();
    const commandPath = `files/message-commands/${command.id}.json`;
    const receiptPath = `files/message-receipts/${command.id}.json`;
    const shellScript = `umask 077; mkdir -p files/message-commands files/message-receipts; cat > ${commandPath}.tmp && mv ${commandPath}.tmp ${commandPath}`;
    try {
      await runInput(adbPath, [
        '-s', current.serial, 'shell', 'run-as', activeGatewayPackage, 'sh', '-c', `'${shellScript}'`,
      ], payload);
    } finally {
      payload.fill(0);
    }
    let receipt;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        const result = await run(adbPath, [
          '-s', current.serial, 'shell', 'run-as', activeGatewayPackage, 'cat', receiptPath,
        ], { binary: false });
        receipt = JSON.parse(String(result.stdout));
        break;
      } catch {
        await wait(250);
      }
    }
    await run(adbPath, [
      '-s', current.serial, 'shell', 'run-as', activeGatewayPackage, 'rm', '-f', commandPath, receiptPath,
    ], { binary: false }).catch(() => {});
    if (receipt?.state === 'failed' && /^[a-z][a-z0-9_]{2,80}$/u.test(receipt.reason ?? '')) {
      throw new Error(`message_command_failed:${receipt.reason}`);
    }
    if (receipt?.version !== 1 || receipt.id !== command.id || receipt.state !== expectedState
      || !Number.isSafeInteger(receipt.expiresAtMs) || receipt.expiresAtMs <= now()) {
      throw new Error('message_command_receipt_invalid');
    }
    return receipt;
  };

  const openSystemCameraPreview = async () => {
    const current = await getDevice();
    await run(adbPath, [
      '-s', current.serial,
      'shell', 'am', 'start', '-a', 'android.media.action.STILL_IMAGE_CAMERA',
    ], { binary: false });
    return { started: true };
  };

  return Object.freeze({
    detect,
    // Journal d'appels d'un téléphone (SPEC-MINA-COMMS-001 §8.5) : LECTURE SEULE via le provider
    // système, requête 100% FIXE (aucune interpolation d'entrée → zéro injection shell). Renvoie le
    // stdout brut ; le parsing/ingestion vit dans le domaine communications. `serial` est EXPLICITE
    // (générique multi-appareils : l'appelant vise un téléphone précis, jamais « le premier »).
    // Bloqué sur certains EMUI (Huawei « Error while accessing provider:call_log ») → l'appelant DOIT
    // rester best-effort et ne jamais transformer un échec en martèlement.
    queryCallLog: async (serial) => {
      if (!/^[A-Za-z0-9._:-]{1,160}$/u.test(serial ?? '')) throw new TypeError('call_log_serial_invalid');
      const { stdout } = await run(adbPath, [
        '-s', serial, 'shell', 'content', 'query',
        '--uri', 'content://call_log/calls',
        '--projection', 'number:type:date:duration',
      ], { binary: false });
      return String(stdout ?? '');
    },
    discoverWifiPhones,
    ensureWifiConnection,
    ensureGatewayService: async () => {
      const current = await getDevice();
      await run(adbPath, [
        '-s', current.serial, 'shell', 'am', 'broadcast',
        '-a', 'fr.mina.gateway.action.KEEPALIVE',
        '-n', gatewayComponent('.messaging.GatewayKeepaliveReceiver'),
      ], { binary: false });
      const { stdout } = await run(adbPath, [
        '-s', current.serial, 'shell', 'dumpsys', 'activity', 'services', activeGatewayPackage,
      ], { binary: false });
      if (!String(stdout).includes(gatewayComponent('.messaging.MinaGatewayService'))) {
        await run(adbPath, [
          '-s', current.serial, 'shell', 'am', 'start', '-n', gatewayComponent('.MainActivity'), '-f', '0x20000000',
        ], { binary: false });
        return Object.freeze({ running: true, recoveredWithActivity: true });
      }
      return Object.freeze({ running: true });
    },
    openSystemCameraPreview,
    startCamera: openSystemCameraPreview,
    startSensorCameraStream: async ({ lens = 'front', maxFps = 5 } = {}) => {
      if (!['front', 'back'].includes(lens) || !Number.isInteger(maxFps) || maxFps < 1 || maxFps > 5) {
        throw new TypeError('camera_stream_request_invalid');
      }
      const current = await getDevice();
      await run(adbPath, [
        '-s', current.serial, 'shell', 'run-as', activeGatewayPackage, 'sh', '-c', `'${CAMERA_START_SCRIPT}'`,
      ], { binary: false });
      // A sleeping screen blocks CameraX from opening the sensor at all (confirmed live: zero frames
      // written until woken) — this only wakes the display, it never unlocks or bypasses the keyguard.
      await run(adbPath, ['-s', current.serial, 'shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'], { binary: false });
      await run(adbPath, [
        '-s', current.serial, 'shell', 'am', 'start', '-n', gatewayComponent('.MainActivity'),
        '-f', '0x20000000', '-a', 'fr.mina.gateway.camera.START', '--es', 'lens', lens,
      ], { binary: false });
      return Object.freeze({ sessionRequested: true, lens, maxFps });
    },
    touchCameraKeepalive: async () => {
      const current = await getDevice();
      await run(adbPath, [
        '-s', current.serial, 'shell', 'run-as', activeGatewayPackage, 'sh', '-c', `'${CAMERA_KEEPALIVE_SCRIPT}'`,
      ], { binary: false });
    },
    readLatestCameraFrame: async () => {
      const current = await getDevice();
      let envelope;
      try {
        const { stdout } = await run(adbPath, [
          '-s', current.serial, 'shell', 'run-as', activeGatewayPackage, 'cat', 'files/camera-stream/latest.json',
        ], { binary: false });
        if (Buffer.byteLength(String(stdout), 'utf8') > 16 * 1024) throw new Error('camera_envelope_too_large');
        envelope = JSON.parse(String(stdout));
      } catch (error) {
        if (/No such file|cannot open|does not exist/u.test(String(error?.message))) return null;
        throw new Error('camera_envelope_invalid');
      }
      if (!CAMERA_FRAME_FILE.test(envelope?.file ?? '')) throw new Error('camera_frame_file_invalid');
      const { stdout } = await run(adbPath, [
        '-s', current.serial, 'exec-out', 'run-as', activeGatewayPackage, 'cat', `files/camera-stream/${envelope.file}`,
      ], { binary: true });
      const jpeg = Buffer.from(stdout);
      if (jpeg.length > 350 * 1024) throw new Error('camera_frame_too_large');
      return Object.freeze({ envelope, jpeg });
    },
    stopSensorCameraStream: async () => {
      const current = await getDevice();
      await run(adbPath, [
        '-s', current.serial, 'shell', 'am', 'start', '-n', gatewayComponent('.MainActivity'),
        '-f', '0x20000000', '-a', 'fr.mina.gateway.camera.STOP',
      ], { binary: false });
      return Object.freeze({ stopped: true });
    },
    observe: async () => {
      const current = await getDevice();
      const { stdout } = await run(adbPath, [
        '-s', current.serial, 'exec-out', 'screencap', '-p',
      ], { binary: true });
      const buffer = Buffer.from(stdout);
      const dimensions = pngDimensions(buffer);
      return {
        imageBase64: buffer.toString('base64'),
        mimeType: 'image/png',
        ...dimensions,
      };
    },
    execute: async (action) => {
      const current = await getDevice();
      let args;
      if (action?.name === 'click') {
        args = ['-s', current.serial, 'shell', 'input', 'tap', String(action.x), String(action.y)];
      } else if (action?.name === 'drag') {
        args = [
          '-s', current.serial, 'shell', 'input', 'swipe',
          String(action.x), String(action.y), String(action.endX), String(action.endY),
          String(action.durationMs || 500),
        ];
      } else if (action?.name === 'scroll') {
        const x = Math.max(0, Math.round(Number(action.x) || 500));
        const y = Math.max(0, Math.round(Number(action.y) || 1_000));
        const endX = Math.max(0, x - (Number(action.scrollX) || 0));
        const endY = Math.max(0, y - (Number(action.scrollY) || 0));
        args = [
          '-s', current.serial, 'shell', 'input', 'swipe',
          String(x), String(y), String(endX), String(endY), '350',
        ];
      } else if (action?.name === 'type_text' || action?.name === 'type') {
        if (typeof action.text !== 'string' || action.text.length < 1 || action.text.length > 4_000 || action.text.includes('\0')) {
          throw new Error('Action téléphone invalide: type_text');
        }
        args = [
          '-s', current.serial, 'shell', 'am', 'broadcast', '-a', 'fr.mina.gateway.ACTION_TYPE_TEXT',
          '--es', 'text_base64', Buffer.from(action.text, 'utf8').toString('base64'),
        ];
      } else if (action?.name === 'key_event' || action?.name === 'key') {
        const normalizedKeys = Array.isArray(action.keys) ? action.keys.map((key) => String(key).toUpperCase()) : [];
        if (action.name === 'key' && normalizedKeys.length !== 1) throw new Error('Action téléphone invalide: key');
        const keyCode = String(action.keyCode ?? ANDROID_KEYS[normalizedKeys[0]] ?? '');
        if (!/^KEYCODE_[A-Z0-9_]{1,80}$/u.test(keyCode) && !/^(?:[0-9]|[1-2][0-9]{1,2}|300)$/u.test(keyCode)) {
          throw new Error('Action téléphone invalide: key_event');
        }
        args = ['-s', current.serial, 'shell', 'input', 'keyevent', keyCode];
      } else if (action?.name === 'navigate') {
        let url;
        try { url = new URL(action.url); } catch { throw new Error('Action téléphone invalide: navigate'); }
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Action téléphone invalide: navigate');
        args = ['-s', current.serial, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', url.href];
      } else if (action?.name === 'go_back') {
        args = ['-s', current.serial, 'shell', 'input', 'keyevent', 'KEYCODE_BACK'];
      } else if (action?.name === 'launch_app') {
        const componentPart = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/u;
        if (!componentPart.test(action.packageName ?? '') || !componentPart.test(action.activityName ?? '')) {
          throw new Error('Action téléphone invalide: launch_app');
        }
        args = ['-s', current.serial, 'shell', 'am', 'start', '-n', `${action.packageName}/${action.activityName}`];
      } else {
        throw new Error(`Action téléphone interdite: ${action?.name}`);
      }
      await run(adbPath, args, { binary: false });
      return { executed: true };
    },
    sendSmsConfirmed: async ({ sourceMessageId, recipientE164, text } = {}) => {
      if (!/^[A-Za-z0-9._:-]{1,160}$/u.test(sourceMessageId ?? '')
        || !/^\+[1-9][0-9]{7,14}$/u.test(recipientE164 ?? '')
        || typeof text !== 'string' || text.length < 1 || text.length > 1_600 || text.includes('\0')) {
        throw new TypeError('sms_confirmed_request_invalid');
      }
      const id = createCommandId();
      if (!/^cmd-[a-f0-9]{32}$/u.test(id)) throw new Error('sms_command_id_invalid');
      const createdAtMs = now();
      if (!Number.isSafeInteger(createdAtMs) || createdAtMs < 1) throw new Error('sms_command_clock_invalid');
      const command = {
        version: 1,
        id,
        action: 'sms.send',
        sourceMessageId,
        recipientE164,
        text,
        confirmed: true,
        createdAtMs,
        expiresAtMs: createdAtMs + 60_000,
      };
      const payload = Buffer.from(JSON.stringify(command), 'utf8');
      if (payload.length > 16 * 1024) throw new Error('sms_command_too_large');
      const current = await getDevice();
      const commandPath = `files/commands/${id}.json`;
      const receiptPath = `files/receipts/${id}.json`;
      const shellScript = `umask 077; mkdir -p files/commands files/receipts; cat > ${commandPath}.tmp && mv ${commandPath}.tmp ${commandPath}`;
      try {
        await runInput(adbPath, [
          '-s', current.serial, 'shell', 'run-as', activeGatewayPackage, 'sh', '-c', `'${shellScript}'`,
        ], payload);
      } finally {
        payload.fill(0);
      }
      let receipt;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        try {
          const result = await run(adbPath, [
            '-s', current.serial, 'shell', 'run-as', activeGatewayPackage, 'cat', receiptPath,
          ], { binary: false });
          receipt = JSON.parse(String(result.stdout));
          break;
        } catch {
          await wait(250);
        }
      }
      await run(adbPath, [
        '-s', current.serial, 'shell', 'run-as', activeGatewayPackage, 'rm', '-f', commandPath, receiptPath,
      ], { binary: false }).catch(() => {});
      if (receipt?.version !== 1 || receipt.id !== id || !['queued', 'duplicate', 'failed'].includes(receipt.state)) {
        throw new Error('sms_command_receipt_invalid');
      }
      if (receipt.state === 'failed') throw new Error(`sms_dispatch_failed:${String(receipt.reason ?? 'unknown').slice(0, 80)}`);
      return Object.freeze({ id, state: receipt.state, acceptedByAndroid: receipt.state === 'queued' });
    },
    pullPendingMessages: async ({ limit = 50 } = {}) => {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new TypeError('message_pull_limit_invalid');
      const id = createTransferId();
      const createdAtMs = now();
      const receipt = await submitMessageCommand({
        version: 1,
        id,
        action: 'messages.pull',
        limit,
        createdAtMs,
        expiresAtMs: createdAtMs + 60_000,
      });
      if (Object.keys(receipt).sort().join(',') !== 'expiresAtMs,id,messages,state,version'
        || !Array.isArray(receipt.messages) || receipt.messages.length > limit) {
        throw new Error('message_pull_receipt_invalid');
      }
      const messages = receipt.messages.map((message) => {
        if (!message || Object.keys(message).sort().join(',') !== 'body,channel,id,sender,sentAtMs'
          || !/^[A-Za-z0-9+/=_:-]{1,160}$/u.test(message.id ?? '')
          || !['sms', 'telegram'].includes(message.channel)
          || typeof message.sender !== 'string' || message.sender.length < 1 || message.sender.length > 160
          || typeof message.body !== 'string' || message.body.length < 1 || message.body.length > 4_096
          || !Number.isSafeInteger(message.sentAtMs) || message.sentAtMs < 1) {
          throw new Error('message_pull_payload_invalid');
        }
        return Object.freeze({ ...message });
      });
      return Object.freeze({ batchId: id, messages: Object.freeze(messages) });
    },
    ackPendingMessages: async ({ messageIds } = {}) => {
      if (!Array.isArray(messageIds) || messageIds.length < 1 || messageIds.length > 50
        || messageIds.some((id) => !/^[A-Za-z0-9+/=_:-]{1,160}$/u.test(id))) {
        throw new TypeError('message_ack_ids_invalid');
      }
      const id = createTransferId();
      const createdAtMs = now();
      const receipt = await submitMessageCommand({
        version: 1,
        id,
        action: 'messages.ack',
        messageIds: [...new Set(messageIds)],
        createdAtMs,
        expiresAtMs: createdAtMs + 60_000,
      });
      if (Object.keys(receipt).sort().join(',') !== 'acked,expiresAtMs,id,state,version'
        || !Number.isSafeInteger(receipt.acked) || receipt.acked < 0 || receipt.acked > messageIds.length) {
        throw new Error('message_ack_receipt_invalid');
      }
      return Object.freeze({ batchId: id, acked: receipt.acked });
    },
    sendTelegramMessage: async ({ sourceMessageId, chatId, text } = {}) => {
      if (!/^[A-Za-z0-9+/=_:-]{1,160}$/u.test(sourceMessageId ?? '')
        || !/^[1-9][0-9]{0,18}$/u.test(chatId ?? '')
        || BigInt(chatId) > 9_223_372_036_854_775_807n
        || typeof text !== 'string' || text.length < 1 || text.length > 4_096 || text.includes('\0')) {
        throw new TypeError('telegram_send_request_invalid');
      }
      const id = createTelegramCommandId();
      if (!/^msg-[a-f0-9]{32}$/u.test(id)) throw new Error('telegram_command_id_invalid');
      const createdAtMs = now();
      const receipt = await submitMessageCommand({
        version: 1,
        id,
        action: 'telegram.send',
        sourceMessageId,
        chatId,
        text,
        createdAtMs,
        expiresAtMs: createdAtMs + 60_000,
      }, 'accepted_by_provider');
      if (Object.keys(receipt).sort().join(',') !== 'expiresAtMs,id,providerMessageId,state,version'
        || !/^[1-9][0-9]{0,18}$/u.test(receipt.providerMessageId ?? '')) {
        throw new Error('telegram_send_receipt_invalid');
      }
      return Object.freeze({ id, state: receipt.state, providerMessageId: receipt.providerMessageId });
    },
    startPreview: async () => {
      if (preview) return { started: false };
      const current = await getDevice();
      preview = spawnPreview(scrcpyPath, [
        '--serial', current.serial,
        '--no-audio',
        '--window-title', 'Mina — caméra téléphone',
      ]);
      preview.once?.('exit', () => { preview = null; });
      return { started: true };
    },
    stopPreview: () => {
      if (!preview) return;
      const current = preview;
      preview = null;
      current.kill();
    },
  });
}

export function createAdbWifiKeeper({
  bridge,
  loadEndpoint,
  saveEndpoint,
  onStatus = () => {},
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  intervalMs = 5_000,
} = {}) {
  if (!bridge?.ensureWifiConnection || typeof loadEndpoint !== 'function' || typeof saveEndpoint !== 'function'
    || typeof onStatus !== 'function' || typeof setIntervalFn !== 'function' || typeof clearIntervalFn !== 'function'
    || !Number.isInteger(intervalMs) || intervalMs < 1_000 || intervalMs > 60_000) {
    throw new TypeError('adb_wifi_keeper_dependencies_invalid');
  }
  let timer = null;
  let inFlight = null;
  let lastStatusKey = null;

  const emit = (status) => {
    const key = JSON.stringify(status);
    if (key === lastStatusKey) return;
    lastStatusKey = key;
    onStatus(Object.freeze(status));
  };
  const reconnect = () => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const remembered = await loadEndpoint();
        const status = await bridge.ensureWifiConnection({
          rememberedEndpoint: remembered?.endpoint ?? null,
          expectedDeviceId: remembered?.deviceId ?? null,
        });
        await saveEndpoint(status.endpoint, status.deviceId);
        emit(status);
        return status;
      } catch (error) {
        const status = Object.freeze({ connected: false, reason: String(error?.message ?? error).slice(0, 200) });
        emit(status);
        return status;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };

  return Object.freeze({
    start: async () => {
      if (timer === null) timer = setIntervalFn(() => { void reconnect(); }, intervalMs);
      return reconnect();
    },
    reconnectNow: reconnect,
    stop: () => {
      if (timer === null) return;
      clearIntervalFn(timer);
      timer = null;
    },
  });
}

export function createAdbWifiEndpointStore({ filename, readText, writeAtomic, now = Date.now } = {}) {
  if (typeof filename !== 'string' || !filename || typeof readText !== 'function'
    || typeof writeAtomic !== 'function' || typeof now !== 'function') {
    throw new TypeError('adb_wifi_endpoint_store_dependencies_invalid');
  }
  return Object.freeze({
    loadEndpoint: async () => {
      let raw;
      try {
        raw = await readText(filename);
      } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
      }
      if (!String(raw).trim()) return null;
      let record;
      try { record = JSON.parse(raw); } catch { throw new Error('adb_wifi_endpoint_state_invalid'); }
      const endpoint = normalizePrivateEndpoint(record?.endpoint);
      if (record?.version !== 1 || !endpoint || !DEVICE_ID_PATTERN.test(record?.deviceId ?? '')) {
        throw new Error('adb_wifi_endpoint_state_invalid');
      }
      return Object.freeze({ endpoint, deviceId: record.deviceId });
    },
    saveEndpoint: async (value, deviceId) => {
      const endpoint = normalizePrivateEndpoint(value);
      if (!endpoint) throw new TypeError('adb_wifi_endpoint_invalid');
      if (!DEVICE_ID_PATTERN.test(deviceId ?? '')) throw new TypeError('adb_wifi_device_id_invalid');
      const updatedAtMs = now();
      if (!Number.isSafeInteger(updatedAtMs) || updatedAtMs < 1) throw new Error('adb_wifi_endpoint_clock_invalid');
      await writeAtomic(filename, `${JSON.stringify({ version: 1, endpoint, deviceId, updatedAtMs })}\n`);
    },
  });
}
