import { randomUUID } from "node:crypto";

import { newRoomId, newThreadId, newWorkspaceId } from "@agentapp/shared";

import { loadConfig } from "../src/config.js";
import { createPool } from "../src/db/pool.js";
import { appendToStream } from "../src/eventStore/index.js";
import { applyCoreEvent } from "../src/projectors/coreProjector.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);

  const workspaceId = newWorkspaceId();
  const roomId = newRoomId();
  const threadId = newThreadId();

  const occurredAt = new Date().toISOString();
  const correlationId = randomUUID();

  const roomCreated = await appendToStream(pool, {
    event_id: randomUUID(),
    event_type: "room.created",
    event_version: 1,
    occurred_at: occurredAt,
    workspace_id: workspaceId,
    room_id: roomId,
    actor: { actor_type: "service", actor_id: "dev" },
    stream: { stream_type: "room", stream_id: roomId },
    correlation_id: correlationId,
    data: {
      title: "Smoke Room",
      default_lang: "en",
      room_mode: "default",
    },
    policy_context: {},
    model_context: {},
    display: {},
  });

  const threadCreated = await appendToStream(pool, {
    event_id: randomUUID(),
    event_type: "thread.created",
    event_version: 1,
    occurred_at: occurredAt,
    workspace_id: workspaceId,
    room_id: roomId,
    thread_id: threadId,
    actor: { actor_type: "service", actor_id: "dev" },
    stream: { stream_type: "thread", stream_id: threadId },
    correlation_id: correlationId,
    data: {
      title: "Smoke Thread",
      status: "open",
    },
    policy_context: {},
    model_context: {},
    display: {},
  });

  await applyCoreEvent(pool, roomCreated);
  await applyCoreEvent(pool, threadCreated);

  const rooms = await pool.query("SELECT room_id, title FROM proj_rooms WHERE room_id = $1", [
    roomId,
  ]);
  // eslint-disable-next-line no-console
  console.log({ rooms: rooms.rows });

  await pool.end();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
