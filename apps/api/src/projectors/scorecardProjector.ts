import type { LessonLoggedV1, ScorecardEventV1, ScorecardRecordedV1 } from "@agentapp/shared";

import type { DbClient, DbPool } from "../db/pool.js";
import { tryMarkApplied } from "./projectorDb.js";

export const SCORECARD_PROJECTOR_NAME = "scorecards";

function toJsonb(value: unknown): string {
  return JSON.stringify(value ?? {});
}

async function existsInTable(
  tx: DbClient,
  table: "proj_experiments" | "proj_runs" | "proj_evidence_manifests" | "sec_agents" | "sec_principals" | "proj_scorecards" | "proj_incidents",
  idColumn: string,
  idValue: string | null | undefined,
  workspace_id?: string,
): Promise<string | null> {
  if (!idValue) return null;
  const query = workspace_id
    ? `SELECT 1
       FROM ${table}
       WHERE ${idColumn} = $1
         AND workspace_id = $2
       LIMIT 1`
    : `SELECT 1
       FROM ${table}
       WHERE ${idColumn} = $1
       LIMIT 1`;
  const args = workspace_id ? [idValue, workspace_id] : [idValue];
  const found = await tx.query(query, args);
  return found.rowCount === 1 ? idValue : null;
}

async function applyInTx(tx: DbClient, event: ScorecardEventV1): Promise<void> {
  const applied = await tryMarkApplied(tx, SCORECARD_PROJECTOR_NAME, event.event_id);
  if (!applied) return;

  switch (event.event_type) {
    case "scorecard.recorded":
      await applyScorecardRecorded(tx, event as ScorecardRecordedV1);
      return;
    case "lesson.logged":
      await applyLessonLogged(tx, event as LessonLoggedV1);
      return;
  }
}

async function applyScorecardRecorded(tx: DbClient, event: ScorecardRecordedV1): Promise<void> {
  if (!event.workspace_id) throw new Error("scorecard.recorded requires workspace_id");
  if (!event.data.scorecard_id) throw new Error("scorecard.recorded requires scorecard_id");
  if (!event.data.template_key?.trim()) throw new Error("scorecard.recorded requires template_key");
  if (!event.data.template_version?.trim()) {
    throw new Error("scorecard.recorded requires template_version");
  }

  const experiment_id = await existsInTable(
    tx,
    "proj_experiments",
    "experiment_id",
    event.data.experiment_id ?? null,
    event.workspace_id,
  );
  const run_id = await existsInTable(tx, "proj_runs", "run_id", event.data.run_id ?? null, event.workspace_id);
  const evidence_id = await existsInTable(
    tx,
    "proj_evidence_manifests",
    "evidence_id",
    event.data.evidence_id ?? null,
    event.workspace_id,
  );
  const agent_id = await existsInTable(tx, "sec_agents", "agent_id", event.data.agent_id ?? null);
  const principal_id = await existsInTable(tx, "sec_principals", "principal_id", event.data.principal_id ?? null);

  await tx.query(
    `INSERT INTO proj_scorecards (
      scorecard_id,
      workspace_id,
      experiment_id,
      run_id,
      evidence_id,
      agent_id,
      principal_id,
      template_key,
      template_version,
      metrics,
      metrics_hash,
      score,
      decision,
      rationale,
      metadata,
      created_by_type,
      created_by_id,
      created_at,
      updated_at,
      correlation_id,
      last_event_id,
      last_event_occurred_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15::jsonb,$16,$17,$18,$18,$19,$20,$18
    )
    ON CONFLICT (scorecard_id) DO UPDATE SET
      decision = CASE
        WHEN proj_scorecards.last_event_occurred_at IS NULL OR proj_scorecards.last_event_occurred_at <= EXCLUDED.last_event_occurred_at
        THEN EXCLUDED.decision
        ELSE proj_scorecards.decision
      END,
      metrics = CASE
        WHEN proj_scorecards.last_event_occurred_at IS NULL OR proj_scorecards.last_event_occurred_at <= EXCLUDED.last_event_occurred_at
        THEN EXCLUDED.metrics
        ELSE proj_scorecards.metrics
      END,
      metrics_hash = CASE
        WHEN proj_scorecards.last_event_occurred_at IS NULL OR proj_scorecards.last_event_occurred_at <= EXCLUDED.last_event_occurred_at
        THEN EXCLUDED.metrics_hash
        ELSE proj_scorecards.metrics_hash
      END,
      score = CASE
        WHEN proj_scorecards.last_event_occurred_at IS NULL OR proj_scorecards.last_event_occurred_at <= EXCLUDED.last_event_occurred_at
        THEN EXCLUDED.score
        ELSE proj_scorecards.score
      END,
      rationale = CASE
        WHEN proj_scorecards.last_event_occurred_at IS NULL OR proj_scorecards.last_event_occurred_at <= EXCLUDED.last_event_occurred_at
        THEN EXCLUDED.rationale
        ELSE proj_scorecards.rationale
      END,
      metadata = CASE
        WHEN proj_scorecards.last_event_occurred_at IS NULL OR proj_scorecards.last_event_occurred_at <= EXCLUDED.last_event_occurred_at
        THEN EXCLUDED.metadata
        ELSE proj_scorecards.metadata
      END,
      updated_at = GREATEST(proj_scorecards.updated_at, EXCLUDED.updated_at),
      last_event_id = CASE
        WHEN proj_scorecards.last_event_occurred_at IS NULL OR proj_scorecards.last_event_occurred_at <= EXCLUDED.last_event_occurred_at
        THEN EXCLUDED.last_event_id
        ELSE proj_scorecards.last_event_id
      END,
      last_event_occurred_at = GREATEST(
        COALESCE(proj_scorecards.last_event_occurred_at, '-infinity'::timestamptz),
        EXCLUDED.last_event_occurred_at
      )`,
    [
      event.data.scorecard_id,
      event.workspace_id,
      experiment_id,
      run_id,
      evidence_id,
      agent_id,
      principal_id,
      event.data.template_key,
      event.data.template_version,
      toJsonb(event.data.metrics),
      event.data.metrics_hash,
      event.data.score,
      event.data.decision,
      event.data.rationale ?? null,
      toJsonb(event.data.metadata),
      event.actor.actor_type,
      event.actor.actor_id,
      event.occurred_at,
      event.correlation_id,
      event.event_id,
    ],
  );
}

