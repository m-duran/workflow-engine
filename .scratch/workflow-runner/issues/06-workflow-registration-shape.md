# Workflow registration shape

Type: grilling
Status: open
Blocked by: 03

## Question

What does registering a **Workflow** in code consist of, once [Retry, timeout, and backoff](03-retry-timeout-and-backoff.md) has locked the policy shape?

Name the fields a definition must carry. At least: ordered step names, which step is the **Compensation** of which step, and the policy fields [Retry, timeout, and backoff](03-retry-timeout-and-backoff.md) already locked: `maxAttempts`, `timeout`, `baseDelay`, and `maxDelay`. Do not change those fields or the order-workflow values. Use these step names from [Failure injection switch](05-failure-injection-switch.md): `validate-inventory`, `take-payment`, `send-notification`, and `payment-compensation`. `payment-compensation` is the compensation of `take-payment`. Do not design the HTTP API. That is [Run HTTP API](07-run-http-api.md).

## Comments
