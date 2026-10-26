# 08: Correlate logs and traces

**What to build:** An operator can tie a **Run**'s HTTP requests, **Attempts**, and startup recovery together by the run id, in the process log and in OpenTelemetry spans. No trace backend is chosen.

**Blocked by:** 02 Reject and replay starts, 06 Recover a crashed payment attempt

**Status:** resolved

- [x] A start, a `404`, a list, an idempotency conflict, a finished attempt, and a startup `recover` each emit the spans and info logs the correlation spec requires.
- [x] The run id is the correlation id. `GET /runs`, a rejected start, and an idempotency conflict omit it. A `404` carries the run id from the path.
- [x] HTTP spans are named with the route pattern and end when the response is sent. A W3C `traceparent` parents only that span.
- [x] An attempt span is its own trace, named with the step, and is not a child of the HTTP span. A recovered attempt emits a `recover` span with outcome `failed`.
- [x] The workflow input and the idempotency key are not logged. Every required span is recorded. No exporter is named.
- [x] The proof is the process log and a recording OpenTelemetry exporter, not the run HTTP body.

## Comments

Info logs are one JSON line per durable commit and per HTTP response, with `runId` as the correlation id. HTTP spans use the route pattern and end with the response; a `traceparent` parents only that span. Each attempt is a root span named with the step, and startup closes an `in-flight` attempt with a root `recover` span whose outcome is `failed`. The process samples every span and names no exporter. Proof is `test/correlate-logs-and-traces.test.ts` and `test/recover-correlation.test.ts`.
