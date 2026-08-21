import { describe, expect, it } from 'vitest';
import { createPhoneFleet } from '../src/devices/phone-fleet.mjs';
import { createSmsOutboundRouter } from '../src/communications/sms-outbound-router.mjs';

function fleetWith(...devices) {
  const fleet = createPhoneFleet({ now: () => 1 });
  for (const d of devices) fleet.track(d);
  return fleet;
}
const A = { deviceId: 'dev-huawei', model: 'MAR-LX1A', transport: 'usb', healthy: true };
const B = { deviceId: 'dev-samsung', model: 'SM-A715F', transport: 'lan', healthy: true };

describe('sms-outbound-router (§12.2)', () => {
  it('route un envoi vers un deviceId + SIM explicites, avec confirmation visible', () => {
    const router = createSmsOutboundRouter({ fleet: fleetWith(A, B) });
    const routed = router.route({ deviceId: 'dev-huawei', subscriptionId: 'sim-1', toE164: '+33612345678', body: 'ok' });
    expect(routed).toMatchObject({ deviceId: 'dev-huawei', subscriptionId: 'sim-1', toE164: '+33612345678' });
    expect(routed.confirmation).toMatchObject({ phone: 'dev-huawei', model: 'MAR-LX1A', sim: 'sim-1' });
  });

  it('exige un deviceId explicite : jamais « le premier » (§12.2)', () => {
    const router = createSmsOutboundRouter({ fleet: fleetWith(A, B) });
    expect(() => router.route({ subscriptionId: 'sim-1', toE164: '+33612345678', body: 'x' }))
      .toThrow('sms_outbound_device_required');
  });

  it('un deviceId inconnu est refusé', () => {
    const router = createSmsOutboundRouter({ fleet: fleetWith(A) });
    expect(() => router.route({ deviceId: 'dev-x', subscriptionId: 'sim-1', toE164: '+33612345678', body: 'x' }))
      .toThrow('phone_fleet_device_unknown');
  });

  it('un appareil non sain ne peut pas envoyer', () => {
    const router = createSmsOutboundRouter({ fleet: fleetWith(A, { ...B, healthy: false }) });
    expect(() => router.route({ deviceId: 'dev-samsung', subscriptionId: 'sim-2', toE164: '+33612345678', body: 'x' }))
      .toThrow('sms_outbound_device_unavailable');
  });

  it('une SIM ambiguë (ni explicite ni connue) BLOQUE l’envoi (§12.2)', () => {
    const router = createSmsOutboundRouter({ fleet: fleetWith(A) });
    expect(() => router.route({ deviceId: 'dev-huawei', toE164: '+33612345678', body: 'x' }))
      .toThrow('sms_outbound_sim_ambiguous');
    // Une SIM explicitement « sim_ambiguous » bloque aussi.
    expect(() => router.route({ deviceId: 'dev-huawei', subscriptionId: 'sim_ambiguous', toE164: '+33612345678', body: 'x' }))
      .toThrow('sms_outbound_sim_ambiguous');
  });

  it('réutilise la SIM de réception d’un SMS entrant quand elle est connue', () => {
    const router = createSmsOutboundRouter({ fleet: fleetWith(A) });
    const routed = router.route({ deviceId: 'dev-huawei', toE164: '+33612345678', body: 'reponse', replyTo: { subscriptionId: 'sim-recue' } });
    expect(routed.subscriptionId).toBe('sim-recue');
  });

  it('cible exactement UN téléphone : aucune diffusion aux deux (§12.2)', () => {
    const router = createSmsOutboundRouter({ fleet: fleetWith(A, B) });
    const routed = router.route({ deviceId: 'dev-samsung', subscriptionId: 'sim-2', toE164: '+33698765432', body: 'x' });
    expect(routed.deviceId).toBe('dev-samsung');
    expect(Object.keys(routed)).not.toContain('deviceIds'); // jamais une liste
  });

  it('refuse un numéro destinataire invalide', () => {
    const router = createSmsOutboundRouter({ fleet: fleetWith(A) });
    expect(() => router.route({ deviceId: 'dev-huawei', subscriptionId: 'sim-1', toE164: 'pas-un-numero', body: 'x' }))
      .toThrow('sms_outbound_number_invalid');
  });
});
