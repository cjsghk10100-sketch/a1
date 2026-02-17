import type { FastifyInstance } from "fastify";

import type { DbPool } from "../../db/pool.js";

function getHeaderString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function workspaceIdFromReq(req: { headers: Record<string, unknown> }): string {
  const raw = getHeaderString(req.headers["x-workspace-id"] as string | string[] | undefined);
  return raw?.trim() || "ws_dev";
}

export async function registerSearchRoutes(app: FastifyInstance, pool: DbPool): Promise<void> {
  app.get<{
    Querystring: { q?: string; room_id?: string; thread_id?: string; doc_type?: string; limit?: string };
  }>("/v1/search", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);

    const q = req.query.q?.trim() ?? "";
    if (q.length < 2) {
      return reply.code(400).send({ error: "q_too_short" });
    }

    const rawLimit = Number(req.query.limit ?? "20");
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(100, Math.floor(rawLimit))) : 20;

    const args: unknown[] = [workspace_id, `%${q}%`];
    let where = "workspace_id = $1 AND content_text ILIKE $2";

    const room_id = req.query.room_id?.trim() ?? "";
    if (room_id) {
      args.push(room_id);
      where += ` AND room_id = $${args.length}`;
    }

    const thread_id = req.query.thread_id?.trim() ?? "";
    if (thread_id) {
      args.push(thread_id);
      where += ` AND thread_id = $${args.length}`;
    }

    const doc_type = req.query.doc_type?.trim() ?? "";
    if (doc_type) {
      args.push(doc_type);
      where += ` AND doc_type = $${args.length}`;
    }

    args.push(limit);
    const res = await pool.query(
      `SELECT doc_id, workspace_id, room_id, thread_id, doc_type,
        LEFT(content_text, 280) AS content_text,
        lang, updated_at
      FROM proj_search_docs
      WHERE ${where}
      ORDER BY updated_at DESC
      LIMIT $${args.length}`,
      args,
    );

    return reply.code(200).send({ docs: res.rows });
  });
}

