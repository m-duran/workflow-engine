# 03: Exhaust a forward step

**What to build:** A client can force a forward **Step** to fail or time out until its attempts are used up. The **Run** ends **Failed**. A payment that never succeeds is not compensated. A failure that still has attempts left is followed by the next attempt number.

**Blocked by:** 01 Succeed an order run

**Status:** resolved

- [x] `fail` on `validate-inventory` records three `failed` attempts, ends **Failed**, and records no compensation attempt.
- [x] `timeout` on `validate-inventory` records three `timed-out` attempts and ends **Failed**.
- [x] `fail` on `take-payment` leaves `validate-inventory` `succeeded`, records three `failed` payment attempts, records no `payment-compensation`, and ends **Failed**.
- [x] A failed attempt that is not the last is followed by the next attempt number for that step.
- [x] The backoff deadline is stored when attempts remain. The test does not assert a delay, because full jitter includes zero.

## Comments

Failure injection now drives the forward attempt. `fail` records `failed` immediately. `timeout` waits that step's timeout, then records `timed-out`. A forward attempt that still has attempts left moves the run to **Waiting** and stores `not_before` as `finished_at` plus full jitter. The next claim opens the next attempt number of the same step. Exhausting a step with no completed compensation ends **Failed** and does not open `payment-compensation`. Proof is `test/exhaust-a-forward-step.test.ts`.
