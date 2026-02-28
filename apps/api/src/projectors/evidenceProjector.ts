import type { EvidenceEventV1, EvidenceManifestCreatedV1 } from "@agentapp/shared";

import type { DbClient, DbPool } from "../db/pool.js";
import { tryMarkApplied } from "./projectorDb.js";

export const EVIDENCE_PROJECTOR_NAME = "evidence";

function toJsonb(value: unknown): string {
  return JSON.stringify(value ?? {});
}

async function applyInTx(tx: DbClient, event: EvidenceEventV1): Promise<void> {
  const applied = await tryMarkApplied(tx, EVIDENCE_PROJECTOR_NAME, event.event_id);
  if (!applied) return;

  switch (event.event_type) {
    case "evidence.manifest.created":
      await applyEvidenceManifestCreated(tx, event as EvidenceManifestCreatedV1);
      return;
  }
}

async function applyEvidenceManifestCreated(tx: DbClient, event: EvidenceManifestCreatedV1): Promise<void> {
  if (!event.workspace_id) throw new Error("evidence.manifest.created requires workspace_id");
  if (!event.data.evidence_id) throw new Error("evidence.manifest.created requires evidence_id");
  if (!event.data.run_id) throw new Error("evidence.manifest.created requires run_id");

  await tx.query(
    `INSERT INTO proj_evidence_manifests (
      evidence_id,
      workspace_id,
      run_id,
      room_id,
      thread_id,
      correlation_id,
      run_status,
      manifest,
      manifest_hash,
      event_hash_root,
      stream_type,
      stream_id,
      from_seq,
      to_seq,
      event_count,
      finalized_at,
      created_at,
      updated_at,
      last_event_id,
      last_event_occurred_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17,$18,$17
    )
    ON CONFLICT (run_id) DO UPDATE SET
      evidence_id = CASE
        WHEN proj_evidence_manifests.last_event_occurred_at IS NULL OR proj_evidence_manifests.last_event_occurred_at <= EXCLUDED.last_event_occurred_at
        THEN EXCLUDED.evidence_id
        ELSE proj_evidence_manifests.evidence_id
      END,
      run_status = CASE
        WHEN proj_evidence_manifests.last_event_occurred_at IS NULL OR proj_evidence_manifests.last_event_occurred_at <= EXCLUDED.last_event_occurred_at
        THEN EXCLUDED.run_status
        ELSE proj_evidence_manifests.run_status
      END,
      manifest = CASE
        WHEN proj_evidence_manifests.last_event_occurred_at IS NULL OR proj_evidence_manifests.last_event_occurred_at <= EXCLUDED.last_event_occurred_at
        THEN EXCLUDED.manifest
        ELSE proj_evidence_manifests.manifest
      END,
      manifest_hash = CASE
        WHEN proj_evidence_manifests.last_event_occurred_at IS NULL OR proj_evidence_manifests.last_event_occurred_at <= EXCLUDED.last_event_occurred_at
        THEN EXCLUDED.manifest_hash
        ELSE proj_evidence_manifests.manifest_hash
      END,
      event_hash_root = CASE
        WHEN proj_evidence_manifests.last_event_occurred_at IS NULL OR proj_evidence_manifests.last_event_occurred_at <= EXCLUDED.last_event_occurred_at
        THEN EXCLUDED.event_hash_root
        ELSE proj_evidence_manifests.event_hash_root
      END,
      stream_type = CASE
        WHEN proj_evidence_manifests.last_event_occurred_at IS NULL OR proj_evidence_manifests.last_event_occurred_at <= EXCLUDED.last_event_occurred_at
        THEN EXCLUDED.stream_type
        ELSE proj_evidence_manifests.stream_type
      END,
      stream_id = CASE
        WHEN proj_evidence_manifests.last_event_occurred_at IS NULL OR proj_evidence_manifests.last_event_occurred_at <= EXCLUDED.last_event_occurred_at
        THEN EXCLUDED.stream_id
        ELSE proj_evidence_manifests.stream_id
      END,
      from_seq = CASE
        WHEN proj_evidence_manifests.last_event_occurred_at IS NULL OR proj_evidence_manifests.last_event_occurred_at <= EXCLUDED.last_event_occurred_at
        THEN EXCLUDED.from_seq
        ELSE proj_evidence_manifests.from_seq
      END,
      to_seq = CASE
        WHEN proj_evidence_manifests.last_event_occurred_at IS NULL OR proj_evidence_manifests.last_event_occurred_at <= EXCLUDED.last_event_occurred_at
        THEN EXCLUDED.to_seq
        ELSE proj_evidence_manifests.to_seq
      END,
      event_count = CASE
        WHEN proj_evidence_manifests.last_event_occurred_at IS NULL OR proj_evidence_manifests.last_event_occurred_at <= EXCLUDED.last_event_occurred_at
        THEN EXCLUDED.event_count
        ELSE proj_evidence_manifests.event_count
      END,
      finalized_at = CASE
        WHEN proj_evidence_manifests.last_event_occurred_at IS NULL OR proj_evidence_manifests.last_event_occurred_at <= EXCLUDED.last_event_occurred_at
        THEN EXCLUDED.finalized_at
        ELSE proj_evidence_manifests.finalized_at
      END,
      updated_at = GREATEST(proj_evidence_manifests.updated_at, EXCLUDED.updated_at),
      last_event_id = CASE
        WHEN proj_evidence_manifests.last_event_occurred_at IS NULL OR proj_evidence_manifests.last_event_occurred_at <= EXCLUDED.last_event_occurred_at
        THEN EXCLUDED.last_event_id
        ELSE proj_evidence_manifests.last_event_id
      END,
      last_event_occurred_at = GREATEST(
        COALESCE(proj_evidence_manifests.last_event_occurred_at, '-infinity'::timestamptz),
        EXCLUDED.last_event_occurred_at
      )`,
    [
      event.data.evidence_id,
      event.workspace_id,
      event.data.run_id,
      event.room_id ?? event.data.room_id ?? null,
      event.thread_id ?? event.data.thread_id ?? null,
      event.data.correlation_id,
      event.data.run_status,
      toJsonb(event.data.manifest),
      event.data.manifest_hash,
      event.data.event_hash_root,
      event.data.stream_type,
      event.data.stream_id,
      event.data.from_seq,
      event.data.to_seq,
      event.data.event_count,
      event.data.finalized_at,
      event.occurred_at,
      event.event_id,
    ],
  );
}

export async function applyEvidenceEvent(pool: DbPool, envelope: EvidenceEventV1): Promise<void> {
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
