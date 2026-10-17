# 06: Recover a crashed payment attempt

**What to build:** The process dies while `take-payment` is `in-flight`. After it starts again, that same **Attempt** is `failed`, it counts toward `maxAttempts`, and the client can see that on `GET /runs/{runId}`.

**Blocked by:** 03 Exhaust a forward step

**Status:** ready-for-agent

- [ ] **Failure injection** `timeout` on `take-payment` holds the attempt `in-flight`.
- [ ] The process is killed during that hold, inside the step timeout, so the living process does not record `timed-out`.
- [ ] After restart, `GET /runs/{runId}` shows that attempt `failed`, with the same attempt number, and the failure counts toward `maxAttempts`.
- [ ] No other crash is required.
