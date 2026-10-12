# Idempotency key contract

Type: grilling
Status: open
Blocked by:

## Question

A client sends an idempotency key when starting a **Run**. A duplicate key returns the existing run. The engine does not make a step's side effects exactly-once.

Lock the remaining contract. Is the key unique per **Workflow** name, or unique across all workflows? Does it live for the life of the run row, or expire? On a duplicate, does the response repeat the original start response? If the same key is reused with a different payload, what happens?

## Comments
