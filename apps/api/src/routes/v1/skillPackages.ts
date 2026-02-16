import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import {
  type ActorType,
  SkillVerificationStatus,
  type SkillVerificationStatus as SkillVerificationStatusValue,
} from "@agentapp/shared";

import type { DbPool } from "../../db/pool.js";
import { appendToStream } from "../../eventStore/index.js";

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
  const v = raw.trim();
  return v.length ? v : undefined;
}

function normalizeRequiredString(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return v.length ? v : null;
}

function normalizeHash(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const input = raw.trim().toLowerCase();
  if (!input) return null;
  const hex = input.startsWith("sha256:") ? input.slice("sha256:".length) : input;
  if (!/^[a-f0-9]{64}$/.test(hex)) return null;
  return `sha256:${hex}`;
}

function normalizeStringArray(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") return null;
    const v = item.trim();
    if (!v) continue;
    out.add(v);
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

function normalizeManifest(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const required_tools = normalizeStringArray(obj.required_tools);
  const egress_domains = normalizeStringArray(obj.egress_domains);
  const sandbox_required = obj.sandbox_required;

  if (required_tools === null) return null;
  if (egress_domains === null) return null;
  if (typeof sandbox_required !== "boolean") return null;
  if (!Object.prototype.hasOwnProperty.call(obj, "data_access")) return null;

  return {
    ...obj,
    required_tools,
    egress_domains,
    sandbox_required,
  };
}

function normalizeStatus(raw: unknown): SkillVerificationStatusValue | null {
  return raw === SkillVerificationStatus.Pending ||
    raw === SkillVerificationStatus.Verified ||
    raw === SkillVerificationStatus.Quarantined
    ? raw
    : null;
}

function newSkillPackageId(): string {
  return `spkg_${randomUUID().replaceAll("-", "")}`;
}

export async function registerSkillPackageRoutes(app: FastifyInstance, pool: DbPool): Promise<void> {
  app.post<{
    Body: {
      skill_id: string;
      version: string;
      hash_sha256: string;
      signature?: string;
      manifest: Record<string, unknown>;
      actor_type?: ActorType;
      actor_id?: string;
      principal_id?: string;
      correlation_id?: string;
    };
  }>("/v1/skills/packages/install", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const skill_id = normalizeRequiredString(req.body.skill_id);
    const version = normalizeRequiredString(req.body.version);
    const hash_sha256 = normalizeHash(req.body.hash_sha256);
    const signature = normalizeOptionalString(req.body.signature);
    const manifest = normalizeManifest(req.body.manifest);
    if (!skill_id) return reply.code(400).send({ error: "invalid_skill_id" });
    if (!version) return reply.code(400).send({ error: "invalid_version" });
    if (!hash_sha256) return reply.code(400).send({ error: "invalid_hash_sha256" });
    if (!manifest) return reply.code(400).send({ error: "invalid_manifest" });

    const actor_type = normalizeActorType(req.body.actor_type);
    const actor_id =
      normalizeOptionalString(req.body.actor_id) || (actor_type === "service" ? "api" : "anon");
    const principal_id = normalizeOptionalString(req.body.principal_id);
    const correlation_id = normalizeOptionalString(req.body.correlation_id) ?? randomUUID();

    const skill_package_id = newSkillPackageId();
    const created_at = new Date().toISOString();

    try {
      await pool.query(
        `INSERT INTO sec_skill_packages (
          skill_package_id,
          workspace_id,
          skill_id,
          version,
          hash_sha256,
          signature,
          manifest,
          verification_status,
          installed_by_type,
          installed_by_id,
          installed_by_principal_id,
          created_at,
          updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$12
        )`,
        [
          skill_package_id,
          workspace_id,
          skill_id,
          version,
          hash_sha256,
          signature,
          JSON.stringify(manifest),
          SkillVerificationStatus.Pending,
          actor_type,
          actor_id,
          principal_id,
          created_at,
        ],
      );
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && err.code === "23505") {
        return reply.code(409).send({ error: "skill_version_already_exists" });
      }
      throw err;
    }

    await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "skill.package.installed",
      event_version: 1,
      occurred_at: created_at,
      workspace_id,
      actor: { actor_type, actor_id },
      actor_principal_id: principal_id,
      stream: { stream_type: "workspace", stream_id: workspace_id },
      correlation_id,
      data: {
        skill_package_id,
        skill_id,
        version,
        hash_sha256,
        has_signature: !!signature,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });

    return reply.code(201).send({
      skill_package_id,
      verification_status: SkillVerificationStatus.Pending,
    });
  });

  app.post<{
    Params: { packageId: string };
    Body: {
      expected_hash_sha256?: string;
      signature?: string;
      actor_type?: ActorType;
      actor_id?: string;
      principal_id?: string;
      correlation_id?: string;
    };
  }>("/v1/skills/packages/:packageId/verify", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const skill_package_id = normalizeRequiredString(req.params.packageId);
    if (!skill_package_id) return reply.code(400).send({ error: "invalid_package_id" });

    const rowRes = await pool.query<{
      skill_id: string;
      version: string;
      hash_sha256: string;
      signature: string | null;
      manifest: Record<string, unknown>;
      verification_status: SkillVerificationStatusValue;
    }>(
      `SELECT skill_id, version, hash_sha256, signature, manifest, verification_status
       FROM sec_skill_packages
       WHERE workspace_id = $1
         AND skill_package_id = $2`,
      [workspace_id, skill_package_id],
    );
    if (rowRes.rowCount !== 1) {
      return reply.code(404).send({ error: "skill_package_not_found" });
    }

    const row = rowRes.rows[0];
    if (row.verification_status === SkillVerificationStatus.Quarantined) {
      return reply.code(409).send({ error: "skill_package_quarantined" });
    }

    const expected_hash_sha256 = normalizeOptionalString(req.body.expected_hash_sha256);
    if (expected_hash_sha256) {
      const expected = normalizeHash(expected_hash_sha256);
      if (!expected) return reply.code(400).send({ error: "invalid_expected_hash_sha256" });
      if (expected !== row.hash_sha256) return reply.code(400).send({ error: "hash_mismatch" });
    }

    if (!normalizeHash(row.hash_sha256)) {
      return reply.code(400).send({ error: "stored_hash_invalid" });
    }
    if (!normalizeManifest(row.manifest)) {
      return reply.code(400).send({ error: "stored_manifest_invalid" });
    }

    const signature = normalizeOptionalString(req.body.signature);
    if (signature && row.signature && signature !== row.signature) {
      return reply.code(400).send({ error: "signature_mismatch" });
    }

    if (row.verification_status === SkillVerificationStatus.Verified) {
      return reply.code(200).send({ ok: true, already_verified: true });
    }

    const actor_type = normalizeActorType(req.body.actor_type);
    const actor_id =
      normalizeOptionalString(req.body.actor_id) || (actor_type === "service" ? "api" : "anon");
    const principal_id = normalizeOptionalString(req.body.principal_id);
    const correlation_id = normalizeOptionalString(req.body.correlation_id) ?? randomUUID();
    const verified_at = new Date().toISOString();

    await pool.query(
      `UPDATE sec_skill_packages
       SET verification_status = $3,
           verified_at = $4,
           quarantine_reason = NULL,
           updated_at = $4
       WHERE workspace_id = $1
         AND skill_package_id = $2`,
      [workspace_id, skill_package_id, SkillVerificationStatus.Verified, verified_at],
    );

    await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "skill.package.verified",
      event_version: 1,
      occurred_at: verified_at,
      workspace_id,
      actor: { actor_type, actor_id },
      actor_principal_id: principal_id,
      stream: { stream_type: "workspace", stream_id: workspace_id },
      correlation_id,
      data: {
        skill_package_id,
        skill_id: row.skill_id,
        version: row.version,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });

    return reply.code(200).send({
      ok: true,
      verification_status: SkillVerificationStatus.Verified,
    });
  });

  app.post<{
    Params: { packageId: string };
    Body: {
      reason?: string;
      actor_type?: ActorType;
      actor_id?: string;
      principal_id?: string;
      correlation_id?: string;
    };
  }>("/v1/skills/packages/:packageId/quarantine", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const skill_package_id = normalizeRequiredString(req.params.packageId);
    if (!skill_package_id) return reply.code(400).send({ error: "invalid_package_id" });

    const reason = normalizeOptionalString(req.body.reason) ?? "manual_quarantine";
    const rowRes = await pool.query<{
      skill_id: string;
      version: string;
      verification_status: SkillVerificationStatusValue;
    }>(
      `SELECT skill_id, version, verification_status
       FROM sec_skill_packages
       WHERE workspace_id = $1
         AND skill_package_id = $2`,
      [workspace_id, skill_package_id],
    );
    if (rowRes.rowCount !== 1) return reply.code(404).send({ error: "skill_package_not_found" });

    const row = rowRes.rows[0];
    if (row.verification_status === SkillVerificationStatus.Quarantined) {
      return reply.code(200).send({ ok: true, already_quarantined: true });
    }

    const actor_type = normalizeActorType(req.body.actor_type);
    const actor_id =
      normalizeOptionalString(req.body.actor_id) || (actor_type === "service" ? "api" : "anon");
    const principal_id = normalizeOptionalString(req.body.principal_id);
    const correlation_id = normalizeOptionalString(req.body.correlation_id) ?? randomUUID();
    const occurred_at = new Date().toISOString();

    await pool.query(
      `UPDATE sec_skill_packages
       SET verification_status = $3,
           quarantine_reason = $4,
           updated_at = $5
       WHERE workspace_id = $1
         AND skill_package_id = $2`,
      [workspace_id, skill_package_id, SkillVerificationStatus.Quarantined, reason, occurred_at],
    );

    await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "skill.package.quarantined",
      event_version: 1,
      occurred_at,
      workspace_id,
      actor: { actor_type, actor_id },
      actor_principal_id: principal_id,
      stream: { stream_type: "workspace", stream_id: workspace_id },
      correlation_id,
      data: {
        skill_package_id,
        skill_id: row.skill_id,
        version: row.version,
        quarantine_reason: reason,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });

    return reply.code(200).send({
      ok: true,
      verification_status: SkillVerificationStatus.Quarantined,
    });
  });

  app.get<{
    Querystring: { status?: string; skill_id?: string; limit?: string };
  }>("/v1/skills/packages", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const status = normalizeStatus(req.query.status);
    if (req.query.status && !status) return reply.code(400).send({ error: "invalid_status" });

    const skill_id = normalizeOptionalString(req.query.skill_id);
    const rawLimit = Number(req.query.limit ?? "50");
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, rawLimit)) : 50;

    const args: unknown[] = [workspace_id];
    let where = "workspace_id = $1";
    if (status) {
      args.push(status);
      where += ` AND verification_status = $${args.length}`;
    }
    if (skill_id) {
      args.push(skill_id);
      where += ` AND skill_id = $${args.length}`;
    }
    args.push(limit);

    const res = await pool.query(
      `SELECT
        skill_package_id,
        workspace_id,
        skill_id,
        version,
        hash_sha256,
        signature,
        manifest,
        verification_status,
        verified_at,
        quarantine_reason,
        installed_by_type,
        installed_by_id,
        installed_by_principal_id,
        created_at,
        updated_at
      FROM sec_skill_packages
      WHERE ${where}
      ORDER BY updated_at DESC
      LIMIT $${args.length}`,
      args,
    );

    return reply.code(200).send({ packages: res.rows });
  });
}

