import { describe, expect, it, vi } from 'vitest';
import { createPurchaseConfirmation } from '../src/agentic/purchase-confirmation.mjs';

function journal() {
  const rows = [];
  return { rows, record: (r) => rows.push(r) };
}

describe('purchase-confirmation (C6 — Mina paie, mais confirmé + plafonné + journalisé)', () => {
  it('exige confirmOwner + journal', () => {
    expect(() => createPurchaseConfirmation({ confirmOwner: null, journal: { record() {} } })).toThrow('dependencies_required');
    expect(() => createPurchaseConfirmation({ confirmOwner: () => true, journal: null })).toThrow('dependencies_required');
  });

  it('propriétaire approuve → proceed + journalisé approved', async () => {
    const j = journal();
    const confirmOwner = vi.fn(async () => true);
    const gate = createPurchaseConfirmation({ confirmOwner, journal: j, maxAmount: 500 });
    const out = await gate.authorize({ item: 'Vol CDG-ALG', amount: 213.4, currency: 'EUR', merchant: 'airline.com' });
    expect(out).toMatchObject({ proceed: true, item: 'Vol CDG-ALG', amount: 213.4 });
    expect(confirmOwner).toHaveBeenCalledWith(expect.objectContaining({ item: 'Vol CDG-ALG', amount: 213.4 }));
    expect(j.rows.at(-1)).toMatchObject({ decision: 'approved', amount: 213.4 });
  });

  it('propriétaire refuse → pas de proceed + journalisé rejected', async () => {
    const j = journal();
    const gate = createPurchaseConfirmation({ confirmOwner: async () => false, journal: j });
    const out = await gate.authorize({ item: 'Casque', amount: 80 });
    expect(out.proceed).toBe(false);
    expect(out.reason).toBe('refus_proprietaire');
    expect(j.rows.at(-1).decision).toBe('rejected');
  });

  it('au-dessus du plafond → refus AVANT confirmation (on ne propose même pas)', async () => {
    const j = journal();
    const confirmOwner = vi.fn(async () => true);
    const gate = createPurchaseConfirmation({ confirmOwner, journal: j, maxAmount: 100 });
    const out = await gate.authorize({ item: 'Écran', amount: 250 });
    expect(out).toMatchObject({ proceed: false, reason: 'plafond_depasse', cap: 100 });
    expect(confirmOwner).not.toHaveBeenCalled(); // jamais proposé au-dessus du plafond
    expect(j.rows.at(-1).decision).toBe('denied_over_cap');
  });

  it('devise non autorisée → refus journalisé', async () => {
    const j = journal();
    const gate = createPurchaseConfirmation({ confirmOwner: async () => true, journal: j, allowedCurrencies: ['EUR'] });
    const out = await gate.authorize({ item: 'x', amount: 10, currency: 'USD' });
    expect(out).toMatchObject({ proceed: false, reason: 'devise_non_autorisee' });
    expect(j.rows.at(-1).decision).toBe('denied_currency');
  });

  it('requête invalide (item vide / montant ≤ 0) → throw', async () => {
    const gate = createPurchaseConfirmation({ confirmOwner: async () => true, journal: journal() });
    await expect(gate.authorize({ item: '', amount: 10 })).rejects.toThrow('purchase_request_invalid');
    await expect(gate.authorize({ item: 'x', amount: 0 })).rejects.toThrow('purchase_request_invalid');
  });
});
