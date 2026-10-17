# 03: Exhaust a forward step

**What to build:** A client can force a forward **Step** to fail or time out until its attempts are used up. The **Run** ends **Failed**. A payment that never succeeds is not compensated. A failure that still has attempts left is followed by the next attempt number.

**Blocked by:** 01 Succeed an order run

**Status:** ready-for-agent

- [ ] `fail` on `validate-inventory` records three `failed` attempts, ends **Failed**, and records no compensation attempt.
- [ ] `timeout` on `validate-inventory` records three `timed-out` attempts and ends **Failed**.
- [ ] `fail` on `take-payment` leaves `validate-inventory` `succeeded`, records three `failed` payment attempts, records no `payment-compensation`, and ends **Failed**.
- [ ] A failed attempt that is not the last is followed by the next attempt number for that step.
- [ ] The backoff deadline is stored when attempts remain. The test does not assert a delay, because full jitter includes zero.
