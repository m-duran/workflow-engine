# 08: Correlate logs and traces

**What to build:** An operator can tie a **Run**'s HTTP requests, **Attempts**, and startup recovery together by the run id, in the process log and in OpenTelemetry spans. No trace backend is chosen.

**Blocked by:** 02 Reject and replay starts, 06 Recover a crashed payment attempt

**Status:** ready-for-agent

- [ ] A start, a `404`, a list, an idempotency conflict, a finished attempt, and a startup `recover` each emit the spans and info logs the correlation spec requires.
- [ ] The run id is the correlation id. `GET /runs`, a rejected start, and an idempotency conflict omit it. A `404` carries the run id from the path.
- [ ] HTTP spans are named with the route pattern and end when the response is sent. A W3C `traceparent` parents only that span.
- [ ] An attempt span is its own trace, named with the step, and is not a child of the HTTP span. A recovered attempt emits a `recover` span with outcome `failed`.
- [ ] The workflow input and the idempotency key are not logged. Every required span is recorded. No exporter is named.
- [ ] The proof is the process log and a recording OpenTelemetry exporter, not the run HTTP body.
