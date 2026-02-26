import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import type { ArtifactContentType, ArtifactEventV1 } from "@agentapp/shared";
import { newArtifactId } from "@agentapp/shared";

import type { DbPool } from "../../db/pool.js";
import { appendToStream } from "../../eventStore/index.js";
import { applyArtifactEvent } from "../../projectors/artifactProjector.js";
import { assertSupportedSchemaVersion } from "../../contracts/schemaVersion.js";

function getHeaderString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function workspaceIdFromReq(req: { headers: Record<string, unknown> }): string {
  const raw = getHeaderString(req.headers["x-workspace-id"] as string | string[] | undefined);
  return raw?.trim() || "ws_dev";
}

function normalizeContentType(raw: unknown): ArtifactContentType {
  return raw === "text" || raw === "json" || raw === "uri" || raw === "none" ? raw : "none";
}

export async function registerArtifactRoutes(app: FastifyInstance, pool: DbPool): Promise<void> {
  app.post<{
    Params: { stepId: string };
    Body: {
      schema_version?: string;
      kind: string;
      title?: string;
      mime_type?: string;
      size_bytes?: number;
      sha256?: string;
      content?: { type: ArtifactContentType; text?: string; json?: Record<string, unknown>; uri?: string };
      metadata?: Record<string, unknown>;
    };
  }>("/v1/steps/:stepId/artifacts", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);

    try {
      assertSupportedSchemaVersion(req.body.schema_version);
    } catch (err) {
      return reply.code(400).send({
        error: "invalid_schema_version",
        reason_code: "unsupported_version",
        message: err instanceof Error ? err.message : "unsupported schema_version",
      });
    }

    if (!req.body.kind?.trim()) {
      return reply.code(400).send({ error: "missing_kind" });
    }

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
    }>(
      "SELECT run_id, workspace_id, room_id, thread_id, correlation_id, last_event_id FROM proj_runs WHERE run_id = $1",
      [step.rows[0].run_id],
    );
    if (run.rowCount !== 1 || run.rows[0].workspace_id !== workspace_id) {
      return reply.code(404).send({ error: "run_not_found" });
    }

    const artifact_id = newArtifactId();
    const occurred_at = new Date().toISOString();
    const causation_id = step.rows[0].last_event_id ?? run.rows[0].last_event_id ?? undefined;

    const room_id = run.rows[0].room_id ?? step.rows[0].room_id ?? undefined;
    const thread_id = run.rows[0].thread_id ?? step.rows[0].thread_id ?? undefined;

    const stream =
      room_id != null
        ? { stream_type: "room" as const, stream_id: room_id }
        : { stream_type: "workspace" as const, stream_id: workspace_id };

    const contentType = normalizeContentType(req.body.content?.type);
    const content =
      req.body.content != null
        ? {
            type: contentType,
            text: contentType === "text" ? req.body.content.text : undefined,
            json: contentType === "json" ? req.body.content.json : undefined,
            uri: contentType === "uri" ? req.body.content.uri : undefined,
          }
        : undefined;

    const event = await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "artifact.created",
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
        artifact_id,
        kind: req.body.kind,
        title: req.body.title,
        mime_type: req.body.mime_type,
        size_bytes: req.body.size_bytes,
        sha256: req.body.sha256,
        content,
        metadata: req.body.metadata,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });

    await applyArtifactEvent(pool, event as ArtifactEventV1);
    return reply.code(201).send({ artifact_id });
  });

  app.get<{
    Querystring: { run_id?: string; step_id?: string; room_id?: string; limit?: string };
  }>("/v1/artifacts", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);

    const run_id = req.query.run_id?.trim() || null;
    const step_id = req.query.step_id?.trim() || null;
    const room_id = req.query.room_id?.trim() || null;

    const rawLimit = Number(req.query.limit ?? "50");
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, rawLimit)) : 50;

    const args: unknown[] = [workspace_id];
    let where = "workspace_id = $1";

    if (room_id) {
      args.push(room_id);
      where += ` AND room_id = $${args.length}`;
    }
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
        artifact_id,
        workspace_id, room_id, thread_id, run_id, step_id,
        kind, title, mime_type, size_bytes, sha256,
        content_type, content_text, content_json, content_uri,
        metadata,
        created_at, updated_at,
        correlation_id, last_event_id
      FROM proj_artifacts
      WHERE ${where}
      ORDER BY created_at ASC
      LIMIT $${args.length}`,
      args,
    );

    return reply.code(200).send({ artifacts: res.rows });
  });

  app.get<{
    Params: { artifactId: string };
  }>("/v1/artifacts/:artifactId", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);

    const res = await pool.query(
      `SELECT
        artifact_id,
        workspace_id, room_id, thread_id, run_id, step_id,
        kind, title, mime_type, size_bytes, sha256,
        content_type, content_text, content_json, content_uri,
        metadata,
        created_at, updated_at,
        correlation_id, last_event_id
      FROM proj_artifacts
      WHERE artifact_id = $1
        AND workspace_id = $2`,
      [req.params.artifactId, workspace_id],
    );

    if (res.rowCount !== 1) {
      return reply.code(404).send({ error: "artifact_not_found" });
    }

    return reply.code(200).send({ artifact: res.rows[0] });
  });
}

