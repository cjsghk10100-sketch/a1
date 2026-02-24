import type { ActorType, EventEnvelopeV1, StreamType, Zone } from "@agentapp/shared";

import { loadConfig } from "../src/config.js";
import { createPool } from "../src/db/pool.js";
import { computeEventHashV1 } from "../src/security/hashChain.js";

interface ChainRow {
  event_id: string;
  event_type: string;
  event_version: number;
  occurred_at: string;
  workspace_id: string;
  mission_id: string | null;
  room_id: string | null;
  thread_id: string | null;
  run_id: string | null;
  step_id: string | null;
  actor_type: ActorType;
  actor_id: string;
  actor_principal_id: string | null;
  zone: Zone;
  stream_type: StreamType;
  stream_id: string;
  stream_seq: string;
  correlation_id: string;
  causation_id: string | null;
  redaction_level: "none" | "partial" | "full";
  contains_secrets: boolean;
  policy_context: Record<string, unknown>;
  model_context: Record<string, unknown>;
  display: Record<string, unknown>;
  data: unknown;
  idempotency_key: string | null;
  prev_event_hash: string | null;
  event_hash: string | null;
}

interface StreamKey {
  stream_type: StreamType;
  stream_id: string;
}

function parseOptional(raw: string | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  return value.length ? value : null;
}

function parseStreamType(raw: string | null): StreamType | null {
  if (!raw) return null;
  if (raw === "workspace" || raw === "room" || raw === "thread") return raw;
  return null;
}

function parseLimit(): number {
  const raw = process.env.HASH_CHAIN_VERIFY_LIMIT;
  if (!raw) return 20000;
  const value = Number(raw);
  if (!Number.isFinite(value)) return 20000;
  return Math.max(1, Math.min(100000, Math.floor(value)));
}

function toIso(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString();
}

async function listStreams(
  query: (sql: string, values?: unknown[]) => Promise<{ rows: StreamKey[] }>,
  stream_type: StreamType | null,
  stream_id: string | null,
): Promise<StreamKey[]> {
  if (stream_type && stream_id) {
    return [{ stream_type, stream_id }];
  }
  const res = await query(
    `SELECT DISTINCT stream_type, stream_id
     FROM evt_events
     ORDER BY stream_type ASC, stream_id ASC`,
  );
  return res.rows;
}

async function verifyStream(
  query: (sql: string, values?: unknown[]) => Promise<{ rows: ChainRow[] }>,
  stream: StreamKey,
  limit: number,
): Promise<{ valid: boolean; checked: number; mismatch?: Record<string, unknown> }> {
  const rows = await query(
    `SELECT
       event_id,
       event_type,
       event_version,
       occurred_at::text AS occurred_at,
       workspace_id,
       mission_id,
       room_id,
       thread_id,
       run_id,
       step_id,
       actor_type,
       actor_id,
       actor_principal_id,
       zone,
       stream_type,
       stream_id,
       stream_seq::text AS stream_seq,
       correlation_id,
       causation_id,
       redaction_level,
       contains_secrets,
       policy_context,
       model_context,
       display,
       data,
       idempotency_key,
       prev_event_hash,
       event_hash
     FROM evt_events
     WHERE stream_type = $1
       AND stream_id = $2
     ORDER BY stream_seq ASC
     LIMIT $3`,
    [stream.stream_type, stream.stream_id, limit],
  );

  for (let idx = 0; idx < rows.rows.length; idx += 1) {
    const row = rows.rows[idx];
    const seq = Number.parseInt(row.stream_seq, 10);
    const expected_prev_event_hash = idx === 0 ? null : rows.rows[idx - 1].event_hash;
    if (row.prev_event_hash !== expected_prev_event_hash) {
      return {
        valid: false,
        checked: idx + 1,
        mismatch: {
          kind: "prev_hash_mismatch",
          event_id: row.event_id,
          stream_seq: seq,
          expected_prev_event_hash,
          actual_prev_event_hash: row.prev_event_hash,
        },
      };
    }

    const envelope: EventEnvelopeV1 = {
      event_id: row.event_id,
      event_type: row.event_type,
      event_version: row.event_version,
      occurred_at: toIso(row.occurred_at),
      workspace_id: row.workspace_id,
      mission_id: row.mission_id ?? undefined,
      room_id: row.room_id ?? undefined,
      thread_id: row.thread_id ?? undefined,
      run_id: row.run_id ?? undefined,
      step_id: row.step_id ?? undefined,
      actor: {
        actor_type: row.actor_type,
        actor_id: row.actor_id,
      },
      actor_principal_id: row.actor_principal_id ?? undefined,
      zone: row.zone,
      stream: {
        stream_type: row.stream_type,
        stream_id: row.stream_id,
        stream_seq: seq,
      },
      correlation_id: row.correlation_id,
      causation_id: row.causation_id ?? undefined,
      redaction_level: row.redaction_level,
      contains_secrets: row.contains_secrets,
      policy_context: row.policy_context ?? {},
      model_context: row.model_context ?? {},
      display: row.display ?? {},
      data: row.data,
      idempotency_key: row.idempotency_key ?? undefined,
    };

    const expectedHash = computeEventHashV1(envelope, row.prev_event_hash ?? null);
    if (!row.event_hash || row.event_hash !== expectedHash) {
      return {
        valid: false,
        checked: idx + 1,
        mismatch: {
          kind: row.event_hash ? "event_hash_mismatch" : "event_hash_missing",
          event_id: row.event_id,
          stream_seq: seq,
          expected_event_hash: expectedHash,
          actual_event_hash: row.event_hash,
        },
      };
    }
  }

  return { valid: true, checked: rows.rows.length };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);

  const stream_type = parseStreamType(parseOptional(process.env.STREAM_TYPE));
  const stream_id = parseOptional(process.env.STREAM_ID);
  if ((stream_type && !stream_id) || (!stream_type && stream_id)) {
    throw new Error("STREAM_TYPE and STREAM_ID must be provided together");
  }
  if (parseOptional(process.env.STREAM_TYPE) && !stream_type) {
    throw new Error("STREAM_TYPE must be one of workspace|room|thread");
  }
  const limit = parseLimit();

  try {
    const streams = await listStreams((sql, values) => pool.query(sql, values), stream_type, stream_id);
    let totalChecked = 0;
    const invalid: Array<{ stream_type: StreamType; stream_id: string; mismatch: Record<string, unknown> }> = [];

    for (const stream of streams) {
      const result = await verifyStream((sql, values) => pool.query(sql, values), stream, limit);
      totalChecked += result.checked;
      if (!result.valid && result.mismatch) {
        invalid.push({
          stream_type: stream.stream_type,
          stream_id: stream.stream_id,
          mismatch: result.mismatch,
        });
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          ok: invalid.length === 0,
          streams_checked: streams.length,
          events_checked: totalChecked,
          invalid_streams: invalid.length,
          first_invalid: invalid[0] ?? null,
        },
        null,
        2,
      ),
    );

    if (invalid.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
