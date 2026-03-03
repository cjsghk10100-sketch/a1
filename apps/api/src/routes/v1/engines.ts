import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import type {
  CapabilityScopesV1,
  EventEnvelopeV1,
  EngineDeactivateRequestV1,
  EngineIssueTokenRequestV1,
  EngineListResponseV1,
  EngineRecordV1,
  EngineRegisterRequestV1,
  EngineRegisterResponseV1,
  EngineRevokeTokenRequestV1,
  EngineTokenListResponseV1,
  EngineTokenRecordV1,
} from "@agentapp/shared";

import {
  buildContractError,
  httpStatusForReasonCode,
  type ContractReasonCode,
} from "../../contracts/pipeline_v2_contract.js";
import { SCHEMA_VERSION, assertSupportedSchemaVersion } from "../../contracts/schemaVersion.js";
import type { DbClient, DbPool } from "../../db/pool.js";
import { appendToStream } from "../../eventStore/index.js";
import {
  defaultEngineCapabilityScopes,
  getEngineTokenSecret,
  hashEngineToken,
  issueEngineTokenTx,
  verifyEngineToken,
} from "../../security/engineTokens.js";
import { ensurePrincipalForLegacyActor } from "../../security/principals.js";
import { getRequestAuth } from "../../security/requestAuth.js";

function getHeaderString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function workspaceIdFromReq(req: { headers: Record<string, unknown> }): string {
  const raw = getHeaderString(req.headers["x-workspace-id"] as string | string[] | undefined);
  return raw?.trim() || "ws_dev";
}

function normalizeOptionalString(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value.length ? value : null;
}

function normalizeOptionalIso(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== "string") return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function normalizeStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<string>();
  for (const value of raw) {
    if (typeof value !== "string") continue;
    const v = value.trim();
    if (!v) continue;
    out.add(v);
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

function normalizeScopes(raw: unknown, fallbackRoomId?: string | null): CapabilityScopesV1 {
  if (!raw || typeof raw !== "object") {
    return defaultEngineCapabilityScopes({ room_id: fallbackRoomId });
  }

  const source = raw as Record<string, unknown>;
  const dataAccessSource =
    source.data_access && typeof source.data_access === "object"
      ? (source.data_access as Record<string, unknown>)
      : undefined;

  const scopes: CapabilityScopesV1 = {
    rooms: normalizeStringList(source.rooms),
    tools: normalizeStringList(source.tools),
    action_types: normalizeStringList(source.action_types),
    egress_domains: normalizeStringList(source.egress_domains),
    data_access: {
      read: normalizeStringList(dataAccessSource?.read),
      write: normalizeStringList(dataAccessSource?.write),
    },
  };

  if (!scopes.rooms?.length) {
    const fallback = defaultEngineCapabilityScopes({ room_id: fallbackRoomId }).rooms;
    if (fallback?.length) scopes.rooms = fallback;
  }
  if (!scopes.action_types?.length) {
    const fallback = defaultEngineCapabilityScopes({ room_id: fallbackRoomId }).action_types;
    if (fallback?.length) scopes.action_types = fallback;
  }

  if (!scopes.rooms?.length) delete scopes.rooms;
  if (!scopes.tools?.length) delete scopes.tools;
  if (!scopes.action_types?.length) delete scopes.action_types;
  if (!scopes.egress_domains?.length) delete scopes.egress_domains;
  if (!scopes.data_access?.read?.length && !scopes.data_access?.write?.length) {
    delete scopes.data_access;
  } else {
    if (!scopes.data_access?.read?.length) delete scopes.data_access?.read;
    if (!scopes.data_access?.write?.length) delete scopes.data_access?.write;
  }

  return scopes;
}

function normalizeMetadata(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

function newEngineId(): string {
  return `eng_${randomUUID().replaceAll("-", "")}`;
}

function serializeEngineRow(row: {
  engine_id: string;
  workspace_id: string;
  engine_name: string;
  actor_id: string;
  principal_id: string;
  metadata: Record<string, unknown> | null;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
  deactivated_at: string | null;
  deactivated_reason: string | null;
}): EngineRecordV1 {
  return {
    engine_id: row.engine_id,
    workspace_id: row.workspace_id,
    engine_name: row.engine_name,
    actor_id: row.actor_id,
    principal_id: row.principal_id,
    metadata: row.metadata ?? {},
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deactivated_at: row.deactivated_at,
    deactivated_reason: row.deactivated_reason,
  };
}

function serializeTokenRow(row: {
  token_id: string;
  workspace_id: string;
  engine_id: string;
  principal_id: string;
  capability_token_id: string;
  token_label: string | null;
  issued_at: string;
  last_seen_at: string | null;
  valid_until: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
  created_by_principal_id: string | null;
}): EngineTokenRecordV1 {
  return {
    token_id: row.token_id,
    workspace_id: row.workspace_id,
    engine_id: row.engine_id,
    principal_id: row.principal_id,
    capability_token_id: row.capability_token_id,
    token_label: row.token_label,
    issued_at: row.issued_at,
    last_seen_at: row.last_seen_at,
    valid_until: row.valid_until,
    revoked_at: row.revoked_at,
    revoked_reason: row.revoked_reason,
    created_by_principal_id: row.created_by_principal_id,
  };
}

const ENGINE_EVIDENCE_INGEST_BODY_LIMIT_BYTES = 10 * 1024 * 1024;
const ENGINE_EVIDENCE_INGEST_MAX_EVENTS = 100;
const ENGINE_EVIDENCE_INGEST_MAX_DATA_BYTES = 64_000;
const ENGINE_EVIDENCE_INGEST_MAX_IDEMPOTENCY_KEY_LENGTH = 256;
const ENGINE_EVIDENCE_INGEST_MAX_EVENT_ID_LENGTH = 128;
const ENGINE_EVIDENCE_INGEST_MAX_EVENT_TYPE_LENGTH = 128;
const ENGINE_EVIDENCE_INGEST_MAX_ENTITY_TYPE_LENGTH = 64;
const ENGINE_EVIDENCE_INGEST_MAX_ENTITY_ID_LENGTH = 128;
const ENGINE_EVIDENCE_INGEST_STATEMENT_TIMEOUT = "10s";
const ENGINE_EVIDENCE_INGEST_GLOBAL_PER_MIN_DEFAULT = 300;
const ENGINE_EVIDENCE_INGEST_WORKSPACE_PER_MIN_DEFAULT = 120;

const ENGINE_EVIDENCE_EVENT_MAX_VERSION = {
  "room.created": 1,
  "thread.created": 1,
  "message.created": 1,
  "approval.requested": 1,
  "approval.decided": 1,
  "run.created": 1,
  "run.started": 1,
  "run.completed": 1,
  "run.failed": 1,
  "evidence.manifest.created": 1,
  "experiment.created": 1,
  "experiment.updated": 1,
  "experiment.closed": 1,
  "scorecard.recorded": 1,
  "lesson.logged": 1,
  "promotion.evaluated": 1,
  "step.created": 1,
  "tool.invoked": 1,
  "tool.succeeded": 1,
  "tool.failed": 1,
  "artifact.created": 1,
  "incident.opened": 1,
  "incident.rca.updated": 1,
  "incident.learning.logged": 1,
  "incident.closed": 1,
  "survival.ledger.rolled_up": 1,
  "lifecycle.state.changed": 1,
  "discord.channel.mapped": 1,
  "discord.message.ingested": 1,
  "engine.registered": 1,
  "engine.token.issued": 1,
  "engine.token.revoked": 1,
  "engine.deactivated": 1,
  "finance.usage_recorded": 1,
} as const satisfies Record<string, number>;

type EngineEvidenceAllowedEventType = keyof typeof ENGINE_EVIDENCE_EVENT_MAX_VERSION;
type IngestResultRow = {
  index: number;
  status: "accepted" | "deduped" | "rejected";
  reason_code?: ContractReasonCode;
};

type IngestWarning = {
  kind: string;
  details?: Record<string, number | boolean>;
};

type IngestEnvelope = EventEnvelopeV1 & {
  entity_type?: string;
  entity_id?: string;
};

type ValidEventCandidate = {
  index: number;
  envelope: IngestEnvelope;
  missing_idempotency_key: boolean;
};

type ValidateEventResult = { ok: true; candidate: ValidEventCandidate } | {
  ok: false;
  reason_code: ContractReasonCode;
};

type IngestBody = {
  schema_version?: unknown;
  engine_id?: unknown;
  engine_token?: unknown;
  events?: unknown;
};

type RateLimitCheck = {
  scope: "global_per_min" | "workspace_per_min";
  bucket_key: string;
  limit: number;
  window_sec: number;
};

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.floor(raw);
}

function ingestGlobalPerMin(): number {
  return parsePositiveIntEnv(
    "ENGINE_EVIDENCE_INGEST_GLOBAL_PER_MIN",
    ENGINE_EVIDENCE_INGEST_GLOBAL_PER_MIN_DEFAULT,
  );
}

function ingestWorkspacePerMin(): number {
  return parsePositiveIntEnv(
    "ENGINE_EVIDENCE_INGEST_WORKSPACE_PER_MIN",
    ENGINE_EVIDENCE_INGEST_WORKSPACE_PER_MIN_DEFAULT,
  );
}

function asRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  return input as Record<string, unknown>;
}

