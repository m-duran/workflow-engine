# 05: Cancel a run

**What to build:** A client can cancel a **Run** that has not finished. Cancel from **Accepted** stops it immediately. Cancel during an **Attempt** lets that attempt finish, skips a retry, compensates completed steps, and ends **Cancelled**. Cancel of a **Succeeded** run is rejected.

**Blocked by:** 03 Exhaust a forward step

**Status:** ready-for-agent

- [ ] Cancel from **Accepted** returns `200`, ends **Cancelled**, records no attempts, and leaves the unwind reason null.
- [ ] Cancel while an attempt is `in-flight` does not retry that attempt, compensates completed steps, and ends **Cancelled**.
- [ ] Cancel of **Succeeded** returns `409` with a cancel rejection, and the run stays **Succeeded**.
