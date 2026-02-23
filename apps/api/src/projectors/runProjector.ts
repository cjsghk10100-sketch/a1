import type {
  RunCompletedV1,
  RunCreatedV1,
  RunEventV1,
  RunFailedV1,
  RunStartedV1,
  StepCreatedV1,
} from "@agentapp/shared";

import type { DbClient, DbPool } from "../db/pool.js";
import { tryMarkApplied } from "./projectorDb.js";

export const RUN_PROJECTOR_NAME = "runs";

function toJsonb(value: unknown): string {
  return JSON.stringify(value ?? {});
}

async function applyInTx(tx: DbClient, event: RunEventV1): Promise<void> {
  const applied = await tryMarkApplied(tx, RUN_PROJECTOR_NAME, event.event_id);
  if (!applied) return;

  switch (event.event_type) {
    case "run.created":
      await applyRunCreated(tx, event as RunCreatedV1);
      return;
    case "run.started":
      await applyRunStarted(tx, event as RunStartedV1);
      return;
    case "run.completed":
      await applyRunCompleted(tx, event as RunCompletedV1);
      return;
    case "run.failed":
      await applyRunFailed(tx, event as RunFailedV1);
      return;
    case "step.created":
      await applyStepCreated(tx, event as StepCreatedV1);
      return;
  }
}

async function applyRunCreated(tx: DbClient, event: RunCreatedV1): Promise<void> {
  const run_id = event.data.run_id;
  if (!run_id) throw new Error("run.created requires run_id");
  if (!event.workspace_id) throw new Error("run.created requires workspace_id");

  const tags = event.data.tags ?? [];

  await tx.query(
    `INSERT INTO proj_runs (
      run_id,
      workspace_id, room_id, thread_id,
      status,
      title, goal, input, tags,
      created_at, started_at, ended_at, updated_at,
      correlation_id,
      last_event_id
    ) VALUES (
      $1,
      $2, $3, $4,
      'queued',
      $5, $6, $7::jsonb, $8,
      $9, NULL, NULL, $10,
      $11,
      $12
    )
    ON CONFLICT (run_id) DO NOTHING`,
    [
      run_id,
      event.workspace_id,
      event.room_id ?? null,
      event.thread_id ?? null,
      event.data.title ?? null,
      event.data.goal ?? null,
      toJsonb(event.data.input),
      tags,
      event.occurred_at,
      event.occurred_at,
      event.correlation_id,
      event.event_id,
    ],
  );
}

async function applyRunStarted(tx: DbClient, event: RunStartedV1): Promise<void> {
  if (!event.run_id) throw new Error("run.started requires run_id");

  const res = await tx.query(
    `UPDATE proj_runs
    SET
      status = 'running',
      started_at = COALESCE(started_at, $2),
      updated_at = $2,
      last_event_id = $3
    WHERE run_id = $1`,
    [event.run_id, event.occurred_at, event.event_id],
  );

  if (res.rowCount !== 1) {
    throw new Error("run.started target not found in proj_runs");
  }
}

async function applyRunCompleted(tx: DbClient, event: RunCompletedV1): Promise<void> {
  if (!event.run_id) throw new Error("run.completed requires run_id");

  const res = await tx.query(
    `UPDATE proj_runs
    SET
      status = 'succeeded',
      output = $2::jsonb,
      claim_token = NULL,
      claimed_by_actor_id = NULL,
      lease_expires_at = NULL,
      lease_heartbeat_at = NULL,
      ended_at = COALESCE(ended_at, $3),
      updated_at = $3,
      last_event_id = $4
    WHERE run_id = $1`,
    [event.run_id, toJsonb(event.data.output), event.occurred_at, event.event_id],
  );

  if (res.rowCount !== 1) {
    throw new Error("run.completed target not found in proj_runs");
  }
}

async function applyRunFailed(tx: DbClient, event: RunFailedV1): Promise<void> {
  if (!event.run_id) throw new Error("run.failed requires run_id");

  const error =
    event.data.error ??
    (event.data.message ? { message: event.data.message } : undefined);

  const res = await tx.query(
    `UPDATE proj_runs
    SET
      status = 'failed',
      error = $2::jsonb,
      claim_token = NULL,
      claimed_by_actor_id = NULL,
      lease_expires_at = NULL,
      lease_heartbeat_at = NULL,
      ended_at = COALESCE(ended_at, $3),
      updated_at = $3,
      last_event_id = $4
    WHERE run_id = $1`,
    [event.run_id, toJsonb(error), event.occurred_at, event.event_id],
  );

  if (res.rowCount !== 1) {
    throw new Error("run.failed target not found in proj_runs");
  }
}

async function applyStepCreated(tx: DbClient, event: StepCreatedV1): Promise<void> {
  if (!event.run_id) throw new Error("step.created requires run_id");
  const step_id = event.data.step_id;
  if (!step_id) throw new Error("step.created requires step_id");
  if (!event.data.kind?.trim()) throw new Error("step.created requires kind");

  await tx.query(
    `INSERT INTO proj_steps (
      step_id,
      run_id, workspace_id, room_id, thread_id,
      kind, status,
      title, input,
      output, error,
      created_at, updated_at,
      last_event_id
    ) VALUES (
      $1,
      $2, $3, $4, $5,
      $6, 'queued',
      $7, $8::jsonb,
      '{}'::jsonb, '{}'::jsonb,
      $9, $10,
      $11
    )
    ON CONFLICT (step_id) DO NOTHING`,
    [
      step_id,
      event.run_id,
      event.workspace_id,
      event.room_id ?? null,
      event.thread_id ?? null,
      event.data.kind,
      event.data.title ?? null,
      toJsonb(event.data.input),
      event.occurred_at,
      event.occurred_at,
      event.event_id,
    ],
  );

  // Touch the run for activity ordering and causation chaining.
  const res = await tx.query(
    `UPDATE proj_runs
    SET
      updated_at = $2,
      last_event_id = $3
    WHERE run_id = $1`,
    [event.run_id, event.occurred_at, event.event_id],
  );
  if (res.rowCount !== 1) {
    throw new Error("step.created run target not found in proj_runs");
  }
}

export async function applyRunEvent(pool: DbPool, envelope: RunEventV1): Promise<void> {
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
