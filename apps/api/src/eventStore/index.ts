import type { EventEnvelopeV1, StreamRefV1 } from "@agentapp/shared";

import type { DbPool } from "../db/pool.js";
import { allocateStreamSeq } from "./allocateSeq.js";
import { type EnvelopeWithSeq, appendEvent } from "./appendEvent.js";

type StreamWithSeq = StreamRefV1 & { stream_seq: number };

export async function appendToStream(
  pool: DbPool,
  envelope: EventEnvelopeV1,
): Promise<EnvelopeWithSeq> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const stream_seq = await allocateStreamSeq(
      client,
      envelope.stream.stream_type,
      envelope.stream.stream_id,
    );
    const withSeq: EnvelopeWithSeq = {
      ...(envelope as EventEnvelopeV1),
      stream: {
        ...(envelope.stream as StreamRefV1),
        stream_seq,
      } as StreamWithSeq,
    };

    await appendEvent(client, withSeq);
    await client.query("COMMIT");
    return withSeq;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
