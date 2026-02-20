import type { FastifyInstance } from "fastify";

import type {
  LifecycleState,
  LifecycleStateRecordV1,
  LifecycleTransitionRecordV1,
  SurvivalLedgerTargetType,
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

function parseLimit(raw: unknown, fallback = 50): number {
  const n = Number(raw ?? `${fallback}`);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(200, Math.floor(n)));
}

function normalizeTargetType(raw: unknown): SurvivalLedgerTargetType | null {
  if (raw === "workspace" || raw === "agent") return raw;
  return null;
}

function normalizeLifecycleState(raw: unknown): LifecycleState | null {
  if (raw === "active" || raw === "probation" || raw === "sunset") return raw;
  return null;
}

function normalizeOptionalString(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim();
  return v.length ? v : undefined;
}

export async function registerLifecycleRoutes(app: FastifyInstance, pool: DbPool): Promise<void> {
  app.get<{
    Querystring: { target_type?: string; state?: string; limit?: string };
  }>("/v1/lifecycle/states", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const target_type = normalizeTargetType(req.query.target_type);
    const state = normalizeLifecycleState(req.query.state);
    const limit = parseLimit(req.query.limit, 100);

    if (req.query.target_type && !target_type) {
      return reply.code(400).send({ error: "invalid_target_type" });
    }
    if (req.query.state && !state) {
      return reply.code(400).send({ error: "invalid_state" });
    }

    const args: unknown[] = [workspace_id];
    let where = "workspace_id = $1";

    if (target_type) {
      args.push(target_type);
      where += ` AND target_type = $${args.length}`;
    }
    if (state) {
      args.push(state);
      where += ` AND current_state = $${args.length}`;
    }
    args.push(limit);

    const rows = await pool.query<LifecycleStateRecordV1>(
      `SELECT
         workspace_id,
         target_type,
         target_id,
         current_state,
         recommended_state,
         last_snapshot_date::text AS last_snapshot_date,
         last_survival_score,
         last_budget_utilization,
         consecutive_healthy_days,
         consecutive_risky_days,
         metadata,
         created_at::text AS created_at,
         updated_at::text AS updated_at,
         last_transition_at::text AS last_transition_at,
         last_event_id
       FROM sec_lifecycle_states
       WHERE ${where}
       ORDER BY updated_at DESC
       LIMIT $${args.length}`,
      args,
    );

    return reply.code(200).send({ states: rows.rows });
  });

  app.get<{
    Params: { targetType: string; targetId: string };
    Querystring: { limit?: string };
  }>("/v1/lifecycle/states/:targetType/:targetId", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const target_type = normalizeTargetType(req.params.targetType);
    const target_id = normalizeOptionalString(req.params.targetId);
    if (!target_type) return reply.code(400).send({ error: "invalid_target_type" });
    if (!target_id) return reply.code(400).send({ error: "invalid_target_id" });
    const limit = parseLimit(req.query.limit, 50);

    const stateRow = await pool.query<LifecycleStateRecordV1>(
      `SELECT
         workspace_id,
         target_type,
         target_id,
         current_state,
         recommended_state,
         last_snapshot_date::text AS last_snapshot_date,
         last_survival_score,
         last_budget_utilization,
         consecutive_healthy_days,
         consecutive_risky_days,
         metadata,
         created_at::text AS created_at,
         updated_at::text AS updated_at,
         last_transition_at::text AS last_transition_at,
         last_event_id
       FROM sec_lifecycle_states
       WHERE workspace_id = $1
         AND target_type = $2
         AND target_id = $3`,
      [workspace_id, target_type, target_id],
    );
    if (stateRow.rowCount !== 1) {
      return reply.code(404).send({ error: "lifecycle_state_not_found" });
    }

    const transitions = await pool.query<LifecycleTransitionRecordV1>(
      `SELECT
         transition_id,
         workspace_id,
         target_type,
         target_id,
         from_state,
         to_state,
         recommended_state,
         reason_codes,
         snapshot_date::text AS snapshot_date,
         survival_score,
         budget_utilization,
         correlation_id,
         event_id,
         metadata,
         created_at::text AS created_at
       FROM sec_lifecycle_transitions
       WHERE workspace_id = $1
         AND target_type = $2
         AND target_id = $3
       ORDER BY created_at DESC
       LIMIT $4`,
      [workspace_id, target_type, target_id, limit],
    );

    return reply.code(200).send({
      state: stateRow.rows[0],
      transitions: transitions.rows,
    });
  });
}
