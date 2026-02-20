import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import {
  newIncidentId,
  type ActorType,
  type IncidentEventV1,
  type IncidentSeverity,
  type IncidentStatus,
} from "@agentapp/shared";

import type { DbPool } from "../../db/pool.js";
import { appendToStream } from "../../eventStore/index.js";
import { applyIncidentEvent } from "../../projectors/incidentProjector.js";

type IncidentContextRow = {
  incident_id: string;
  workspace_id: string;
  room_id: string | null;
  thread_id: string | null;
  run_id: string | null;
  status: IncidentStatus;
  correlation_id: string;
  last_event_id: string | null;
  rca_updated_at: string | null;
  learning_count: number;
};

type RunContextRow = {
  run_id: string;
  workspace_id: string;
  room_id: string | null;
  thread_id: string | null;
  correlation_id: string;
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
  const v = raw.trim();
  return v.length ? v : undefined;
}

function normalizeSeverity(raw: unknown): IncidentSeverity | undefined {
  if (raw === "low" || raw === "medium" || raw === "high" || raw === "critical") return raw;
  return undefined;
}

function normalizeIncidentStatus(raw: unknown): IncidentStatus | null {
  if (raw === "open" || raw === "closed") return raw;
  return null;
}

function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const tags = new Set<string>();
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const trimmed = v.trim();
    if (!trimmed) continue;
    tags.add(trimmed);
  }
  return [...tags];
}

function parseLimit(raw: unknown): number {
  const n = Number(raw ?? "50");
  if (!Number.isFinite(n)) return 50;
  return Math.max(1, Math.min(200, Math.floor(n)));
}

function normalizeRcaPayload(summary: string | undefined, analysis: unknown): Record<string, unknown> {
  const out: Record<string, unknown> =
    analysis && typeof analysis === "object" && !Array.isArray(analysis)
      ? { ...(analysis as Record<string, unknown>) }
      : {};

  if (summary) out.summary = summary;
  return out;
}

async function getRunContext(pool: DbPool, run_id: string): Promise<RunContextRow | null> {
  const res = await pool.query<RunContextRow>(
    `SELECT run_id, workspace_id, room_id, thread_id, correlation_id
     FROM proj_runs
     WHERE run_id = $1`,
    [run_id],
  );
  if (res.rowCount !== 1) return null;
  return res.rows[0];
}

async function getIncidentContext(pool: DbPool, incident_id: string): Promise<IncidentContextRow | null> {
  const res = await pool.query<IncidentContextRow>(
    `SELECT
       incident_id,
       workspace_id,
       room_id,
       thread_id,
       run_id,
       status,
       correlation_id,
       last_event_id,
       rca_updated_at,
       learning_count
     FROM proj_incidents
     WHERE incident_id = $1`,
    [incident_id],
  );
  if (res.rowCount !== 1) return null;
  return res.rows[0];
}

async function validateRoomWorkspace(
  pool: DbPool,
  workspace_id: string,
  room_id: string | undefined,
): Promise<boolean> {
  if (!room_id) return true;
  const room = await pool.query<{ workspace_id: string }>(
    "SELECT workspace_id FROM proj_rooms WHERE room_id = $1",
    [room_id],
  );
  if (room.rowCount !== 1) return false;
  return room.rows[0].workspace_id === workspace_id;
}

async function validateThreadWorkspace(
  pool: DbPool,
  workspace_id: string,
  thread_id: string | undefined,
  room_id: string | undefined,
): Promise<boolean> {
  if (!thread_id) return true;
  const thread = await pool.query<{ workspace_id: string; room_id: string }>(
    "SELECT workspace_id, room_id FROM proj_threads WHERE thread_id = $1",
    [thread_id],
  );
  if (thread.rowCount !== 1) return false;
  if (thread.rows[0].workspace_id !== workspace_id) return false;
  if (room_id && thread.rows[0].room_id !== room_id) return false;
  return true;
}

