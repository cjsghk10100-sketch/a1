import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import type {
  ActorType,
  SecretAccessRequestV1,
  SecretUpsertRequestV1,
} from "@agentapp/shared";

import type { DbPool } from "../../db/pool.js";
import { appendToStream } from "../../eventStore/index.js";
import { decryptSecretValue, encryptSecretValue, getSecretsMasterKey } from "../../security/cryptoVault.js";

function getHeaderString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function workspaceIdFromReq(req: { headers: Record<string, unknown> }): string {
  const raw = getHeaderString(req.headers["x-workspace-id"] as string | string[] | undefined);
  return raw?.trim() || "ws_dev";
}

function normalizeActorType(raw: unknown): ActorType {
  return raw === "service" ? "service" : "user";
}

function normalizeOptionalString(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  return value.length > 0 ? value : undefined;
}

function normalizeRequiredString(raw: unknown): string | null {
  const value = normalizeOptionalString(raw);
  return value ?? null;
}

function parseLimit(raw: unknown): number {
  const n = Number(raw ?? "100");
  if (!Number.isFinite(n)) return 100;
  return Math.max(1, Math.min(200, Math.floor(n)));
}

function newSecretId(): string {
  return `sec_${randomUUID().replaceAll("-", "")}`;
}

export async function registerSecretRoutes(app: FastifyInstance, pool: DbPool): Promise<void> {
  app.post<{
    Body: SecretUpsertRequestV1 & {
      actor_type?: ActorType;
      actor_id?: string;
      actor_principal_id?: string;
      correlation_id?: string;
    };
  }>("/v1/secrets", async (req, reply) => {
    const masterKey = getSecretsMasterKey();
    if (!masterKey) return reply.code(501).send({ error: "secrets_vault_not_configured" });

    const workspace_id = workspaceIdFromReq(req);
    const secret_name = normalizeRequiredString(req.body.secret_name);
    const secret_value = normalizeRequiredString(req.body.secret_value);
    const description = normalizeOptionalString(req.body.description);
    if (!secret_name) return reply.code(400).send({ error: "invalid_secret_name" });
    if (!secret_value) return reply.code(400).send({ error: "invalid_secret_value" });

    const actor_type = normalizeActorType(req.body.actor_type);
    const actor_id =
      normalizeOptionalString(req.body.actor_id) || (actor_type === "service" ? "api" : "anon");
    const actor_principal_id = normalizeOptionalString(req.body.actor_principal_id);
    const correlation_id = normalizeOptionalString(req.body.correlation_id) ?? randomUUID();

    const encrypted = encryptSecretValue(masterKey, secret_value);
    const now = new Date().toISOString();

    const existing = await pool.query<{ secret_id: string }>(
      `SELECT secret_id
       FROM sec_secrets
       WHERE workspace_id = $1
         AND secret_name = $2`,
      [workspace_id, secret_name],
    );

    let created = false;
    let secret_id: string;
    if (existing.rowCount === 1) {
      secret_id = existing.rows[0].secret_id;
      await pool.query(
        `UPDATE sec_secrets
         SET description = $3,
             algorithm = $4,
             nonce_b64 = $5,
             ciphertext_b64 = $6,
             auth_tag_b64 = $7,
             created_by_type = $8,
             created_by_id = $9,
             created_by_principal_id = $10,
             updated_at = $11
         WHERE workspace_id = $1
           AND secret_id = $2`,
        [
          workspace_id,
          secret_id,
          description ?? null,
          encrypted.algorithm,
          encrypted.nonce_b64,
          encrypted.ciphertext_b64,
          encrypted.auth_tag_b64,
          actor_type,
          actor_id,
          actor_principal_id ?? null,
          now,
        ],
      );
    } else {
      created = true;
      secret_id = newSecretId();
      await pool.query(
        `INSERT INTO sec_secrets (
           secret_id,
           workspace_id,
           secret_name,
           description,
           algorithm,
           nonce_b64,
           ciphertext_b64,
           auth_tag_b64,
           created_by_type,
           created_by_id,
           created_by_principal_id,
           created_at,
           updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12
         )`,
        [
          secret_id,
          workspace_id,
          secret_name,
          description ?? null,
          encrypted.algorithm,
          encrypted.nonce_b64,
          encrypted.ciphertext_b64,
          encrypted.auth_tag_b64,
          actor_type,
          actor_id,
          actor_principal_id ?? null,
          now,
        ],
      );
    }

    await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "secret.upserted",
      event_version: 1,
      occurred_at: now,
      workspace_id,
      actor: { actor_type, actor_id },
      actor_principal_id,
      stream: { stream_type: "workspace", stream_id: workspace_id },
      correlation_id,
      data: {
        secret_id,
        secret_name,
        created,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });

    return reply.code(created ? 201 : 200).send({
      secret_id,
      workspace_id,
      secret_name,
      description,
      algorithm: encrypted.algorithm,
      created_at: now,
      updated_at: now,
      created_by_type: actor_type,
      created_by_id: actor_id,
      created_by_principal_id: actor_principal_id,
      created,
    });
  });

  app.get<{
    Querystring: { limit?: string };
  }>("/v1/secrets", async (req, reply) => {
    const masterKey = getSecretsMasterKey();
    if (!masterKey) return reply.code(501).send({ error: "secrets_vault_not_configured" });

    const workspace_id = workspaceIdFromReq(req);
    const limit = parseLimit(req.query.limit);

    const rows = await pool.query(
      `SELECT
         secret_id,
         workspace_id,
         secret_name,
         description,
         algorithm,
         created_at,
         updated_at,
         last_accessed_at,
         created_by_type,
         created_by_id,
         created_by_principal_id
       FROM sec_secrets
       WHERE workspace_id = $1
       ORDER BY updated_at DESC
       LIMIT $2`,
      [workspace_id, limit],
    );

    return reply.code(200).send({ secrets: rows.rows });
  });

  app.post<{
    Params: { secretId: string };
    Body: SecretAccessRequestV1;
  }>("/v1/secrets/:secretId/access", async (req, reply) => {
    const masterKey = getSecretsMasterKey();
    if (!masterKey) return reply.code(501).send({ error: "secrets_vault_not_configured" });

    const workspace_id = workspaceIdFromReq(req);
    const secret_id = normalizeRequiredString(req.params.secretId);
    if (!secret_id) return reply.code(400).send({ error: "invalid_secret_id" });

    const actor_principal_id = normalizeRequiredString(req.body.actor_principal_id);
    if (!actor_principal_id) return reply.code(400).send({ error: "actor_principal_id_required" });

    const principal = await pool.query<{ principal_type: string; revoked_at: string | null }>(
      `SELECT principal_type, revoked_at
       FROM sec_principals
       WHERE principal_id = $1`,
      [actor_principal_id],
    );
    if (
      principal.rowCount !== 1 ||
      principal.rows[0].principal_type !== "service" ||
      principal.rows[0].revoked_at
    ) {
      return reply.code(403).send({ error: "service_principal_required" });
    }

    const actor_type = normalizeActorType(req.body.actor_type);
    if (actor_type !== "service") {
      return reply.code(403).send({ error: "service_actor_required" });
    }
    const actor_id = normalizeOptionalString(req.body.actor_id) ?? "runtime";
    const correlation_id = normalizeOptionalString(req.body.correlation_id) ?? randomUUID();

    const row = await pool.query<{
      secret_id: string;
      secret_name: string;
      algorithm: "aes-256-gcm";
      nonce_b64: string;
      ciphertext_b64: string;
      auth_tag_b64: string;
    }>(
      `SELECT
         secret_id,
         secret_name,
         algorithm,
         nonce_b64,
         ciphertext_b64,
         auth_tag_b64
       FROM sec_secrets
       WHERE workspace_id = $1
         AND secret_id = $2`,
      [workspace_id, secret_id],
    );
    if (row.rowCount !== 1) return reply.code(404).send({ error: "secret_not_found" });

    const secret = row.rows[0];
    const secret_value = decryptSecretValue(masterKey, {
      algorithm: secret.algorithm,
      nonce_b64: secret.nonce_b64,
      ciphertext_b64: secret.ciphertext_b64,
      auth_tag_b64: secret.auth_tag_b64,
    });
    const occurred_at = new Date().toISOString();

    await pool.query(
      `UPDATE sec_secrets
       SET last_accessed_at = $3,
           updated_at = $3
       WHERE workspace_id = $1
         AND secret_id = $2`,
      [workspace_id, secret_id, occurred_at],
    );

    await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "secret.accessed",
      event_version: 1,
      occurred_at,
      workspace_id,
      actor: { actor_type: "service", actor_id },
      actor_principal_id,
      stream: { stream_type: "workspace", stream_id: workspace_id },
      correlation_id,
      data: {
        secret_id,
        secret_name: secret.secret_name,
        accessed_by_principal_id: actor_principal_id,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });

    return reply.code(200).send({
      secret_id,
      secret_name: secret.secret_name,
      secret_value,
    });
  });
}
