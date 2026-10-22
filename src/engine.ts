import type { Pool, PoolClient } from "pg";
import { orderWorkflow, steps, type StepContext, type StepPolicy } from "./order";

type Injection = { step: string; mode: "fail" | "timeout" };

type OpenAttempt = {
  runId: string;
  step: string;
  attempt: number;
  ctx: StepContext;
  injection: Injection[];
};

type AttemptResult =
  | { outcome: "succeeded"; output: unknown }
  | { outcome: "failed" | "timed-out" };

export type StoredRun = {
  id: string;
  workflow: string;
  input: unknown;
  state: string;
  cancel_requested: boolean;
  unwind_reason: string | null;
  failure_injection: Injection[];
  created_at: Date;
};

const runColumns =
  "id, workflow, input, state, cancel_requested, unwind_reason, failure_injection, created_at";

const terminalStates = new Set(["Succeeded", "Failed", "Dead-lettered", "Cancelled"]);

export type CancelDecision =
  | { kind: "missing" }
  | { kind: "rejected" }
  | { kind: "ok"; run: StoredRun };

export async function requestCancel(pool: Pool, runId: string): Promise<CancelDecision> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query<StoredRun>(
      `SELECT ${runColumns} FROM runs WHERE id = $1 FOR UPDATE`,
      [runId],
    );
    const run = found.rows[0];
    if (!run) {
      await client.query("COMMIT");
      return { kind: "missing" };
    }
    if (terminalStates.has(run.state)) {
      await client.query("COMMIT");
      return { kind: "rejected" };
    }
    if (run.state === "Compensating") {
      await client.query("COMMIT");
      return { kind: "ok", run };
    }
    if (run.state === "Accepted") {
      const updated = await client.query<StoredRun>(
        `UPDATE runs
         SET state = 'Cancelled',
             cancel_requested = false,
             unwind_reason = NULL,
             not_before = NULL
         WHERE id = $1
         RETURNING ${runColumns}`,
        [runId],
      );
      await client.query("COMMIT");
      const cancelled = updated.rows[0];
      if (!cancelled) throw new Error(`cancel did not return run ${runId}`);
      return { kind: "ok", run: cancelled };
    }

    const updated = await client.query<StoredRun>(
      `UPDATE runs
       SET cancel_requested = true,
           not_before = CASE WHEN state = 'Waiting' THEN NULL ELSE not_before END
       WHERE id = $1
       RETURNING ${runColumns}`,
      [runId],
    );
    await client.query("COMMIT");
    const flagged = updated.rows[0];
    if (!flagged) throw new Error(`cancel did not return run ${runId}`);
    return { kind: "ok", run: flagged };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export type Worker = {
  stop: () => Promise<void>;
  exclusive: <T>(fn: () => Promise<T>) => Promise<T>;
};

export function startWorker(pool: Pool): Worker {
  let stopped = false;
  let tail: Promise<void> = Promise.resolve();

  function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = tail.then(fn, fn);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  const loop = (async () => {
    while (!stopped) {
      try {
        const worked = await exclusive(() => driveOneRun(pool));
        if (!worked && !stopped) await delay(20);
      } catch (error) {
        console.error(error);
        if (!stopped) await delay(20);
      }
    }
  })();

  return {
    exclusive,
    async stop() {
      stopped = true;
      await loop;
    },
  };
}

async function driveOneRun(pool: Pool): Promise<boolean> {
  let current = await claimWork(pool);
  if (!current) return false;

  while (current) {
    const result = await invoke(current);
    current = await recordOutcome(pool, current, result);
  }
  return true;
}

async function invoke(current: OpenAttempt): Promise<AttemptResult> {
  const definition = steps[current.step];
  if (!definition) throw new Error(`no step registered for ${current.step}`);
  const injected = current.injection.find((entry) => entry.step === current.step);
  if (injected?.mode === "fail") return { outcome: "failed" };
  if (injected?.mode === "timeout") {
    await delay(definition.policy.timeoutMs);
    return { outcome: "timed-out" };
  }
  const output = await definition.run(current.ctx);
  return { outcome: "succeeded", output };
}

