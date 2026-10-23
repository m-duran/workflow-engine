# 06: Recover a crashed payment attempt

**What to build:** The process dies while `take-payment` is `in-flight`. After it starts again, that same **Attempt** is `failed`, it counts toward `maxAttempts`, and the client can see that on `GET /runs/{runId}`.

**Blocked by:** 03 Exhaust a forward step

**Status:** resolved

- [x] **Failure injection** `timeout` on `take-payment` holds the attempt `in-flight`.
- [x] The process is killed during that hold, inside the step timeout, so the living process does not record `timed-out`.
- [x] After restart, `GET /runs/{runId}` shows that attempt `failed`, with the same attempt number, and the failure counts toward `maxAttempts`.
- [x] No other crash is required.

## Comments

Startup, before the worker claims work, closes every `in-flight` attempt as `failed` and applies the same forward-failure rules, including backoff and the next attempt number. A timeout that the living process never finishes stays `failed`, not `timed-out`. Proof is `test/recover-a-crashed-payment-attempt.test.ts`, which kills the process during `take-payment` and reads the run back after restart.
