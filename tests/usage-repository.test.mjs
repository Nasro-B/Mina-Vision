import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyUsageMigrations, createUsageRepository } from '../src/usage/usage-repository.mjs';

const PRIVATE_MARKER = 'PRIVATE_PROMPT_9bc277e1';
let db;
let directory;
let filename;
let repository;

function attempt(overrides = {}) {
  return {
    attemptId: 'attempt-1',
    sessionId: 'session-1',
    correlationId: 'correlation-1',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    capability: 'text.generate',
    channel: 'desktop',
    startedAt: '2026-07-15T06:00:00.000Z',
    endedAt: '2026-07-15T06:00:00.120Z',
    latencyMs: 120,
    status: 'success',
    locality: 'cloud',
    completeness: 'final',
    rawDigest: 'sha256:abc',
    units: {
      inputTokens: 100,
      cachedInputTokens: 20,
      outputTokens: 30,
      reasoningTokens: 5,
      inputImages: 0,
      inputAudioSeconds: 0,
      outputAudioSeconds: 0,
      localComputeMs: null,
    },
    cost: { costMicros: 42, providerCostMicros: null, currency: 'USD', costKind: 'catalog_estimate', pricingRevision: 'deepseek-2026-07' },
    errorCategory: null,
    routeMetadata: { routeIndex: 0, mode: 'auto', prompt: PRIVATE_MARKER, endpoint: `https://${PRIVATE_MARKER}.invalid` },
    prompt: PRIVATE_MARKER,
    response: PRIVATE_MARKER,
    messageBody: PRIVATE_MARKER,
    faceData: PRIVATE_MARKER,
    ...overrides,
  };
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mina-usage-'));
  filename = join(directory, 'usage.sqlite');
  db = new Database(filename);
  applyUsageMigrations(db);
  repository = createUsageRepository({ db, encryptionKey: Buffer.alloc(32, 73) });
});

afterEach(async () => {
  if (db?.open) db.close();
  await rm(directory, { recursive: true, force: true });
});

describe('privacy-safe usage repository', () => {
  it('applies migrations and records the same attempt idempotently', async () => {
    applyUsageMigrations(db);
    await repository.recordAttempt(attempt());
    await repository.recordAttempt(attempt());

    expect(db.prepare('SELECT COUNT(*) AS count FROM usage_attempts').get().count).toBe(1);
    expect(repository.getAttempt('attempt-1')).toMatchObject({
      attemptId: 'attempt-1', providerId: 'deepseek', channel: 'desktop', costMicros: 42,
      routeMetadata: { routeIndex: 0, mode: 'auto' },
    });
  });

  it('never stores prompt, response, message, file, face or raw route secrets', async () => {
    await repository.recordAttempt(attempt({
      fileContents: PRIVATE_MARKER,
      smsBody: PRIVATE_MARKER,
      emailBody: PRIVATE_MARKER,
    }));
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();

    const raw = await readFile(filename);
    expect(raw.includes(Buffer.from(PRIVATE_MARKER))).toBe(false);

    db = new Database(filename);
    const columns = db.pragma('table_info(usage_attempts)').map(({ name }) => name);
    expect(columns).not.toEqual(expect.arrayContaining([
      'prompt', 'response', 'message_body', 'file_contents', 'sms_body', 'email_body', 'face_data', 'raw_usage',
    ]));
  });

  it('rejects a conflicting replay for an existing attempt id', async () => {
    await repository.recordAttempt(attempt());
    await expect(repository.recordAttempt(attempt({ providerId: 'gemini' })))
      .rejects.toThrow('usage_attempt_conflict');
  });
});
