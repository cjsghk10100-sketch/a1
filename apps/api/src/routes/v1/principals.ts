import type { FastifyInstance } from "fastify";

import type { DbPool } from "../../db/pool.js";
import { ensurePrincipalForLegacyActor } from "../../security/principals.js";

function getHeaderString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function workspaceIdFromReq(req: { headers: Record<string, unknown> }): string {
  const raw = getHeaderString(req.headers["x-workspace-id"] as string | string[] | undefined);
  return raw?.trim() || "ws_dev";
}

type LegacyActorType = "user" | "service" | "agent";

function normalizeLegacyActorType(raw: unknown): LegacyActorType | null {
  return raw === "service" || raw === "user" || raw === "agent" ? raw : null;
}

function normalizeId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return v.length ? v : null;
}

export async function registerPrincipalRoutes(app: FastifyInstance, pool: DbPool): Promise<void> {
  app.post<{
    Body: { actor_type: LegacyActorType; actor_id: string };
  }>("/v1/principals/legacy/ensure", async (req, reply) => {
    // Workspace header is currently optional for this endpoint; we still parse it
    // to keep request handling consistent (and to make future scoping easier).
    workspaceIdFromReq(req);

    const actor_type = normalizeLegacyActorType(req.body.actor_type);
    const actor_id = normalizeId(req.body.actor_id);
    if (!actor_type) return reply.code(400).send({ error: "invalid_actor_type" });
    if (!actor_id) return reply.code(400).send({ error: "invalid_actor_id" });

    const client = await pool.connect();
    try {
      const principal_id = await ensurePrincipalForLegacyActor(client, actor_type, actor_id);
      const row = await client.query<{
        principal_id: string;
        principal_type: string;
        legacy_actor_type: string | null;
        legacy_actor_id: string | null;
        revoked_at: string | null;
        created_at: string;
      }>(
        `SELECT
           principal_id,
           principal_type,
           legacy_actor_type,
           legacy_actor_id,
           revoked_at::text AS revoked_at,
           created_at::text AS created_at
         FROM sec_principals
         WHERE principal_id = $1`,
        [principal_id],
      );

      if (row.rowCount !== 1) return reply.code(500).send({ error: "principal_not_found_after_ensure" });
      if (row.rows[0].revoked_at) return reply.code(409).send({ error: "principal_revoked" });

      return reply.code(200).send({
        principal: {
          principal_id: row.rows[0].principal_id,
          principal_type: row.rows[0].principal_type,
          legacy_actor_type: row.rows[0].legacy_actor_type,
          legacy_actor_id: row.rows[0].legacy_actor_id,
          created_at: row.rows[0].created_at,
        },
      });
    } finally {
      client.release();
    }
  });
}
