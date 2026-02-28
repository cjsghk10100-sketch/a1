import { AsyncLocalStorage } from "node:async_hooks";

export type TraceContext = {
  request_id: string;
  correlation_id: string;
  workspace_id?: string;
  source: "http" | "cron";
};

type TraceLogger = {
  info?: (obj: unknown, msg?: string) => void;
  warn?: (obj: unknown, msg?: string) => void;
  error?: (obj: unknown, msg?: string) => void;
};

export const traceContextStorage = new AsyncLocalStorage<TraceContext>();

let traceLogger: TraceLogger | undefined;

export function getTraceContext(): TraceContext | undefined {
  return traceContextStorage.getStore();
}

export function runWithTraceContext<T>(
  ctx: TraceContext,
  fn: () => Promise<T>,
): Promise<T> {
  return traceContextStorage.run(ctx, fn);
}

export function setTraceLogger(logger: { info: Function; warn: Function; error: Function }): void {
  traceLogger = logger as TraceLogger;
}

export function getTraceLogger(): TraceLogger | undefined {
  return traceLogger;
}
