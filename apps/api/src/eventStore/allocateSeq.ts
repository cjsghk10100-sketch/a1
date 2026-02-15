import type { DbClient } from "../db/pool.js";

export async function allocateStreamSeq(
  tx: DbClient,
  streamType: string,
  streamId: string,
): Promise<number> {
  // Ensure the head row exists, then atomically increment.
  await tx.query(
    "INSERT INTO evt_stream_heads (stream_type, stream_id, next_seq) VALUES ($1, $2, 1) ON CONFLICT DO NOTHING",
    [streamType, streamId],
  );

  const res = await tx.query<{ stream_seq: string }>(
    "UPDATE evt_stream_heads SET next_seq = next_seq + 1 WHERE stream_type = $1 AND stream_id = $2 RETURNING (next_seq - 1) AS stream_seq",
    [streamType, streamId],
  );

  if (res.rowCount !== 1) {
    throw new Error("failed to allocate stream_seq");
  }
  return Number(res.rows[0].stream_seq);
}
