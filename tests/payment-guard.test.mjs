import { describe, expect, it } from 'vitest';
import { createPaymentGuard } from '../src/agentic/payment-guard.mjs';

// `blocked:true` = « étape de paiement : ne pas continuer SANS confirmation » (déclenche la
// passerelle de confirmation d'achat + le routage credentials sécurisé), PAS « abandonner à jamais ».
describe('payment-guard (C6 — détecte l’étape de paiement → confirmation, jamais silencieux)', () => {
  const guard = createPaymentGuard();

  it('bloque un champ carte bancaire (par autocomplete standard cc-number)', () => {
    const r = guard.inspect({ fieldName: 'cardnum', fieldAutocomplete: 'cc-number' });
    expect(r.blocked).toBe(true);
    expect(r.reason).toMatch(/carte/i);
  });

  it('bloque un champ CVV et un champ IBAN', () => {
    expect(guard.inspect({ fieldLabel: 'Cryptogramme (CVV)' }).blocked).toBe(true);
    expect(guard.inspect({ fieldName: 'iban' }).blocked).toBe(true);
  });

  it('bloque un bouton « Passer la commande » / « Payer maintenant »', () => {
    expect(guard.inspect({ actionLabel: 'Passer la commande' }).blocked).toBe(true);
    expect(guard.inspect({ actionLabel: 'Payer maintenant' }).blocked).toBe(true);
    expect(guard.inspect({ actionLabel: 'Réserver et payer' }).blocked).toBe(true);
  });

  it('bloque une validation générique SUR une page de paiement (url + libellé submit)', () => {
    expect(guard.inspect({ url: 'https://site.fr/checkout/step2', actionLabel: 'Continuer' }).blocked).toBe(true);
  });

  it('LAISSE PASSER une action de préparation neutre (recherche, remplir un nom)', () => {
    expect(guard.inspect({ url: 'https://site.fr/vols', actionLabel: 'Rechercher' }).blocked).toBe(false);
    expect(guard.inspect({ fieldName: 'passenger_name', fieldLabel: 'Nom du voyageur' }).blocked).toBe(false);
    expect(guard.inspect({ url: 'https://site.fr/vols', actionLabel: 'Continuer' }).blocked).toBe(false); // pas sur page paiement
  });

  it('les motifs sont surchargeables (généralise, jamais un domaine en dur)', () => {
    const custom = createPaymentGuard({ payAction: /acheter-le-truc/iu });
    expect(custom.inspect({ actionLabel: 'acheter-le-truc' }).blocked).toBe(true);
    expect(custom.inspect({ actionLabel: 'Payer maintenant' }).blocked).toBe(false); // motif remplacé
  });
});