function normalizeRequiredString(
  input: unknown,
  maxLength: number,
): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function ingestOptionalString(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeOptionalObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return input as Record<string, unknown>;
}

function normalizeOptionalZone(input: unknown): "sandbox" | "supervised" | "high_stakes" | undefined {
  if (input === "sandbox" || input === "supervised" || input === "high_stakes") return input;
  return undefined;
}

function isUniqueViolation(err: unknown): boolean {
  return Boolean(
    err &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code?: unknown }).code === "23505",
  );
}

function isClientPayloadDbError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  return code === "22007" || code === "22008" || code === "22P02";
}

function ingestWorkspaceIdFromRawHeader(req: {
  raw?: { rawHeaders?: string[] };
}): string | null {
  const rawHeaders = req.raw?.rawHeaders;
  if (!Array.isArray(rawHeaders)) return null;
  for (let idx = 0; idx < rawHeaders.length - 1; idx += 2) {
    if (rawHeaders[idx]?.toLowerCase() === "x-workspace-id") {
      const candidate = rawHeaders[idx + 1]?.trim();
      return candidate && candidate.length > 0 ? candidate : null;
    }
  }
  return null;
}

function resultByIndex(input: Array<IngestResultRow | undefined>): IngestResultRow[] {
  return input.map((item, index) => item ?? ({ index, status: "rejected", reason_code: "internal_error" }));
}

async function fetchDbServerTime(pool: DbPool): Promise<string> {
  const res = await pool.query<{ server_time: string }>(
    `SELECT (now() AT TIME ZONE 'UTC')::text || 'Z' AS server_time`,
  );
  return res.rows[0]?.server_time ?? "1970-01-01T00:00:00Z";
}

async function resolveEngineTokenWorkspace(
  pool: DbPool,
  engine_id: string,
  engine_token: string,
): Promise<string | null> {
  const token_hash = hashEngineToken(getEngineTokenSecret(), engine_token);
  const res = await pool.query<{ workspace_id: string }>(
    `SELECT workspace_id
     FROM sec_engine_tokens
     WHERE engine_id = $1
       AND token_hash = $2
     ORDER BY issued_at DESC
     LIMIT 1`,
    [engine_id, token_hash],
  );
  if (res.rowCount !== 1) return null;
  return res.rows[0]?.workspace_id ?? null;
}

