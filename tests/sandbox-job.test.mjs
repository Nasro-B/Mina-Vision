import { describe, expect, it } from 'vitest';
import { createSandboxSourceDigest, parseSandboxJob, SANDBOX_PROFILES } from '../src/sandbox/job-schema.mjs';

const sourceFiles = Object.freeze([
  { path: 'src/main.py', digest: `sha256:${'a'.repeat(64)}`, mode: 'read-only' },
]);

function job(overrides = {}) {
  return {
    language: 'python',
    sourceFiles,
    entrypoint: 'src/main.py',
    args: ['--count', '3'],
    profile: 'small',
    limits: { wallMs: 30_000, memoryMiB: 256, outputBytes: 1024 * 1024 },
    network: false,
    exports: ['out/result.json'],
    ...overrides,
  };
}

function context(overrides = {}) {
  return {
    channel: 'local',
    explicitExecution: true,
    sourceConfirmation: { approved: true, digest: createSandboxSourceDigest(sourceFiles), token: 'write-confirm-1' },
    ...overrides,
  };
}

describe('strict sandbox job contract', () => {
  it('freezes a confirmed bounded job without a free-form shell command', () => {
    const parsed = parseSandboxJob(job(), context());
    expect(parsed).toMatchObject({ language: 'python', profile: 'small', network: false });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.sourceFiles)).toBe(true);
    expect(SANDBOX_PROFILES.small).toEqual({ wallMs: 30_000, memoryMiB: 256, outputBytes: 1024 * 1024 });
  });

  it('rejects arbitrary commands, absolute/traversing paths, network and excessive limits', () => {
    expect(() => parseSandboxJob({ ...job(), command: 'powershell -enc hostile' }, context()))
      .toThrow('sandbox_job_fields_invalid');
    expect(() => parseSandboxJob(job({ entrypoint: 'C:\\Windows\\System32\\cmd.exe' }), context()))
      .toThrow('sandbox_path_invalid');
    expect(() => parseSandboxJob(job({ exports: ['../escape.txt'] }), context()))
      .toThrow('sandbox_path_invalid');
    expect(() => parseSandboxJob(job({ network: true }), context())).toThrow('sandbox_network_forbidden');
    expect(() => parseSandboxJob(job({ limits: { ...job().limits, wallMs: 30_001 } }), context()))
      .toThrow('sandbox_limit_exceeded:wallMs');
  });

  it('requires a matching language extension, an in-workspace entrypoint and source confirmation', () => {
    expect(() => parseSandboxJob(job({ language: 'javascript' }), context())).toThrow('sandbox_entrypoint_extension_invalid');
    expect(() => parseSandboxJob(job({ entrypoint: 'src/other.py' }), context())).toThrow('sandbox_entrypoint_not_in_sources');
    expect(() => parseSandboxJob(job(), context({ sourceConfirmation: null }))).toThrow('sandbox_source_confirmation_required');
    expect(() => parseSandboxJob(job(), context({
      sourceConfirmation: { approved: true, digest: `sha256:${'b'.repeat(64)}`, token: 'wrong' },
    }))).toThrow('sandbox_source_confirmation_invalid');
  });

  it('permits requests only from local or voice after an explicit execution formula', () => {
    for (const channel of ['sms', 'telegram', 'email']) {
      expect(() => parseSandboxJob(job(), context({ channel }))).toThrow(`sandbox_channel_forbidden:${channel}`);
    }
    expect(() => parseSandboxJob(job(), context({ explicitExecution: false }))).toThrow('sandbox_explicit_execution_required');
  });

  it('requires reinforced confirmation for the large profile', () => {
    const large = job({ profile: 'large', limits: { ...SANDBOX_PROFILES.large } });
    expect(() => parseSandboxJob(large, context())).toThrow('sandbox_large_confirmation_required');
    expect(parseSandboxJob(large, context({ largeConfirmation: { approved: true, token: 'large-1' } })))
      .toMatchObject({ profile: 'large' });
  });
});
