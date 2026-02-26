import type { FastifyInstance } from "fastify";

import type { DbPool } from "../../db/pool.js";
import {
  buildContractError,
  httpStatusForReasonCode,
} from "../../contracts/pipeline_v2_contract.js";
import { SCHEMA_VERSION } from "../../contracts/schemaVersion.js";
import type { PipelineProjectionResponseV2_1 } from "../../contracts/pipeline_v2_contract.js";

type StageKey =
  | "1_inbox"
  | "2_pending_approval"
  | "3_execute_workspace"
  | "4_review_evidence"
  | "5_promoted"
  | "6_demoted";

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
  open_incident_id: string | null;
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

type PipelineStageStats = Record<
  StageKey,
  {
    returned: number;
    truncated: boolean;
  }
>;

type PipelineProjectionStages = {
  "1_inbox": Array<Record<string, never>>;
  "2_pending_approval": ApprovalStageItem[];
  "3_execute_workspace": RunStageItem[];
  "4_review_evidence": RunStageItem[];
  "5_promoted": Array<Record<string, never>>;
  "6_demoted": RunStageItem[];
};

type PipelineProjectionResponse = PipelineProjectionResponseV2_1;

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
      incident_id: row.open_incident_id,
    },
  };
}

const TRIAGE_ERROR_CODES = [
  "policy_denied",
  "approval_required",
  "permission_denied",
  "external_write_kill_switch",
] as const;

type WatermarkCandidate = {
  updated_at: string;
  entity_id: string;
  last_event_id: string | null;
};

type StageFetchResult<T> = {
  items: T[];
  truncated: boolean;
};

function pickMostRecentWatermarkItem(
  current: WatermarkCandidate | null,
  next: WatermarkCandidate,
): WatermarkCandidate {
  if (!current) return next;
  const currentTime = Date.parse(current.updated_at);
  const nextTime = Date.parse(next.updated_at);
  if (Number.isFinite(nextTime) && Number.isFinite(currentTime) && nextTime !== currentTime) {
    return nextTime > currentTime ? next : current;
  }
  if (Number.isFinite(nextTime) && !Number.isFinite(currentTime)) return next;
  if (!Number.isFinite(nextTime) && Number.isFinite(currentTime)) return current;
  return next.entity_id.localeCompare(current.entity_id) < 0 ? next : current;
}

function computeWatermarkEventId(stages: PipelineProjectionStages): string | null {
  let candidate: WatermarkCandidate | null = null;
  const stageItems: Array<ApprovalStageItem | RunStageItem> = [
    ...stages["2_pending_approval"],
    ...stages["3_execute_workspace"],
    ...stages["4_review_evidence"],
    ...stages["6_demoted"],
  ];
  for (const item of stageItems) {
    candidate = pickMostRecentWatermarkItem(candidate, {
      updated_at: item.updated_at,
      entity_id: item.entity_id,
      last_event_id: item.last_event_id,
    });
  }
  return candidate?.last_event_id ?? null;
}

async function fetchApprovalStage(
  pool: DbPool,
  workspace_id: string,
  limit: number,
): Promise<StageFetchResult<ApprovalStageItem>> {
  const res = await pool.query<ApprovalStageRow>(
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
    [workspace_id, limit + 1],
  );
  const truncated = res.rows.length > limit;
  const rows = truncated ? res.rows.slice(0, limit) : res.rows;
  return { items: rows.map(toApprovalStageItem), truncated };
}

async function fetchExecuteRunsStage(
  pool: DbPool,
  workspace_id: string,
  limit: number,
): Promise<StageFetchResult<RunStageItem>> {
  const res = await pool.query<RunStageRow>(
    `SELECT
       r.run_id,
       r.title,
       r.status,
       r.room_id,
       r.thread_id,
       r.experiment_id,
       r.correlation_id,
       r.updated_at::text AS updated_at,
       r.last_event_id,
       oi.incident_id AS open_incident_id
     FROM proj_runs AS r
     LEFT JOIN LATERAL (
       SELECT i.incident_id
       FROM proj_incidents AS i
       WHERE i.workspace_id = r.workspace_id
         AND i.status = 'open'
         AND (i.run_id = r.run_id OR i.correlation_id = r.correlation_id)
       ORDER BY i.updated_at DESC, i.incident_id ASC
       LIMIT 1
     ) AS oi ON TRUE
     WHERE r.workspace_id = $1
       AND r.status IN ('queued', 'running')
     ORDER BY r.updated_at DESC, r.run_id ASC
     LIMIT $2`,
    [workspace_id, limit + 1],
  );
  const truncated = res.rows.length > limit;
  const rows = truncated ? res.rows.slice(0, limit) : res.rows;
  return { items: rows.map(toRunStageItem), truncated };
}

