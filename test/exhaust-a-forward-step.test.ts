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

test("fail on validate-inventory exhausts three attempts and ends failed", async () => {
  const started = await running.app.request("/runs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "exhaust-inventory-fail",
    },
    body: JSON.stringify({
      workflow: "order",
      input: { sku: "book", qty: 1 },
      failureInjection: [{ step: "validate-inventory", mode: "fail" }],
    }),
  });

  expect(started.status).toBe(201);
  const created = await started.json();

  const finished = await waitForRun(created.id, "Failed");
  expect(finished.unwindReason).toBeNull();
  expect(finished.attempts).toEqual([
    expect.objectContaining({
      step: "validate-inventory",
      attempt: 1,
      outcome: "failed",
      finishedAt: expect.any(String),
    }),
    expect.objectContaining({
      step: "validate-inventory",
      attempt: 2,
      outcome: "failed",
      finishedAt: expect.any(String),
    }),
    expect.objectContaining({
      step: "validate-inventory",
      attempt: 3,
      outcome: "failed",
      finishedAt: expect.any(String),
    }),
  ]);
});

test("timeout on validate-inventory exhausts three attempts and ends failed", async () => {
  const started = await running.app.request("/runs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "exhaust-inventory-timeout",
    },
    body: JSON.stringify({
      workflow: "order",
      input: { sku: "book", qty: 1 },
      failureInjection: [{ step: "validate-inventory", mode: "timeout" }],
    }),
  });

  expect(started.status).toBe(201);
  const created = await started.json();

  const finished = await waitForRun(created.id, "Failed", 12_000);
  expect(finished.attempts).toEqual([
    expect.objectContaining({
      step: "validate-inventory",
      attempt: 1,
      outcome: "timed-out",
    }),
    expect.objectContaining({
      step: "validate-inventory",
      attempt: 2,
      outcome: "timed-out",
    }),
    expect.objectContaining({
      step: "validate-inventory",
      attempt: 3,
      outcome: "timed-out",
    }),
  ]);
});

test("fail on take-payment exhausts the charge and does not compensate", async () => {
  const started = await running.app.request("/runs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "exhaust-payment-fail",
    },
    body: JSON.stringify({
      workflow: "order",
      input: { sku: "book", qty: 1 },
      failureInjection: [{ step: "take-payment", mode: "fail" }],
    }),
  });

  expect(started.status).toBe(201);
  const created = await started.json();

  const finished = await waitForRun(created.id, "Failed");
  expect(finished.attempts).toEqual([
    expect.objectContaining({
      step: "validate-inventory",
      attempt: 1,
      outcome: "succeeded",
    }),
    expect.objectContaining({
      step: "take-payment",
      attempt: 1,
      outcome: "failed",
    }),
    expect.objectContaining({
      step: "take-payment",
      attempt: 2,
      outcome: "failed",
    }),
    expect.objectContaining({
      step: "take-payment",
      attempt: 3,
      outcome: "failed",
    }),
  ]);
});

async function waitForRun(id: string, state: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    const response = await running.app.request(`/runs/${id}`);
    expect(response.status).toBe(200);
    last = await response.json();
    if ((last as { state: string }).state === state) {
      return last as { unwindReason: string | null; attempts: unknown };
    }
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(`run ${id} did not reach ${state}: ${JSON.stringify(last)}`);
}
