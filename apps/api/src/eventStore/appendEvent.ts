import type { EventEnvelopeV1, StreamRefV1 } from "@agentapp/shared";

import type { DbClient } from "../db/pool.js";

type StreamWithSeq = StreamRefV1 & { stream_seq: number };
export type EnvelopeWithSeq = EventEnvelopeV1 & { stream: StreamWithSeq };

function toJsonb(value: unknown): string {
  return JSON.stringify(value ?? {});
}

export async function appendEvent(tx: DbClient, envelope: EnvelopeWithSeq): Promise<void> {
  const {
    event_id,
    event_type,
    event_version,
    occurred_at,
    workspace_id,
    mission_id,
    room_id,
    thread_id,
    actor,
    run_id,
    step_id,
    stream,
    redaction_level,
    contains_secrets,
    policy_context,
    model_context,
    display,
    data,
    idempotency_key,
  } = envelope;

  await tx.query(
    `INSERT INTO evt_events (
      event_id, event_type, event_version, occurred_at,
      workspace_id, mission_id, room_id, thread_id,
      actor_type, actor_id,
      run_id, step_id,
      stream_type, stream_id, stream_seq,
      redaction_level, contains_secrets,
      policy_context, model_context, display,
      data,
      idempotency_key
    ) VALUES (
      $1, $2, $3, $4,
      $5, $6, $7, $8,
      $9, $10,
      $11, $12,
      $13, $14, $15,
      $16, $17,
      $18::jsonb, $19::jsonb, $20::jsonb,
      $21::jsonb,
      $22
    )`,
    [
      event_id,
      event_type,
      event_version,
      occurred_at,
      workspace_id,
      mission_id ?? null,
      room_id ?? null,
      thread_id ?? null,
      actor.actor_type,
      actor.actor_id,
      run_id ?? null,
      step_id ?? null,
      stream.stream_type,
      stream.stream_id,
      stream.stream_seq,
      redaction_level ?? "none",
      contains_secrets ?? false,
      toJsonb(policy_context),
      toJsonb(model_context),
      toJsonb(display),
      JSON.stringify(data),
      idempotency_key ?? null,
    ],
  );
}
