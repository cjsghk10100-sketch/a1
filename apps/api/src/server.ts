import Fastify, { type FastifyInstance } from "fastify";

import type { AppConfig } from "./config.js";
import type { DbPool } from "./db/pool.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerV1Routes } from "./routes/v1/index.js";
import { runQueuedRunsWorker } from "./runtime/runWorker.js";

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

  await registerHealthRoutes(app, ctx.pool);
  await registerV1Routes(app, ctx.pool);

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
