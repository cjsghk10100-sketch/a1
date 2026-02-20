import type { FastifyInstance } from "fastify";

import type { ActorType, EventEnvelopeV1, StreamType, Zone } from "@agentapp/shared";

import type { DbPool } from "../../db/pool.js";
import { computeEventHashV1 } from "../../security/hashChain.js";

function getHeaderString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function workspaceIdFromReq(req: { headers: Record<string, unknown> }): string {
  const raw = getHeaderString(req.headers["x-workspace-id"] as string | string[] | undefined);
  return raw?.trim() || "ws_dev";
}

function normalizeOptionalString(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim();
  return v.length ? v : undefined;
}

function normalizeStreamType(raw: unknown): StreamType | undefined {
  if (raw === "room" || raw === "thread" || raw === "workspace") return raw;
  return undefined;
}

function normalizeLimit(raw: unknown): number {
  const parsed = Number(raw ?? "2000");
  if (!Number.isFinite(parsed)) return 2000;
  return Math.max(1, Math.min(10000, Math.floor(parsed)));
}

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

export async function registerAuditRoutes(app: FastifyInstance, pool: DbPool): Promise<void> {
  app.get<{
    Querystring: {
      stream_type?: StreamType;
      stream_id?: string;
      limit?: string;
    };
  }>("/v1/audit/hash-chain/verify", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const stream_type = normalizeStreamType(req.query.stream_type) ?? "workspace";
    const stream_id = normalizeOptionalString(req.query.stream_id) ?? workspace_id;
    const limit = normalizeLimit(req.query.limit);

    const rows = await pool.query<ChainRow>(
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
      [stream_type, stream_id, limit],
    );

    const checkedCount = rows.rowCount ?? rows.rows.length;

    let first_mismatch:
      | {
          stream_seq: number;
          event_id: string;
          event_type: string;
          kind: "prev_hash_mismatch" | "event_hash_mismatch" | "event_hash_missing";
          expected_prev_event_hash: string | null;
          actual_prev_event_hash: string | null;
          expected_event_hash: string | null;
          actual_event_hash: string | null;
        }
      | null = null;

    for (let idx = 0; idx < checkedCount; idx += 1) {
      const row = rows.rows[idx];
      const stream_seq = Number.parseInt(row.stream_seq, 10);
      const expected_prev_event_hash = idx === 0 ? null : rows.rows[idx - 1].event_hash;
      const occurredDate = new Date(row.occurred_at);
      const occurred_at = Number.isNaN(occurredDate.getTime())
        ? row.occurred_at
        : occurredDate.toISOString();

      if (row.prev_event_hash !== expected_prev_event_hash) {
        first_mismatch = {
          stream_seq,
          event_id: row.event_id,
          event_type: row.event_type,
          kind: "prev_hash_mismatch",
          expected_prev_event_hash,
          actual_prev_event_hash: row.prev_event_hash,
          expected_event_hash: null,
          actual_event_hash: row.event_hash,
        };
        break;
      }

      const envelope: EventEnvelopeV1 = {
        event_id: row.event_id,
        event_type: row.event_type,
        event_version: row.event_version,
        occurred_at,
        workspace_id: row.workspace_id,
        mission_id: row.mission_id ?? undefined,
        room_id: row.room_id ?? undefined,
        thread_id: row.thread_id ?? undefined,
        run_id: row.run_id ?? undefined,
        step_id: row.step_id ?? undefined,
        actor: { actor_type: row.actor_type, actor_id: row.actor_id },
        actor_principal_id: row.actor_principal_id ?? undefined,
        zone: row.zone,
        stream: {
          stream_type: row.stream_type,
          stream_id: row.stream_id,
          stream_seq,
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

      const expected_event_hash = computeEventHashV1(envelope, row.prev_event_hash ?? null);
      if (!row.event_hash) {
        first_mismatch = {
          stream_seq,
          event_id: row.event_id,
          event_type: row.event_type,
          kind: "event_hash_missing",
          expected_prev_event_hash,
          actual_prev_event_hash: row.prev_event_hash,
          expected_event_hash,
          actual_event_hash: null,
        };
        break;
      }
      if (row.event_hash !== expected_event_hash) {
        first_mismatch = {
          stream_seq,
          event_id: row.event_id,
          event_type: row.event_type,
          kind: "event_hash_mismatch",
          expected_prev_event_hash,
          actual_prev_event_hash: row.prev_event_hash,
          expected_event_hash,
          actual_event_hash: row.event_hash,
        };
        break;
      }
    }

    return reply.code(200).send({
      stream_type,
      stream_id,
      checked: checkedCount,
      valid: first_mismatch == null,
      first_mismatch,
      last_event_hash: checkedCount ? rows.rows[checkedCount - 1].event_hash : null,
    });
  });
}
