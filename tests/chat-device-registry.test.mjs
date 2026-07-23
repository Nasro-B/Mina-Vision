import { describe, expect, it } from 'vitest';
import { createChatDeviceRegistry } from '../src/devices/chat-device-registry.mjs';

const makeClock = (start = 1_784_732_400_000) => {
  let value = start;
  const clock = () => value;
  clock.advance = (ms) => { value += ms; };
  return clock;
};

const approve = (registry, deviceId, code) => registry.approve({
  deviceId,
  publicKeySpki: `cle-${deviceId}`,
  pairingCode: code,
});

describe('registre des appareils du canal mina_app', () => {
  it('refuse tout appareil tant que l\'appairage n\'est pas ouvert', () => {
    const registry = createChatDeviceRegistry();
    expect(approve(registry, 'device-samsung', '123456')).toMatchObject({ ok: false, reason: 'appairage_ferme' });
    expect(registry.isApproved('device-samsung')).toBe(false);
  });

  it('approuve avec le bon code et refuse un mauvais code', () => {
    const registry = createChatDeviceRegistry();
    const { code } = registry.openPairing();
    expect(approve(registry, 'device-samsung', 'mauvais')).toMatchObject({ ok: false, reason: 'code_incorrect' });
    expect(approve(registry, 'device-samsung', code)).toMatchObject({ ok: true, reason: 'approuve' });
    expect(registry.isApproved('device-samsung')).toBe(true);
  });

  it('le code est à usage unique', () => {
    const registry = createChatDeviceRegistry();
    const { code } = registry.openPairing();
    approve(registry, 'device-un', code);
    expect(approve(registry, 'device-deux', code)).toMatchObject({ ok: false, reason: 'appairage_ferme' });
  });

  it('le code expire — un code oublié ouvert ne reste pas valable', () => {
    const clock = makeClock();
    const registry = createChatDeviceRegistry({ clock });
    const { code } = registry.openPairing({ ttlMs: 60_000 });
    clock.advance(60_001);
    expect(registry.pairingOpen()).toBe(false);
    expect(approve(registry, 'device-samsung', code)).toMatchObject({ ok: false, reason: 'appairage_ferme' });
  });

  it('ferme l\'appairage après trop de tentatives — pas de force brute sur 6 chiffres', () => {
    const registry = createChatDeviceRegistry();
    registry.openPairing();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(approve(registry, 'device-brute', 'aaaaaa')).toMatchObject({ ok: false, reason: 'code_incorrect' });
    }
    expect(approve(registry, 'device-brute', 'aaaaaa')).toMatchObject({ ok: false, reason: 'trop_de_tentatives' });
    expect(registry.pairingOpen()).toBe(false);
  });

  it('révoquer ouvre l\'époque suivante — l\'appareil retiré ne lit plus la SUITE', () => {
    const registry = createChatDeviceRegistry();
    const { code } = registry.openPairing();
    approve(registry, 'device-samsung', code);
    expect(registry.keyEpoch()).toBe(1);

    expect(registry.revoke('device-samsung')).toMatchObject({ ok: true, keyEpoch: 2 });
    expect(registry.isApproved('device-samsung')).toBe(false);
    expect(registry.keyEpoch()).toBe(2);
  });

  it('un appareil révoqué ne se réinscrit pas tout seul avec un nouveau code', () => {
    const registry = createChatDeviceRegistry();
    const first = registry.openPairing();
    approve(registry, 'device-samsung', first.code);
    registry.revoke('device-samsung');

    const second = registry.openPairing();
    expect(approve(registry, 'device-samsung', second.code)).toMatchObject({ ok: false, reason: 'appareil_revoque' });

    // Nasro peut explicitement lui pardonner : c'est une décision, pas un effet de bord.
    registry.forget('device-samsung');
    const third = registry.openPairing();
    expect(approve(registry, 'device-samsung', third.code)).toMatchObject({ ok: true });
  });

  it('borne le nombre d\'appareils', () => {
    const registry = createChatDeviceRegistry();
    for (let index = 0; index < 8; index += 1) {
      const { code } = registry.openPairing();
      expect(approve(registry, `device-${index}`, code)).toMatchObject({ ok: true });
    }
    const { code } = registry.openPairing();
    expect(approve(registry, 'device-de-trop', code)).toMatchObject({ ok: false, reason: 'trop_d_appareils' });
  });

  it('un appareil déjà approuvé n\'a plus besoin de code', () => {
    const registry = createChatDeviceRegistry();
    const { code } = registry.openPairing();
    approve(registry, 'device-samsung', code);
    expect(approve(registry, 'device-samsung', null)).toMatchObject({ ok: true, reason: 'deja_approuve' });
  });

  it('l\'inventaire affiché ne contient pas de matériel cryptographique', () => {
    const registry = createChatDeviceRegistry();
    const { code } = registry.openPairing();
    approve(registry, 'device-samsung', code);
    const listed = registry.list();
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain('cle-device-samsung');
  });

  it('reprend un état persisté sans perdre l\'époque en cours', () => {
    const registry = createChatDeviceRegistry({
      persisted: {
        devices: { 'device-samsung': { publicKeySpki: 'k', approvedAtMs: 1, keyEpoch: 3 } },
        keyEpoch: 3,
        revokedAt: {},
      },
    });
    expect(registry.keyEpoch()).toBe(3);
    expect(registry.isApproved('device-samsung')).toBe(true);
  });
});
