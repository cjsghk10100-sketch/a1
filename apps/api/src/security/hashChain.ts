import { createHash } from "node:crypto";

import type { EventEnvelopeV1 } from "@agentapp/shared";

function normalizeJsonValue(value: unknown): unknown {
  if (value === null) return null;

  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      // Match JSON.stringify behavior for non-finite numbers.
      return Number.isFinite(value) ? value : null;
    case "bigint":
      return value.toString();
    case "undefined":
    case "function":
    case "symbol":
      return undefined;
    case "object": {
      if (Array.isArray(value)) {
        return value.map((v) => {
          const nv = normalizeJsonValue(v);
          // Match JSON.stringify behavior for arrays: undefined becomes null.
          return nv === undefined ? null : nv;
        });
      }

      const rec = value as Record<string, unknown>;
      const keys = Object.keys(rec).sort();
      const out: Record<string, unknown> = {};
      for (const k of keys) {
        const nv = normalizeJsonValue(rec[k]);
        // Match JSON.stringify behavior for objects: undefined properties are dropped.
        if (nv === undefined) continue;
        out[k] = nv;
      }
      return out;
    }
    default:
      return undefined;
  }
}

export function stableStringify(value: unknown): string {
  // Our inputs should always be JSON-like objects. If something becomes undefined,
  // normalize it to null at the top level so hashing is still deterministic.
  const normalized = normalizeJsonValue(value);
  return JSON.stringify(normalized === undefined ? null : normalized);
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function computeEventHashV1(envelope: EventEnvelopeV1, prev_event_hash: string | null): string {
  const stream_seq =
    typeof envelope.stream.stream_seq === "number" && Number.isFinite(envelope.stream.stream_seq)
      ? envelope.stream.stream_seq
      : null;

  const anyEnvelope = envelope as unknown as {
    actor_principal_id?: string;
    zone?: string;
  };

  const input = {
    hash_version: 1,
    prev_event_hash: prev_event_hash ?? null,

    event_id: envelope.event_id,
    event_type: envelope.event_type,
    event_version: envelope.event_version,
    occurred_at: envelope.occurred_at,

    workspace_id: envelope.workspace_id,
    mission_id: envelope.mission_id ?? null,
    room_id: envelope.room_id ?? null,
    thread_id: envelope.thread_id ?? null,
    run_id: envelope.run_id ?? null,
    step_id: envelope.step_id ?? null,

    actor_type: envelope.actor.actor_type,
    actor_id: envelope.actor.actor_id,
    actor_principal_id: anyEnvelope.actor_principal_id ?? null,
    zone: anyEnvelope.zone ?? "supervised",

    stream_type: envelope.stream.stream_type,
    stream_id: envelope.stream.stream_id,
    stream_seq,

    correlation_id: envelope.correlation_id,
    causation_id: envelope.causation_id ?? null,

    redaction_level: envelope.redaction_level ?? "none",
    contains_secrets: envelope.contains_secrets ?? false,

    policy_context: envelope.policy_context ?? {},
    model_context: envelope.model_context ?? {},
    display: envelope.display ?? {},

    data: envelope.data,

    idempotency_key: envelope.idempotency_key ?? null,
  };

  const canonical = stableStringify(input);
  return `sha256:${sha256Hex(canonical)}`;
}

