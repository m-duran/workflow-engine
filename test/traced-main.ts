import { trace } from "@opentelemetry/api";
import { ExportResultCode } from "@opentelemetry/core";
import {
  AlwaysOnSampler,
  SimpleSpanProcessor,
  TracerProvider,
  type ReadableSpan,
  type SpanExporter,
} from "@opentelemetry/sdk-trace";

const exporter: SpanExporter = {
  export(spans: ReadableSpan[], resultCallback) {
    for (const span of spans) {
      console.log(
        `SPAN ${JSON.stringify({
          name: span.name,
          traceId: span.spanContext().traceId,
          parentSpanId: span.parentSpanContext?.spanId ?? null,
          attributes: span.attributes,
        })}`,
      );
    }
    resultCallback({ code: ExportResultCode.SUCCESS });
  },
  shutdown() {
    return Promise.resolve();
  },
};

trace.setGlobalTracerProvider(
  new TracerProvider({
    sampler: new AlwaysOnSampler(),
    spanProcessors: [new SimpleSpanProcessor({ exporter })],
  }),
);

const { serve } = await import("@hono/node-server");
const { createApp } = await import("../src/app");

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://workflow:workflow@127.0.0.1:54329/workflow";
const port = Number(process.env.PORT ?? 3000);
const { app } = await createApp(databaseUrl);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`listening on ${info.port}`);
});
