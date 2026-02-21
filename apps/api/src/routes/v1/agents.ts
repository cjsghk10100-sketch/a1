import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import {
  type ActorType,
  SkillVerificationStatus,
  type SkillVerificationStatus as SkillVerificationStatusValue,
  type AgentSkillAssessImportedResponseV1,
  type AgentSkillCertifyImportedRequestV1,
  type AgentSkillCertifyImportedResponseV1,
  type AgentSkillImportCertifyRequestV1,
  type AgentSkillImportCertifyResponseV1,
  type AgentSkillOnboardingStatusListResponseV1,
  type AgentSkillOnboardingSummaryV1,
  type AgentSkillOnboardingStatusResponseV1,
  type AgentSkillImportResponseV1,
  type AgentSkillReviewPendingResponseV1,
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
  if (raw === "service" || raw === "agent") return raw;
  return "user";
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

function parseListLimit(raw: unknown): number {
  const parsed = Number.parseInt(typeof raw === "string" ? raw : "", 10);
  if (!Number.isFinite(parsed)) return 200;
  return Math.min(500, Math.max(1, parsed));
}

function parseBooleanFlag(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
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

function parseJsonBody<T>(raw: string): T {
  return JSON.parse(raw) as T;
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
    Querystring: { limit?: string; only_with_work?: string };
  }>("/v1/agents/skills/onboarding-statuses", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const limit = parseListLimit(req.query.limit);
    const only_with_work = parseBooleanFlag(req.query.only_with_work);

    const rows = await pool.query<{
      agent_id: string;
      total_linked: number;
      verified: number;
      verified_skills: number;
      pending: number;
      quarantined: number;
      verified_assessed: number;
    }>(
      `WITH scoped_agents AS (
         SELECT agent_id, created_at
         FROM sec_agents
         ORDER BY created_at DESC
         LIMIT $2
       ),
       package_counts AS (
         SELECT
           asp.agent_id,
           COUNT(*)::int AS total_linked,
           COUNT(*) FILTER (WHERE asp.verification_status = 'verified')::int AS verified,
           COUNT(*) FILTER (WHERE asp.verification_status = 'pending')::int AS pending,
           COUNT(*) FILTER (WHERE asp.verification_status = 'quarantined')::int AS quarantined
         FROM sec_agent_skill_packages asp
         JOIN sec_skill_packages sp
           ON sp.skill_package_id = asp.skill_package_id
         JOIN scoped_agents sa
           ON sa.agent_id = asp.agent_id
         WHERE sp.workspace_id = $1
         GROUP BY asp.agent_id
       ),
       verified_skills AS (
         SELECT asp.agent_id, asp.skill_id
         FROM sec_agent_skill_packages asp
         JOIN sec_skill_packages sp
           ON sp.skill_package_id = asp.skill_package_id
         JOIN scoped_agents sa
           ON sa.agent_id = asp.agent_id
         WHERE sp.workspace_id = $1
           AND asp.verification_status = 'verified'
         GROUP BY asp.agent_id, asp.skill_id
       ),
       verified_skill_counts AS (
         SELECT agent_id, COUNT(*)::int AS verified_skills
         FROM verified_skills
         GROUP BY agent_id
       ),
       assessed_counts AS (
         SELECT vs.agent_id, COUNT(*)::int AS verified_assessed
         FROM verified_skills vs
         JOIN sec_agent_skills sk
           ON sk.workspace_id = $1
          AND sk.agent_id = vs.agent_id
          AND sk.skill_id = vs.skill_id
          AND sk.assessment_total > 0
         GROUP BY vs.agent_id
       )
       SELECT
         sa.agent_id,
         COALESCE(pc.total_linked, 0)::int AS total_linked,
         COALESCE(pc.verified, 0)::int AS verified,
         COALESCE(vsc.verified_skills, 0)::int AS verified_skills,
         COALESCE(pc.pending, 0)::int AS pending,
         COALESCE(pc.quarantined, 0)::int AS quarantined,
         COALESCE(ac.verified_assessed, 0)::int AS verified_assessed
       FROM scoped_agents sa
       LEFT JOIN package_counts pc
         ON pc.agent_id = sa.agent_id
       LEFT JOIN verified_skill_counts vsc
         ON vsc.agent_id = sa.agent_id
       LEFT JOIN assessed_counts ac
         ON ac.agent_id = sa.agent_id
       ORDER BY sa.created_at DESC`,
      [workspace_id, limit],
    );

    const items = rows.rows
      .map((row) => {
        const summary: AgentSkillOnboardingSummaryV1 = {
          total_linked: Number(row.total_linked) || 0,
          verified: Number(row.verified) || 0,
          verified_skills: Number(row.verified_skills) || 0,
          pending: Number(row.pending) || 0,
          quarantined: Number(row.quarantined) || 0,
          verified_assessed: Number(row.verified_assessed) || 0,
          verified_unassessed: Math.max((Number(row.verified_skills) || 0) - (Number(row.verified_assessed) || 0), 0),
        };
        return {
          agent_id: row.agent_id,
          summary,
        };
      })
      .filter((row) => !only_with_work || row.summary.pending + row.summary.verified_unassessed > 0);

    const response: AgentSkillOnboardingStatusListResponseV1 = {
      items,
    };
    return reply.code(200).send(response);
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

  app.get<{
    Params: { agentId: string };
  }>("/v1/agents/:agentId/skills/onboarding-status", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const agent_id = normalizeRequiredString(req.params.agentId);
    if (!agent_id) return reply.code(400).send({ error: "invalid_agent_id" });

    const agent = await pool.query<{ agent_id: string }>("SELECT agent_id FROM sec_agents WHERE agent_id = $1", [
      agent_id,
    ]);
    if (agent.rowCount !== 1) return reply.code(404).send({ error: "agent_not_found" });

    const counts = await pool.query<{ verification_status: SkillVerificationStatusValue; cnt: number }>(
      `SELECT asp.verification_status, COUNT(*)::int AS cnt
       FROM sec_agent_skill_packages asp
       JOIN sec_skill_packages sp
         ON sp.skill_package_id = asp.skill_package_id
       WHERE asp.agent_id = $1
         AND sp.workspace_id = $2
       GROUP BY asp.verification_status`,
      [agent_id, workspace_id],
    );

    let total_linked = 0;
    let verified = 0;
    let pending = 0;
    let quarantined = 0;
    for (const row of counts.rows) {
      const cnt = Number(row.cnt) || 0;
      total_linked += cnt;
      if (row.verification_status === SkillVerificationStatus.Verified) verified += cnt;
      else if (row.verification_status === SkillVerificationStatus.Pending) pending += cnt;
      else if (row.verification_status === SkillVerificationStatus.Quarantined) quarantined += cnt;
    }

    const verifiedSkillIdsRes = await pool.query<{ skill_id: string }>(
      `SELECT DISTINCT asp.skill_id
       FROM sec_agent_skill_packages asp
       JOIN sec_skill_packages sp
         ON sp.skill_package_id = asp.skill_package_id
       WHERE asp.agent_id = $1
         AND sp.workspace_id = $2
         AND asp.verification_status = 'verified'`,
      [agent_id, workspace_id],
    );
    const verifiedSkillIds = verifiedSkillIdsRes.rows.map((row) => row.skill_id);
    const verified_skills = verifiedSkillIds.length;

    let verified_assessed = 0;
    if (verifiedSkillIds.length > 0) {
      const assessedRes = await pool.query<{ cnt: number }>(
        `SELECT COUNT(*)::int AS cnt
         FROM sec_agent_skills
         WHERE workspace_id = $1
           AND agent_id = $2
           AND assessment_total > 0
           AND skill_id = ANY($3::text[])`,
        [workspace_id, agent_id, verifiedSkillIds],
      );
      verified_assessed = Number(assessedRes.rows[0]?.cnt ?? 0);
    }

    const response: AgentSkillOnboardingStatusResponseV1 = {
      summary: {
        total_linked,
        verified,
        verified_skills,
        pending,
        quarantined,
        verified_assessed,
        verified_unassessed: Math.max(verified_skills - verified_assessed, 0),
      },
    };
    return reply.code(200).send(response);
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

  app.post<{
    Params: { agentId: string };
    Body: AgentSkillImportCertifyRequestV1;
  }>("/v1/agents/:agentId/skills/import-certify", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const agent_id = normalizeRequiredString(req.params.agentId);
    if (!agent_id) return reply.code(400).send({ error: "invalid_agent_id" });

    const actor_type = normalizeActorType(req.body.actor_type);
    const actor_id =
      normalizeOptionalString(req.body.actor_id) || (actor_type === "service" ? "api" : "anon");
    const principal_id =
      normalizeOptionalString(req.body.principal_id) ??
      normalizeOptionalString(req.body.actor_principal_id);
    const actor_principal_id =
      normalizeOptionalString(req.body.actor_principal_id) ??
      normalizeOptionalString(req.body.principal_id);
    const correlation_id = normalizeOptionalString(req.body.correlation_id) ?? randomUUID();

    const importResponse = await app.inject({
      method: "POST",
      url: `/v1/agents/${encodeURIComponent(agent_id)}/skills/import`,
      headers: {
        "content-type": "application/json",
        "x-workspace-id": workspace_id,
      },
      payload: {
        packages: Array.isArray(req.body.packages) ? req.body.packages : [],
        actor_type,
        actor_id,
        correlation_id,
      },
    });
    const importBody = parseJsonBody<unknown>(importResponse.payload);
    if (importResponse.statusCode >= 400) {
      return reply.code(importResponse.statusCode).send(importBody);
    }

    const certifyResponse = await app.inject({
      method: "POST",
      url: `/v1/agents/${encodeURIComponent(agent_id)}/skills/certify-imported`,
      headers: {
        "content-type": "application/json",
        "x-workspace-id": workspace_id,
      },
      payload: {
        actor_type,
        actor_id,
        principal_id,
        actor_principal_id,
        correlation_id,
        limit: req.body.limit,
        only_unassessed: req.body.only_unassessed,
      },
    });
    const certifyBody = parseJsonBody<unknown>(certifyResponse.payload);
    if (certifyResponse.statusCode >= 400) {
      return reply.code(certifyResponse.statusCode).send(certifyBody);
    }

    const response: AgentSkillImportCertifyResponseV1 = {
      import: importBody as AgentSkillImportResponseV1,
      certify: certifyBody as AgentSkillCertifyImportedResponseV1,
    };
    return reply.code(200).send(response);
  });

  app.post<{
    Params: { agentId: string };
    Body: { actor_type?: ActorType; actor_id?: string; principal_id?: string; correlation_id?: string };
  }>("/v1/agents/:agentId/skills/review-pending", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const agent_id = normalizeRequiredString(req.params.agentId);
    if (!agent_id) return reply.code(400).send({ error: "invalid_agent_id" });

    const agent = await pool.query<{ principal_id: string }>(
      "SELECT principal_id FROM sec_agents WHERE agent_id = $1",
      [agent_id],
    );
    if (agent.rowCount !== 1) return reply.code(404).send({ error: "agent_not_found" });

    const actor_type = normalizeActorType(req.body.actor_type);
    const actor_id =
      normalizeOptionalString(req.body.actor_id) || (actor_type === "service" ? "api" : "anon");
    const actor_principal_id = normalizeOptionalString(req.body.principal_id);
    const correlation_id = normalizeOptionalString(req.body.correlation_id) ?? randomUUID();

    const pendingRes = await pool.query<{
      skill_package_id: string;
      skill_id: string;
      version: string;
      hash_sha256: string;
      signature: string | null;
      manifest: unknown;
    }>(
      `SELECT
         sp.skill_package_id,
         sp.skill_id,
         sp.version,
         sp.hash_sha256,
         sp.signature,
         sp.manifest
       FROM sec_agent_skill_packages asp
       JOIN sec_skill_packages sp
         ON sp.skill_package_id = asp.skill_package_id
       WHERE asp.agent_id = $1
         AND asp.verification_status = 'pending'
         AND sp.workspace_id = $2
       ORDER BY asp.updated_at ASC`,
      [agent_id, workspace_id],
    );

    const now = new Date().toISOString();
    const items: Array<{
      skill_package_id: string;
      skill_id: string;
      version: string;
      status: SkillVerificationStatusValue;
      reason?: string;
    }> = [];
    let verified = 0;
    let quarantined = 0;

    for (const row of pendingRes.rows) {
      const normalizedHash = normalizeHash(row.hash_sha256);
      const normalizedManifest = normalizeManifest(row.manifest);
      const signature = normalizeOptionalString(row.signature ?? undefined);

      let nextStatus: SkillVerificationStatusValue = SkillVerificationStatus.Verified;
      let quarantine_reason: string | undefined;

      if (!normalizedHash) {
        nextStatus = SkillVerificationStatus.Quarantined;
        quarantine_reason = "verify_stored_hash_invalid";
      } else if (!normalizedManifest) {
        nextStatus = SkillVerificationStatus.Quarantined;
        quarantine_reason = "verify_stored_manifest_invalid";
      } else if (!signature) {
        nextStatus = SkillVerificationStatus.Quarantined;
        quarantine_reason = "verify_signature_required";
      }

      await pool.query(
        `UPDATE sec_skill_packages
         SET verification_status = $3,
             verified_at = CASE WHEN $3 = 'verified' THEN COALESCE(verified_at, $5::timestamptz) ELSE NULL END,
             quarantine_reason = CASE WHEN $3 = 'quarantined' THEN $4 ELSE NULL END,
             updated_at = $5
         WHERE workspace_id = $1
           AND skill_package_id = $2`,
        [workspace_id, row.skill_package_id, nextStatus, quarantine_reason ?? null, now],
      );

      await pool.query(
        `UPDATE sec_agent_skill_packages
         SET verification_status = $3,
             updated_at = $4
         WHERE agent_id = $1
           AND skill_package_id = $2`,
        [agent_id, row.skill_package_id, nextStatus, now],
      );

      if (nextStatus === SkillVerificationStatus.Verified) {
        verified += 1;
        await appendToStream(pool, {
          event_id: randomUUID(),
          event_type: "skill.package.verified",
          event_version: 1,
          occurred_at: now,
          workspace_id,
          actor: { actor_type, actor_id },
          actor_principal_id,
          stream: { stream_type: "workspace", stream_id: workspace_id },
          correlation_id,
          data: {
            skill_package_id: row.skill_package_id,
            skill_id: row.skill_id,
            version: row.version,
          },
          policy_context: {},
          model_context: {},
          display: {},
        });
      } else {
        quarantined += 1;
        await appendToStream(pool, {
          event_id: randomUUID(),
          event_type: "skill.package.quarantined",
          event_version: 1,
          occurred_at: now,
          workspace_id,
          actor: { actor_type, actor_id },
          actor_principal_id,
          stream: { stream_type: "workspace", stream_id: workspace_id },
          correlation_id,
          data: {
            skill_package_id: row.skill_package_id,
            skill_id: row.skill_id,
            version: row.version,
            quarantine_reason: quarantine_reason ?? "manual_quarantine",
          },
          policy_context: {},
          model_context: {},
          display: {},
        });
      }

      items.push({
        skill_package_id: row.skill_package_id,
        skill_id: row.skill_id,
        version: row.version,
        status: nextStatus,
        reason: quarantine_reason,
      });
    }

    return reply.code(200).send({
      summary: {
        total: pendingRes.rowCount,
        verified,
        quarantined,
      },
      items,
    });
  });

  app.post<{
    Params: { agentId: string };
    Body: AgentSkillCertifyImportedRequestV1;
  }>("/v1/agents/:agentId/skills/certify-imported", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const agent_id = normalizeRequiredString(req.params.agentId);
    if (!agent_id) return reply.code(400).send({ error: "invalid_agent_id" });

    const actor_type = normalizeActorType(req.body.actor_type);
    const actor_id =
      normalizeOptionalString(req.body.actor_id) || (actor_type === "service" ? "api" : "anon");
    const principal_id =
      normalizeOptionalString(req.body.principal_id) ??
      normalizeOptionalString(req.body.actor_principal_id);
    const actor_principal_id =
      normalizeOptionalString(req.body.actor_principal_id) ??
      normalizeOptionalString(req.body.principal_id);
    const correlation_id = normalizeOptionalString(req.body.correlation_id) ?? randomUUID();

    const reviewResponse = await app.inject({
      method: "POST",
      url: `/v1/agents/${encodeURIComponent(agent_id)}/skills/review-pending`,
      headers: {
        "content-type": "application/json",
        "x-workspace-id": workspace_id,
      },
      payload: {
        actor_type,
        actor_id,
        principal_id,
        correlation_id,
      },
    });
    const reviewBody = parseJsonBody<unknown>(reviewResponse.payload);
    if (reviewResponse.statusCode >= 400) {
      return reply.code(reviewResponse.statusCode).send(reviewBody);
    }

    const assessResponse = await app.inject({
      method: "POST",
      url: `/v1/agents/${encodeURIComponent(agent_id)}/skills/assess-imported`,
      headers: {
        "content-type": "application/json",
        "x-workspace-id": workspace_id,
      },
      payload: {
        actor_type,
        actor_id,
        actor_principal_id,
        correlation_id,
        limit: req.body.limit,
        only_unassessed: req.body.only_unassessed,
      },
    });
    const assessBody = parseJsonBody<unknown>(assessResponse.payload);
    if (assessResponse.statusCode >= 400) {
      return reply.code(assessResponse.statusCode).send(assessBody);
    }

    const response: AgentSkillCertifyImportedResponseV1 = {
      review: reviewBody as AgentSkillReviewPendingResponseV1,
      assess: assessBody as AgentSkillAssessImportedResponseV1,
    };
    return reply.code(200).send(response);
  });
}
