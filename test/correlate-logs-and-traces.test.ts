import { trace } from "@opentelemetry/api";
import {
  AlwaysOnSampler,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { createApp, type RunningApp } from "../src/app";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://workflow:workflow@127.0.0.1:54329/workflow";

const exporter = new InMemorySpanExporter();
const provider = new TracerProvider({
  sampler: new AlwaysOnSampler(),
  spanProcessors: [new SimpleSpanProcessor({ exporter })],
});

const orderInput = { sku: "correlation-sku", qty: 1 };
const logged: string[] = [];
const originalLog = console.log;

let running: RunningApp;

beforeAll(async () => {
  if (!trace.setGlobalTracerProvider(provider)) {
    throw new Error("recording tracer was not installed");
  }
  console.log = (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
    originalLog(...args);
  };
  running = await createApp(databaseUrl);
});

afterAll(async () => {
  console.log = originalLog;
  await running.stop();
  await provider.shutdown();
});

beforeEach(async () => {
  await running.reset();
  exporter.reset();
  logged.length = 0;
});

test("a rejected start omits the run id", async () => {
  const response = await running.app.request("/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workflow: "order", input: orderInput }),
  });

  expect(response.status).toBe(400);
  const span = finishedSpan("POST /runs");
  expect(span.attributes.runId).toBeUndefined();
  expect(span.attributes.workflow).toBeUndefined();
  expect(httpLog(400)).toMatchObject({
    level: "info",
    method: "POST",
    route: "/runs",
    statusCode: 400,
  });
  expect(httpLog(400)).not.toHaveProperty("runId");
  expect(logged.join("\n")).not.toContain("correlation-sku");
});

test("the run list omits the run id", async () => {
  const response = await running.app.request("/runs");

  expect(response.status).toBe(200);
  const span = finishedSpan("GET /runs");
  expect(span.name).toBe("GET /runs");
  expect(span.attributes.runId).toBeUndefined();
  expect(httpLog(200)).toMatchObject({
    level: "info",
    method: "GET",
    route: "/runs",
    statusCode: 200,
  });
  expect(httpLog(200)).not.toHaveProperty("runId");
});

test("a missing run logs and traces the run id from the path", async () => {
  const runId = "00000000-0000-4000-8000-000000000099";
  const response = await running.app.request(`/runs/${runId}`);

  expect(response.status).toBe(404);
  const span = finishedSpan("GET /runs/{runId}");
  expect(span.attributes.runId).toBe(runId);
  expect(span.attributes.workflow).toBeUndefined();
  expect(span.parentSpanContext?.spanId).toBeUndefined();
  expect(httpLog(404)).toMatchObject({
    level: "info",
    method: "GET",
    route: "/runs/{runId}",
    statusCode: 404,
    runId,
  });
  expect(httpLog(404)).not.toHaveProperty("workflow");
});

test("an idempotency conflict omits the run id and a replay keeps the original", async () => {
  const key = "correlation-secret-key";
  const started = await postRun(key, orderInput);
  expect(started.status).toBe(201);
  const created = (await started.json()) as { id: string };

  const replay = await postRun(key, orderInput);
  expect(replay.status).toBe(201);
  const conflict = await postRun(key, { sku: "other-secret-sku", qty: 2 });
  expect(conflict.status).toBe(409);

  const posts = exporter.getFinishedSpans().filter((span) => span.name === "POST /runs");
  expect(posts.map((span) => span.attributes.runId)).toEqual([
    created.id,
    created.id,
    undefined,
  ]);
  const conflictLog = infoLogs().find((line) => line.statusCode === 409);
  expect(conflictLog).toMatchObject({
    level: "info",
    method: "POST",
    route: "/runs",
    statusCode: 409,
  });
  expect(conflictLog).not.toHaveProperty("runId");
  const text = logged.join("\n");
  expect(text).not.toContain(key);
  expect(text).not.toContain("correlation-sku");
  expect(text).not.toContain("other-secret-sku");
});

test("a traceparent parents only the http span and a finished attempt is its own trace", async () => {
  const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
  const parentSpanId = "00f067aa0ba902b7";
  const key = "correlation-attempt-key";
  const started = await running.app.request("/runs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": key,
      traceparent: `00-${traceId}-${parentSpanId}-01`,
    },
    body: JSON.stringify({ workflow: "order", input: orderInput }),
  });
  expect(started.status).toBe(201);
  const created = (await started.json()) as { id: string };

  const httpSpan = finishedSpan("POST /runs");
  expect(httpSpan.spanContext().traceId).toBe(traceId);
  expect(httpSpan.parentSpanContext?.spanId).toBe(parentSpanId);
  expect(httpSpan.parentSpanContext?.traceId).toBe(traceId);
  expect(httpSpan.attributes).toMatchObject({
    runId: created.id,
    workflow: "order",
  });

  const attempt = await waitForSpan("validate-inventory", "succeeded");
  expect(attempt.attributes).toMatchObject({
    runId: created.id,
    workflow: "order",
    step: "validate-inventory",
    attempt: 1,
    outcome: "succeeded",
  });
  expect(attempt.parentSpanContext?.spanId).toBeUndefined();
  expect(attempt.spanContext().traceId).not.toBe(traceId);

  expect(infoLogs()).toContainEqual(
    expect.objectContaining({
      level: "info",
      runId: created.id,
      workflow: "order",
      state: "Accepted",
    }),
  );
  expect(infoLogs()).toContainEqual(
    expect.objectContaining({
      level: "info",
      runId: created.id,
      workflow: "order",
      step: "validate-inventory",
      attempt: 1,
      outcome: "succeeded",
    }),
  );
  const text = logged.join("\n");
  expect(text).not.toContain(key);
  expect(text).not.toContain("correlation-sku");
});

test("the http span ends when the response is sent", async () => {
  const response = await running.app.request("/runs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "correlation-held-attempt",
    },
    body: JSON.stringify({
      workflow: "order",
      input: orderInput,
      failureInjection: [{ step: "validate-inventory", mode: "timeout" }],
    }),
  });

  expect(response.status).toBe(201);
  const spans = exporter.getFinishedSpans();
  expect(spans.some((span) => span.name === "POST /runs" && span.ended)).toBe(true);
  expect(spans.some((span) => span.name === "validate-inventory")).toBe(false);
});

function postRun(key: string, input: unknown) {
  return running.app.request("/runs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": key,
    },
    body: JSON.stringify({ workflow: "order", input }),
  });
}

function finishedSpan(name: string): ReadableSpan {
  const spans = exporter.getFinishedSpans().filter((span) => span.name === name);
  expect(spans).toHaveLength(1);
  const span = spans[0];
  if (!span) throw new Error(`missing span ${name}`);
  return span;
}

async function waitForSpan(name: string, outcome: string): Promise<ReadableSpan> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const span = exporter
      .getFinishedSpans()
      .find((item) => item.name === name && item.attributes.outcome === outcome);
    if (span) return span;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(
    `span ${name} ${outcome} was not recorded: ${JSON.stringify(
      exporter.getFinishedSpans().map((span) => ({
        name: span.name,
        attributes: span.attributes,
      })),
    )}`,
  );
}

function httpLog(statusCode: number): Record<string, unknown> | undefined {
  return infoLogs().find((line) => line.statusCode === statusCode);
}

function infoLogs(): Array<Record<string, unknown>> {
  return logged.flatMap((line) => {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      return parsed.level === "info" ? [parsed] : [];
    } catch {
      return [];
    }
  });
}
