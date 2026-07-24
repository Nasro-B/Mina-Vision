import { execFile } from 'node:child_process';

const SERIAL = /^[A-Za-z0-9._:-]{4,80}$/u;
const PRIVATE_ENDPOINT = /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)(?:[0-9]{1,3}\.){1,2}[0-9]{1,3}:[1-9][0-9]{0,4}$/u;

const defaultRun = (file, args, { binary = false } = {}) => new Promise((resolve, reject) => {
  execFile(file, args, { encoding: binary ? null : 'utf8', windowsHide: true, timeout: 10_000 }, (error, stdout, stderr) => {
    if (error) reject(Object.assign(error, { stdout, stderr }));
    else resolve({ stdout, stderr });
  });
});

export function findAdbMdnsEndpoint(output, serial) {
  if (!SERIAL.test(serial ?? '')) throw new TypeError('adb_mdns_peer_serial_invalid');
  for (const line of String(output ?? '').split(/\r?\n/u)) {
    const [service = '', type = '', endpoint = ''] = line.trim().split(/\s+/u);
    if (!service.startsWith(`adb-${serial}`) || !['_adb-tls-connect._tcp', '_adb._tcp'].includes(type)) continue;
    if (PRIVATE_ENDPOINT.test(endpoint)) return endpoint;
  }
  return null;
}

/**
 * Tous les endpoints ADB annoncés en mDNS, sans connaître le serial d'avance.
 *
 * C'est ce qui permet de DÉTECTER un téléphone par Wi-Fi sans USB : un appareil avec le
 * débogage sans fil actif (Android 11+) s'annonce ici. On ne fait confiance à aucun de ces
 * endpoints par leur seule présence — l'appelant se connecte puis vérifie l'identité signée
 * Mina avant de les traiter. On se limite aux adresses PRIVÉES (jamais une IP publique).
 */
export function parseAdbMdnsEndpoints(output) {
  const endpoints = new Set();
  for (const line of String(output ?? '').split(/\r?\n/u)) {
    const [service = '', type = '', endpoint = ''] = line.trim().split(/\s+/u);
    if (!service.startsWith('adb-') || !['_adb-tls-connect._tcp', '_adb._tcp'].includes(type)) continue;
    if (PRIVATE_ENDPOINT.test(endpoint)) endpoints.add(endpoint);
  }
  return [...endpoints];
}

export function createAdbMdnsPeerKeeper({
  serial, role, adbPath = 'adb', run = defaultRun, onStatus = () => {},
  setIntervalFn = setInterval, clearIntervalFn = clearInterval, intervalMs = 5_000,
  // Fallback : certains téléphones (Samsung en mode tcpip, prouvé 2026-07-22) ne s'annoncent
  // JAMAIS en mDNS. Quand la découverte est muette, on retente la dernière endpoint connue —
  // avec la MÊME vérification d'identité (ro.serialno). Les deux hooks sont optionnels.
  recallEndpoint = null, rememberEndpoint = null,
} = {}) {
  if (!SERIAL.test(serial ?? '') || !/^[a-z][a-z0-9_-]{2,40}$/u.test(role ?? '')
    || typeof run !== 'function' || typeof onStatus !== 'function'
    || typeof setIntervalFn !== 'function' || typeof clearIntervalFn !== 'function'
    || !Number.isInteger(intervalMs) || intervalMs < 1_000 || intervalMs > 60_000) {
    throw new TypeError('adb_mdns_peer_keeper_invalid');
  }
  let timer = null;
  let inFlight = null;
  let lastStatus = '';
  const emit = (value) => {
    const key = JSON.stringify(value);
    if (key !== lastStatus) { lastStatus = key; onStatus(value); }
    return value;
  };
  const tick = async () => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const { stdout } = await run(adbPath, ['mdns', 'services'], { binary: false });
      let endpoint = findAdbMdnsEndpoint(stdout, serial);
      let via = 'mdns';
      if (!endpoint && typeof recallEndpoint === 'function') {
        endpoint = await recallEndpoint().catch(() => null);
        via = 'last_known_endpoint';
      }
      if (!endpoint) throw new Error('adb_mdns_peer_not_discovered');
      await run(adbPath, ['connect', endpoint], { binary: false });
      const identity = await run(adbPath, ['-s', endpoint, 'shell', 'getprop', 'ro.serialno'], { binary: false });
      if (String(identity.stdout).trim() !== serial) {
        await run(adbPath, ['disconnect', endpoint], { binary: false }).catch(() => {});
        throw new Error('adb_mdns_peer_identity_mismatch');
      }
      if (via === 'mdns' && typeof rememberEndpoint === 'function') {
        await rememberEndpoint(endpoint).catch(() => {});
      }
      return emit(Object.freeze({ connected: true, role, endpoint, serial, via }));
    })().catch((error) => {
      emit(Object.freeze({ connected: false, role, reason: String(error?.message ?? error).slice(0, 120) }));
      throw error;
    }).finally(() => { inFlight = null; });
    return inFlight;
  };
  return Object.freeze({
    tick,
    start() {
      if (timer !== null) return;
      void tick().catch(() => {});
      timer = setIntervalFn(() => { void tick().catch(() => {}); }, intervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer === null) return;
      clearIntervalFn(timer);
      timer = null;
    },
  });
}
