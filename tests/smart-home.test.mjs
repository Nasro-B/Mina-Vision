import { describe, expect, it, vi } from 'vitest';
import { normalizeSmartHomeIntent } from '../src/home/intent-normalizer.mjs';
import { createSmartHomeRegistry } from '../src/home/registry.mjs';
import { createSmartHomePolicy } from '../src/home/policy.mjs';
import { createSmartHomeRouter } from '../src/home/router.mjs';
import { createSmartHomeService } from '../src/home/service.mjs';

const light = Object.freeze({
  deviceId: 'light-bedroom', displayName: 'Plafonnier', aliases: ['lumière chambre'],
  roomId: 'bedroom', roomName: 'Chambre', deviceClass: 'light',
  capabilities: ['read_state', 'turn_on', 'turn_off', 'set_brightness'],
  bindings: [
    { connectorId: 'google-home', bindingId: 'opaque-google-1', capabilities: ['read_state', 'turn_on', 'turn_off'] },
    { connectorId: 'home-assistant', bindingId: 'opaque-ha-1', capabilities: ['read_state', 'turn_on', 'turn_off'] },
  ],
  riskTier: 'low', confirmationPolicy: 'never', enabled: true,
});

describe('smart home intent and target resolution', () => {
  it('normalizes only allowlisted verbs and rejects toggle', () => {
    expect(normalizeSmartHomeIntent({
      action: 'set_brightness', targetText: 'lumière chambre', value: 42,
      sourceChannel: 'voice', sessionId: 'session-1',
    })).toEqual({
      action: 'set_brightness', targetText: 'lumière chambre', value: 42,
      desiredState: { brightness: 42 }, sourceChannel: 'voice', sessionId: 'session-1',
    });
    expect(() => normalizeSmartHomeIntent({
      action: 'toggle', targetText: 'lampe', sourceChannel: 'voice', sessionId: 'session-1',
    })).toThrow('smart_home_action_invalid');
  });

  it('returns an ambiguity instead of picking the first matching device', () => {
    const second = { ...light, deviceId: 'light-bedside', displayName: 'Chevet', aliases: ['lumière chambre'] };
    const registry = createSmartHomeRegistry({ devices: [light, second] });

    expect(registry.resolve({ targetText: 'lumière chambre' })).toMatchObject({
      status: 'ambiguous', candidates: [{ deviceId: 'light-bedroom' }, { deviceId: 'light-bedside' }],
    });
  });
});

describe('smart home registry: alias and risk edits', () => {
  it('updates aliases and risk tier for an existing device without touching others', () => {
    const registry = createSmartHomeRegistry({ devices: [light] });
    const updated = registry.update('light-bedroom', { aliases: ['lumière chambre', 'plafonnier chambre'], riskTier: 'medium' });
    expect(updated.aliases).toEqual(['lumière chambre', 'plafonnier chambre']);
    expect(registry.get('light-bedroom').riskTier).toBe('medium');
  });

  it('rejects editing a field outside the allowlist, such as deviceId or bindings', () => {
    const registry = createSmartHomeRegistry({ devices: [light] });
    expect(() => registry.update('light-bedroom', { deviceId: 'hacked' })).toThrow('smart_home_device_patch_invalid');
  });

  it('rejects updating a device that does not exist', () => {
    const registry = createSmartHomeRegistry({ devices: [light] });
    expect(() => registry.update('ghost', { riskTier: 'medium' })).toThrow('smart_home_device_not_found');
  });
});

describe('smart home policy and routing', () => {
  it('allows a validated low-risk light, confirms unknown switches, and denies blocked devices', () => {
    const policy = createSmartHomePolicy({ telegramLowRiskEnabled: true });
    expect(policy.decide({ device: light, action: 'turn_on', sourceChannel: 'telegram' })).toEqual({ decision: 'allow' });
    expect(policy.decide({ device: { ...light, riskTier: 'medium' }, action: 'turn_on', sourceChannel: 'voice' }))
      .toMatchObject({ decision: 'confirm' });
    expect(policy.decide({ device: { ...light, riskTier: 'blocked' }, action: 'read_state', sourceChannel: 'local_ui' }))
      .toMatchObject({ decision: 'deny' });
  });

  it('requires a local confirmation draft for a medium-risk device requested from Telegram, never a direct allow', () => {
    const policy = createSmartHomePolicy({ telegramLowRiskEnabled: true });
    expect(policy.decide({ device: { ...light, riskTier: 'medium' }, action: 'turn_on', sourceChannel: 'telegram', confirmedLocally: true }))
      .toEqual({ decision: 'confirm', reason: 'telegram_medium_requires_local_confirmation' });
  });

  it('refuses a high-risk device from Telegram outright, never offering a confirmation draft', () => {
    const policy = createSmartHomePolicy({ telegramLowRiskEnabled: true });
    expect(policy.decide({ device: { ...light, riskTier: 'high' }, action: 'turn_on', sourceChannel: 'telegram' }))
      .toEqual({ decision: 'deny', reason: 'risk_blocked' });
  });

  it('prefers local connectors and disables cloud connectors only in offline mode', () => {
    const router = createSmartHomeRouter({ connectors: [
      { id: 'google-home', network: 'internet', health: () => ({ available: true }), supports: () => true },
      { id: 'home-assistant', network: 'lan', health: () => ({ available: true }), supports: () => true },
    ] });
    expect(router.resolve({ device: light, action: 'turn_on', offline: false }).connector.id).toBe('home-assistant');
    expect(router.resolve({ device: { ...light, bindings: [light.bindings[0]] }, action: 'turn_on', offline: true }))
      .toEqual({ status: 'unavailable' });
  });
});

