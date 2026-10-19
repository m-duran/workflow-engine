import { Pool } from "pg";

export const schemaSql = `
CREATE TABLE IF NOT EXISTS runs (
  id uuid PRIMARY KEY,
  workflow text NOT NULL,
  input jsonb NOT NULL,
  state text NOT NULL CHECK (state IN (
    'Accepted', 'Running', 'Waiting', 'Compensating',
    'Succeeded', 'Cancelled', 'Failed', 'Dead-lettered'
  )),
  cancel_requested boolean NOT NULL,
  unwind_reason text CHECK (
    unwind_reason IS NULL OR unwind_reason IN ('retries-exhausted', 'cancelled')
  ),
  failure_injection jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 255),
  not_before timestamptz NULL,
  UNIQUE (workflow, idempotency_key)
);

CREATE TABLE IF NOT EXISTS attempts (
  run_id uuid NOT NULL REFERENCES runs (id),
  step text NOT NULL,
  attempt integer NOT NULL CHECK (attempt >= 1),
  outcome text NOT NULL CHECK (outcome IN ('in-flight', 'succeeded', 'failed', 'timed-out')),
  started_at timestamptz NOT NULL,
  finished_at timestamptz NULL,
  PRIMARY KEY (run_id, step, attempt),
  CHECK ((finished_at IS NULL) = (outcome = 'in-flight'))
);

CREATE UNIQUE INDEX IF NOT EXISTS attempts_one_in_flight
  ON attempts (run_id) WHERE outcome = 'in-flight';

CREATE INDEX IF NOT EXISTS runs_state_not_before ON runs (state, not_before);

CREATE INDEX IF NOT EXISTS runs_created_at ON runs (created_at);
`;

export function createPool(databaseUrl: string): Pool {
  return new Pool({ connectionString: databaseUrl });
}

export async function migrate(pool: Pool): Promise<void> {
  await pool.query(schemaSql);
}

export async function resetRuns(pool: Pool): Promise<void> {
  await pool.query("TRUNCATE attempts, runs");
}
