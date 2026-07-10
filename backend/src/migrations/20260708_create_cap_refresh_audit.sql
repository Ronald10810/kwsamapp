CREATE TABLE IF NOT EXISTS migration.cap_refresh_audit (
  id BIGSERIAL PRIMARY KEY,
  triggered_by_user_id BIGINT NULL,
  triggered_by_email TEXT NULL,
  trigger_source TEXT NOT NULL,
  transaction_id BIGINT NOT NULL,
  transaction_number TEXT NULL,
  envelope_key TEXT NOT NULL,
  envelope_type TEXT NOT NULL,
  cycle_start_date DATE NOT NULL,
  cycle_end_date DATE NOT NULL,
  rows_scanned INTEGER NOT NULL DEFAULT 0,
  rows_affected INTEGER NOT NULL DEFAULT 0,
  before_snapshot_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  after_snapshot_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  protected_field_check_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NULL,
  duration_ms INTEGER NULL,
  success BOOLEAN NOT NULL DEFAULT false,
  error_message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cap_refresh_audit_transaction_id
  ON migration.cap_refresh_audit (transaction_id);

CREATE INDEX IF NOT EXISTS idx_cap_refresh_audit_envelope_key
  ON migration.cap_refresh_audit (envelope_key);

CREATE INDEX IF NOT EXISTS idx_cap_refresh_audit_created_at
  ON migration.cap_refresh_audit (created_at DESC);