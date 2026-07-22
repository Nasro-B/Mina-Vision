import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const AUTOMATION_SQL = readFileSync(new URL('./migrations/001-automation.sql', import.meta.url), 'utf8');
const MIGRATION = Object.freeze({ version: 1, name: 'automation', sql: AUTOMATION_SQL });
const TERMINAL_STATUSES = new Set(['completed', 'unknown', 'cancelled']);

function migrationChecksum(migration) {
  return createHash('sha256').update(`${migration.version}\0${migration.name}\0${migration.sql}`).digest('hex');
}

export function applyAutomationMigrations(db) {
  if (!db?.exec || !db?.prepare || !db?.transaction) throw new TypeError('automation_database_required');
  db.exec(`
    CREATE TABLE IF NOT EXISTS automation_schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    ) STRICT
  `);
  const checksum = migrationChecksum(MIGRATION);
  const existing = db.prepare('SELECT name, checksum FROM automation_schema_migrations WHERE version = ?').get(MIGRATION.version);
  if (existing) {
    if (existing.name !== MIGRATION.name || existing.checksum !== checksum) throw new Error('automation_migration_checksum_mismatch:1');
    return;
  }
  db.transaction(() => {
    db.exec(MIGRATION.sql);
    db.prepare('INSERT INTO automation_schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)')
      .run(MIGRATION.version, MIGRATION.name, checksum, Date.now());
  })();
}

function rowToRun(row, steps) {
  if (!row) return null;
  return {
    runId: row.run_id,
    automationId: row.automation_id,
    simulationId: row.simulation_id,
    digest: row.digest,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? null,
    reconciliationAttempts: row.reconciliation_attempts,
    steps: steps.map(rowToStep),
  };
}

function rowToStep(row) {
  return {
    key: row.step_key,
    runId: row.run_id,
    index: row.step_index,
    action: JSON.parse(row.action_json),
    receipt: JSON.parse(row.receipt_json),
    evidence: JSON.parse(row.evidence_json),
    status: row.status,
    recordedAt: row.recorded_at,
    updatedAt: row.updated_at,
  };
}

export function createAutomationLedger({ db, clock } = {}) {
  if (!db?.prepare) throw new TypeError('automation_ledger_database_required');
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('automation_ledger_clock_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());

  const insertRun = db.prepare(`
    INSERT INTO automation_runs (run_id, automation_id, simulation_id, digest, status, started_at, finished_at)
    VALUES (@runId, @automationId, @simulationId, @digest, 'running', @startedAt, NULL)
  `);
  const selectRun = db.prepare('SELECT * FROM automation_runs WHERE run_id = ?');
  const selectRunsByStatus = db.prepare('SELECT * FROM automation_runs WHERE status = ? ORDER BY started_at DESC');
  const selectAllRuns = db.prepare('SELECT * FROM automation_runs ORDER BY started_at DESC');
  const selectSteps = db.prepare('SELECT * FROM automation_run_steps WHERE run_id = ? ORDER BY step_index ASC');
  const incrementReconciliationAttempts = db.prepare(
    'UPDATE automation_runs SET reconciliation_attempts = reconciliation_attempts + 1 WHERE run_id = ?',
  );
  const insertStep = db.prepare(`
    INSERT INTO automation_run_steps (step_key, run_id, step_index, action_json, receipt_json, evidence_json, status, recorded_at, updated_at)
    VALUES (@key, @runId, @index, @actionJson, @receiptJson, @evidenceJson, @status, @recordedAt, @recordedAt)
  `);
  const selectStep = db.prepare('SELECT * FROM automation_run_steps WHERE step_key = ?');
  const updateStep = db.prepare('UPDATE automation_run_steps SET evidence_json = @evidenceJson, status = @status, updated_at = @updatedAt WHERE step_key = @key');
  const updateRunStatus = db.prepare('UPDATE automation_runs SET status = @status, finished_at = @finishedAt WHERE run_id = @runId');

  async function getRun(runId) {
    const row = selectRun.get(runId);
    if (!row) return null;
    return rowToRun(row, selectSteps.all(runId));
  }

  return Object.freeze({
    async startRun({ runId, automationId, simulationId, digest }) {
      const existing = await getRun(runId);
      if (existing) return existing;
      insertRun.run({ runId, automationId, simulationId, digest, startedAt: now() });
      return getRun(runId);
    },

    async recordStep({ runId, key, index, action = null, receipt, evidence, status }) {
      insertStep.run({
        key, runId, index,
        actionJson: JSON.stringify(action),
        receiptJson: JSON.stringify(receipt),
        evidenceJson: JSON.stringify(evidence),
        status,
        recordedAt: now(),
      });
      return (await getRun(runId)).steps.find((step) => step.key === key);
    },

    async updateStepEvidence({ key, evidence, status }) {
      updateStep.run({ key, evidenceJson: JSON.stringify(evidence), status, updatedAt: now() });
      const row = selectStep.get(key);
      return row ? rowToStep(row) : null;
    },

    async getStepByKey(key) {
      const row = selectStep.get(key);
      return row ? rowToStep(row) : null;
    },

    async finishRun({ runId, status }) {
      updateRunStatus.run({ runId, status, finishedAt: TERMINAL_STATUSES.has(status) ? now() : null });
      return getRun(runId);
    },

    async recordReconciliationAttempt(runId) {
      incrementReconciliationAttempts.run(runId);
      return getRun(runId);
    },

    async listRuns({ status } = {}) {
      const rows = status ? selectRunsByStatus.all(status) : selectAllRuns.all();
      return Object.freeze(rows.map((row) => rowToRun(row, selectSteps.all(row.run_id))));
    },

    getRun,
  });
}
