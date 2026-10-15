# Failure injection switch

Type: grilling
Status: resolved
Blocked by:

## Question

How does a caller force the order fakes — validate inventory, take payment, send notification, or the payment **Compensation** — to fail or time out, without editing code?

The mechanism is either a field on the start-run request or a test-only switch. Say which, what values it accepts, and whether it applies to one **Attempt** or keeps failing until the policy is exhausted.

## Answer

**Failure injection** is a list of targets on the start-run request, stored on that run. Omitting it, or sending an empty list, means the fakes succeed. It is not a process-wide switch. A duplicate idempotency key does not change the injection already stored, and the list is not part of the compared workflow input.

Each target names one step and one mode. The steps are `validate-inventory`, `take-payment`, `send-notification`, and `payment-compensation`. The modes are `fail` and `timeout`. `fail` ends the attempt immediately. `timeout` holds the attempt until that step's timeout, then counts as a failed attempt.

A targeted step fails that way on every attempt until its `maxAttempts` is used up. Untargeted steps behave normally. Take payment and its compensation are separate targets. A step appears at most once. A repeated step, an unknown step, or an unknown mode rejects the start and stores no run.

[Workflow registration shape](06-workflow-registration-shape.md) must use these four step names.

## Comments
