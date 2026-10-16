# Physical run storage

Type: grilling
Status: claimed
Blocked by:

## Question

What tables, constraints, and indexes should store a **Run**, its **Attempts**, and its **Idempotency key**?

The logical fields and the commit rules are already decided in [Crash recovery behavior](09-crash-recovery-behavior.md). A run stores `id`, `workflow`, `input`, `state`, `cancelRequested`, `unwindReason`, `failureInjection`, `createdAt`, and the idempotency key, unique per workflow name for the life of the run. An attempt stores `step`, `attempt` (from 1, per step), `outcome` (`in-flight`, `succeeded`, `failed`, or `timed-out`), `startedAt`, and `finishedAt`. Opening an attempt, recording its outcome, and moving the run state that depends on that outcome commit in one transaction. Startup finds every `in-flight` attempt. Do not reopen the fields, the outcomes, or the recovery behavior.

## Comments
