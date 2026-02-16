import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import type { ToolCallId, ToolEventV1 } from "@agentapp/shared";
import { newToolCallId } from "@agentapp/shared";

import type { DbPool } from "../../db/pool.js";
import { appendToStream } from "../../eventStore/index.js";
import { applyToolEvent } from "../../projectors/toolProjector.js";
import { trackAgentSkillUsageFromTool } from "./skillsLedger.js";

function getHeaderString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function workspaceIdFromReq(req: { headers: Record<string, unknown> }): string {
  const raw = getHeaderString(req.headers["x-workspace-id"] as string | string[] | undefined);
  return raw?.trim() || "ws_dev";
}

export async function registerToolCallRoutes(app: FastifyInstance, pool: DbPool): Promise<void> {
  app.post<{
    Params: { stepId: string };
    Body: { tool_name: string; title?: string; input?: Record<string, unknown>; agent_id?: string };
  }>("/v1/steps/:stepId/toolcalls", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);

    const step = await pool.query<{
      step_id: string;
      run_id: string;
      workspace_id: string;
      room_id: string | null;
      thread_id: string | null;
      last_event_id: string | null;
    }>(
      "SELECT step_id, run_id, workspace_id, room_id, thread_id, last_event_id FROM proj_steps WHERE step_id = $1",
      [req.params.stepId],
    );
    if (step.rowCount !== 1 || step.rows[0].workspace_id !== workspace_id) {
      return reply.code(404).send({ error: "step_not_found" });
    }

    const run = await pool.query<{
      run_id: string;
      workspace_id: string;
      room_id: string | null;
      thread_id: string | null;
      correlation_id: string;
      last_event_id: string | null;
      status: string;
    }>(
      "SELECT run_id, workspace_id, room_id, thread_id, correlation_id, last_event_id, status FROM proj_runs WHERE run_id = $1",
      [step.rows[0].run_id],
    );
    if (run.rowCount !== 1 || run.rows[0].workspace_id !== workspace_id) {
      return reply.code(404).send({ error: "run_not_found" });
    }

    if (run.rows[0].status !== "running") {
      return reply.code(409).send({ error: "run_not_running" });
    }

    if (!req.body.tool_name?.trim()) {
      return reply.code(400).send({ error: "missing_tool_name" });
    }

    const tool_call_id = newToolCallId();
    const occurred_at = new Date().toISOString();
    const causation_id = step.rows[0].last_event_id ?? run.rows[0].last_event_id ?? undefined;

    const room_id = run.rows[0].room_id ?? step.rows[0].room_id ?? undefined;
    const thread_id = run.rows[0].thread_id ?? step.rows[0].thread_id ?? undefined;

    const stream =
      room_id != null
        ? { stream_type: "room" as const, stream_id: room_id }
        : { stream_type: "workspace" as const, stream_id: workspace_id };

    const event = await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "tool.invoked",
      event_version: 1,
      occurred_at,
      workspace_id,
      room_id,
      thread_id,
      run_id: run.rows[0].run_id,
      step_id: step.rows[0].step_id,
      actor: { actor_type: "service", actor_id: "api" },
      stream,
      correlation_id: run.rows[0].correlation_id,
      causation_id,
      data: {
        tool_call_id,
        tool_name: req.body.tool_name,
        title: req.body.title,
        input: req.body.input,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });

    await applyToolEvent(pool, event as ToolEventV1);

    const agent_id = req.body.agent_id?.trim();
    if (agent_id) {
      try {
        await trackAgentSkillUsageFromTool(pool, {
          workspace_id,
          agent_id,
          skill_id: req.body.tool_name,
          occurred_at,
          correlation_id: run.rows[0].correlation_id,
          causation_id: event.event_id,
          room_id,
          thread_id,
          run_id: run.rows[0].run_id,
          step_id: step.rows[0].step_id,
          actor_type: "service",
          actor_id: "api",
        });
      } catch (err) {
        req.log.warn(
          { err, agent_id, tool_name: req.body.tool_name },
          "skill-ledger attribution failed; continuing without blocking toolcall",
        );
      }
    }

    return reply.code(201).send({ tool_call_id });
  });

  app.post<{
    Params: { toolCallId: ToolCallId };
    Body: { output?: Record<string, unknown> };
  }>("/v1/toolcalls/:toolCallId/succeed", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);

    const existing = await pool.query<{
      tool_call_id: string;
      workspace_id: string;
      room_id: string | null;
      thread_id: string | null;
      run_id: string;
      step_id: string;
      correlation_id: string;
      last_event_id: string | null;
      status: string;
    }>(
      "SELECT tool_call_id, workspace_id, room_id, thread_id, run_id, step_id, correlation_id, last_event_id, status FROM proj_tool_calls WHERE tool_call_id = $1",
      [req.params.toolCallId],
    );

    if (existing.rowCount !== 1 || existing.rows[0].workspace_id !== workspace_id) {
      return reply.code(404).send({ error: "tool_call_not_found" });
    }

    if (existing.rows[0].status !== "running") {
      return reply.code(409).send({ error: "tool_call_not_running" });
    }

    const occurred_at = new Date().toISOString();
    const causation_id = existing.rows[0].last_event_id ?? undefined;

    const stream =
      existing.rows[0].room_id != null
        ? { stream_type: "room" as const, stream_id: existing.rows[0].room_id }
        : { stream_type: "workspace" as const, stream_id: workspace_id };

    const event = await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "tool.succeeded",
      event_version: 1,
      occurred_at,
      workspace_id,
      room_id: existing.rows[0].room_id ?? undefined,
      thread_id: existing.rows[0].thread_id ?? undefined,
      run_id: existing.rows[0].run_id,
      step_id: existing.rows[0].step_id,
      actor: { actor_type: "service", actor_id: "api" },
      stream,
      correlation_id: existing.rows[0].correlation_id,
      causation_id,
      data: {
        tool_call_id: req.params.toolCallId,
        output: req.body.output,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });

    await applyToolEvent(pool, event as ToolEventV1);
    return reply.code(200).send({ ok: true });
  });

  app.post<{
    Params: { toolCallId: ToolCallId };
    Body: { message?: string; error?: Record<string, unknown> };
  }>("/v1/toolcalls/:toolCallId/fail", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);

    const existing = await pool.query<{
      tool_call_id: string;
      workspace_id: string;
      room_id: string | null;
      thread_id: string | null;
      run_id: string;
      step_id: string;
      correlation_id: string;
      last_event_id: string | null;
      status: string;
    }>(
      "SELECT tool_call_id, workspace_id, room_id, thread_id, run_id, step_id, correlation_id, last_event_id, status FROM proj_tool_calls WHERE tool_call_id = $1",
      [req.params.toolCallId],
    );

    if (existing.rowCount !== 1 || existing.rows[0].workspace_id !== workspace_id) {
      return reply.code(404).send({ error: "tool_call_not_found" });
    }

    if (existing.rows[0].status !== "running") {
      return reply.code(409).send({ error: "tool_call_not_running" });
    }

    const occurred_at = new Date().toISOString();
    const causation_id = existing.rows[0].last_event_id ?? undefined;

    const stream =
      existing.rows[0].room_id != null
        ? { stream_type: "room" as const, stream_id: existing.rows[0].room_id }
        : { stream_type: "workspace" as const, stream_id: workspace_id };

    const event = await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "tool.failed",
      event_version: 1,
      occurred_at,
      workspace_id,
      room_id: existing.rows[0].room_id ?? undefined,
      thread_id: existing.rows[0].thread_id ?? undefined,
      run_id: existing.rows[0].run_id,
      step_id: existing.rows[0].step_id,
      actor: { actor_type: "service", actor_id: "api" },
      stream,
      correlation_id: existing.rows[0].correlation_id,
      causation_id,
      data: {
        tool_call_id: req.params.toolCallId,
        message: req.body.message,
        error: req.body.error,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });

    await applyToolEvent(pool, event as ToolEventV1);
    return reply.code(200).send({ ok: true });
  });

  app.get<{
    Querystring: { run_id?: string; step_id?: string; limit?: string };
  }>("/v1/toolcalls", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);

    const run_id = req.query.run_id?.trim() || null;
    const step_id = req.query.step_id?.trim() || null;

    const rawLimit = Number(req.query.limit ?? "50");
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, rawLimit)) : 50;

    const args: unknown[] = [workspace_id];
    let where = "workspace_id = $1";

    if (run_id) {
      args.push(run_id);
      where += ` AND run_id = $${args.length}`;
    }

    if (step_id) {
      args.push(step_id);
      where += ` AND step_id = $${args.length}`;
    }

    args.push(limit);

    const res = await pool.query(
      `SELECT
        tool_call_id,
        workspace_id, room_id, thread_id, run_id, step_id,
        tool_name, title,
        status,
        input, output, error,
        started_at, ended_at, updated_at,
        correlation_id, last_event_id
      FROM proj_tool_calls
      WHERE ${where}
      ORDER BY started_at ASC
      LIMIT $${args.length}`,
      args,
    );

    return reply.code(200).send({ tool_calls: res.rows });
  });

  app.get<{
    Params: { toolCallId: ToolCallId };
  }>("/v1/toolcalls/:toolCallId", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);

    const res = await pool.query(
      `SELECT
        tool_call_id,
        workspace_id, room_id, thread_id, run_id, step_id,
        tool_name, title,
        status,
        input, output, error,
        started_at, ended_at, updated_at,
        correlation_id, last_event_id
      FROM proj_tool_calls
      WHERE tool_call_id = $1
        AND workspace_id = $2`,
      [req.params.toolCallId, workspace_id],
    );

    if (res.rowCount !== 1) {
      return reply.code(404).send({ error: "tool_call_not_found" });
    }

    return reply.code(200).send({ tool_call: res.rows[0] });
  });
}
