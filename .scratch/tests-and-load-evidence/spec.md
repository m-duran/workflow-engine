# Tests and load evidence

Status: ready-for-agent

## Problem Statement

A later implementation has to prove the **Run** lifecycle, retries, cancellation, idempotency, one crash, and a load of clean **Succeeded** runs. It also has to leave a demo of one compensated failure. The proof has to be something a client can read. Latency targets, a performance write-up, and screenshots are produced by that implementation, not invented here.

## Solution

Automated tests, a separate load command, and one failure-injection demo all prove themselves through the run HTTP API against a real PostgreSQL. The suite lists the outcomes below and one crash of `take-payment`. The load command requires every run to reach **Succeeded** and records how many started, how many succeeded, and the wall-clock duration, with no target. The demo is one `order` run with `fail` on `send-notification`.

## User Stories

1. As a client, I want a run with no failure injection to reach **Succeeded**, with `validate-inventory`, `take-payment`, and `send-notification` each `succeeded` once, so that the order path is proved.
2. As a client, I want `fail` on `validate-inventory` to record three `failed` attempts and end **Failed**, with no compensation attempt, so that a step with no compensation stops cleanly.
3. As a client, I want `timeout` on `validate-inventory` to record three `timed-out` attempts and end **Failed**, so that a timeout counts as an attempt.
4. As a client, I want `fail` on `take-payment` to leave `validate-inventory` `succeeded`, three `failed` payment attempts, no `payment-compensation`, and **Failed**, so that an unfinished payment is not compensated.
5. As a client, I want `fail` on `send-notification` to leave payment `succeeded`, five `failed` notification attempts, `payment-compensation` `succeeded`, **Failed**, and unwind reason `retries-exhausted`, so that a completed payment is compensated.
6. As a client, I want `fail` on both `send-notification` and `payment-compensation` to fail that compensation five times and end **Dead-lettered**, so that an unfinished compensation stops the run.
7. As a client, I want that **Dead-lettered** run included in `GET /runs`, so that the list shows it.
8. As a client, I want cancel from **Accepted** to end **Cancelled**, with no attempts and a null unwind reason, so that a run that never started can stop.
9. As a client, I want cancel during an `in-flight` attempt to skip a retry, compensate completed steps, and end **Cancelled**, so that an open attempt still finishes the cancel rule.
10. As a client, I want cancel of **Succeeded** to return `409`, so that a finished run stays finished.
11. As a client, I want the same idempotency key and input to replay the original `201` and the same run, so that a duplicate start is not a second run.
12. As a client, I want a different input for that key to return `409`, so that the original run is unchanged.
13. As a client, I want a missing key, and a bad failure-injection list, to return `400` and store no run, so that a rejected start leaves nothing.
14. As a client, I want the same key and input with a different injection list to replay the original run, so that injection is not part of the comparison.
15. As a client, I want a non-final failure to be followed by the next attempt number, so that retries are visible without catching **Waiting**.
16. As an operator, I want the suite to skip asserting **Waiting** and to skip asserting a backoff delay, so that a jitter of zero cannot fail the test.
17. As an operator, I want one crash test: `timeout` on `take-payment`, the process killed while that attempt is `in-flight`, and after restart the outcome `failed` and counted toward `maxAttempts`, so that recovery is proved once.
18. As an operator, I want the other crash paths left unenforced by the suite, so that the required crash list stays this one case.
19. As an operator, I want the load run as its own command, outside the suite, so that an ordinary test run does not execute the load.
20. As an operator, I want that command to start many `order` runs with no injection, and to fail if any run is not **Succeeded**, so that concurrency still finishes cleanly.
21. As an operator, I want the command to record how many started, how many succeeded, and the wall-clock duration, so that the later report has those three figures.
22. As an operator, I want the spec to set no run count, concurrency, latency, or throughput target, so that the implementation chooses the load.
23. As a viewer, I want the demo to be one `order` start with `fail` on `send-notification`, so that payment succeeds, notification exhausts, compensation succeeds, and the run ends **Failed**.
24. As a viewer, I want the screenshots or GIF produced by the implementation from that run, so that this spec only names the run.
25. As an operator, I want every one of these proofs to come from the HTTP API, so that the suite does not read `runs`, `attempts`, the claim, or the startup sweep.

## Implementation Decisions

The automated suite and the load command drive one Node process against a real PostgreSQL. They call `POST /runs`, `POST /runs/{runId}/cancel`, `GET /runs`, and `GET /runs/{runId}`. Assertions use the status code, the run state, **Cancel requested**, the unwind reason, and the attempts' step, number, and outcome. The crash test kills that process while `GET` shows `take-payment` `in-flight` under `timeout` injection, starts it again, and reads the same route. The kill happens inside that step's timeout so the living process does not record `timed-out` first.

The load command is separate. It chooses the number of runs and the concurrency, starts them with no failure injection, requires **Succeeded** for each, and writes the started count, the succeeded count, and the wall-clock duration. It sets no threshold.

The demo starts one `order` run with failure injection `fail` on `send-notification` and shows the run the API returns. The implementation produces the screenshots or GIF.

The crash-recovery spec's testing section requires this same single crash and no other crash case.

## Testing Decisions

A good test asserts external HTTP behavior only. There is no existing suite to copy. The module under test is the running engine. The crash-recovery spec's HTTP restart seam is the prior art; this spec is the list that seam must cover. Logs, spans, and SQL are not assertions in this suite. Correlation has its own seam and is not part of this list.

## Out of Scope

Latency and throughput targets. The body of the performance report beyond the three figures. The pixels of the screenshot or GIF. Asserting **Waiting** or a backoff delay. Any crash test besides the one `take-payment` kill. Querying tables. Trace assertions. A second workflow.

## Further Notes

The behavior decided here is [Tests and load evidence](../workflow-runner/issues/11-tests-and-load-evidence.md). Recovery behavior beyond this one required crash remains specified in [Crash recovery](../crash-recovery/spec.md). The suite is not required to perform those other paths.

## Comments
