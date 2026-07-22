import { describe, expect, it, vi } from 'vitest';
import { createHomeController } from '../src/ui/pages/home-controller.mjs';
import { registerHomeIpc } from '../src/ui/ipc/home-ipc.mjs';
import { createSmartHomeRegistry } from '../src/home/registry.mjs';

const LIGHT = Object.freeze({
  deviceId: 'light-bedroom', displayName: 'Plafonnier', aliases: [], roomId: 'bedroom', roomName: 'Chambre', deviceClass: 'light',
  capabilities: ['read_state', 'turn_on'], bindings: [], riskTier: 'low', confirmationPolicy: 'never', enabled: true,
});

function harness(overrides = {}) {
  const registry = createSmartHomeRegistry({ devices: [LIGHT] });
  const deps = {
    registry,
    service: {
      execute: vi.fn(async () => ({ commandId: 'c1', deviceId: 'light-bedroom', state: 'state_confirmed', verified: true })),
      getReceipt: vi.fn(() => null),
    },
    connectors: {
      'home-assistant': { health: vi.fn(async () => ({ available: true })), discoverEntities: vi.fn(async () => ([{ entityId: 'light.x' }])) },
      'google-home': { health: vi.fn(async () => ({ available: false })) },
    },
    audit: vi.fn(),
    ...overrides,
  };
  return { controller: createHomeController(deps), deps, registry };
}

describe('home controller: read-only surfaces never leak secrets', () => {
  it('lists devices with bounded fields, no provider tokens', async () => {
    const { controller } = harness();
    const devices = controller.list();
    expect(devices).toEqual([expect.objectContaining({ deviceId: 'light-bedroom', displayName: 'Plafonnier' })]);
    expect(JSON.stringify(devices)).not.toMatch(/token|secret|password/i);
  });

  it('reports connector health for every registered connector', async () => {
    const { controller } = harness();
    await expect(controller.connectorHealth()).resolves.toEqual({
      'home-assistant': { available: true }, 'google-home': { available: false },
    });
  });

  it('discovers entities only for a connector that supports discovery', async () => {
    const { controller } = harness();
    await expect(controller.discover('home-assistant')).resolves.toEqual([{ entityId: 'light.x' }]);
    await expect(controller.discover('google-home')).resolves.toEqual({ supported: false });
  });

  it('requests permission only for a connector that supports it, never crashing otherwise', async () => {
    const { controller } = harness();
    await expect(controller.requestPermission('home-assistant')).resolves.toEqual({ supported: false });
  });

  it('resolves a target the same way the service would', () => {
    const { controller } = harness();
    expect(controller.resolve({ targetText: 'Plafonnier' })).toMatchObject({ status: 'resolved' });
  });
});

describe('home controller: alias/risk edits require local confirmation and audit', () => {
  it('rejects an edit without local confirmation', async () => {
    const { controller } = harness();
    await expect(controller.editDevice({ deviceId: 'light-bedroom', patch: { riskTier: 'medium' }, confirmedLocally: false }))
      .rejects.toThrow('home_device_edit_confirmation_required');
  });

  it('applies an edit once confirmed locally and audits the change', async () => {
    const { controller, deps, registry } = harness();
    await controller.editDevice({ deviceId: 'light-bedroom', patch: { aliases: ['lumière chambre'] }, confirmedLocally: true });
    expect(registry.get('light-bedroom').aliases).toEqual(['lumière chambre']);
    expect(deps.audit).toHaveBeenCalledWith(expect.objectContaining({ type: 'home_device_edited', deviceId: 'light-bedroom' }));
  });
});

describe('home controller: propose/execute and diagnostics', () => {
  it('executes an intent through the smart home service', async () => {
    const { controller, deps } = harness();
    const result = await controller.execute({
      commandId: '123e4567-e89b-42d3-a456-426614174000',
      intent: { action: 'turn_on', targetText: 'Plafonnier', sourceChannel: 'local_ui', sessionId: 's1', desiredState: { on: true } },
      expiresAt: Date.now() + 30_000,
    });
    expect(result.state).toBe('state_confirmed');
    expect(deps.service.execute).toHaveBeenCalledTimes(1);
  });

  it('returns audit history as the receipt for a given command id', () => {
    const { controller, deps } = harness({ service: { execute: vi.fn(), getReceipt: vi.fn(() => ({ commandId: 'c1', state: 'state_confirmed' })) } });
    expect(controller.auditHistory('c1')).toEqual({ commandId: 'c1', state: 'state_confirmed' });
  });
});

describe('home IPC: named allowlist only', () => {
  it('registers exactly the expected named channels', () => {
    const handlers = new Map();
    const ipcMain = { handle: vi.fn((channel, handler) => handlers.set(channel, handler)) };
    const { controller } = harness();
    registerHomeIpc({ ipcMain, controller });

    expect([...handlers.keys()]).toEqual([
      'mina:home:connector-health',
      'mina:home:request-permission',
      'mina:home:discover',
      'mina:home:list',
      'mina:home:resolve',
      'mina:home:edit-device',
      'mina:home:execute',
      'mina:home:audit-history',
    ]);
  });
});
