import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import type { AppConfig } from "../../config.js";
import type { DbPool } from "../../db/pool.js";
import {
  createOwnerRecord,
  findOwnerByWorkspace,
  findSessionByAccessToken,
  issueOwnerSession,
  revokeSessionByAccessToken,
  revokeSessionByRefreshToken,
  rotateSessionByRefreshToken,
  verifyPassphrase,
  hashPassphrase,
} from "../../security/authSessions.js";
import { ensurePrincipalForLegacyActor } from "../../security/principals.js";

type AuthTokens = {
  access_token: string;
  access_expires_at: string;
  refresh_token: string;
  refresh_expires_at: string;
};

function normalizeString(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return v.length ? v : null;
}

function parseBearerToken(raw: string | undefined): string | null {
  if (!raw) return null;
  const header = raw.trim();
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  return token.length ? token : null;
}

function getHeaderString(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return normalizeString(value);
}

function isLoopbackIp(ip: string | undefined): boolean {
  if (!ip) return false;
  const value = ip.trim().toLowerCase();
  return (
    value === "127.0.0.1" ||
    value === "::1" ||
    value === "::ffff:127.0.0.1"
  );
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) return fallback;
  const value = raw.trim().toLowerCase();
  if (value === "1" || value === "true" || value === "yes" || value === "on") return true;
  if (value === "0" || value === "false" || value === "no" || value === "off") return false;
  return fallback;
}

function resolveAuthSessionSecret(config: AppConfig): string {
  return (
    config.authSessionSecret ??
    process.env.AUTH_SESSION_SECRET?.trim() ??
    "agentapp_local_dev_session_secret"
  );
}

function resolveAuthBootstrapToken(config: AppConfig): string | undefined {
  const resolved = config.authBootstrapToken ?? process.env.AUTH_BOOTSTRAP_TOKEN;
  if (typeof resolved !== "string") return undefined;
  const token = resolved.trim();
  return token.length > 0 ? token : undefined;
}

function resolveAuthBootstrapAllowLoopback(config: AppConfig): boolean {
  if (typeof config.authBootstrapAllowLoopback === "boolean") {
    return config.authBootstrapAllowLoopback;
  }
  return parseBoolean(process.env.AUTH_BOOTSTRAP_ALLOW_LOOPBACK, false);
}

function authSessionConfig(config: AppConfig): {
  sessionSecret: string;
  accessTtlSec: number;
  refreshTtlSec: number;
} {
  return {
    sessionSecret: resolveAuthSessionSecret(config),
    accessTtlSec: config.authSessionAccessTtlSec ?? 3600,
    refreshTtlSec: config.authSessionRefreshTtlSec ?? 60 * 60 * 24 * 30,
  };
}

