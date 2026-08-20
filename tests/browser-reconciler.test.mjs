import { describe, expect, it } from 'vitest';
import { createBrowserReconciliation } from '../src/browser/browser-reconciler.mjs';

describe('browser-reconciler', () => {
  it('déroule idle → classified → authorized → dispatching → navigating → verifying → completed', () => {
    const r = createBrowserReconciliation({ commandId: 'c1' });
    for (const next of ['classified', 'authorized', 'dispatching', 'navigating', 'verifying', 'completed']) r.transition(next);
    expect(r.state()).toBe('completed');
    expect(r.isTerminal()).toBe(true);
  });

  it('refuse une transition illégale', () => {
    const r = createBrowserReconciliation({ commandId: 'c' });
    expect(() => r.transition('navigating')).toThrow('browser_reconcile_invalid:idle->navigating');
  });

  it('UNE seule récupération : la deuxième épuise le budget (jamais de boucle)', () => {
    const r = createBrowserReconciliation({ commandId: 'c', maxRecoveries: 1 });
    for (const next of ['classified', 'authorized', 'dispatching', 'navigating']) r.transition(next);
    r.transition('recovering');
    r.transition('navigating');
    expect(() => r.transition('recovering')).toThrow('browser_recovery_budget_exhausted');
    expect(r.recoveryCount()).toBe(1);
  });

  it('une référence DOM d’un ancien navigationId est REFUSÉE (§10.4)', () => {
    const r = createBrowserReconciliation({ commandId: 'c' });
    r.setNavigation('nav-1');
    expect(r.isRefValid('nav-1')).toBe(true);
    r.setNavigation('nav-2'); // nouvelle navigation
    expect(r.isRefValid('nav-1')).toBe(false);
    expect(r.isRefValid('nav-2')).toBe(true);
  });

  it('détecte l’expiration de la deadline', () => {
    let t = 0;
    const r = createBrowserReconciliation({ commandId: 'c', deadlineMs: 1_000, now: () => t });
    expect(r.isExpired()).toBe(false);
    t = 1_500;
    expect(r.isExpired()).toBe(true);
  });

  it('chemins alternatifs : confirmation_required, blocked, cancelled', () => {
    const r = createBrowserReconciliation({ commandId: 'c' });
    r.transition('classified');
    expect(r.can('confirmation_required')).toBe(true);
    r.transition('confirmation_required');
    r.transition('blocked');
    expect(r.isTerminal()).toBe(true);
  });

  it('exige un commandId', () => {
    expect(() => createBrowserReconciliation({})).toThrow('browser_reconcile_command_required');
  });
});
