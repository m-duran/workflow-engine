# Observational dashboard

Type: prototype
Status: resolved
Blocked by: 02, 07

## Question

What should a rough observational dashboard show, so we can react to it before the spec freezes the UI?

It lists **Runs** and opens one run's **Attempts**, retries, failures, and **Compensation**. It must be able to show every state from [Run lifecycle](02-run-lifecycle.md) using only the data from [Run HTTP API](07-run-http-api.md): `GET /runs` for the list and `GET /runs/{runId}` for `state`, `cancelRequested`, `unwindReason`, `failureInjection`, and `attempts`. It does not author workflows, and it does not add endpoints.

## Answer

The dashboard is the Timeline. A rail lists each run by state and id. The rest of the page is the selected run: its state, whether cancel was requested, its unwind reason, its failure injection, its input, and its attempts in order. Each attempt shows the step, the attempt number, the outcome, and when it started and finished.

The Ledger and the Transcript were the other two layouts on the throwaway prototype. They are not the dashboard. The raw `GET /runs/{runId}` dump in that prototype was there so the data could be checked. It is not part of the dashboard.

Prototype, all three layouts: `prototype/observational-dashboard` (`.scratch/workflow-runner/prototype/observational-dashboard.html`, `?variant=B`). Not merged.

## Comments
