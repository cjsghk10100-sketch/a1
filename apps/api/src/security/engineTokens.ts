import { createHmac, randomBytes, randomUUID } from "node:crypto";

import type { CapabilityScopesV1 } from "@agentapp/shared";

import type { DbClient, DbPool } from "../db/pool.js";

export interface EngineAuthContext {
  engine_id: string;
  actor_id: string;
  principal_id: string;
  capability_token_id: string;
  token_id: string;
  allowed_rooms: string[] | null;
}

export interface VerifyEngineTokenInput {
  workspace_id: string;
  engine_id: string;
  engine_token: string;
  required_action: string;
  room_id?: string | null;
}

export interface VerifyEngineTokenOk {
  ok: true;
  auth: EngineAuthContext;
}

export interface VerifyEngineTokenDenied {
  ok: false;
  error:
    | "engine_token_invalid"
    | "engine_inactive"
    | "engine_token_expired"
    | "capability_token_revoked"
    | "capability_token_expired"
    | "capability_principal_mismatch"
    | "engine_action_not_allowed"
    | "engine_room_not_allowed"
    | "engine_room_scope_required";
}

export type VerifyEngineTokenResult = VerifyEngineTokenOk | VerifyEngineTokenDenied;

interface EngineTokenRow {
  engine_id: string;
  actor_id: string;
  engine_status: "active" | "inactive";
  principal_id: string;
  token_id: string;
  token_valid_until: string | null;
  token_revoked_at: string | null;
  capability_token_id: string;
  capability_scopes: CapabilityScopesV1 | null;
  capability_valid_until: string | null;
  capability_revoked_at: string | null;
  capability_principal_id: string;
}

function normalizeScopeList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const v = value.trim();
    if (!v) continue;
    out.add(v);
  }
  return [...out];
}

function normalizeScopes(raw: unknown): CapabilityScopesV1 {
  if (!raw || typeof raw !== "object") return {};
  const source = raw as Record<string, unknown>;
  const dataAccessSource =
    source.data_access && typeof source.data_access === "object"
      ? (source.data_access as Record<string, unknown>)
      : undefined;

  const scopes: CapabilityScopesV1 = {
    rooms: normalizeScopeList(source.rooms),
    tools: normalizeScopeList(source.tools),
    egress_domains: normalizeScopeList(source.egress_domains),
    action_types: normalizeScopeList(source.action_types),
    data_access: {
      read: normalizeScopeList(dataAccessSource?.read),
      write: normalizeScopeList(dataAccessSource?.write),
    },
  };

  if (!scopes.rooms?.length) delete scopes.rooms;
  if (!scopes.tools?.length) delete scopes.tools;
  if (!scopes.egress_domains?.length) delete scopes.egress_domains;
  if (!scopes.action_types?.length) delete scopes.action_types;
  if (!scopes.data_access?.read?.length && !scopes.data_access?.write?.length) {
    delete scopes.data_access;
  } else {
    if (!scopes.data_access?.read?.length) delete scopes.data_access?.read;
    if (!scopes.data_access?.write?.length) delete scopes.data_access?.write;
  }

  return scopes;
}

function listAllowsValue(values: string[] | undefined, candidate: string): boolean {
  if (!values?.length) return false;
  const set = new Set(values);
  return set.has("*") || set.has(candidate);
}

export function getEngineTokenSecret(env: NodeJS.ProcessEnv = process.env): string {
  const direct = env.ENGINE_TOKEN_SECRET?.trim();
  if (direct && direct.length > 0) return direct;

  const fallback = env.AUTH_SESSION_SECRET?.trim();
  if (fallback && fallback.length > 0) return fallback;

  return "agentapp_local_dev_engine_token_secret";
}

export function hashEngineToken(secret: string, engineToken: string): string {
  return createHmac("sha256", secret).update(engineToken, "utf8").digest("hex");
}

export function generateEngineToken(): string {
  return `engtok_${randomBytes(32).toString("base64url")}`;
}

function nowMs(): number {
  return Date.now();
}

function isExpired(raw: string | null): boolean {
  if (!raw) return false;
  return new Date(raw).getTime() <= nowMs();
}

export function defaultEngineCapabilityScopes(input: {
  room_id?: string | null;
}): CapabilityScopesV1 {
  const room_id = input.room_id?.trim() || null;
  return {
    action_types: ["run.claim", "run.lease.heartbeat", "run.lease.release"],
    rooms: room_id ? [room_id] : ["*"],
  };
}

