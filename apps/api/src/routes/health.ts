import type { FastifyInstance } from "fastify";

import { readHeartCronHealth } from "../cron/heartCron.js";
import type { DbPool } from "../db/pool.js";

export async function registerHealthRoutes(app: FastifyInstance, pool: DbPool): Promise<void> {
  app.get("/health", async () => {
    await pool.query("SELECT 1");
    try {
      const cron = await readHeartCronHealth(pool);
      return { ok: true, cron };
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "42P01") {
        return { ok: true, cron: null };
      }
      throw err;
    }
  });
}
