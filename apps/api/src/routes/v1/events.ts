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

function parseLimit(raw: unknown): number {
  const n = Number(raw ?? "100");
  if (!Number.isFinite(n)) return 100;
  return Math.max(1, Math.min(200, Math.floor(n)));
}

function parseSeq(raw: unknown): number {
  const n = Number(raw ?? "0");
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function parseTimestamp(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== "string") return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function normalizeStreamType(raw: unknown): "room" | "thread" | "workspace" | null {
  return raw === "room" || raw === "thread" || raw === "workspace" ? raw : null;
}

function normalizeId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return v.length ? v : null;
}

export async function registerEventRoutes(app: FastifyInstance, pool: DbPool): Promise<void> {
  app.get<{
    Querystring: {
      stream_type?: string;
      stream_id?: string;
      from_seq?: string;
      limit?: string;

      room_id?: string;
      thread_id?: string;
      run_id?: string;
      step_id?: string;
      correlation_id?: string;
      event_type?: string;

      before_recorded_at?: string;
    };
  }>("/v1/events", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const limit = parseLimit(req.query.limit);

    const stream_type = normalizeStreamType(req.query.stream_type);
    const stream_id = normalizeId(req.query.stream_id);
    const from_seq = parseSeq(req.query.from_seq);

    if ((stream_type && !stream_id) || (!stream_type && stream_id)) {
      return reply.code(400).send({ error: "stream_type_and_stream_id_required_together" });
    }

    const before_recorded_at = parseTimestamp(req.query.before_recorded_at);
    if (req.query.before_recorded_at && !before_recorded_at) {
      return reply.code(400).send({ error: "invalid_before_recorded_at" });
    }

    const args: unknown[] = [workspace_id];
    let where = "workspace_id = $1";

    if (stream_type && stream_id) {
      args.push(stream_type, stream_id, from_seq);
      where += ` AND stream_type = $${args.length - 2} AND stream_id = $${args.length - 1} AND stream_seq > $${args.length}`;
    }

    const room_id = normalizeId(req.query.room_id);
    if (room_id) {
      args.push(room_id);
      where += ` AND room_id = $${args.length}`;
    }

    const thread_id = normalizeId(req.query.thread_id);
    if (thread_id) {
      args.push(thread_id);
      where += ` AND thread_id = $${args.length}`;
    }

    const run_id = normalizeId(req.query.run_id);
    if (run_id) {
      args.push(run_id);
      where += ` AND run_id = $${args.length}`;
    }

    const step_id = normalizeId(req.query.step_id);
    if (step_id) {
      args.push(step_id);
      where += ` AND step_id = $${args.length}`;
    }

    const correlation_id = normalizeId(req.query.correlation_id);
    if (correlation_id) {
      args.push(correlation_id);
      where += ` AND correlation_id = $${args.length}`;
    }

    const event_type = normalizeId(req.query.event_type);
    if (event_type) {
      args.push(event_type);
      where += ` AND event_type = $${args.length}`;
    }

    if (before_recorded_at) {
      args.push(before_recorded_at);
      where += ` AND recorded_at < $${args.length}`;
    }

    args.push(limit);

    const res = await pool.query<{
      event_id: string;
      event_type: string;
      event_version: number;
      occurred_at: string;
      recorded_at: string;
      workspace_id: string;
      mission_id: string | null;
      room_id: string | null;
      thread_id: string | null;
      actor_type: string;
      actor_id: string;
      actor_principal_id: string | null;
      zone: string;
      run_id: string | null;
      step_id: string | null;
      stream_type: string;
      stream_id: string;
      stream_seq: string;
      correlation_id: string;
      causation_id: string | null;
      redaction_level: string;
      contains_secrets: boolean;
      data: unknown;
    }>(
      `SELECT
        event_id,
        event_type,
        event_version,
        occurred_at,
        recorded_at,
        workspace_id,
        mission_id,
        room_id,
        thread_id,
        actor_type,
        actor_id,
        actor_principal_id,
        zone,
        run_id,
        step_id,
        stream_type,
        stream_id,
        stream_seq,
        correlation_id,
        causation_id,
        redaction_level,
        contains_secrets,
        data
      FROM evt_events
      WHERE ${where}
      ORDER BY recorded_at ASC, stream_seq ASC
      LIMIT $${args.length}`,
      args,
    );

    const events = res.rows.map((row) => {
      const streamSeq = Number(row.stream_seq);
      return {
        ...row,
        stream_seq: Number.isFinite(streamSeq) ? streamSeq : 0,
      };
    });

    return reply.code(200).send({ events });
  });

  app.get<{
    Params: { eventId: string };
  }>("/v1/events/:eventId", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);

    const res = await pool.query<{
      event_id: string;
      event_type: string;
      event_version: number;
      occurred_at: string;
      recorded_at: string;
      workspace_id: string;
      mission_id: string | null;
      room_id: string | null;
      thread_id: string | null;
      actor_type: string;
      actor_id: string;
      actor_principal_id: string | null;
      zone: string;
      run_id: string | null;
      step_id: string | null;
      stream_type: string;
      stream_id: string;
      stream_seq: string;
      correlation_id: string;
      causation_id: string | null;
      redaction_level: string;
      contains_secrets: boolean;
      policy_context: unknown;
      model_context: unknown;
      display: unknown;
      data: unknown;
      idempotency_key: string | null;
    }>(
      `SELECT
        event_id,
        event_type,
        event_version,
        occurred_at,
        recorded_at,
        workspace_id,
        mission_id,
        room_id,
        thread_id,
        actor_type,
        actor_id,
        actor_principal_id,
        zone,
        run_id,
        step_id,
        stream_type,
        stream_id,
        stream_seq,
        correlation_id,
        causation_id,
        redaction_level,
        contains_secrets,
        policy_context,
        model_context,
        display,
        data,
        idempotency_key
      FROM evt_events
      WHERE event_id = $1
        AND workspace_id = $2`,
      [req.params.eventId, workspace_id],
    );

    if (res.rowCount !== 1) {
      return reply.code(404).send({ error: "event_not_found" });
    }

    const row = res.rows[0];
    const streamSeq = Number(row.stream_seq);

    return reply.code(200).send({
      event: {
        ...row,
        stream_seq: Number.isFinite(streamSeq) ? streamSeq : 0,
      },
    });
  });
}
