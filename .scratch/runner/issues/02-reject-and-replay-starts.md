# 02: Reject and replay starts

**What to build:** A client can retry a start safely. The same **Idempotency key** and the same workflow input return the original start. A different input is a conflict. A bad start stores no **Run**. An unknown run id is a miss.

**Blocked by:** 01 Succeed an order run

**Status:** resolved

- [x] The same key, the same workflow, and the same input return the original `201` and the same run id, and do not create a second run.
- [x] The same key and a different input return `409` with an idempotency conflict, and the original run is unchanged.
- [x] The same key and input with a different **Failure injection** list replay the original run, and the stored injection does not change.
- [x] A missing or empty key returns `400` and stores no run.
- [x] A repeated step, an unknown step, or an unknown mode in the failure-injection list returns `400` and stores no run.
- [x] `GET /runs/{runId}` and cancel for an unknown run id return `404`.

## Comments

Replay compares canonical jsonb input and ignores a different failure-injection list. Proof is `test/reject-and-replay-starts.test.ts`. Cancel of a stored run is still the later cancel ticket: an unknown id is `404`, and cancelling an id that exists is rejected without changing the run.
