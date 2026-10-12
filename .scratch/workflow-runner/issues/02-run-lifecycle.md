# Run lifecycle

Type: grilling
Status: open
Blocked by:

## Question

What are the legal states of a **Run**, and which transitions are allowed, for work that is accepted, in an **Attempt**, waiting to retry, compensating, succeeded, cancelled, **Failed**, and **Dead-lettered**?

Use the standing rules: a timeout fails that attempt and counts toward retries; cancel lets the in-flight attempt finish or time out, schedules no further steps, and compensates completed steps; **Failed** means required compensations finished; **Dead-lettered** means a compensation exhausted its retries. No automatic replay.

Do not add states for "the process died mid-attempt." That waits on [PostgreSQL claim and crash facts](01-postgresql-claim-and-crash-facts.md).

## Comments
