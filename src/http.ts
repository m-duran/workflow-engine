import { Hono } from "hono";
import type { Pool } from "pg";
import { z } from "zod";
import { canonicalJson } from "./canonical";
import { orderWorkflow } from "./order";

const stepName = z.enum([
  "validate-inventory",
  "take-payment",
  "send-notification",
  "payment-compensation",
]);

const startBody = z.strictObject({
  workflow: z.literal("order"),
  input: z.json(),
  failureInjection: z
    .array(
      z.strictObject({
        step: stepName,
        mode: z.enum(["fail", "timeout"]),
      }),
    )
    .optional(),
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
    if (!key || key.length < 1 || key.length > 255) {
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

    const failureInjection = parsed.data.failureInjection ?? [];
    const inserted = await pool.query<RunRow>(
      `INSERT INTO runs (
         id, workflow, input, state, cancel_requested, unwind_reason,
         failure_injection, created_at, idempotency_key, not_before
       )
       VALUES (
         $1, $2, $3::jsonb, 'Accepted', false, NULL,
         $4::jsonb, clock_timestamp(), $5, NULL
       )
       RETURNING id, workflow, input, state, cancel_requested, unwind_reason,
                 failure_injection, created_at`,
      [
        crypto.randomUUID(),
        parsed.data.workflow,
        canonicalJson(parsed.data.input),
        canonicalJson(failureInjection),
        key,
      ],
    );

    return c.json(toRun(inserted.rows[0]), 201);
  });

  app.get("/runs", async (c) => {
    const limit = readLimit(c.req.query("limit"));
    if (limit instanceof Response) return limit;

    const listed = await pool.query<RunRow>(
      `SELECT id, workflow, input, state, cancel_requested, unwind_reason,
              failure_injection, created_at
       FROM runs
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit],
    );
    return c.json({ runs: listed.rows.map((row) => toRun(row)) });
  });

  app.get("/runs/:runId", async (c) => {
    const runId = c.req.param("runId");
    if (!uuidText.safeParse(runId).success) {
      return c.json({ error: "not-found", message: "Run not found" }, 404);
    }

    const found = await pool.query<RunRow>(
      `SELECT id, workflow, input, state, cancel_requested, unwind_reason,
              failure_injection, created_at
       FROM runs
       WHERE id = $1`,
      [runId],
    );
    const run = found.rows[0];
    if (!run) {
      return c.json({ error: "not-found", message: "Run not found" }, 404);
    }

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
