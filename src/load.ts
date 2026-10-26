import { createApp } from "./app";
import { startTracing } from "./observe";

startTracing();

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://workflow:workflow@127.0.0.1:54329/workflow";

const runCount = 32;
const concurrency = 8;
const orderInput = { sku: "book", qty: 1 };
const terminalStates = new Set(["Succeeded", "Failed", "Dead-lettered", "Cancelled"]);

type RunBody = {
  id: string;
  state: string;
};

const running = await createApp(databaseUrl);
const startedAt = performance.now();

try {
  const ids = await startRuns();
  const states = await waitForTerminal(ids);
  const succeeded = [...states.values()].filter((state) => state === "Succeeded").length;
  const durationMs = Math.round(performance.now() - startedAt);

  console.log(`started: ${ids.length}`);
  console.log(`succeeded: ${succeeded}`);
  console.log(`durationMs: ${durationMs}`);

  const unfinished = [...states.entries()].filter(([, state]) => state !== "Succeeded");
  if (unfinished.length > 0) {
    for (const [id, state] of unfinished) {
      console.error(`run ${id} ended ${state}`);
    }
    process.exitCode = 1;
  }
} finally {
  await running.stop();
}

async function startRuns(): Promise<string[]> {
  const ids = new Array<string>(runCount);
  await each(runCount, concurrency, async (index) => {
    const response = await running.app.request("/runs", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `load-${crypto.randomUUID()}`,
      },
      body: JSON.stringify({ workflow: "order", input: orderInput }),
    });
    if (response.status !== 201) {
      const body = await response.text();
      throw new Error(`POST /runs returned ${response.status}: ${body}`);
    }
    const created = (await response.json()) as RunBody;
    ids[index] = created.id;
  });
  return ids;
}

async function waitForTerminal(ids: readonly string[]): Promise<Map<string, string>> {
  const states = new Map<string, string>();
  let pending = [...ids];
  while (pending.length > 0) {
    const stillPending: string[] = [];
    await each(pending.length, concurrency, async (index) => {
      const id = pending[index];
      if (id === undefined) return;
      const response = await running.app.request(`/runs/${id}`);
      if (response.status !== 200) {
        throw new Error(`GET /runs/${id} returned ${response.status}`);
      }
      const body = (await response.json()) as RunBody;
      states.set(id, body.state);
      if (!terminalStates.has(body.state)) stillPending.push(id);
    });
    pending = stillPending;
    if (pending.length > 0) await delay(20);
  }
  return states;
}

async function each(
  count: number,
  limit: number,
  fn: (index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  async function worker(): Promise<void> {
    while (next < count) {
      const index = next;
      next += 1;
      await fn(index);
    }
  }
  const workers = Math.min(limit, count);
  await Promise.all(Array.from({ length: workers }, () => worker()));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
