// Poller du journal d'appels (SPEC-MINA-COMMS-001 §8.5). Interroge le call log de chaque téléphone via
// ADB (`content query`) et le passe au domaine communications pour l'ingestion missed→task. L'exécuteur
// ADB est INJECTÉ (`runAdbShell(serial, command)`) → testable sans matériel. Aucun audio. Best-effort :
// une erreur ADB sur un téléphone n'arrête pas les autres. Module PUR/injectable, non câblé au runtime.

const CALL_LOG_QUERY = 'content query --uri content://call_log/calls --projection number:type:date:duration';

export function createCallLogPoller({ domain, runAdbShell } = {}) {
  if (typeof domain?.ingestCallLog !== 'function' || typeof runAdbShell !== 'function') {
    throw new TypeError('call_log_poller_dependencies_required');
  }

  async function pollDevice({ deviceId, serial } = {}) {
    const text = await runAdbShell(serial, CALL_LOG_QUERY);
    return domain.ingestCallLog(deviceId, text);
  }

  return Object.freeze({
    pollDevice,
    async pollAll(devices = []) {
      const results = [];
      for (const device of devices ?? []) {
        try {
          const report = await pollDevice(device);
          results.push(Object.freeze({ deviceId: device.deviceId, ...report }));
        } catch (error) {
          results.push(Object.freeze({ deviceId: device.deviceId, error: String(error?.message ?? error).slice(0, 120) }));
        }
      }
      return Object.freeze(results);
    },
  });
}
