import { spawn, type ChildProcess } from "node:child_process";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { createPool, migrate, resetRuns } from "../src/db";
import type { Pool } from "pg";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://workflow:workflow@127.0.0.1:54329/workflow";
const port = 34567;
const base = `http://127.0.0.1:${port}`;

let pool: Pool;
let child: ChildProcess | undefined;

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

test(
  "a crashed in-flight payment is failed and counts toward its attempts",
  async () => {
    child = startServer();
    await waitForListen(child);

    const started = await fetch(`${base}/runs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "crash-payment",
      },
      body: JSON.stringify({
        workflow: "order",
        input: { sku: "book", qty: 1 },
        failureInjection: [{ step: "take-payment", mode: "timeout" }],
      }),
    });
    expect(started.status).toBe(201);
    const created = (await started.json()) as { id: string };

    const open = await waitForAttempt(created.id, "take-payment", 1, "in-flight");
    const startedAt = open.attempts.find(
      (attempt) => attempt.step === "take-payment" && attempt.attempt === 1,
    )?.startedAt;
    expect(startedAt).toEqual(expect.any(String));

    await stopServer();

    child = startServer();
    await waitForListen(child);

    const recovered = await waitForAttempt(created.id, "take-payment", 1, "failed");
    expect(recovered.attempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step: "validate-inventory",
          attempt: 1,
          outcome: "succeeded",
        }),
        expect.objectContaining({
          step: "take-payment",
          attempt: 1,
          outcome: "failed",
          startedAt,
          finishedAt: expect.any(String),
        }),
      ]),
    );

    const retried = await waitForAttempt(created.id, "take-payment", 2, "in-flight");
    const paymentAttempts = retried.attempts.filter(
      (attempt) => attempt.step === "take-payment",
    );
    expect(paymentAttempts.map((attempt) => attempt.attempt)).toEqual(
      expect.arrayContaining([1, 2]),
    );
    expect(paymentAttempts.filter((attempt) => attempt.attempt === 1)).toHaveLength(1);
  },
  20_000,
);

function startServer(): ChildProcess {
  const server = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/main.ts"], {
    env: { ...process.env, PORT: String(port), DATABASE_URL: databaseUrl },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  return server;
}

async function waitForListen(server: ChildProcess): Promise<void> {
  const deadline = Date.now() + 10_000;
  let output = "";
  const onData = (chunk: Buffer) => {
    output += chunk.toString();
  };
  server.stdout?.on("data", onData);
  server.stderr?.on("data", onData);
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

type Attempt = {
  step: string;
  attempt: number;
  outcome: string;
  startedAt: string;
  finishedAt: string | null;
};

async function waitForAttempt(
  id: string,
  step: string,
  attempt: number,
  outcome: string,
): Promise<{ attempts: Attempt[] }> {
  const deadline = Date.now() + 8_000;
  let last: unknown;
  while (Date.now() < deadline) {
    const response = await fetch(`${base}/runs/${id}`);
    if (response.status === 200) {
      last = await response.json();
      const attempts = (last as { attempts: Attempt[] }).attempts;
      if (
        attempts.some(
          (row) => row.step === step && row.attempt === attempt && row.outcome === outcome,
        )
      ) {
        return last as { attempts: Attempt[] };
      }
    }
    await delay(20);
  }
  throw new Error(
    `run ${id} did not show ${step} attempt ${attempt} ${outcome}: ${JSON.stringify(last)}`,
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
