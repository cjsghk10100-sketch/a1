import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import { newRunId, newStepId, type RunEventV1, type RunStatus } from "@agentapp/shared";

import type { DbPool } from "../../db/pool.js";
import { appendToStream } from "../../eventStore/index.js";
import { applyRunEvent } from "../../projectors/runProjector.js";

function getHeaderString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function workspaceIdFromReq(req: { headers: Record<string, unknown> }): string {
  const raw = getHeaderString(req.headers["x-workspace-id"] as string | string[] | undefined);
  return raw?.trim() || "ws_dev";
}

function normalizeRunStatus(raw: unknown): RunStatus | null {
  return raw === "queued" || raw === "running" || raw === "succeeded" || raw === "failed"
    ? raw
    : null;
}

export async function registerRunRoutes(app: FastifyInstance, pool: DbPool): Promise<void> {
  app.post<{
    Body: {
      room_id: string;
      thread_id?: string;
      title?: string;
      goal?: string;
      input?: Record<string, unknown>;
      tags?: string[];
      correlation_id?: string;
    };
  }>("/v1/runs", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);

    const room_id = req.body.room_id?.trim();
    if (!room_id) return reply.code(400).send({ error: "missing_room_id" });

    const room = await pool.query<{ workspace_id: string }>(
      "SELECT workspace_id FROM proj_rooms WHERE room_id = $1",
      [room_id],
    );
    if (room.rowCount !== 1) {
      return reply.code(404).send({ error: "room_not_found" });
    }

    if (room.rows[0].workspace_id !== workspace_id) {
      return reply.code(404).send({ error: "room_not_found" });
    }

    const thread_id = req.body.thread_id?.trim() || undefined;
    if (thread_id) {
      const thread = await pool.query<{ room_id: string; workspace_id: string }>(
        "SELECT room_id, workspace_id FROM proj_threads WHERE thread_id = $1",
        [thread_id],
      );
      if (thread.rowCount !== 1 || thread.rows[0].room_id !== room_id) {
        return reply.code(404).send({ error: "thread_not_found" });
      }
      if (thread.rows[0].workspace_id !== workspace_id) {
        return reply.code(404).send({ error: "thread_not_found" });
      }
    }

    const run_id = newRunId();
    const occurred_at = new Date().toISOString();
    const correlation_id = req.body.correlation_id?.trim() || randomUUID();

    const event = await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "run.created",
      event_version: 1,
      occurred_at,
      workspace_id,
      room_id,
      thread_id,
      run_id,
      actor: { actor_type: "service", actor_id: "api" },
      // Room feed is the primary realtime stream: all room-scoped events go to the room stream.
      stream: { stream_type: "room", stream_id: room_id },
      correlation_id,
      data: {
        run_id,
        title: req.body.title,
        goal: req.body.goal,
        input: req.body.input,
        tags: req.body.tags,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });

    await applyRunEvent(pool, event as RunEventV1);
    return reply.code(201).send({ run_id });
  });

  app.post<{
    Params: { runId: string };
  }>("/v1/runs/:runId/start", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);

    const existing = await pool.query<{
      run_id: string;
      workspace_id: string;
      room_id: string | null;
      thread_id: string | null;
      correlation_id: string;
      last_event_id: string | null;
      status: string;
    }>(
      "SELECT run_id, workspace_id, room_id, thread_id, correlation_id, last_event_id, status FROM proj_runs WHERE run_id = $1",
      [req.params.runId],
    );
    if (existing.rowCount !== 1 || existing.rows[0].workspace_id !== workspace_id) {
      return reply.code(404).send({ error: "run_not_found" });
    }

    if (existing.rows[0].status !== "queued") {
      return reply.code(409).send({ error: "run_not_queued" });
    }

    const occurred_at = new Date().toISOString();
    const causation_id = existing.rows[0].last_event_id ?? undefined;

    const event = await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "run.started",
      event_version: 1,
      occurred_at,
      workspace_id,
      room_id: existing.rows[0].room_id ?? undefined,
      thread_id: existing.rows[0].thread_id ?? undefined,
      run_id: existing.rows[0].run_id,
      actor: { actor_type: "service", actor_id: "api" },
      stream:
        existing.rows[0].room_id != null
          ? { stream_type: "room", stream_id: existing.rows[0].room_id }
          : { stream_type: "workspace", stream_id: workspace_id },
      correlation_id: existing.rows[0].correlation_id,
      causation_id,
      data: { run_id: existing.rows[0].run_id },
      policy_context: {},
      model_context: {},
      display: {},
    });

    await applyRunEvent(pool, event as RunEventV1);
    return reply.code(200).send({ ok: true });
  });

  app.post<{
    Params: { runId: string };
    Body: { summary?: string; output?: Record<string, unknown> };
  }>("/v1/runs/:runId/complete", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);

    const existing = await pool.query<{
      run_id: string;
      workspace_id: string;
      room_id: string | null;
      thread_id: string | null;
      correlation_id: string;
      last_event_id: string | null;
      status: string;
    }>(
      "SELECT run_id, workspace_id, room_id, thread_id, correlation_id, last_event_id, status FROM proj_runs WHERE run_id = $1",
      [req.params.runId],
    );
    if (existing.rowCount !== 1 || existing.rows[0].workspace_id !== workspace_id) {
      return reply.code(404).send({ error: "run_not_found" });
    }

    if (existing.rows[0].status === "succeeded" || existing.rows[0].status === "failed") {
      return reply.code(409).send({ error: "run_already_ended" });
    }

    const occurred_at = new Date().toISOString();
    const causation_id = existing.rows[0].last_event_id ?? undefined;

    const event = await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "run.completed",
      event_version: 1,
      occurred_at,
      workspace_id,
      room_id: existing.rows[0].room_id ?? undefined,
      thread_id: existing.rows[0].thread_id ?? undefined,
      run_id: existing.rows[0].run_id,
      actor: { actor_type: "service", actor_id: "api" },
      stream:
        existing.rows[0].room_id != null
          ? { stream_type: "room", stream_id: existing.rows[0].room_id }
          : { stream_type: "workspace", stream_id: workspace_id },
      correlation_id: existing.rows[0].correlation_id,
      causation_id,
      data: {
        run_id: existing.rows[0].run_id,
        summary: req.body.summary,
        output: req.body.output,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });

    await applyRunEvent(pool, event as RunEventV1);
    return reply.code(200).send({ ok: true });
  });

  app.post<{
    Params: { runId: string };
    Body: { message?: string; error?: Record<string, unknown> };
  }>("/v1/runs/:runId/fail", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);

    const existing = await pool.query<{
      run_id: string;
      workspace_id: string;
      room_id: string | null;
      thread_id: string | null;
      correlation_id: string;
      last_event_id: string | null;
      status: string;
    }>(
      "SELECT run_id, workspace_id, room_id, thread_id, correlation_id, last_event_id, status FROM proj_runs WHERE run_id = $1",
      [req.params.runId],
    );
    if (existing.rowCount !== 1 || existing.rows[0].workspace_id !== workspace_id) {
      return reply.code(404).send({ error: "run_not_found" });
    }

    if (existing.rows[0].status === "succeeded" || existing.rows[0].status === "failed") {
      return reply.code(409).send({ error: "run_already_ended" });
    }

    const occurred_at = new Date().toISOString();
    const causation_id = existing.rows[0].last_event_id ?? undefined;

    const event = await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "run.failed",
      event_version: 1,
      occurred_at,
      workspace_id,
      room_id: existing.rows[0].room_id ?? undefined,
      thread_id: existing.rows[0].thread_id ?? undefined,
      run_id: existing.rows[0].run_id,
      actor: { actor_type: "service", actor_id: "api" },
      stream:
        existing.rows[0].room_id != null
          ? { stream_type: "room", stream_id: existing.rows[0].room_id }
          : { stream_type: "workspace", stream_id: workspace_id },
      correlation_id: existing.rows[0].correlation_id,
      causation_id,
      data: {
        run_id: existing.rows[0].run_id,
        message: req.body.message,
        error: req.body.error,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });

    await applyRunEvent(pool, event as RunEventV1);
    return reply.code(200).send({ ok: true });
  });

  app.post<{
    Params: { runId: string };
    Body: { kind: string; title?: string; input?: Record<string, unknown> };
  }>("/v1/runs/:runId/steps", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);

    if (!req.body.kind?.trim()) {
      return reply.code(400).send({ error: "missing_kind" });
    }

    const existing = await pool.query<{
      run_id: string;
      workspace_id: string;
      room_id: string | null;
      thread_id: string | null;
      correlation_id: string;
      last_event_id: string | null;
      status: string;
    }>(
      "SELECT run_id, workspace_id, room_id, thread_id, correlation_id, last_event_id, status FROM proj_runs WHERE run_id = $1",
      [req.params.runId],
    );
    if (existing.rowCount !== 1 || existing.rows[0].workspace_id !== workspace_id) {
      return reply.code(404).send({ error: "run_not_found" });
    }

    if (existing.rows[0].status !== "running") {
      return reply.code(409).send({ error: "run_not_running" });
    }

    const step_id = newStepId();
    const occurred_at = new Date().toISOString();
    const causation_id = existing.rows[0].last_event_id ?? undefined;

    const event = await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "step.created",
      event_version: 1,
      occurred_at,
      workspace_id,
      room_id: existing.rows[0].room_id ?? undefined,
      thread_id: existing.rows[0].thread_id ?? undefined,
      run_id: existing.rows[0].run_id,
      step_id,
      actor: { actor_type: "service", actor_id: "api" },
      stream:
        existing.rows[0].room_id != null
          ? { stream_type: "room", stream_id: existing.rows[0].room_id }
          : { stream_type: "workspace", stream_id: workspace_id },
      correlation_id: existing.rows[0].correlation_id,
      causation_id,
      data: {
        step_id,
        kind: req.body.kind,
        title: req.body.title,
        input: req.body.input,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });

    await applyRunEvent(pool, event as RunEventV1);
    return reply.code(201).send({ step_id });
  });

  app.get<{
    Querystring: { room_id?: string; status?: string; limit?: string };
  }>("/v1/runs", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);

    const room_id = req.query.room_id?.trim() || null;
    const status = normalizeRunStatus(req.query.status);
    if (req.query.status && !status) {
      return reply.code(400).send({ error: "invalid_status" });
    }

    const rawLimit = Number(req.query.limit ?? "50");
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, rawLimit)) : 50;

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

    const res = await pool.query(
      `SELECT
        run_id,
        workspace_id, room_id, thread_id,
        status,
        title, goal, input, output, error, tags,
        created_at, started_at, ended_at, updated_at,
        correlation_id, last_event_id
      FROM proj_runs
      WHERE ${where}
      ORDER BY updated_at DESC
      LIMIT $${args.length}`,
      args,
    );

    return reply.code(200).send({ runs: res.rows });
  });

  app.get<{
    Params: { runId: string };
  }>("/v1/runs/:runId", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);

    const res = await pool.query(
      `SELECT
        run_id,
        workspace_id, room_id, thread_id,
        status,
        title, goal, input, output, error, tags,
        created_at, started_at, ended_at, updated_at,
        correlation_id, last_event_id
      FROM proj_runs
      WHERE run_id = $1
        AND workspace_id = $2`,
      [req.params.runId, workspace_id],
    );
    if (res.rowCount !== 1) {
      return reply.code(404).send({ error: "run_not_found" });
    }
    return reply.code(200).send({ run: res.rows[0] });
  });

  app.get<{
    Params: { runId: string };
  }>("/v1/runs/:runId/steps", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);

    const run = await pool.query<{ workspace_id: string }>(
      "SELECT workspace_id FROM proj_runs WHERE run_id = $1",
      [req.params.runId],
    );
    if (run.rowCount !== 1 || run.rows[0].workspace_id !== workspace_id) {
      return reply.code(404).send({ error: "run_not_found" });
    }

    const res = await pool.query(
      `SELECT
        step_id,
        run_id, workspace_id, room_id, thread_id,
        kind, status,
        title, input, output, error,
        created_at, updated_at,
        last_event_id
      FROM proj_steps
      WHERE run_id = $1
      ORDER BY created_at ASC`,
      [req.params.runId],
    );
    return reply.code(200).send({ steps: res.rows });
  });
}

