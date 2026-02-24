import type { FastifyInstance } from "fastify";

import { finalizeRunEvidenceManifest, getEvidenceManifestByRunId, EvidenceManifestError } from "../../evidence/manifest.js";
import type { DbPool } from "../../db/pool.js";

function getHeaderString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function workspaceIdFromReq(req: { headers: Record<string, unknown> }): string {
  const raw = getHeaderString(req.headers["x-workspace-id"] as string | string[] | undefined);
  return raw?.trim() || "ws_dev";
}

export async function registerEvidenceRoutes(app: FastifyInstance, pool: DbPool): Promise<void> {
  app.get<{
    Params: { runId: string };
  }>("/v1/runs/:runId/evidence", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const evidence = await getEvidenceManifestByRunId(pool, {
      workspace_id,
      run_id: req.params.runId,
    });
    if (!evidence) {
      return reply.code(404).send({ error: "evidence_not_found" });
    }
    return reply.code(200).send({ evidence });
  });

  app.post<{
    Params: { runId: string };
  }>("/v1/runs/:runId/evidence/finalize", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    try {
      const result = await finalizeRunEvidenceManifest(pool, {
        workspace_id,
        run_id: req.params.runId,
        actor: { actor_type: "service", actor_id: "api" },
      });
      return reply.code(result.created ? 201 : 200).send(result);
    } catch (err) {
      if (err instanceof EvidenceManifestError) {
        return reply.code(err.statusCode).send({ error: err.code });
      }
      throw err;
    }
  });
}
