import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import {
  type ActorType,
  SkillVerificationStatus,
  type SkillVerificationStatus as SkillVerificationStatusValue,
  type AgentSkillImportResponseV1,
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

function newAgentId(): string {
  return `agt_${randomUUID().replaceAll("-", "")}`;
}

function newSkillPackageId(): string {
  return `spkg_${randomUUID().replaceAll("-", "")}`;
}

function rankStatus(status: SkillVerificationStatusValue): number {
  if (status === SkillVerificationStatus.Pending) return 1;
  if (status === SkillVerificationStatus.Verified) return 2;
  return 3;
}

function mergeStatus(
  a: SkillVerificationStatusValue,
  b: SkillVerificationStatusValue,
): SkillVerificationStatusValue {
  return rankStatus(a) >= rankStatus(b) ? a : b;
}

function decideImportedStatus(input: {
  hash_sha256: string | null;
  manifest: Record<string, unknown> | null;
  signature?: string;
}): {
  status: SkillVerificationStatusValue;
  quarantine_reason?: string;
} {
  if (!input.hash_sha256) {
    return {
      status: SkillVerificationStatus.Quarantined,
      quarantine_reason: "invalid_hash_sha256",
    };
  }
  if (!input.manifest) {
    return {
      status: SkillVerificationStatus.Quarantined,
      quarantine_reason: "invalid_manifest",
    };
  }
  if (input.signature) {
    return { status: SkillVerificationStatus.Verified };
  }
  return { status: SkillVerificationStatus.Pending };
}

export async function registerAgentRoutes(app: FastifyInstance, pool: DbPool): Promise<void> {
  app.post<{
    Body: { display_name: string; actor_type?: ActorType; actor_id?: string };
  }>("/v1/agents", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const display_name = normalizeRequiredString(req.body.display_name);
    if (!display_name) return reply.code(400).send({ error: "invalid_display_name" });

    const actor_type = normalizeActorType(req.body.actor_type);
    const actor_id =
      normalizeOptionalString(req.body.actor_id) || (actor_type === "service" ? "api" : "anon");

    const principal_id = randomUUID();
    const agent_id = newAgentId();
    const created_at = new Date().toISOString();

    await pool.query(
      "INSERT INTO sec_principals (principal_id, principal_type) VALUES ($1, 'agent')",
      [principal_id],
    );
    await pool.query(
      `INSERT INTO sec_agents (agent_id, principal_id, display_name, created_at)
       VALUES ($1, $2, $3, $4)`,
      [agent_id, principal_id, display_name, created_at],
    );

    await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "agent.registered",
      event_version: 1,
      occurred_at: created_at,
      workspace_id,
      actor: { actor_type, actor_id },
      stream: { stream_type: "workspace", stream_id: workspace_id },
      correlation_id: randomUUID(),
      data: {
        agent_id,
        principal_id,
        display_name,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });

    return reply.code(201).send({ agent_id, principal_id });
  });

  app.get<{
    Params: { agentId: string };
  }>("/v1/agents/:agentId", async (req, reply) => {
    const agent_id = normalizeRequiredString(req.params.agentId);
    if (!agent_id) return reply.code(400).send({ error: "invalid_agent_id" });

    const res = await pool.query<{
      agent_id: string;
      principal_id: string;
      display_name: string;
      created_at: string;
      revoked_at: string | null;
      quarantined_at: string | null;
      quarantine_reason: string | null;
    }>(
      `SELECT
         agent_id,
         principal_id,
         display_name,
         created_at::text AS created_at,
         revoked_at::text AS revoked_at,
         quarantined_at::text AS quarantined_at,
         quarantine_reason
       FROM sec_agents
       WHERE agent_id = $1`,
      [agent_id],
    );

    if (res.rowCount !== 1) return reply.code(404).send({ error: "agent_not_found" });

    const row = res.rows[0];
    return reply.code(200).send({
      agent: {
        agent_id: row.agent_id,
        principal_id: row.principal_id,
        display_name: row.display_name,
        created_at: row.created_at,
        revoked_at: row.revoked_at ?? undefined,
        quarantined_at: row.quarantined_at ?? undefined,
        quarantine_reason: row.quarantine_reason ?? undefined,
      },
    });
  });

  app.post<{
    Params: { agentId: string };
    Body: { quarantine_reason?: string; actor_type?: ActorType; actor_id?: string };
  }>("/v1/agents/:agentId/quarantine", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const agent_id = normalizeRequiredString(req.params.agentId);
    if (!agent_id) return reply.code(400).send({ error: "invalid_agent_id" });

    const actor_type = normalizeActorType(req.body.actor_type);
    const actor_id =
      normalizeOptionalString(req.body.actor_id) || (actor_type === "service" ? "api" : "anon");
    const quarantine_reason = normalizeOptionalString(req.body.quarantine_reason) ?? "manual_quarantine";

    const existing = await pool.query<{
      principal_id: string;
      quarantined_at: string | null;
      quarantine_reason: string | null;
    }>(
      `SELECT principal_id, quarantined_at::text AS quarantined_at, quarantine_reason
       FROM sec_agents
       WHERE agent_id = $1`,
      [agent_id],
    );
    if (existing.rowCount !== 1) return reply.code(404).send({ error: "agent_not_found" });

    const principal_id = existing.rows[0].principal_id;
    const already = existing.rows[0].quarantined_at;
    const now = new Date().toISOString();

    let quarantined_at = already;
    if (!already) {
      const updated = await pool.query<{ quarantined_at: string | null }>(
        `UPDATE sec_agents
         SET quarantined_at = $1,
             quarantine_reason = $2
         WHERE agent_id = $3
         RETURNING quarantined_at::text AS quarantined_at`,
        [now, quarantine_reason, agent_id],
      );
      quarantined_at = updated.rows[0]?.quarantined_at ?? now;

      await appendToStream(pool, {
        event_id: randomUUID(),
        event_type: "agent.quarantined",
        event_version: 1,
        occurred_at: now,
        workspace_id,
        actor: { actor_type, actor_id },
        stream: { stream_type: "workspace", stream_id: workspace_id },
        correlation_id: randomUUID(),
        data: {
          agent_id,
          principal_id,
          quarantined_at,
          quarantine_reason,
        },
        policy_context: {},
        model_context: {},
        display: {},
      });
    }

    return reply.code(200).send({
      agent_id,
      principal_id,
      quarantined_at,
      quarantine_reason: existing.rows[0].quarantine_reason ?? quarantine_reason,
    });
  });

  app.post<{
    Params: { agentId: string };
    Body: { actor_type?: ActorType; actor_id?: string };
  }>("/v1/agents/:agentId/unquarantine", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const agent_id = normalizeRequiredString(req.params.agentId);
    if (!agent_id) return reply.code(400).send({ error: "invalid_agent_id" });

    const actor_type = normalizeActorType(req.body.actor_type);
    const actor_id =
      normalizeOptionalString(req.body.actor_id) || (actor_type === "service" ? "api" : "anon");

    const existing = await pool.query<{
      principal_id: string;
      quarantined_at: string | null;
      quarantine_reason: string | null;
    }>(
      `SELECT principal_id, quarantined_at::text AS quarantined_at, quarantine_reason
       FROM sec_agents
       WHERE agent_id = $1`,
      [agent_id],
    );
    if (existing.rowCount !== 1) return reply.code(404).send({ error: "agent_not_found" });

    const principal_id = existing.rows[0].principal_id;
    const already = existing.rows[0].quarantined_at;
    const previous_reason = existing.rows[0].quarantine_reason;

    if (already) {
      await pool.query(
        `UPDATE sec_agents
         SET quarantined_at = NULL,
             quarantine_reason = NULL
         WHERE agent_id = $1`,
        [agent_id],
      );

      const now = new Date().toISOString();
      await appendToStream(pool, {
        event_id: randomUUID(),
        event_type: "agent.unquarantined",
        event_version: 1,
        occurred_at: now,
        workspace_id,
        actor: { actor_type, actor_id },
        stream: { stream_type: "workspace", stream_id: workspace_id },
        correlation_id: randomUUID(),
        data: {
          agent_id,
          principal_id,
          previous_quarantined_at: already,
          previous_quarantine_reason: previous_reason,
        },
        policy_context: {},
        model_context: {},
        display: {},
      });
    }

    return reply.code(200).send({
      agent_id,
      principal_id,
      quarantined_at: null,
    });
  });

  app.post<{
    Params: { agentId: string };
    Body: {
      packages: Array<{
        skill_id: string;
        version: string;
        hash_sha256: string;
        manifest?: Record<string, unknown>;
        signature?: string;
      }>;
      actor_type?: ActorType;
      actor_id?: string;
      correlation_id?: string;
    };
  }>("/v1/agents/:agentId/skills/import", async (req, reply): Promise<AgentSkillImportResponseV1> => {
    const workspace_id = workspaceIdFromReq(req);
    const agent_id = normalizeRequiredString(req.params.agentId);
    if (!agent_id) return reply.code(400).send({ error: "invalid_agent_id" });

    const packages = Array.isArray(req.body.packages) ? req.body.packages : [];
    if (!packages.length) return reply.code(400).send({ error: "packages_required" });

    const agent = await pool.query<{ principal_id: string }>(
      "SELECT principal_id FROM sec_agents WHERE agent_id = $1",
      [agent_id],
    );
    if (agent.rowCount !== 1) return reply.code(404).send({ error: "agent_not_found" });

    const actor_type = normalizeActorType(req.body.actor_type);
    const actor_id =
      normalizeOptionalString(req.body.actor_id) || (actor_type === "service" ? "api" : "anon");
    const correlation_id = normalizeOptionalString(req.body.correlation_id) ?? randomUUID();

    const now = new Date().toISOString();

    const items: AgentSkillImportResponseV1["items"] = [];
    let verified = 0;
    let pending = 0;
    let quarantined = 0;

    for (const pkg of packages) {
      const skill_id = normalizeRequiredString(pkg.skill_id);
      const version = normalizeRequiredString(pkg.version);
      if (!skill_id || !version) {
        return reply.code(400).send({ error: "invalid_skill_identifier" });
      }

      const normalizedHash = normalizeHash(pkg.hash_sha256);
      const hashForStorage = normalizeOptionalString(pkg.hash_sha256) ?? "invalid_hash";
      const signature = normalizeOptionalString(pkg.signature);
      const normalizedManifest = normalizeManifest(pkg.manifest);
      const manifestForStorage = normalizedManifest ?? {};

      const decided = decideImportedStatus({
        hash_sha256: normalizedHash,
        manifest: normalizedManifest,
        signature,
      });

      const existing = await pool.query<{
        skill_package_id: string;
        verification_status: SkillVerificationStatusValue;
        verified_at: string | null;
        quarantine_reason: string | null;
      }>(
        `SELECT skill_package_id, verification_status, verified_at, quarantine_reason
         FROM sec_skill_packages
         WHERE workspace_id = $1
           AND skill_id = $2
           AND version = $3`,
        [workspace_id, skill_id, version],
      );

      let skill_package_id: string;
      let previous_status: SkillVerificationStatusValue | null = null;
      let final_status = decided.status;
      let final_quarantine_reason = decided.quarantine_reason;
      let final_verified_at: string | null = null;
      let inserted = false;

      if (existing.rowCount === 1) {
        const row = existing.rows[0];
        skill_package_id = row.skill_package_id;
        previous_status = row.verification_status;
        final_status = mergeStatus(row.verification_status, decided.status);
        final_verified_at =
          final_status === SkillVerificationStatus.Verified ? (row.verified_at ?? now) : row.verified_at;
        if (final_status === SkillVerificationStatus.Quarantined) {
          final_quarantine_reason = decided.quarantine_reason ?? row.quarantine_reason ?? "manual_quarantine";
        } else {
          final_quarantine_reason = undefined;
        }

        await pool.query(
          `UPDATE sec_skill_packages
           SET hash_sha256 = $4,
               signature = $5,
               manifest = $6::jsonb,
               verification_status = $7,
               verified_at = $8,
               quarantine_reason = $9,
               updated_at = $10
           WHERE workspace_id = $1
             AND skill_package_id = $2
             AND skill_id = $3`,
          [
            workspace_id,
            skill_package_id,
            skill_id,
            normalizedHash ?? hashForStorage,
            signature ?? null,
            JSON.stringify(manifestForStorage),
            final_status,
            final_status === SkillVerificationStatus.Verified ? final_verified_at ?? now : null,
            final_status === SkillVerificationStatus.Quarantined ? final_quarantine_reason ?? null : null,
            now,
          ],
        );
      } else {
        inserted = true;
        skill_package_id = newSkillPackageId();
        if (final_status === SkillVerificationStatus.Verified) {
          final_verified_at = now;
        }

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
            verified_at,
            quarantine_reason,
            installed_by_type,
            installed_by_id,
            installed_by_principal_id,
            created_at,
            updated_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,'agent',$11,$12,$13,$13
          )`,
          [
            skill_package_id,
            workspace_id,
            skill_id,
            version,
            normalizedHash ?? hashForStorage,
            signature ?? null,
            JSON.stringify(manifestForStorage),
            final_status,
            final_status === SkillVerificationStatus.Verified ? final_verified_at ?? now : null,
            final_status === SkillVerificationStatus.Quarantined ? final_quarantine_reason ?? null : null,
            agent_id,
            agent.rows[0].principal_id,
            now,
          ],
        );
      }

      await pool.query(
        `INSERT INTO sec_agent_skill_packages (
          agent_id,
          skill_id,
          version,
          hash_sha256,
          verification_status,
          skill_package_id,
          linked_at,
          updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
        ON CONFLICT (agent_id, skill_id, version)
        DO UPDATE SET
          hash_sha256 = EXCLUDED.hash_sha256,
          verification_status = EXCLUDED.verification_status,
          skill_package_id = EXCLUDED.skill_package_id,
          updated_at = EXCLUDED.updated_at`,
        [agent_id, skill_id, version, normalizedHash ?? hashForStorage, final_status, skill_package_id, now],
      );

      if (inserted) {
        await appendToStream(pool, {
          event_id: randomUUID(),
          event_type: "skill.package.installed",
          event_version: 1,
          occurred_at: now,
          workspace_id,
          actor: { actor_type, actor_id },
          actor_principal_id: agent.rows[0].principal_id,
          stream: { stream_type: "workspace", stream_id: workspace_id },
          correlation_id,
          data: {
            skill_package_id,
            skill_id,
            version,
            hash_sha256: normalizedHash ?? hashForStorage,
            has_signature: !!signature,
          },
          policy_context: {},
          model_context: {},
          display: {},
        });
      }

      if (final_status === SkillVerificationStatus.Verified && previous_status !== SkillVerificationStatus.Verified) {
        await appendToStream(pool, {
          event_id: randomUUID(),
          event_type: "skill.package.verified",
          event_version: 1,
          occurred_at: now,
          workspace_id,
          actor: { actor_type, actor_id },
          actor_principal_id: agent.rows[0].principal_id,
          stream: { stream_type: "workspace", stream_id: workspace_id },
          correlation_id,
          data: { skill_package_id, skill_id, version },
          policy_context: {},
          model_context: {},
          display: {},
        });
      }

      if (
        final_status === SkillVerificationStatus.Quarantined &&
        previous_status !== SkillVerificationStatus.Quarantined
      ) {
        await appendToStream(pool, {
          event_id: randomUUID(),
          event_type: "skill.package.quarantined",
          event_version: 1,
          occurred_at: now,
          workspace_id,
          actor: { actor_type, actor_id },
          actor_principal_id: agent.rows[0].principal_id,
          stream: { stream_type: "workspace", stream_id: workspace_id },
          correlation_id,
          data: {
            skill_package_id,
            skill_id,
            version,
            quarantine_reason: final_quarantine_reason ?? "manual_quarantine",
          },
          policy_context: {},
          model_context: {},
          display: {},
        });
      }

      if (final_status === SkillVerificationStatus.Verified) verified += 1;
      else if (final_status === SkillVerificationStatus.Quarantined) quarantined += 1;
      else pending += 1;

      items.push({
        skill_id,
        version,
        status: final_status,
        skill_package_id,
      });
    }

    await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "agent.skills.imported",
      event_version: 1,
      occurred_at: now,
      workspace_id,
      actor: { actor_type, actor_id },
      actor_principal_id: agent.rows[0].principal_id,
      stream: { stream_type: "workspace", stream_id: workspace_id },
      correlation_id,
      data: {
        agent_id,
        summary: {
          total: items.length,
          verified,
          pending,
          quarantined,
        },
      },
      policy_context: {},
      model_context: {},
      display: {},
    });

    return reply.code(200).send({
      summary: {
        total: items.length,
        verified,
        pending,
        quarantined,
      },
      items,
    });
  });
}
