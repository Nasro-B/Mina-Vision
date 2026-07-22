import { describe, expect, it, vi } from 'vitest';
import { createComputerActionAuthorizer } from '../src/safety/computer-action-authorizer.mjs';
import { createCapabilityBroker } from '../src/safety/capability-broker.mjs';

const NOW = Date.parse('2026-07-22T10:00:00.000Z');

const missionBroker = (overrides = {}) => createCapabilityBroker({
  clock: () => NOW,
  grants: [{
    sessionId: 'work-1',
    capabilities: ['computer.*'],
    effects: ['read', 'execute'],
    resources: ['*'],
    expiresAt: new Date(NOW + 900_000).toISOString(),
    ...overrides,
  }],
});

describe('computer action authorizer (R-01)', () => {
  it('construit la requête canonique : capability, effet, ressource dérivée du contexte, digest sha256', async () => {
    const authorize = vi.fn(async () => ({ decision: 'deny', reason: 'session_grant' }));
    const authorizer = createComputerActionAuthorizer({
      capabilityBroker: { authorize, grantConfirmation: vi.fn() },
    });
    const result = await authorizer.assess({
      sessionId: 'work-1',
      channel: 'local',
      origin: 'model',
      action: { name: 'click', x: 10, y: 20, intent: 'ouvrir le menu', expectedEffect: { type: 'ui_state_change' } },
      context: { app: 'Google Chrome', url: 'https://example.test/page' },
    });
    expect(result.decision).toBe('deny');
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'work-1',
      capability: 'computer.click',
      effect: 'execute',
      resource: 'https://example.test',
      sensitivity: 'ordinary',
    }));
    expect(authorize.mock.calls[0][0].digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it('sans grant de session, TOUTE action est refusée — même un simple déplacement', async () => {
    const authorizer = createComputerActionAuthorizer({
      capabilityBroker: createCapabilityBroker({ clock: () => NOW, grants: [] }),
    });
    const denied = await authorizer.assess({
      sessionId: 'work-1',
      action: { name: 'move', x: 5, y: 5 },
      context: { app: 'Chrome' },
    });
    expect(denied).toMatchObject({ decision: 'deny', reason: 'session_grant' });
  });

  it('grant borné : action ordinaire autorisée pendant la mission, refusée après expiration', async () => {
    let now = NOW;
    const broker = createCapabilityBroker({
      clock: () => now,
      grants: [{
        sessionId: 'work-1',
        capabilities: ['computer.*'],
        effects: ['read', 'execute'],
        resources: ['*'],
        expiresAt: new Date(NOW + 60_000).toISOString(),
      }],
    });
    const authorizer = createComputerActionAuthorizer({ capabilityBroker: broker, clock: () => now });
    const input = { sessionId: 'work-1', action: { name: 'click', x: 1, y: 2, intent: 'clic banal' }, context: { app: 'Chrome' } };
    await expect(authorizer.assess(input)).resolves.toMatchObject({ decision: 'allow' });
    now = NOW + 120_000;
    await expect(authorizer.assess(input)).resolves.toMatchObject({ decision: 'deny', reason: 'session_grant' });
  });

  it('action sensible : confirm exigé, puis confirmation consommée UNE seule fois sur le digest exact', async () => {
    const broker = missionBroker();
    const authorizer = createComputerActionAuthorizer({ capabilityBroker: broker, clock: () => NOW });
    const input = {
      sessionId: 'work-1',
      action: { name: 'type', text: 'commande', intent: 'envoyer le message final', safetyDecision: 'require_confirmation' },
      context: { app: 'Mail' },
    };
    const first = await authorizer.assess(input);
    expect(first).toMatchObject({ decision: 'confirm', reason: 'confirmation_required' });

    const consumed = await authorizer.confirm({ request: first.request });
    expect(consumed).toMatchObject({ decision: 'allow', reason: 'confirmation_consumed' });

    // Rejouer la même action : la confirmation est consommée, il en faut une nouvelle.
    await expect(authorizer.assess(input)).resolves.toMatchObject({ decision: 'confirm' });
  });

  it('l\'arrêt dur de classifyAction reste : gestionnaire de mots de passe bloqué SANS interroger le broker', async () => {
    const authorize = vi.fn(async () => ({ decision: 'allow', reason: 'authorized' }));
    const authorizer = createComputerActionAuthorizer({
      capabilityBroker: { authorize, grantConfirmation: vi.fn() },
    });
    const blocked = await authorizer.assess({
      sessionId: 'work-1',
      action: { name: 'click', x: 1, y: 1 },
      context: { app: '1Password' },
    });
    expect(blocked).toMatchObject({ decision: 'deny', hardBlock: true });
    expect(authorize).not.toHaveBeenCalled();
  });

  it('capacités interdites en défense en profondeur : computer.password_manager refusé par la base', async () => {
    const broker = missionBroker();
    const authorizer = createComputerActionAuthorizer({ capabilityBroker: broker });
    const denied = await authorizer.assess({
      sessionId: 'work-1',
      action: { name: 'password_manager' },
      context: { app: 'Chrome' },
    });
    expect(denied).toMatchObject({ decision: 'deny', reason: 'base_policy' });
  });

  it('digest différent par action : deux clics à des coordonnées différentes ne partagent jamais une confirmation', async () => {
    const authorizer = createComputerActionAuthorizer({ capabilityBroker: missionBroker() });
    const base = { sessionId: 'work-1', context: { app: 'Chrome' } };
    const first = await authorizer.assess({ ...base, action: { name: 'click', x: 1, y: 1, intent: 'supprimer le fichier' } });
    const second = await authorizer.assess({ ...base, action: { name: 'click', x: 9, y: 9, intent: 'supprimer le fichier' } });
    expect(first.request.digest).not.toBe(second.request.digest);
  });
});
