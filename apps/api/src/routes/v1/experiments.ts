import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import {
  newExperimentId,
  type ActorType,
  type ExperimentEventV1,
  type ExperimentRiskTier,
  type ExperimentStatus,
} from "@agentapp/shared";

import type { DbPool } from "../../db/pool.js";
import { appendToStream } from "../../eventStore/index.js";
import { applyExperimentEvent } from "../../projectors/experimentProjector.js";

type ExperimentContextRow = {
  experiment_id: string;
  workspace_id: string;
  room_id: string | null;
  status: ExperimentStatus;
  correlation_id: string;
  last_event_id: string | null;
};

function getHeaderString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function workspaceIdFromReq(req: { headers: Record<string, unknown> }): string {
  const raw = getHeaderString(req.headers["x-workspace-id"] as string | string[] | undefined);
  return raw?.trim() || "ws_dev";
}

function normalizeActorType(raw: unknown): ActorType {
  if (raw === "service" || raw === "agent") return raw;
  return "user";
}

function normalizeOptionalString(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  return value.length ? value : undefined;
}

function normalizeStatus(raw: unknown): ExperimentStatus | null {
  if (raw === "open" || raw === "closed" || raw === "stopped") return raw;
  return null;
}

function normalizeRiskTier(raw: unknown): ExperimentRiskTier | null {
  if (raw === "low" || raw === "medium" || raw === "high") return raw;
  return null;
}

function parseLimit(raw: unknown): number {
  const n = Number(raw ?? "50");
  if (!Number.isFinite(n)) return 50;
  return Math.max(1, Math.min(200, Math.floor(n)));
}

