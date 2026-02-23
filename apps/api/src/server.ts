import Fastify, { type FastifyInstance } from "fastify";

import type { AppConfig } from "./config.js";
import type { DbPool } from "./db/pool.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerV1Routes } from "./routes/v1/index.js";
import { runQueuedRunsWorker } from "./runtime/runWorker.js";
import { findSessionByAccessToken, touchSessionLastSeen } from "./security/authSessions.js";
import { ensurePrincipalForLegacyActor } from "./security/principals.js";
import { setRequestAuth } from "./security/requestAuth.js";

export interface BuildContext {
  config: AppConfig;
  pool: DbPool;
}

export async function buildServer(ctx: BuildContext): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });
  let workerTimer: NodeJS.Timeout | undefined;
  let workerStopped = false;
  let workerInFlight = false;
  const embeddedWorkerEnabled = ctx.config.runWorkerEmbedded === true;
  const workerPollMs = ctx.config.runWorkerPollMs ?? 1000;
  function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
    if (!raw) return fallback;
    const value = raw.trim().toLowerCase();
    if (value === "1" || value === "true" || value === "yes" || value === "on") return true;
    if (value === "0" || value === "false" || value === "no" || value === "off") return false;
    return fallback;
  }

  const authSessionSecret =
    ctx.config.authSessionSecret ??
    process.env.AUTH_SESSION_SECRET?.trim() ??
    "agentapp_local_dev_session_secret";
  const authRequireSession =
    ctx.config.authRequireSession ??
    parseBoolean(process.env.AUTH_REQUIRE_SESSION, true);
  const authAllowLegacyWorkspaceHeader =
    ctx.config.authAllowLegacyWorkspaceHeader ??
    parseBoolean(process.env.AUTH_ALLOW_LEGACY_WORKSPACE_HEADER, false);

  function parseBearerToken(raw: string | undefined): string | null {
    if (!raw) return null;
    const header = raw.trim();
    if (!header.toLowerCase().startsWith("bearer ")) return null;
    const token = header.slice(7).trim();
    return token.length ? token : null;
  }

  function legacyWorkspaceHeader(req: { headers: Record<string, unknown> }): string | null {
    const raw = req.headers["x-workspace-id"];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== "string") return null;
    const normalized = value.trim();
    return normalized.length ? normalized : null;
  }

  await registerHealthRoutes(app, ctx.pool);

  app.addHook("preHandler", async (req, reply) => {
    if (req.url === "/health") return;
    if (!req.url.startsWith("/v1/")) return;
    if (req.url.startsWith("/v1/auth/")) return;

    const bearerToken = parseBearerToken(req.headers.authorization);
    if (bearerToken) {
      const session = await findSessionByAccessToken(
        ctx.pool,
        authSessionSecret,
        bearerToken,
      );
      if (!session) {
        return reply.code(401).send({ error: "invalid_session" });
      }

      setRequestAuth(req, {
        auth_type: "owner_session",
        workspace_id: session.workspace_id,
        principal_id: session.principal_id,
        principal_type: session.principal_type,
        owner_id: session.owner_id,
        session_id: session.session_id,
      });
      (req.headers as Record<string, unknown>)["x-workspace-id"] = session.workspace_id;
      (req.headers as Record<string, unknown>)["x-principal-id"] = session.principal_id;
      void touchSessionLastSeen(ctx.pool, session.session_id).catch(() => {});
      return;
    }

    if (authRequireSession !== true) {
      return;
    }

    if (authAllowLegacyWorkspaceHeader === true) {
      const workspace_id = legacyWorkspaceHeader(req) ?? "ws_dev";
      const client = await ctx.pool.connect();
      try {
        const principal_id = await ensurePrincipalForLegacyActor(
          client,
          "user",
          "legacy_header",
        );
        setRequestAuth(req, {
          auth_type: "legacy_header",
          workspace_id,
          principal_id,
          principal_type: "user",
        });
        (req.headers as Record<string, unknown>)["x-workspace-id"] = workspace_id;
        (req.headers as Record<string, unknown>)["x-principal-id"] = principal_id;
        return;
      } finally {
        client.release();
      }
    }

    return reply.code(401).send({ error: "missing_bearer_token" });
  });

  await registerV1Routes(app, ctx.pool, ctx.config);

  async function runEmbeddedWorkerCycle(): Promise<void> {
    if (!embeddedWorkerEnabled || workerStopped || workerInFlight) return;
    workerInFlight = true;
    try {
      const result = await runQueuedRunsWorker(ctx.pool, {
        workspace_id: ctx.config.runWorkerWorkspaceId,
        batch_limit: ctx.config.runWorkerBatchLimit,
        logger: app.log,
      });
      if (result.claimed > 0 || result.failed > 0) {
        app.log.info(
          {
            source: "embedded_run_worker",
            workspace_id: result.workspace_id,
            scanned: result.scanned,
            claimed: result.claimed,
            completed: result.completed,
            failed: result.failed,
            skipped: result.skipped,
          },
          "embedded run worker cycle completed",
        );
      }
    } catch (err) {
      app.log.error({ err }, "embedded run worker cycle failed");
    } finally {
      workerInFlight = false;
    }
  }

  app.addHook("onReady", async () => {
    if (!embeddedWorkerEnabled) return;
    workerStopped = false;
    workerTimer = setInterval(() => {
      void runEmbeddedWorkerCycle();
    }, workerPollMs);
    void runEmbeddedWorkerCycle();
    app.log.info(
      {
        source: "embedded_run_worker",
        poll_ms: workerPollMs,
        workspace_id: ctx.config.runWorkerWorkspaceId,
        batch_limit: ctx.config.runWorkerBatchLimit,
      },
      "embedded run worker enabled",
    );
  });

  // Keep process lifecycle explicit.
  app.addHook("onClose", async () => {
    workerStopped = true;
    if (workerTimer) {
      clearInterval(workerTimer);
      workerTimer = undefined;
    }
    await ctx.pool.end();
  });

  return app;
}
