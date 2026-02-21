import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import type { ActorType, SkillRiskClass, SkillType } from "@agentapp/shared";

import { appendToStream } from "../../eventStore/index.js";
import type { DbPool as ApiDbPool } from "../../db/pool.js";

type SkillCatalogRow = {
  workspace_id: string;
  skill_id: string;
  name: string;
  description: string | null;
  skill_type: SkillType;
  risk_class: SkillRiskClass;
  assessment_suite: Record<string, unknown>;
  required_manifest_caps: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type AgentSkillRow = {
  workspace_id: string;
  agent_id: string;
  skill_id: string;
  level: number;
  learned_at: string | null;
  last_used_at: string | null;
  usage_total: number;
  usage_7d: number;
  usage_30d: number;
  assessment_total: number;
  assessment_passed: number;
  reliability_score: number;
  impact_score: number;
  is_primary: boolean;
  source_skill_package_id: string | null;
  created_at: string;
  updated_at: string;
};

type SkillAssessmentStatus = "started" | "passed" | "failed";

type SkillAssessmentRow = {
  assessment_id: string;
  workspace_id: string;
  agent_id: string;
  skill_id: string;
  status: SkillAssessmentStatus;
  trigger_reason: string | null;
  suite: Record<string, unknown>;
  results: Record<string, unknown>;
  score: number | null;
  run_id: string | null;
  started_at: string;
  ended_at: string | null;
  created_by_type: ActorType;
  created_by_id: string;
  created_by_principal_id: string | null;
  created_at: string;
  updated_at: string;
};

type AgentRow = {
  agent_id: string;
  principal_id: string;
};

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
  const v = normalizeOptionalString(raw);
  return v ?? null;
}

function normalizeSkillType(raw: unknown): SkillType {
  if (raw === "workflow" || raw === "cognitive") return raw;
  return "tool";
}

function normalizeRiskClass(raw: unknown): SkillRiskClass {
  if (raw === "medium" || raw === "high") return raw;
  return "low";
}

function normalizeLevel(raw: unknown, fallback = 1): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(5, Math.floor(n)));
}

