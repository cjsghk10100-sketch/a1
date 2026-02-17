import type { EventEnvelopeV1 } from "@agentapp/shared";

import type { DbClient, DbPool } from "../db/pool.js";
import { tryMarkApplied } from "./projectorDb.js";
import type {
  CoreEventV1,
  MessageCreatedV1,
  RoomCreatedV1,
  RoomUpdatedV1,
  ThreadCreatedV1,
} from "./types.js";

export const CORE_PROJECTOR_NAME = "core";

async function applyInTx(tx: DbClient, event: CoreEventV1): Promise<void> {
  const applied = await tryMarkApplied(tx, CORE_PROJECTOR_NAME, event.event_id);
  if (!applied) return;

  switch (event.event_type) {
    case "room.created":
      await applyRoomCreated(tx, event);
      return;
    case "room.updated":
      await applyRoomUpdated(tx, event);
      return;
    case "thread.created":
      await applyThreadCreated(tx, event);
      return;
    case "message.created":
      await applyMessageCreated(tx, event);
      return;
  }
}

async function applyRoomCreated(tx: DbClient, event: RoomCreatedV1): Promise<void> {
  if (!event.room_id) throw new Error("room.created requires room_id");

  await tx.query(
    `INSERT INTO proj_rooms (
      room_id, workspace_id, mission_id, title, topic, room_mode, default_lang, tool_policy_ref,
      created_at, updated_at, last_event_id
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11
    )
    ON CONFLICT (room_id) DO UPDATE SET
      workspace_id = EXCLUDED.workspace_id,
      mission_id = EXCLUDED.mission_id,
      title = EXCLUDED.title,
      topic = EXCLUDED.topic,
      room_mode = EXCLUDED.room_mode,
      default_lang = EXCLUDED.default_lang,
      tool_policy_ref = EXCLUDED.tool_policy_ref,
      updated_at = EXCLUDED.updated_at,
      last_event_id = EXCLUDED.last_event_id`,
    [
      event.room_id,
      event.workspace_id,
      event.mission_id ?? null,
      event.data.title,
      event.data.topic ?? null,
      event.data.room_mode,
      event.data.default_lang,
      event.data.tool_policy_ref ?? null,
      event.occurred_at,
      event.occurred_at,
      event.event_id,
    ],
  );
}

async function applyRoomUpdated(tx: DbClient, event: RoomUpdatedV1): Promise<void> {
  if (!event.room_id) throw new Error("room.updated requires room_id");

  // Best-effort upsert; missing fields remain unchanged.
  await tx.query(
    `INSERT INTO proj_rooms (
      room_id, workspace_id, mission_id, title, topic, room_mode, default_lang, tool_policy_ref,
      created_at, updated_at, last_event_id
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11
    )
    ON CONFLICT (room_id) DO UPDATE SET
      title = COALESCE(EXCLUDED.title, proj_rooms.title),
      topic = COALESCE(EXCLUDED.topic, proj_rooms.topic),
      room_mode = COALESCE(EXCLUDED.room_mode, proj_rooms.room_mode),
      default_lang = COALESCE(EXCLUDED.default_lang, proj_rooms.default_lang),
      tool_policy_ref = COALESCE(EXCLUDED.tool_policy_ref, proj_rooms.tool_policy_ref),
      updated_at = EXCLUDED.updated_at,
      last_event_id = EXCLUDED.last_event_id`,
    [
      event.room_id,
      event.workspace_id,
      event.mission_id ?? null,
      event.data.title ?? null,
      event.data.topic ?? null,
      event.data.room_mode ?? null,
      event.data.default_lang ?? null,
      event.data.tool_policy_ref ?? null,
      event.occurred_at,
      event.occurred_at,
      event.event_id,
    ],
  );
}

async function applyThreadCreated(tx: DbClient, event: ThreadCreatedV1): Promise<void> {
  if (!event.thread_id) throw new Error("thread.created requires thread_id");
  if (!event.room_id) throw new Error("thread.created requires room_id");

  await tx.query(
    `INSERT INTO proj_threads (
      thread_id, workspace_id, room_id, title, status,
      created_at, updated_at, last_event_id
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8
    )
    ON CONFLICT (thread_id) DO UPDATE SET
      workspace_id = EXCLUDED.workspace_id,
      room_id = EXCLUDED.room_id,
      title = EXCLUDED.title,
      status = EXCLUDED.status,
      updated_at = EXCLUDED.updated_at,
      last_event_id = EXCLUDED.last_event_id`,
    [
      event.thread_id,
      event.workspace_id,
      event.room_id,
      event.data.title,
      event.data.status,
      event.occurred_at,
      event.occurred_at,
      event.event_id,
    ],
  );
}

async function applyMessageCreated(tx: DbClient, event: MessageCreatedV1): Promise<void> {
  if (!event.room_id) throw new Error("message.created requires room_id");
  if (!event.thread_id) throw new Error("message.created requires thread_id");
  if (!event.data.content_md) throw new Error("message.created requires content_md");

  // message_id is the stable entity id; event_id is for the event record itself.
  const message_id = event.data.message_id || event.event_id;
  const labels = event.data.labels ?? [];

  await tx.query(
    `INSERT INTO proj_messages (
      message_id, workspace_id, room_id, thread_id,
      sender_type, sender_id,
      content_md, lang,
      parent_message_id,
      run_id, step_id,
      labels,
      created_at, updated_at, deleted, last_event_id
    ) VALUES (
      $1, $2, $3, $4,
      $5, $6,
      $7, $8,
      $9,
      $10, $11,
      $12,
      $13, $14, FALSE, $15
    )
    ON CONFLICT (message_id) DO UPDATE SET
      content_md = EXCLUDED.content_md,
      lang = EXCLUDED.lang,
      labels = EXCLUDED.labels,
      updated_at = EXCLUDED.updated_at,
      last_event_id = EXCLUDED.last_event_id`,
    [
      message_id,
      event.workspace_id,
      event.room_id,
      event.thread_id,
      event.data.sender_type,
      event.data.sender_id,
      event.data.content_md,
      event.data.lang,
      event.data.parent_message_id ?? null,
      event.run_id ?? null,
      event.step_id ?? null,
      labels,
      event.occurred_at,
      event.occurred_at,
      event.event_id,
    ],
  );

  // `proj_search_docs` is a lightweight trigram-search index. For now we only index messages.
  await tx.query(
    `INSERT INTO proj_search_docs (
      doc_id, workspace_id, room_id, thread_id, doc_type,
      content_text, lang, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8
    )
    ON CONFLICT (doc_id) DO UPDATE SET
      workspace_id = EXCLUDED.workspace_id,
      room_id = EXCLUDED.room_id,
      thread_id = EXCLUDED.thread_id,
      doc_type = EXCLUDED.doc_type,
      content_text = EXCLUDED.content_text,
      lang = EXCLUDED.lang,
      updated_at = EXCLUDED.updated_at`,
    [
      message_id,
      event.workspace_id,
      event.room_id,
      event.thread_id,
      "message",
      event.data.content_md,
      event.data.lang,
      event.occurred_at,
    ],
  );
}

export async function applyCoreEvent(pool: DbPool, envelope: EventEnvelopeV1): Promise<void> {
  const event = envelope as CoreEventV1;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await applyInTx(client, event);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
