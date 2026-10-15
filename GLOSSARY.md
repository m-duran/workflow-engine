# Workflow runner

A small system that executes a predefined sequence of steps durably: one run at a time through success, retry, or compensation.

## Language

**Workflow**:
The definition of an ordered sequence of steps. It is not a running execution.
_Avoid_: Job, pipeline, process

**Run**:
One execution of a workflow. The durable thing that succeeds, retries, or compensates.
_Avoid_: Job, execution, instance

**Step**:
A named function registered in the engine process. A workflow definition refers to steps by name; it does not contain their code.
_Avoid_: Activity, task, job

**Compensation**:
A step named by another step, invoked in reverse order of completed steps after that run's retries are exhausted.
_Avoid_: Rollback, undo, saga

**Attempt**:
One invocation of a step on a run. A retry is another attempt. Invoking a compensation is an attempt.
_Avoid_: Try, execution

**Accepted**:
A run state. The run is stored, and no attempt has started.
_Avoid_: Queued, pending, created

**Running**:
A run state. A forward attempt is in flight.
_Avoid_: In progress, active

**Waiting**:
A run state. A forward attempt has failed, and the backoff before the next attempt has not elapsed.
_Avoid_: Delayed, scheduled, backoff

**Compensating**:
A run state. Completed steps are being compensated in reverse. This includes a compensation attempt in flight and the backoff before the next one.
_Avoid_: Rolling back, undoing

**Succeeded**:
A run state. Every forward step completed.
_Avoid_: Completed, done, successful

**Cancelled**:
A run state. The client cancelled the run, and every required compensation has finished.
_Avoid_: Aborted, stopped

**Failed**:
A run state. A forward step exhausted its retries, and every required compensation has finished.
_Avoid_: Error, crashed

**Dead-lettered**:
A run state. A compensation exhausted its retries.
_Avoid_: Poison message, dead letter queue

**Unwind reason**:
Why a run entered Compensating. Either a forward step exhausted its retries, or the client cancelled. It selects Failed or Cancelled when compensation finishes. It is not a run state.
_Avoid_: Cause, error type

**Idempotency key**:
A client-supplied token, unique per workflow name, that identifies one start of that workflow for the life of the run row.
_Avoid_: Dedup key, request id

**Failure injection**:
A per-run instruction, set when the run starts, that forces a named fake step to fail or time out on every attempt until that step's attempts are exhausted.
_Avoid_: Chaos switch, fault flag
