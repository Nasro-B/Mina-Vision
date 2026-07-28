import { describe, expect, it, vi } from 'vitest';
import { createBootSupervisor, BOOT_STATES } from '../src/boot/boot-supervisor.mjs';
import { bootFault, bootFaultArmed, BOOT_FAULT_ENV_KEY } from '../src/boot/boot-fault.mjs';
import { buildCrashScreenHtml, crashReport, shouldShowCrashScreen } from '../src/boot/crash-screen.mjs';

describe('boot-supervisor — T1.2', () => {
  const sub = (id, start, extra = {}) => ({ id, circle: 'gele', critical: false, start, ...extra });

  it('démarre chaque sous-système dans l\'ordre et rend un bilan vert', async () => {
    const order = [];
    const supervisor = createBootSupervisor();
    supervisor.register(sub('a', async () => { order.push('a'); }));
    supervisor.register(sub('b', async () => { order.push('b'); }));
    const bilan = await supervisor.startAll();
    expect(order).toEqual(['a', 'b']);
    expect(bilan.ok).toBe(true);
    expect(bilan.results.every((r) => r.state === BOOT_STATES.started)).toBe(true);
  });

  it('un NON-critique qui échoue → unavailable(raison), le boot CONTINUE', async () => {
    const started = [];
    const capabilities = [];
    const supervisor = createBootSupervisor({ onCapability: (c) => capabilities.push(c) });
    supervisor.register(sub('mail', () => { throw new Error('mail_indisponible'); }));
    supervisor.register(sub('voice', () => { started.push('voice'); }, { circle: 'coeur' }));
    const bilan = await supervisor.startAll();
    // Le sous-système suivant a bien démarré malgré l'échec du premier.
    expect(started).toEqual(['voice']);
    expect(bilan.ok).toBe(true); // aucun critique en échec
    expect(supervisor.get('mail').state).toBe(BOOT_STATES.unavailable);
    expect(supervisor.get('mail').reason).toBe('mail_indisponible');
    // Publié au catalogue de vérité avec sa raison nommée.
    expect(capabilities).toContainEqual({ id: 'mail', status: 'unavailable', reason: 'mail_indisponible' });
  });

  it('un CRITIQUE qui échoue est signalé (bilan non ok) mais les autres démarrent quand même', async () => {
    const started = [];
    const supervisor = createBootSupervisor();
    supervisor.register(sub('memory', () => { throw new Error('coffre_illisible'); }, { circle: 'coeur', critical: true }));
    supervisor.register(sub('journal', () => { started.push('journal'); }, { circle: 'coeur' }));
    const bilan = await supervisor.startAll();
    expect(bilan.ok).toBe(false);
    expect(bilan.failedCritical).toEqual([{ id: 'memory', reason: 'coffre_illisible' }]);
    expect(supervisor.get('memory').state).toBe(BOOT_STATES.failed);
    // Isolement : le critique en échec n'empêche pas le reste de s'initialiser.
    expect(started).toEqual(['journal']);
  });

  it('startAll RÉSOUT toujours, même si un sous-système rejette de façon asynchrone', async () => {
    const supervisor = createBootSupervisor();
    supervisor.register(sub('flaky', () => Promise.reject(new Error('async_boom'))));
    await expect(supervisor.startAll()).resolves.toMatchObject({ ok: true });
    expect(supervisor.get('flaky').state).toBe(BOOT_STATES.unavailable);
  });

  it('la raison d\'un échec est bornée et ne fuit pas l\'objet d\'erreur complet', async () => {
    const supervisor = createBootSupervisor();
    const long = 'x'.repeat(1000);
    supervisor.register(sub('big', () => { throw new Error(long); }));
    await supervisor.startAll();
    expect(supervisor.get('big').reason.length).toBe(300);
  });

  it('valide ses sous-systèmes (id, cercle, start, doublon)', () => {
    const supervisor = createBootSupervisor();
    expect(() => supervisor.register({})).toThrow(/boot_subsystem_id_required/u);
    expect(() => supervisor.register(sub('x', 'pas-une-fonction'))).toThrow(/boot_subsystem_start_required/u);
    expect(() => supervisor.register(sub('y', () => {}, { circle: 'inconnu' }))).toThrow(/boot_subsystem_circle_invalid/u);
    supervisor.register(sub('z', () => {}));
    expect(() => supervisor.register(sub('z', () => {}))).toThrow(/boot_subsystem_duplicate:z/u);
  });

  it('un onProgress qui jette ne casse pas le boot', async () => {
    const supervisor = createBootSupervisor({ onProgress: () => { throw new Error('journal_casse'); } });
    supervisor.register(sub('a', () => {}));
    await expect(supervisor.startAll()).resolves.toMatchObject({ ok: true });
  });

  it('run() exécute un domaine immédiatement, isolé, et respecte l\'ordre inline', async () => {
    const order = [];
    const capabilities = [];
    const supervisor = createBootSupervisor({ onCapability: (c) => capabilities.push(c) });
    // Cas réel : trois domaines enchaînés, le deuxième échoue — les deux autres tournent quand même
    // et l'ordre d'écriture est respecté (contrairement à startAll qui suppose l'indépendance).
    await supervisor.run(sub('avant', () => { order.push('avant'); }));
    const casse = await supervisor.run(sub('mail', () => { throw new Error('mail_ko'); }));
    await supervisor.run(sub('apres', () => { order.push('apres'); }));
    expect(order).toEqual(['avant', 'apres']);
    expect(casse.state).toBe(BOOT_STATES.unavailable);
    expect(casse.reason).toBe('mail_ko');
    expect(capabilities).toContainEqual({ id: 'mail', status: 'unavailable', reason: 'mail_ko' });
    expect(supervisor.ok()).toBe(true); // aucun critique en échec
  });

  it('run() sur un domaine CRITIQUE en échec bascule ok() à faux', async () => {
    const supervisor = createBootSupervisor();
    await supervisor.run(sub('memory', () => { throw new Error('coffre_ko'); }, { critical: true }));
    expect(supervisor.get('memory').state).toBe(BOOT_STATES.failed);
    expect(supervisor.ok()).toBe(false);
  });
});

