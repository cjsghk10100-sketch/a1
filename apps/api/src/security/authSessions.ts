import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

import type { DbClient, DbPool } from "../db/pool.js";

export type SessionPrincipalType = "user" | "agent" | "service";

export interface OwnerRecord {
  owner_id: string;
  workspace_id: string;
  principal_id: string;
  principal_type: SessionPrincipalType;
  display_name: string;
  passphrase_hash: string | null;
}

export interface SessionRecord {
  session_id: string;
  owner_id: string;
  workspace_id: string;
  principal_id: string;
  principal_type: SessionPrincipalType;
  access_expires_at: string;
  refresh_expires_at: string;
}

export interface SessionIssueResult {
  session_id: string;
  access_token: string;
  refresh_token: string;
  access_expires_at: string;
  refresh_expires_at: string;
}

export interface SessionConfig {
  sessionSecret: string;
  accessTtlSec: number;
  refreshTtlSec: number;
}

type RawSessionRow = {
  session_id: string;
  owner_id: string;
  workspace_id: string;
  principal_id: string;
  principal_type: string;
  access_expires_at: string;
  refresh_expires_at: string;
};

export function hashOpaqueToken(secret: string, token: string): string {
  return createHash("sha256").update(secret).update(":").update(token).digest("hex");
}

export function issueOpaqueToken(prefix: string): string {
  const entropy = randomBytes(24).toString("base64url");
  return `${prefix}_${entropy}`;
}

export function hashPassphrase(passphrase: string): string {
  const salt = randomBytes(16).toString("hex");
  const digest = scryptSync(passphrase, salt, 32).toString("hex");
  return `scrypt$${salt}$${digest}`;
}

export function verifyPassphrase(passphrase: string, encoded: string): boolean {
  const [algorithm, salt, digestHex] = encoded.split("$");
  if (algorithm !== "scrypt" || !salt || !digestHex) return false;
  const candidate = scryptSync(passphrase, salt, 32);
  const digest = Buffer.from(digestHex, "hex");
  if (candidate.length !== digest.length) return false;
  return timingSafeEqual(candidate, digest);
}

export async function findOwnerByWorkspace(
  pool: DbPool,
  workspace_id: string,
): Promise<OwnerRecord | null> {
  const row = await pool.query<OwnerRecord>(
    `SELECT
       o.owner_id,
       o.workspace_id,
       o.principal_id,
       p.principal_type,
       o.display_name,
       o.passphrase_hash
     FROM sec_local_owners o
     JOIN sec_principals p ON p.principal_id = o.principal_id
     WHERE o.workspace_id = $1
       AND o.revoked_at IS NULL
       AND p.revoked_at IS NULL
     LIMIT 1`,
    [workspace_id],
  );
  if (row.rowCount !== 1) return null;
  return row.rows[0];
}

export async function createOwnerRecord(
  tx: DbClient,
  input: {
    owner_id: string;
    workspace_id: string;
    principal_id: string;
    display_name: string;
    passphrase_hash: string | null;
  },
): Promise<boolean> {
  const res = await tx.query(
    `INSERT INTO sec_local_owners (
       owner_id,
       workspace_id,
       principal_id,
       display_name,
       passphrase_hash
     ) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (workspace_id)
     DO NOTHING`,
    [
      input.owner_id,
      input.workspace_id,
      input.principal_id,
      input.display_name,
      input.passphrase_hash,
    ],
  );
  return res.rowCount === 1;
}

async function issueSessionInTx(
  tx: DbClient,
  owner: OwnerRecord,
  config: SessionConfig,
  metadata?: { user_agent?: string; created_ip?: string },
): Promise<SessionIssueResult> {
  const session_id = randomUUID();
  const access_token = issueOpaqueToken("atk");
  const refresh_token = issueOpaqueToken("rtk");
  const access_hash = hashOpaqueToken(config.sessionSecret, access_token);
  const refresh_hash = hashOpaqueToken(config.sessionSecret, refresh_token);

  const inserted = await tx.query<{
    access_expires_at: string;
    refresh_expires_at: string;
  }>(
    `INSERT INTO sec_auth_sessions (
       session_id,
       owner_id,
       workspace_id,
       principal_id,
       access_token_hash,
       refresh_token_hash,
       access_expires_at,
       refresh_expires_at,
       user_agent,
       created_ip
     ) VALUES (
       $1,$2,$3,$4,$5,$6,
       now() + ($7::text || ' seconds')::interval,
       now() + ($8::text || ' seconds')::interval,
       $9,$10
     )
     RETURNING access_expires_at::text, refresh_expires_at::text`,
    [
      session_id,
      owner.owner_id,
      owner.workspace_id,
      owner.principal_id,
      access_hash,
      refresh_hash,
      String(config.accessTtlSec),
      String(config.refreshTtlSec),
      metadata?.user_agent ?? null,
      metadata?.created_ip ?? null,
    ],
  );

  await tx.query(
    `UPDATE sec_local_owners
     SET
      updated_at = now(),
      last_login_at = now()
     WHERE owner_id = $1`,
    [owner.owner_id],
  );

  return {
    session_id,
    access_token,
    refresh_token,
    access_expires_at: inserted.rows[0].access_expires_at,
    refresh_expires_at: inserted.rows[0].refresh_expires_at,
  };
}

