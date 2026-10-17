# Correlation and traces

Status: ready-for-agent

## Problem Statement

A client starts a **Run**, cancels one, or reads one, and the process may die while an **Attempt** is in flight. The run id is already how the client finds that run. Logs and traces need the same id, or a crash and the attempt that follows it cannot be read as one run. A single trace stretched across the life of the run breaks when the process dies.

## Solution

The run id is the correlation id. Every structured log about a run, and every span about that run, carries it. Each HTTP request is one server span, ended when the response is sent. Each attempt is its own span, from the `in-flight` commit until the outcome commit. Startup records a separate `recover` span when it closes an attempt. An incoming W3C `traceparent` parents only the HTTP span. The run does not store a trace id. No exporter or trace backend is named, and every required span is recorded.

## User Stories

1. As a client, I want the run id on every log and span for my run, so that I can join the start, the attempts, and a later restart.
2. As a client, I want `POST /runs` to carry `runId` and `workflow` once the run exists, so that the start span matches the id in the `201` body.
3. As a client, I want a replayed start to carry the original run id, so that a duplicate idempotency key stays on the same run.
4. As a client, I want `GET /runs/{runId}` and cancel to carry `runId` from the path, so that a `404` still names the id I asked for.
5. As a client, I want `GET /runs`, a rejected start, and an idempotency conflict to omit `runId`, so that a request about no single run does not invent one.
6. As a client, I want an HTTP span named with the route pattern, so that `/runs/{runId}` does not create a span name per run.
7. As a client, I want that HTTP span to end when the response is sent, so that the span does not stay open while the run continues.
8. As a client, I want a present `traceparent` to parent the HTTP span, so that my caller's trace includes the request.
9. As a client, I want a missing `traceparent` to leave the HTTP span as a root, so that a normal start is not an error.
10. As a client, I want each attempt in its own trace, so that an attempt that outlives the start request, or that a later process closes, is not a child of the HTTP span.
11. As a client, I want the attempt span named with the step, so that `take-payment` is visible without reading attributes.
12. As a client, I want the attempt span to start when the `in-flight` row commits and to stay current while the step runs, so that the span covers the invocation.
13. As a client, I want the attempt span to end when `succeeded`, `failed`, or `timed-out` commits, with those values in `outcome`, so that the recorded outcome matches the run.
14. As a client, I want attempt span attributes `runId`, `workflow`, `step`, `attempt`, and `outcome`, so that the span stands alone from the log.
15. As an operator, I want a `recover` span for each attempt startup closes, in its own trace, with outcome `failed`, so that recovery is distinct from a step that finished `failed`.
16. As an operator, I want backoff to emit no span, so that a wait is not work.
17. As an operator, I want no span held open for the life of the run, so that a crash does not leave one trace unfinished forever.
18. As an operator, I want the run to store no trace id, so that recovery does not depend on the dead process's span.
19. As an operator, I want one info log per durable commit, carrying every field that commit changed, so that a state change and an attempt update in one transaction are one line.
20. As an operator, I want those lines to include `runId` and `workflow`, plus `state` when the run changed, and `step`, `attempt`, and `outcome` when an attempt changed, so that the line can be read without the database.
21. As an operator, I want an HTTP log to include `method`, `route`, and `statusCode`, so that the request can be matched to its span.
22. As an operator, I want lifecycle lines at info, including `failed`, `timed-out`, and **Dead-lettered**, so that a retry loop stays readable.
23. As an operator, I want the workflow input and the idempotency key left out of the logs, so that the log is not a copy of the request.
24. As an operator, I want no error string on an attempt, so that `outcome` remains the failure record.
25. As an operator, I want every required span recorded, with no sampling, so that the attempt that explains a **Failed** run is present.
26. As an operator, I want no exporter named by the spec, so that a backend can be attached later without a product change.

## Implementation Decisions

OpenTelemetry is the API for spans. Logs are structured lines from the process. Both use the keys `runId`, `workflow`, `state`, `step`, `attempt`, `outcome`, `method`, `route`, and `statusCode`. The run id is the engine-generated UUID. No trace id is written on the run or the attempt.

HTTP span names are the route patterns: `POST /runs`, `GET /runs`, `GET /runs/{runId}`, and `POST /runs/{runId}/cancel`. The span ends when the response is sent. If the request carries a W3C `traceparent`, that context is the parent. Otherwise the span is a root. A missing header is not an error. `runId` is set from the path on get-one and cancel, including `404`. On `POST /runs` it is set once the run row exists, including an idempotency replay. It is absent for the list, for `400`, and for an idempotency `409`. `workflow` is set when the run is known.

An attempt span is a root span named with the step. It begins after the transaction that inserts `outcome` `in-flight` commits, is the active span while the step function runs, and ends in the transaction's completion when the outcome becomes `succeeded`, `failed`, or `timed-out`. Attributes are `runId`, `workflow`, `step`, `attempt`, and `outcome`.

A `recover` span is a root span named `recover`. Startup emits one per attempt it closes, with the same attempt attributes and `outcome` `failed`. It is not a continuation of the dead process's attempt span.

Backoff, **Waiting**, and a **Compensating** run whose latest attempt has already finished emit no span. There is no run-lifetime span.

Each durable commit emits one info log with every field that commit changed: `runId`, `workflow`, and `state` for a run change; `step`, `attempt`, and `outcome` as well when an attempt changed. HTTP logs are info and add `method`, `route`, and `statusCode`, with `runId` under the same rule as the HTTP span. The workflow input and the idempotency key are never logged. The sampler records every required span. The spec names no exporter.

## Testing Decisions

A good test for this feature reads the process log and a recording OpenTelemetry exporter that the test installs. It drives the run through the HTTP API, then asserts span names, parents, attributes, and log fields. It does not assert through `GET /runs/{runId}`, and it does not require a trace backend. The automated HTTP suite does not include these assertions.

There is no existing suite to copy. Cover one start, one `404`, one list, one idempotency conflict, one attempt that finishes, and one startup `recover`. Assert the field names, info level, the route-pattern span name, and that the attempt span is not a child of the HTTP span.

## Out of Scope

Choosing a trace backend or an exporter. Sampling. A span for the life of the run. Storing a trace id. Logging the workflow input, the idempotency key, or an attempt error string. A correlation response header. The dashboard, the load run, and the physical tables.

## Further Notes

The behavior decided here is [Correlation and traces](../workflow-runner/issues/10-correlation-and-traces.md). Startup recovery of an `in-flight` attempt is [Crash recovery](../crash-recovery/spec.md). The HTTP routes and attempt outcomes are unchanged.

## Comments
