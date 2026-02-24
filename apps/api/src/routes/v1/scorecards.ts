import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import {
  newLessonId,
  newScorecardId,
  type ActorType,
  type LessonLoggedDataV1,
  type ScoreDecision,
  type ScoreMetricV1,
  type ScorecardEventV1,
} from "@agentapp/shared";

import type { DbPool } from "../../db/pool.js";
import { appendToStream } from "../../eventStore/index.js";
import { applyScorecardEvent } from "../../projectors/scorecardProjector.js";
import { sha256Hex, stableStringify } from "../../security/hashChain.js";

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
  const value = raw.trim();
  return value.length ? value : undefined;
}

function parseLimit(raw: unknown): number {
  const n = Number(raw ?? "50");
  if (!Number.isFinite(n)) return 50;
  return Math.max(1, Math.min(200, Math.floor(n)));
}

function normalizeMetadata(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

function normalizeMetrics(raw: unknown): { metrics: ScoreMetricV1[]; hash: string; score: number; decision: ScoreDecision } | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const seen = new Set<string>();
  const metrics: ScoreMetricV1[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const obj = item as Record<string, unknown>;
    const key = normalizeOptionalString(obj.key);
    if (!key) return null;
    if (seen.has(key)) return null;
    seen.add(key);

    const value = Number(obj.value);
    if (!Number.isFinite(value)) return null;
    const weight = obj.weight == null ? 1 : Number(obj.weight);
    if (!Number.isFinite(weight) || weight <= 0) return null;

    metrics.push({ key, value, weight });
  }

  const sorted = [...metrics].sort((a, b) => a.key.localeCompare(b.key));
  const metrics_hash = `sha256:${sha256Hex(stableStringify(sorted))}`;

  const totalWeight = sorted.reduce((sum, metric) => sum + (metric.weight ?? 1), 0);
  const weighted = sorted.reduce((sum, metric) => sum + metric.value * (metric.weight ?? 1), 0);
  const rawScore = totalWeight > 0 ? weighted / totalWeight : 0;
  const score = Math.max(0, Math.min(1, rawScore));

  let decision: ScoreDecision = "fail";
  if (score >= 0.75) decision = "pass";
  else if (score >= 0.5) decision = "warn";

  return { metrics: sorted, hash: metrics_hash, score, decision };
}

async function ensureRowExists(
  pool: DbPool,
  sql: string,
  params: unknown[],
): Promise<boolean> {
  const res = await pool.query<{ found: string }>(sql, params);
  return res.rowCount === 1;
}

