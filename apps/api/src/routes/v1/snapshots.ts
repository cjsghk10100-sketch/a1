import type { FastifyInstance } from "fastify";

import type { DailyAgentSnapshotRecordV1 } from "@agentapp/shared";

import type { DbPool } from "../../db/pool.js";

function getHeaderString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function workspaceIdFromReq(req: { headers: Record<string, unknown> }): string {
  const raw = getHeaderString(req.headers["x-workspace-id"] as string | string[] | undefined);
  return raw?.trim() || "ws_dev";
}

function parseDays(raw: unknown): number {
  const n = Number(raw ?? "30");
  if (!Number.isFinite(n)) return 30;
  return Math.max(1, Math.min(365, Math.floor(n)));
}

export async function registerSnapshotRoutes(app: FastifyInstance, pool: DbPool): Promise<void> {
  app.get<{
    Params: { agentId: string };
    Querystring: { days?: string };
  }>("/v1/agents/:agentId/snapshots", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const days = parseDays(req.query.days);

    const rows = await pool.query<DailyAgentSnapshotRecordV1>(
      `SELECT
         workspace_id,
         agent_id,
         snapshot_date::text AS snapshot_date,
         trust_score,
         autonomy_rate_7d,
         new_skills_learned_7d,
         constraints_learned_7d,
         repeated_mistakes_7d,
         extras,
         created_at::text AS created_at,
         updated_at::text AS updated_at
       FROM sec_daily_agent_snapshots
       WHERE workspace_id = $1
         AND agent_id = $2
       ORDER BY snapshot_date DESC
       LIMIT $3`,
      [workspace_id, req.params.agentId, days],
    );

    return reply.code(200).send({ snapshots: rows.rows });
  });
}
