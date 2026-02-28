import type {
  ExperimentClosedV1,
  ExperimentCreatedV1,
  ExperimentEventV1,
  ExperimentUpdatedV1,
} from "@agentapp/shared";

import type { DbClient, DbPool } from "../db/pool.js";
import { tryMarkApplied } from "./projectorDb.js";

export const EXPERIMENT_PROJECTOR_NAME = "experiments";

function toJsonb(value: unknown): string {
  return JSON.stringify(value ?? {});
}

async function applyInTx(tx: DbClient, event: ExperimentEventV1): Promise<void> {
  const applied = await tryMarkApplied(tx, EXPERIMENT_PROJECTOR_NAME, event.event_id);
  if (!applied) return;

  switch (event.event_type) {
    case "experiment.created":
      await applyExperimentCreated(tx, event as ExperimentCreatedV1);
      return;
    case "experiment.updated":
      await applyExperimentUpdated(tx, event as ExperimentUpdatedV1);
      return;
    case "experiment.closed":
      await applyExperimentClosed(tx, event as ExperimentClosedV1);
      return;
  }
}

async function applyExperimentCreated(tx: DbClient, event: ExperimentCreatedV1): Promise<void> {
  if (!event.workspace_id) throw new Error("experiment.created requires workspace_id");
  if (!event.data.experiment_id) throw new Error("experiment.created requires experiment_id");
  if (!event.data.title?.trim()) throw new Error("experiment.created requires title");
  if (!event.data.hypothesis?.trim()) throw new Error("experiment.created requires hypothesis");

  await tx.query(
    `INSERT INTO proj_experiments (
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
      last_event_id,
      last_event_occurred_at
    ) VALUES (
      $1,$2,$3,'open',$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10::jsonb,$11,$12,$13,NULL,$13,$14,$15,$13
    )
    ON CONFLICT (experiment_id) DO UPDATE SET
      status = CASE
        WHEN proj_experiments.last_event_occurred_at IS NULL OR proj_experiments.last_event_occurred_at <= EXCLUDED.last_event_occurred_at
        THEN EXCLUDED.status
        ELSE proj_experiments.status
      END,
      title = CASE
        WHEN proj_experiments.last_event_occurred_at IS NULL OR proj_experiments.last_event_occurred_at <= EXCLUDED.last_event_occurred_at
        THEN EXCLUDED.title
        ELSE proj_experiments.title
      END,
      hypothesis = CASE
        WHEN proj_experiments.last_event_occurred_at IS NULL OR proj_experiments.last_event_occurred_at <= EXCLUDED.last_event_occurred_at
        THEN EXCLUDED.hypothesis
        ELSE proj_experiments.hypothesis
      END,
      success_criteria = CASE
        WHEN proj_experiments.last_event_occurred_at IS NULL OR proj_experiments.last_event_occurred_at <= EXCLUDED.last_event_occurred_at
        THEN EXCLUDED.success_criteria
        ELSE proj_experiments.success_criteria
      END,
      stop_conditions = CASE
        WHEN proj_experiments.last_event_occurred_at IS NULL OR proj_experiments.last_event_occurred_at <= EXCLUDED.last_event_occurred_at
        THEN EXCLUDED.stop_conditions
        ELSE proj_experiments.stop_conditions
      END,
      budget_cap_units = CASE
        WHEN proj_experiments.last_event_occurred_at IS NULL OR proj_experiments.last_event_occurred_at <= EXCLUDED.last_event_occurred_at
        THEN EXCLUDED.budget_cap_units
        ELSE proj_experiments.budget_cap_units
      END,
      risk_tier = CASE
        WHEN proj_experiments.last_event_occurred_at IS NULL OR proj_experiments.last_event_occurred_at <= EXCLUDED.last_event_occurred_at
        THEN EXCLUDED.risk_tier
        ELSE proj_experiments.risk_tier
      END,
      metadata = CASE
        WHEN proj_experiments.last_event_occurred_at IS NULL OR proj_experiments.last_event_occurred_at <= EXCLUDED.last_event_occurred_at
        THEN EXCLUDED.metadata
        ELSE proj_experiments.metadata
      END,
      created_at = LEAST(proj_experiments.created_at, EXCLUDED.created_at),
      updated_at = GREATEST(proj_experiments.updated_at, EXCLUDED.updated_at),
      correlation_id = CASE
        WHEN proj_experiments.correlation_id = 'unknown' THEN EXCLUDED.correlation_id
        ELSE proj_experiments.correlation_id
      END,
      last_event_id = CASE
        WHEN proj_experiments.last_event_occurred_at IS NULL OR proj_experiments.last_event_occurred_at <= EXCLUDED.last_event_occurred_at
        THEN EXCLUDED.last_event_id
        ELSE proj_experiments.last_event_id
      END,
      last_event_occurred_at = GREATEST(
        COALESCE(proj_experiments.last_event_occurred_at, '-infinity'::timestamptz),
        EXCLUDED.last_event_occurred_at
      )`,
    [
      event.data.experiment_id,
      event.workspace_id,
      event.room_id ?? null,
      event.data.title,
      event.data.hypothesis,
      toJsonb(event.data.success_criteria),
      toJsonb(event.data.stop_conditions),
      event.data.budget_cap_units,
      event.data.risk_tier,
      toJsonb(event.data.metadata),
      event.actor.actor_type,
      event.actor.actor_id,
      event.occurred_at,
      event.correlation_id,
      event.event_id,
    ],
  );
}

