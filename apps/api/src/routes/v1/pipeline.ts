import type { FastifyInstance } from "fastify";

import type { DbPool } from "../../db/pool.js";
import {
  buildContractError,
  httpStatusForReasonCode,
  type PipelineProjectionCursor,
  type PipelineProjectionResponseV2_1,
  type PipelineProjectionStages,
  type PipelineStageItem,
  type PipelineStageKey,
  type PipelineStageStats,
} from "../../contracts/pipeline_v2_contract.js";
import { SCHEMA_VERSION } from "../../contracts/schemaVersion.js";

type SnapshotRow = {
  entity_type: string;
  entity_id: string;
  title: string;
  status: string;
  room_id: string | null;
  thread_id: string | null;
  correlation_id: string;
  updated_at: string;
  last_event_id: string | null;
  link_experiment_id: string | null;
  link_approval_id: string | null;
  link_run_id: string | null;
  link_evidence_id: string | null;
  link_scorecard_id: string | null;
  link_incident_id: string | null;
  latest_run_id: string | null;
  latest_run_status: string | null;
  latest_evidence_id: string | null;
  latest_evidence_run_id: string | null;
  latest_evidence_status: string | null;
  latest_scorecard_status: string | null;
  latest_scorecard_run_id: string | null;
  latest_scorecard_evidence_id: string | null;
  incident_status: string | null;
  approval_requested: boolean;
  is_archived: boolean;
  is_deleted: boolean;
};

type LegacyFlatProjectionResponse = {
  schema_version: string;
  generated_at: string;
} & PipelineProjectionStages;

function getHeaderString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function workspaceIdFromReq(req: {
  headers: Record<string, unknown>;
  raw?: { rawHeaders?: string[] };
}): string | null {
  // Enforce client-provided workspace header using raw incoming headers only.
  const rawHeaders = req.raw?.rawHeaders;
  if (!Array.isArray(rawHeaders)) return null;

  let headerValue: string | undefined;
  for (let i = 0; i < rawHeaders.length - 1; i += 2) {
    if (rawHeaders[i]?.toLowerCase() === "x-workspace-id") {
      headerValue = rawHeaders[i + 1];
      break;
    }
  }
  const value = headerValue?.trim();
  return value && value.length > 0 ? value : null;
}

function parseLimit(raw: unknown): number {
  const n = Number(raw ?? "200");
  if (!Number.isFinite(n)) return 200;
  return Math.max(1, Math.min(200, Math.floor(n)));
}

function wantsEnvelopeFormat(raw: unknown): boolean {
  return typeof raw === "string" && raw.trim().toLowerCase() === "envelope";
}

function parseCursor(input: {
  cursor_updated_at?: string;
  cursor_entity_type?: string;
  cursor_entity_id?: string;
}): PipelineProjectionCursor | null {
  const updated_at = input.cursor_updated_at?.trim();
  const entity_type = input.cursor_entity_type?.trim();
  const entity_id = input.cursor_entity_id?.trim();
  const provided = [updated_at, entity_type, entity_id].filter((v) => (v ?? "").length > 0).length;
  if (provided === 0) return null;
  if (provided !== 3) {
    throw buildContractError("missing_required_field", {
      field: "cursor_updated_at,cursor_entity_type,cursor_entity_id",
    });
  }
  return {
    updated_at: updated_at as string,
    entity_type: entity_type as string,
    entity_id: entity_id as string,
  };
}

function compareStageItems(a: PipelineStageItem, b: PipelineStageItem): number {
  const ta = Date.parse(a.updated_at);
  const tb = Date.parse(b.updated_at);
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return tb - ta;
  if (a.entity_type !== b.entity_type) return a.entity_type.localeCompare(b.entity_type);
  return a.entity_id.localeCompare(b.entity_id);
}

function hasActiveIncident(status: string | null): boolean {
  if (!status) return false;
  return status === "open" || status === "opened" || status === "escalated";
}

function normalizeRunStatus(status: string | null): string | null {
  if (!status) return null;
  switch (status) {
    case "queued":
      return "created";
    case "running":
      return "started";
    case "succeeded":
      return "completed";
    default:
      return status;
  }
}

function normalizeScorecardStatus(status: string | null): string | null {
  if (!status) return null;
  if (status === "warn") return "pending";
  return status;
}

function isMissingRequiredState(row: SnapshotRow): boolean {
  if (!row.entity_type || !row.entity_id || !row.correlation_id) return true;
  if (!Number.isFinite(Date.parse(row.updated_at))) return true;
  return false;
}

