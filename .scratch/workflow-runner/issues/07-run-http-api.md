# Run HTTP API

Type: grilling
Status: resolved
Blocked by: 02, 04, 05

## Question

Which REST endpoints, status codes, and Zod-validated bodies start a **Run**, fetch one, list them, and cancel one?

Use the states from [Run lifecycle](02-run-lifecycle.md), the contract from [Idempotency key contract](04-idempotency-key-contract.md), and the failure control from [Failure injection switch](05-failure-injection-switch.md). Do not reopen either contract. The key is required, at most 255 characters, unique per workflow for the life of the run; the same canonical workflow input replays the original start response; a different input is a conflict. Failure injection is an optional list on the start request, stored on the run, and not part of the compared input. Each entry is one of `validate-inventory`, `take-payment`, `send-notification`, or `payment-compensation`, with mode `fail` or `timeout`. A repeated step, an unknown step, or an unknown mode stores no run. Choose the status code for that rejection here. The only workflow name is `order`, from [Workflow registration shape](06-workflow-registration-shape.md). The start body carries that name and the workflow input JSON. Do not redesign registration or what a step receives. A **Dead-lettered** run must be visible in this API. Do not design the dashboard. That is [Observational dashboard](08-observational-dashboard.md).

## Answer

Zod validates every request and response body. The API has four routes.

`POST /runs` starts a run. The idempotency key is the `Idempotency-Key` header. The body is:

```json
{
  "workflow": "order",
  "input": {},
  "failureInjection": [{ "step": "send-notification", "mode": "timeout" }]
}
```

`failureInjection` may be omitted or `[]`. `POST /runs/{runId}/cancel` has an empty body. `GET /runs` returns `{ "runs": [ ... ] }`, newest first, with no state filter. `limit` defaults to 50 and caps at 100. A **Dead-lettered** run is in that list like any other.

A bad request returns `400` with `{ "error": "invalid-request", "message": "..." }` and stores no run. That covers a missing or empty key, a key longer than 255 characters, an unknown workflow name, a body that is not the expected JSON, and a bad failure-injection list.

A new run returns `201` and the run body without `attempts`. The same key and the same workflow input return that same `201` and the same body. The same key with a different workflow input returns `409` with `{ "error": "idempotency-conflict", "message": "..." }` and does not return the original run.

`GET /runs/{runId}` returns `200` and the run body including `attempts`. An unknown `runId` on `GET` or cancel returns `404`.

Cancel returns `200` and the run when it is accepted (**Accepted**, **Running**, **Waiting**) or ignored (**Compensating**, body unchanged). Cancel of **Succeeded**, **Failed**, **Dead-lettered**, or **Cancelled** returns `409` with `{ "error": "cancel-rejected", "message": "..." }`.

A run id is an engine-generated UUID. The body carries `id`, `workflow`, `input`, `state`, `cancelRequested`, `unwindReason`, `failureInjection`, and `createdAt`. `GET /runs/{runId}` also carries `attempts`. `cancelRequested` is true after cancel is accepted while an in-flight attempt has not finished. `unwindReason` is `retries-exhausted` or `cancelled` once set, and null before that. Each attempt has `step`, `attempt` (from 1), `outcome` (`in-flight`, `succeeded`, `failed`, or `timed-out`), `startedAt`, and `finishedAt` (null while in flight).

## Comments