async function incrementRateLimitBucket(
  client: DbClient,
  input: { bucket_key: string; window_sec: number },
): Promise<{ count: number; retry_after_sec: number; server_time: string }> {
  const res = await client.query<{ count: string; retry_after_sec: string; server_time: string }>(
    `WITH t AS (
       SELECT
         clock_timestamp() AS wall_clock,
         date_trunc('minute', clock_timestamp()) AS window_start
     )
     INSERT INTO rate_limit_buckets (
       bucket_key,
       window_start,
       window_sec,
       count,
       updated_at
     )
     SELECT
       $1,
       (SELECT window_start FROM t),
       $2,
       1,
       (SELECT wall_clock FROM t)
     ON CONFLICT (bucket_key, window_start, window_sec)
     DO UPDATE SET
       count = rate_limit_buckets.count + 1,
       updated_at = (SELECT wall_clock FROM t)
     RETURNING
       count::text AS count,
       GREATEST(
         0,
         EXTRACT(EPOCH FROM (window_start + (window_sec || ' seconds')::interval - (SELECT wall_clock FROM t)))::INT
       )::text AS retry_after_sec,
       ((SELECT wall_clock FROM t) AT TIME ZONE 'UTC')::text || 'Z' AS server_time`,
    [input.bucket_key, input.window_sec],
  );
  return {
    count: Number.parseInt(res.rows[0]?.count ?? "0", 10),
    retry_after_sec: Number.parseInt(res.rows[0]?.retry_after_sec ?? "0", 10),
    server_time: res.rows[0]?.server_time ?? "1970-01-01T00:00:00Z",
  };
}

