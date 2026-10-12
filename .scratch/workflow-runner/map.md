# Reliable workflow runner spec

## Destination

A design spec for a single-process durable workflow runner, complete enough that someone can write it and then implement it without further product decisions. The spec covers run lifecycle, how work is claimed, retries, compensation, cancellation, the HTTP API, failure injection, and what the dashboard must show. Writing that document, and building the system, is the handoff after this map — not a ticket on it.

## Notes

Portfolio piece for a hiring engineer. The reader should see judgment: failure modes, limits, and what a later implementation must measure. Not a multi-tenant product.

Domain language is in `GLOSSARY.md`. Every session consults the grilling and domain-modeling skills. Research tickets also consult the research skill. The dashboard ticket also consults the prototype skill.

Standing preferences already settled with the user:

- TypeScript/Node, Zod on the API, OpenTelemetry, a React dashboard, and Docker Compose are inherited from the brief and are not open.
- One Node process. PostgreSQL is both the run store and the queue. No Redis and no in-memory queue.
- Steps are named functions registered in the process. Workflows are registered at startup. The API starts runs; it does not create definitions.
- The only workflow is the order flow: validate inventory, take payment, send notification, with a compensation on payment. Those steps are in-process fakes.
- The dashboard observes runs. It does not author workflows.
- An idempotency key dedupes run starts. Step side effects are at-least-once; the step author makes them safe.
- A timeout fails that attempt and counts toward retries. Cancel lets the in-flight attempt finish or time out, schedules no further steps, and compensates completed steps.
- **Failed** means the run stopped cleanly. **Dead-lettered** means compensation did not finish. No automatic replay from the dead letter.
- The spec requires a later implementation to produce a performance report and demo screenshots or a GIF. This map does not invent those.

Research findings live on throwaway branches named `research/<name>`, cut from `main`, pushed, and never merged. [PostgreSQL claim and crash facts](issues/01-postgresql-claim-and-crash-facts.md) is on `research/postgresql-claim-and-crash-facts`.

## Decisions so far

- [PostgreSQL claim and crash facts](issues/01-postgresql-claim-and-crash-facts.md): A lock claim vanishes with the session and leaves no in-flight trace; a committed column claim stays visible and stuck.
- [Run lifecycle](issues/02-run-lifecycle.md): Eight run states. Cancel and retry exhaustion unwind through Compensating; a compensation that exhausts its retries dead-letters the run and stops the rest.

## Not yet specified

- What is stored for a run, an attempt, and an idempotency key. Depends on the lifecycle, the claim behavior, and the idempotency contract.
- Correlation ids, structured log fields, and trace spans. Depends on the lifecycle and the HTTP API.
- What the spec will require automated tests, the load test, and the failure-injection demo to show. Depends on the lifecycle, the retry policy, and the HTTP API.

## Out of scope

- Building the engine, the dashboard, or the Docker setup. This map decides; implementation is a later effort.
- A general job queue or event platform. The product is a workflow runner.
- More than one worker, leases, and partitioning. The spec mentions them only as what would change at larger scale.
- Redis, Kafka, and an in-memory queue.
- User-uploaded step code, a sandbox, or a plugin loader.
- Creating or editing workflow definitions through the API, and a second demo workflow.
- Separate inventory, payment, or notification services.
- Automatic replay of a dead-lettered run.
- Performance numbers or demo images produced by this map.
