import { describe, expect, it } from 'vitest';
import { createPhoneFleet } from '../src/devices/phone-fleet.mjs';

function twoPhones() {
  const fleet = createPhoneFleet();
  fleet.track({ deviceId: 'huawei-1', model: 'MAR-LX1A', transport: 'usb' });
  fleet.track({ deviceId: 'samsung-1', model: 'SM-A715F', transport: 'lan' });
  return fleet;
}

describe('phone-fleet : deux téléphones', () => {
  it('liste les deux appareils avec leur transport', () => {
    const list = twoPhones().list();
    expect(list).toHaveLength(2);
    expect(list.map((d) => d.deviceId)).toEqual(['huawei-1', 'samsung-1']);
    expect(list.find((d) => d.deviceId === 'samsung-1').transport).toBe('lan');
  });

  it('exige un deviceId EXPLICITE : null avec deux appareils = ambigu (jamais « le premier »)', () => {
    const fleet = twoPhones();
    expect(() => fleet.require(null)).toThrow('phone_fleet_device_ambiguous');
    expect(fleet.require('huawei-1').deviceId).toBe('huawei-1');
  });

  it('résout le téléphone RESTANT quand l’autre devient indisponible', () => {
    const fleet = twoPhones();
    fleet.setHealth('samsung-1', false);
    // un seul appareil sain → require(null) le résout (continuité)
    expect(fleet.require(null).deviceId).toBe('huawei-1');
  });

  it('verrous INDÉPENDANTS par appareil', () => {
    const fleet = twoPhones();
    expect(fleet.acquire('huawei-1')).toBe(true);
    expect(fleet.isLocked('huawei-1')).toBe(true);
    expect(fleet.isLocked('samsung-1')).toBe(false); // l'autre reste libre
    expect(() => fleet.acquire('huawei-1')).toThrow('phone_fleet_device_busy');
    fleet.release('huawei-1');
    expect(fleet.acquire('huawei-1')).toBe(true);
  });

  it('refuse d’acquérir un appareil indisponible', () => {
    const fleet = twoPhones();
    fleet.setHealth('huawei-1', false);
    expect(() => fleet.acquire('huawei-1')).toThrow('phone_fleet_device_unavailable');
  });

  it('file par appareil + comptage des verrous actifs (borne de concurrence V1)', () => {
    const fleet = twoPhones();
    fleet.enqueue('huawei-1', { sms: 'a' });
    fleet.enqueue('huawei-1', { sms: 'b' });
    expect(fleet.dequeue('huawei-1')).toEqual({ sms: 'a' });
    fleet.acquire('samsung-1');
    expect(fleet.activeLocks()).toBe(1);
    expect(fleet.health()).toMatchObject({ total: 2, healthy: 2, locked: 1 });
  });

  it('device inconnu → erreur, deviceId invalide → refus', () => {
    const fleet = twoPhones();
    expect(() => fleet.acquire('fantome')).toThrow('phone_fleet_device_unknown');
    expect(() => fleet.track({ deviceId: '' })).toThrow('phone_fleet_device_id_invalid');
  });
});
