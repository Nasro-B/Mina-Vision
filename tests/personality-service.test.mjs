import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createPersonalityService } from '../src/personality/personality-service.mjs';

const KEY = randomBytes(32);

function fakeKeyring() {
  return { open: vi.fn(async () => KEY) };
}

function fakeConfigRepository() {
  const rows = new Map();
  return { rows, get: vi.fn(async (id) => rows.get(id) ?? null), put: vi.fn(async (id, value) => rows.set(id, value)) };
}

function buildService(overrides = {}) {
  return createPersonalityService({ keyring: fakeKeyring(), configRepository: fakeConfigRepository(), clock: () => 1_700_000_000_000, ...overrides });
}

describe('createPersonalityService: constructor guards', () => {
  it('requires a keyring', () => {
    expect(() => createPersonalityService({ configRepository: fakeConfigRepository(), clock: () => 0 })).toThrow('personality_service_keyring_required');
  });

  it('requires a config repository', () => {
    expect(() => createPersonalityService({ keyring: fakeKeyring(), clock: () => 0 })).toThrow('personality_service_config_repository_required');
  });

  it('requires a clock', () => {
    expect(() => createPersonalityService({ keyring: fakeKeyring(), configRepository: fakeConfigRepository() })).toThrow('personality_service_clock_required');
  });
});

describe('createPersonalityService: exact plan example (safety isolation)', () => {
  it('rejects a patch field outside the style allowlist, even one shaped like a capability grant', async () => {
    const service = buildService();
    await expect(service.proposePatch({ allowedCapabilities: ['home.security'] })).rejects.toThrow('personality_field_forbidden');
  });

  it('rejects patch fields that look like safety/facts/capability escapes (Global Constraint)', async () => {
    const service = buildService();
    await expect(service.proposePatch({ safety: 'disabled' })).rejects.toThrow('personality_field_forbidden');
    await expect(service.proposePatch({ facts: [] })).rejects.toThrow('personality_field_forbidden');
    await expect(service.proposePatch({ capabilities: ['shell.raw'] })).rejects.toThrow('personality_field_forbidden');
    await expect(service.proposePatch({ activationPhrase: 'anything now goes' })).rejects.toThrow('personality_field_forbidden');
  });

  it('renders a style context with no memoryPolicy and displayName defaulting to Mina', async () => {
    const service = buildService();
    const context = await service.renderStyleContext('telegram');
    expect(context).not.toHaveProperty('memoryPolicy');
    expect(context.displayName).toBe('Mina');
  });
});

describe('createPersonalityService.get: default profile before any patch', () => {
  it('returns the default profile when nothing was ever confirmed', async () => {
    const service = buildService();
    const profile = await service.get();
    expect(profile).toMatchObject({ displayName: 'Mina', language: 'fr', tone: 'neutral' });
  });
});

describe('createPersonalityService.proposePatch: bounded values, not free text', () => {
  it('rejects a tone value outside the enum', async () => {
    const service = buildService();
    await expect(service.proposePatch({ tone: 'sarcastic-unbounded' })).rejects.toThrow();
  });
});

describe('createPersonalityService.proposePatch / confirmPatch: every patch requires local confirmation', () => {
  it('never mutates the active profile on proposePatch alone', async () => {
    const service = buildService();
    const staged = await service.proposePatch({ tone: 'warm' });
    expect(staged.requiresLocalConfirmation).toBe(true);
    expect((await service.get()).tone).toBe('neutral');
  });

  it('applies the patch only after confirmPatch, and reflects it in get()', async () => {
    const service = buildService();
    const staged = await service.proposePatch({ tone: 'warm', humorLevel: 'more' });
    const confirmed = await service.confirmPatch(staged.patchId);
    expect(confirmed.profile.tone).toBe('warm');
    expect(confirmed.profile.humorLevel).toBe('more');
    expect((await service.get()).tone).toBe('warm');
  });

  it('reports a diff of exactly the changed fields', async () => {
    const service = buildService();
    const staged = await service.proposePatch({ tone: 'formal' });
    expect(staged.diff).toEqual({ tone: { from: 'neutral', to: 'formal' } });
  });

  it('rejects confirming an unknown patchId', async () => {
    const service = buildService();
    await expect(service.confirmPatch('missing')).rejects.toThrow('personality_patch_not_found');
  });
});

describe('createPersonalityService.rollback: one atomic pointer restore', () => {
  it('restores the previous version after a confirmed patch', async () => {
    const service = buildService();
    const staged = await service.proposePatch({ tone: 'warm' });
    await service.confirmPatch(staged.patchId);
    expect((await service.get()).tone).toBe('warm');

    const rolledBack = await service.rollback();
    expect(rolledBack.profile.tone).toBe('neutral');
    expect((await service.get()).tone).toBe('neutral');
  });

  it('rejects rollback when there is no previous version', async () => {
    const service = buildService();
    await expect(service.rollback()).rejects.toThrow('personality_no_previous_version');
  });
});

describe('createPersonalityService: channelOverrides isolation', () => {
  it('applies an override only to its own channel, leaving other channels on the global style', async () => {
    const service = buildService();
    const staged = await service.proposePatch({ channelOverrides: { telegram: { tone: 'playful' } } });
    await service.confirmPatch(staged.patchId);

    const telegramContext = await service.renderStyleContext('telegram');
    const samsungContext = await service.renderStyleContext('samsung');
    expect(telegramContext.tone).toBe('playful');
    expect(samsungContext.tone).toBe('neutral');
  });
});

describe('createPersonalityService: persistence is genuinely encrypted, not a plaintext bypass', () => {
  it('never stores the patched tone value in cleartext in the config repository', async () => {
    const repository = fakeConfigRepository();
    const service = buildService({ configRepository: repository });
    const staged = await service.proposePatch({ tone: 'formal', displayName: 'SentinelleUnique' });
    await service.confirmPatch(staged.patchId);

    const stored = repository.rows.get('personality-profile-active');
    expect(Buffer.isBuffer(stored) || typeof stored === 'string').toBe(true);
    expect(String(stored)).not.toContain('SentinelleUnique');
    expect(String(stored)).not.toContain('formal');
  });

  it('fails closed when decrypted with the wrong key (AEAD auth tag mismatch)', async () => {
    const repository = fakeConfigRepository();
    const service = buildService({ configRepository: repository });
    const staged = await service.proposePatch({ tone: 'formal' });
    await service.confirmPatch(staged.patchId);

    const wrongKeyring = { open: vi.fn(async () => randomBytes(32)) };
    const wrongService = createPersonalityService({ keyring: wrongKeyring, configRepository: repository, clock: () => 1_700_000_000_000 });
    await expect(wrongService.get()).rejects.toThrow();
  });
});
