# Run HTTP API

Type: grilling
Status: open
Blocked by: 02, 04, 05

## Question

Which REST endpoints, status codes, and Zod-validated bodies start a **Run**, fetch one, list them, and cancel one?

Use the states from [Run lifecycle](02-run-lifecycle.md), the duplicate-key behavior from [Idempotency key contract](04-idempotency-key-contract.md), and the failure control from [Failure injection switch](05-failure-injection-switch.md). A **Dead-lettered** run must be visible in this API. Do not design the dashboard. That is [Observational dashboard](08-observational-dashboard.md).

## Comments
