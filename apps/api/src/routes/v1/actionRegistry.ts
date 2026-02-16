import type { FastifyInstance } from "fastify";

import type { DbPool } from "../../db/pool.js";

export async function registerActionRegistryRoutes(
  app: FastifyInstance,
  pool: DbPool,
): Promise<void> {
  app.get("/v1/action-registry", async () => {
    const res = await pool.query(
      `SELECT
        action_type,
        reversible,
        zone_required,
        requires_pre_approval,
        post_review_required,
        metadata,
        created_at,
        updated_at
      FROM sec_action_registry
      ORDER BY action_type ASC`,
    );

    return { actions: res.rows };
  });
}

