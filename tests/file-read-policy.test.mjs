import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCapabilityBroker } from '../src/safety/capability-broker.mjs';
import { createFileReadPolicy } from '../src/files/file-read-policy.mjs';

let root;
let outside;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mina-bounded-files-'));
  outside = await mkdtemp(join(tmpdir(), 'mina-bounded-outside-'));
});

afterEach(async () => {
  await Promise.all([root, outside].map((path) => rm(path, { recursive: true, force: true })));
});

function brokerFor(resources) {
  return createCapabilityBroker({
    clock: () => Date.parse('2026-07-15T00:00:00.000Z'),
    grants: [{
      sessionId: 'session-1',
      capabilities: ['files.read'],
      resources,
      effects: ['read'],
      expiresAt: '2026-07-16T00:00:00.000Z',
    }],
  });
}

describe('bounded file read policy', () => {
  it('authorizes files.read only after resolving the final real path', async () => {
    const path = join(root, 'notes.txt');
    await writeFile(path, 'bonjour', 'utf8');
    const authorize = vi.fn(async () => ({ decision: 'allow' }));
    const policy = await createFileReadPolicy({ capabilityBroker: { authorize } });

    const canonical = await policy.authorize({
      path,
      purpose: 'Répondre à la demande explicite',
      maxBytes: 1_024,
      sessionId: 'session-1',
      channel: 'local',
    });

    expect(isAbsolute(canonical)).toBe(true);
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({
      capability: 'files.read',
      resource: canonical,
      effect: 'read',
      sessionId: 'session-1',
      channel: 'local',
      origin: 'user',
    }));
    expect(authorize.mock.calls[0][0].digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it('rejects relative paths, sensitive stores and UNC resources before reading', async () => {
    const envPath = join(root, '.env');
    await writeFile(envPath, 'TOKEN=secret', 'utf8');
    const policy = await createFileReadPolicy({ capabilityBroker: brokerFor(['*']) });

    await expect(policy.authorize({ path: 'notes.txt', purpose: 'read', maxBytes: 10, sessionId: 'session-1' }))
      .rejects.toThrow('absolute_file_path_required');
    await expect(policy.authorize({ path: envPath, purpose: 'read', maxBytes: 10, sessionId: 'session-1' }))
      .rejects.toThrow('sensitive_file_forbidden');
    await expect(policy.authorize({ path: '\\\\server\\share\\file.txt', purpose: 'read', maxBytes: 10, sessionId: 'session-1' }))
      .rejects.toThrow('network_path_forbidden');
  });

  it('prevents a symlink or junction from escaping the granted resource scope', async () => {
    const secret = join(outside, 'outside.txt');
    const link = join(root, 'escape.txt');
    await writeFile(secret, 'outside', 'utf8');
    await symlink(secret, link, 'file');
    const policy = await createFileReadPolicy({ capabilityBroker: brokerFor([`${root}*`]) });

    await expect(policy.authorize({
      path: link,
      purpose: 'read',
      maxBytes: 100,
      sessionId: 'session-1',
    })).rejects.toThrow('files_read_denied:resource_scope');
  });

  it('honours cancellation and refuses missing authorization context', async () => {
    const path = join(root, 'notes.txt');
    await writeFile(path, 'bonjour', 'utf8');
    const controller = new AbortController();
    controller.abort();
    const policy = await createFileReadPolicy({ capabilityBroker: brokerFor(['*']) });

    await expect(policy.authorize({
      path,
      purpose: 'read',
      maxBytes: 100,
      sessionId: 'session-1',
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(policy.authorize({ path, purpose: '', maxBytes: 100, sessionId: 'session-1' }))
      .rejects.toThrow('file_read_purpose_required');
  });
});