function stageItemFromSnapshot(row: SnapshotRow, diagnostics: string[] = []): PipelineStageItem {
  return {
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    title: row.title ?? "",
    status: row.status,
    room_id: row.room_id,
    thread_id: row.thread_id,
    correlation_id: row.correlation_id,
    updated_at: row.updated_at,
    last_event_id: row.last_event_id,
    links: {
      experiment_id: row.link_experiment_id,
      approval_id: row.link_approval_id,
      run_id: row.link_run_id,
      evidence_id: row.link_evidence_id,
      scorecard_id: row.link_scorecard_id,
      incident_id: row.link_incident_id,
    },
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
  };
}

type StageResolution = { skip: true } | { stage: PipelineStageKey; diagnostics: string[] };

function resolvePipelineStage(row: SnapshotRow): StageResolution {
  if (row.is_archived || row.is_deleted) return { skip: true };

  if (isMissingRequiredState(row)) {
    return { stage: "1_inbox", diagnostics: ["missing_data"] };
  }

  const diagnostics: string[] = [];
  const incidentActive = hasActiveIncident(row.incident_status);
  const latestRunStatus = normalizeRunStatus(row.latest_run_status);
  const latestScorecardStatus = normalizeScorecardStatus(row.latest_scorecard_status);
  const latestEvidenceStatus = row.latest_evidence_status;

  if (incidentActive) return { stage: "6_demoted", diagnostics };

  if (latestRunStatus === "failed" || latestRunStatus === "timed_out" || latestRunStatus === "cancelled") {
    return { stage: "6_demoted", diagnostics };
  }

  if (latestScorecardStatus === "fail") return { stage: "6_demoted", diagnostics };

  if (latestEvidenceStatus === "rejected") return { stage: "3_execute_workspace", diagnostics };

  const runCompleted = latestRunStatus === "completed";
  const scorecardMissingOrPending = latestScorecardStatus == null || latestScorecardStatus === "pending";
  if (runCompleted && scorecardMissingOrPending) {
    return { stage: "4_review_evidence", diagnostics };
  }

  if (latestScorecardStatus === "pass") {
    const hasEvidence = Boolean(row.latest_evidence_id) && latestEvidenceStatus !== "rejected";
    const evidenceMatchesRun = Boolean(row.latest_run_id) && row.latest_evidence_run_id === row.latest_run_id;
    const scorecardRunMatches =
      row.latest_scorecard_run_id == null ||
      (row.latest_run_id != null && row.latest_scorecard_run_id === row.latest_run_id);
    const scorecardEvidenceMatches =
      row.latest_scorecard_evidence_id == null ||
      (row.latest_evidence_id != null && row.latest_scorecard_evidence_id === row.latest_evidence_id);
    if (runCompleted && hasEvidence && evidenceMatchesRun && scorecardRunMatches && scorecardEvidenceMatches && !incidentActive) {
      return { stage: "5_promoted", diagnostics };
    }
    diagnostics.push("ghost_evidence_or_mismatch");
    return { stage: "4_review_evidence", diagnostics };
  }

  if (latestEvidenceStatus === "created" || latestEvidenceStatus === "under_review") {
    return { stage: "4_review_evidence", diagnostics };
  }

  if (latestRunStatus === "created" || latestRunStatus === "started") {
    return { stage: "3_execute_workspace", diagnostics };
  }

  if (row.approval_requested) return { stage: "2_pending_approval", diagnostics };

  if (row.entity_type === "experiment" && row.status === "open") {
    return { stage: "1_inbox", diagnostics };
  }

  return { stage: "1_inbox", diagnostics: [...diagnostics, "unmatched_state"] };
}

async function fetchGeneratedAt(pool: DbPool): Promise<string> {
  const now = await pool.query<{ generated_at: string }>("SELECT now()::text AS generated_at");
  return now.rows[0]?.generated_at ?? new Date().toISOString();
}

