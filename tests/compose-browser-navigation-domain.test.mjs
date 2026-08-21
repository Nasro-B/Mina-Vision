import { describe, expect, it } from 'vitest';
import { composeBrowserNavigationDomain } from '../src/browser/compose-browser-navigation-domain.mjs';

describe('compose-browser-navigation-domain (assemblage)', () => {
  it('route un « Va sur wikipedia.org » sur la voie rapide (navigate)', () => {
    const domain = composeBrowserNavigationDomain();
    const command = domain.route('Va sur wikipedia.org', { commandId: 'c1', requestedAt: 1 });
    expect(command.route).toBe('fast');
    expect(command.type).toBe('navigate');
    expect(command.targetUrl).toMatch(/wikipedia\.org/u);
  });

  it('construit l’URL de recherche Google pour « cherche X » (jamais de saisie barre)', () => {
    const domain = composeBrowserNavigationDomain();
    const command = domain.route('cherche la meteo a paris', { commandId: 'c2', requestedAt: 2 });
    expect(command.type).toBe('search');
    expect(command.searchUrl).toMatch(/^https:\/\/www\.google\.com\/search\?q=/u);
  });

  it('un énoncé non-navigateur n’est pas classé', () => {
    const domain = composeBrowserNavigationDomain();
    expect(domain.classify('Quelle heure est-il ?')).toBeNull();
  });

  it('ouvre une réconciliation par commande (machine d’état à l’état idle)', () => {
    const domain = composeBrowserNavigationDomain();
    const reconciliation = domain.beginReconciliation({ commandId: 'c3' });
    expect(reconciliation.state()).toBe('idle');
  });

  it('le traceur alimente le status (par phase, sans donnée privée)', () => {
    const domain = composeBrowserNavigationDomain();
    domain.tracer.record({ phase: 'playwright', route: 'fast', durationMs: 42, status: 'ok' });
    const status = domain.status();
    expect(status.spans).toBe(1);
    expect(status.byPhase.playwright.count).toBe(1);
    const blob = JSON.stringify(status);
    expect(blob).not.toMatch(/http|youtube|meteo/u); // aucune URL/requête
  });
});
