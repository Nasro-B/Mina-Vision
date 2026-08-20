import { describe, expect, it } from 'vitest';
import {
  classifySmsForTask, normalizeCallEvent, normalizeSmsEvent,
} from '../src/communications/communication-contract.mjs';

describe('communication-contract : SMS', () => {
  it('exige un deviceId (jamais « le premier »)', () => {
    expect(() => normalizeSmsEvent({ messageId: 'm1' })).toThrow('communication_device_required');
  });

  it('dédup INDÉPENDANTE du transport : même SMS en USB et Wi-Fi = même clé', () => {
    const usb = normalizeSmsEvent({ deviceId: 'd1', messageId: 'm1', senderE164: '+33612345678', sentAtMs: 1000, transport: 'usb' });
    const wifi = normalizeSmsEvent({ deviceId: 'd1', messageId: 'm1', senderE164: '+33612345678', sentAtMs: 1000, transport: 'lan' });
    expect(usb.dedupeKey).toBe(wifi.dedupeKey);
    const autre = normalizeSmsEvent({ deviceId: 'd1', messageId: 'm2', senderE164: '+33612345678', sentAtMs: 1000 });
    expect(autre.dedupeKey).not.toBe(usb.dedupeKey);
  });

  it('SIM ambiguë marquée, état de livraison borné', () => {
    const sms = normalizeSmsEvent({ deviceId: 'd1', messageId: 'm', deliveryState: 'inventé' });
    expect(sms.subscriptionId).toBe('sim_ambiguous');
    expect(sms.deliveryState).toBe('prepared');
  });
});

describe('communication-contract : appel', () => {
  it('l’acteur n’est JAMAIS déduit (unknown par défaut)', () => {
    expect(normalizeCallEvent({ deviceId: 'd1', callId: 'c1', state: 'ringing' }).actor).toBe('unknown');
    expect(normalizeCallEvent({ deviceId: 'd1', callId: 'c1', actor: 'mina' }).actor).toBe('mina');
    expect(normalizeCallEvent({ deviceId: 'd1', callId: 'c1', actor: 'inventé' }).actor).toBe('unknown');
  });
});

describe('communication-contract : SMS → tâche (§12.3)', () => {
  it('ne crée PAS de tâche pour OTP, banque, pub, opérateur', () => {
    expect(classifySmsForTask('Votre code de vérification est 483920').warrantsTask).toBe(false);
    expect(classifySmsForTask('Votre code de vérification est 483920').category).toBe('otp');
    expect(classifySmsForTask('Prélèvement de 42€ sur votre carte bancaire').warrantsTask).toBe(false);
    expect(classifySmsForTask('PROMO -50% profitez, STOP au 36000').warrantsTask).toBe(false);
    expect(classifySmsForTask('Votre forfait data est presque épuisé').warrantsTask).toBe(false);
  });

  it('crée une tâche pour un message actionnable ou forcé', () => {
    expect(classifySmsForTask('Peux-tu me rappeler stp au sujet de la commande ?').warrantsTask).toBe(true);
    expect(classifySmsForTask("n'importe quoi", { forced: true })).toMatchObject({ warrantsTask: true, category: 'forced' });
  });

  it('dans le doute : PAS de tâche automatique', () => {
    expect(classifySmsForTask('Ok à demain').warrantsTask).toBe(false);
    expect(classifySmsForTask('Ok à demain').category).toBe('unknown');
  });
});
