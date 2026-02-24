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
      last_event_id
    ) VALUES (
      $1,$2,$3,'open',$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10::jsonb,$11,$12,$13,NULL,$13,$14,$15
    )
    ON CONFLICT (experiment_id) DO NOTHING`,
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
       last_event_id = $10
     WHERE experiment_id = $1`,
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
    ],
  );
  if (res.rowCount !== 1) {
    throw new Error("experiment.updated target not found in proj_experiments");
  }
}

async function applyExperimentClosed(tx: DbClient, event: ExperimentClosedV1): Promise<void> {
  if (!event.data.experiment_id) throw new Error("experiment.closed requires experiment_id");

  const res = await tx.query(
    `UPDATE proj_experiments
     SET
       status = $2,
       closed_at = COALESCE(closed_at, $3),
       updated_at = $3,
       last_event_id = $4
     WHERE experiment_id = $1
       AND status = 'open'`,
    [event.data.experiment_id, event.data.status, event.occurred_at, event.event_id],
  );
  if (res.rowCount !== 1) {
    throw new Error("experiment.closed target not open in proj_experiments");
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
