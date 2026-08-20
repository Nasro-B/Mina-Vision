// Flotte de deux téléphones (SPEC-MINA-COMMS-001 §2.1, §5.1). Couche fine AU-DESSUS de la
// physical-device-registry existante (qui groupe déjà USB/Wi-Fi sous une identité signée et refuse
// l'ambiguïté). La flotte ajoute ce qui manque pour DEUX appareils simultanés : un état, une file et
// un VERROU d'action INDÉPENDANTS par `deviceId`. Elle ne choisit JAMAIS implicitement « le premier
// appareil ADB » : une action sans `deviceId` explicite est refusée dès qu'il y a plus d'un appareil.
// Elle continue d'utiliser le téléphone restant si l'autre devient indisponible. Module PUR, non
// câblé au runtime.

const ID = /^[A-Za-z0-9._:-]{1,160}$/u;

export function createPhoneFleet({ now = () => 0 } = {}) {
  const devices = new Map(); // deviceId -> { deviceId, model, transport, healthy, locked, queue, updatedAt }

  function publicDevice(record) {
    return Object.freeze({
      deviceId: record.deviceId,
      model: record.model ?? null,
      transport: record.transport ?? null,
      healthy: record.healthy !== false,
      locked: record.locked === true,
      queued: record.queue.length,
      updatedAt: record.updatedAt,
    });
  }

  function get(deviceId) {
    const record = devices.get(deviceId);
    if (!record) throw new Error('phone_fleet_device_unknown');
    return record;
  }

  return Object.freeze({
    // Enregistre/actualise un téléphone détecté (identité signée déjà vérifiée en amont par la registry).
    track({ deviceId, model = null, transport = null, healthy = true } = {}) {
      if (!ID.test(deviceId ?? '')) throw new TypeError('phone_fleet_device_id_invalid');
      const record = devices.get(deviceId) ?? { deviceId, locked: false, queue: [] };
      record.model = model ?? record.model ?? null;
      record.transport = transport ?? record.transport ?? null;
      record.healthy = healthy !== false;
      record.updatedAt = now();
      devices.set(deviceId, record);
      return publicDevice(record);
    },

    forget(deviceId) { return devices.delete(deviceId); },

    list() {
      return [...devices.values()].sort((a, b) => a.deviceId.localeCompare(b.deviceId)).map(publicDevice);
    },

    // Exige une cible EXPLICITE. Jamais « le premier » : null + plusieurs appareils = ambigu.
    require(deviceId = null) {
      if (deviceId === null || deviceId === undefined) {
        const healthy = [...devices.values()].filter((record) => record.healthy !== false);
        if (healthy.length !== 1) throw new Error('phone_fleet_device_ambiguous');
        return publicDevice(healthy[0]);
      }
      return publicDevice(get(deviceId));
    },

    setHealth(deviceId, healthy) {
      const record = get(deviceId);
      record.healthy = healthy !== false;
      record.updatedAt = now();
      return publicDevice(record);
    },

    // Verrou par appareil : verrouiller le téléphone 1 n'affecte PAS le téléphone 2.
    acquire(deviceId) {
      const record = get(deviceId);
      if (record.healthy === false) throw new Error('phone_fleet_device_unavailable');
      if (record.locked) throw new Error('phone_fleet_device_busy');
      record.locked = true;
      record.updatedAt = now();
      return true;
    },
    release(deviceId) {
      const record = get(deviceId);
      record.locked = false;
      record.updatedAt = now();
      return true;
    },
    isLocked(deviceId) { return get(deviceId).locked === true; },

    // File par appareil.
    enqueue(deviceId, item) { get(deviceId).queue.push(item); return get(deviceId).queue.length; },
    dequeue(deviceId) { return get(deviceId).queue.shift() ?? null; },

    // Nombre d'appareils avec un verrou actif — sert à borner la concurrence (V1 : 1 appel Mina actif).
    activeLocks() { return [...devices.values()].filter((record) => record.locked).length; },

    health() {
      const all = [...devices.values()];
      return Object.freeze({
        total: all.length,
        healthy: all.filter((record) => record.healthy !== false).length,
        locked: all.filter((record) => record.locked).length,
      });
    },
  });
}
