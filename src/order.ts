export type StepContext = {
  input: unknown;
  outputs: Readonly<Record<string, unknown>>;
};

export type StepPolicy = {
  maxAttempts: number;
  timeoutMs: number;
  baseDelayMs: number;
  maxDelayMs: number;
};

export type StepDefinition = {
  run: (ctx: StepContext) => Promise<unknown>;
  policy: StepPolicy;
};

export type WorkflowDefinition = {
  name: string;
  forward: readonly string[];
  compensations: Readonly<Record<string, string>>;
};

export const steps: Record<string, StepDefinition> = {
  "validate-inventory": {
    policy: { maxAttempts: 3, timeoutMs: 1000, baseDelayMs: 200, maxDelayMs: 1000 },
    async run(_ctx) {
      return { reserved: true };
    },
  },
  "take-payment": {
    policy: { maxAttempts: 3, timeoutMs: 3000, baseDelayMs: 500, maxDelayMs: 4000 },
    async run(_ctx) {
      return { charged: true };
    },
  },
  "send-notification": {
    policy: { maxAttempts: 5, timeoutMs: 2000, baseDelayMs: 500, maxDelayMs: 8000 },
    async run(_ctx) {
      return { sent: true };
    },
  },
  "payment-compensation": {
    policy: { maxAttempts: 5, timeoutMs: 3000, baseDelayMs: 500, maxDelayMs: 8000 },
    async run(_ctx) {
      return { refunded: true };
    },
  },
};

export const orderWorkflow: WorkflowDefinition = {
  name: "order",
  forward: ["validate-inventory", "take-payment", "send-notification"],
  compensations: { "take-payment": "payment-compensation" },
};

export function assertRegistration(): void {
  const named = [
    ...orderWorkflow.forward,
    ...Object.values(orderWorkflow.compensations),
  ];
  for (const name of named) {
    if (!steps[name]) {
      throw new Error(`workflow ${orderWorkflow.name} names unregistered step ${name}`);
    }
  }
}
