# Idempotency key contract

Type: grilling
Status: resolved
Blocked by:

## Question

A client sends an idempotency key when starting a **Run**. A duplicate key returns the existing run. The engine does not make a step's side effects exactly-once.

Lock the remaining contract. Is the key unique per **Workflow** name, or unique across all workflows? Does it live for the life of the run row, or expire? On a duplicate, does the response repeat the original start response? If the same key is reused with a different payload, what happens?

## Answer

An **Idempotency key** is required on every start. A missing or empty key is rejected and no run is stored. The key is an exact string, at most 255 characters. The engine does not generate one.

The key is unique per workflow name and lives for the life of the run row. It does not expire. The same key may start a run of a different workflow.

The same workflow, the same key, and the same workflow input return the original start response again: same status and same body, including the existing run. The duplicate does not create a run and is not an error.

The same workflow and the same key with a different workflow input is a conflict. The engine does not start a second run and does not return the original run as a successful replay.

Same input means the workflow input the steps receive, compared as canonical JSON: same values, object keys sorted, insignificant whitespace ignored. A failure-injection switch is not part of that input.

The engine still does not make a step's side effects exactly-once.

## Comments
