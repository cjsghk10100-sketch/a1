import type { EventEnvelopeV1, StreamRefV1 } from "@agentapp/shared";

import type { DbPool } from "../db/pool.js";
import { ensurePrincipalForLegacyActor } from "../security/principals.js";
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