export async function registerIncidentRoutes(app: FastifyInstance, pool: DbPool): Promise<void> {
  app.post<{
    Body: {
      title: string;
      summary?: string;
      severity?: IncidentSeverity;
      room_id?: string;
      thread_id?: string;
      run_id?: string;
      correlation_id?: string;
      actor_type?: ActorType;
      actor_id?: string;
    };
  }>("/v1/incidents", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const title = normalizeOptionalString(req.body.title);
    if (!title) return reply.code(400).send({ error: "missing_title" });

    const summary = normalizeOptionalString(req.body.summary);
    const severity = normalizeSeverity(req.body.severity);
    if (req.body.severity && !severity) {
      return reply.code(400).send({ error: "invalid_severity" });
    }

    let run_id = normalizeOptionalString(req.body.run_id);
    let room_id = normalizeOptionalString(req.body.room_id);
    let thread_id = normalizeOptionalString(req.body.thread_id);
    let correlation_id = normalizeOptionalString(req.body.correlation_id);

    if (run_id) {
      const run = await getRunContext(pool, run_id);
      if (!run || run.workspace_id !== workspace_id) {
        return reply.code(404).send({ error: "run_not_found" });
      }
      if (room_id && run.room_id && room_id !== run.room_id) {
        return reply.code(400).send({ error: "run_room_mismatch" });
      }
      if (thread_id && run.thread_id && thread_id !== run.thread_id) {
        return reply.code(400).send({ error: "run_thread_mismatch" });
      }

      room_id = room_id ?? run.room_id ?? undefined;
      thread_id = thread_id ?? run.thread_id ?? undefined;
      correlation_id = correlation_id ?? run.correlation_id;
    }

    if (!(await validateRoomWorkspace(pool, workspace_id, room_id))) {
      return reply.code(404).send({ error: "room_not_found" });
    }
    if (!(await validateThreadWorkspace(pool, workspace_id, thread_id, room_id))) {
      return reply.code(404).send({ error: "thread_not_found" });
    }

    const actor_type = normalizeActorType(req.body.actor_type);
    const actor_id = normalizeOptionalString(req.body.actor_id) ?? (actor_type === "service" ? "api" : "ceo");

    const incident_id = newIncidentId();
    const occurred_at = new Date().toISOString();
    const event = await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "incident.opened",
      event_version: 1,
      occurred_at,
      workspace_id,
      room_id,
      thread_id,
      run_id,
      actor: { actor_type, actor_id },
      stream:
        room_id != null
          ? { stream_type: "room", stream_id: room_id }
          : { stream_type: "workspace", stream_id: workspace_id },
      correlation_id: correlation_id ?? randomUUID(),
      data: {
        incident_id,
        title,
        summary,
        severity,
        run_id,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });

    await applyIncidentEvent(pool, event as IncidentEventV1);
    return reply.code(201).send({ incident_id });
  });

  app.get<{
    Querystring: { room_id?: string; status?: string; limit?: string };
  }>("/v1/incidents", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const room_id = normalizeOptionalString(req.query.room_id);
    const status = normalizeIncidentStatus(req.query.status);
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

    const incidents = await pool.query(
      `SELECT
         incident_id,
         workspace_id, room_id, thread_id, run_id,
         status, title, summary, severity,
         rca, rca_updated_at, learning_count, closed_reason,
         created_by_type, created_by_id,
         created_at, closed_at, updated_at,
         correlation_id, last_event_id
       FROM proj_incidents
       WHERE ${where}
       ORDER BY updated_at DESC
       LIMIT $${args.length}`,
      args,
    );

    return reply.code(200).send({ incidents: incidents.rows });
  });

  app.get<{
    Params: { incidentId: string };
  }>("/v1/incidents/:incidentId", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const incident = await pool.query(
      `SELECT
         incident_id,
         workspace_id, room_id, thread_id, run_id,
         status, title, summary, severity,
         rca, rca_updated_at, learning_count, closed_reason,
         created_by_type, created_by_id,
         created_at, closed_at, updated_at,
         correlation_id, last_event_id
       FROM proj_incidents
       WHERE incident_id = $1
         AND workspace_id = $2`,
      [req.params.incidentId, workspace_id],
    );
    if (incident.rowCount !== 1) {
      return reply.code(404).send({ error: "incident_not_found" });
    }

    const learning = await pool.query(
      `SELECT
         learning_id, incident_id,
         workspace_id, room_id, run_id,
         note, tags,
         created_by_type, created_by_id,
         created_at, last_event_id
       FROM proj_incident_learning
       WHERE incident_id = $1
       ORDER BY created_at ASC`,
      [req.params.incidentId],
    );

    return reply.code(200).send({ incident: incident.rows[0], learning: learning.rows });
  });

  app.post<{
    Params: { incidentId: string };
    Body: {
      summary?: string;
      analysis?: Record<string, unknown>;
      actor_type?: ActorType;
      actor_id?: string;
    };
  }>("/v1/incidents/:incidentId/rca", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const incident = await getIncidentContext(pool, req.params.incidentId);
    if (!incident || incident.workspace_id !== workspace_id) {
      return reply.code(404).send({ error: "incident_not_found" });
    }
    if (incident.status === "closed") {
      return reply.code(409).send({ error: "incident_closed" });
    }

    const summary = normalizeOptionalString(req.body.summary);
    const rca = normalizeRcaPayload(summary, req.body.analysis);
    if (Object.keys(rca).length === 0) {
      return reply.code(400).send({ error: "missing_rca_payload" });
    }

    const actor_type = normalizeActorType(req.body.actor_type);
    const actor_id = normalizeOptionalString(req.body.actor_id) ?? (actor_type === "service" ? "api" : "ceo");
    const occurred_at = new Date().toISOString();

    const event = await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "incident.rca.updated",
      event_version: 1,
      occurred_at,
      workspace_id: incident.workspace_id,
      room_id: incident.room_id ?? undefined,
      thread_id: incident.thread_id ?? undefined,
      run_id: incident.run_id ?? undefined,
      actor: { actor_type, actor_id },
      stream:
        incident.room_id != null
          ? { stream_type: "room", stream_id: incident.room_id }
          : { stream_type: "workspace", stream_id: incident.workspace_id },
      correlation_id: incident.correlation_id,
      causation_id: incident.last_event_id ?? undefined,
      data: {
        incident_id: incident.incident_id,
        rca,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });

    await applyIncidentEvent(pool, event as IncidentEventV1);
    return reply.code(200).send({ ok: true });
  });

  app.post<{
    Params: { incidentId: string };
    Body: {
      note: string;
      tags?: string[];
      actor_type?: ActorType;
      actor_id?: string;
    };
  }>("/v1/incidents/:incidentId/learning", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const incident = await getIncidentContext(pool, req.params.incidentId);
    if (!incident || incident.workspace_id !== workspace_id) {
      return reply.code(404).send({ error: "incident_not_found" });
    }
    if (incident.status === "closed") {
      return reply.code(409).send({ error: "incident_closed" });
    }

    const note = normalizeOptionalString(req.body.note);
    if (!note) return reply.code(400).send({ error: "missing_note" });
    const tags = normalizeTags(req.body.tags);

    const actor_type = normalizeActorType(req.body.actor_type);
    const actor_id = normalizeOptionalString(req.body.actor_id) ?? (actor_type === "service" ? "api" : "ceo");
    const occurred_at = new Date().toISOString();
    const learning_id = `learn_${randomUUID().replaceAll("-", "")}`;

    const event = await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "incident.learning.logged",
      event_version: 1,
      occurred_at,
      workspace_id: incident.workspace_id,
      room_id: incident.room_id ?? undefined,
      thread_id: incident.thread_id ?? undefined,
      run_id: incident.run_id ?? undefined,
      actor: { actor_type, actor_id },
      stream:
        incident.room_id != null
          ? { stream_type: "room", stream_id: incident.room_id }
          : { stream_type: "workspace", stream_id: incident.workspace_id },
      correlation_id: incident.correlation_id,
      causation_id: incident.last_event_id ?? undefined,
      data: {
        incident_id: incident.incident_id,
        learning_id,
        note,
        tags,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });

    await applyIncidentEvent(pool, event as IncidentEventV1);
    return reply.code(201).send({ learning_id });
  });

  app.post<{
    Params: { incidentId: string };
    Body: {
      reason?: string;
      actor_type?: ActorType;
      actor_id?: string;
    };
  }>("/v1/incidents/:incidentId/close", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const incident = await getIncidentContext(pool, req.params.incidentId);
    if (!incident || incident.workspace_id !== workspace_id) {
      return reply.code(404).send({ error: "incident_not_found" });
    }
    if (incident.status === "closed") {
      return reply.code(409).send({ error: "incident_already_closed" });
    }
    if (!incident.rca_updated_at) {
      return reply.code(409).send({ error: "incident_close_blocked_missing_rca" });
    }
    if (incident.learning_count < 1) {
      return reply.code(409).send({ error: "incident_close_blocked_missing_learning" });
    }

    const actor_type = normalizeActorType(req.body.actor_type);
    const actor_id = normalizeOptionalString(req.body.actor_id) ?? (actor_type === "service" ? "api" : "ceo");
    const occurred_at = new Date().toISOString();
    const reason = normalizeOptionalString(req.body.reason);

    const event = await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "incident.closed",
      event_version: 1,
      occurred_at,
      workspace_id: incident.workspace_id,
      room_id: incident.room_id ?? undefined,
      thread_id: incident.thread_id ?? undefined,
      run_id: incident.run_id ?? undefined,
      actor: { actor_type, actor_id },
      stream:
        incident.room_id != null
          ? { stream_type: "room", stream_id: incident.room_id }
          : { stream_type: "workspace", stream_id: incident.workspace_id },
      correlation_id: incident.correlation_id,
      causation_id: incident.last_event_id ?? undefined,
      data: {
        incident_id: incident.incident_id,
        reason,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });

    await applyIncidentEvent(pool, event as IncidentEventV1);
    return reply.code(200).send({ ok: true });
  });
}