describe('smart home verified execution', () => {
  it('never reports success until a post-command state read matches the desired state', async () => {
    const connector = {
      id: 'home-assistant', network: 'lan',
      health: () => ({ available: true }), supports: () => true,
      execute: vi.fn(async () => ({ accepted: true, providerReceipt: 'opaque' })),
      readState: vi.fn(async () => ({ on: false, observedAt: 2_000 })),
    };
    const service = createSmartHomeService({
      registry: createSmartHomeRegistry({ devices: [light] }),
      policy: createSmartHomePolicy(),
      router: createSmartHomeRouter({ connectors: [connector] }),
      now: () => 1_000,
    });
    const request = {
      commandId: '123e4567-e89b-42d3-a456-426614174000',
      intent: normalizeSmartHomeIntent({ action: 'turn_on', targetText: 'Plafonnier', sourceChannel: 'voice', sessionId: 's-1' }),
      expiresAt: 61_000,
    };

    await expect(service.execute(request)).resolves.toMatchObject({ state: 'accepted_by_provider', verified: false });
    connector.readState.mockResolvedValue({ on: true, observedAt: 3_000 });
    await expect(service.execute({ ...request, commandId: '123e4567-e89b-42d3-a456-426614174001' }))
      .resolves.toMatchObject({ state: 'state_confirmed', verified: true });
  });

  it('deduplicates command ids and never converts a retry into toggle', async () => {
    const connector = {
      id: 'home-assistant', network: 'lan', health: () => ({ available: true }), supports: () => true,
      execute: vi.fn(async (_binding, command) => ({ accepted: true, command })),
      readState: vi.fn(async () => ({ on: true, observedAt: 2_000 })),
    };
    const service = createSmartHomeService({
      registry: createSmartHomeRegistry({ devices: [light] }), policy: createSmartHomePolicy(),
      router: createSmartHomeRouter({ connectors: [connector] }), now: () => 1_000,
    });
    const request = {
      commandId: '123e4567-e89b-42d3-a456-426614174002', expiresAt: 61_000,
      intent: normalizeSmartHomeIntent({ action: 'turn_on', targetText: 'Plafonnier', sourceChannel: 'voice', sessionId: 's-1' }),
    };

    const first = await service.execute(request);
    const duplicate = await service.execute(request);
    expect(duplicate).toEqual(first);
    expect(connector.execute).toHaveBeenCalledTimes(1);
    expect(connector.execute.mock.calls[0][1]).toMatchObject({ action: 'turn_on', desiredState: { on: true } });
  });

  it('reports a second concurrent call for the same in-flight command id as in_progress, never running the connector twice at once', async () => {
    let releaseExecute;
    const connector = {
      id: 'home-assistant', network: 'lan', health: () => ({ available: true }), supports: () => true,
      execute: vi.fn(() => new Promise((resolve) => { releaseExecute = () => resolve({ accepted: true }); })),
      readState: vi.fn(async () => ({ on: true, observedAt: 2_000 })),
    };
    const service = createSmartHomeService({
      registry: createSmartHomeRegistry({ devices: [light] }), policy: createSmartHomePolicy(),
      router: createSmartHomeRouter({ connectors: [connector] }), now: () => 1_000,
    });
    const request = {
      commandId: '123e4567-e89b-42d3-a456-426614174003', expiresAt: 61_000,
      intent: normalizeSmartHomeIntent({ action: 'turn_on', targetText: 'Plafonnier', sourceChannel: 'voice', sessionId: 's-1' }),
    };

    const inFlight = service.execute(request);
    const concurrent = await service.execute(request);
    expect(concurrent).toEqual({ commandId: request.commandId, state: 'in_progress', verified: false });
    releaseExecute();
    await expect(inFlight).resolves.toMatchObject({ state: 'state_confirmed' });
    expect(connector.execute).toHaveBeenCalledTimes(1);
  });
});
