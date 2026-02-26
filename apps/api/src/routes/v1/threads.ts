import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import { newMessageId, newThreadId } from "@agentapp/shared";

import type { DbPool } from "../../db/pool.js";
import { appendToStream } from "../../eventStore/index.js";
import { applyCoreEvent } from "../../projectors/coreProjector.js";
import { assertSupportedSchemaVersion } from "../../contracts/schemaVersion.js";

export async function registerThreadRoutes(app: FastifyInstance, pool: DbPool): Promise<void> {
  app.get<{
    Params: { roomId: string };
    Querystring: { limit?: string };
  }>("/v1/rooms/:roomId/threads", async (req, reply) => {
    const rawLimit = Number(req.query.limit ?? "50");
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, Math.floor(rawLimit))) : 50;

    const room = await pool.query<{ workspace_id: string }>(
      "SELECT workspace_id FROM proj_rooms WHERE room_id = $1",
      [req.params.roomId],
    );
    if (room.rowCount !== 1) {
      return reply.code(404).send({ error: "room_not_found" });
    }

    const res = await pool.query(
      `SELECT thread_id, workspace_id, room_id, title, status, created_at, updated_at, last_event_id
       FROM proj_threads
       WHERE room_id = $1
       ORDER BY updated_at DESC
       LIMIT $2`,
      [req.params.roomId, limit],
    );
    return reply.code(200).send({ threads: res.rows });
  });

  app.post<{
    Params: { roomId: string };
    Body: { title: string; status?: string };
  }>("/v1/rooms/:roomId/threads", async (req, reply) => {
    const room = await pool.query<{ workspace_id: string }>(
      "SELECT workspace_id FROM proj_rooms WHERE room_id = $1",
      [req.params.roomId],
    );
    if (room.rowCount !== 1) {
      return reply.code(404).send({ error: "room_not_found" });
    }

    const thread_id = newThreadId();
    const occurred_at = new Date().toISOString();
    const correlation_id = randomUUID();

    const event = await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "thread.created",
      event_version: 1,
      occurred_at,
      workspace_id: room.rows[0].workspace_id,
      room_id: req.params.roomId,
      thread_id,
      actor: { actor_type: "service", actor_id: "api" },
      // Room feed is the primary realtime stream: all room-scoped events go to the room stream.
      stream: { stream_type: "room", stream_id: req.params.roomId },
      correlation_id,
      data: {
        title: req.body.title,
        status: req.body.status ?? "open",
      },
      policy_context: {},
      model_context: {},
      display: {},
    });

    await applyCoreEvent(pool, event);
    return reply.code(201).send({ thread_id });
  });

  app.post<{
    Params: { threadId: string };
    Body: {
      schema_version?: string;
      sender_type?: string;
      sender_id?: string;
      content_md: string;
      lang: string;
      parent_message_id?: string;
      labels?: string[];
    };
  }>("/v1/threads/:threadId/messages", async (req, reply) => {
    try {
      assertSupportedSchemaVersion(req.body.schema_version);
    } catch (err) {
      return reply.code(400).send({
        error: "invalid_schema_version",
        reason_code: "unsupported_version",
        message: err instanceof Error ? err.message : "unsupported schema_version",
      });
    }

    const thread = await pool.query<{ workspace_id: string; room_id: string }>(
      "SELECT workspace_id, room_id FROM proj_threads WHERE thread_id = $1",
      [req.params.threadId],
    );
    if (thread.rowCount !== 1) {
      return reply.code(404).send({ error: "thread_not_found" });
    }

    const occurred_at = new Date().toISOString();
    const correlation_id = randomUUID();

    const sender_type = req.body.sender_type ?? "user";
    const sender_id = req.body.sender_id ?? "anon";

    const message_id = newMessageId();
    const event = await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "message.created",
      event_version: 1,
      occurred_at,
      workspace_id: thread.rows[0].workspace_id,
      room_id: thread.rows[0].room_id,
      thread_id: req.params.threadId,
      actor: { actor_type: sender_type === "service" ? "service" : "user", actor_id: sender_id },
      // Room feed is the primary realtime stream: all room-scoped events go to the room stream.
      stream: { stream_type: "room", stream_id: thread.rows[0].room_id },
      correlation_id,
      data: {
        message_id,
        sender_type,
        sender_id,
        content_md: req.body.content_md,
        lang: req.body.lang,
        parent_message_id: req.body.parent_message_id,
        labels: req.body.labels,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });

    await applyCoreEvent(pool, event);
    return reply.code(201).send({ message_id });
  });

  app.get<{
    Params: { threadId: string };
    Querystring: { limit?: string; before?: string };
  }>("/v1/threads/:threadId/messages", async (req, reply) => {
    const rawLimit = Number(req.query.limit ?? "50");
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, rawLimit)) : 50;

    let before: string | null = null;
    if (req.query.before) {
      const d = new Date(req.query.before);
      if (Number.isNaN(d.getTime())) {
        return reply.code(400).send({ error: "invalid_before" });
      }
      before = d.toISOString();
    }

    const args: unknown[] = [req.params.threadId];
    let where = "thread_id = $1 AND deleted = FALSE";

    if (before) {
      args.push(before);
      where += ` AND created_at < $${args.length}`;
    }

    args.push(limit);
    const res = await pool.query(
      `SELECT message_id, workspace_id, room_id, thread_id, sender_type, sender_id, content_md, lang, parent_message_id, run_id, step_id, labels, created_at, updated_at
       FROM proj_messages
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${args.length}`,
      args,
    );
    return { messages: res.rows };
  });
}
