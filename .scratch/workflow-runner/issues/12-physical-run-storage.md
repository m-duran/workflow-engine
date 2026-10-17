# Physical run storage

Type: grilling
Status: resolved
Blocked by:

## Question

What tables, constraints, and indexes should store a **Run**, its **Attempts**, and its **Idempotency key**?

The logical fields and the commit rules are already decided in [Crash recovery behavior](09-crash-recovery-behavior.md). A run stores `id`, `workflow`, `input`, `state`, `cancelRequested`, `unwindReason`, `failureInjection`, `createdAt`, and the idempotency key, unique per workflow name for the life of the run. An attempt stores `step`, `attempt` (from 1, per step), `outcome` (`in-flight`, `succeeded`, `failed`, or `timed-out`), `startedAt`, and `finishedAt`. Opening an attempt, recording its outcome, and moving the run state that depends on that outcome commit in one transaction. Startup finds every `in-flight` attempt. Do not reopen the fields, the outcomes, or the recovery behavior.

## Answer

`runs` and `attempts` are the tables. The idempotency key is on the run, unique per workflow name. `not_before` stores the one jitter roll for backoff and is absent from `GET`. Columns are snake_case, with the checks and the four indexes decided in the spec. `input` is canonical jsonb. Attempts stay for the life of the run. One `in-flight` row per run.

Implementation spec: [Physical run storage](../../physical-run-storage/spec.md).

## Comments
