import type { FastifyInstance } from "fastify";

import type { DbPool } from "../db/pool.js";

export async function registerHealthRoutes(app: FastifyInstance, pool: DbPool): Promise<void> {
  app.get("/health", async () => {
    await pool.query("SELECT 1");
    return { ok: true };
  });
}