async function enforceEngineIngestRateLimit(
  pool: DbPool,
  workspace_id: string,
): Promise<{ ok: true } | {
  ok: false;
  details: Record<string, unknown>;
}> {
  const checks: RateLimitCheck[] = [
    {
      scope: "global_per_min" as const,
      bucket_key: "engine_ingest_global",
      limit: ingestGlobalPerMin(),
      window_sec: 60,
    },
    {
      scope: "workspace_per_min" as const,
      bucket_key: `engine_ingest:${workspace_id}`,
      limit: ingestWorkspacePerMin(),
      window_sec: 60,
    },
  ].sort((a, b) => a.bucket_key.localeCompare(b.bucket_key));

  const client = await pool.connect();
  let exceeded: null | {
    scope: string;
    limit: number;
    window_sec: number;
    retry_after_sec: number;
    server_time: string;
  } = null;

  try {
    await client.query("BEGIN");
    for (const rule of checks) {
      const result = await incrementRateLimitBucket(client, {
        bucket_key: rule.bucket_key,
        window_sec: rule.window_sec,
      });
      if (!exceeded && result.count > rule.limit) {
        exceeded = {
          scope: rule.scope,
          limit: rule.limit,
          window_sec: rule.window_sec,
          retry_after_sec: result.retry_after_sec,
          server_time: result.server_time,
        };
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  if (!exceeded) return { ok: true };
  return {
    ok: false,
    details: {
      scope: exceeded.scope,
      limit: exceeded.limit,
      window_sec: exceeded.window_sec,
      retry_after_sec: exceeded.retry_after_sec,
      server_time: exceeded.server_time,
    },
  };
}

function validateIngestEvent(
  input: unknown,
  index: number,
  workspace_id: string,
  actor_id: string,
  principal_id: string,
): ValidateEventResult {
  const eventRecord = asRecord(input);
  if (!eventRecord) {
    return { ok: false, reason_code: "invalid_payload_combination" };
  }

  const event_id = normalizeRequiredString(eventRecord.event_id, ENGINE_EVIDENCE_INGEST_MAX_EVENT_ID_LENGTH);
  if (!event_id) return { ok: false, reason_code: "missing_field" };

  const event_type = normalizeRequiredString(eventRecord.event_type, ENGINE_EVIDENCE_INGEST_MAX_EVENT_TYPE_LENGTH);
  if (!event_type) return { ok: false, reason_code: "missing_field" };
  if (!(event_type in ENGINE_EVIDENCE_EVENT_MAX_VERSION)) {
    return { ok: false, reason_code: "invalid_payload_combination" };
  }

  const event_version_raw = eventRecord.event_version;
  const event_version = event_version_raw === undefined ? 1 : Number(event_version_raw);
  if (!Number.isInteger(event_version) || event_version < 1) {
    return { ok: false, reason_code: "invalid_payload_combination" };
  }
  const maxVersion = ENGINE_EVIDENCE_EVENT_MAX_VERSION[event_type as EngineEvidenceAllowedEventType];
  if (event_version > maxVersion) {
    return { ok: false, reason_code: "invalid_payload_combination" };
  }

  const occurred_at = normalizeRequiredString(eventRecord.occurred_at, 128);
  if (!occurred_at) return { ok: false, reason_code: "missing_field" };

  const attempted_workspace = ingestOptionalString(eventRecord.workspace_id);
  if (attempted_workspace && attempted_workspace !== workspace_id) {
    return { ok: false, reason_code: "unauthorized_workspace" };
  }

  const streamRecord = asRecord(eventRecord.stream);
  if (streamRecord) {
    const incomingType = ingestOptionalString(streamRecord.stream_type);
    const incomingId = ingestOptionalString(streamRecord.stream_id);
    if (incomingType && incomingType !== "workspace") {
      return { ok: false, reason_code: "invalid_payload_combination" };
    }
    if (incomingId && incomingId !== workspace_id) {
      return { ok: false, reason_code: "unauthorized_workspace" };
    }
  }

  const entity_type =
    normalizeRequiredString(eventRecord.entity_type, ENGINE_EVIDENCE_INGEST_MAX_ENTITY_TYPE_LENGTH) ?? undefined;
  const entity_id =
    normalizeRequiredString(eventRecord.entity_id, ENGINE_EVIDENCE_INGEST_MAX_ENTITY_ID_LENGTH) ?? undefined;
  if ((entity_type && !entity_id) || (!entity_type && entity_id)) {
    return { ok: false, reason_code: "invalid_payload_combination" };
  }

  const correlation_id =
    normalizeRequiredString(eventRecord.correlation_id, 256) ??
    `ingest:${workspace_id}:${event_id}`;

  const idempotency_key = ingestOptionalString(eventRecord.idempotency_key);
  if (idempotency_key && idempotency_key.length > ENGINE_EVIDENCE_INGEST_MAX_IDEMPOTENCY_KEY_LENGTH) {
    return { ok: false, reason_code: "invalid_payload_combination" };
  }

  const dataRecord = asRecord(eventRecord.data);
  if (!dataRecord) return { ok: false, reason_code: "missing_field" };
  let dataBytes = 0;
  try {
    dataBytes = Buffer.byteLength(JSON.stringify(dataRecord), "utf8");
  } catch {
    return { ok: false, reason_code: "invalid_payload_combination" };
  }
  if (dataBytes > ENGINE_EVIDENCE_INGEST_MAX_DATA_BYTES) {
    return { ok: false, reason_code: "payload_too_large" };
  }

  const envelope: IngestEnvelope = {
    event_id,
    event_type,
    event_version,
    occurred_at,
    workspace_id,
    mission_id: ingestOptionalString(eventRecord.mission_id),
    room_id: ingestOptionalString(eventRecord.room_id),
    thread_id: ingestOptionalString(eventRecord.thread_id),
    run_id: ingestOptionalString(eventRecord.run_id),
    step_id: ingestOptionalString(eventRecord.step_id),
    actor: { actor_type: "service", actor_id },
    actor_principal_id: principal_id,
    zone: normalizeOptionalZone(eventRecord.zone),
    stream: { stream_type: "workspace", stream_id: workspace_id },
    correlation_id,
    causation_id: ingestOptionalString(eventRecord.causation_id),
    data: dataRecord,
    policy_context: normalizeOptionalObject(eventRecord.policy_context),
    model_context: normalizeOptionalObject(eventRecord.model_context),
    display: normalizeOptionalObject(eventRecord.display),
    redaction_level:
      eventRecord.redaction_level === "none" ||
      eventRecord.redaction_level === "partial" ||
      eventRecord.redaction_level === "full"
        ? eventRecord.redaction_level
        : undefined,
    contains_secrets: typeof eventRecord.contains_secrets === "boolean" ? eventRecord.contains_secrets : undefined,
    idempotency_key,
    entity_type,
    entity_id,
  };

  return {
    ok: true,
    candidate: {
      index,
      envelope,
      missing_idempotency_key: !idempotency_key,
    },
  };
}

export async function registerEngineRoutes(app: FastifyInstance, pool: DbPool): Promise<void> {
  app.get("/v1/engines", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const rows = await pool.query<{
      engine_id: string;
      workspace_id: string;
      engine_name: string;
      actor_id: string;
      principal_id: string;
      metadata: Record<string, unknown> | null;
      status: "active" | "inactive";
      created_at: string;
      updated_at: string;
      deactivated_at: string | null;
      deactivated_reason: string | null;
    }>(
      `SELECT
         engine_id,
         workspace_id,
         engine_name,
         actor_id,
         principal_id,
         metadata,
         status,
         created_at::text AS created_at,
         updated_at::text AS updated_at,
         deactivated_at::text AS deactivated_at,
         deactivated_reason
       FROM sec_engines
       WHERE workspace_id = $1
       ORDER BY updated_at DESC
       LIMIT 500`,
      [workspace_id],
    );
    const response: EngineListResponseV1 = {
      engines: rows.rows.map(serializeEngineRow),
    };
    return reply.code(200).send(response);
  });

  app.get<{
    Params: { engineId: string };
  }>("/v1/engines/:engineId/tokens", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const engine_id = normalizeOptionalString(req.params.engineId);
    if (!engine_id) return reply.code(400).send({ error: "invalid_engine_id" });

    const rows = await pool.query<{
      token_id: string;
      workspace_id: string;
      engine_id: string;
      principal_id: string;
      capability_token_id: string;
      token_label: string | null;
      issued_at: string;
      last_seen_at: string | null;
      valid_until: string | null;
      revoked_at: string | null;
      revoked_reason: string | null;
      created_by_principal_id: string | null;
    }>(
      `SELECT
         token_id,
         workspace_id,
         engine_id,
         principal_id,
         capability_token_id,
         token_label,
         issued_at::text AS issued_at,
         last_seen_at::text AS last_seen_at,
         valid_until::text AS valid_until,
         revoked_at::text AS revoked_at,
         revoked_reason,
         created_by_principal_id
       FROM sec_engine_tokens
       WHERE workspace_id = $1
         AND engine_id = $2
       ORDER BY issued_at DESC
       LIMIT 500`,
      [workspace_id, engine_id],
    );
    const response: EngineTokenListResponseV1 = {
      tokens: rows.rows.map(serializeTokenRow),
    };
    return reply.code(200).send(response);
  });

  app.post<{
    Body: EngineRegisterRequestV1;
  }>("/v1/engines/register", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const actor_id = normalizeOptionalString(req.body.actor_id);
    if (!actor_id) return reply.code(400).send({ error: "actor_id_required" });

    const auth = getRequestAuth(req);
    const engine_name = normalizeOptionalString(req.body.engine_name) ?? actor_id;
    const metadata = normalizeMetadata(req.body.metadata);
    const valid_until_raw = req.body.valid_until;
    const valid_until = normalizeOptionalIso(valid_until_raw);
    if (valid_until_raw != null && !valid_until) {
      return reply.code(400).send({ error: "invalid_valid_until" });
    }
    const token_label = normalizeOptionalString(req.body.token_label);
    const scopes = normalizeScopes(req.body.scopes, null);
    const tokenSecret = getEngineTokenSecret();
    const occurred_at = new Date().toISOString();
    const engine_id = newEngineId();

    const tx = await pool.connect();
    try {
      await tx.query("BEGIN");

      const principal_id = await ensurePrincipalForLegacyActor(tx, "service", actor_id);
      const upserted = await tx.query<{
        engine_id: string;
        workspace_id: string;
        engine_name: string;
        actor_id: string;
        principal_id: string;
        metadata: Record<string, unknown> | null;
        status: "active" | "inactive";
        created_at: string;
        updated_at: string;
        deactivated_at: string | null;
        deactivated_reason: string | null;
      }>(
        `INSERT INTO sec_engines (
          engine_id,
          workspace_id,
          engine_name,
          actor_id,
          principal_id,
          metadata,
          status,
          created_at,
          updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6::jsonb,'active',$7,$7
        )
        ON CONFLICT (workspace_id, actor_id)
        DO UPDATE SET
          engine_name = EXCLUDED.engine_name,
          principal_id = EXCLUDED.principal_id,
          metadata = EXCLUDED.metadata,
          status = 'active',
          updated_at = EXCLUDED.updated_at,
          deactivated_at = NULL,
          deactivated_reason = NULL
        RETURNING
          engine_id,
          workspace_id,
          engine_name,
          actor_id,
          principal_id,
          metadata,
          status,
          created_at::text AS created_at,
          updated_at::text AS updated_at,
          deactivated_at::text AS deactivated_at,
          deactivated_reason`,
        [engine_id, workspace_id, engine_name, actor_id, principal_id, JSON.stringify(metadata), occurred_at],
      );

      const row = upserted.rows[0];
      const issued = await issueEngineTokenTx(tx, {
        workspace_id,
        engine_id: row.engine_id,
        principal_id: row.principal_id,
        granted_by_principal_id: auth.principal_id,
        scopes,
        valid_until,
        token_label,
        created_by_principal_id: auth.principal_id,
        tokenSecret,
      });

      await appendToStream(pool, {
        event_id: randomUUID(),
        event_type: "engine.registered",
        event_version: 1,
        occurred_at,
        workspace_id,
        actor: { actor_type: "service", actor_id: "api" },
        actor_principal_id: auth.principal_id,
        stream: { stream_type: "workspace", stream_id: workspace_id },
        correlation_id: randomUUID(),
        data: {
          engine_id: row.engine_id,
          actor_id: row.actor_id,
          principal_id: row.principal_id,
          capability_token_id: issued.capability_token_id,
          token_id: issued.token_id,
        },
        policy_context: {},
        model_context: {},
        display: {},
      }, tx);

      await tx.query("COMMIT");

      const tokenRow = await pool.query<{
        token_id: string;
        workspace_id: string;
        engine_id: string;
        principal_id: string;
        capability_token_id: string;
        token_label: string | null;
        issued_at: string;
        last_seen_at: string | null;
        valid_until: string | null;
        revoked_at: string | null;
        revoked_reason: string | null;
        created_by_principal_id: string | null;
      }>(
        `SELECT
           token_id,
           workspace_id,
           engine_id,
           principal_id,
           capability_token_id,
           token_label,
           issued_at::text AS issued_at,
           last_seen_at::text AS last_seen_at,
           valid_until::text AS valid_until,
           revoked_at::text AS revoked_at,
           revoked_reason,
           created_by_principal_id
         FROM sec_engine_tokens
         WHERE token_id = $1`,
        [issued.token_id],
      );

      const response: EngineRegisterResponseV1 = {
        engine: serializeEngineRow(row),
        token: {
          ...serializeTokenRow(tokenRow.rows[0]),
          engine_token: issued.engine_token,
        },
      };
      return reply.code(201).send(response);
    } catch (err) {
      await tx.query("ROLLBACK");
      throw err;
    } finally {
      tx.release();
    }
  });

  app.post<{
    Params: { engineId: string };
    Body: EngineIssueTokenRequestV1;
  }>("/v1/engines/:engineId/tokens/issue", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const engine_id = normalizeOptionalString(req.params.engineId);
    if (!engine_id) return reply.code(400).send({ error: "invalid_engine_id" });

    const auth = getRequestAuth(req);
    const valid_until_raw = req.body.valid_until;
    const valid_until = normalizeOptionalIso(valid_until_raw);
    if (valid_until_raw != null && !valid_until) {
      return reply.code(400).send({ error: "invalid_valid_until" });
    }
    const token_label = normalizeOptionalString(req.body.token_label);
    const scopes = normalizeScopes(req.body.scopes, null);
    const tokenSecret = getEngineTokenSecret();
    const occurred_at = new Date().toISOString();

    const tx = await pool.connect();
    try {
      await tx.query("BEGIN");
      const engine = await tx.query<{
        engine_id: string;
        workspace_id: string;
        engine_name: string;
        actor_id: string;
        principal_id: string;
        metadata: Record<string, unknown> | null;
        status: "active" | "inactive";
        created_at: string;
        updated_at: string;
        deactivated_at: string | null;
        deactivated_reason: string | null;
      }>(
        `SELECT
           engine_id,
           workspace_id,
           engine_name,
           actor_id,
           principal_id,
           metadata,
           status,
           created_at::text AS created_at,
           updated_at::text AS updated_at,
           deactivated_at::text AS deactivated_at,
           deactivated_reason
         FROM sec_engines
         WHERE workspace_id = $1
           AND engine_id = $2`,
        [workspace_id, engine_id],
      );
      if (engine.rowCount !== 1) {
        await tx.query("ROLLBACK");
        return reply.code(404).send({ error: "engine_not_found" });
      }
      if (engine.rows[0].status !== "active") {
        await tx.query("ROLLBACK");
        return reply.code(409).send({ error: "engine_inactive" });
      }

      const issued = await issueEngineTokenTx(tx, {
        workspace_id,
        engine_id,
        principal_id: engine.rows[0].principal_id,
        granted_by_principal_id: auth.principal_id,
        scopes,
        valid_until,
        token_label,
        created_by_principal_id: auth.principal_id,
        tokenSecret,
      });

      await appendToStream(pool, {
        event_id: randomUUID(),
        event_type: "engine.token.issued",
        event_version: 1,
        occurred_at,
        workspace_id,
        actor: { actor_type: "service", actor_id: "api" },
        actor_principal_id: auth.principal_id,
        stream: { stream_type: "workspace", stream_id: workspace_id },
        correlation_id: randomUUID(),
        data: {
          engine_id,
          capability_token_id: issued.capability_token_id,
          token_id: issued.token_id,
        },
        policy_context: {},
        model_context: {},
        display: {},
      }, tx);

      await tx.query("COMMIT");

      const tokenRow = await pool.query<{
        token_id: string;
        workspace_id: string;
        engine_id: string;
        principal_id: string;
        capability_token_id: string;
        token_label: string | null;
        issued_at: string;
        last_seen_at: string | null;
        valid_until: string | null;
        revoked_at: string | null;
        revoked_reason: string | null;
        created_by_principal_id: string | null;
      }>(
        `SELECT
           token_id,
           workspace_id,
           engine_id,
           principal_id,
           capability_token_id,
           token_label,
           issued_at::text AS issued_at,
           last_seen_at::text AS last_seen_at,
           valid_until::text AS valid_until,
           revoked_at::text AS revoked_at,
           revoked_reason,
           created_by_principal_id
         FROM sec_engine_tokens
         WHERE token_id = $1`,
        [issued.token_id],
      );

      return reply.code(201).send({
        engine: serializeEngineRow(engine.rows[0]),
        token: {
          ...serializeTokenRow(tokenRow.rows[0]),
          engine_token: issued.engine_token,
        },
      } satisfies EngineRegisterResponseV1);
    } catch (err) {
      await tx.query("ROLLBACK");
      throw err;
    } finally {
      tx.release();
    }
  });

  app.post<{ Body: IngestBody }>(
    "/v1/engines/evidence/ingest",
    {
      bodyLimit: ENGINE_EVIDENCE_INGEST_BODY_LIMIT_BYTES,
      errorHandler(err, _req, reply) {
        if ((err as { code?: string }).code === "FST_ERR_CTP_BODY_TOO_LARGE") {
          const reason_code = "payload_too_large" as const;
          return reply
            .code(httpStatusForReasonCode(reason_code))
            .send(
              buildContractError(reason_code, {
                max_bytes: ENGINE_EVIDENCE_INGEST_BODY_LIMIT_BYTES,
              }),
            );
        }
        const reason_code = "internal_error" as const;
        return reply.code(httpStatusForReasonCode(reason_code)).send(buildContractError(reason_code));
      },
    },
    async (req, reply) => {
      const bodyRecord = asRecord(req.body);
      const schema_version = bodyRecord?.schema_version;
      try {
        assertSupportedSchemaVersion(schema_version);
      } catch {
        const reason_code = "unsupported_version" as const;
        return reply
          .code(httpStatusForReasonCode(reason_code))
          .send(buildContractError(reason_code, { schema_version: schema_version ?? null }));
      }

      const workspace_id = ingestWorkspaceIdFromRawHeader(req);
      if (!workspace_id) {
        const reason_code = "missing_workspace_header" as const;
        return reply
          .code(httpStatusForReasonCode(reason_code))
          .send(buildContractError(reason_code, { header: "x-workspace-id" }));
      }

      const engine_id = normalizeRequiredString(bodyRecord?.engine_id, 128);
      const engine_token = normalizeRequiredString(bodyRecord?.engine_token, 512);
      if (!engine_id || !engine_token) {
        const reason_code = "missing_required_field" as const;
        return reply
          .code(httpStatusForReasonCode(reason_code))
          .send(buildContractError(reason_code, { field: "engine_id,engine_token" }));
      }

      if (!Array.isArray(bodyRecord?.events)) {
        const reason_code = "missing_field" as const;
        return reply
          .code(httpStatusForReasonCode(reason_code))
          .send(buildContractError(reason_code, { field: "events" }));
      }
      if (bodyRecord.events.length > ENGINE_EVIDENCE_INGEST_MAX_EVENTS) {
        const reason_code = "invalid_payload_combination" as const;
        return reply
          .code(httpStatusForReasonCode(reason_code))
          .send(
            buildContractError(reason_code, {
              field: "events",
              max: ENGINE_EVIDENCE_INGEST_MAX_EVENTS,
            }),
          );
      }

      try {
        const token_workspace_id = await resolveEngineTokenWorkspace(pool, engine_id, engine_token);
        if (!token_workspace_id) {
          const reason_code = "unknown_agent" as const;
          return reply
            .code(httpStatusForReasonCode(reason_code))
            .send(buildContractError(reason_code));
        }
        if (token_workspace_id !== workspace_id) {
          const reason_code = "unauthorized_workspace" as const;
          return reply
            .code(httpStatusForReasonCode(reason_code))
            .send(
              buildContractError(reason_code, {
                header_workspace_id: workspace_id,
                token_workspace_id,
              }),
            );
        }

        const tokenCheck = await verifyEngineToken(
          pool,
          {
            workspace_id,
            engine_id,
            engine_token,
            required_action: "evidence.ingest",
          },
          getEngineTokenSecret(),
        );
        if (!tokenCheck.ok) {
          const reason_code = "unknown_agent" as const;
          return reply
            .code(httpStatusForReasonCode(reason_code))
            .send(buildContractError(reason_code, { error: tokenCheck.error }));
        }

        const rateLimit = await enforceEngineIngestRateLimit(pool, workspace_id);
        if (!rateLimit.ok) {
          const reason_code = "rate_limited" as const;
          return reply
            .code(httpStatusForReasonCode(reason_code))
            .send(buildContractError(reason_code, rateLimit.details));
        }

        const results: Array<IngestResultRow | undefined> = new Array(bodyRecord.events.length);
        const candidates: ValidEventCandidate[] = [];
        const missingIdempotencyIndexes = new Set<number>();

        for (let index = 0; index < bodyRecord.events.length; index += 1) {
          const validated = validateIngestEvent(
            bodyRecord.events[index],
            index,
            workspace_id,
            tokenCheck.auth.actor_id,
            tokenCheck.auth.principal_id,
          );
          if (!validated.ok) {
            results[index] = {
              index,
              status: "rejected",
              reason_code: validated.reason_code,
            };
            continue;
          }
          candidates.push(validated.candidate);
          if (validated.candidate.missing_idempotency_key) {
            missingIdempotencyIndexes.add(validated.candidate.index);
          }
        }

        if (candidates.length === 0) {
          const server_time = await fetchDbServerTime(pool);
          const finalResults = resultByIndex(results);
          const warnings: IngestWarning[] = [];
          return reply.code(200).send({
            schema_version: SCHEMA_VERSION,
            server_time,
            accepted: 0,
            deduped: 0,
            rejected: finalResults.length,
            warnings,
            results: finalResults,
          });
        }

        const tx = await pool.connect();
        let server_time = "1970-01-01T00:00:00Z";
        let fatalError: unknown = null;
        try {
          await tx.query("BEGIN");
          await tx.query("SELECT set_config('statement_timeout', $1, true)", [ENGINE_EVIDENCE_INGEST_STATEMENT_TIMEOUT]);

          const rollbackToSavepoint = async (name: string): Promise<void> => {
            await tx.query(`ROLLBACK TO SAVEPOINT ${name}`).catch(() => {});
            await tx.query(`RELEASE SAVEPOINT ${name}`).catch(() => {});
          };

          for (const candidate of candidates) {
            const savepointName = `sp_evt_${candidate.index}`;
            await tx.query(`SAVEPOINT ${savepointName}`);
            try {
              const futureCheck = await tx.query<{ is_future: boolean }>(
                `SELECT ($1::timestamptz > now() + interval '24 hours') AS is_future`,
                [candidate.envelope.occurred_at],
              );
              if (futureCheck.rows[0]?.is_future === true) {
                results[candidate.index] = {
                  index: candidate.index,
                  status: "rejected",
                  reason_code: "invalid_payload_combination",
                };
                await rollbackToSavepoint(savepointName);
                continue;
              }

              await appendToStream(pool, candidate.envelope as EventEnvelopeV1, tx);
              results[candidate.index] = { index: candidate.index, status: "accepted" };
              await tx.query(`RELEASE SAVEPOINT ${savepointName}`);
            } catch (err) {
              if (isUniqueViolation(err)) {
                results[candidate.index] = { index: candidate.index, status: "deduped" };
                await rollbackToSavepoint(savepointName);
                continue;
              }
              if (isClientPayloadDbError(err)) {
                results[candidate.index] = {
                  index: candidate.index,
                  status: "rejected",
                  reason_code: "invalid_payload_combination",
                };
                await rollbackToSavepoint(savepointName);
                continue;
              }
              fatalError = err;
              throw err;
            }
          }

          const serverTimeRes = await tx.query<{ server_time: string }>(
            `SELECT (now() AT TIME ZONE 'UTC')::text || 'Z' AS server_time`,
          );
          server_time = serverTimeRes.rows[0]?.server_time ?? server_time;
          await tx.query("COMMIT");
        } catch (err) {
          fatalError = fatalError ?? err;
          await tx.query("ROLLBACK").catch(() => {});
        } finally {
          tx.release();
        }

        if (fatalError) {
          req.log.error(
            {
              event: "engine_evidence_ingest_failed",
              workspace_id,
              err_name: fatalError instanceof Error ? fatalError.name : "Error",
            },
            "engine evidence ingest failed",
          );
          const reason_code = "internal_error" as const;
          return reply.code(httpStatusForReasonCode(reason_code)).send(buildContractError(reason_code));
        }

        const finalResults = resultByIndex(results);
        const accepted = finalResults.filter((row) => row.status === "accepted").length;
        const deduped = finalResults.filter((row) => row.status === "deduped").length;
        const rejected = finalResults.filter((row) => row.status === "rejected").length;

        const missingIdempotencyAcceptedCount = finalResults.reduce((sum, row) => {
          if (row.status !== "accepted") return sum;
          if (!missingIdempotencyIndexes.has(row.index)) return sum;
          return sum + 1;
        }, 0);
        const warnings: IngestWarning[] = [];
        if (missingIdempotencyAcceptedCount > 0) {
          warnings.push({
            kind: "missing_idempotency_key",
            details: { count: missingIdempotencyAcceptedCount },
          });
        }

        return reply.code(200).send({
          schema_version: SCHEMA_VERSION,
          server_time,
          accepted,
          deduped,
          rejected,
          warnings,
          results: finalResults,
        });
      } catch (err) {
        req.log.error(
          {
            event: "engine_evidence_ingest_fatal",
            workspace_id,
            err_name: err instanceof Error ? err.name : "Error",
          },
          "engine evidence ingest fatal error",
        );
        const reason_code = "internal_error" as const;
        return reply.code(httpStatusForReasonCode(reason_code)).send(buildContractError(reason_code));
      }
    },
  );

  app.post<{
    Params: { engineId: string; tokenId: string };
    Body: EngineRevokeTokenRequestV1;
  }>("/v1/engines/:engineId/tokens/:tokenId/revoke", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const engine_id = normalizeOptionalString(req.params.engineId);
    const token_id = normalizeOptionalString(req.params.tokenId);
    if (!engine_id) return reply.code(400).send({ error: "invalid_engine_id" });
    if (!token_id) return reply.code(400).send({ error: "invalid_token_id" });
    const reason = normalizeOptionalString(req.body.reason) ?? "manual_revoke";
    const auth = getRequestAuth(req);
    const revoked_at = new Date().toISOString();
    let revokedCapabilityTokenId: string | null = null;

    const tx = await pool.connect();
    try {
      await tx.query("BEGIN");
      const token = await tx.query<{ capability_token_id: string; revoked_at: string | null }>(
        `SELECT capability_token_id, revoked_at::text
         FROM sec_engine_tokens
         WHERE workspace_id = $1
           AND engine_id = $2
           AND token_id = $3`,
        [workspace_id, engine_id, token_id],
      );
      if (token.rowCount !== 1) {
        await tx.query("ROLLBACK");
        return reply.code(404).send({ error: "engine_token_not_found" });
      }

      const already_revoked = Boolean(token.rows[0].revoked_at);
      if (!already_revoked) {
        revokedCapabilityTokenId = token.rows[0].capability_token_id;
        await tx.query(
          `UPDATE sec_engine_tokens
           SET revoked_at = $4,
               revoked_reason = $5
           WHERE workspace_id = $1
             AND engine_id = $2
             AND token_id = $3`,
          [workspace_id, engine_id, token_id, revoked_at, reason],
        );
        await tx.query(
          `UPDATE sec_capability_tokens
           SET revoked_at = COALESCE(revoked_at, $3)
           WHERE workspace_id = $1
             AND token_id = $2`,
          [workspace_id, revokedCapabilityTokenId, revoked_at],
        );
      }

      if (revokedCapabilityTokenId) {
        await appendToStream(pool, {
          event_id: randomUUID(),
          event_type: "engine.token.revoked",
          event_version: 1,
          occurred_at: revoked_at,
          workspace_id,
          actor: { actor_type: "service", actor_id: "api" },
          actor_principal_id: auth.principal_id,
          stream: { stream_type: "workspace", stream_id: workspace_id },
          correlation_id: randomUUID(),
          data: {
            engine_id,
            token_id,
            capability_token_id: revokedCapabilityTokenId,
            reason,
          },
          policy_context: {},
          model_context: {},
          display: {},
        }, tx);
      }
      await tx.query("COMMIT");
      return reply.code(200).send({ ok: true, already_revoked });
    } catch (err) {
      await tx.query("ROLLBACK");
      throw err;
    } finally {
      tx.release();
    }
  });

  app.post<{
    Params: { engineId: string };
    Body: EngineDeactivateRequestV1;
  }>("/v1/engines/:engineId/deactivate", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const engine_id = normalizeOptionalString(req.params.engineId);
    if (!engine_id) return reply.code(400).send({ error: "invalid_engine_id" });
    const reason = normalizeOptionalString(req.body.reason) ?? "manual_deactivate";
    const auth = getRequestAuth(req);
    const deactivated_at = new Date().toISOString();
    let revokedTokenIds: string[] = [];
    let revokedCapabilityIds: string[] = [];

    const tx = await pool.connect();
    try {
      await tx.query("BEGIN");

      const engineUpdate = await tx.query<{
        engine_id: string;
        workspace_id: string;
        engine_name: string;
        actor_id: string;
        principal_id: string;
        metadata: Record<string, unknown> | null;
        status: "active" | "inactive";
        created_at: string;
        updated_at: string;
        deactivated_at: string | null;
        deactivated_reason: string | null;
      }>(
        `UPDATE sec_engines
         SET status = 'inactive',
             updated_at = $3,
             deactivated_at = $3,
             deactivated_reason = $4
         WHERE workspace_id = $1
           AND engine_id = $2
         RETURNING
           engine_id,
           workspace_id,
           engine_name,
           actor_id,
           principal_id,
           metadata,
           status,
           created_at::text AS created_at,
           updated_at::text AS updated_at,
           deactivated_at::text AS deactivated_at,
           deactivated_reason`,
        [workspace_id, engine_id, deactivated_at, reason],
      );
      if (engineUpdate.rowCount !== 1) {
        await tx.query("ROLLBACK");
        return reply.code(404).send({ error: "engine_not_found" });
      }

      const activeTokens = await tx.query<{ token_id: string; capability_token_id: string }>(
        `SELECT token_id, capability_token_id
         FROM sec_engine_tokens
         WHERE workspace_id = $1
           AND engine_id = $2
           AND revoked_at IS NULL`,
        [workspace_id, engine_id],
      );

      if (activeTokens.rowCount) {
        revokedTokenIds = activeTokens.rows.map((row) => row.token_id);
        revokedCapabilityIds = activeTokens.rows.map((row) => row.capability_token_id);
        await tx.query(
          `UPDATE sec_engine_tokens
           SET revoked_at = $3,
               revoked_reason = $4
           WHERE workspace_id = $1
             AND engine_id = $2
             AND revoked_at IS NULL`,
          [workspace_id, engine_id, deactivated_at, `engine_deactivated:${reason}`],
        );
        await tx.query(
          `UPDATE sec_capability_tokens
           SET revoked_at = COALESCE(revoked_at, $3)
           WHERE workspace_id = $1
             AND token_id = ANY($2::text[])`,
          [workspace_id, revokedCapabilityIds, deactivated_at],
        );
      }

      await appendToStream(pool, {
        event_id: randomUUID(),
        event_type: "engine.deactivated",
        event_version: 1,
        occurred_at: deactivated_at,
        workspace_id,
        actor: { actor_type: "service", actor_id: "api" },
        actor_principal_id: auth.principal_id,
        stream: { stream_type: "workspace", stream_id: workspace_id },
        correlation_id: randomUUID(),
        data: {
          engine_id,
          token_ids: revokedTokenIds,
          capability_token_ids: revokedCapabilityIds,
          reason,
        },
        policy_context: {},
        model_context: {},
        display: {},
      }, tx);
      await tx.query("COMMIT");
      return reply.code(200).send({
        ok: true,
        engine: serializeEngineRow(engineUpdate.rows[0]),
      });
    } catch (err) {
      await tx.query("ROLLBACK");
      throw err;
    } finally {
      tx.release();
    }
  });
}
