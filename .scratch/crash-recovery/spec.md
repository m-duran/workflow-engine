# Crash recovery

Status: ready-for-agent

## Problem Statement

A client starts a **Run** of the `order` **Workflow** and the single engine process dies while an **Attempt** is in flight. The charge, the inventory check, the notification, or the payment **Compensation** may already have happened. After the process starts again, the client needs that same run to continue from a durable record of the interrupted attempt: counted toward its retries, visible on the run, and moved through the existing states. A lock that disappears with the dead session cannot do this, because the new process would see no attempt at all and could retry forever.

## Solution

The engine commits an attempt with outcome `in-flight` before it invokes the **Step**. That row is the claim. It survives the process dying. On startup, before it listens for HTTP and before it claims other work, the process finds every `in-flight` attempt, records that same attempt as `failed`, and applies the run lifecycle from there. A forward attempt leaves the run **Running** until that commit; a compensation attempt leaves it **Compensating**. If attempts remain, backoff starts when the failure is recorded. If they do not, the run compensates, ends **Failed** or **Cancelled**, or goes **Dead-lettered**, using the rules already set for any other failed attempt.

A client sees this only through the run HTTP API. `GET /runs/{runId}` is the record of the attempt that was in flight and of every attempt after it.

## User Stories

1. As a client, I want a restarted process to keep my run id, so that the start I already made is the run that continues.
2. As a client, I want `GET /runs/{runId}` after a restart to show the interrupted attempt as `failed`, so that I can see the process died during that attempt.
3. As a client, I want that attempt to keep its step name and its attempt number, so that a retry is a later number of the same step and the interrupted number is not reused.
4. As a client, I want `startedAt` on the interrupted attempt to stay the time it began, so that the crash does not look like a new attempt.
5. As a client, I want `finishedAt` on the interrupted attempt to be the time startup recorded the failure, so that I can see when recovery closed it.
6. As a client, I want the outcome to be `failed` when the process dies during a `timeout` **Failure injection**, so that a timer that never finished is distinct from an attempt the engine closed as `timed-out`.
7. As a client, I want a forward crash with attempts left to move the run to **Waiting**, so that the run is waiting for backoff the same way it would after any other failed forward attempt.
8. As a client, I want the next forward attempt to receive the next attempt number after that backoff, so that `maxAttempts` counts the crashed attempt.
9. As a client, I want two crashes on the same step to consume two attempts, so that a crash loop reaches `maxAttempts`.
10. As a client, I want `validate-inventory` to end **Failed** when a crash uses its last attempt, so that a step with no compensation still stops cleanly.
11. As a client, I want `send-notification` to end **Failed** when a crash uses its last attempt, so that a step with no compensation does not enter **Compensating**.
12. As a client, I want `take-payment` to enter **Compensating** when a crash uses its last attempt and `validate-inventory` has succeeded, so that the completed payment can be compensated.
13. As a client, I want `payment-compensation` to run after that exhausted `take-payment`, so that the compensation of a completed step still runs when the crash was on a later step.
14. As a client, I want a crash during `take-payment` itself, once its attempts are exhausted, to skip `payment-compensation` when that payment attempt never succeeded, so that only completed steps are compensated.
15. As a client, I want the **Unwind reason** `retries-exhausted` when a crash exhausts a forward step and compensation starts, so that a finished compensation ends the run **Failed**.
16. As a client, I want a crash during `payment-compensation`, with attempts left, to leave the run **Compensating**, so that the refund is retried under the same state.
17. As a client, I want a crash that uses the last `payment-compensation` attempt to move the run to **Dead-lettered**, so that a compensation that did not finish is visible.
18. As a client, I want no later compensation to start after that dead letter, so that the run stops where compensation stopped.
19. As a client, I want cancel accepted during a forward `in-flight` attempt to survive the crash, so that the restarted process does not retry that attempt.
20. As a client, I want that cancelled crash to record the attempt `failed`, so that a success is not invented for work the engine did not commit.
21. As a client, I want completed steps to be compensated after that cancelled crash, so that the run can end **Cancelled**.
22. As a client, I want the unwind reason `cancelled` on that path, so that a finished compensation selects **Cancelled**.
23. As a client, I want **Cancel requested** to clear once recovery finishes the forward attempt, so that the flag means the cancelled attempt is still open.
24. As a client, I want a cancelled crash of the first step, with nothing completed, to end **Cancelled** with a null unwind reason, so that the run does not enter **Compensating** with nothing to do.
25. As a client, I want a cancel sent while the run is **Compensating** to be ignored after a compensation crash, so that recovery of the compensation follows the compensation rules.
26. As an operator, I want startup to close every `in-flight` attempt before the process accepts HTTP or claims other work, so that the first `GET` after a restart shows the recovered run.
27. As an operator, I want a second crash during the recovery commit to leave the attempt `in-flight`, so that the next startup closes it the same way.
28. As an operator, I want several runs with `in-flight` attempts to be recovered in one startup, so that one death does not strand a second run.
29. As a client, I want a process death during **Waiting** to add no attempt, so that backoff is not another failure.
30. As a client, I want a process death during **Compensating** backoff, after the latest compensation attempt has already finished, to add no attempt, so that only an open attempt is a crash.
31. As a client, I want a process death while the run is **Accepted** and has no attempt to leave it **Accepted**, so that the first attempt can start normally.
32. As a client, I want **Succeeded**, **Failed**, **Dead-lettered**, and **Cancelled** runs to stay as they are across a restart, so that a finished run is not recovered.
33. As a client, I want the backoff after a recovered failure to use the step's ordinary full-jitter delay, measured from `finishedAt`, so that a crash waits the same way as any other failure of that attempt number.
34. As a client, I want a recovered attempt that used up `maxAttempts` to start no backoff, so that compensation or the terminal state begins immediately.
35. As a client, I want **Failure injection** to apply again on the attempt after a crash, so that a targeted step still fails until its attempts are exhausted.
36. As a client, I want the same **Idempotency key** after a restart to replay the original start response, so that recovery does not create a second run.
37. As a client, I want `GET /runs/{runId}` between steps to show the previous attempt `succeeded` and the next attempt `in-flight` together, so that a restart cannot observe a **Running** run whose latest attempt already succeeded and whose next attempt was never opened.
38. As a client, I want a step function that returned and then died before that commit to be recovered as `failed`, so that an uncommitted success is retried.
39. As a step author, I want a side effect that landed before the failure commit to stay my problem, so that the engine compensates only attempts it recorded as `succeeded`.
40. As an observer, I want the recovered attempt on `GET /runs/{runId}` to use the outcomes the dashboard already shows, so that a crash appears as `failed` without a new outcome or a new run state.

