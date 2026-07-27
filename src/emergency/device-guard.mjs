// Garde des périphériques du mode urgence : la dépendance `device_guard` attendue par
// emergency-mode. Coupe caméra et micro via des contrôleurs RÉELS injectés (stop caméra, arrêt de
// l'écoute vocale) et maintient un verrou consultable : tant que le mode urgence est actif,
// `assertAllowed()` refuse tout redémarrage de capture — le verrou est vérifié par les chemins de
// démarrage, pas seulement affiché.

export function createDeviceGuard({ stopCamera = null, stopMicrophone = null, logger = null } = {}) {
  let blocked = false;

  return Object.freeze({
    async disableCameraAndMic() {
      blocked = true;
      if (typeof stopCamera === 'function') {
        try { await stopCamera(); } catch (error) {
          logger?.append?.({ event: 'urgence_camera_stop_echec', error: String(error?.message ?? error).slice(0, 120) });
        }
      }
      if (typeof stopMicrophone === 'function') {
        try { await stopMicrophone(); } catch (error) {
          logger?.append?.({ event: 'urgence_micro_stop_echec', error: String(error?.message ?? error).slice(0, 120) });
        }
      }
      logger?.append?.({ event: 'urgence_peripheriques_coupes' });
      return Object.freeze({ blocked: true });
    },

    async restore() {
      blocked = false;
      logger?.append?.({ event: 'urgence_peripheriques_retablis' });
      return Object.freeze({ blocked: false });
    },

    isBlocked: () => blocked,

    /** À appeler dans les chemins de démarrage caméra/micro : lève tant que l'urgence est active. */
    assertAllowed() {
      if (blocked) throw new Error('urgence_peripheriques_bloques');
    },
  });
}
