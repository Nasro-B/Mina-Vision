import { describe, expect, it } from 'vitest';
import { createPaymentChannelRouter, PAYMENT_CHANNELS } from '../src/agentic/payment-channel-router.mjs';

describe('payment-channel-router (C6 / D8 — 3 canaux sûrs, jamais de carte en clair)', () => {
  const router = createPaymentChannelRouter();

  it('préfère le compte marchand (Mina ne touche aucune donnée carte)', () => {
    const r = router.select({ merchantHasSavedMethod: true, browserAutofillAvailable: true, passwordManagerAvailable: true });
    expect(r.channel).toBe('merchant_account');
    expect(r.instruction).toMatch(/marchand/i); // route vers le moyen enregistré, aucune saisie
  });

  it('à défaut, autofill navigateur, puis gestionnaire de mots de passe', () => {
    expect(router.select({ browserAutofillAvailable: true, passwordManagerAvailable: true }).channel).toBe('browser_autofill');
    expect(router.select({ passwordManagerAvailable: true }).channel).toBe('password_manager');
  });

  it('aucun canal disponible → restitution propriétaire (jamais de saisie carte en clair)', () => {
    const r = router.select({});
    expect(r.channel).toBeNull();
    expect(r.instruction).toMatch(/restituer|jamais de saisie/i);
  });

  it('ordre de préférence surchargeable', () => {
    const custom = createPaymentChannelRouter({ preferredOrder: ['browser_autofill', 'merchant_account'] });
    expect(custom.select({ merchantHasSavedMethod: true, browserAutofillAvailable: true }).channel).toBe('browser_autofill');
  });

  it('AUCUNE instruction ne demande jamais de taper un identifiant de paiement', () => {
    for (const channel of PAYMENT_CHANNELS) {
      const avail = { merchant_account: 'merchantHasSavedMethod', browser_autofill: 'browserAutofillAvailable', password_manager: 'passwordManagerAvailable' }[channel];
      const r = createPaymentChannelRouter({ preferredOrder: [channel] }).select({ [avail]: true });
      expect(r.instruction).not.toMatch(/saisir|taper|entrer.*(carte|num|cvv)/i);
    }
  });

  it('ordre vide/invalide → throw', () => {
    expect(() => createPaymentChannelRouter({ preferredOrder: ['inconnu'] })).toThrow('order_invalid');
  });
});