## Implementation Decisions

The engine is one Node process. PostgreSQL is the run store and the queue. There is no second queue, no lease, and no second worker. The `order` workflow, its step policies, the idempotency contract, failure injection, and the four HTTP routes stay as already decided. This feature adds the startup recovery pass and the commit rules that make an interrupted attempt visible.

Durable records:

- A run stores `id`, `workflow`, `input`, `state`, `cancelRequested`, `unwindReason`, `failureInjection`, `createdAt`, and its idempotency key. The key is unique per workflow name for the life of the run.
- Each attempt stores `step`, `attempt` (from 1, per step), `outcome` (`in-flight`, `succeeded`, `failed`, or `timed-out`), `startedAt`, and `finishedAt`. `finishedAt` is null while the outcome is `in-flight`.
- The physical tables and indexes may be whatever upholds these fields, the uniqueness of the idempotency key, and the transactions below.

An attempt is opened only inside the transaction that sets its outcome to `in-flight`. That transaction is one of: the first claim out of **Accepted**; the claim that ends **Waiting** or compensation backoff; the success of a forward step together with the opening of the next forward step; the success of a compensation together with the opening of the next compensation; or the failure commit that exhausts a forward step and opens the first compensation. The process invokes the step only after that transaction commits. A run has at most one `in-flight` attempt.

Startup, before listen and before any other claim:

