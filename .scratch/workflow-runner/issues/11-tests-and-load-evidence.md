# Tests and load evidence

Type: grilling
Status: resolved
Blocked by:

## Question

What must the spec require the automated tests, the load test, and the failure-injection demo to show?

The lifecycle, the retry policy, and [Run HTTP API](07-run-http-api.md) are decided. The spec must say what a later implementation proves. It must not invent latency numbers, a performance report, screenshots, or a GIF. Those are produced by that later implementation.

## Answer

The automated suite, the load command, and the demo prove only what the run HTTP API returns, against a real PostgreSQL. The suite covers the clean **Succeeded** path, retry and compensation terminals, cancel, idempotency, and one `take-payment` crash. It does not have to catch **Waiting** or assert a backoff delay. The load command is separate, requires every run to reach **Succeeded**, and records the started count, the succeeded count, and the wall-clock duration, with no target. The demo is one `order` run with `fail` on `send-notification`.

Implementation spec: [Tests and load evidence](../../tests-and-load-evidence/spec.md).

## Comments
