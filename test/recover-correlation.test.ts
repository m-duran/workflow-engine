import { spawn, type ChildProcess } from "node:child_process";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import type { Pool } from "pg";
import { createPool, migrate, resetRuns } from "../src/db";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://workflow:workflow@127.0.0.1:54329/workflow";
const port = 34568;
const base = `http://127.0.0.1:${port}`;

let pool: Pool;
let child: ChildProcess | undefined;
let output = "";

beforeAll(async () => {
  pool = createPool(databaseUrl);
  await migrate(pool);
});

afterAll(async () => {
  await stopServer();
  await pool.end();
});

beforeEach(async () => {
  await stopServer();
  await resetRuns(pool);
});

test("startup recovery records a recover span and an info log", async () => {
  const key = "recover-correlation-secret";
  const sku = "recover-correlation-sku";
  child = startServer();
  await waitForListen(child);

  const started = await fetch(`${base}/runs`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": key,
    },
    body: JSON.stringify({
      workflow: "order",
      input: { sku, qty: 1 },
      failureInjection: [{ step: "take-payment", mode: "timeout" }],
    }),
  });
  expect(started.status).toBe(201);
  const created = (await started.json()) as { id: string };
  await waitForInFlight(created.id);
  await stopServer();

  child = startServer();
  await waitForListen(child);
  const recovered = await waitForRecover(created.id);

  expect(recovered).toMatchObject({
    name: "recover",
    parentSpanId: null,
    attributes: {
      runId: created.id,
      workflow: "order",
      step: "take-payment",
      attempt: 1,
      outcome: "failed",
    },
  });
  expect(infoLogs()).toContainEqual(
    expect.objectContaining({
      level: "info",
      runId: created.id,
      workflow: "order",
      step: "take-payment",
      attempt: 1,
      outcome: "failed",
    }),
  );
  expect(output).not.toContain(key);
  expect(output).not.toContain(sku);
}, 20_000);

function startServer(): ChildProcess {
  output = "";
  const server = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "test/traced-main.ts"], {
    env: { ...process.env, PORT: String(port), DATABASE_URL: databaseUrl },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const onData = (chunk: Buffer) => {
    output += chunk.toString();
  };
  server.stdout?.on("data", onData);
  server.stderr?.on("data", onData);
  return server;
}

async function waitForListen(server: ChildProcess): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`server exited before listening: ${output}`);
    }
    try {
      const response = await fetch(`${base}/runs`);
      if (response.status === 200) return;
    } catch {
      // The process is still binding the port.
    }
    await delay(20);
  }
  throw new Error(`server did not listen: ${output}`);
}

async function stopServer(): Promise<void> {
  const server = child;
  child = undefined;
  if (!server || server.pid === undefined) return;
  if (server.exitCode !== null || server.signalCode !== null) return;
  try {
    process.kill(-server.pid, "SIGKILL");
  } catch {
    server.kill("SIGKILL");
  }
  await new Promise<void>((resolve) => {
    if (server.exitCode !== null || server.signalCode !== null) resolve();
    else server.once("exit", () => resolve());
  });
}

async function waitForInFlight(id: string): Promise<void> {
  const deadline = Date.now() + 8_000;
  let last = "";
  while (Date.now() < deadline) {
    const response = await fetch(`${base}/runs/${id}`);
    if (response.status === 200) {
      last = await response.text();
      if (last.includes('"step":"take-payment"') && last.includes('"outcome":"in-flight"')) return;
    }
    await delay(20);
  }
  throw new Error(`payment attempt did not stay in flight: ${last}`);
}

async function waitForRecover(runId: string): Promise<{
  name: string;
  parentSpanId: string | null;
  attributes: Record<string, unknown>;
}> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const span = spans().find(
      (item) => item.name === "recover" && item.attributes.runId === runId,
    );
    if (span) return span;
    await delay(20);
  }
  throw new Error(`recover span was not recorded: ${output}`);
}

function spans(): Array<{
  name: string;
  parentSpanId: string | null;
  attributes: Record<string, unknown>;
}> {
  return output.split("\n").flatMap((line) => {
    if (!line.startsWith("SPAN ")) return [];
    return [JSON.parse(line.slice(5)) as {
      name: string;
      parentSpanId: string | null;
      attributes: Record<string, unknown>;
    }];
  });
}

function infoLogs(): Array<Record<string, unknown>> {
  return output.split("\n").flatMap((line) => {
    if (!line.startsWith("{")) return [];
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      return parsed.level === "info" ? [parsed] : [];
    } catch {
      return [];
    }
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
