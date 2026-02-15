import type { EventEnvelopeV1, StreamRefV1 } from "@agentapp/shared";

import type { DbClient } from "../db/pool.js";

type StreamWithSeq = StreamRefV1 & { stream_seq: number };
export type EnvelopeWithSeq = EventEnvelopeV1 & {
  stream: StreamWithSeq;
  prev_event_hash?: string | null;
  event_hash?: string;
};

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
    actor_principal_id,
    zone,
    run_id,
    step_id,
    stream,
    correlation_id,
    causation_id,
    redaction_level,
    contains_secrets,
    prev_event_hash,
    event_hash,
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
      actor_type, actor_id, actor_principal_id, zone,
      run_id, step_id,
      stream_type, stream_id, stream_seq,
      correlation_id, causation_id,
      redaction_level, contains_secrets,
      prev_event_hash, event_hash,
      policy_context, model_context, display,
      data,
      idempotency_key
    ) VALUES (
      $1, $2, $3, $4,
      $5, $6, $7, $8,
      $9, $10, $11, $12,
      $13, $14,
      $15, $16, $17,
      $18, $19,
      $20, $21,
      $22, $23,
      $24::jsonb, $25::jsonb, $26::jsonb,
      $27::jsonb,
      $28
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
      actor_principal_id ?? null,
      zone ?? "supervised",
      run_id ?? null,
      step_id ?? null,
      stream.stream_type,
      stream.stream_id,
      stream.stream_seq,
      correlation_id,
      causation_id ?? null,
      redaction_level ?? "none",
      contains_secrets ?? false,
      prev_event_hash ?? null,
      event_hash ?? null,
      toJsonb(policy_context),
      toJsonb(model_context),
      toJsonb(display),
      JSON.stringify(data),
      idempotency_key ?? null,
    ],
  );
}