export async function issueOwnerSession(
  pool: DbPool,
  owner: OwnerRecord,
  config: SessionConfig,
  metadata?: { user_agent?: string; created_ip?: string },
): Promise<SessionIssueResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const issued = await issueSessionInTx(client, owner, config, metadata);
    await client.query("COMMIT");
    return issued;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function getSessionByHash(
  pool: DbPool,
  input: { access_hash?: string; refresh_hash?: string },
): Promise<SessionRecord | null> {
  if (!input.access_hash && !input.refresh_hash) return null;
  const where =
    input.access_hash != null
      ? "s.access_token_hash = $1 AND s.access_expires_at > now()"
      : "s.refresh_token_hash = $1 AND s.refresh_expires_at > now()";
  const value = input.access_hash ?? input.refresh_hash ?? "";
  const row = await pool.query<RawSessionRow>(
    `SELECT
       s.session_id,
       s.owner_id,
       s.workspace_id,
       s.principal_id,
       p.principal_type,
       s.access_expires_at::text,
       s.refresh_expires_at::text
     FROM sec_auth_sessions s
     JOIN sec_principals p ON p.principal_id = s.principal_id
     WHERE ${where}
       AND s.revoked_at IS NULL
       AND p.revoked_at IS NULL
     LIMIT 1`,
    [value],
  );
  if (row.rowCount !== 1) return null;
  const raw = row.rows[0];
  return {
    session_id: raw.session_id,
    owner_id: raw.owner_id,
    workspace_id: raw.workspace_id,
    principal_id: raw.principal_id,
    principal_type:
      raw.principal_type === "user" || raw.principal_type === "agent" || raw.principal_type === "service"
        ? raw.principal_type
        : "user",
    access_expires_at: raw.access_expires_at,
    refresh_expires_at: raw.refresh_expires_at,
  };
}

export async function findSessionByAccessToken(
  pool: DbPool,
  sessionSecret: string,
  accessToken: string,
): Promise<SessionRecord | null> {
  const access_hash = hashOpaqueToken(sessionSecret, accessToken);
  return getSessionByHash(pool, { access_hash });
}

export async function findSessionByRefreshToken(
  pool: DbPool,
  sessionSecret: string,
  refreshToken: string,
): Promise<SessionRecord | null> {
  const refresh_hash = hashOpaqueToken(sessionSecret, refreshToken);
  return getSessionByHash(pool, { refresh_hash });
}

export async function touchSessionLastSeen(
  pool: DbPool,
  session_id: string,
): Promise<void> {
  await pool.query(
    `UPDATE sec_auth_sessions
     SET last_seen_at = now()
     WHERE session_id = $1`,
    [session_id],
  );
}

export async function rotateSessionByRefreshToken(
  pool: DbPool,
  input: {
    sessionSecret: string;
    refreshToken: string;
    accessTtlSec: number;
    refreshTtlSec: number;
  },
): Promise<SessionIssueResult | null> {
  const refresh_hash = hashOpaqueToken(input.sessionSecret, input.refreshToken);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query<RawSessionRow>(
      `SELECT
         s.session_id,
         s.owner_id,
         s.workspace_id,
         s.principal_id,
         p.principal_type,
         s.access_expires_at::text,
         s.refresh_expires_at::text
       FROM sec_auth_sessions s
       JOIN sec_principals p ON p.principal_id = s.principal_id
       WHERE s.refresh_token_hash = $1
         AND s.refresh_expires_at > now()
         AND s.revoked_at IS NULL
         AND p.revoked_at IS NULL
       LIMIT 1
       FOR UPDATE`,
      [refresh_hash],
    );
    if (existing.rowCount !== 1) {
      await client.query("ROLLBACK");
      return null;
    }

    const access_token = issueOpaqueToken("atk");
    const refresh_token = issueOpaqueToken("rtk");
    const next_access_hash = hashOpaqueToken(input.sessionSecret, access_token);
    const next_refresh_hash = hashOpaqueToken(input.sessionSecret, refresh_token);

    const updated = await client.query<{
      access_expires_at: string;
      refresh_expires_at: string;
    }>(
      `UPDATE sec_auth_sessions
       SET
        access_token_hash = $2,
        refresh_token_hash = $3,
        access_expires_at = now() + ($4::text || ' seconds')::interval,
        refresh_expires_at = now() + ($5::text || ' seconds')::interval,
        last_seen_at = now()
       WHERE session_id = $1
       RETURNING access_expires_at::text, refresh_expires_at::text`,
      [
        existing.rows[0].session_id,
        next_access_hash,
        next_refresh_hash,
        String(input.accessTtlSec),
        String(input.refreshTtlSec),
      ],
    );

    await client.query("COMMIT");
    return {
      session_id: existing.rows[0].session_id,
      access_token,
      refresh_token,
      access_expires_at: updated.rows[0].access_expires_at,
      refresh_expires_at: updated.rows[0].refresh_expires_at,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function revokeSessionByAccessToken(
  pool: DbPool,
  sessionSecret: string,
  accessToken: string,
): Promise<boolean> {
  const access_hash = hashOpaqueToken(sessionSecret, accessToken);
  const res = await pool.query(
    `UPDATE sec_auth_sessions
     SET revoked_at = now()
     WHERE access_token_hash = $1
       AND revoked_at IS NULL`,
    [access_hash],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function revokeSessionByRefreshToken(
  pool: DbPool,
  sessionSecret: string,
  refreshToken: string,
): Promise<boolean> {
  const refresh_hash = hashOpaqueToken(sessionSecret, refreshToken);
  const res = await pool.query(
    `UPDATE sec_auth_sessions
     SET revoked_at = now()
     WHERE refresh_token_hash = $1
       AND revoked_at IS NULL`,
    [refresh_hash],
  );
  return (res.rowCount ?? 0) > 0;
}
