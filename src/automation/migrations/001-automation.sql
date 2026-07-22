CREATE TABLE automation_runs (
  run_id TEXT PRIMARY KEY,
  automation_id TEXT NOT NULL,
  simulation_id TEXT NOT NULL,
  digest TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'unknown', 'cancelled')),
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  reconciliation_attempts INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE INDEX automation_runs_automation_idx ON automation_runs(automation_id);

CREATE TABLE automation_run_steps (
  step_key TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES automation_runs(run_id),
  step_index INTEGER NOT NULL,
  action_json TEXT NOT NULL DEFAULT 'null',
  receipt_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('verified', 'unknown')),
  recorded_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX automation_run_steps_run_idx ON automation_run_steps(run_id);
