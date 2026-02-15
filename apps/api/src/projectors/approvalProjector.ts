import type { ApprovalDecidedV1, ApprovalEventV1, ApprovalRequestedV1 } from "@agentapp/shared";

import type { DbClient, DbPool } from "../db/pool.js";
import { tryMarkApplied } from "./projectorDb.js";

export const APPROVAL_PROJECTOR_NAME = "approvals";

function toJsonb(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function statusFromDecision(decision: string): "held" | "approved" | "denied" {
  switch (decision) {
    case "hold":
      return "held";
    case "approve":
      return "approved";
    default:
      return "denied";
  }
}

async function applyInTx(tx: DbClient, event: ApprovalEventV1): Promise<void> {
  const applied = await tryMarkApplied(tx, APPROVAL_PROJECTOR_NAME, event.event_id);
  if (!applied) return;

  switch (event.event_type) {
    case "approval.requested":
      await applyApprovalRequested(tx, event as ApprovalRequestedV1);
      return;
    case "approval.decided":
      await applyApprovalDecided(tx, event as ApprovalDecidedV1);
      return;
  }
}

async function applyApprovalRequested(tx: DbClient, event: ApprovalRequestedV1): Promise<void> {
  const approval_id = event.data.approval_id;
  if (!approval_id) throw new Error("approval.requested requires approval_id");
  if (!event.workspace_id) throw new Error("approval.requested requires workspace_id");
  if (!event.data.action) throw new Error("approval.requested requires action");

  await tx.query(
    `INSERT INTO proj_approvals (
      approval_id,
      workspace_id, room_id, thread_id, run_id, step_id,
      action,
      status,
      title, request, context, scope, expires_at,
      requested_by_type, requested_by_id, requested_at,
      correlation_id,
      created_at, updated_at, last_event_id
    ) VALUES (
      $1,
      $2, $3, $4, $5, $6,
      $7,
      'pending',
      $8, $9::jsonb, $10::jsonb, $11::jsonb, $12,
      $13, $14, $15,
      $16,
      $17, $18, $19
    )
    ON CONFLICT (approval_id) DO NOTHING`,
    [
      approval_id,
      event.workspace_id,
      event.room_id ?? null,
      event.thread_id ?? null,
      event.run_id ?? null,
      event.step_id ?? null,
      event.data.action,
      event.data.title ?? null,
      toJsonb(event.data.request),
      toJsonb(event.data.context),
      toJsonb(event.data.scope),
      event.data.expires_at ?? null,
      event.actor.actor_type,
      event.actor.actor_id,
      event.occurred_at,
      event.correlation_id,
      event.occurred_at,
      event.occurred_at,
      event.event_id,
    ],
  );
}

async function applyApprovalDecided(tx: DbClient, event: ApprovalDecidedV1): Promise<void> {
  const approval_id = event.data.approval_id;
  if (!approval_id) throw new Error("approval.decided requires approval_id");
  if (!event.data.decision) throw new Error("approval.decided requires decision");

  const status = statusFromDecision(event.data.decision);

  const res = await tx.query(
    `UPDATE proj_approvals
    SET
      status = $2,
      decision = $3,
      decision_reason = $4,
      decided_by_type = $5,
      decided_by_id = $6,
      decided_at = $7,
      scope = COALESCE($8::jsonb, scope),
      expires_at = COALESCE($9, expires_at),
      updated_at = $10,
      last_event_id = $11
    WHERE approval_id = $1`,
    [
      approval_id,
      status,
      event.data.decision,
      event.data.reason ?? null,
      event.actor.actor_type,
      event.actor.actor_id,
      event.occurred_at,
      event.data.scope ? toJsonb(event.data.scope) : null,
      event.data.expires_at ?? null,
      event.occurred_at,
      event.event_id,
    ],
  );

  if (res.rowCount !== 1) {
    throw new Error("approval.decided target not found in proj_approvals");
  }
}

export async function applyApprovalEvent(pool: DbPool, envelope: ApprovalEventV1): Promise<void> {
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

