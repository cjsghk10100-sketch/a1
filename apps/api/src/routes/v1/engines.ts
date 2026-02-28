import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import type {
  CapabilityScopesV1,
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

import type { DbPool } from "../../db/pool.js";
import { appendToStream } from "../../eventStore/index.js";
import {
  defaultEngineCapabilityScopes,
  getEngineTokenSecret,
  issueEngineTokenTx,
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
