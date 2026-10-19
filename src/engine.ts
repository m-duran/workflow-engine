import type { Pool } from "pg";
import { orderWorkflow, steps, type StepContext } from "./order";

type OpenAttempt = {
  runId: string;
  step: string;
  attempt: number;
  ctx: StepContext;
};

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
  let current = await claimAccepted(pool);
  if (!current) return false;

  while (current) {
    const definition = steps[current.step];
    if (!definition) {
      throw new Error(`no step registered for ${current.step}`);
    }
    const output = await definition.run(current.ctx);
    current = await recordSuccess(pool, current, output);
  }
  return true;
}

async function claimAccepted(pool: Pool): Promise<OpenAttempt | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query<{ id: string; input: unknown }>(
      `SELECT id, input
       FROM runs
       WHERE state = 'Accepted'
         AND (not_before IS NULL OR not_before <= clock_timestamp())
       ORDER BY created_at
       LIMIT 1
       FOR UPDATE`,
    );
    const run = found.rows[0];
    if (!run) {
      await client.query("COMMIT");
      return null;
    }

    const step = orderWorkflow.forward[0];
    if (!step) throw new Error("order workflow has no forward steps");
    await client.query(`UPDATE runs SET state = 'Running' WHERE id = $1`, [run.id]);
    await client.query(
      `INSERT INTO attempts (run_id, step, attempt, outcome, started_at, finished_at)
       VALUES ($1, $2, 1, 'in-flight', clock_timestamp(), NULL)`,
      [run.id, step],
    );
    await client.query("COMMIT");
    return {
      runId: run.id,
      step,
      attempt: 1,
      ctx: { input: run.input, outputs: {} },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function recordSuccess(
  pool: Pool,
  current: OpenAttempt,
  output: unknown,
): Promise<OpenAttempt | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE attempts
       SET outcome = 'succeeded', finished_at = clock_timestamp()
       WHERE run_id = $1 AND step = $2 AND attempt = $3 AND outcome = 'in-flight'`,
      [current.runId, current.step, current.attempt],
    );

    const position = orderWorkflow.forward.indexOf(current.step);
    const next = orderWorkflow.forward[position + 1];
    if (!next) {
      await client.query(
        `UPDATE runs SET state = 'Succeeded', not_before = NULL WHERE id = $1`,
        [current.runId],
      );
      await client.query("COMMIT");
      return null;
    }

    await client.query(
      `INSERT INTO attempts (run_id, step, attempt, outcome, started_at, finished_at)
       VALUES ($1, $2, 1, 'in-flight', clock_timestamp(), NULL)`,
      [current.runId, next],
    );
    await client.query("COMMIT");
    return {
      runId: current.runId,
      step: next,
      attempt: 1,
      ctx: {
        input: current.ctx.input,
        outputs: { ...current.ctx.outputs, [current.step]: output },
      },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
