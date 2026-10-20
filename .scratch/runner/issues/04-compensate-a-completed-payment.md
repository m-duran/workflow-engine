# 04: Compensate a completed payment

**What to build:** A client starts an `order` **Run** whose notification is forced to fail. Payment has already succeeded, so `payment-compensation` runs and the run ends **Failed**. If that compensation is also forced to fail, the run ends **Dead-lettered** and shows up in the list. This run is the demo.

**Blocked by:** 03 Exhaust a forward step

**Status:** resolved

- [x] `fail` on `send-notification` leaves `take-payment` `succeeded`, records five `failed` notification attempts, records `payment-compensation` `succeeded`, ends **Failed**, and sets the unwind reason to `retries-exhausted`.
- [x] `fail` on `send-notification` and on `payment-compensation` records five `failed` compensation attempts, ends **Dead-lettered**, and does not start a later compensation.
- [x] `GET /runs` includes that **Dead-lettered** run.
- [x] The demo is this `send-notification` failure that ends **Failed**. The screenshots or GIF are left to the implementation.

## Comments

Exhausting `send-notification` after a succeeded `take-payment` sets unwind reason `retries-exhausted`, enters **Compensating**, and runs `payment-compensation`. That compensation's success ends **Failed**. Its own exhausted attempts end **Dead-lettered** and stay in `GET /runs`. Compensation backoff stays **Compensating**. The demo is the notification failure above, read back from the run API. Proof is `test/compensate-a-completed-payment.test.ts`.