async function fetchSnapshots(
  pool: DbPool,
  workspace_id: string,
  limit: number,
  cursor: PipelineProjectionCursor | null,
): Promise<SnapshotRow[]> {
  const args: unknown[] = [workspace_id];
  let cursorWhere = "";
  if (cursor) {
    args.push(cursor.updated_at, cursor.entity_type, cursor.entity_id);
    cursorWhere = `
      WHERE (
        updated_at < $2::timestamptz
        OR (updated_at = $2::timestamptz AND entity_type > $3)
        OR (updated_at = $2::timestamptz AND entity_type = $3 AND entity_id > $4)
      )`;
  }
  args.push(limit + 1);
  const limitParam = `$${args.length}`;

  const res = await pool.query<SnapshotRow>(
    `WITH experiment_snapshots AS (
       SELECT
         'experiment'::text AS entity_type,
         e.experiment_id AS entity_id,
         e.title AS title,
         e.status AS status,
         e.room_id AS room_id,
         NULL::text AS thread_id,
         e.correlation_id AS correlation_id,
         GREATEST(
           e.updated_at,
           COALESCE(lr.updated_at, '-infinity'::timestamptz),
           COALESCE(le.updated_at, '-infinity'::timestamptz),
           COALESCE(ls.updated_at, '-infinity'::timestamptz),
           COALESCE(li.updated_at, '-infinity'::timestamptz)
         ) AS updated_at,
         e.last_event_id AS last_event_id,
         e.experiment_id AS link_experiment_id,
         la.approval_id AS link_approval_id,
         lr.run_id AS link_run_id,
         le.evidence_id AS link_evidence_id,
         ls.scorecard_id AS link_scorecard_id,
         li.incident_id AS link_incident_id,
         lr.run_id AS latest_run_id,
         lr.status AS latest_run_status,
         le.evidence_id AS latest_evidence_id,
         le.run_id AS latest_evidence_run_id,
         CASE
           WHEN le.evidence_id IS NULL THEN NULL
           WHEN le.run_status = 'failed' THEN 'rejected'
           ELSE 'accepted'
         END AS latest_evidence_status,
         ls.decision AS latest_scorecard_status,
         ls.run_id AS latest_scorecard_run_id,
         ls.evidence_id AS latest_scorecard_evidence_id,
         li.status AS incident_status,
         (la.approval_id IS NOT NULL) AS approval_requested,
         (e.status IN ('closed', 'stopped')) AS is_archived,
         false AS is_deleted
       FROM proj_experiments AS e
       LEFT JOIN LATERAL (
         SELECT run_id, status, updated_at, created_at, correlation_id
         FROM proj_runs
         WHERE workspace_id = e.workspace_id
           AND experiment_id = e.experiment_id
         ORDER BY created_at DESC, run_id ASC
         LIMIT 1
       ) AS lr ON TRUE
       LEFT JOIN LATERAL (
         SELECT evidence_id, run_id, run_status, updated_at, created_at
         FROM proj_evidence_manifests
         WHERE workspace_id = e.workspace_id
           AND run_id = lr.run_id
         ORDER BY created_at DESC, evidence_id ASC
         LIMIT 1
       ) AS le ON TRUE
       LEFT JOIN LATERAL (
         SELECT scorecard_id, run_id, evidence_id, decision, updated_at, created_at
         FROM proj_scorecards
         WHERE workspace_id = e.workspace_id
           AND (
             experiment_id = e.experiment_id
             OR run_id = lr.run_id
             OR (le.evidence_id IS NOT NULL AND evidence_id = le.evidence_id)
           )
         ORDER BY created_at DESC, scorecard_id ASC
         LIMIT 1
       ) AS ls ON TRUE
       LEFT JOIN LATERAL (
         SELECT incident_id, status, updated_at
         FROM proj_incidents
         WHERE workspace_id = e.workspace_id
           AND run_id = lr.run_id
         ORDER BY updated_at DESC, incident_id ASC
         LIMIT 1
       ) AS li ON TRUE
       LEFT JOIN LATERAL (
         SELECT approval_id
         FROM proj_approvals
         WHERE workspace_id = e.workspace_id
           AND status IN ('pending', 'held')
           AND run_id = lr.run_id
         ORDER BY updated_at DESC, approval_id ASC
         LIMIT 1
       ) AS la ON TRUE
       WHERE e.workspace_id = $1
     ),
     run_snapshots AS (
       SELECT
         'run'::text AS entity_type,
         r.run_id AS entity_id,
         COALESCE(r.title, '') AS title,
         r.status AS status,
         r.room_id AS room_id,
         r.thread_id AS thread_id,
         r.correlation_id AS correlation_id,
         GREATEST(
           r.updated_at,
           COALESCE(le.updated_at, '-infinity'::timestamptz),
           COALESCE(ls.updated_at, '-infinity'::timestamptz),
           COALESCE(li.updated_at, '-infinity'::timestamptz)
         ) AS updated_at,
         r.last_event_id AS last_event_id,
         r.experiment_id AS link_experiment_id,
         la.approval_id AS link_approval_id,
         r.run_id AS link_run_id,
         le.evidence_id AS link_evidence_id,
         ls.scorecard_id AS link_scorecard_id,
         li.incident_id AS link_incident_id,
         r.run_id AS latest_run_id,
         r.status AS latest_run_status,
         le.evidence_id AS latest_evidence_id,
         le.run_id AS latest_evidence_run_id,
         CASE
           WHEN le.evidence_id IS NULL THEN NULL
           WHEN le.run_status = 'failed' THEN 'rejected'
           ELSE 'accepted'
         END AS latest_evidence_status,
         ls.decision AS latest_scorecard_status,
         ls.run_id AS latest_scorecard_run_id,
         ls.evidence_id AS latest_scorecard_evidence_id,
         li.status AS incident_status,
         (la.approval_id IS NOT NULL) AS approval_requested,
         (re.status IN ('closed', 'stopped')) AS is_archived,
         false AS is_deleted
       FROM proj_runs AS r
       LEFT JOIN proj_experiments AS re
         ON re.workspace_id = r.workspace_id
        AND re.experiment_id = r.experiment_id
       LEFT JOIN LATERAL (
         SELECT evidence_id, run_id, run_status, updated_at, created_at
         FROM proj_evidence_manifests
         WHERE workspace_id = r.workspace_id
           AND run_id = r.run_id
         ORDER BY created_at DESC, evidence_id ASC
         LIMIT 1
       ) AS le ON TRUE
       LEFT JOIN LATERAL (
         SELECT scorecard_id, run_id, evidence_id, decision, updated_at, created_at
         FROM proj_scorecards
         WHERE workspace_id = r.workspace_id
           AND (
             run_id = r.run_id
             OR (le.evidence_id IS NOT NULL AND evidence_id = le.evidence_id)
           )
         ORDER BY created_at DESC, scorecard_id ASC
         LIMIT 1
       ) AS ls ON TRUE
       LEFT JOIN LATERAL (
         SELECT incident_id, status, updated_at
         FROM proj_incidents
         WHERE workspace_id = r.workspace_id
           AND run_id = r.run_id
         ORDER BY updated_at DESC, incident_id ASC
         LIMIT 1
       ) AS li ON TRUE
       LEFT JOIN LATERAL (
         SELECT approval_id
         FROM proj_approvals
         WHERE workspace_id = r.workspace_id
           AND status IN ('pending', 'held')
           AND run_id = r.run_id
         ORDER BY updated_at DESC, approval_id ASC
         LIMIT 1
       ) AS la ON TRUE
       WHERE r.workspace_id = $1
     ),
     approval_snapshots AS (
       SELECT
         'approval'::text AS entity_type,
         a.approval_id AS entity_id,
         COALESCE(a.title, '') AS title,
         a.status AS status,
         a.room_id AS room_id,
         a.thread_id AS thread_id,
         a.correlation_id AS correlation_id,
         GREATEST(
           a.updated_at,
           COALESCE(r.updated_at, '-infinity'::timestamptz),
           COALESCE(le.updated_at, '-infinity'::timestamptz),
           COALESCE(ls.updated_at, '-infinity'::timestamptz),
           COALESCE(li.updated_at, '-infinity'::timestamptz)
         ) AS updated_at,
         a.last_event_id AS last_event_id,
         r.experiment_id AS link_experiment_id,
         a.approval_id AS link_approval_id,
         a.run_id AS link_run_id,
         le.evidence_id AS link_evidence_id,
         ls.scorecard_id AS link_scorecard_id,
         li.incident_id AS link_incident_id,
         r.run_id AS latest_run_id,
         r.status AS latest_run_status,
         le.evidence_id AS latest_evidence_id,
         le.run_id AS latest_evidence_run_id,
         CASE
           WHEN le.evidence_id IS NULL THEN NULL
           WHEN le.run_status = 'failed' THEN 'rejected'
           ELSE 'accepted'
         END AS latest_evidence_status,
         ls.decision AS latest_scorecard_status,
         ls.run_id AS latest_scorecard_run_id,
         ls.evidence_id AS latest_scorecard_evidence_id,
         li.status AS incident_status,
         true AS approval_requested,
         (re.status IN ('closed', 'stopped')) AS is_archived,
         false AS is_deleted
       FROM proj_approvals AS a
       LEFT JOIN proj_runs AS r
         ON r.workspace_id = a.workspace_id
        AND r.run_id = a.run_id
       LEFT JOIN proj_experiments AS re
         ON re.workspace_id = a.workspace_id
        AND re.experiment_id = r.experiment_id
       LEFT JOIN LATERAL (
         SELECT evidence_id, run_id, run_status, updated_at, created_at
         FROM proj_evidence_manifests
         WHERE workspace_id = a.workspace_id
           AND run_id = r.run_id
         ORDER BY created_at DESC, evidence_id ASC
         LIMIT 1
       ) AS le ON TRUE
       LEFT JOIN LATERAL (
         SELECT scorecard_id, run_id, evidence_id, decision, updated_at, created_at
         FROM proj_scorecards
         WHERE workspace_id = a.workspace_id
           AND (
             run_id = r.run_id
             OR (le.evidence_id IS NOT NULL AND evidence_id = le.evidence_id)
           )
         ORDER BY created_at DESC, scorecard_id ASC
         LIMIT 1
       ) AS ls ON TRUE
       LEFT JOIN LATERAL (
         SELECT incident_id, status, updated_at
         FROM proj_incidents
         WHERE workspace_id = a.workspace_id
           AND run_id = r.run_id
         ORDER BY updated_at DESC, incident_id ASC
         LIMIT 1
       ) AS li ON TRUE
       WHERE a.workspace_id = $1
         AND a.status IN ('pending', 'held')
     ),
     scorecard_orphan_snapshots AS (
       SELECT
         'scorecard'::text AS entity_type,
         s.scorecard_id AS entity_id,
         COALESCE(s.template_key, 'unknown') AS title,
         s.decision AS status,
         NULL::text AS room_id,
         NULL::text AS thread_id,
         s.correlation_id AS correlation_id,
         s.updated_at AS updated_at,
         s.last_event_id AS last_event_id,
         s.experiment_id AS link_experiment_id,
         NULL::text AS link_approval_id,
         s.run_id AS link_run_id,
         s.evidence_id AS link_evidence_id,
         s.scorecard_id AS link_scorecard_id,
         li.incident_id AS link_incident_id,
         r.run_id AS latest_run_id,
         r.status AS latest_run_status,
         evi.evidence_id AS latest_evidence_id,
         evi.run_id AS latest_evidence_run_id,
         CASE
           WHEN evi.evidence_id IS NULL THEN NULL
           WHEN evi.run_status = 'failed' THEN 'rejected'
           ELSE 'accepted'
         END AS latest_evidence_status,
         s.decision AS latest_scorecard_status,
         s.run_id AS latest_scorecard_run_id,
         s.evidence_id AS latest_scorecard_evidence_id,
         li.status AS incident_status,
         false AS approval_requested,
         (ex.status IN ('closed', 'stopped')) AS is_archived,
         false AS is_deleted
       FROM proj_scorecards AS s
       LEFT JOIN proj_runs AS r
         ON r.workspace_id = s.workspace_id
        AND r.run_id = s.run_id
       LEFT JOIN proj_experiments AS ex
         ON ex.workspace_id = s.workspace_id
        AND ex.experiment_id = COALESCE(s.experiment_id, r.experiment_id)
       LEFT JOIN proj_evidence_manifests AS evi
         ON evi.workspace_id = s.workspace_id
        AND evi.evidence_id = s.evidence_id
       LEFT JOIN LATERAL (
         SELECT incident_id, status
         FROM proj_incidents
         WHERE workspace_id = s.workspace_id
           AND run_id = s.run_id
         ORDER BY updated_at DESC, incident_id ASC
         LIMIT 1
       ) AS li ON TRUE
       WHERE s.workspace_id = $1
         AND s.run_id IS NULL
         AND s.experiment_id IS NULL
     ),
     all_snapshots AS (
       SELECT * FROM experiment_snapshots
       UNION ALL
       SELECT * FROM run_snapshots
       UNION ALL
       SELECT * FROM approval_snapshots
       UNION ALL
       SELECT * FROM scorecard_orphan_snapshots
     )
     SELECT
       entity_type,
       entity_id,
       title,
       status,
       room_id,
       thread_id,
       correlation_id,
       updated_at::text AS updated_at,
       last_event_id,
       link_experiment_id,
       link_approval_id,
       link_run_id,
       link_evidence_id,
       link_scorecard_id,
       link_incident_id,
       latest_run_id,
       latest_run_status,
       latest_evidence_id,
       latest_evidence_run_id,
       latest_evidence_status,
       latest_scorecard_status,
       latest_scorecard_run_id,
       latest_scorecard_evidence_id,
       incident_status,
       approval_requested,
       COALESCE(is_archived, false) AS is_archived,
       COALESCE(is_deleted, false) AS is_deleted
     FROM all_snapshots
     ${cursorWhere}
     ORDER BY updated_at DESC, entity_type ASC, entity_id ASC
     LIMIT ${limitParam}`,
    args,
  );
  return res.rows;
}

