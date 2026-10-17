# 01: Succeed an order run

**What to build:** A client starts an `order` **Run** with an **Idempotency key** and a workflow input. The engine runs `validate-inventory`, `take-payment`, and `send-notification`. The client can read that run back as **Succeeded**, with one `succeeded` **Attempt** for each step, and can see it in the run list.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] `POST /runs` with a valid `Idempotency-Key`, workflow `order`, and a JSON input returns `201` and the run body without `attempts`.
- [ ] The run id is an engine-generated UUID.
- [ ] `GET /runs/{runId}` returns `200` with state **Succeeded** and three attempts in order: `validate-inventory`, `take-payment`, and `send-notification`, each `succeeded` once.
- [ ] `GET /runs` returns that run, newest first.
- [ ] The workflow input is stored so a later replay can compare it as canonical JSON.
- [ ] A real PostgreSQL holds the run and its attempts. The HTTP body stays camelCase and does not include the backoff deadline.
