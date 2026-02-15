import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import { newRoomId } from "@agentapp/shared";

import type { DbPool } from "../../db/pool.js";
import { appendToStream } from "../../eventStore/index.js";
import { applyCoreEvent } from "../../projectors/coreProjector.js";

function getHeaderString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function workspaceIdFromReq(req: { headers: Record<string, unknown> }): string {
  const raw = getHeaderString(req.headers["x-workspace-id"] as string | string[] | undefined);
  return raw?.trim() || "ws_dev";
}

export async function registerRoomRoutes(app: FastifyInstance, pool: DbPool): Promise<void> {
  app.get("/v1/rooms", async () => {
    const res = await pool.query(
      "SELECT room_id, workspace_id, mission_id, title, topic, room_mode, default_lang, tool_policy_ref, created_at, updated_at FROM proj_rooms ORDER BY updated_at DESC LIMIT 100",
    );
    return { rooms: res.rows };
  });

  app.post<{
    Body: {
      title: string;
      topic?: string;
      room_mode: string;
      default_lang: string;
      tool_policy_ref?: string;
      mission_id?: string;
    };
  }>("/v1/rooms", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const room_id = newRoomId();

    const occurred_at = new Date().toISOString();
    const correlation_id = randomUUID();

    const event = await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "room.created",
      event_version: 1,
      occurred_at,
      workspace_id,
      mission_id: req.body.mission_id,
      room_id,
      actor: { actor_type: "service", actor_id: "api" },
      stream: { stream_type: "room", stream_id: room_id },
      correlation_id,
      data: {
        title: req.body.title,
        topic: req.body.topic,
        room_mode: req.body.room_mode,
        default_lang: req.body.default_lang,
        tool_policy_ref: req.body.tool_policy_ref,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });

    await applyCoreEvent(pool, event);
    return reply.code(201).send({ room_id });
  });
}
