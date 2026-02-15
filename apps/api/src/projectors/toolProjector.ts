import type { ToolEventV1, ToolFailedV1, ToolInvokedV1, ToolSucceededV1 } from "@agentapp/shared";

import type { DbClient, DbPool } from "../db/pool.js";
import { tryMarkApplied } from "./projectorDb.js";

export const TOOL_PROJECTOR_NAME = "tools";

function toJsonb(value: unknown): string {
  return JSON.stringify(value ?? {});
}

async function applyInTx(tx: DbClient, event: ToolEventV1): Promise<void> {
  const applied = await tryMarkApplied(tx, TOOL_PROJECTOR_NAME, event.event_id);
  if (!applied) return;

  switch (event.event_type) {
    case "tool.invoked":
      await applyToolInvoked(tx, event as ToolInvokedV1);
      return;
    case "tool.succeeded":
      await applyToolSucceeded(tx, event as ToolSucceededV1);
      return;
    case "tool.failed":
      await applyToolFailed(tx, event as ToolFailedV1);
      return;
  }
}

async function applyToolInvoked(tx: DbClient, event: ToolInvokedV1): Promise<void> {
  if (!event.run_id) throw new Error("tool.invoked requires run_id");
  if (!event.step_id) throw new Error("tool.invoked requires step_id");
  if (!event.data.tool_call_id) throw new Error("tool.invoked requires tool_call_id");
  if (!event.data.tool_name?.trim()) throw new Error("tool.invoked requires tool_name");

  await tx.query(
    `INSERT INTO proj_tool_calls (
      tool_call_id,
      workspace_id, room_id, thread_id, run_id, step_id,
      tool_name, title,
      status,
      input,
      started_at, ended_at, updated_at,
      correlation_id,
      last_event_id
    ) VALUES (
      $1,
      $2, $3, $4, $5, $6,
      $7, $8,
      'running',
      $9::jsonb,
      $10, NULL, $11,
      $12,
      $13
    )
    ON CONFLICT (tool_call_id) DO NOTHING`,
    [
      event.data.tool_call_id,
      event.workspace_id,
      event.room_id ?? null,
      event.thread_id ?? null,
      event.run_id,
      event.step_id,
      event.data.tool_name,
      event.data.title ?? null,
      toJsonb(event.data.input),
      event.occurred_at,
      event.occurred_at,
      event.correlation_id,
      event.event_id,
    ],
  );

  await tx.query(
    `UPDATE proj_steps
    SET
      status = 'running',
      updated_at = $2,
      last_event_id = $3
    WHERE step_id = $1`,
    [event.step_id, event.occurred_at, event.event_id],
  );

  await tx.query(
    `UPDATE proj_runs
    SET
      updated_at = $2,
      last_event_id = $3
    WHERE run_id = $1`,
    [event.run_id, event.occurred_at, event.event_id],
  );
}

async function applyToolSucceeded(tx: DbClient, event: ToolSucceededV1): Promise<void> {
  if (!event.run_id) throw new Error("tool.succeeded requires run_id");
  if (!event.step_id) throw new Error("tool.succeeded requires step_id");
  if (!event.data.tool_call_id) throw new Error("tool.succeeded requires tool_call_id");

  const res = await tx.query(
    `UPDATE proj_tool_calls
    SET
      status = 'succeeded',
      output = $2::jsonb,
      ended_at = COALESCE(ended_at, $3),
      updated_at = $3,
      last_event_id = $4
    WHERE tool_call_id = $1`,
    [event.data.tool_call_id, toJsonb(event.data.output), event.occurred_at, event.event_id],
  );
  if (res.rowCount !== 1) {
    throw new Error("tool.succeeded target not found in proj_tool_calls");
  }

  await tx.query(
    `UPDATE proj_steps
    SET
      status = 'succeeded',
      output = $2::jsonb,
      updated_at = $3,
      last_event_id = $4
    WHERE step_id = $1`,
    [event.step_id, toJsonb(event.data.output), event.occurred_at, event.event_id],
  );

  await tx.query(
    `UPDATE proj_runs
    SET
      updated_at = $2,
      last_event_id = $3
    WHERE run_id = $1`,
    [event.run_id, event.occurred_at, event.event_id],
  );
}

async function applyToolFailed(tx: DbClient, event: ToolFailedV1): Promise<void> {
  if (!event.run_id) throw new Error("tool.failed requires run_id");
  if (!event.step_id) throw new Error("tool.failed requires step_id");
  if (!event.data.tool_call_id) throw new Error("tool.failed requires tool_call_id");

  const error =
    event.data.error ?? (event.data.message ? { message: event.data.message } : undefined);

  const res = await tx.query(
    `UPDATE proj_tool_calls
    SET
      status = 'failed',
      error = $2::jsonb,
      ended_at = COALESCE(ended_at, $3),
      updated_at = $3,
      last_event_id = $4
    WHERE tool_call_id = $1`,
    [event.data.tool_call_id, toJsonb(error), event.occurred_at, event.event_id],
  );
  if (res.rowCount !== 1) {
    throw new Error("tool.failed target not found in proj_tool_calls");
  }

  await tx.query(
    `UPDATE proj_steps
    SET
      status = 'failed',
      error = $2::jsonb,
      updated_at = $3,
      last_event_id = $4
    WHERE step_id = $1`,
    [event.step_id, toJsonb(error), event.occurred_at, event.event_id],
  );

  await tx.query(
    `UPDATE proj_runs
    SET
      updated_at = $2,
      last_event_id = $3
    WHERE run_id = $1`,
    [event.run_id, event.occurred_at, event.event_id],
  );
}

export async function applyToolEvent(pool: DbPool, envelope: ToolEventV1): Promise<void> {
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