- Load every attempt with outcome `in-flight`.
- For each one, commit a single transaction that sets that row's outcome to `failed` and `finishedAt` to the recovery time, then moves the run as follows.
- Forward attempt, attempts remaining, cancel not requested: state **Waiting**. The backoff clock starts at `finishedAt`. The delay is `min(maxDelay, baseDelay * 2^(n-1))` with full jitter, where `n` is this attempt number. The next claim opens attempt `n + 1`.
- Forward attempt, attempts remaining, cancel requested: do not retry. Clear **Cancel requested**. If any completed step has a compensation, set the unwind reason to `cancelled`, enter **Compensating**, and open the first of those compensations in reverse order of completed steps inside this same transaction. If none do, set the state to **Cancelled** and leave the unwind reason null.
- Forward attempt, no attempts remaining, cancel not requested: if any completed step has a compensation, set the unwind reason to `retries-exhausted`, enter **Compensating**, and open the first compensation in this same transaction. If none do, set the state to **Failed**.
- Forward attempt, no attempts remaining, cancel requested: same as the cancel path above. Cancel wins over retry exhaustion.
- Compensation attempt, attempts remaining: stay **Compensating**, with backoff from `finishedAt` and no new `in-flight` attempt in this transaction.
- Compensation attempt, no attempts remaining: state **Dead-lettered**. Do not open a later compensation.
- A step that did not reach outcome `succeeded` is not completed. Its compensation is not opened. `validate-inventory` and `send-notification` have no compensation. `payment-compensation` belongs only to a `take-payment` attempt that succeeded.
- **Waiting**, **Compensating** whose latest attempt is already finished, **Accepted** with no attempt, and the four terminal states are not recovery work.

The claim loop never selects an `in-flight` attempt. Closing an `in-flight` outcome is startup's work alone. After a failure that still has attempts, the next attempt waits out its backoff and is opened by a later claim. `maxAttempts` on `validate-inventory` is 3, on `take-payment` is 3, on `send-notification` is 5, and on `payment-compensation` is 5. A timeout that the living process records is still outcome `timed-out` and still counts as a failed attempt. Recovery writes `failed` only for an attempt that was still `in-flight` when the process died.

`GET /runs/{runId}` returns the run and its attempts in order. `POST /runs` and `GET /runs` stay unchanged, including the start response that omits attempts. Replaying an idempotency key returns that original start response.

## Testing Decisions

A good test drives the process from the outside. It uses `POST /runs`, `POST /runs/{runId}/cancel`, and `GET /runs/{runId}`, a real PostgreSQL, and a real process kill and start. It asserts the run state, **Cancel requested**, the unwind reason, and each attempt's step, number, outcome, and timestamps. It does not query the attempt row, the claim statement, or the startup sweep except through that GET.

There is no existing test suite to copy. This HTTP restart is the only seam.

The required crash test is one case. Hold `take-payment` with **Failure injection** mode `timeout`. Kill the process while `GET` shows that attempt `in-flight`, inside the 3 second timeout, so the living process does not record `timed-out`. After restart, that attempt is `failed` and counts toward `maxAttempts`.

The suite does not have to catch **Waiting**, and it does not assert a backoff delay. Full jitter includes zero. A non-final failure is followed by the next attempt number. Other crash paths stay specified behavior. The suite is not required to perform them. The full suite list is [Tests and load evidence](../tests-and-load-evidence/spec.md).

## Out of Scope

The dashboard UI, trace spans, structured logs, the load test, the performance report, and demo screenshots. More than one worker, leases, and partitioning. A new run state or a fifth attempt outcome. Automatic replay of a **Dead-lettered** run. Exactly-once side effects. A second workflow, a second queue, and user-uploaded step code. Choosing the physical tables and indexes beyond the records and transactions above.

## Further Notes

The behavior decided here is [Crash recovery behavior](../workflow-runner/issues/09-crash-recovery-behavior.md). PostgreSQL 18's lock and commit facts are on `research/postgresql-claim-and-crash-facts`. A session lock would hide the interrupted attempt; the committed `in-flight` outcome is the claim this spec owns.

## Comments
