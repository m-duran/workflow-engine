# 05: Cancel a run

**What to build:** A client can cancel a **Run** that has not finished. Cancel from **Accepted** stops it immediately. Cancel during an **Attempt** lets that attempt finish, skips a retry, compensates completed steps, and ends **Cancelled**. Cancel of a **Succeeded** run is rejected.

**Blocked by:** 03 Exhaust a forward step

**Status:** resolved

- [x] Cancel from **Accepted** returns `200`, ends **Cancelled**, records no attempts, and leaves the unwind reason null.
- [x] Cancel while an attempt is `in-flight` does not retry that attempt, compensates completed steps, and ends **Cancelled**.
- [x] Cancel of **Succeeded** returns `409` with a cancel rejection, and the run stays **Succeeded**.

## Comments

Cancel from **Accepted** ends **Cancelled** with no attempts and a null unwind reason. Cancel from **Running** sets **Cancel requested** and lets the in-flight attempt finish; that attempt is not retried, completed steps are compensated, and the run ends **Cancelled** with unwind reason `cancelled`. **Succeeded**, **Failed**, **Dead-lettered**, and **Cancelled** reject with `409`. **Compensating** is ignored. Proof is `test/cancel-a-run.test.ts`.
