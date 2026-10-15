# Workflow registration shape

Type: grilling
Status: resolved
Blocked by: 03

## Question

What does registering a **Workflow** in code consist of, once [Retry, timeout, and backoff](03-retry-timeout-and-backoff.md) has locked the policy shape?

Name the fields a definition must carry. At least: ordered step names, which step is the **Compensation** of which step, and the policy fields [Retry, timeout, and backoff](03-retry-timeout-and-backoff.md) already locked: `maxAttempts`, `timeout`, `baseDelay`, and `maxDelay`. Do not change those fields or the order-workflow values. Use these step names from [Failure injection switch](05-failure-injection-switch.md): `validate-inventory`, `take-payment`, `send-notification`, and `payment-compensation`. `payment-compensation` is the compensation of `take-payment`. Do not design the HTTP API. That is [Run HTTP API](07-run-http-api.md).

## Answer

Registration is two startup maps. A step map binds a step name to its function and its policy (`maxAttempts`, `timeout`, `baseDelay`, `maxDelay`). A workflow map is data: a name, an ordered list of forward step names, and a map from a forward step name to its compensation step name. The workflow does not contain function code and does not restate the policy. If either map names a step that was not registered, the process fails at startup.

The only workflow is named `order`. Its forward steps are `validate-inventory`, `take-payment`, `send-notification`, in that order. `payment-compensation` is registered as a step and is the compensation of `take-payment`. It is not in the forward list.

Policy values, unchanged:

| Step | maxAttempts | timeout | baseDelay | maxDelay |
|---|---|---|---|---|
| `validate-inventory` | 3 | 1s | 200ms | 1s |
| `take-payment` | 3 | 3s | 500ms | 4s |
| `send-notification` | 5 | 2s | 500ms | 8s |
| `payment-compensation` | 5 | 3s | 500ms | 8s |

Each forward step is called with the original workflow input and the JSON output of each earlier forward step, keyed by step name. It returns a JSON value. `payment-compensation` is called with that same record, including `take-payment`'s output. A step does not receive later steps' outputs.

## Comments