async function applyLessonLogged(tx: DbClient, event: LessonLoggedV1): Promise<void> {
  if (!event.workspace_id) throw new Error("lesson.logged requires workspace_id");
  if (!event.data.lesson_id) throw new Error("lesson.logged requires lesson_id");
  if (!event.data.category?.trim()) throw new Error("lesson.logged requires category");
  if (!event.data.summary?.trim()) throw new Error("lesson.logged requires summary");

  const experiment_id = await existsInTable(
    tx,
    "proj_experiments",
    "experiment_id",
    event.data.experiment_id ?? null,
    event.workspace_id,
  );
  const run_id = await existsInTable(tx, "proj_runs", "run_id", event.data.run_id ?? null, event.workspace_id);
  const scorecard_id = await existsInTable(
    tx,
    "proj_scorecards",
    "scorecard_id",
    event.data.scorecard_id ?? null,
    event.workspace_id,
  );
  const incident_id = await existsInTable(
    tx,
    "proj_incidents",
    "incident_id",
    event.data.incident_id ?? null,
    event.workspace_id,
  );

  await tx.query(
    `INSERT INTO proj_lessons (
      lesson_id,
      workspace_id,
      experiment_id,
      run_id,
      scorecard_id,
      incident_id,
      category,
      summary,
      action_items,
      tags,
      metadata,
      created_by_type,
      created_by_id,
      created_at,
      updated_at,
      correlation_id,
      last_event_id
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb,$12,$13,$14,$14,$15,$16
    )
    ON CONFLICT (lesson_id) DO NOTHING`,
    [
      event.data.lesson_id,
      event.workspace_id,
      experiment_id,
      run_id,
      scorecard_id,
      incident_id,
      event.data.category,
      event.data.summary,
      toJsonb(event.data.action_items ?? []),
      event.data.tags ?? [],
      toJsonb(event.data.metadata),
      event.actor.actor_type,
      event.actor.actor_id,
      event.occurred_at,
      event.correlation_id,
      event.event_id,
    ],
  );
}

export async function applyScorecardEvent(pool: DbPool, envelope: ScorecardEventV1): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await applyInTx(client, envelope);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
