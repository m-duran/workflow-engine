import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { createApp, type RunningApp } from "../src/app";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://workflow:workflow@127.0.0.1:54329/workflow";

let running: RunningApp;

beforeAll(async () => {
  running = await createApp(databaseUrl);
});

afterAll(async () => {
  await running.stop();
});

beforeEach(async () => {
  await running.reset();
});

test(
  "a failed notification compensates the completed payment",
  async () => {
    const started = await start("compensate-notification", [
      { step: "send-notification", mode: "fail" },
    ]);

    const finished = await waitForRun(started.id, "Failed");
    expect(finished.unwindReason).toBe("retries-exhausted");
    expect(finished.attempts).toEqual([
      expect.objectContaining({
        step: "validate-inventory",
        attempt: 1,
        outcome: "succeeded",
      }),
      expect.objectContaining({
        step: "take-payment",
        attempt: 1,
        outcome: "succeeded",
      }),
      ...[1, 2, 3, 4, 5].map((attempt) =>
        expect.objectContaining({
          step: "send-notification",
          attempt,
          outcome: "failed",
        }),
      ),
      expect.objectContaining({
        step: "payment-compensation",
        attempt: 1,
        outcome: "succeeded",
      }),
    ]);
  },
  20_000,
);

test(
  "a failed compensation dead-letters the run and leaves it in the list",
  async () => {
    const started = await start("compensate-dead-letter", [
      { step: "send-notification", mode: "fail" },
      { step: "payment-compensation", mode: "fail" },
    ]);

    const finished = await waitForRun(started.id, "Dead-lettered", 30_000);
    expect(finished.unwindReason).toBe("retries-exhausted");
    expect(finished.attempts).toEqual([
      expect.objectContaining({
        step: "validate-inventory",
        attempt: 1,
        outcome: "succeeded",
      }),
      expect.objectContaining({
        step: "take-payment",
        attempt: 1,
        outcome: "succeeded",
      }),
      ...[1, 2, 3, 4, 5].map((attempt) =>
        expect.objectContaining({
          step: "send-notification",
          attempt,
          outcome: "failed",
        }),
      ),
      ...[1, 2, 3, 4, 5].map((attempt) =>
        expect.objectContaining({
          step: "payment-compensation",
          attempt,
          outcome: "failed",
        }),
      ),
    ]);

    const listed = await running.app.request("/runs");
    expect(listed.status).toBe(200);
    const body = await listed.json();
    expect(body.runs.map((run: { id: string }) => run.id)).toContain(started.id);
    expect(body.runs.find((run: { id: string }) => run.id === started.id).state).toBe(
      "Dead-lettered",
    );
  },
  40_000,
);

async function start(
  key: string,
  failureInjection: { step: string; mode: string }[],
) {
  const response = await running.app.request("/runs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": key,
    },
    body: JSON.stringify({
      workflow: "order",
      input: { sku: "book", qty: 1 },
      failureInjection,
    }),
  });
  expect(response.status).toBe(201);
  return response.json() as Promise<{ id: string }>;
}

async function waitForRun(id: string, state: string, timeoutMs = 18_000) {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    const response = await running.app.request(`/runs/${id}`);
    expect(response.status).toBe(200);
    last = await response.json();
    if ((last as { state: string }).state === state) {
      return last as { unwindReason: string | null; attempts: unknown };
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`run ${id} did not reach ${state}: ${JSON.stringify(last)}`);
}