async function fetchReviewRunsStage(
  pool: DbPool,
  workspace_id: string,
  limit: number,
): Promise<StageFetchResult<RunStageItem>> {
  const res = await pool.query<RunStageRow>(
    `SELECT
       r.run_id,
       r.title,
       r.status,
       r.room_id,
       r.thread_id,
       r.experiment_id,
       r.correlation_id,
       r.updated_at::text AS updated_at,
       r.last_event_id,
       oi.incident_id AS open_incident_id
     FROM proj_runs AS r
     LEFT JOIN LATERAL (
       SELECT i.incident_id
       FROM proj_incidents AS i
       WHERE i.workspace_id = r.workspace_id
         AND i.status = 'open'
         AND (i.run_id = r.run_id OR i.correlation_id = r.correlation_id)
       ORDER BY i.updated_at DESC, i.incident_id ASC
       LIMIT 1
     ) AS oi ON TRUE
     WHERE r.workspace_id = $1
       AND (
         r.status = 'succeeded'
         OR (
           r.status = 'failed'
           AND (
             oi.incident_id IS NOT NULL
             OR COALESCE(r.error->>'code', '') = ANY($3::text[])
             OR COALESCE(r.error->>'kind', '') = 'policy'
           )
         )
       )
     ORDER BY r.updated_at DESC, r.run_id ASC
     LIMIT $2`,
    [workspace_id, limit + 1, TRIAGE_ERROR_CODES],
  );
  const truncated = res.rows.length > limit;
  const rows = truncated ? res.rows.slice(0, limit) : res.rows;
  return { items: rows.map(toRunStageItem), truncated };
}

async function fetchDemotedRunsStage(
  pool: DbPool,
  workspace_id: string,
  limit: number,
): Promise<StageFetchResult<RunStageItem>> {
  const res = await pool.query<RunStageRow>(
    `SELECT
       r.run_id,
       r.title,
       r.status,
       r.room_id,
       r.thread_id,
       r.experiment_id,
       r.correlation_id,
       r.updated_at::text AS updated_at,
       r.last_event_id,
       oi.incident_id AS open_incident_id
     FROM proj_runs AS r
     LEFT JOIN LATERAL (
       SELECT i.incident_id
       FROM proj_incidents AS i
       WHERE i.workspace_id = r.workspace_id
         AND i.status = 'open'
         AND (i.run_id = r.run_id OR i.correlation_id = r.correlation_id)
       ORDER BY i.updated_at DESC, i.incident_id ASC
       LIMIT 1
     ) AS oi ON TRUE
     WHERE r.workspace_id = $1
       AND r.status = 'failed'
       AND NOT (
         oi.incident_id IS NOT NULL
         OR COALESCE(r.error->>'code', '') = ANY($3::text[])
         OR COALESCE(r.error->>'kind', '') = 'policy'
       )
     ORDER BY r.updated_at DESC, r.run_id ASC
     LIMIT $2`,
    [workspace_id, limit + 1, TRIAGE_ERROR_CODES],
  );
  const truncated = res.rows.length > limit;
  const rows = truncated ? res.rows.slice(0, limit) : res.rows;
  return { items: rows.map(toRunStageItem), truncated };
}

export async function registerPipelineRoutes(app: FastifyInstance, pool: DbPool): Promise<void> {
  app.get<{
    Querystring: { limit?: string };
  }>("/v1/pipeline/projection", async (req, reply) => {
    try {
      const workspace_id = workspaceIdFromReq(req);
      const limit = parseLimit(req.query.limit);

      const [approvalStage, executeStage, reviewStage, demotedStage] = await Promise.all([
        fetchApprovalStage(pool, workspace_id, limit),
        fetchExecuteRunsStage(pool, workspace_id, limit),
        fetchReviewRunsStage(pool, workspace_id, limit),
        fetchDemotedRunsStage(pool, workspace_id, limit),
      ]);

      const stages: PipelineProjectionStages = {
        "1_inbox": [],
        "2_pending_approval": approvalStage.items,
        "3_execute_workspace": executeStage.items,
        "4_review_evidence": reviewStage.items,
        "5_promoted": [],
        "6_demoted": demotedStage.items,
      };

      const stage_stats: PipelineStageStats = {
        "1_inbox": { returned: stages["1_inbox"].length, truncated: false },
        "2_pending_approval": {
          returned: stages["2_pending_approval"].length,
          truncated: approvalStage.truncated,
        },
        "3_execute_workspace": {
          returned: stages["3_execute_workspace"].length,
          truncated: executeStage.truncated,
        },
        "4_review_evidence": {
          returned: stages["4_review_evidence"].length,
          truncated: reviewStage.truncated,
        },
        "5_promoted": { returned: stages["5_promoted"].length, truncated: false },
        "6_demoted": { returned: stages["6_demoted"].length, truncated: demotedStage.truncated },
      };

      const response: PipelineProjectionResponse = {
        meta: {
          schema_version: SCHEMA_VERSION,
          generated_at: new Date().toISOString(),
          limit,
          truncated: Object.values(stage_stats).some((stage) => stage.truncated),
          stage_stats,
          watermark_event_id: computeWatermarkEventId(stages),
        },
        stages,
      };

      return reply.code(200).send(response);
    } catch {
      const reason_code = "projection_unavailable";
      return reply.code(httpStatusForReasonCode(reason_code)).send(buildContractError(reason_code));
    }
  });
}
