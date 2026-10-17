# Physical run storage

Status: ready-for-agent

## Problem Statement

A client starts a **Run**, retries an **Attempt**, and may come back after the process dies during backoff. The run id, the idempotency key, and the attempt outcomes already have a meaning. They need a PostgreSQL shape that keeps one run per key, one row per attempt, one `in-flight` attempt per run, and the same backoff deadline after a restart.

## Solution

Two tables, `runs` and `attempts`, hold the fields the API already returns, plus `not_before` on the run. The idempotency key lives on the run. Jitter is rolled once and stored in `not_before`. Workflow input is stored as jsonb after canonicalization, and a replay compares jsonb equality. Snake_case is the column naming. The HTTP body stays camelCase and does not include `not_before`.

## User Stories

1. As a client, I want one run row per workflow name and idempotency key, so that a duplicate start cannot insert a second run.
2. As a client, I want the key stored as the exact string I sent, from 1 to 255 characters, so that a different string is a different key.
3. As a client, I want my workflow input stored as canonical jsonb, so that the same values with different key order or whitespace replay the original run.
4. As a client, I want array order in that input preserved, so that a different order is a different input.
5. As a client, I want failure injection stored as the validated list and excluded from the input comparison, so that a different injection list on the same key replays the original run.
6. As a client, I want each attempt stored as its own row under the run, so that a retry is a new row with the next attempt number for that step.
7. As a client, I want at most one `in-flight` attempt on a run, so that two steps cannot be open together.
8. As a client, I want `finished_at` empty exactly while the outcome is `in-flight`, so that an open attempt has no finish time.
9. As a client, I want the eight run states stored as `Accepted`, `Running`, `Waiting`, `Compensating`, `Succeeded`, `Cancelled`, `Failed`, and `Dead-lettered`, so that `GET` matches the lifecycle.
10. As a client, I want outcomes stored as `in-flight`, `succeeded`, `failed`, and `timed-out`, so that a crash and a timeout stay distinct.
11. As a client, I want `unwind_reason` stored as null, `retries-exhausted`, or `cancelled`, so that a finished compensation selects **Failed** or **Cancelled**.
12. As a client, I want a failed attempt that still has retries to store `not_before` in that same transaction, so that the backoff I drew is the backoff a restarted process honors.
13. As a client, I want `not_before` left null when the run is not in backoff, so that **Accepted**, **Running**, and the terminal states are not delayed.
14. As a client, I want `GET` to omit `not_before`, so that the deadline stays inside the engine.
15. As a client, I want a run kept for its whole life, attempts included, so that a **Succeeded** or **Dead-lettered** run can still be read.
16. As an operator, I want startup to find `in-flight` attempts through one unique index, so that recovery does not scan finished attempts.
17. As an operator, I want due **Waiting** and **Compensating** runs, and **Accepted** runs, claimable through `(state, not_before)`, so that the single process can find work.
18. As an operator, I want `GET /runs` to use `created_at`, so that the newest runs come first.
19. As an operator, I want the attempts for one run loaded by `(run_id, step, attempt)`, so that a run with a handful of attempts needs no second index.

## Implementation Decisions

PostgreSQL is the store. Table `runs` has primary key `id` uuid. Columns: `workflow` text, `input` jsonb, `state` text, `cancel_requested` boolean, `unwind_reason` text null, `failure_injection` jsonb, `created_at` timestamptz, `idempotency_key` text, `not_before` timestamptz null.

Table `attempts` has primary key `(run_id, step, attempt)`. `run_id` references `runs.id`. Columns: `step` text, `attempt` integer, `outcome` text, `started_at` timestamptz, `finished_at` timestamptz null. Runs are not deleted.

Checks: `state` is one of the eight tokens above. `outcome` is one of the four tokens above. `unwind_reason` is null, `retries-exhausted`, or `cancelled`. `idempotency_key` has length 1 to 255. `attempt` is at least 1. `finished_at` is null if and only if `outcome` is `in-flight`. A unique partial index allows one `in-flight` row per `run_id`.

`input` is parsed to canonical JSON, with object keys sorted, insignificant whitespace removed, and array order kept, then stored as jsonb. Replay parses the new request the same way and compares jsonb equality. `failure_injection` is the validated list. It is not part of that comparison.

When a failure commit leaves attempts remaining, that transaction sets `not_before` to `finished_at` plus the full-jitter delay rolled in that transaction. A later process uses the stored instant and does not roll again. Any other commit sets `not_before` null. The HTTP serializers do not emit it. API names stay camelCase.

Indexes beyond the primary keys: unique `(workflow, idempotency_key)` on `runs`; unique `(run_id)` on `attempts` where `outcome` is `in-flight`; `(state, not_before)` on `runs`; `(created_at)` on `runs`.

Opening an attempt, recording its outcome, and moving the run commit in one transaction, as crash recovery already requires. The claim query uses `(state, not_before)` and skips a run that already has an `in-flight` attempt. Startup uses the partial unique index.

## Testing Decisions

A good test still uses only the run HTTP API against a real PostgreSQL. It does not query `runs` or `attempts`. Idempotency replay, a `409` on a different input, a second injection list that does not change the run, one `in-flight` attempt visible on `GET`, and a restarted process that honors an existing backoff by attempting the next number only after that wait, are the observable proof. The suite does not assert a delay, because full jitter includes zero. Prior art is the HTTP seam in [Crash recovery](../crash-recovery/spec.md) and the suite in [Tests and load evidence](../tests-and-load-evidence/spec.md).

## Out of Scope

A third table for the idempotency key. A JSON column of attempts on the run. Deleting runs. Returning `not_before` from the API. More than one worker, leases, and `SKIP LOCKED`. A named trace backend. Changing the logical fields, the outcomes, or the recovery transitions.

## Further Notes

The behavior decided here is [Physical run storage](../workflow-runner/issues/12-physical-run-storage.md). Commit rules and the `in-flight` claim are [Crash recovery behavior](../workflow-runner/issues/09-crash-recovery-behavior.md). The idempotency comparison is the canonical JSON rule already decided for the key.

## Comments