export async function registerScorecardRoutes(app: FastifyInstance, pool: DbPool): Promise<void> {
  app.post<{
    Body: {
      experiment_id?: string;
      run_id?: string;
      evidence_id?: string;
      agent_id?: string;
      principal_id?: string;
      template_key?: string;
      template_version?: string;
      metrics?: ScoreMetricV1[];
      rationale?: string;
      metadata?: Record<string, unknown>;
      requires_evidence?: boolean;
      correlation_id?: string;
      actor_type?: ActorType;
      actor_id?: string;
    };
  }>("/v1/scorecards", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const experiment_id = normalizeOptionalString(req.body.experiment_id);
    const run_id = normalizeOptionalString(req.body.run_id);
    const evidence_id = normalizeOptionalString(req.body.evidence_id);
    const agent_id = normalizeOptionalString(req.body.agent_id);
    const principal_id = normalizeOptionalString(req.body.principal_id);
    const template_key = normalizeOptionalString(req.body.template_key);
    const template_version = normalizeOptionalString(req.body.template_version);
    if (!template_key) return reply.code(400).send({ error: "missing_template_key" });
    if (!template_version) return reply.code(400).send({ error: "missing_template_version" });

    const metrics = normalizeMetrics(req.body.metrics);
    if (!metrics) return reply.code(400).send({ error: "invalid_metrics" });

    const metadata = normalizeMetadata(req.body.metadata);
    const requiresEvidence = req.body.requires_evidence === true;
    if (requiresEvidence && !evidence_id) {
      const justification = metadata.justification;
      if (typeof justification !== "string" || !justification.trim().length) {
        return reply.code(400).send({ error: "missing_evidence_for_template" });
      }
    }

    if (experiment_id) {
      const ok = await ensureRowExists(
        pool,
        `SELECT '1' AS found
         FROM proj_experiments
         WHERE workspace_id = $1
           AND experiment_id = $2`,
        [workspace_id, experiment_id],
      );
      if (!ok) return reply.code(404).send({ error: "experiment_not_found" });
    }

    if (run_id) {
      const ok = await ensureRowExists(
        pool,
        `SELECT '1' AS found
         FROM proj_runs
         WHERE workspace_id = $1
           AND run_id = $2`,
        [workspace_id, run_id],
      );
      if (!ok) return reply.code(404).send({ error: "run_not_found" });
    }

    if (evidence_id) {
      const ok = await ensureRowExists(
        pool,
        `SELECT '1' AS found
         FROM proj_evidence_manifests
         WHERE workspace_id = $1
           AND evidence_id = $2`,
        [workspace_id, evidence_id],
      );
      if (!ok) return reply.code(404).send({ error: "evidence_not_found" });
    }

    if (agent_id) {
      const ok = await ensureRowExists(
        pool,
        `SELECT '1' AS found
         FROM sec_agents
         WHERE agent_id = $1`,
        [agent_id],
      );
      if (!ok) return reply.code(404).send({ error: "agent_not_found" });
    }

    if (principal_id) {
      const ok = await ensureRowExists(
        pool,
        `SELECT '1' AS found
         FROM sec_principals
         WHERE principal_id = $1`,
        [principal_id],
      );
      if (!ok) return reply.code(404).send({ error: "principal_not_found" });
    }

    const scorecard_id = newScorecardId();
    const actor_type = normalizeActorType(req.body.actor_type);
    const actor_id =
      normalizeOptionalString(req.body.actor_id) ?? (actor_type === "service" ? "api" : "ceo");
    const occurred_at = new Date().toISOString();
    const correlation_id = normalizeOptionalString(req.body.correlation_id) ?? randomUUID();

    const event = await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "scorecard.recorded",
      event_version: 1,
      occurred_at,
      workspace_id,
      run_id: run_id ?? undefined,
      actor: { actor_type, actor_id },
      stream: { stream_type: "workspace", stream_id: workspace_id },
      correlation_id,
      data: {
        scorecard_id,
        experiment_id,
        run_id,
        evidence_id,
        agent_id,
        principal_id,
        template_key,
        template_version,
        metrics: metrics.metrics,
        metrics_hash: metrics.hash,
        score: metrics.score,
        decision: metrics.decision,
        rationale: normalizeOptionalString(req.body.rationale),
        metadata,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });
    await applyScorecardEvent(pool, event as ScorecardEventV1);
    return reply.code(201).send({ scorecard_id });
  });

  app.get<{
    Querystring: { experiment_id?: string; run_id?: string; agent_id?: string; limit?: string };
  }>("/v1/scorecards", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const experiment_id = normalizeOptionalString(req.query.experiment_id) ?? null;
    const run_id = normalizeOptionalString(req.query.run_id) ?? null;
    const agent_id = normalizeOptionalString(req.query.agent_id) ?? null;
    const limit = parseLimit(req.query.limit);

    const args: unknown[] = [workspace_id];
    let where = "workspace_id = $1";
    if (experiment_id) {
      args.push(experiment_id);
      where += ` AND experiment_id = $${args.length}`;
    }
    if (run_id) {
      args.push(run_id);
      where += ` AND run_id = $${args.length}`;
    }
    if (agent_id) {
      args.push(agent_id);
      where += ` AND agent_id = $${args.length}`;
    }
    args.push(limit);

    const rows = await pool.query(
      `SELECT
         scorecard_id,
         workspace_id,
         experiment_id,
         run_id,
         evidence_id,
         agent_id,
         principal_id,
         template_key,
         template_version,
         metrics,
         metrics_hash,
         score,
         decision,
         rationale,
         metadata,
         created_by_type,
         created_by_id,
         created_at,
         updated_at,
         correlation_id,
         last_event_id
       FROM proj_scorecards
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${args.length}`,
      args,
    );
    return reply.code(200).send({ scorecards: rows.rows });
  });

  app.get<{
    Params: { scorecardId: string };
  }>("/v1/scorecards/:scorecardId", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const scorecard = await pool.query(
      `SELECT
         scorecard_id,
         workspace_id,
         experiment_id,
         run_id,
         evidence_id,
         agent_id,
         principal_id,
         template_key,
         template_version,
         metrics,
         metrics_hash,
         score,
         decision,
         rationale,
         metadata,
         created_by_type,
         created_by_id,
         created_at,
         updated_at,
         correlation_id,
         last_event_id
       FROM proj_scorecards
       WHERE workspace_id = $1
         AND scorecard_id = $2`,
      [workspace_id, req.params.scorecardId],
    );
    if (scorecard.rowCount !== 1) return reply.code(404).send({ error: "scorecard_not_found" });
    return reply.code(200).send({ scorecard: scorecard.rows[0] });
  });

  app.post<{
    Body: {
      experiment_id?: string;
      run_id?: string;
      scorecard_id?: string;
      incident_id?: string;
      category?: string;
      summary?: string;
      action_items?: string[];
      tags?: string[];
      metadata?: Record<string, unknown>;
      correlation_id?: string;
      actor_type?: ActorType;
      actor_id?: string;
    };
  }>("/v1/lessons", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const experiment_id = normalizeOptionalString(req.body.experiment_id);
    const run_id = normalizeOptionalString(req.body.run_id);
    const scorecard_id = normalizeOptionalString(req.body.scorecard_id);
    const incident_id = normalizeOptionalString(req.body.incident_id);
    const category = normalizeOptionalString(req.body.category);
    const summary = normalizeOptionalString(req.body.summary);
    if (!category) return reply.code(400).send({ error: "missing_category" });
    if (!summary) return reply.code(400).send({ error: "missing_summary" });

    if (!experiment_id && !run_id && !scorecard_id && !incident_id) {
      return reply.code(400).send({ error: "lesson_context_required" });
    }

    const action_items = Array.isArray(req.body.action_items)
      ? req.body.action_items.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    const tags = Array.isArray(req.body.tags)
      ? req.body.tags.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];

    if (experiment_id) {
      const ok = await ensureRowExists(
        pool,
        `SELECT '1' AS found FROM proj_experiments WHERE workspace_id = $1 AND experiment_id = $2`,
        [workspace_id, experiment_id],
      );
      if (!ok) return reply.code(404).send({ error: "experiment_not_found" });
    }
    if (run_id) {
      const ok = await ensureRowExists(
        pool,
        `SELECT '1' AS found FROM proj_runs WHERE workspace_id = $1 AND run_id = $2`,
        [workspace_id, run_id],
      );
      if (!ok) return reply.code(404).send({ error: "run_not_found" });
    }
    if (scorecard_id) {
      const ok = await ensureRowExists(
        pool,
        `SELECT '1' AS found FROM proj_scorecards WHERE workspace_id = $1 AND scorecard_id = $2`,
        [workspace_id, scorecard_id],
      );
      if (!ok) return reply.code(404).send({ error: "scorecard_not_found" });
    }
    if (incident_id) {
      const ok = await ensureRowExists(
        pool,
        `SELECT '1' AS found FROM proj_incidents WHERE workspace_id = $1 AND incident_id = $2`,
        [workspace_id, incident_id],
      );
      if (!ok) return reply.code(404).send({ error: "incident_not_found" });
    }

    const lesson_id = newLessonId();
    const actor_type = normalizeActorType(req.body.actor_type);
    const actor_id =
      normalizeOptionalString(req.body.actor_id) ?? (actor_type === "service" ? "api" : "ceo");
    const occurred_at = new Date().toISOString();
    const correlation_id = normalizeOptionalString(req.body.correlation_id) ?? randomUUID();
    const data: LessonLoggedDataV1 = {
      lesson_id,
      experiment_id: experiment_id as LessonLoggedDataV1["experiment_id"],
      run_id: run_id as LessonLoggedDataV1["run_id"],
      scorecard_id: scorecard_id as LessonLoggedDataV1["scorecard_id"],
      incident_id: incident_id as LessonLoggedDataV1["incident_id"],
      category,
      summary,
      action_items,
      tags,
      metadata: normalizeMetadata(req.body.metadata),
    };

    const event = await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "lesson.logged",
      event_version: 1,
      occurred_at,
      workspace_id,
      run_id: run_id ?? undefined,
      actor: { actor_type, actor_id },
      stream: { stream_type: "workspace", stream_id: workspace_id },
      correlation_id,
      data,
      policy_context: {},
      model_context: {},
      display: {},
    });
    await applyScorecardEvent(pool, event as ScorecardEventV1);
    return reply.code(201).send({ lesson_id });
  });

  app.get<{
    Querystring: { experiment_id?: string; run_id?: string; scorecard_id?: string; incident_id?: string; limit?: string };
  }>("/v1/lessons", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const experiment_id = normalizeOptionalString(req.query.experiment_id) ?? null;
    const run_id = normalizeOptionalString(req.query.run_id) ?? null;
    const scorecard_id = normalizeOptionalString(req.query.scorecard_id) ?? null;
    const incident_id = normalizeOptionalString(req.query.incident_id) ?? null;
    const limit = parseLimit(req.query.limit);

    const args: unknown[] = [workspace_id];
    let where = "workspace_id = $1";
    if (experiment_id) {
      args.push(experiment_id);
      where += ` AND experiment_id = $${args.length}`;
    }
    if (run_id) {
      args.push(run_id);
      where += ` AND run_id = $${args.length}`;
    }
    if (scorecard_id) {
      args.push(scorecard_id);
      where += ` AND scorecard_id = $${args.length}`;
    }
    if (incident_id) {
      args.push(incident_id);
      where += ` AND incident_id = $${args.length}`;
    }
    args.push(limit);

    const rows = await pool.query(
      `SELECT
         lesson_id,
         workspace_id,
         experiment_id,
         run_id,
         scorecard_id,
         incident_id,
         category,
         summary,
         action_items,
         tags,
         metadata,
         created_by_type,
         created_by_id,
         created_at,
         updated_at,
         correlation_id,
         last_event_id
       FROM proj_lessons
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${args.length}`,
      args,
    );
    return reply.code(200).send({ lessons: rows.rows });
  });

}
