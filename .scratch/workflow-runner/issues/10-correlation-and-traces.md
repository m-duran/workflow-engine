# Correlation and traces

Type: grilling
Status: resolved
Blocked by:

## Question

What correlation id, structured log fields, and trace spans must the spec require?

Use the states and attempts from [Run lifecycle](02-run-lifecycle.md) and the routes from [Run HTTP API](07-run-http-api.md). OpenTelemetry stays, as a standing preference. Do not choose a trace backend. Do not add a run state.

## Answer

The run id is the correlation id. HTTP spans use the route pattern and end with the response; a W3C `traceparent` parents only that span. Each attempt is its own trace, named with the step, from the `in-flight` commit until the outcome commit. Startup emits a `recover` span per closed attempt. Logs are one info line per durable commit, using `runId`, `workflow`, `state`, `step`, `attempt`, `outcome`, `method`, `route`, and `statusCode`. The input and the idempotency key are not logged. Every required span is recorded. No exporter is named.

Implementation spec: [Correlation and traces](../../correlation-and-traces/spec.md).

## Comments
