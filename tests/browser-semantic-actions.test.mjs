import { describe, expect, it, vi } from 'vitest';
import { createBrowserSemanticActions } from '../src/browser/browser-semantic-actions.mjs';

// Driver DOM factice : un « store » de valeurs par handle simule la page.
function fakeDriver({ found = true, values = {} } = {}) {
  const store = { ...values };
  return {
    locate: vi.fn(async (d) => (found ? { id: d.label ?? d.name ?? d.role } : null)),
    click: vi.fn(async () => ({ resultUrl: 'https://site.fr/ok', navigationId: 'n1' })),
    fill: vi.fn(async (handle, value) => { store[handle.id] = value; }),
    readValue: vi.fn(async (handle) => store[handle.id] ?? ''),
    _store: store,
  };
}

describe('browser-semantic-actions (Phase 5 — DOM par locators, pas de vision)', () => {
  it('exige un driver DOM complet', () => {
    expect(() => createBrowserSemanticActions({ driver: { locate() {} } })).toThrow('driver_required');
  });

  it('clickByRole localise par rôle/nom et confirme le clic sur l’élément localisé', async () => {
    const driver = fakeDriver();
    const sa = createBrowserSemanticActions({ driver });
    const res = await sa.clickByRole({ role: 'button', name: 'Connexion', commandId: 'c1' });
    expect(driver.locate).toHaveBeenCalledWith({ by: 'role', role: 'button', name: 'Connexion' });
    expect(res).toMatchObject({ attempted: true, verified: true, verificationReason: 'clic_sur_element_localise', route: 'semantic' });
  });

  it('élément introuvable → jamais de clic au hasard (attempted:false)', async () => {
    const sa = createBrowserSemanticActions({ driver: fakeDriver({ found: false }) });
    const res = await sa.clickByRole({ role: 'button', name: 'Fantôme' });
    expect(res).toMatchObject({ attempted: false, verified: false, errorCode: 'element_introuvable' });
  });

  it('fillByLabel remplit puis VÉRIFIE par relecture', async () => {
    const driver = fakeDriver();
    const sa = createBrowserSemanticActions({ driver });
    const res = await sa.fillByLabel({ label: 'Email', value: 'a@b.fr', commandId: 'c2' });
    expect(driver.fill).toHaveBeenCalled();
    expect(res).toMatchObject({ attempted: true, verified: true, verificationReason: 'valeur_relue_confirmee' });
    expect(driver._store.Email).toBe('a@b.fr');
  });

  it('HONNÊTETÉ : relecture ≠ valeur → non vérifié (jamais de faux succès)', async () => {
    const driver = fakeDriver();
    driver.readValue = vi.fn(async () => 'autre chose'); // le champ n'a pas pris la valeur
    const sa = createBrowserSemanticActions({ driver });
    const res = await sa.fillByLabel({ label: 'Email', value: 'a@b.fr' });
    expect(res).toMatchObject({ attempted: true, verified: false, errorCode: 'remplissage_non_confirme' });
  });

  it('fillAndSubmit est ATOMIQUE : ne soumet PAS si le remplissage n’est pas confirmé', async () => {
    const driver = fakeDriver();
    driver.readValue = vi.fn(async () => ''); // remplissage non confirmé
    const sa = createBrowserSemanticActions({ driver });
    const res = await sa.fillAndSubmit({ label: 'Email', value: 'x@y.fr', submitName: 'Envoyer' });
    expect(res.verified).toBe(false);
    // le bouton d'envoi ne doit JAMAIS avoir été cliqué (un seul locate : le champ, pas le bouton)
    expect(driver.click).not.toHaveBeenCalled();
  });

  it('fillAndSubmit : remplissage confirmé → soumet et confirme', async () => {
    const driver = fakeDriver();
    const sa = createBrowserSemanticActions({ driver });
    const res = await sa.fillAndSubmit({ label: 'Recherche', value: 'crêpes', submitName: 'Rechercher' });
    expect(res).toMatchObject({ attempted: true, verified: true, verificationReason: 'rempli_puis_soumis' });
    expect(driver.click).toHaveBeenCalledTimes(1);
  });
});
