import { AsyncLocalStorage } from "node:async_hooks";
import {
  ROOT_CONTEXT,
  context,
  propagation,
  trace,
  type Context,
  type ContextManager,
  type Span,
} from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { AlwaysOnSampler, TracerProvider } from "@opentelemetry/sdk-trace";

class AsyncContextManager implements ContextManager {
  private readonly storage = new AsyncLocalStorage<Context>();

  active(): Context {
    return this.storage.getStore() ?? ROOT_CONTEXT;
  }

  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    ctx: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    const callback = thisArg === undefined ? fn : fn.bind(thisArg);
    return this.storage.run(ctx, callback, ...args) as ReturnType<F>;
  }

  bind<T>(ctx: Context, target: T): T {
    if (typeof target !== "function") return target;
    const manager = this;
    return function (this: unknown, ...args: unknown[]) {
      return manager.with(ctx, target as (...inner: unknown[]) => unknown, this, ...args);
    } as T;
  }

  enable(): this {
    return this;
  }

  disable(): this {
    this.storage.disable();
    return this;
  }
}

context.setGlobalContextManager(new AsyncContextManager().enable());
propagation.setGlobalPropagator(new W3CTraceContextPropagator());

const tracer = trace.getTracer("workflow-engine");

export type AttemptFields = {
  runId: string;
  workflow: string;
  step: string;
  attempt: number;
};

export type DurableChange = {
  runId: string;
  workflow: string;
  state?: string;
  step?: string;
  attempt?: number;
  outcome?: string;
};

export function startTracing(): void {
  trace.setGlobalTracerProvider(
    new TracerProvider({
      sampler: new AlwaysOnSampler(),
    }),
  );
}

export function startAttemptSpan(fields: AttemptFields): Span {
  return tracer.startSpan(fields.step, { attributes: attemptAttributes(fields) }, ROOT_CONTEXT);
}

export function startRecoverSpan(fields: AttemptFields): Span {
  return tracer.startSpan("recover", { attributes: attemptAttributes(fields) }, ROOT_CONTEXT);
}

export function logCommit(change: DurableChange): void {
  info(change);
}

export function logHttp(fields: {
  runId?: string;
  workflow?: string;
  method: string;
  route: string;
  statusCode: number;
}): void {
  info(fields);
}

function info(fields: {
  runId?: string;
  workflow?: string;
  state?: string;
  step?: string;
  attempt?: number;
  outcome?: string;
  method?: string;
  route?: string;
  statusCode?: number;
}): void {
  const line: Record<string, string | number> = { level: "info" };
  if (fields.runId !== undefined) line.runId = fields.runId;
  if (fields.workflow !== undefined) line.workflow = fields.workflow;
  if (fields.state !== undefined) line.state = fields.state;
  if (fields.step !== undefined) line.step = fields.step;
  if (fields.attempt !== undefined) line.attempt = fields.attempt;
  if (fields.outcome !== undefined) line.outcome = fields.outcome;
  if (fields.method !== undefined) line.method = fields.method;
  if (fields.route !== undefined) line.route = fields.route;
  if (fields.statusCode !== undefined) line.statusCode = fields.statusCode;
  console.log(JSON.stringify(line));
}

function attemptAttributes(fields: AttemptFields): {
  runId: string;
  workflow: string;
  step: string;
  attempt: number;
} {
  return {
    runId: fields.runId,
    workflow: fields.workflow,
    step: fields.step,
    attempt: fields.attempt,
  };
}