function normalizeScore01(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function parseLimit(raw: unknown): number {
  const n = Number(raw ?? "100");
  if (!Number.isFinite(n)) return 100;
  return Math.max(1, Math.min(200, Math.floor(n)));
}

async function getAgent(pool: ApiDbPool, agent_id: string): Promise<AgentRow | null> {
  const row = await pool.query<AgentRow>(
    `SELECT agent_id, principal_id
     FROM sec_agents
     WHERE agent_id = $1`,
    [agent_id],
  );
  if (row.rowCount !== 1) return null;
  return row.rows[0];
}

async function ensureCatalogSkill(
  pool: ApiDbPool,
  input: {
    workspace_id: string;
    skill_id: string;
    name?: string;
    description?: string;
    skill_type?: SkillType;
    risk_class?: SkillRiskClass;
    assessment_suite?: Record<string, unknown>;
    required_manifest_caps?: Record<string, unknown>;
    nowIso: string;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO sec_skill_catalog (
       workspace_id,
       skill_id,
       name,
       description,
       skill_type,
       risk_class,
       assessment_suite,
       required_manifest_caps,
       created_at,
       updated_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$9
     )
     ON CONFLICT (workspace_id, skill_id)
     DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       skill_type = EXCLUDED.skill_type,
       risk_class = EXCLUDED.risk_class,
       assessment_suite = EXCLUDED.assessment_suite,
       required_manifest_caps = EXCLUDED.required_manifest_caps,
       updated_at = EXCLUDED.updated_at`,
    [
      input.workspace_id,
      input.skill_id,
      input.name ?? input.skill_id,
      input.description ?? null,
      input.skill_type ?? "tool",
      input.risk_class ?? "low",
      JSON.stringify(input.assessment_suite ?? {}),
      JSON.stringify(input.required_manifest_caps ?? {}),
      input.nowIso,
    ],
  );
}

async function getCurrentPrimarySkill(
  pool: ApiDbPool,
  workspace_id: string,
  agent_id: string,
): Promise<string | null> {
  const current = await pool.query<{ skill_id: string }>(
    `SELECT skill_id
     FROM sec_agent_skills
     WHERE workspace_id = $1
       AND agent_id = $2
       AND is_primary = TRUE
     LIMIT 1`,
    [workspace_id, agent_id],
  );
  if (current.rowCount !== 1) return null;
  return current.rows[0].skill_id;
}

async function recomputePrimarySkill(
  pool: ApiDbPool,
  workspace_id: string,
  agent_id: string,
): Promise<string | null> {
  const top = await pool.query<{ skill_id: string }>(
    `SELECT skill_id
     FROM sec_agent_skills
     WHERE workspace_id = $1
       AND agent_id = $2
     ORDER BY usage_total DESC, reliability_score DESC, level DESC, updated_at DESC
     LIMIT 1`,
    [workspace_id, agent_id],
  );
  if (top.rowCount !== 1) return null;
  return top.rows[0].skill_id;
}

async function setPrimarySkill(
  pool: ApiDbPool,
  workspace_id: string,
  agent_id: string,
  skill_id: string,
  updated_at: string,
): Promise<boolean> {
  const current = await getCurrentPrimarySkill(pool, workspace_id, agent_id);
  if (current === skill_id) return false;

  // Two-step toggle avoids transient unique-index collisions on partial unique index
  // (workspace_id, agent_id) WHERE is_primary = TRUE.
  await pool.query(
    `UPDATE sec_agent_skills
     SET is_primary = FALSE,
         updated_at = $3
     WHERE workspace_id = $1
       AND agent_id = $2
       AND is_primary = TRUE`,
    [workspace_id, agent_id, updated_at],
  );

  const updated = await pool.query(
    `UPDATE sec_agent_skills
     SET is_primary = TRUE,
         updated_at = $4
     WHERE workspace_id = $1
       AND agent_id = $2
       AND skill_id = $3`,
    [workspace_id, agent_id, skill_id, updated_at],
  );
  return updated.rowCount === 1;
}

async function upsertAgentSkillLearn(
  pool: ApiDbPool,
  input: {
    workspace_id: string;
    agent_id: string;
    skill_id: string;
    level: number;
    reliability_score?: number;
    impact_score?: number;
    source_skill_package_id?: string;
    nowIso: string;
  },
): Promise<{ row: AgentSkillRow; inserted: boolean; levelIncreased: boolean }> {
  const existing = await pool.query<AgentSkillRow>(
    `SELECT
       workspace_id, agent_id, skill_id,
       level, learned_at, last_used_at,
       usage_total, usage_7d, usage_30d,
       assessment_total, assessment_passed,
       reliability_score, impact_score, is_primary,
       source_skill_package_id,
       created_at, updated_at
     FROM sec_agent_skills
     WHERE workspace_id = $1
       AND agent_id = $2
       AND skill_id = $3`,
    [input.workspace_id, input.agent_id, input.skill_id],
  );

  if (existing.rowCount === 1) {
    const before = existing.rows[0];
    const nextLevel = Math.max(before.level, input.level);
    const nextReliability =
      input.reliability_score == null ? before.reliability_score : input.reliability_score;
    const nextImpact = input.impact_score == null ? before.impact_score : input.impact_score;
    await pool.query(
      `UPDATE sec_agent_skills
       SET level = $4,
           reliability_score = $5,
           impact_score = $6,
           source_skill_package_id = COALESCE($7, source_skill_package_id),
           learned_at = COALESCE(learned_at, $8),
           updated_at = $8
       WHERE workspace_id = $1
         AND agent_id = $2
         AND skill_id = $3`,
      [
        input.workspace_id,
        input.agent_id,
        input.skill_id,
        nextLevel,
        nextReliability,
        nextImpact,
        input.source_skill_package_id ?? null,
        input.nowIso,
      ],
    );
    const updated = await pool.query<AgentSkillRow>(
      `SELECT
         workspace_id, agent_id, skill_id,
         level, learned_at, last_used_at,
         usage_total, usage_7d, usage_30d,
         assessment_total, assessment_passed,
         reliability_score, impact_score, is_primary,
         source_skill_package_id,
         created_at, updated_at
       FROM sec_agent_skills
       WHERE workspace_id = $1
         AND agent_id = $2
         AND skill_id = $3`,
      [input.workspace_id, input.agent_id, input.skill_id],
    );
    return {
      row: updated.rows[0],
      inserted: false,
      levelIncreased: nextLevel > before.level,
    };
  }

  await pool.query(
    `INSERT INTO sec_agent_skills (
       workspace_id,
       agent_id,
       skill_id,
       level,
       learned_at,
       last_used_at,
       usage_total,
       usage_7d,
       usage_30d,
       assessment_total,
       assessment_passed,
       reliability_score,
       impact_score,
       is_primary,
       source_skill_package_id,
       created_at,
       updated_at
     ) VALUES (
       $1,$2,$3,$4,$5,NULL,0,0,0,0,0,$6,$7,FALSE,$8,$5,$5
     )`,
    [
      input.workspace_id,
      input.agent_id,
      input.skill_id,
      input.level,
      input.nowIso,
      input.reliability_score ?? 0,
      input.impact_score ?? 0,
      input.source_skill_package_id ?? null,
    ],
  );

  const insertedRow = await pool.query<AgentSkillRow>(
    `SELECT
       workspace_id, agent_id, skill_id,
       level, learned_at, last_used_at,
       usage_total, usage_7d, usage_30d,
       assessment_total, assessment_passed,
       reliability_score, impact_score, is_primary,
       source_skill_package_id,
       created_at, updated_at
     FROM sec_agent_skills
     WHERE workspace_id = $1
       AND agent_id = $2
       AND skill_id = $3`,
    [input.workspace_id, input.agent_id, input.skill_id],
  );
  return { row: insertedRow.rows[0], inserted: true, levelIncreased: true };
}

export async function trackAgentSkillUsageFromTool(
  pool: ApiDbPool,
  input: {
    workspace_id: string;
    agent_id: string;
    skill_id: string;
    occurred_at: string;
    correlation_id: string;
    causation_id?: string;
    room_id?: string;
    thread_id?: string;
    run_id?: string;
    step_id?: string;
    actor_type?: ActorType;
    actor_id?: string;
    actor_principal_id?: string;
  },
): Promise<void> {
  const agent = await getAgent(pool, input.agent_id);
  if (!agent) return;

  await ensureCatalogSkill(pool, {
    workspace_id: input.workspace_id,
    skill_id: input.skill_id,
    name: input.skill_id,
    skill_type: "tool",
    risk_class: "low",
    nowIso: input.occurred_at,
  });

  const existing = await pool.query<AgentSkillRow>(
    `SELECT
       workspace_id, agent_id, skill_id,
       level, learned_at, last_used_at,
       usage_total, usage_7d, usage_30d,
       assessment_total, assessment_passed,
       reliability_score, impact_score, is_primary,
       source_skill_package_id,
       created_at, updated_at
     FROM sec_agent_skills
     WHERE workspace_id = $1
       AND agent_id = $2
       AND skill_id = $3`,
    [input.workspace_id, input.agent_id, input.skill_id],
  );

  let inserted = false;
  if (existing.rowCount === 1) {
    await pool.query(
      `UPDATE sec_agent_skills
       SET usage_total = usage_total + 1,
           usage_7d = usage_7d + 1,
           usage_30d = usage_30d + 1,
           last_used_at = $4,
           learned_at = COALESCE(learned_at, $4),
           updated_at = $4
       WHERE workspace_id = $1
         AND agent_id = $2
         AND skill_id = $3`,
      [input.workspace_id, input.agent_id, input.skill_id, input.occurred_at],
    );
  } else {
    inserted = true;
    await pool.query(
      `INSERT INTO sec_agent_skills (
         workspace_id,
         agent_id,
         skill_id,
         level,
         learned_at,
         last_used_at,
         usage_total,
         usage_7d,
         usage_30d,
         assessment_total,
         assessment_passed,
         reliability_score,
         impact_score,
         is_primary,
         source_skill_package_id,
         created_at,
         updated_at
       ) VALUES (
         $1,$2,$3,1,$4,$4,1,1,1,0,0,0,0,FALSE,NULL,$4,$4
       )`,
      [input.workspace_id, input.agent_id, input.skill_id, input.occurred_at],
    );
  }

  const updated = await pool.query<AgentSkillRow>(
    `SELECT
       workspace_id, agent_id, skill_id,
       level, learned_at, last_used_at,
       usage_total, usage_7d, usage_30d,
       assessment_total, assessment_passed,
       reliability_score, impact_score, is_primary,
       source_skill_package_id,
       created_at, updated_at
     FROM sec_agent_skills
     WHERE workspace_id = $1
       AND agent_id = $2
       AND skill_id = $3`,
    [input.workspace_id, input.agent_id, input.skill_id],
  );
  const row = updated.rows[0];

  const actor_type = input.actor_type ?? "service";
  const actor_id = input.actor_id ?? "api";

  if (inserted) {
    await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "agent.skill.learned",
      event_version: 1,
      occurred_at: input.occurred_at,
      workspace_id: input.workspace_id,
      room_id: input.room_id,
      thread_id: input.thread_id,
      run_id: input.run_id,
      step_id: input.step_id,
      actor: { actor_type, actor_id },
      actor_principal_id: input.actor_principal_id,
      stream: input.room_id
        ? { stream_type: "room", stream_id: input.room_id }
        : { stream_type: "workspace", stream_id: input.workspace_id },
      correlation_id: input.correlation_id,
      causation_id: input.causation_id,
      data: {
        agent_id: input.agent_id,
        skill_id: input.skill_id,
        level: row.level,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });
  }

  await appendToStream(pool, {
    event_id: randomUUID(),
    event_type: "agent.skill.used",
    event_version: 1,
    occurred_at: input.occurred_at,
    workspace_id: input.workspace_id,
    room_id: input.room_id,
    thread_id: input.thread_id,
    run_id: input.run_id,
    step_id: input.step_id,
    actor: { actor_type, actor_id },
    actor_principal_id: input.actor_principal_id,
    stream: input.room_id
      ? { stream_type: "room", stream_id: input.room_id }
      : { stream_type: "workspace", stream_id: input.workspace_id },
    correlation_id: input.correlation_id,
    causation_id: input.causation_id,
    data: {
      agent_id: input.agent_id,
      skill_id: input.skill_id,
      usage_total: row.usage_total,
      run_id: input.run_id,
      step_id: input.step_id,
    },
    policy_context: {},
    model_context: {},
    display: {},
  });

  const best = await recomputePrimarySkill(pool, input.workspace_id, input.agent_id);
  if (best) {
    const changed = await setPrimarySkill(pool, input.workspace_id, input.agent_id, best, input.occurred_at);
    if (changed) {
      await appendToStream(pool, {
        event_id: randomUUID(),
        event_type: "agent.skill.primary_set",
        event_version: 1,
        occurred_at: input.occurred_at,
        workspace_id: input.workspace_id,
        room_id: input.room_id,
        thread_id: input.thread_id,
        run_id: input.run_id,
        step_id: input.step_id,
        actor: { actor_type, actor_id },
        actor_principal_id: input.actor_principal_id,
        stream: input.room_id
          ? { stream_type: "room", stream_id: input.room_id }
          : { stream_type: "workspace", stream_id: input.workspace_id },
        correlation_id: input.correlation_id,
        causation_id: input.causation_id,
        data: {
          agent_id: input.agent_id,
          skill_id: best,
        },
        policy_context: {},
        model_context: {},
        display: {},
      });
    }
  }
}

async function createSkillAssessment(
  pool: ApiDbPool,
  input: {
    workspace_id: string;
    agent_id: string;
    skill_id: string;
    status: "passed" | "failed";
    suite?: Record<string, unknown>;
    results?: Record<string, unknown>;
    score?: number;
    run_id?: string;
    trigger_reason?: string;
    source_skill_package_id?: string;
    actor_type?: ActorType;
    actor_id?: string;
    actor_principal_id?: string;
    correlation_id: string;
  },
): Promise<{
  assessment_id: string;
  status: "passed" | "failed";
  score: number;
  reliability_score: number;
  assessment_total: number;
  assessment_passed: number;
}> {
  const actor_type = input.actor_type ?? "service";
  const actor_id = input.actor_id ?? (actor_type === "service" ? "api" : "anon");
  const actor_principal_id = input.actor_principal_id;

  const nowIso = new Date().toISOString();
  await ensureCatalogSkill(pool, {
    workspace_id: input.workspace_id,
    skill_id: input.skill_id,
    name: input.skill_id,
    skill_type: "workflow",
    risk_class: "low",
    assessment_suite: input.suite ?? {},
    nowIso,
  });

  await upsertAgentSkillLearn(pool, {
    workspace_id: input.workspace_id,
    agent_id: input.agent_id,
    skill_id: input.skill_id,
    level: 1,
    source_skill_package_id: input.source_skill_package_id,
    nowIso,
  });

  const assessment_id = `asmt_${randomUUID().replaceAll("-", "")}`;
  await pool.query(
    `INSERT INTO sec_skill_assessments (
       assessment_id,
       workspace_id,
       agent_id,
       skill_id,
       status,
       trigger_reason,
       suite,
       results,
       score,
       run_id,
       started_at,
       ended_at,
       created_by_type,
       created_by_id,
       created_by_principal_id,
       created_at,
       updated_at
     ) VALUES (
       $1,$2,$3,$4,'started',$5,$6::jsonb,$7::jsonb,NULL,$8,$9,NULL,$10,$11,$12,$9,$9
     )`,
    [
      assessment_id,
      input.workspace_id,
      input.agent_id,
      input.skill_id,
      normalizeOptionalString(input.trigger_reason) ?? null,
      JSON.stringify(input.suite ?? {}),
      JSON.stringify({}),
      normalizeOptionalString(input.run_id) ?? null,
      nowIso,
      actor_type,
      actor_id,
      actor_principal_id ?? null,
    ],
  );

  await appendToStream(pool, {
    event_id: randomUUID(),
    event_type: "skill.assessment.started",
    event_version: 1,
    occurred_at: nowIso,
    workspace_id: input.workspace_id,
    actor: { actor_type, actor_id },
    actor_principal_id,
    stream: { stream_type: "workspace", stream_id: input.workspace_id },
    correlation_id: input.correlation_id,
    data: {
      assessment_id,
      agent_id: input.agent_id,
      skill_id: input.skill_id,
      source_skill_package_id: input.source_skill_package_id ?? null,
    },
    policy_context: {},
    model_context: {},
    display: {},
  });

  const endedAt = new Date().toISOString();
  const score = input.score == null ? undefined : normalizeScore01(input.score, 0);
  const finalScore = score ?? (input.status === "passed" ? 1 : 0);

  await pool.query(
    `UPDATE sec_skill_assessments
     SET status = $5,
         results = $6::jsonb,
         score = $7,
         ended_at = $8,
         updated_at = $8
     WHERE assessment_id = $1
       AND workspace_id = $2
       AND agent_id = $3
       AND skill_id = $4
       AND status = 'started'`,
    [
      assessment_id,
      input.workspace_id,
      input.agent_id,
      input.skill_id,
      input.status,
      JSON.stringify(input.results ?? {}),
      finalScore,
      endedAt,
    ],
  );

  const passedInc = input.status === "passed" ? 1 : 0;
  const skill = await pool.query<{
    assessment_total: number;
    assessment_passed: number;
    reliability_score: number;
  }>(
    `UPDATE sec_agent_skills
     SET assessment_total = assessment_total + 1,
         assessment_passed = assessment_passed + $4,
         reliability_score = CASE
           WHEN (assessment_total + 1) > 0
             THEN (assessment_passed + $4)::double precision / (assessment_total + 1)::double precision
           ELSE 0
         END,
         updated_at = $5
     WHERE workspace_id = $1
       AND agent_id = $2
       AND skill_id = $3
     RETURNING assessment_total, assessment_passed, reliability_score`,
    [input.workspace_id, input.agent_id, input.skill_id, passedInc, endedAt],
  );

  await appendToStream(pool, {
    event_id: randomUUID(),
    event_type: input.status === "passed" ? "skill.assessment.passed" : "skill.assessment.failed",
    event_version: 1,
    occurred_at: endedAt,
    workspace_id: input.workspace_id,
    actor: { actor_type, actor_id },
    actor_principal_id,
    stream: { stream_type: "workspace", stream_id: input.workspace_id },
    correlation_id: input.correlation_id,
    data: {
      assessment_id,
      agent_id: input.agent_id,
      skill_id: input.skill_id,
      score: finalScore,
      source_skill_package_id: input.source_skill_package_id ?? null,
    },
    policy_context: {},
    model_context: {},
    display: {},
  });

  return {
    assessment_id,
    status: input.status,
    score: finalScore,
    reliability_score: skill.rows[0]?.reliability_score ?? 0,
    assessment_total: skill.rows[0]?.assessment_total ?? 0,
    assessment_passed: skill.rows[0]?.assessment_passed ?? 0,
  };
}

export async function registerSkillsLedgerRoutes(app: FastifyInstance, pool: ApiDbPool): Promise<void> {
  app.get<{
    Querystring: { limit?: string };
  }>("/v1/skills/catalog", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const limit = parseLimit(req.query.limit);
    const rows = await pool.query<SkillCatalogRow>(
      `SELECT
         workspace_id, skill_id, name, description, skill_type, risk_class,
         assessment_suite, required_manifest_caps, created_at, updated_at
       FROM sec_skill_catalog
       WHERE workspace_id = $1
       ORDER BY updated_at DESC
       LIMIT $2`,
      [workspace_id, limit],
    );
    return reply.code(200).send({ skills: rows.rows });
  });

  app.post<{
    Body: {
      skill_id: string;
      name?: string;
      description?: string;
      skill_type?: SkillType;
      risk_class?: SkillRiskClass;
      assessment_suite?: Record<string, unknown>;
      required_manifest_caps?: Record<string, unknown>;
    };
  }>("/v1/skills/catalog", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const skill_id = normalizeRequiredString(req.body.skill_id);
    if (!skill_id) return reply.code(400).send({ error: "invalid_skill_id" });

    const nowIso = new Date().toISOString();
    await ensureCatalogSkill(pool, {
      workspace_id,
      skill_id,
      name: normalizeOptionalString(req.body.name),
      description: normalizeOptionalString(req.body.description),
      skill_type: normalizeSkillType(req.body.skill_type),
      risk_class: normalizeRiskClass(req.body.risk_class),
      assessment_suite: req.body.assessment_suite ?? {},
      required_manifest_caps: req.body.required_manifest_caps ?? {},
      nowIso,
    });

    const row = await pool.query<SkillCatalogRow>(
      `SELECT
         workspace_id, skill_id, name, description, skill_type, risk_class,
         assessment_suite, required_manifest_caps, created_at, updated_at
       FROM sec_skill_catalog
       WHERE workspace_id = $1
         AND skill_id = $2`,
      [workspace_id, skill_id],
    );

    return reply.code(201).send({ skill: row.rows[0] });
  });

  app.get<{
    Params: { agentId: string };
    Querystring: { limit?: string };
  }>("/v1/agents/:agentId/skills", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const agent_id = normalizeRequiredString(req.params.agentId);
    if (!agent_id) return reply.code(400).send({ error: "invalid_agent_id" });
    const agent = await getAgent(pool, agent_id);
    if (!agent) return reply.code(404).send({ error: "agent_not_found" });

    const limit = parseLimit(req.query.limit);
    const rows = await pool.query<AgentSkillRow>(
      `SELECT
         workspace_id, agent_id, skill_id,
         level, learned_at, last_used_at,
         usage_total, usage_7d, usage_30d,
         assessment_total, assessment_passed,
         reliability_score, impact_score, is_primary,
         source_skill_package_id,
         created_at, updated_at
       FROM sec_agent_skills
       WHERE workspace_id = $1
         AND agent_id = $2
       ORDER BY is_primary DESC, usage_total DESC, reliability_score DESC, updated_at DESC
       LIMIT $3`,
      [workspace_id, agent.agent_id, limit],
    );
    return reply.code(200).send({ skills: rows.rows });
  });

  app.get<{
    Params: { agentId: string };
    Querystring: { limit?: string; skill_id?: string; status?: string };
  }>("/v1/agents/:agentId/skills/assessments", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const agent_id = normalizeRequiredString(req.params.agentId);
    if (!agent_id) return reply.code(400).send({ error: "invalid_agent_id" });
    const agent = await getAgent(pool, agent_id);
    if (!agent) return reply.code(404).send({ error: "agent_not_found" });

    const skill_id = normalizeOptionalString(req.query.skill_id) ?? null;
    const statusRaw = normalizeOptionalString(req.query.status);
    if (statusRaw && statusRaw !== "started" && statusRaw !== "passed" && statusRaw !== "failed") {
      return reply.code(400).send({ error: "invalid_status" });
    }
    const status = (statusRaw ?? null) as SkillAssessmentStatus | null;
    const limit = parseLimit(req.query.limit);

    const rows = await pool.query<SkillAssessmentRow>(
      `SELECT
         assessment_id,
         workspace_id,
         agent_id,
         skill_id,
         status,
         trigger_reason,
         suite,
         results,
         score,
         run_id,
         started_at,
         ended_at,
         created_by_type,
         created_by_id,
         created_by_principal_id,
         created_at,
         updated_at
       FROM sec_skill_assessments
       WHERE workspace_id = $1
         AND agent_id = $2
         AND ($3::text IS NULL OR skill_id = $3)
         AND ($4::text IS NULL OR status = $4)
       ORDER BY started_at DESC, assessment_id DESC
       LIMIT $5`,
      [workspace_id, agent.agent_id, skill_id, status, limit],
    );
    return reply.code(200).send({ assessments: rows.rows });
  });

  app.post<{
    Params: { agentId: string };
    Body: {
      skill_id: string;
      level?: number;
      source_skill_package_id?: string;
      reliability_score?: number;
      impact_score?: number;
      set_primary?: boolean;
      actor_type?: ActorType;
      actor_id?: string;
      actor_principal_id?: string;
      correlation_id?: string;
    };
  }>("/v1/agents/:agentId/skills/learn", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const agent_id = normalizeRequiredString(req.params.agentId);
    if (!agent_id) return reply.code(400).send({ error: "invalid_agent_id" });
    const skill_id = normalizeRequiredString(req.body.skill_id);
    if (!skill_id) return reply.code(400).send({ error: "invalid_skill_id" });

    const agent = await getAgent(pool, agent_id);
    if (!agent) return reply.code(404).send({ error: "agent_not_found" });

    const actor_type = normalizeActorType(req.body.actor_type);
    const actor_id =
      normalizeOptionalString(req.body.actor_id) || (actor_type === "service" ? "api" : "anon");
    const actor_principal_id = normalizeOptionalString(req.body.actor_principal_id);
    const correlation_id = normalizeOptionalString(req.body.correlation_id) ?? randomUUID();

    const nowIso = new Date().toISOString();
    await ensureCatalogSkill(pool, {
      workspace_id,
      skill_id,
      name: skill_id,
      skill_type: "workflow",
      risk_class: "low",
      nowIso,
    });

    const learned = await upsertAgentSkillLearn(pool, {
      workspace_id,
      agent_id,
      skill_id,
      level: normalizeLevel(req.body.level, 1),
      source_skill_package_id: normalizeOptionalString(req.body.source_skill_package_id),
      reliability_score:
        req.body.reliability_score == null ? undefined : normalizeScore01(req.body.reliability_score, 0),
      impact_score: req.body.impact_score == null ? undefined : Number(req.body.impact_score),
      nowIso,
    });

    if (learned.inserted || learned.levelIncreased) {
      await appendToStream(pool, {
        event_id: randomUUID(),
        event_type: "agent.skill.learned",
        event_version: 1,
        occurred_at: nowIso,
        workspace_id,
        actor: { actor_type, actor_id },
        actor_principal_id,
        stream: { stream_type: "workspace", stream_id: workspace_id },
        correlation_id,
        data: {
          agent_id,
          skill_id,
          level: learned.row.level,
        },
        policy_context: {},
        model_context: {},
        display: {},
      });
    }

    const shouldSetPrimary = req.body.set_primary === true;
    if (shouldSetPrimary) {
      const changed = await setPrimarySkill(pool, workspace_id, agent_id, skill_id, nowIso);
      if (changed) {
        await appendToStream(pool, {
          event_id: randomUUID(),
          event_type: "agent.skill.primary_set",
          event_version: 1,
          occurred_at: nowIso,
          workspace_id,
          actor: { actor_type, actor_id },
          actor_principal_id,
          stream: { stream_type: "workspace", stream_id: workspace_id },
          correlation_id,
          data: {
            agent_id,
            skill_id,
          },
          policy_context: {},
          model_context: {},
          display: {},
        });
      }
    }

    const refreshed = await pool.query<AgentSkillRow>(
      `SELECT
         workspace_id, agent_id, skill_id,
         level, learned_at, last_used_at,
         usage_total, usage_7d, usage_30d,
         assessment_total, assessment_passed,
         reliability_score, impact_score, is_primary,
         source_skill_package_id,
         created_at, updated_at
       FROM sec_agent_skills
       WHERE workspace_id = $1
         AND agent_id = $2
         AND skill_id = $3`,
      [workspace_id, agent_id, skill_id],
    );
    return reply.code(201).send({ skill: refreshed.rows[0] });
  });

  app.post<{
    Params: { agentId: string; skillId: string };
    Body: {
      status: "passed" | "failed";
      suite?: Record<string, unknown>;
      results?: Record<string, unknown>;
      score?: number;
      run_id?: string;
      trigger_reason?: string;
      actor_type?: ActorType;
      actor_id?: string;
      actor_principal_id?: string;
      correlation_id?: string;
    };
  }>("/v1/agents/:agentId/skills/:skillId/assess", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const agent_id = normalizeRequiredString(req.params.agentId);
    const skill_id = normalizeRequiredString(req.params.skillId);
    if (!agent_id) return reply.code(400).send({ error: "invalid_agent_id" });
    if (!skill_id) return reply.code(400).send({ error: "invalid_skill_id" });
    if (req.body.status !== "passed" && req.body.status !== "failed") {
      return reply.code(400).send({ error: "invalid_status" });
    }

    const agent = await getAgent(pool, agent_id);
    if (!agent) return reply.code(404).send({ error: "agent_not_found" });

    const actor_type = normalizeActorType(req.body.actor_type);
    const actor_id =
      normalizeOptionalString(req.body.actor_id) || (actor_type === "service" ? "api" : "anon");
    const actor_principal_id = normalizeOptionalString(req.body.actor_principal_id);
    const correlation_id = normalizeOptionalString(req.body.correlation_id) ?? randomUUID();

    const assessed = await createSkillAssessment(pool, {
      workspace_id,
      agent_id,
      skill_id,
      status: req.body.status,
      suite: req.body.suite ?? {},
      results: req.body.results ?? {},
      score: req.body.score,
      run_id: req.body.run_id,
      trigger_reason: req.body.trigger_reason,
      actor_type,
      actor_id,
      actor_principal_id,
      correlation_id,
    });

    return reply.code(201).send(assessed);
  });

  app.post<{
    Params: { agentId: string };
    Body: {
      limit?: number;
      only_unassessed?: boolean;
      actor_type?: ActorType;
      actor_id?: string;
      actor_principal_id?: string;
      correlation_id?: string;
    };
  }>("/v1/agents/:agentId/skills/assess-imported", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const agent_id = normalizeRequiredString(req.params.agentId);
    if (!agent_id) return reply.code(400).send({ error: "invalid_agent_id" });

    const agent = await getAgent(pool, agent_id);
    if (!agent) return reply.code(404).send({ error: "agent_not_found" });

    const actor_type = normalizeActorType(req.body.actor_type);
    const actor_id =
      normalizeOptionalString(req.body.actor_id) || (actor_type === "service" ? "api" : "anon");
    const actor_principal_id = normalizeOptionalString(req.body.actor_principal_id);
    const correlation_id = normalizeOptionalString(req.body.correlation_id) ?? randomUUID();
    const onlyUnassessed = req.body.only_unassessed !== false;
    const limit = parseLimit(req.body.limit);

    const candidates = await pool.query<{
      skill_id: string;
      skill_package_id: string;
    }>(
      `SELECT DISTINCT ON (sp.skill_id)
         sp.skill_id,
         asp.skill_package_id
       FROM sec_agent_skill_packages asp
       JOIN sec_skill_packages sp
         ON sp.skill_package_id = asp.skill_package_id
       WHERE sp.workspace_id = $1
         AND asp.agent_id = $2
         AND asp.verification_status = 'verified'
       ORDER BY sp.skill_id ASC, asp.updated_at DESC, asp.skill_package_id DESC
       LIMIT $3`,
      [workspace_id, agent.agent_id, limit],
    );

    const skillIds = candidates.rows.map((row) => row.skill_id);
    const existingMap = new Map<string, number>();
    if (skillIds.length) {
      const existing = await pool.query<{ skill_id: string; assessment_total: number }>(
        `SELECT skill_id, assessment_total
         FROM sec_agent_skills
         WHERE workspace_id = $1
           AND agent_id = $2
           AND skill_id = ANY($3::text[])`,
        [workspace_id, agent.agent_id, skillIds],
      );
      for (const row of existing.rows) existingMap.set(row.skill_id, row.assessment_total);
    }

    const items: Array<{
      skill_id: string;
      skill_package_id: string;
      status: "passed";
      assessment_id?: string;
      skipped_reason?: "already_assessed";
    }> = [];
    let assessed = 0;
    let skipped = 0;

    for (const row of candidates.rows) {
      const already = (existingMap.get(row.skill_id) ?? 0) > 0;
      if (onlyUnassessed && already) {
        skipped += 1;
        items.push({
          skill_id: row.skill_id,
          skill_package_id: row.skill_package_id,
          status: "passed",
          skipped_reason: "already_assessed",
        });
        continue;
      }

      const res = await createSkillAssessment(pool, {
        workspace_id,
        agent_id: agent.agent_id,
        skill_id: row.skill_id,
        status: "passed",
        suite: {
          source: "onboarding_import",
          verification_status: "verified",
        },
        results: {
          source_skill_package_id: row.skill_package_id,
          auto_assessed: true,
        },
        score: 1,
        trigger_reason: "onboarding_import_verification",
        source_skill_package_id: row.skill_package_id,
        actor_type,
        actor_id,
        actor_principal_id,
        correlation_id,
      });
      assessed += 1;
      items.push({
        skill_id: row.skill_id,
        skill_package_id: row.skill_package_id,
        status: "passed",
        assessment_id: res.assessment_id,
      });
    }

    return reply.code(200).send({
      summary: {
        total_candidates: candidates.rowCount,
        assessed,
        skipped,
      },
      items,
    });
  });
}
