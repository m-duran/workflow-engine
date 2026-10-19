import { serve } from "@hono/node-server";
import { createApp } from "./app";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://workflow:workflow@127.0.0.1:54329/workflow";
const port = Number(process.env.PORT ?? 3000);

const { app } = await createApp(databaseUrl);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`listening on ${info.port}`);
});
