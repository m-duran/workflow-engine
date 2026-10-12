# Run lifecycle

Type: grilling
Status: resolved
Blocked by:

## Question

What are the legal states of a **Run**, and which transitions are allowed, for work that is accepted, in an **Attempt**, waiting to retry, compensating, succeeded, cancelled, **Failed**, and **Dead-lettered**?

Use the standing rules: a timeout fails that attempt and counts toward retries; cancel lets the in-flight attempt finish or time out, schedules no further steps, and compensates completed steps; **Failed** means required compensations finished; **Dead-lettered** means a compensation exhausted its retries. No automatic replay.

Do not add states for "the process died mid-attempt." That waits on [PostgreSQL claim and crash facts](01-postgresql-claim-and-crash-facts.md).

## Answer

A **Run** has exactly eight states: **Accepted**, **Running**, **Waiting**, **Compensating**, **Succeeded**, **Cancelled**, **Failed**, and **Dead-lettered**. There is no state for the process dying mid-attempt. That choice is [Crash recovery behavior](09-crash-recovery-behavior.md), and it must use these states.

The run remembers an **Unwind reason** when it enters **Compensating**. Retry exhaustion selects **Failed**. Cancel selects **Cancelled**. The reason is not a ninth state.

With no cancel pending:

- **Accepted** → **Running** when the first attempt starts.
- **Running** stays **Running** when a forward step succeeds and a later step remains.
- **Running** → **Succeeded** when the last forward step's attempt succeeds.
- **Running** → **Waiting** when an attempt fails and attempts remain. **Waiting** → **Running** when the backoff elapses.
- **Running** → **Failed** when retries are exhausted and no completed step has a compensation.
- **Running** → **Compensating** when retries are exhausted and some completed step has a compensation.

Cancel is accepted from **Accepted**, **Running**, and **Waiting**. It is ignored while **Compensating**, and rejected from **Succeeded**, **Failed**, **Dead-lettered**, and **Cancelled**. **Accepted** goes **Cancelled** immediately. From **Waiting**, the next forward attempt does not start. From **Running**, the in-flight attempt finishes or times out and is not retried; a success counts as completed. The run then compensates completed steps and ends **Cancelled**. A pending cancel beats a forward failure and beats the last step succeeding.

Compensations run in reverse order of completed steps. A completed step with no compensation is skipped. The step that exhausted its retries did not complete, so its own compensation does not run. A compensation attempt that fails with attempts left stays **Compensating**, including the backoff. **Waiting** is only for forward attempts. When every required compensation succeeds, the unwind reason selects **Failed** or **Cancelled**. When one compensation exhausts its retries, the run goes **Dead-lettered** and the remaining compensations do not run.

## Comments