describe('boot-fault — T1.1', () => {
  it('no-op quand la variable est absente (coût nul en production)', () => {
    expect(() => bootFault('memory', {})).not.toThrow();
    expect(bootFaultArmed('memory', {})).toBe(false);
  });

  it('lève UNIQUEMENT pour l\'étape armée, avec un message reconnaissable non sensible', () => {
    const env = { [BOOT_FAULT_ENV_KEY]: 'memory' };
    expect(() => bootFault('memory', env)).toThrow(/boot_fault_injected:memory/u);
    expect(() => bootFault('voice', env)).not.toThrow();
  });

  it('accepte une liste d\'étapes séparées par des virgules', () => {
    const env = { [BOOT_FAULT_ENV_KEY]: 'memory, voice ,camera' };
    expect(bootFaultArmed('memory', env)).toBe(true);
    expect(bootFaultArmed('voice', env)).toBe(true);
    expect(bootFaultArmed('camera', env)).toBe(true);
    expect(bootFaultArmed('mail', env)).toBe(false);
  });

  it('une valeur vide n\'arme rien', () => {
    expect(bootFaultArmed('memory', { [BOOT_FAULT_ENV_KEY]: '' })).toBe(false);
    expect(bootFaultArmed('memory', { [BOOT_FAULT_ENV_KEY]: '  ' })).toBe(false);
  });
});

describe('crash-screen — T1.3', () => {
  it('ne s\'ouvre QUE si aucune fenêtre visible n\'existe déjà', () => {
    expect(shouldShowCrashScreen({ hasVisibleWindow: false })).toBe(true);
    expect(shouldShowCrashScreen({ hasVisibleWindow: true })).toBe(false);
    expect(shouldShowCrashScreen({})).toBe(true); // absence d'info = pire cas = on montre
  });

  it('réduit l\'erreur à un rapport borné, sans sérialiser l\'objet entier', () => {
    const report = crashReport({ error: new Error('y'.repeat(5000)), step: 'coffre' });
    expect(report.title).toContain('coffre');
    expect(report.detail.length).toBe(2_000);
  });

  it('échappe le HTML du message d\'erreur (pas d\'injection dans son propre écran)', () => {
    const html = buildCrashScreenHtml({ error: new Error('<img src=x onerror=alert(1)>'), step: '<b>x</b>' });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  it('produit un document autonome : aucune ressource externe, CSP verrouillée', () => {
    const html = buildCrashScreenHtml({ error: new Error('boom') });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain("default-src 'none'");
    expect(html).not.toMatch(/https?:\/\//u); // zéro URL distante
    expect(html).toContain('Copier le rapport');
    expect(html).toContain('Relancer Mina');
  });

  it('gère une erreur sans message sans planter', () => {
    expect(() => buildCrashScreenHtml({ error: null })).not.toThrow();
    expect(crashReport({}).detail).toBe('erreur inconnue');
  });
});
