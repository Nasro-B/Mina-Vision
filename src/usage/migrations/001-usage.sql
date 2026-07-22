CREATE TABLE usage_attempts (
  attempt_id TEXT PRIMARY KEY,
  attempt_digest TEXT NOT NULL,
  session_id TEXT,
  correlation_id TEXT,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  channel TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  status TEXT NOT NULL CHECK (status IN ('success', 'error', 'timeout', 'cancelled')),
  locality TEXT NOT NULL CHECK (locality IN ('local', 'cloud')),
  completeness TEXT NOT NULL CHECK (completeness IN ('partial', 'final')),
  raw_digest TEXT,
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  cached_input_tokens INTEGER CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  reasoning_tokens INTEGER CHECK (reasoning_tokens IS NULL OR reasoning_tokens >= 0),
  input_images REAL CHECK (input_images IS NULL OR input_images >= 0),
  input_audio_seconds REAL CHECK (input_audio_seconds IS NULL OR input_audio_seconds >= 0),
  output_audio_seconds REAL CHECK (output_audio_seconds IS NULL OR output_audio_seconds >= 0),
  local_compute_ms REAL CHECK (local_compute_ms IS NULL OR local_compute_ms >= 0),
  cost_micros INTEGER CHECK (cost_micros IS NULL OR cost_micros >= 0),
  provider_cost_micros INTEGER CHECK (provider_cost_micros IS NULL OR provider_cost_micros >= 0),
  currency TEXT,
  cost_kind TEXT NOT NULL CHECK (cost_kind IN ('provider_reported', 'catalog_estimate', 'unknown')),
  pricing_revision TEXT,
  error_category TEXT,
  route_metadata_ciphertext BLOB
) STRICT;

CREATE INDEX usage_attempts_started_idx ON usage_attempts(started_at);
CREATE INDEX usage_attempts_provider_started_idx ON usage_attempts(provider_id, started_at);
CREATE INDEX usage_attempts_correlation_idx ON usage_attempts(correlation_id);