function toObject(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

async function ensureRoomInWorkspace(
  pool: DbPool,
  workspace_id: string,
  room_id: string | undefined,
): Promise<boolean> {
  if (!room_id) return true;
  const room = await pool.query<{ workspace_id: string }>(
    "SELECT workspace_id FROM proj_rooms WHERE room_id = $1",
    [room_id],
  );
  return room.rowCount === 1 && room.rows[0].workspace_id === workspace_id;
}

async function getExperimentContext(
  pool: DbPool,
  workspace_id: string,
  experiment_id: string,
): Promise<ExperimentContextRow | null> {
  const exp = await pool.query<ExperimentContextRow>(
    `SELECT experiment_id, workspace_id, room_id, status, correlation_id, last_event_id
     FROM proj_experiments
     WHERE workspace_id = $1
       AND experiment_id = $2`,
    [workspace_id, experiment_id],
  );
  if (exp.rowCount !== 1) return null;
  return exp.rows[0];
}

export async function registerExperimentRoutes(app: FastifyInstance, pool: DbPool): Promise<void> {
  app.post<{
    Body: {
      title?: string;
      hypothesis?: string;
      success_criteria?: Record<string, unknown>;
      stop_conditions?: Record<string, unknown>;
      budget_cap_units?: number;
      risk_tier?: ExperimentRiskTier;
      metadata?: Record<string, unknown>;
      room_id?: string;
      correlation_id?: string;
      actor_type?: ActorType;
      actor_id?: string;
    };
  }>("/v1/experiments", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const title = normalizeOptionalString(req.body.title);
    const hypothesis = normalizeOptionalString(req.body.hypothesis);
    if (!title) return reply.code(400).send({ error: "missing_title" });
    if (!hypothesis) return reply.code(400).send({ error: "missing_hypothesis" });

    const budget_cap_units = Number(req.body.budget_cap_units);
    if (!Number.isFinite(budget_cap_units) || budget_cap_units < 0) {
      return reply.code(400).send({ error: "invalid_budget_cap_units" });
    }

    const risk_tier = normalizeRiskTier(req.body.risk_tier);
    if (!risk_tier) return reply.code(400).send({ error: "invalid_risk_tier" });

    const room_id = normalizeOptionalString(req.body.room_id);
    if (!(await ensureRoomInWorkspace(pool, workspace_id, room_id))) {
      return reply.code(404).send({ error: "room_not_found" });
    }

    const experiment_id = newExperimentId();
    const occurred_at = new Date().toISOString();
    const actor_type = normalizeActorType(req.body.actor_type);
    const actor_id =
      normalizeOptionalString(req.body.actor_id) ?? (actor_type === "service" ? "api" : "ceo");
    const correlation_id = normalizeOptionalString(req.body.correlation_id) ?? randomUUID();
    const stream = room_id
      ? { stream_type: "room" as const, stream_id: room_id }
      : { stream_type: "workspace" as const, stream_id: workspace_id };

    const event = await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "experiment.created",
      event_version: 1,
      occurred_at,
      workspace_id,
      room_id,
      actor: { actor_type, actor_id },
      stream,
      correlation_id,
      data: {
        experiment_id,
        title,
        hypothesis,
        success_criteria: toObject(req.body.success_criteria),
        stop_conditions: toObject(req.body.stop_conditions),
        budget_cap_units,
        risk_tier,
        metadata: toObject(req.body.metadata),
      },
      policy_context: {},
      model_context: {},
      display: {},
    });
    await applyExperimentEvent(pool, event as ExperimentEventV1);
    return reply.code(201).send({ experiment_id });
  });

  app.get<{
    Querystring: { room_id?: string; status?: string; limit?: string };
  }>("/v1/experiments", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const room_id = normalizeOptionalString(req.query.room_id) ?? null;
    const status = normalizeStatus(req.query.status);
    if (req.query.status && !status) {
      return reply.code(400).send({ error: "invalid_status" });
    }
    const limit = parseLimit(req.query.limit);

    const args: unknown[] = [workspace_id];
    let where = "workspace_id = $1";
    if (room_id) {
      args.push(room_id);
      where += ` AND room_id = $${args.length}`;
    }
    if (status) {
      args.push(status);
      where += ` AND status = $${args.length}`;
    }
    args.push(limit);

    const rows = await pool.query(
      `SELECT
         experiment_id,
         workspace_id,
         room_id,
         status,
         title,
         hypothesis,
         success_criteria,
         stop_conditions,
         budget_cap_units,
         risk_tier,
         metadata,
         created_by_type,
         created_by_id,
         created_at,
         closed_at,
         updated_at,
         correlation_id,
         last_event_id
       FROM proj_experiments
       WHERE ${where}
       ORDER BY updated_at DESC
       LIMIT $${args.length}`,
      args,
    );
    return reply.code(200).send({ experiments: rows.rows });
  });

  app.get<{
    Params: { experimentId: string };
  }>("/v1/experiments/:experimentId", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const experiment = await pool.query(
      `SELECT
         experiment_id,
         workspace_id,
         room_id,
         status,
         title,
         hypothesis,
         success_criteria,
         stop_conditions,
         budget_cap_units,
         risk_tier,
         metadata,
         created_by_type,
         created_by_id,
         created_at,
         closed_at,
         updated_at,
         correlation_id,
         last_event_id
       FROM proj_experiments
       WHERE workspace_id = $1
         AND experiment_id = $2`,
      [workspace_id, req.params.experimentId],
    );
    if (experiment.rowCount !== 1) {
      return reply.code(404).send({ error: "experiment_not_found" });
    }
    return reply.code(200).send({ experiment: experiment.rows[0] });
  });

  app.post<{
    Params: { experimentId: string };
    Body: {
      title?: string;
      hypothesis?: string;
      success_criteria?: Record<string, unknown>;
      stop_conditions?: Record<string, unknown>;
      budget_cap_units?: number;
      risk_tier?: ExperimentRiskTier;
      metadata?: Record<string, unknown>;
      actor_type?: ActorType;
      actor_id?: string;
    };
  }>("/v1/experiments/:experimentId/update", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const context = await getExperimentContext(pool, workspace_id, req.params.experimentId);
    if (!context) return reply.code(404).send({ error: "experiment_not_found" });
    if (context.status !== "open") return reply.code(409).send({ error: "experiment_not_open" });

    const risk_tier =
      req.body.risk_tier == null ? undefined : normalizeRiskTier(req.body.risk_tier);
    if (req.body.risk_tier != null && !risk_tier) {
      return reply.code(400).send({ error: "invalid_risk_tier" });
    }

    let budget_cap_units: number | undefined;
    if (req.body.budget_cap_units != null) {
      const parsed = Number(req.body.budget_cap_units);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return reply.code(400).send({ error: "invalid_budget_cap_units" });
      }
      budget_cap_units = parsed;
    }

    const actor_type = normalizeActorType(req.body.actor_type);
    const actor_id =
      normalizeOptionalString(req.body.actor_id) ?? (actor_type === "service" ? "api" : "ceo");
    const occurred_at = new Date().toISOString();

    const event = await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "experiment.updated",
      event_version: 1,
      occurred_at,
      workspace_id,
      room_id: context.room_id ?? undefined,
      actor: { actor_type, actor_id },
      stream: context.room_id
        ? { stream_type: "room", stream_id: context.room_id }
        : { stream_type: "workspace", stream_id: workspace_id },
      correlation_id: context.correlation_id,
      causation_id: context.last_event_id ?? undefined,
      data: {
        experiment_id: context.experiment_id,
        title: normalizeOptionalString(req.body.title),
        hypothesis: normalizeOptionalString(req.body.hypothesis),
        success_criteria: req.body.success_criteria,
        stop_conditions: req.body.stop_conditions,
        budget_cap_units,
        risk_tier,
        metadata: req.body.metadata,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });
    await applyExperimentEvent(pool, event as ExperimentEventV1);
    return reply.code(200).send({ ok: true });
  });

  app.post<{
    Params: { experimentId: string };
    Body: {
      force?: boolean;
      reason?: string;
      actor_type?: ActorType;
      actor_id?: string;
    };
  }>("/v1/experiments/:experimentId/close", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const context = await getExperimentContext(pool, workspace_id, req.params.experimentId);
    if (!context) return reply.code(404).send({ error: "experiment_not_found" });
    if (context.status !== "open") return reply.code(409).send({ error: "experiment_not_open" });

    const force = req.body.force === true;
    const activeRuns = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM proj_runs
       WHERE workspace_id = $1
         AND experiment_id = $2
         AND status IN ('queued', 'running')`,
      [workspace_id, context.experiment_id],
    );
    const active_run_count = Number(activeRuns.rows[0]?.count ?? "0");
    if (!force && active_run_count > 0) {
      return reply.code(409).send({ error: "experiment_has_active_runs", active_run_count });
    }

    const status = (force && active_run_count > 0 ? "stopped" : "closed") as "closed" | "stopped";
    const actor_type = normalizeActorType(req.body.actor_type);
    const actor_id =
      normalizeOptionalString(req.body.actor_id) ?? (actor_type === "service" ? "api" : "ceo");
    const occurred_at = new Date().toISOString();

    const event = await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "experiment.closed",
      event_version: 1,
      occurred_at,
      workspace_id,
      room_id: context.room_id ?? undefined,
      actor: { actor_type, actor_id },
      stream: context.room_id
        ? { stream_type: "room", stream_id: context.room_id }
        : { stream_type: "workspace", stream_id: workspace_id },
      correlation_id: context.correlation_id,
      causation_id: context.last_event_id ?? undefined,
      data: {
        experiment_id: context.experiment_id,
        status,
        reason: normalizeOptionalString(req.body.reason),
        force,
        active_run_count,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });
    await applyExperimentEvent(pool, event as ExperimentEventV1);
    return reply.code(200).send({ ok: true, status, active_run_count });
  });
}
