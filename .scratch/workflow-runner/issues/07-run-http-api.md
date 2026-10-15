# Run HTTP API

Type: grilling
Status: open
Blocked by: 02, 04, 05

## Question

Which REST endpoints, status codes, and Zod-validated bodies start a **Run**, fetch one, list them, and cancel one?

Use the states from [Run lifecycle](02-run-lifecycle.md), the contract from [Idempotency key contract](04-idempotency-key-contract.md), and the failure control from [Failure injection switch](05-failure-injection-switch.md). Do not reopen either contract. The key is required, at most 255 characters, unique per workflow for the life of the run; the same canonical workflow input replays the original start response; a different input is a conflict. Failure injection is an optional list on the start request, stored on the run, and not part of the compared input. Each entry is one of `validate-inventory`, `take-payment`, `send-notification`, or `payment-compensation`, with mode `fail` or `timeout`. A repeated step, an unknown step, or an unknown mode stores no run. Choose the status code for that rejection here. The only workflow name is `order`, from [Workflow registration shape](06-workflow-registration-shape.md). The start body carries that name and the workflow input JSON. Do not redesign registration or what a step receives. A **Dead-lettered** run must be visible in this API. Do not design the dashboard. That is [Observational dashboard](08-observational-dashboard.md).

## Comments
