import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { createApp, type RunningApp } from "../src/app";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://workflow:workflow@127.0.0.1:54329/workflow";

const orderInput = { sku: "book", qty: 1 };

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

test("a client starts an order run and reads it back as succeeded", async () => {
  const started = await running.app.request("/runs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "order-1",
    },
    body: JSON.stringify({ workflow: "order", input: orderInput }),
  });

  expect(started.status).toBe(201);
  const created = await started.json();
  expect(created).toEqual({
    id: expect.stringMatching(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    ),
    workflow: "order",
    input: orderInput,
    state: "Accepted",
    cancelRequested: false,
    unwindReason: null,
    failureInjection: [],
    createdAt: expect.any(String),
  });
  expect(created).not.toHaveProperty("attempts");
  expect(created).not.toHaveProperty("notBefore");

  const finished = await waitForRun(created.id, "Succeeded");
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
    expect.objectContaining({
      step: "send-notification",
      attempt: 1,
      outcome: "succeeded",
    }),
  ]);
  expect(finished).not.toHaveProperty("notBefore");
});

test("the run list returns the newest run first", async () => {
  const first = await startRun("list-older");
  const second = await startRun("list-newer");

  const listed = await running.app.request("/runs");
  expect(listed.status).toBe(200);
  const body = await listed.json();
  expect(body.runs.map((run: { id: string }) => run.id)).toEqual([
    second.id,
    first.id,
  ]);
  expect(body.runs[0]).not.toHaveProperty("attempts");
  expect(body.runs[0]).not.toHaveProperty("notBefore");
});

async function startRun(key: string) {
  const response = await running.app.request("/runs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": key,
    },
    body: JSON.stringify({ workflow: "order", input: orderInput }),
  });
  expect(response.status).toBe(201);
  return response.json();
}

async function waitForRun(id: string, state: string) {
  const deadline = Date.now() + 5000;
  let last: unknown;
  while (Date.now() < deadline) {
    const response = await running.app.request(`/runs/${id}`);
    expect(response.status).toBe(200);
    last = await response.json();
    if ((last as { state: string }).state === state) return last as {
      attempts: unknown;
    };
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(`run ${id} did not reach ${state}: ${JSON.stringify(last)}`);
}
