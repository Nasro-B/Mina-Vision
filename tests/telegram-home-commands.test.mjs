import { describe, expect, it, vi } from 'vitest';
import { createTelegramHomeCommands } from '../src/messaging/telegram-home-commands.mjs';
import { createSmartHomeRegistry } from '../src/home/registry.mjs';
import { createSmartHomePolicy } from '../src/home/policy.mjs';
import { createSmartHomeRouter } from '../src/home/router.mjs';
import { createSmartHomeService } from '../src/home/service.mjs';

const LIGHT = Object.freeze({
  deviceId: 'light-bedroom', displayName: 'Plafonnier', aliases: [], roomId: 'bedroom', roomName: 'Chambre', deviceClass: 'light',
  capabilities: ['read_state', 'turn_on', 'turn_off'],
  bindings: [{ connectorId: 'home-assistant', bindingId: 'b1', capabilities: ['read_state', 'turn_on', 'turn_off'] }],
  riskTier: 'low', confirmationPolicy: 'never', enabled: true,
});
const PLUG = Object.freeze({
  ...LIGHT, deviceId: 'plug-salon', displayName: 'Prise salon', roomName: 'Salon',
  riskTier: 'medium', confirmationPolicy: 'always',
});
const LOCK = Object.freeze({ ...LIGHT, deviceId: 'lock-porte', displayName: 'Serrure', riskTier: 'high' });

function harness({ devices = [LIGHT, PLUG, LOCK], telegramLowRiskEnabled = true } = {}) {
  const connector = {
    id: 'home-assistant', network: 'lan', health: () => ({ available: true }), supports: () => true,
    execute: vi.fn(async () => ({ accepted: true })),
    readState: vi.fn(async () => ({ on: true })),
  };
  const homeService = createSmartHomeService({
    registry: createSmartHomeRegistry({ devices }),
    policy: createSmartHomePolicy({ telegramLowRiskEnabled }),
    router: createSmartHomeRouter({ connectors: [connector] }),
    now: () => 1_000,
  });
  const deps = {
    isOwner: vi.fn(async (sender) => sender === '999111222'),
    homeService,
    homeRegistry: createSmartHomeRegistry({ devices }),
    audit: vi.fn(),
    createCommandId: (() => { let n = 0; return () => `123e4567-e89b-42d3-a456-42661417400${n++}`; })(),
    now: () => 1_000,
  };
  return { commands: createTelegramHomeCommands(deps), deps, connector };
}

describe('Telegram /home commands: owner identity is the only gate', () => {
  it('refuses a non-owner sender and audits the denial', async () => {
    const { commands, deps } = harness();
    const result = await commands.handle({ sender: 'stranger', body: '/home status' });
    expect(deps.audit).toHaveBeenCalledWith(expect.objectContaining({ type: 'telegram_home_command_denied_identity' }));
    expect(result.reply.join('')).not.toContain('Plafonnier');
  });

  it('ignores non-/home text', async () => {
    const { commands } = harness();
    await expect(commands.handle({ sender: '999111222', body: 'bonjour' })).resolves.toBeNull();
  });
});

describe('Telegram /home commands: status and low-risk direct execution', () => {
  it('lists enabled devices on /home status', async () => {
    const { commands } = harness();
    const result = await commands.handle({ sender: '999111222', body: '/home status' });
    expect(result.reply.join('')).toContain('Plafonnier');
  });

  it('executes a low-risk device turn_on directly and confirms the resulting state', async () => {
    const { commands, connector } = harness();
    const result = await commands.handle({ sender: '999111222', body: '/home Plafonnier on' });
    expect(connector.execute).toHaveBeenCalledTimes(1);
    expect(result.reply.join('')).toContain('confirmé');
  });
});

describe('Telegram /home commands: medium risk drafts, high risk refuses', () => {
  it('never executes a medium-risk device directly, only produces a local-confirmation draft', async () => {
    const { commands, connector } = harness();
    const result = await commands.handle({ sender: '999111222', body: '/home "Prise salon" on' });
    expect(connector.execute).not.toHaveBeenCalled();
    expect(result.reply.join('')).toContain('confirmation locale');
  });

  it('refuses a high-risk device outright with no draft offered', async () => {
    const { commands, connector } = harness();
    const result = await commands.handle({ sender: '999111222', body: '/home Serrure on' });
    expect(connector.execute).not.toHaveBeenCalled();
    expect(result.reply.join('')).toContain('refusé');
  });
});

describe('Telegram /home commands: ambiguous target asks for clarification, never guesses', () => {
  it('reports clarification_required instead of picking a device arbitrarily', async () => {
    const dup = { ...LIGHT, deviceId: 'light-2', aliases: ['Plafonnier'] };
    const { commands } = harness({ devices: [LIGHT, dup, PLUG, LOCK] });
    const result = await commands.handle({ sender: '999111222', body: '/home Plafonnier on' });
    expect(result.reply.join('')).toContain('ambigu');
  });
});
