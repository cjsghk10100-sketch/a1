import pg from "pg";

import { getTraceContext } from "../observability/traceContext.js";

const { Pool } = pg;

export type DbPool = pg.Pool;
export type DbClient = pg.PoolClient;

type LoggerLike = {
  info?: (obj: unknown, msg?: string) => void;
  warn?: (obj: unknown, msg?: string) => void;
  error?: (obj: unknown, msg?: string) => void;
};

const SLOW_QUERY_THRESHOLD_MS = 200;
const POOL_STARVATION_THRESHOLD_MS = 200;
const CLIENT_QUERY_WRAPPED = Symbol("client_query_wrapped");

let dbLogger: LoggerLike | undefined;

function durationMs(startNs: bigint): number {
  return Number((process.hrtime.bigint() - startNs) / 1000000n);
}

function traceIds(input?: { request_id?: string; correlation_id?: string }): {
  request_id: string;
  correlation_id: string;
} {
  return {
    request_id: input?.request_id ?? "unknown",
    correlation_id: input?.correlation_id ?? "unknown",
  };
}

function logSlowQuery(query_ms: number, cachedCtx?: { request_id?: string; correlation_id?: string }): void {
  if (query_ms < SLOW_QUERY_THRESHOLD_MS) return;
  const ids = traceIds(cachedCtx ?? getTraceContext());
  dbLogger?.warn?.({
    event: "db.query.slow",
    request_id: ids.request_id,
    correlation_id: ids.correlation_id,
    query_ms,
  });
}

function logPoolStarvation(
  acquire_ms: number,
  cachedCtx?: { request_id?: string; correlation_id?: string },
): void {
  if (acquire_ms < POOL_STARVATION_THRESHOLD_MS) return;
  const ids = traceIds(cachedCtx ?? getTraceContext());
  dbLogger?.warn?.({
    event: "db.pool.starvation",
    request_id: ids.request_id,
    correlation_id: ids.correlation_id,
    acquire_ms,
  });
}

function wrapClientQuery(client: DbClient): void {
  const clientAny = client as DbClient & {
    [CLIENT_QUERY_WRAPPED]?: boolean;
    query: (...args: unknown[]) => unknown;
  };
  if (clientAny[CLIENT_QUERY_WRAPPED] === true) return;

  const originalClientQuery = client.query.bind(client) as (...args: unknown[]) => unknown;
  clientAny.query = ((...args: unknown[]) => {
    const ctx = getTraceContext();
    const startNs = process.hrtime.bigint();
    const maybeCallback = args.length > 0 ? args[args.length - 1] : undefined;
    if (typeof maybeCallback === "function") {
      const callback = maybeCallback as (...callbackArgs: unknown[]) => void;
      args[args.length - 1] = (...callbackArgs: unknown[]) => {
        logSlowQuery(durationMs(startNs), ctx);
        callback(...callbackArgs);
      };
      return originalClientQuery(...args);
    }

    const result = originalClientQuery(...args);
    if (result && typeof (result as Promise<unknown>).finally === "function") {
      return (result as Promise<unknown>).finally(() => {
        logSlowQuery(durationMs(startNs), ctx);
      });
    }

    {
      logSlowQuery(durationMs(startNs), ctx);
    }
    return result;
  }) as DbClient["query"];
  clientAny[CLIENT_QUERY_WRAPPED] = true;
}

export function setDbLogger(logger: { info: Function; warn: Function; error: Function }): void {
  dbLogger = logger as LoggerLike;
}

export function createPool(databaseUrl: string): DbPool {
  const pool = new Pool({ connectionString: databaseUrl });

  const originalPoolQuery = pool.query.bind(pool) as (...args: unknown[]) => unknown;
  const originalPoolConnect = pool.connect.bind(pool) as (...args: unknown[]) => unknown;

  const poolAny = pool as DbPool & {
    query: (...args: unknown[]) => unknown;
    connect: (...args: unknown[]) => unknown;
  };

  poolAny.query = ((...args: unknown[]) => {
    const ctx = getTraceContext();
    const startNs = process.hrtime.bigint();
    const maybeCallback = args.length > 0 ? args[args.length - 1] : undefined;
    if (typeof maybeCallback === "function") {
      const callback = maybeCallback as (...callbackArgs: unknown[]) => void;
      args[args.length - 1] = (...callbackArgs: unknown[]) => {
        logSlowQuery(durationMs(startNs), ctx);
        callback(...callbackArgs);
      };
      return originalPoolQuery(...args);
    }

    const result = originalPoolQuery(...args);
    if (result && typeof (result as Promise<unknown>).finally === "function") {
      return (result as Promise<unknown>).finally(() => {
        logSlowQuery(durationMs(startNs), ctx);
      });
    }

    {
      logSlowQuery(durationMs(startNs), ctx);
    }
    return result;
  }) as DbPool["query"];

  poolAny.connect = ((...args: unknown[]) => {
    const ctx = getTraceContext();
    const startNs = process.hrtime.bigint();
    const maybeCallback = args.length > 0 ? args[0] : undefined;
    if (typeof maybeCallback === "function") {
      const callback = maybeCallback as (...callbackArgs: unknown[]) => void;
      return originalPoolConnect((err: unknown, client: DbClient | undefined, done: unknown) => {
        logPoolStarvation(durationMs(startNs), ctx);
        if (!err && client) {
          wrapClientQuery(client);
        }
        callback(err, client, done);
      });
    }

    const result = originalPoolConnect(...args);
    if (result && typeof (result as Promise<DbClient>).then === "function") {
      return (result as Promise<DbClient>).then((client) => {
        logPoolStarvation(durationMs(startNs), ctx);
        wrapClientQuery(client);
        return client;
      });
    }

    logPoolStarvation(durationMs(startNs), ctx);
    return result;
  }) as DbPool["connect"];

  return pool;
}
