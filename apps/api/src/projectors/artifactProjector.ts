import type { ArtifactCreatedV1, ArtifactEventV1 } from "@agentapp/shared";

import type { DbClient, DbPool } from "../db/pool.js";
import { tryMarkApplied } from "./projectorDb.js";

export const ARTIFACT_PROJECTOR_NAME = "artifacts";

function toJsonb(value: unknown): string {
  return JSON.stringify(value ?? {});
}

async function applyInTx(tx: DbClient, event: ArtifactEventV1): Promise<void> {
  const applied = await tryMarkApplied(tx, ARTIFACT_PROJECTOR_NAME, event.event_id);
  if (!applied) return;

  switch (event.event_type) {
    case "artifact.created":
      await applyArtifactCreated(tx, event as ArtifactCreatedV1);
      return;
  }
}

async function applyArtifactCreated(tx: DbClient, event: ArtifactCreatedV1): Promise<void> {
  if (!event.run_id) throw new Error("artifact.created requires run_id");
  if (!event.step_id) throw new Error("artifact.created requires step_id");
  if (!event.data.artifact_id) throw new Error("artifact.created requires artifact_id");
  if (!event.data.kind?.trim()) throw new Error("artifact.created requires kind");

  const content = event.data.content;
  const content_type = content?.type ?? "none";

  let content_text: string | null = null;
  let content_uri: string | null = null;
  let content_json: unknown = {};

  if (content_type === "text") {
    content_text = typeof content?.text === "string" ? content.text : "";
  } else if (content_type === "uri") {
    content_uri = typeof content?.uri === "string" ? content.uri : null;
  } else if (content_type === "json") {
    content_json = content?.json ?? {};
  }

  await tx.query(
    `INSERT INTO proj_artifacts (
      artifact_id,
      workspace_id, room_id, thread_id, run_id, step_id,
      kind, title, mime_type, size_bytes, sha256,
      content_type, content_text, content_json, content_uri,
      metadata,
      created_at, updated_at,
      correlation_id,
      last_event_id
    ) VALUES (
      $1,
      $2, $3, $4, $5, $6,
      $7, $8, $9, $10, $11,
      $12, $13, $14::jsonb, $15,
      $16::jsonb,
      $17, $18,
      $19,
      $20
    )
    ON CONFLICT (artifact_id) DO NOTHING`,
    [
      event.data.artifact_id,
      event.workspace_id,
      event.room_id ?? null,
      event.thread_id ?? null,
      event.run_id,
      event.step_id,
      event.data.kind,
      event.data.title ?? null,
      event.data.mime_type ?? null,
      event.data.size_bytes ?? null,
      event.data.sha256 ?? null,
      content_type,
      content_text,
      toJsonb(content_json),
      content_uri,
      toJsonb(event.data.metadata),
      event.occurred_at,
      event.occurred_at,
      event.correlation_id,
      event.event_id,
    ],
  );

  await tx.query(
    `UPDATE proj_steps
    SET
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

export async function applyArtifactEvent(pool: DbPool, envelope: ArtifactEventV1): Promise<void> {
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

