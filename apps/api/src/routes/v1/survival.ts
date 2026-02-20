import type { FastifyInstance } from "fastify";

import type { SurvivalLedgerRecordV1, SurvivalLedgerTargetType } from "@agentapp/shared";

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

function normalizeTargetType(raw: unknown): SurvivalLedgerTargetType | null {
  if (raw === "workspace" || raw === "agent") return raw;
  return null;
}

function normalizeOptionalString(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim();
  return v.length ? v : undefined;
}

export async function registerSurvivalRoutes(app: FastifyInstance, pool: DbPool): Promise<void> {
  app.get<{
    Querystring: { target_type?: string; target_id?: string; days?: string };
  }>("/v1/survival/ledger", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const days = parseDays(req.query.days);
    const target_type = normalizeTargetType(req.query.target_type);
    const target_id = normalizeOptionalString(req.query.target_id);

    if (req.query.target_type && !target_type) {
      return reply.code(400).send({ error: "invalid_target_type" });
    }
    if (req.query.target_id && !target_id) {
      return reply.code(400).send({ error: "invalid_target_id" });
    }
    if (target_id && !target_type) {
      return reply.code(400).send({ error: "missing_target_type" });
    }

    const args: unknown[] = [workspace_id];
    let where = "workspace_id = $1";

    if (target_type) {
      args.push(target_type);
      where += ` AND target_type = $${args.length}`;
    }

    if (target_id) {
      args.push(target_id);
      where += ` AND target_id = $${args.length}`;
    }

    args.push(days);

    const rows = await pool.query<SurvivalLedgerRecordV1>(
      `SELECT
         workspace_id,
         target_type,
         target_id,
         snapshot_date::text AS snapshot_date,
         success_count,
         failure_count,
         incident_opened_count,
         incident_closed_count,
         learning_count,
         repeated_mistakes_count,
         egress_requests_count,
         blocked_requests_count,
         estimated_cost_units,
         value_units,
         budget_cap_units,
         budget_utilization,
         survival_score,
         extras,
         created_at::text AS created_at,
         updated_at::text AS updated_at
       FROM sec_survival_ledger_daily
       WHERE ${where}
       ORDER BY snapshot_date DESC, target_type ASC, target_id ASC
       LIMIT $${args.length}`,
      args,
    );

    return reply.code(200).send({ ledgers: rows.rows });
  });

  app.get<{
    Params: { targetType: string; targetId: string };
    Querystring: { days?: string };
  }>("/v1/survival/ledger/:targetType/:targetId", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const target_type = normalizeTargetType(req.params.targetType);
    if (!target_type) return reply.code(400).send({ error: "invalid_target_type" });
    const target_id = normalizeOptionalString(req.params.targetId);
    if (!target_id) return reply.code(400).send({ error: "invalid_target_id" });
    const days = parseDays(req.query.days);

    const rows = await pool.query<SurvivalLedgerRecordV1>(
      `SELECT
         workspace_id,
         target_type,
         target_id,
         snapshot_date::text AS snapshot_date,
         success_count,
         failure_count,
         incident_opened_count,
         incident_closed_count,
         learning_count,
         repeated_mistakes_count,
         egress_requests_count,
         blocked_requests_count,
         estimated_cost_units,
         value_units,
         budget_cap_units,
         budget_utilization,
         survival_score,
         extras,
         created_at::text AS created_at,
         updated_at::text AS updated_at
       FROM sec_survival_ledger_daily
       WHERE workspace_id = $1
         AND target_type = $2
         AND target_id = $3
       ORDER BY snapshot_date DESC
       LIMIT $4`,
      [workspace_id, target_type, target_id, days],
    );

    return reply.code(200).send({ ledgers: rows.rows });
  });
}
