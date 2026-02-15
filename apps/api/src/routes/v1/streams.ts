import type { FastifyInstance } from "fastify";

import type { DbPool } from "../../db/pool.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseSeq(raw: unknown): number {
  const n = Number(raw ?? "0");
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

export async function registerStreamRoutes(app: FastifyInstance, pool: DbPool): Promise<void> {
  app.get<{
    Params: { roomId: string };
    Querystring: { from_seq?: string };
  }>("/v1/streams/rooms/:roomId", async (req, reply) => {
    const roomId = req.params.roomId;
    let cursor = parseSeq(req.query.from_seq);

    reply.raw.statusCode = 200;
    reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.setHeader("X-Accel-Buffering", "no");
    reply.hijack();
    reply.raw.write("\n");

    let closed = false;
    req.raw.on("close", () => {
      closed = true;
    });

    while (!closed) {
      const res = await pool.query<{
        event_id: string;
        event_type: string;
        event_version: number;
        occurred_at: string;
        recorded_at: string;
        workspace_id: string;
        mission_id: string | null;
        room_id: string | null;
        thread_id: string | null;
        actor_type: string;
        actor_id: string;
        run_id: string | null;
        step_id: string | null;
        stream_type: string;
        stream_id: string;
        stream_seq: string;
        data: unknown;
      }>(
        `SELECT
          event_id,
          event_type,
          event_version,
          occurred_at,
          recorded_at,
          workspace_id,
          mission_id,
          room_id,
          thread_id,
          actor_type,
          actor_id,
          run_id,
          step_id,
          stream_type,
          stream_id,
          stream_seq,
          data
        FROM evt_events
        WHERE stream_type = 'room'
          AND stream_id = $1
          AND stream_seq > $2
        ORDER BY stream_seq ASC
        LIMIT 100`,
        [roomId, cursor],
      );

      if (res.rowCount === 0) {
        await sleep(1000);
        continue;
      }

      for (const row of res.rows) {
        const streamSeq = Number(row.stream_seq);
        cursor = Number.isFinite(streamSeq) ? streamSeq : cursor;

        const payload = {
          ...row,
          stream_seq: cursor,
        };

        reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
      }
    }

    reply.raw.end();
  });
}