function mapTokens(tokens: AuthTokens): AuthTokens {
  return {
    access_token: tokens.access_token,
    access_expires_at: tokens.access_expires_at,
    refresh_token: tokens.refresh_token,
    refresh_expires_at: tokens.refresh_expires_at,
  };
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  pool: DbPool,
  config: AppConfig,
): Promise<void> {
  const sessionConfig = authSessionConfig(config);
  const bootstrapToken = resolveAuthBootstrapToken(config);
  const bootstrapAllowLoopback = resolveAuthBootstrapAllowLoopback(config);

  app.post<{
    Body: { workspace_id?: string; display_name?: string; passphrase?: string };
  }>("/v1/auth/bootstrap-owner", async (req, reply) => {
    const workspace_id = normalizeString(req.body.workspace_id) ?? "ws_dev";
    const display_name = normalizeString(req.body.display_name) ?? "Local Owner";
    const passphrase = normalizeString(req.body.passphrase);

    const existing = await findOwnerByWorkspace(pool, workspace_id);
    if (existing) return reply.code(409).send({ error: "owner_already_exists" });

    const bootstrapTokenHeader =
      getHeaderString(req.headers["x-bootstrap-token"] as string | string[] | undefined) ??
      getHeaderString(req.headers["x-auth-bootstrap-token"] as string | string[] | undefined);
    const hasConfiguredBootstrapToken = typeof bootstrapToken === "string";
    const bootstrapTokenAccepted =
      hasConfiguredBootstrapToken &&
      bootstrapTokenHeader != null &&
      bootstrapTokenHeader === bootstrapToken;

    const bearerToken = parseBearerToken(req.headers.authorization);
    let trustedBySession = false;
    if (bearerToken) {
      const session = await findSessionByAccessToken(
        pool,
        sessionConfig.sessionSecret,
        bearerToken,
      );
      trustedBySession = Boolean(session && session.workspace_id === workspace_id);
    }

    const trustedByLoopback = bootstrapAllowLoopback && isLoopbackIp(req.ip);

    if (!bootstrapTokenAccepted && !trustedBySession && !trustedByLoopback) {
      return reply.code(403).send({ error: "bootstrap_forbidden" });
    }
    if (!passphrase) {
      return reply.code(400).send({ error: "missing_passphrase" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const owner_actor_id = `owner:${workspace_id}`;
      const principal_id = await ensurePrincipalForLegacyActor(client, "user", owner_actor_id);
      const owner_id = `own_${randomUUID().replaceAll("-", "")}`;

      const created = await createOwnerRecord(client, {
        owner_id,
        workspace_id,
        principal_id,
        display_name,
        passphrase_hash: hashPassphrase(passphrase),
      });
      if (!created) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "owner_already_exists" });
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    const owner = await findOwnerByWorkspace(pool, workspace_id);
    if (!owner) return reply.code(500).send({ error: "owner_not_found_after_create" });

    const issued = await issueOwnerSession(pool, owner, sessionConfig, {
      user_agent: req.headers["user-agent"],
      created_ip: req.ip,
    });

    return reply.code(201).send({
      owner: {
        owner_id: owner.owner_id,
        workspace_id: owner.workspace_id,
        principal_id: owner.principal_id,
        principal_type: owner.principal_type,
        display_name: owner.display_name,
      },
      session: mapTokens(issued),
    });
  });

  app.post<{
    Body: { workspace_id?: string; passphrase?: string };
  }>("/v1/auth/login", async (req, reply) => {
    const workspace_id = normalizeString(req.body.workspace_id) ?? "ws_dev";
    const passphrase = normalizeString(req.body.passphrase);
    const owner = await findOwnerByWorkspace(pool, workspace_id);
    if (!owner) return reply.code(404).send({ error: "owner_not_found" });

    if (!owner.passphrase_hash || !passphrase) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    if (!verifyPassphrase(passphrase, owner.passphrase_hash)) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }

    const issued = await issueOwnerSession(pool, owner, sessionConfig, {
      user_agent: req.headers["user-agent"],
      created_ip: req.ip,
    });
    return reply.code(200).send({
      owner: {
        owner_id: owner.owner_id,
        workspace_id: owner.workspace_id,
        principal_id: owner.principal_id,
        principal_type: owner.principal_type,
        display_name: owner.display_name,
      },
      session: mapTokens(issued),
    });
  });

  app.post<{
    Body: { refresh_token?: string };
  }>("/v1/auth/refresh", async (req, reply) => {
    const refresh_token = normalizeString(req.body.refresh_token);
    if (!refresh_token) return reply.code(400).send({ error: "missing_refresh_token" });

    const rotated = await rotateSessionByRefreshToken(pool, {
      sessionSecret: sessionConfig.sessionSecret,
      refreshToken: refresh_token,
      accessTtlSec: sessionConfig.accessTtlSec,
      refreshTtlSec: sessionConfig.refreshTtlSec,
    });
    if (!rotated) return reply.code(401).send({ error: "invalid_refresh_token" });

    return reply.code(200).send({
      session: mapTokens(rotated),
    });
  });

  app.post<{
    Body: { refresh_token?: string };
  }>("/v1/auth/logout", async (req, reply) => {
    const headerToken = parseBearerToken(req.headers.authorization);
    const refresh_token = normalizeString(req.body.refresh_token);

    let revoked = false;
    if (headerToken) {
      revoked =
        (await revokeSessionByAccessToken(
          pool,
          sessionConfig.sessionSecret,
          headerToken,
        )) || revoked;
    }
    if (refresh_token) {
      revoked =
        (await revokeSessionByRefreshToken(
          pool,
          sessionConfig.sessionSecret,
          refresh_token,
        )) || revoked;
    }

    return reply.code(200).send({ ok: true, revoked });
  });

  app.get("/v1/auth/session", async (req, reply) => {
    const token = parseBearerToken(req.headers.authorization);
    if (!token) return reply.code(401).send({ error: "missing_bearer_token" });

    const session = await findSessionByAccessToken(
      pool,
      sessionConfig.sessionSecret,
      token,
    );
    if (!session) return reply.code(401).send({ error: "invalid_session" });

    const owner = await findOwnerByWorkspace(pool, session.workspace_id);
    if (!owner || owner.owner_id !== session.owner_id) {
      return reply.code(401).send({ error: "invalid_session" });
    }

    return reply.code(200).send({
      owner: {
        owner_id: owner.owner_id,
        workspace_id: owner.workspace_id,
        principal_id: owner.principal_id,
        principal_type: owner.principal_type,
        display_name: owner.display_name,
      },
      session: {
        session_id: session.session_id,
        access_expires_at: session.access_expires_at,
        refresh_expires_at: session.refresh_expires_at,
      },
    });
  });
}
