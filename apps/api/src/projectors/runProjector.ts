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
      workspace_id, room_id, thread_id, experiment_id,
      status,
      title, goal, input, tags,
      created_at, started_at, ended_at, updated_at,
      correlation_id,
      last_event_id,
      last_event_occurred_at
    ) VALUES (
      $1,
      $2, $3, $4, $5,
      'queued',
      $6, $7, $8::jsonb, $9,
      $10, NULL, NULL, $11,
      $12,
      $13,
      $11
    )
    ON CONFLICT (run_id) DO UPDATE SET
      workspace_id = COALESCE(proj_runs.workspace_id, EXCLUDED.workspace_id),
      room_id = COALESCE(proj_runs.room_id, EXCLUDED.room_id),
      thread_id = COALESCE(proj_runs.thread_id, EXCLUDED.thread_id),
      experiment_id = COALESCE(proj_runs.experiment_id, EXCLUDED.experiment_id),
      title = COALESCE(proj_runs.title, EXCLUDED.title),
      goal = COALESCE(proj_runs.goal, EXCLUDED.goal),
      input = CASE WHEN proj_runs.input = '{}'::jsonb THEN EXCLUDED.input ELSE proj_runs.input END,
      tags = CASE WHEN proj_runs.tags = '{}'::text[] THEN EXCLUDED.tags ELSE proj_runs.tags END,
      created_at = LEAST(proj_runs.created_at, EXCLUDED.created_at),
      updated_at = GREATEST(proj_runs.updated_at, EXCLUDED.updated_at),
      correlation_id = CASE WHEN proj_runs.correlation_id = 'unknown' THEN EXCLUDED.correlation_id ELSE proj_runs.correlation_id END,
      last_event_id = CASE
        WHEN proj_runs.last_event_occurred_at IS NULL OR proj_runs.last_event_occurred_at <= EXCLUDED.last_event_occurred_at
        THEN EXCLUDED.last_event_id
        ELSE proj_runs.last_event_id
      END,
      last_event_occurred_at = GREATEST(COALESCE(proj_runs.last_event_occurred_at, '-infinity'::timestamptz), EXCLUDED.last_event_occurred_at)`,
    [
      run_id,
      event.workspace_id,
      event.room_id ?? null,
      event.thread_id ?? null,
      event.data.experiment_id ?? null,
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
  const workspace_id = event.workspace_id || "unknown";
  const correlation_id = event.correlation_id || `unknown:${event.run_id}`;

  const res = await tx.query(
    `UPDATE proj_runs
    SET
      status = 'running',
      started_at = COALESCE(started_at, $2),
      updated_at = $2,
      last_event_id = $3,
      last_event_occurred_at = $2
    WHERE run_id = $1
      AND (last_event_occurred_at IS NULL OR last_event_occurred_at < $2)`,
    [event.run_id, event.occurred_at, event.event_id],
  );

  if (res.rowCount === 0) {
    await tx.query(
      `INSERT INTO proj_runs (
        run_id,
        workspace_id, room_id, thread_id, experiment_id,
        status,
        title, goal, input, output, error, tags,
        created_at, started_at, ended_at, updated_at,
        correlation_id,
        last_event_id,
        last_event_occurred_at
      ) VALUES (
        $1,$2,NULL,NULL,NULL,
        'running',
        'unknown', NULL, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::text[],
        $3,$3,NULL,$3,
        $4,
        $5,
        $3
      )
      ON CONFLICT (run_id) DO NOTHING`,
      [event.run_id, workspace_id, event.occurred_at, correlation_id, event.event_id],
    );
  }
}

async function applyRunCompleted(tx: DbClient, event: RunCompletedV1): Promise<void> {
  if (!event.run_id) throw new Error("run.completed requires run_id");
  const workspace_id = event.workspace_id || "unknown";
  const correlation_id = event.correlation_id || `unknown:${event.run_id}`;

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
      last_event_id = $4,
      last_event_occurred_at = $3
    WHERE run_id = $1
      AND (last_event_occurred_at IS NULL OR last_event_occurred_at < $3)`,
    [event.run_id, toJsonb(event.data.output), event.occurred_at, event.event_id],
  );

  if (res.rowCount === 0) {
    await tx.query(
      `INSERT INTO proj_runs (
        run_id,
        workspace_id, room_id, thread_id, experiment_id,
        status,
        title, goal, input, output, error, tags,
        created_at, started_at, ended_at, updated_at,
        correlation_id,
        last_event_id,
        last_event_occurred_at
      ) VALUES (
        $1,$2,NULL,NULL,NULL,
        'succeeded',
        'unknown', NULL, '{}'::jsonb, $3::jsonb, '{}'::jsonb, '{}'::text[],
        $4,NULL,$4,$4,
        $5,
        $6,
        $4
      )
      ON CONFLICT (run_id) DO NOTHING`,
      [event.run_id, workspace_id, toJsonb(event.data.output), event.occurred_at, correlation_id, event.event_id],
    );
  }
}

async function applyRunFailed(tx: DbClient, event: RunFailedV1): Promise<void> {
  if (!event.run_id) throw new Error("run.failed requires run_id");
  const workspace_id = event.workspace_id || "unknown";
  const correlation_id = event.correlation_id || `unknown:${event.run_id}`;

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
      last_event_id = $4,
      last_event_occurred_at = $3
    WHERE run_id = $1
      AND (last_event_occurred_at IS NULL OR last_event_occurred_at < $3)`,
    [event.run_id, toJsonb(error), event.occurred_at, event.event_id],
  );

  if (res.rowCount === 0) {
    await tx.query(
      `INSERT INTO proj_runs (
        run_id,
        workspace_id, room_id, thread_id, experiment_id,
        status,
        title, goal, input, output, error, tags,
        created_at, started_at, ended_at, updated_at,
        correlation_id,
        last_event_id,
        last_event_occurred_at
      ) VALUES (
        $1,$2,NULL,NULL,NULL,
        'failed',
        'unknown', NULL, '{}'::jsonb, '{}'::jsonb, $3::jsonb, '{}'::text[],
        $4,NULL,$4,$4,
        $5,
        $6,
        $4
      )
      ON CONFLICT (run_id) DO NOTHING`,
      [event.run_id, workspace_id, toJsonb(error), event.occurred_at, correlation_id, event.event_id],
    );
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
  await tx.query(
    `UPDATE proj_runs
    SET
      updated_at = $2,
      last_event_id = $3,
      last_event_occurred_at = $2
    WHERE run_id = $1
      AND (last_event_occurred_at IS NULL OR last_event_occurred_at < $2)`,
    [event.run_id, event.occurred_at, event.event_id],
  );
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