export async function issueEngineTokenTx(
  tx: DbClient,
  input: {
    workspace_id: string;
    engine_id: string;
    principal_id: string;
    granted_by_principal_id: string;
    scopes: CapabilityScopesV1;
    valid_until: string | null;
    token_label: string | null;
    created_by_principal_id: string | null;
    tokenSecret: string;
  },
): Promise<{
  token_id: string;
  capability_token_id: string;
  engine_token: string;
}> {
  const token_id = `engtok_${randomUUID().replaceAll("-", "")}`;
  const capability_token_id = randomUUID();
  const engine_token = generateEngineToken();
  const token_hash = hashEngineToken(input.tokenSecret, engine_token);

  await tx.query(
    `INSERT INTO sec_capability_tokens (
      token_id,
      workspace_id,
      issued_to_principal_id,
      granted_by_principal_id,
      parent_token_id,
      scopes,
      valid_until,
      created_at
    ) VALUES ($1,$2,$3,$4,NULL,$5::jsonb,$6,now())`,
    [
      capability_token_id,
      input.workspace_id,
      input.principal_id,
      input.granted_by_principal_id,
      JSON.stringify(input.scopes),
      input.valid_until,
    ],
  );

  await tx.query(
    `INSERT INTO sec_engine_tokens (
      token_id,
      workspace_id,
      engine_id,
      principal_id,
      capability_token_id,
      token_hash,
      token_label,
      issued_at,
      valid_until,
      created_by_principal_id
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,now(),$8,$9)`,
    [
      token_id,
      input.workspace_id,
      input.engine_id,
      input.principal_id,
      capability_token_id,
      token_hash,
      input.token_label,
      input.valid_until,
      input.created_by_principal_id,
    ],
  );

  return { token_id, capability_token_id, engine_token };
}

export async function verifyEngineToken(
  pool: DbPool,
  input: VerifyEngineTokenInput,
  tokenSecret: string,
): Promise<VerifyEngineTokenResult> {
  const engine_id = input.engine_id.trim();
  const engine_token = input.engine_token.trim();
  if (!engine_id || !engine_token) return { ok: false, error: "engine_token_invalid" };
  const token_hash = hashEngineToken(tokenSecret, engine_token);

  const rowRes = await pool.query<EngineTokenRow>(
    `SELECT
       e.engine_id,
       e.actor_id,
       e.status AS engine_status,
       e.principal_id,
       et.token_id,
       et.valid_until::text AS token_valid_until,
       et.revoked_at::text AS token_revoked_at,
       et.capability_token_id,
       ct.scopes AS capability_scopes,
       ct.valid_until::text AS capability_valid_until,
       ct.revoked_at::text AS capability_revoked_at,
       ct.issued_to_principal_id AS capability_principal_id
     FROM sec_engine_tokens et
     INNER JOIN sec_engines e
       ON e.engine_id = et.engine_id
      AND e.workspace_id = et.workspace_id
     INNER JOIN sec_capability_tokens ct
       ON ct.token_id = et.capability_token_id
      AND ct.workspace_id = et.workspace_id
     WHERE et.workspace_id = $1
       AND et.engine_id = $2
       AND et.token_hash = $3
     LIMIT 1`,
    [input.workspace_id, engine_id, token_hash],
  );
  if (rowRes.rowCount !== 1) {
    return { ok: false, error: "engine_token_invalid" };
  }
  const row = rowRes.rows[0];

  if (row.engine_status !== "active") return { ok: false, error: "engine_inactive" };
  if (row.token_revoked_at || isExpired(row.token_valid_until)) {
    return { ok: false, error: "engine_token_expired" };
  }
  if (row.capability_revoked_at) return { ok: false, error: "capability_token_revoked" };
  if (isExpired(row.capability_valid_until)) return { ok: false, error: "capability_token_expired" };
  if (row.capability_principal_id !== row.principal_id) {
    return { ok: false, error: "capability_principal_mismatch" };
  }

  const scopes = normalizeScopes(row.capability_scopes ?? {});
  const actionTypes = normalizeScopeList(scopes.action_types);
  if (!listAllowsValue(actionTypes, input.required_action)) {
    return { ok: false, error: "engine_action_not_allowed" };
  }

  const roomScopes = normalizeScopeList(scopes.rooms);
  const room_id = input.room_id?.trim() || null;
  if (room_id) {
    if (!listAllowsValue(roomScopes, room_id)) {
      return { ok: false, error: "engine_room_not_allowed" };
    }
  } else if (!roomScopes.length) {
    return { ok: false, error: "engine_room_scope_required" };
  }

  await pool.query(
    `UPDATE sec_engine_tokens
     SET last_seen_at = now()
     WHERE token_id = $1`,
    [row.token_id],
  );

  return {
    ok: true,
    auth: {
      engine_id: row.engine_id,
      actor_id: row.actor_id,
      principal_id: row.principal_id,
      capability_token_id: row.capability_token_id,
      token_id: row.token_id,
      allowed_rooms: roomScopes.length ? roomScopes : null,
    },
  };
}