async function applyExperimentUpdated(tx: DbClient, event: ExperimentUpdatedV1): Promise<void> {
  if (!event.data.experiment_id) throw new Error("experiment.updated requires experiment_id");
  const workspace_id = event.workspace_id || "unknown";

  const res = await tx.query(
    `UPDATE proj_experiments
     SET
       title = COALESCE($2, title),
       hypothesis = COALESCE($3, hypothesis),
       success_criteria = CASE WHEN $4::jsonb = '{}'::jsonb THEN success_criteria ELSE $4::jsonb END,
       stop_conditions = CASE WHEN $5::jsonb = '{}'::jsonb THEN stop_conditions ELSE $5::jsonb END,
       budget_cap_units = COALESCE($6, budget_cap_units),
       risk_tier = COALESCE($7, risk_tier),
       metadata = CASE WHEN $8::jsonb = '{}'::jsonb THEN metadata ELSE $8::jsonb END,
       updated_at = $9,
       last_event_id = $10,
       last_event_occurred_at = $9
     WHERE experiment_id = $1
       AND workspace_id = $11
       AND (last_event_occurred_at IS NULL OR last_event_occurred_at < $9)`,
    [
      event.data.experiment_id,
      event.data.title ?? null,
      event.data.hypothesis ?? null,
      toJsonb(event.data.success_criteria),
      toJsonb(event.data.stop_conditions),
      event.data.budget_cap_units ?? null,
      event.data.risk_tier ?? null,
      toJsonb(event.data.metadata),
      event.occurred_at,
      event.event_id,
      workspace_id,
    ],
  );
  if (res.rowCount === 0) {
    await tx.query(
      `INSERT INTO proj_experiments (
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
        last_event_id,
        last_event_occurred_at
      ) VALUES (
        $1,$2,NULL,'open',$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9::jsonb,'service','projector',$10,NULL,$10,$11,$12,$10
      )
      ON CONFLICT (experiment_id) DO NOTHING`,
      [
        event.data.experiment_id,
        workspace_id,
        event.data.title ?? "unknown",
        event.data.hypothesis ?? "unknown",
        toJsonb(event.data.success_criteria),
        toJsonb(event.data.stop_conditions),
        event.data.budget_cap_units ?? 0,
        event.data.risk_tier ?? "low",
        toJsonb(event.data.metadata),
        event.occurred_at,
        event.correlation_id || `unknown:${event.data.experiment_id}`,
        event.event_id,
      ],
    );
  }
}

async function applyExperimentClosed(tx: DbClient, event: ExperimentClosedV1): Promise<void> {
  if (!event.data.experiment_id) throw new Error("experiment.closed requires experiment_id");
  const workspace_id = event.workspace_id || "unknown";

  const res = await tx.query(
    `UPDATE proj_experiments
     SET
       status = $2,
       closed_at = COALESCE(closed_at, $3),
       updated_at = $3,
       last_event_id = $4,
       last_event_occurred_at = $3
     WHERE experiment_id = $1
       AND workspace_id = $5
       AND (last_event_occurred_at IS NULL OR last_event_occurred_at < $3)
       AND status = 'open'`,
    [event.data.experiment_id, event.data.status, event.occurred_at, event.event_id, workspace_id],
  );
  if (res.rowCount === 0) {
    await tx.query(
      `INSERT INTO proj_experiments (
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
        last_event_id,
        last_event_occurred_at
      ) VALUES (
        $1,$2,NULL,$3,'unknown','unknown','{}'::jsonb,'{}'::jsonb,0,'low','{}'::jsonb,'service','projector',$4,$4,$4,$5,$6,$4
      )
      ON CONFLICT (experiment_id) DO NOTHING`,
      [
        event.data.experiment_id,
        workspace_id,
        event.data.status,
        event.occurred_at,
        event.correlation_id || `unknown:${event.data.experiment_id}`,
        event.event_id,
      ],
    );
  }
}

export async function applyExperimentEvent(pool: DbPool, envelope: ExperimentEventV1): Promise<void> {
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
