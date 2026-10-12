# Retry, timeout, and backoff

Type: grilling
Status: open
Blocked by:

## Question

What retry policy can a **Step** declare, as one shape used by every step? Lock max attempts, the backoff formula (including base, cap, and whether there is jitter), and the rule that a timeout consumes an attempt.

Give the values for the order workflow: validate inventory, take payment, send notification, and the payment **Compensation**.

Do not decide the **Run** state machine. That is [Run lifecycle](02-run-lifecycle.md). Do not decide how the definition is written in code. That is [Workflow registration shape](06-workflow-registration-shape.md).

## Comments
