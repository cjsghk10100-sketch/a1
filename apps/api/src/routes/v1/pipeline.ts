import type { FastifyInstance } from "fastify";

import type { DbPool } from "../../db/pool.js";

type ApprovalStageRow = {
  approval_id: string;
  title: string | null;
  status: "pending" | "held";
  room_id: string | null;
  thread_id: string | null;
  run_id: string | null;
  correlation_id: string;
  updated_at: string;
  last_event_id: string | null;
};

type RunStageRow = {
  run_id: string;
  title: string | null;
  status: "queued" | "running" | "succeeded" | "failed";
  room_id: string | null;
  thread_id: string | null;
  experiment_id: string | null;
  correlation_id: string;
  updated_at: string;
  last_event_id: string | null;
};

type PipelineItemLinks = {
  experiment_id: string | null;
  approval_id: string | null;
  run_id: string | null;
  evidence_id: string | null;
  scorecard_id: string | null;
  incident_id: string | null;
};

type ApprovalStageItem = {
  entity_type: "approval";
  entity_id: string;
  title: string;
  status: "pending" | "held";
  room_id: string | null;
  thread_id: string | null;
  correlation_id: string;
  updated_at: string;
  last_event_id: string | null;
  links: PipelineItemLinks;
};

type RunStageItem = {
  entity_type: "run";
  entity_id: string;
  title: string;
  status: "queued" | "running" | "succeeded" | "failed";
  room_id: string | null;
  thread_id: string | null;
  correlation_id: string;
  updated_at: string;
  last_event_id: string | null;
  links: PipelineItemLinks;
};

type PipelineProjectionResponse = {
  schema_version: "pipeline_projection.v0.1";
  generated_at: string;
  "1_inbox": Array<Record<string, never>>;
  "2_pending_approval": ApprovalStageItem[];
  "3_execute_workspace": RunStageItem[];
  "4_review_evidence": RunStageItem[];
  "5_promoted": Array<Record<string, never>>;
  "6_demoted": Array<Record<string, never>>;
};

function getHeaderString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function workspaceIdFromReq(req: { headers: Record<string, unknown> }): string {
  const raw = getHeaderString(req.headers["x-workspace-id"] as string | string[] | undefined);
  return raw?.trim() || "ws_dev";
}

function parseLimit(raw: unknown): number {
  const n = Number(raw ?? "200");
  if (!Number.isFinite(n)) return 200;
  return Math.max(1, Math.min(500, Math.floor(n)));
}

function toApprovalStageItem(row: ApprovalStageRow): ApprovalStageItem {
  return {
    entity_type: "approval",
    entity_id: row.approval_id,
    title: row.title ?? "",
    status: row.status,
    room_id: row.room_id,
    thread_id: row.thread_id,
    correlation_id: row.correlation_id,
    updated_at: row.updated_at,
    last_event_id: row.last_event_id,
    links: {
      experiment_id: null,
      approval_id: row.approval_id,
      run_id: row.run_id,
      evidence_id: null,
      scorecard_id: null,
      incident_id: null,
    },
  };
}

function toRunStageItem(row: RunStageRow): RunStageItem {
  return {
    entity_type: "run",
    entity_id: row.run_id,
    title: row.title ?? "",
    status: row.status,
    room_id: row.room_id,
    thread_id: row.thread_id,
    correlation_id: row.correlation_id,
    updated_at: row.updated_at,
    last_event_id: row.last_event_id,
    links: {
      experiment_id: row.experiment_id,
      approval_id: null,
      run_id: row.run_id,
      evidence_id: null,
      scorecard_id: null,
      incident_id: null,
    },
  };
}

export async function registerPipelineRoutes(app: FastifyInstance, pool: DbPool): Promise<void> {
  app.get<{
    Querystring: { limit?: string };
  }>("/v1/pipeline/projection", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const limit = parseLimit(req.query.limit);

    const approvals = await pool.query<ApprovalStageRow>(
      `SELECT
         approval_id,
         title,
         status,
         room_id,
         thread_id,
         run_id,
         correlation_id,
         updated_at::text AS updated_at,
         last_event_id
       FROM proj_approvals
       WHERE workspace_id = $1
         AND status IN ('pending', 'held')
       ORDER BY updated_at DESC, approval_id ASC
       LIMIT $2`,
      [workspace_id, limit],
    );

    const executeRuns = await pool.query<RunStageRow>(
      `SELECT
         run_id,
         title,
         status,
         room_id,
         thread_id,
         experiment_id,
         correlation_id,
         updated_at::text AS updated_at,
         last_event_id
       FROM proj_runs
       WHERE workspace_id = $1
         AND status IN ('queued', 'running')
       ORDER BY updated_at DESC, run_id ASC
       LIMIT $2`,
      [workspace_id, limit],
    );

    const reviewRuns = await pool.query<RunStageRow>(
      `SELECT
         run_id,
         title,
         status,
         room_id,
         thread_id,
         experiment_id,
         correlation_id,
         updated_at::text AS updated_at,
         last_event_id
       FROM proj_runs
       WHERE workspace_id = $1
         AND status IN ('succeeded', 'failed')
       ORDER BY updated_at DESC, run_id ASC
       LIMIT $2`,
      [workspace_id, limit],
    );

    const response: PipelineProjectionResponse = {
      schema_version: "pipeline_projection.v0.1",
      generated_at: new Date().toISOString(),
      "1_inbox": [] as Array<Record<string, never>>,
      "2_pending_approval": approvals.rows.map(toApprovalStageItem),
      "3_execute_workspace": executeRuns.rows.map(toRunStageItem),
      "4_review_evidence": reviewRuns.rows.map(toRunStageItem),
      "5_promoted": [] as Array<Record<string, never>>,
      "6_demoted": [] as Array<Record<string, never>>,
    };

    return reply.code(200).send(response);
  });
}
