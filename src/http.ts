import { Hono } from "hono";
import type { Pool } from "pg";
import { z } from "zod";
import { canonicalJson } from "./canonical";
import { requestCancel } from "./engine";
import { orderWorkflow } from "./order";

const stepName = z.enum([
  "validate-inventory",
  "take-payment",
  "send-notification",
  "payment-compensation",
]);

const failureInjection = z
  .array(
    z.strictObject({
      step: stepName,
      mode: z.enum(["fail", "timeout"]),
    }),
  )
  .superRefine((entries, ctx) => {
    const seen = new Set<string>();
    for (const [index, entry] of entries.entries()) {
      if (seen.has(entry.step)) {
        ctx.addIssue({
          code: "custom",
          message: "Failure injection repeats a step",
          path: [index, "step"],
        });
      }
      seen.add(entry.step);
    }
  });

const startBody = z.strictObject({
  workflow: z.literal("order"),
  input: z.json(),
  failureInjection: failureInjection.optional(),
});

const uuidText = z.uuid();

type RunRow = {
  id: string;
  workflow: string;
  input: unknown;
  state: string;
  cancel_requested: boolean;
  unwind_reason: string | null;
  failure_injection: unknown;
  created_at: Date;
};

const runColumns =
  "id, workflow, input, state, cancel_requested, unwind_reason, failure_injection, created_at";

type AttemptRow = {
  step: string;
  attempt: number;
  outcome: string;
  started_at: Date;
  finished_at: Date | null;
};

export function createRouter(pool: Pool): Hono {
  const app = new Hono();

  app.post("/runs", async (c) => {
    const key = c.req.header("idempotency-key");
    if (key === undefined || [...key].length < 1 || [...key].length > 255) {
      return invalid(c, "Idempotency-Key must be 1 to 255 characters");
    }

    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return invalid(c, "Request body must be JSON");
    }

    const parsed = startBody.safeParse(json);
    if (!parsed.success) {
      return invalid(c, parsed.error.issues[0]?.message ?? "Invalid request");
    }

    const input = canonicalJson(parsed.data.input);
    const injection = canonicalJson(parsed.data.failureInjection ?? []);
    const started = await startRun(pool, {
      workflow: parsed.data.workflow,
      key,
      input,
      injection,
    });
    if (started.conflict) {
      return c.json(
        {
          error: "idempotency-conflict",
          message: "Idempotency key was already used with a different input",
        },
        409,
      );
    }
    return c.json(originalStart(started.run), 201);
  });

  app.get("/runs", async (c) => {
    const limit = readLimit(c.req.query("limit"));
    if (limit instanceof Response) return limit;

    const listed = await pool.query<RunRow>(
      `SELECT ${runColumns}
       FROM runs
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit],
    );
    return c.json({ runs: listed.rows.map((row) => toRun(row)) });
  });

  app.post("/runs/:runId/cancel", async (c) => {
    const runId = c.req.param("runId");
    if (!uuidText.safeParse(runId).success) return notFound(c);
    const decision = await requestCancel(pool, runId);
    if (decision.kind === "missing") return notFound(c);
    if (decision.kind === "rejected") {
      return c.json(
        { error: "cancel-rejected", message: "Cancel was rejected" },
        409,
      );
    }
    return c.json(toRun(decision.run), 200);
  });

  app.get("/runs/:runId", async (c) => {
    const runId = c.req.param("runId");
    const run = await findRun(pool, runId);
    if (!run) return notFound(c);

    const attempts = await pool.query<AttemptRow>(
      `SELECT step, attempt, outcome, started_at, finished_at
       FROM attempts
       WHERE run_id = $1`,
      [runId],
    );

    return c.json({
      ...toRun(run),
      attempts: attempts.rows.sort(byWorkflowOrder).map((row) => ({
        step: row.step,
        attempt: row.attempt,
        outcome: row.outcome,
        startedAt: row.started_at.toISOString(),
        finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
      })),
    });
  });

  return app;
}

type StartResult =
  | { conflict: true }
  | { conflict: false; run: RunRow };

async function startRun(
  pool: Pool,
  start: { workflow: string; key: string; input: string; injection: string },
): Promise<StartResult> {
  const existing = await findByKey(pool, start);
  if (existing) return existing;

  try {
    const inserted = await pool.query<RunRow>(
      `INSERT INTO runs (
         id, workflow, input, state, cancel_requested, unwind_reason,
         failure_injection, created_at, idempotency_key, not_before
       )
       VALUES (
         $1, $2, $3::jsonb, 'Accepted', false, NULL,
         $4::jsonb, clock_timestamp(), $5, NULL
       )
       RETURNING ${runColumns}`,
      [crypto.randomUUID(), start.workflow, start.input, start.injection, start.key],
    );
    const run = inserted.rows[0];
    if (!run) throw new Error("insert did not return a run");
    return { conflict: false, run };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await findByKey(pool, start);
    if (!raced) throw error;
    return raced;
  }
}

async function findByKey(
  pool: Pool,
  start: { workflow: string; key: string; input: string },
): Promise<StartResult | undefined> {
  const found = await pool.query<RunRow & { same_input: boolean }>(
    `SELECT ${runColumns}, (input = $3::jsonb) AS same_input
     FROM runs
     WHERE workflow = $1 AND idempotency_key = $2`,
    [start.workflow, start.key, start.input],
  );
  const row = found.rows[0];
  if (!row) return undefined;
  if (!row.same_input) return { conflict: true };
  return { conflict: false, run: row };
}

async function findRun(pool: Pool, runId: string): Promise<RunRow | undefined> {
  if (!uuidText.safeParse(runId).success) return undefined;
  const found = await pool.query<RunRow>(
    `SELECT ${runColumns}
     FROM runs
     WHERE id = $1`,
    [runId],
  );
  return found.rows[0];
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "23505"
  );
}

function originalStart(row: RunRow) {
  return {
    ...toRun(row),
    state: "Accepted",
    cancelRequested: false,
    unwindReason: null,
  };
}

function notFound(c: { json: (body: unknown, status: 404) => Response }) {
  return c.json({ error: "not-found", message: "Run not found" }, 404);
}

function byWorkflowOrder(left: AttemptRow, right: AttemptRow): number {
  const rank = (step: string) => {
    const index = orderWorkflow.forward.indexOf(step);
    return index === -1 ? orderWorkflow.forward.length : index;
  };
  const stepOrder = rank(left.step) - rank(right.step);
  if (stepOrder !== 0) return stepOrder;
  return left.attempt - right.attempt;
}

function toRun(row: RunRow) {
  return {
    id: row.id,
    workflow: row.workflow,
    input: row.input,
    state: row.state,
    cancelRequested: row.cancel_requested,
    unwindReason: row.unwind_reason,
    failureInjection: row.failure_injection,
    createdAt: row.created_at.toISOString(),
  };
}

function readLimit(raw: string | undefined): number | Response {
  if (raw === undefined) return 50;
  const parsed = z.coerce.number().int().min(1).max(100).safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid-request", message: "limit must be an integer from 1 to 100" },
      { status: 400 },
    );
  }
  return parsed.data;
}

function invalid(c: { json: (body: unknown, status: 400) => Response }, message: string) {
  return c.json({ error: "invalid-request", message }, 400);
}
