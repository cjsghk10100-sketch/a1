import { randomUUID } from "node:crypto";

import type { FastifyInstance, FastifyRequest } from "fastify";

import { getTraceContext, traceContextStorage } from "./traceContext.js";

const TRACE_ID_RE = /^[A-Za-z0-9._:-]+$/;

function readHeaderString(raw: unknown): string | undefined {
  if (Array.isArray(raw)) {
    const first = raw[0];
    return typeof first === "string" ? first : undefined;
  }
  return typeof raw === "string" ? raw : undefined;
}

function asValidTraceId(raw: unknown): string | undefined {
  const value = readHeaderString(raw)?.trim();
  if (!value) return undefined;
  if (value.length < 8 || value.length > 128) return undefined;
  if (!TRACE_ID_RE.test(value)) return undefined;
  return value;
}

function readWorkspaceId(req: FastifyRequest): string | undefined {
  const value = readHeaderString(req.headers["x-workspace-id"])?.trim();
  return value && value.length > 0 ? value : undefined;
}

function routePattern(req: FastifyRequest): string {
  return req.routeOptions?.url ?? req.routerPath ?? "unknown";
}

function fallbackRequestId(req: FastifyRequest): string {
  const fallback = (req as { _traceFallbackRequestId?: string })._traceFallbackRequestId;
  if (fallback) return fallback;
  const generated = `req_${randomUUID()}`;
  (req as { _traceFallbackRequestId?: string })._traceFallbackRequestId = generated;
  return generated;
}

export function registerTraceHooks(app: FastifyInstance): void {
  app.addHook("onRequest", (req, _reply, done) => {
    try {
      const acceptedRequestId = asValidTraceId(req.headers["x-request-id"]);
      const request_id = acceptedRequestId ?? `req_${randomUUID()}`;

      const acceptedCorrelationHeader = asValidTraceId(req.headers["x-correlation-id"]);
      const correlationHeaderUsed = Boolean(acceptedCorrelationHeader);
      const correlation_id = acceptedCorrelationHeader
        ? `ext_${acceptedCorrelationHeader}`
        : request_id;

      const ctx = {
        request_id,
        correlation_id,
        workspace_id: readWorkspaceId(req),
        source: "http" as const,
      };

      (req as { _traceStartNs?: bigint })._traceStartNs = process.hrtime.bigint();
      (req as { _traceLogged?: boolean })._traceLogged = false;
      (req as { _traceResponseLogged?: boolean })._traceResponseLogged = false;
      (req as { _traceCorrelationFromHeader?: boolean })._traceCorrelationFromHeader = correlationHeaderUsed;
      (req as { _traceFallbackRequestId?: string })._traceFallbackRequestId = request_id;

      traceContextStorage.run(ctx, done);
      return;
    } catch {
      done();
    }
  });

  app.addHook("preHandler", (req, _reply, done) => {
    try {
      const ctx = getTraceContext();
      if (!ctx) {
        done();
        return;
      }

      const latestWorkspaceId = readWorkspaceId(req);
      if (latestWorkspaceId) {
        ctx.workspace_id = latestWorkspaceId;
      }

      const fromHeader = (req as { _traceCorrelationFromHeader?: boolean })._traceCorrelationFromHeader === true;
      if (!fromHeader && ctx.correlation_id === ctx.request_id) {
        const body = (req as { body?: unknown }).body;
        if (body && typeof body === "object" && !Array.isArray(body)) {
          const bodyCorrelation = asValidTraceId((body as Record<string, unknown>).correlation_id);
          if (bodyCorrelation) {
            ctx.correlation_id = bodyCorrelation;
          }
        }
      }

      if ((req as { _traceLogged?: boolean })._traceLogged !== true) {
        req.log.info({
          event: "http.request",
          request_id: ctx.request_id,
          correlation_id: ctx.correlation_id,
          method: req.method,
          route: routePattern(req),
        });
        (req as { _traceLogged?: boolean })._traceLogged = true;
      }
    } catch {
      // hook must not throw
    }
    done();
  });

  app.addHook("onSend", async (req, reply, payload) => {
    try {
      const ctx = getTraceContext();
      const request_id = ctx?.request_id ?? fallbackRequestId(req);
      const correlation_id = ctx?.correlation_id ?? request_id;
      const workspace_id = readWorkspaceId(req) ?? ctx?.workspace_id;
      if (ctx && workspace_id) {
        ctx.workspace_id = workspace_id;
      }

      reply.header("x-request-id", request_id);
      reply.header("x-correlation-id", correlation_id);
      if (workspace_id) {
        reply.header("x-workspace-id", workspace_id);
      }

      if ((req as { _traceResponseLogged?: boolean })._traceResponseLogged !== true) {
        const start = (req as { _traceStartNs?: bigint })._traceStartNs;
        const end = process.hrtime.bigint();
        const duration_ms = start ? Number((end - start) / 1000000n) : 0;

        req.log.info({
          event: "http.response",
          request_id,
          correlation_id,
          status_code: reply.statusCode,
          duration_ms,
        });
        (req as { _traceResponseLogged?: boolean })._traceResponseLogged = true;
      }
    } catch {
      // hook must not throw
    }
    return payload;
  });

  app.addHook("onError", (req, reply, err, done) => {
    try {
      const ctx = getTraceContext();
      const request_id = ctx?.request_id ?? fallbackRequestId(req);
      const correlation_id = ctx?.correlation_id ?? request_id;
      req.log.error({
        event: "http.error",
        request_id,
        correlation_id,
        status_code: reply.statusCode ?? 500,
        err_name: err?.name ?? "Error",
        err_message: err?.message ?? "unknown",
      });
    } catch {
      // hook must not throw
    }
    done();
  });
}
