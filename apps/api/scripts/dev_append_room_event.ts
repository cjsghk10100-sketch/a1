import { randomUUID } from "node:crypto";

import { newRoomId, newWorkspaceId } from "@agentapp/shared";

import { loadConfig } from "../src/config.js";
import { createPool } from "../src/db/pool.js";
import { appendToStream } from "../src/eventStore/index.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);

  const workspaceId = newWorkspaceId();
  const roomId = newRoomId();

  const occurredAt = new Date().toISOString();
  const correlationId = randomUUID();

  const event = await appendToStream(pool, {
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
      title: "Dev Room",
      default_lang: "en",
      room_mode: "default",
    },
    policy_context: {},
    model_context: {},
    display: {},
  });

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(event, null, 2));
  await pool.end();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
