# Retry, timeout, and backoff

Type: grilling
Status: resolved
Blocked by:

## Question

What retry policy can a **Step** declare, as one shape used by every step? Lock max attempts, the backoff formula (including base, cap, and whether there is jitter), and the rule that a timeout consumes an attempt.

Give the values for the order workflow: validate inventory, take payment, send notification, and the payment **Compensation**.

Do not decide the **Run** state machine. That is [Run lifecycle](02-run-lifecycle.md). Do not decide how the definition is written in code. That is [Workflow registration shape](06-workflow-registration-shape.md).

## Answer

Every step, including a compensation, declares `maxAttempts`, `timeout`, `baseDelay`, and `maxDelay`. `maxAttempts` counts the first attempt. A timeout is a failed attempt.

After a failed attempt that is not the last, the next attempt waits `min(maxDelay, baseDelay * 2^(n-1))`, where `n` is the attempt that just failed, counting from 1. Full jitter applies: the actual wait is random from zero up to that value. There is no wait after the attempt that uses up `maxAttempts`.

Order workflow:

| Step | maxAttempts | timeout | baseDelay | maxDelay |
|---|---|---|---|---|
| Validate inventory | 3 | 1s | 200ms | 1s |
| Take payment | 3 | 3s | 500ms | 4s |
| Send notification | 5 | 2s | 500ms | 8s |
| Payment compensation | 5 | 3s | 500ms | 8s |

Validate inventory fails fast. Take payment gets a longer timeout and only three attempts. Send notification gets five attempts because it has no compensation. Payment compensation gets five attempts so the refund is tried harder than the charge before the run goes **Dead-lettered**.

## Comments
