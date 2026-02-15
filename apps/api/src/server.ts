import Fastify, { type FastifyInstance } from "fastify";

import type { AppConfig } from "./config.js";
import type { DbPool } from "./db/pool.js";
import { registerHealthRoutes } from "./routes/health.js";

export interface BuildContext {
  config: AppConfig;
  pool: DbPool;
}

export async function buildServer(ctx: BuildContext): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  await registerHealthRoutes(app, ctx.pool);

  // Keep process lifecycle explicit.
  app.addHook("onClose", async () => {
    await ctx.pool.end();
  });

  return app;
}
