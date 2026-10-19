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

test("the same key and canonical input replay the original start", async () => {
  const first = await start({
    key: "order-1",
    body: {
      workflow: "order",
      input: { sku: "book", qty: 1, tags: ["a", "b"] },
      failureInjection: [{ step: "send-notification", mode: "fail" }],
    },
  });

  const replay = await start({
    key: "order-1",
    body: {
      workflow: "order",
      input: { tags: ["a", "b"], qty: 1, sku: "book" },
      failureInjection: [{ step: "take-payment", mode: "timeout" }],
    },
  });

  expect(replay.status).toBe(201);
  expect(await replay.json()).toEqual(await first.json());

  const listed = await running.app.request("/runs");
  const body = await listed.json();
  expect(body.runs).toHaveLength(1);
  expect(body.runs[0].failureInjection).toEqual([
    { step: "send-notification", mode: "fail" },
  ]);
});

test("a different input for the same key is a conflict", async () => {
  const first = await start({
    key: "order-1",
    body: { workflow: "order", input: { sku: "book", qty: 1 } },
  });
  const created = await first.json();

  const conflict = await start({
    key: "order-1",
    body: { workflow: "order", input: { sku: "book", qty: 2 } },
  });

  expect(conflict.status).toBe(409);
  expect(await conflict.json()).toEqual({
    error: "idempotency-conflict",
    message: expect.any(String),
  });

  const stored = await running.app.request(`/runs/${created.id}`);
  expect(stored.status).toBe(200);
  expect((await stored.json()).input).toEqual({ sku: "book", qty: 1 });

  const listed = await running.app.request("/runs");
  expect((await listed.json()).runs).toHaveLength(1);
});

test("a missing or empty key stores no run", async () => {
  const missing = await running.app.request("/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workflow: "order", input: { sku: "book" } }),
  });
  const empty = await running.app.request("/runs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "",
    },
    body: JSON.stringify({ workflow: "order", input: { sku: "book" } }),
  });

  expect(missing.status).toBe(400);
  expect(await missing.json()).toMatchObject({ error: "invalid-request" });
  expect(empty.status).toBe(400);
  expect(await empty.json()).toMatchObject({ error: "invalid-request" });
  expect(await runCount()).toBe(0);
});

test("a bad failure-injection list stores no run", async () => {
  const repeated = await start({
    key: "bad-repeat",
    body: {
      workflow: "order",
      input: {},
      failureInjection: [
        { step: "take-payment", mode: "fail" },
        { step: "take-payment", mode: "timeout" },
      ],
    },
  });
  const unknownStep = await start({
    key: "bad-step",
    body: {
      workflow: "order",
      input: {},
      failureInjection: [{ step: "refund-payment", mode: "fail" }],
    },
  });
  const unknownMode = await start({
    key: "bad-mode",
    body: {
      workflow: "order",
      input: {},
      failureInjection: [{ step: "take-payment", mode: "pause" }],
    },
  });

  for (const response of [repeated, unknownStep, unknownMode]) {
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid-request" });
  }
  expect(await runCount()).toBe(0);
});

test("an unknown run id is a miss", async () => {
  const missingId = "00000000-0000-4000-8000-000000000001";

  const read = await running.app.request(`/runs/${missingId}`);
  const cancel = await running.app.request(`/runs/${missingId}/cancel`, {
    method: "POST",
  });

  expect(read.status).toBe(404);
  expect(await read.json()).toMatchObject({ error: "not-found" });
  expect(cancel.status).toBe(404);
  expect(await cancel.json()).toMatchObject({ error: "not-found" });
});

function start(options: { key: string; body: unknown }) {
  return running.app.request("/runs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": options.key,
    },
    body: JSON.stringify(options.body),
  });
}

async function runCount(): Promise<number> {
  const listed = await running.app.request("/runs");
  const body = await listed.json();
  return body.runs.length;
}
