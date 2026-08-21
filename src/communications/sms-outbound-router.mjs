// Routage d'un SMS SORTANT sur la flotte de deux téléphones (SPEC-MINA-COMMS-001 §12.2). Règles :
// toute commande porte un `deviceId` EXPLICITE (jamais « le premier ») ; la SIM de réception est
// réutilisée si connue ; une SIM ambiguë BLOQUE l'envoi ; le téléphone source et la SIM sont visibles
// dans la confirmation ; aucune action n'est diffusée aux deux téléphones (cible UNIQUE). Ne fait que
// DÉCIDER la cible : l'envoi réel passe par le pont ADB en aval. Module PUR/injectable, non câblé.

const E164 = /^\+?[0-9]{4,15}$/u;

export function createSmsOutboundRouter({ fleet } = {}) {
  if (typeof fleet?.require !== 'function') throw new TypeError('sms_outbound_router_fleet_required');

  return Object.freeze({
    route({ deviceId, subscriptionId = null, toE164, body, replyTo = null } = {}) {
      if (!deviceId) throw new Error('sms_outbound_device_required'); // jamais implicitement « le premier »
      const device = fleet.require(deviceId); // lève phone_fleet_device_unknown si inconnu
      if (device.healthy === false) throw new Error('sms_outbound_device_unavailable');
      if (!E164.test(String(toE164 ?? ''))) throw new Error('sms_outbound_number_invalid');

      // SIM : explicite d'abord, sinon celle de réception du SMS auquel on répond, sinon on BLOQUE.
      const explicit = subscriptionId && subscriptionId !== 'sim_ambiguous' ? String(subscriptionId) : null;
      const reused = replyTo?.subscriptionId && replyTo.subscriptionId !== 'sim_ambiguous' ? String(replyTo.subscriptionId) : null;
      const sim = explicit ?? reused;
      if (!sim) throw new Error('sms_outbound_sim_ambiguous'); // une SIM ambiguë bloque l'envoi

      return Object.freeze({
        deviceId: device.deviceId, // cible UNIQUE — jamais une liste, jamais de diffusion aux deux
        subscriptionId: sim,
        transport: device.transport ?? null,
        toE164: String(toE164),
        body: typeof body === 'string' ? body : '',
        confirmation: Object.freeze({ phone: device.deviceId, model: device.model ?? null, sim }),
      });
    },
  });
}
