// Réconciliation flotte ↔ physical-device-registry (SPEC-MINA-COMMS-001 Phase 3, §2.1). Traduit les
// identités signées résolues par la registry (USB/Wi-Fi déjà groupés, USB prioritaire) en état de
// flotte : pour chaque téléphone, le transport = premier endpoint SAIN (USB avant Wi-Fi), la santé =
// existence d'un endpoint sain. Un téléphone connu mais sans endpoint sain devient NON sain sans être
// oublié — le même `deviceId` revient à la reconnexion, jamais un nom Bluetooth ou une IP comme
// identité (§6, §16). N'exécute aucune action : il ne fait que synchroniser l'état. PUR, non câblé.

export function reconcileFleet({ fleet, registry } = {}) {
  if (typeof fleet?.track !== 'function' || typeof fleet?.list !== 'function'
    || typeof fleet?.setHealth !== 'function' || typeof registry?.listDevices !== 'function') {
    throw new TypeError('phone_fleet_sync_dependencies_required');
  }
  const seen = new Set();
  for (const device of registry.listDevices()) {
    seen.add(device.deviceId);
    // endpoints est déjà trié USB < Wi-Fi < Firebase : le premier sain donne le transport prioritaire.
    const endpoint = device.endpoints.find((candidate) => candidate.healthy) ?? null;
    fleet.track({
      deviceId: device.deviceId,
      model: endpoint?.model ?? null,
      transport: endpoint?.type ?? null,
      healthy: endpoint !== null,
    });
  }
  // Un appareil présent dans la flotte mais totalement disparu de la registry est marqué non sain,
  // jamais supprimé (continuité + reconnexion sur le même deviceId).
  for (const device of fleet.list()) {
    if (!seen.has(device.deviceId) && device.healthy) fleet.setHealth(device.deviceId, false);
  }
  return fleet.list();
}
