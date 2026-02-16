import type { FastifyInstance } from "fastify";

import {
  ResourceLabel,
  type ResourceLabel as ResourceLabelValue,
  type ListResourceLabelsResponseV1,
  type UpsertResourceLabelRequestV1,
  type UpsertResourceLabelResponseV1,
} from "@agentapp/shared";

import type { DbPool } from "../../db/pool.js";

function getHeaderString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function workspaceIdFromReq(req: { headers: Record<string, unknown> }): string {
  const raw = getHeaderString(req.headers["x-workspace-id"] as string | string[] | undefined);
  return raw?.trim() || "ws_dev";
}

function normalizeRequiredString(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return v.length ? v : null;
}

function normalizeOptionalString(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim();
  return v.length ? v : undefined;
}

function normalizeLabel(raw: unknown): ResourceLabelValue | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  const allowed = new Set<string>(Object.values(ResourceLabel));
  return allowed.has(v) ? (v as ResourceLabelValue) : null;
}

function normalizePurposeTags(raw: unknown): string[] | null {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return null;
  const out = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") return null;
    const v = item.trim();
    if (!v) continue;
    out.add(v);
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

function parseLimit(raw: unknown): number {
  const n = Number(raw ?? "100");
  if (!Number.isFinite(n)) return 100;
  return Math.max(1, Math.min(200, Math.floor(n)));
}

export async function registerResourceLabelRoutes(
  app: FastifyInstance,
  pool: DbPool,
): Promise<void> {
  app.post<{
    Body: UpsertResourceLabelRequestV1;
  }>("/v1/resources/labels", async (req, reply): Promise<UpsertResourceLabelResponseV1> => {
    const workspace_id = workspaceIdFromReq(req);
    const resource_type = normalizeRequiredString(req.body.resource_type);
    const resource_id = normalizeRequiredString(req.body.resource_id);
    const label = normalizeLabel(req.body.label);
    const room_id = normalizeOptionalString(req.body.room_id) ?? null;
    const purpose_tags = normalizePurposeTags(req.body.purpose_tags);

    if (!resource_type || !resource_id) return reply.code(400).send({ error: "invalid_resource" });
    if (!label) return reply.code(400).send({ error: "invalid_label" });
    if (purpose_tags === null) return reply.code(400).send({ error: "invalid_purpose_tags" });

    const upsert = await pool.query<{
      workspace_id: string;
      resource_type: string;
      resource_id: string;
      label: ResourceLabelValue;
      room_id: string | null;
      purpose_tags: string[];
      created_at: string;
      updated_at: string;
    }>(
      `INSERT INTO sec_resource_labels (
         workspace_id,
         resource_type,
         resource_id,
         label,
         room_id,
         purpose_tags
       ) VALUES (
         $1,$2,$3,$4,$5,$6
       )
       ON CONFLICT (workspace_id, resource_type, resource_id)
       DO UPDATE SET
         label = EXCLUDED.label,
         room_id = EXCLUDED.room_id,
         purpose_tags = EXCLUDED.purpose_tags,
         updated_at = now()
       RETURNING
         workspace_id,
         resource_type,
         resource_id,
         label,
         room_id,
         purpose_tags,
         created_at::text AS created_at,
         updated_at::text AS updated_at`,
      [workspace_id, resource_type, resource_id, label, room_id, purpose_tags],
    );

    return reply.code(201).send({ label: upsert.rows[0] });
  });

  app.get<{
    Querystring: { limit?: string };
  }>("/v1/resources/labels", async (req, reply): Promise<ListResourceLabelsResponseV1> => {
    const workspace_id = workspaceIdFromReq(req);
    const limit = parseLimit(req.query.limit);

    const rows = await pool.query(
      `SELECT
         workspace_id,
         resource_type,
         resource_id,
         label,
         room_id,
         purpose_tags,
         created_at::text AS created_at,
         updated_at::text AS updated_at
       FROM sec_resource_labels
       WHERE workspace_id = $1
       ORDER BY updated_at DESC
       LIMIT $2`,
      [workspace_id, limit],
    );

    return reply.code(200).send({ labels: rows.rows });
  });
}

