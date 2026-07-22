import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyJobHistoryMigration, createJobHistory } from '../src/sandbox/job-history.mjs';

const SECRET = 'SANDBOX_PRIVATE_REQUEST_89c7b32a';
let directory;
let filename;
let db;
let history;

function request() {
  return {
    jobId: 'job-1',
    requestedAt: 1_752_566_400_000,
    request: { language: 'python', prompt: SECRET, entrypoint: 'src/main.py' },
    confirmations: [
      { kind: 'workspace_write', tokenDigest: `sha256:${'a'.repeat(64)}` },
      { kind: 'sandbox_execute', tokenDigest: `sha256:${'b'.repeat(64)}` },
    ],
    digests: { job: `sha256:${'c'.repeat(64)}`, sources: `sha256:${'d'.repeat(64)}` },
  };
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mina-job-history-'));
  filename = join(directory, 'jobs.sqlite');
  db = new Database(filename);
  applyJobHistoryMigration(db);
  history = createJobHistory({ db, encryptionKey: Buffer.alloc(32, 91), maxEvents: 5, maxTotalBytes: 4096 });
});

afterEach(async () => {
  if (db?.open) db.close();
  await rm(directory, { recursive: true, force: true });
});

describe('encrypted sandbox job history', () => {
  it('records request, confirmations, bounded events, usage, result and artifacts', async () => {
    await history.create(request());
    await history.appendEvent('job-1', { eventId: 'event-1', type: 'started', jobId: 'job-1' });
    await history.appendEvent('job-1', { eventId: 'event-2', type: 'stdout', text: SECRET });
    await history.complete('job-1', {
      status: 'completed', completedAt: 1_752_566_400_500,
      usage: { cpuMs: 100, memoryPeakMiB: 42, costMicros: 0 },
      result: { exitCode: 0, summary: SECRET },
      artifacts: [{ path: 'out/result.json', digest: `sha256:${'e'.repeat(64)}`, size: 12 }],
    });

    expect(history.read('job-1')).toEqual({
      ...request(), status: 'completed', completedAt: 1_752_566_400_500,
      usage: { cpuMs: 100, memoryPeakMiB: 42, costMicros: 0 },
      result: { exitCode: 0, summary: SECRET },
      artifacts: [{ path: 'out/result.json', digest: `sha256:${'e'.repeat(64)}`, size: 12 }],
      events: [
        { eventId: 'event-1', type: 'started', jobId: 'job-1' },
        { eventId: 'event-2', type: 'stdout', text: SECRET },
      ],
    });
  });

  it('replays event retries idempotently and rejects conflicting event ids', async () => {
    await history.create(request());
    const event = { eventId: 'event-1', type: 'stdout', text: 'same' };
    await expect(history.appendEvent('job-1', event)).resolves.toMatchObject({ appended: true });
    await expect(history.appendEvent('job-1', event)).resolves.toMatchObject({ appended: false, idempotent: true });
    await expect(history.appendEvent('job-1', { ...event, text: 'different' })).rejects.toThrow('sandbox_history_event_conflict');
    expect(history.read('job-1').events).toHaveLength(1);
  });

  it('enforces event count, per-event and total bounds', async () => {
    await history.create(request());
    for (let index = 0; index < 5; index += 1) {
      await history.appendEvent('job-1', { eventId: `event-${index}`, type: 'stdout', text: 'x' });
    }
    await expect(history.appendEvent('job-1', { eventId: 'event-6', type: 'stdout', text: 'x' }))
      .rejects.toThrow('sandbox_history_event_count_exceeded');
    await expect(history.create({ ...request(), jobId: 'job-2' })).resolves.toBeDefined();
    await expect(history.appendEvent('job-2', { eventId: 'large', type: 'stdout', text: 'x'.repeat(64 * 1024) }))
      .rejects.toThrow('sandbox_history_event_too_large');
  });

  it('stores no request, output or artifact plaintext and migrations are idempotent', async () => {
    applyJobHistoryMigration(db);
    await history.create(request());
    await history.appendEvent('job-1', { eventId: 'event-secret', type: 'stderr', text: SECRET });
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
    const raw = await readFile(filename);
    expect(raw.includes(Buffer.from(SECRET))).toBe(false);
    db = new Database(filename);
    const columns = db.pragma('table_info(sandbox_jobs)').map(({ name }) => name);
    expect(columns).not.toEqual(expect.arrayContaining(['prompt', 'request', 'result', 'artifact', 'output']));
  });
});
