import type { Hono } from "hono";
import { createPool, migrate, resetRuns } from "./db";
import { recoverInFlight, startWorker } from "./engine";
import { createRouter } from "./http";
import { assertRegistration } from "./order";

export type RunningApp = {
  app: Hono;
  stop: () => Promise<void>;
  reset: () => Promise<void>;
  exclusive: <T>(fn: () => Promise<T>) => Promise<T>;
};

export async function createApp(databaseUrl: string): Promise<RunningApp> {
  assertRegistration();
  const pool = createPool(databaseUrl);
  await migrate(pool);
  await recoverInFlight(pool);
  const worker = startWorker(pool);
  const app = createRouter(pool);

  return {
    app,
    async stop() {
      await worker.stop();
      await pool.end();
    },
    async reset() {
      await worker.exclusive(() => resetRuns(pool));
    },
    exclusive: worker.exclusive,
  };
}