function computeWatermarkEventId(items: PipelineStageItem[]): string | null {
  if (items.length === 0) return null;
  for (const item of items) {
    if (item.last_event_id) return item.last_event_id;
  }
  return null;
}

function emptyStages(): PipelineProjectionStages {
  return {
    "1_inbox": [],
    "2_pending_approval": [],
    "3_execute_workspace": [],
    "4_review_evidence": [],
    "5_promoted": [],
    "6_demoted": [],
  };
}

function stageStats(stages: PipelineProjectionStages): PipelineStageStats {
  return {
    "1_inbox": { returned: stages["1_inbox"].length, truncated: false },
    "2_pending_approval": { returned: stages["2_pending_approval"].length, truncated: false },
    "3_execute_workspace": { returned: stages["3_execute_workspace"].length, truncated: false },
    "4_review_evidence": { returned: stages["4_review_evidence"].length, truncated: false },
    "5_promoted": { returned: stages["5_promoted"].length, truncated: false },
    "6_demoted": { returned: stages["6_demoted"].length, truncated: false },
  };
}

export async function registerPipelineRoutes(app: FastifyInstance, pool: DbPool): Promise<void> {
  app.get<{
    Querystring: {
      limit?: string;
      format?: string;
      cursor_updated_at?: string;
      cursor_entity_type?: string;
      cursor_entity_id?: string;
    };
  }>("/v1/pipeline/projection", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    if (!workspace_id) {
      const reason_code = "missing_workspace_header";
      return reply.code(httpStatusForReasonCode(reason_code)).send(buildContractError(reason_code));
    }

    let cursor: PipelineProjectionCursor | null = null;
    try {
      cursor = parseCursor(req.query);
    } catch (err) {
      const payload =
        err && typeof err === "object" && "reason_code" in err
          ? (err as ReturnType<typeof buildContractError>)
          : buildContractError("missing_required_field");
      return reply.code(httpStatusForReasonCode(payload.reason_code)).send(payload);
    }

    try {
      const limit = parseLimit(req.query.limit);
      const envelope = wantsEnvelopeFormat(req.query.format);
      const generated_at = await fetchGeneratedAt(pool);
      const rows = await fetchSnapshots(pool, workspace_id, limit, cursor);
      const truncated = rows.length > limit;
      const pageRows = truncated ? rows.slice(0, limit) : rows;
      const next_cursor =
        truncated && pageRows.length > 0
          ? {
              updated_at: pageRows[pageRows.length - 1].updated_at,
              entity_type: pageRows[pageRows.length - 1].entity_type,
              entity_id: pageRows[pageRows.length - 1].entity_id,
            }
          : null;

      const stages = emptyStages();
      const resolvedItems: PipelineStageItem[] = [];
      for (const row of pageRows) {
        const resolution = resolvePipelineStage(row);
        if ("skip" in resolution) continue;
        const item = stageItemFromSnapshot(row, resolution.diagnostics);
        stages[resolution.stage].push(item);
        resolvedItems.push(item);
      }

      for (const key of Object.keys(stages) as PipelineStageKey[]) {
        stages[key].sort(compareStageItems);
      }

      if (envelope) {
        const response: PipelineProjectionResponseV2_1 = {
          meta: {
            schema_version: SCHEMA_VERSION,
            workspace_id,
            generated_at,
            limit,
            truncated,
            next_cursor,
            stage_stats: stageStats(stages),
            watermark_event_id: computeWatermarkEventId(resolvedItems.sort(compareStageItems)),
          },
          stages,
        };
        return reply.code(200).send(response);
      }

      const flat: LegacyFlatProjectionResponse = {
        schema_version: SCHEMA_VERSION,
        generated_at,
        ...stages,
      };
      return reply.code(200).send(flat);
    } catch {
      const reason_code = "projection_unavailable";
      return reply.code(httpStatusForReasonCode(reason_code)).send(buildContractError(reason_code));
    }
  });
}
