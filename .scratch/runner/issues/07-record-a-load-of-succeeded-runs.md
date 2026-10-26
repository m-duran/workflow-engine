# 07: Record a load of succeeded runs

**What to build:** An operator runs a load command, separate from the automated suite. It starts many `order` **Runs** with no **Failure injection**. Every run must reach **Succeeded**. The command records how many started, how many succeeded, and how long the run took.

**Blocked by:** 01 Succeed an order run

**Status:** resolved

- [x] The load command is not part of the ordinary automated suite.
- [x] It starts many `order` runs with no failure injection. The implementation chooses how many and how much concurrency.
- [x] The command fails if any run ends in a state other than **Succeeded**.
- [x] It records the started count, the succeeded count, and the wall-clock duration.
- [x] It sets no latency or throughput target.

## Comments

`npm run load` starts 32 `order` runs, eight at a time, with no failure injection, and polls `GET /runs/{runId}` until each reaches a terminal state. It prints `started`, `succeeded`, and `durationMs`, and exits non-zero when any run is not **Succeeded**. It is not part of `npm test`. A local run recorded `started: 32`, `succeeded: 32`, `durationMs: 1137`.
