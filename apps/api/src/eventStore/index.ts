import type { EventEnvelopeV1, StreamRefV1 } from "@agentapp/shared";

import type { DbPool } from "../db/pool.js";
import { computeEventHashV1 } from "../security/hashChain.js";
import { ensurePrincipalForLegacyActor } from "../security/principals.js";
import { allocateStreamSeq } from "./allocateSeq.js";
import { type EnvelopeWithSeq, appendEvent } from "./appendEvent.js";

type StreamWithSeq = StreamRefV1 & { stream_seq: number };

async function previousEventHash(
  tx: { query: DbPool["query"] },
  stream_type: string,
  stream_id: string,
  stream_seq: number,
): Promise<string | null> {
  if (stream_seq <= 1) return null;
  const res = await tx.query<{ event_hash: string | null }>(
    `SELECT event_hash
     FROM evt_events
     WHERE stream_type = $1
       AND stream_id = $2
       AND stream_seq = $3
     LIMIT 1`,
    [stream_type, stream_id, stream_seq - 1],
  );
  if (res.rowCount !== 1) return null;
  return res.rows[0].event_hash ?? null;
}

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

    const actor_principal_id =
      envelope.actor_principal_id ??
      (await ensurePrincipalForLegacyActor(client, envelope.actor.actor_type, envelope.actor.actor_id));
    const zone = envelope.zone ?? "supervised";

    const withSeq: EnvelopeWithSeq = {
      ...(envelope as EventEnvelopeV1),
      actor_principal_id,
      zone,
      stream: {
        ...(envelope.stream as StreamRefV1),
        stream_seq,
      } as StreamWithSeq,
    };

    const prev_event_hash = await previousEventHash(
      client,
      withSeq.stream.stream_type,
      withSeq.stream.stream_id,
      withSeq.stream.stream_seq,
    );
    const event_hash = computeEventHashV1(withSeq, prev_event_hash);

    await appendEvent(client, { ...withSeq, prev_event_hash, event_hash });
    await client.query("COMMIT");
    return { ...withSeq, prev_event_hash, event_hash };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
