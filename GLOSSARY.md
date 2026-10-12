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

**Failed**:
The terminal state of a run whose retries are exhausted and whose required compensations have finished.
_Avoid_: Error, crashed

**Dead-lettered**:
The terminal state of a run whose compensation exhausted its retries.
_Avoid_: Poison message, dead letter queue