async function claimWork(pool: Pool): Promise<OpenAttempt | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query<{
      id: string;
      input: unknown;
      state: string;
      failure_injection: Injection[];
      cancel_requested: boolean;
    }>(
      `SELECT id, input, state, failure_injection, cancel_requested
       FROM runs
       WHERE state IN ('Accepted', 'Waiting', 'Compensating')
         AND (not_before IS NULL OR not_before <= clock_timestamp())
         AND NOT EXISTS (
           SELECT 1 FROM attempts
           WHERE attempts.run_id = runs.id AND attempts.outcome = 'in-flight'
         )
       ORDER BY created_at
       LIMIT 1
       FOR UPDATE`,
    );
    const run = found.rows[0];
    if (!run) {
      await client.query("COMMIT");
      return null;
    }

    if (run.state === "Waiting" && run.cancel_requested) {
      const opened = await unwindCancel(client, {
        id: run.id,
        input: run.input,
        failure_injection: run.failure_injection,
      });
      await client.query("COMMIT");
      return opened;
    }

    const next =
      run.state === "Compensating"
        ? await nextCompensationAttempt(client, run.id)
        : await nextForwardAttempt(client, run.id, run.state);
    await client.query(
      `UPDATE runs SET state = $2, not_before = NULL WHERE id = $1`,
      [run.id, run.state === "Compensating" ? "Compensating" : "Running"],
    );
    await client.query(
      `INSERT INTO attempts (run_id, step, attempt, outcome, started_at, finished_at)
       VALUES ($1, $2, $3, 'in-flight', clock_timestamp(), NULL)`,
      [run.id, next.step, next.attempt],
    );
    await client.query("COMMIT");
    return {
      runId: run.id,
      step: next.step,
      attempt: next.attempt,
      ctx: { input: run.input, outputs: {} },
      injection: run.failure_injection,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function nextForwardAttempt(
  client: PoolClient,
  runId: string,
  state: string,
): Promise<{ step: string; attempt: number }> {
  if (state === "Accepted") {
    const step = orderWorkflow.forward[0];
    if (!step) throw new Error("order workflow has no forward steps");
    return { step, attempt: 1 };
  }

  const stored = await client.query<{ step: string; attempt: number; outcome: string }>(
    `SELECT step, attempt, outcome FROM attempts WHERE run_id = $1`,
    [runId],
  );
  for (const step of orderWorkflow.forward) {
    const rows = stored.rows.filter((row) => row.step === step);
    if (rows.some((row) => row.outcome === "succeeded")) continue;
    const latest = rows.reduce((max, row) => Math.max(max, row.attempt), 0);
    if (latest === 0) break;
    return { step, attempt: latest + 1 };
  }
  throw new Error(`waiting run ${runId} has no step to retry`);
}

async function nextCompensationAttempt(
  client: PoolClient,
  runId: string,
): Promise<{ step: string; attempt: number }> {
  const stored = await client.query<{ step: string; attempt: number; outcome: string }>(
    `SELECT step, attempt, outcome FROM attempts WHERE run_id = $1`,
    [runId],
  );
  for (const step of Object.values(orderWorkflow.compensations)) {
    const rows = stored.rows.filter((row) => row.step === step);
    if (rows.some((row) => row.outcome === "succeeded")) continue;
    const latest = rows.reduce((max, row) => Math.max(max, row.attempt), 0);
    if (latest === 0) continue;
    return { step, attempt: latest + 1 };
  }
  throw new Error(`compensating run ${runId} has no step to retry`);
}

async function recordOutcome(
  pool: Pool,
  current: OpenAttempt,
  result: AttemptResult,
): Promise<OpenAttempt | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query<{ cancel_requested: boolean }>(
      `SELECT cancel_requested FROM runs WHERE id = $1 FOR UPDATE`,
      [current.runId],
    );
    const cancelRequested = locked.rows[0]?.cancel_requested ?? false;
    const next =
      result.outcome === "succeeded"
        ? await recordSuccess(client, current, result.output, cancelRequested)
        : await recordFailure(client, current, result.outcome, cancelRequested);
    await client.query("COMMIT");
    return next;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function recordSuccess(
  client: PoolClient,
  current: OpenAttempt,
  output: unknown,
  cancelRequested: boolean,
): Promise<OpenAttempt | null> {
  await client.query(
    `UPDATE attempts
     SET outcome = 'succeeded', finished_at = clock_timestamp()
     WHERE run_id = $1 AND step = $2 AND attempt = $3 AND outcome = 'in-flight'`,
    [current.runId, current.step, current.attempt],
  );

  if (isCompensation(current.step)) {
    return finishCompensation(client, current);
  }

  if (cancelRequested) return unwindCancel(client, runFrom(current));

  const position = orderWorkflow.forward.indexOf(current.step);
  const next = orderWorkflow.forward[position + 1];
  if (!next) {
    await client.query(
      `UPDATE runs SET state = 'Succeeded', not_before = NULL WHERE id = $1`,
      [current.runId],
    );
    return null;
  }

  await client.query(
    `INSERT INTO attempts (run_id, step, attempt, outcome, started_at, finished_at)
     VALUES ($1, $2, 1, 'in-flight', clock_timestamp(), NULL)`,
    [current.runId, next],
  );
  return {
    runId: current.runId,
    step: next,
    attempt: 1,
    ctx: {
      input: current.ctx.input,
      outputs: { ...current.ctx.outputs, [current.step]: output },
    },
    injection: current.injection,
  };
}

async function recordFailure(
  client: PoolClient,
  current: OpenAttempt,
  outcome: "failed" | "timed-out",
  cancelRequested: boolean,
): Promise<OpenAttempt | null> {
  await client.query(
    `UPDATE attempts
     SET outcome = $4, finished_at = clock_timestamp()
     WHERE run_id = $1 AND step = $2 AND attempt = $3 AND outcome = 'in-flight'`,
    [current.runId, current.step, current.attempt, outcome],
  );

  if (!isCompensation(current.step) && cancelRequested) {
    return unwindCancel(client, runFrom(current));
  }

  const policy = steps[current.step]?.policy;
  if (!policy) throw new Error(`no step registered for ${current.step}`);
  if (current.attempt < policy.maxAttempts) {
    const waitMs = fullJitterMs(policy, current.attempt);
    const state = isCompensation(current.step) ? "Compensating" : "Waiting";
    await client.query(
      `UPDATE runs
       SET state = $5,
           not_before = (
             SELECT finished_at FROM attempts
             WHERE run_id = $1 AND step = $2 AND attempt = $3
           ) + ($4 * INTERVAL '1 millisecond')
       WHERE id = $1`,
      [current.runId, current.step, current.attempt, waitMs, state],
    );
    return null;
  }

  if (isCompensation(current.step)) {
    await client.query(
      `UPDATE runs SET state = 'Dead-lettered', not_before = NULL WHERE id = $1`,
      [current.runId],
    );
    return null;
  }

  const compensation = await nextDueCompensation(client, current.runId);
  if (!compensation) {
    await client.query(
      `UPDATE runs SET state = 'Failed', not_before = NULL WHERE id = $1`,
      [current.runId],
    );
    return null;
  }

  await client.query(
    `UPDATE runs
     SET state = 'Compensating', unwind_reason = 'retries-exhausted', not_before = NULL
     WHERE id = $1`,
    [current.runId],
  );
  await client.query(
    `INSERT INTO attempts (run_id, step, attempt, outcome, started_at, finished_at)
     VALUES ($1, $2, 1, 'in-flight', clock_timestamp(), NULL)`,
    [current.runId, compensation],
  );
  return {
    runId: current.runId,
    step: compensation,
    attempt: 1,
    ctx: current.ctx,
    injection: current.injection,
  };
}

function runFrom(current: OpenAttempt): {
  id: string;
  input: unknown;
  failure_injection: Injection[];
} {
  return {
    id: current.runId,
    input: current.ctx.input,
    failure_injection: current.injection,
  };
}

async function unwindCancel(
  client: PoolClient,
  run: { id: string; input: unknown; failure_injection: Injection[] },
): Promise<OpenAttempt | null> {
  await client.query(
    `UPDATE runs SET cancel_requested = false, not_before = NULL WHERE id = $1`,
    [run.id],
  );
  const compensation = await nextDueCompensation(client, run.id);
  if (!compensation) {
    await client.query(
      `UPDATE runs SET state = 'Cancelled', unwind_reason = NULL WHERE id = $1`,
      [run.id],
    );
    return null;
  }

  await client.query(
    `UPDATE runs SET state = 'Compensating', unwind_reason = 'cancelled' WHERE id = $1`,
    [run.id],
  );
  await client.query(
    `INSERT INTO attempts (run_id, step, attempt, outcome, started_at, finished_at)
     VALUES ($1, $2, 1, 'in-flight', clock_timestamp(), NULL)`,
    [run.id, compensation],
  );
  return {
    runId: run.id,
    step: compensation,
    attempt: 1,
    ctx: { input: run.input, outputs: {} },
    injection: run.failure_injection,
  };
}

async function finishCompensation(
  client: PoolClient,
  current: OpenAttempt,
): Promise<OpenAttempt | null> {
  const next = await nextDueCompensation(client, current.runId);
  if (next) {
    await client.query(
      `INSERT INTO attempts (run_id, step, attempt, outcome, started_at, finished_at)
       VALUES ($1, $2, 1, 'in-flight', clock_timestamp(), NULL)`,
      [current.runId, next],
    );
    return {
      runId: current.runId,
      step: next,
      attempt: 1,
      ctx: current.ctx,
      injection: current.injection,
    };
  }

  const reason = await client.query<{ unwind_reason: string | null }>(
    `SELECT unwind_reason FROM runs WHERE id = $1`,
    [current.runId],
  );
  const state = reason.rows[0]?.unwind_reason === "cancelled" ? "Cancelled" : "Failed";
  await client.query(
    `UPDATE runs SET state = $2, not_before = NULL WHERE id = $1`,
    [current.runId, state],
  );
  return null;
}

async function nextDueCompensation(
  client: PoolClient,
  runId: string,
): Promise<string | null> {
  const stored = await client.query<{ step: string; outcome: string }>(
    `SELECT step, outcome FROM attempts WHERE run_id = $1`,
    [runId],
  );
  const completed = new Set(
    stored.rows.filter((row) => row.outcome === "succeeded").map((row) => row.step),
  );
  for (const step of [...orderWorkflow.forward].reverse()) {
    if (!completed.has(step)) continue;
    const compensation = orderWorkflow.compensations[step];
    if (!compensation || completed.has(compensation)) continue;
    return compensation;
  }
  return null;
}

function isCompensation(step: string): boolean {
  return Object.values(orderWorkflow.compensations).includes(step);
}

function fullJitterMs(policy: StepPolicy, attempt: number): number {
  const ceiling = Math.min(
    policy.maxDelayMs,
    policy.baseDelayMs * 2 ** (attempt - 1),
  );
  return Math.floor(Math.random() * (ceiling + 1));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
