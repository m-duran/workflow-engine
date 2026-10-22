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

test("cancel from accepted ends cancelled with no attempts", async () => {
  await running.exclusive(async () => {
    const started = await start("cancel-accepted");

    const cancel = await running.app.request(`/runs/${started.id}/cancel`, {
      method: "POST",
    });

    expect(cancel.status).toBe(200);
    const body = await cancel.json();
    expect(body).toMatchObject({
      id: started.id,
      state: "Cancelled",
      cancelRequested: false,
      unwindReason: null,
    });
    expect(body).not.toHaveProperty("attempts");

    const stored = await running.app.request(`/runs/${started.id}`);
    expect(stored.status).toBe(200);
    const run = await stored.json();
    expect(run.state).toBe("Cancelled");
    expect(run.unwindReason).toBeNull();
    expect(run.attempts).toEqual([]);
  });
});

test(
  "cancel during an in-flight notification compensates the payment",
  async () => {
    const started = await start("cancel-inflight", [
      { step: "send-notification", mode: "timeout" },
    ]);

    await waitForAttempt(started.id, "send-notification", "in-flight");
    const cancel = await running.app.request(`/runs/${started.id}/cancel`, {
      method: "POST",
    });
    expect(cancel.status).toBe(200);
    expect(await cancel.json()).toMatchObject({
      id: started.id,
      state: "Running",
      cancelRequested: true,
    });

    const finished = await waitForState(started.id, "Cancelled");
    expect(finished.unwindReason).toBe("cancelled");
    expect(finished.cancelRequested).toBe(false);
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
        outcome: "timed-out",
      }),
      expect.objectContaining({
        step: "payment-compensation",
        attempt: 1,
        outcome: "succeeded",
      }),
    ]);
  },
  15_000,
);

test("cancel of a succeeded run is rejected", async () => {
  const started = await start("cancel-succeeded");
  await waitForState(started.id, "Succeeded");

  const cancel = await running.app.request(`/runs/${started.id}/cancel`, {
    method: "POST",
  });

  expect(cancel.status).toBe(409);
  expect(await cancel.json()).toEqual({
    error: "cancel-rejected",
    message: "Cancel was rejected",
  });

  const stored = await running.app.request(`/runs/${started.id}`);
  expect(stored.status).toBe(200);
  expect((await stored.json()).state).toBe("Succeeded");
});

async function start(
  key: string,
  failureInjection?: { step: string; mode: string }[],
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

type Attempt = { step: string; attempt: number; outcome: string };

async function waitForAttempt(id: string, step: string, outcome: string) {
  const deadline = Date.now() + 5_000;
  let last: unknown;
  while (Date.now() < deadline) {
    const response = await running.app.request(`/runs/${id}`);
    expect(response.status).toBe(200);
    last = await response.json();
    const attempts = (last as { attempts: Attempt[] }).attempts;
    if (attempts.some((attempt) => attempt.step === step && attempt.outcome === outcome)) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`run ${id} did not show ${step} ${outcome}: ${JSON.stringify(last)}`);
}

async function waitForState(id: string, state: string) {
  const deadline = Date.now() + 8_000;
  let last: unknown;
  while (Date.now() < deadline) {
    const response = await running.app.request(`/runs/${id}`);
    expect(response.status).toBe(200);
    last = await response.json();
    if ((last as { state: string }).state === state) {
      return last as {
        unwindReason: string | null;
        cancelRequested: boolean;
        attempts: Attempt[];
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`run ${id} did not reach ${state}: ${JSON.stringify(last)}`);
}
