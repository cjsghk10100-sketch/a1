import { randomUUID } from "node:crypto";

import {
  type ApprovalEventV1,
  type IncidentEventV1,
  newApprovalId,
  newIncidentId,
  type ActorType,
  type CapabilityScopesV1,
  type PromotionDecisionV1,
  type ScorecardId,
} from "@agentapp/shared";

import type { DbPool } from "../db/pool.js";
import { appendToStream } from "../eventStore/index.js";
import { applyApprovalEvent } from "../projectors/approvalProjector.js";
import { applyIncidentEvent } from "../projectors/incidentProjector.js";

const PROMOTION_WINDOW_DAYS = 7;
const PASS_THRESHOLD = 3;
const FAIL_THRESHOLD = 3;
const SEVERE_FAIL_THRESHOLD = 5;
const QUARANTINE_FAIL_THRESHOLD = 6;
const PASS_FAIL_RATIO_MAX = 0.34;

type ScorecardContextRow = {
  scorecard_id: string;
  agent_id: string | null;
  run_id: string | null;
  correlation_id: string;
};

type RunContextRow = {
  room_id: string | null;
  thread_id: string | null;
};

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) return fallback;
  const value = raw.trim().toLowerCase();
  if (value === "1" || value === "true" || value === "yes" || value === "on") return true;
  if (value === "0" || value === "false" || value === "no" || value === "off") return false;
  return fallback;
}

function isPromotionLoopEnabled(): boolean {
  return parseBoolean(process.env.PROMOTION_LOOP_ENABLED, false);
}

async function appendPromotionEvaluated(
  pool: DbPool,
  input: {
    workspace_id: string;
    scorecard_id: string;
    correlation_id: string;
    actor: { actor_type: ActorType; actor_id: string };
    actor_principal_id?: string;
    agent_id?: string;
    pass_count: number;
    warn_count: number;
    fail_count: number;
    fail_ratio: number;
    decision: PromotionDecisionV1;
    reason?: string;
    recommendation_id?: string;
    incident_id?: string;
    approval_id?: string;
  },
): Promise<void> {
  await appendToStream(pool, {
    event_id: randomUUID(),
    event_type: "promotion.evaluated",
    event_version: 1,
    occurred_at: new Date().toISOString(),
    workspace_id: input.workspace_id,
    actor: input.actor,
    actor_principal_id: input.actor_principal_id,
    stream: { stream_type: "workspace", stream_id: input.workspace_id },
    correlation_id: input.correlation_id,
    idempotency_key: `promotion_eval:${input.scorecard_id}`,
    data: {
      scorecard_id: input.scorecard_id,
      agent_id: input.agent_id,
      window_days: PROMOTION_WINDOW_DAYS,
      pass_count: input.pass_count,
      warn_count: input.warn_count,
      fail_count: input.fail_count,
      fail_ratio: input.fail_ratio,
      decision: input.decision,
      reason: input.reason,
      recommendation_id: input.recommendation_id,
      incident_id: input.incident_id,
      approval_id: input.approval_id,
    },
    policy_context: {},
    model_context: {},
    display: {},
  });
}

async function ensureLoopIncident(
  pool: DbPool,
  input: {
    workspace_id: string;
    agent_id: string;
    run_id: string | null;
    room_id: string | null;
    thread_id: string | null;
    correlation_id: string;
    actor: { actor_type: ActorType; actor_id: string };
  },
): Promise<{ incident_id: string; created: boolean }> {
  const title = `Promotion Loop: ${input.agent_id}`;
  const existing = await pool.query<{ incident_id: string }>(
    `SELECT incident_id
     FROM proj_incidents
     WHERE workspace_id = $1
       AND status = 'open'
       AND title = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [input.workspace_id, title],
  );
  if (existing.rowCount === 1) {
    return { incident_id: existing.rows[0].incident_id, created: false };
  }

  const incident_id = newIncidentId();
  const occurred_at = new Date().toISOString();
  const event = await appendToStream(pool, {
    event_id: randomUUID(),
    event_type: "incident.opened",
    event_version: 1,
    occurred_at,
    workspace_id: input.workspace_id,
    room_id: input.room_id ?? undefined,
    thread_id: input.thread_id ?? undefined,
    run_id: input.run_id ?? undefined,
    actor: input.actor,
    stream: input.room_id
      ? { stream_type: "room", stream_id: input.room_id }
      : { stream_type: "workspace", stream_id: input.workspace_id },
    correlation_id: input.correlation_id,
    data: {
      incident_id,
      title,
      summary: "Scorecard fail threshold reached in promotion loop.",
      severity: "high",
      run_id: input.run_id ?? undefined,
    },
    policy_context: {},
    model_context: {},
    display: {},
  });
  await applyIncidentEvent(pool, event as IncidentEventV1);
  return { incident_id, created: true };
}

async function ensureRevokeApproval(
  pool: DbPool,
  input: {
    workspace_id: string;
    agent_id: string;
    run_id: string | null;
    room_id: string | null;
    thread_id: string | null;
    correlation_id: string;
    actor: { actor_type: ActorType; actor_id: string };
  },
): Promise<{ approval_id: string; created: boolean }> {
  const existing = await pool.query<{ approval_id: string }>(
    `SELECT approval_id
     FROM proj_approvals
     WHERE workspace_id = $1
       AND action = 'capability.revoke'
       AND status IN ('pending', 'held')
       AND context->>'agent_id' = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [input.workspace_id, input.agent_id],
  );
  if (existing.rowCount === 1) {
    return { approval_id: existing.rows[0].approval_id, created: false };
  }

  const approval_id = newApprovalId();
  const occurred_at = new Date().toISOString();
  const event = await appendToStream(pool, {
    event_id: randomUUID(),
    event_type: "approval.requested",
    event_version: 1,
    occurred_at,
    workspace_id: input.workspace_id,
    room_id: input.room_id ?? undefined,
    thread_id: input.thread_id ?? undefined,
    run_id: input.run_id ?? undefined,
    actor: input.actor,
    stream: input.room_id
      ? { stream_type: "room", stream_id: input.room_id }
      : { stream_type: "workspace", stream_id: input.workspace_id },
    correlation_id: input.correlation_id,
    data: {
      approval_id,
      action: "capability.revoke",
      title: `Revoke capabilities for ${input.agent_id}`,
      request: {
        purpose: "Promotion loop severe repeated failures",
        recommended_decision: "approve",
        risks: ["sustained_failures", "policy_drift"],
      },
      context: {
        agent_id: input.agent_id,
        source: "promotion_loop",
      },
      scope: {
        type: "workspace",
        workspace_id: input.workspace_id,
      },
    },
    policy_context: {},
    model_context: {},
    display: {},
  });
  await applyApprovalEvent(pool, event as ApprovalEventV1);
  return { approval_id, created: true };
}

async function ensurePendingRecommendation(
  pool: DbPool,
  input: {
    workspace_id: string;
    agent_id: string;
    correlation_id: string;
    actor: { actor_type: ActorType; actor_id: string };
    actor_principal_id?: string;
    pass_count: number;
    fail_count: number;
  },
): Promise<{ recommendation_id: string; created: boolean }> {
  const existing = await pool.query<{ recommendation_id: string }>(
    `SELECT recommendation_id
     FROM sec_autonomy_recommendations
     WHERE workspace_id = $1
       AND agent_id = $2
       AND status = 'pending'
     LIMIT 1`,
    [input.workspace_id, input.agent_id],
  );
  if (existing.rowCount === 1) {
    return { recommendation_id: existing.rows[0].recommendation_id, created: false };
  }

  const trust = await pool.query<{ trust_score: number }>(
    `SELECT trust_score
     FROM sec_agent_trust
     WHERE workspace_id = $1
       AND agent_id = $2`,
    [input.workspace_id, input.agent_id],
  );
  const trust_score = trust.rowCount === 1 ? Number(trust.rows[0].trust_score) : 0.5;

  const recommendation_id = `arec_${randomUUID().replaceAll("-", "")}`;
  const now = new Date().toISOString();
  const scope_delta: CapabilityScopesV1 = {
    action_types: ["artifact.create"],
    data_access: { write: ["artifacts"] },
  };

  await pool.query(
    `INSERT INTO sec_autonomy_recommendations (
       recommendation_id,
       workspace_id,
       agent_id,
       status,
       scope_delta,
       rationale,
       trust_score_before,
       trust_score_after,
       trust_components,
       recommended_by_type,
       recommended_by_id,
       recommended_by_principal_id,
       created_at,
       updated_at
     ) VALUES (
       $1,$2,$3,'pending',$4::jsonb,$5,$6,$6,$7::jsonb,$8,$9,$10,$11,$11
     )`,
    [
      recommendation_id,
      input.workspace_id,
      input.agent_id,
      JSON.stringify(scope_delta),
      `Promotion loop PASS threshold met (pass=${input.pass_count}, fail=${input.fail_count})`,
      trust_score,
      JSON.stringify({
        source: "promotion_loop",
        pass_count: input.pass_count,
        fail_count: input.fail_count,
      }),
      input.actor.actor_type,
      input.actor.actor_id,
      input.actor_principal_id ?? null,
      now,
    ],
  );

  await appendToStream(pool, {
    event_id: randomUUID(),
    event_type: "autonomy.upgrade.recommended",
    event_version: 1,
    occurred_at: now,
    workspace_id: input.workspace_id,
    actor: input.actor,
    actor_principal_id: input.actor_principal_id,
    stream: { stream_type: "workspace", stream_id: input.workspace_id },
    correlation_id: input.correlation_id,
    data: {
      recommendation_id,
      agent_id: input.agent_id,
      scope_delta,
      rationale: `Promotion loop PASS threshold met (pass=${input.pass_count}, fail=${input.fail_count})`,
      trust_score_before: trust_score,
      trust_score_after: trust_score,
    },
    policy_context: {},
    model_context: {},
    display: {},
  });

  return { recommendation_id, created: true };
}

async function ensureAgentQuarantine(
  pool: DbPool,
  input: {
    workspace_id: string;
    agent_id: string;
    correlation_id: string;
    actor: { actor_type: ActorType; actor_id: string };
  },
): Promise<{ created: boolean }> {
  const existing = await pool.query<{
    principal_id: string;
    quarantined_at: string | null;
  }>(
    `SELECT principal_id, quarantined_at::text
     FROM sec_agents
     WHERE agent_id = $1`,
    [input.agent_id],
  );
  if (existing.rowCount !== 1) return { created: false };
  if (existing.rows[0].quarantined_at) return { created: false };

  const now = new Date().toISOString();
  await pool.query(
    `UPDATE sec_agents
     SET quarantined_at = $1,
         quarantine_reason = $2
     WHERE agent_id = $3`,
    [now, "promotion_loop_severe_failures", input.agent_id],
  );
  await appendToStream(pool, {
    event_id: randomUUID(),
    event_type: "agent.quarantined",
    event_version: 1,
    occurred_at: now,
    workspace_id: input.workspace_id,
    actor: input.actor,
    stream: { stream_type: "workspace", stream_id: input.workspace_id },
    correlation_id: input.correlation_id,
    data: {
      agent_id: input.agent_id,
      principal_id: existing.rows[0].principal_id,
      quarantined_at: now,
      quarantine_reason: "promotion_loop_severe_failures",
    },
    policy_context: {},
    model_context: {},
    display: {},
  });
  return { created: true };
}

export async function evaluatePromotionLoopForScorecard(
  pool: DbPool,
  input: {
    workspace_id: string;
    scorecard_id: ScorecardId;
    actor: { actor_type: ActorType; actor_id: string };
    actor_principal_id?: string;
  },
): Promise<void> {
  if (!isPromotionLoopEnabled()) return;

  const scorecard = await pool.query<ScorecardContextRow>(
    `SELECT scorecard_id, agent_id, run_id, correlation_id
     FROM proj_scorecards
     WHERE workspace_id = $1
       AND scorecard_id = $2`,
    [input.workspace_id, input.scorecard_id],
  );
  if (scorecard.rowCount !== 1) return;
  const row = scorecard.rows[0];

  if (!row.agent_id) {
    await appendPromotionEvaluated(pool, {
      workspace_id: input.workspace_id,
      scorecard_id: row.scorecard_id,
      correlation_id: row.correlation_id,
      actor: input.actor,
      actor_principal_id: input.actor_principal_id,
      pass_count: 0,
      warn_count: 0,
      fail_count: 0,
      fail_ratio: 0,
      decision: "none",
      reason: "missing_agent_id",
    });
    return;
  }

  const counts = await pool.query<{ decision: string; count: string }>(
    `SELECT decision, COUNT(*)::text AS count
     FROM proj_scorecards
     WHERE workspace_id = $1
       AND agent_id = $2
       AND created_at >= now() - interval '${PROMOTION_WINDOW_DAYS} days'
     GROUP BY decision`,
    [input.workspace_id, row.agent_id],
  );
  let pass_count = 0;
  let warn_count = 0;
  let fail_count = 0;
  for (const countRow of counts.rows) {
    const value = Number(countRow.count);
    if (countRow.decision === "pass") pass_count = value;
    else if (countRow.decision === "warn") warn_count = value;
    else if (countRow.decision === "fail") fail_count = value;
  }
  const total = pass_count + warn_count + fail_count;
  const fail_ratio = total > 0 ? fail_count / total : 0;

  let decision: PromotionDecisionV1 = "none";
  let reason = "threshold_not_met";
  let recommendation_id: string | undefined;
  let incident_id: string | undefined;
  let approval_id: string | undefined;

  const runContext = row.run_id
    ? await pool.query<RunContextRow>(
        `SELECT room_id, thread_id
         FROM proj_runs
         WHERE workspace_id = $1
           AND run_id = $2`,
        [input.workspace_id, row.run_id],
      )
    : null;
  const room_id = runContext && runContext.rowCount === 1 ? runContext.rows[0].room_id : null;
  const thread_id = runContext && runContext.rowCount === 1 ? runContext.rows[0].thread_id : null;

  if (fail_count >= FAIL_THRESHOLD) {
    const incident = await ensureLoopIncident(pool, {
      workspace_id: input.workspace_id,
      agent_id: row.agent_id,
      run_id: row.run_id,
      room_id,
      thread_id,
      correlation_id: row.correlation_id,
      actor: input.actor,
    });
    incident_id = incident.incident_id;
    decision = "open_incident";
    reason = "fail_threshold_met";

    if (fail_count >= SEVERE_FAIL_THRESHOLD) {
      const revoke = await ensureRevokeApproval(pool, {
        workspace_id: input.workspace_id,
        agent_id: row.agent_id,
        run_id: row.run_id,
        room_id,
        thread_id,
        correlation_id: row.correlation_id,
        actor: input.actor,
      });
      approval_id = revoke.approval_id;
      decision = "request_revoke";
      reason = revoke.created ? "severe_fail_threshold_met" : "pending_revoke_exists";
    }

    if (fail_count >= QUARANTINE_FAIL_THRESHOLD) {
      const quarantine = await ensureAgentQuarantine(pool, {
        workspace_id: input.workspace_id,
        agent_id: row.agent_id,
        correlation_id: row.correlation_id,
        actor: input.actor,
      });
      if (quarantine.created) {
        decision = "quarantine";
        reason = "quarantine_threshold_met";
      }
    }
  } else if (pass_count >= PASS_THRESHOLD && fail_ratio <= PASS_FAIL_RATIO_MAX) {
    const recommendation = await ensurePendingRecommendation(pool, {
      workspace_id: input.workspace_id,
      agent_id: row.agent_id,
      correlation_id: row.correlation_id,
      actor: input.actor,
      actor_principal_id: input.actor_principal_id,
      pass_count,
      fail_count,
    });
    recommendation_id = recommendation.recommendation_id;
    decision = recommendation.created ? "recommend_upgrade" : "none";
    reason = recommendation.created ? "pass_threshold_met" : "pending_recommendation_exists";
  }

  await appendPromotionEvaluated(pool, {
    workspace_id: input.workspace_id,
    scorecard_id: row.scorecard_id,
    correlation_id: row.correlation_id,
    actor: input.actor,
    actor_principal_id: input.actor_principal_id,
    agent_id: row.agent_id,
    pass_count,
    warn_count,
    fail_count,
    fail_ratio,
    decision,
    reason,
    recommendation_id,
    incident_id,
    approval_id,
  });
}

export async function getPromotionLoopStatus(
  pool: DbPool,
  input: { workspace_id: string; agent_id: string },
): Promise<{
  window_days: number;
  pass_count: number;
  warn_count: number;
  fail_count: number;
  fail_ratio: number;
  pending_recommendation: boolean;
  open_loop_incident: boolean;
  pending_revoke_approval: boolean;
  quarantined: boolean;
  last_decision?: string;
  last_decision_reason?: string;
}> {
  const counts = await pool.query<{ decision: string; count: string }>(
    `SELECT decision, COUNT(*)::text AS count
     FROM proj_scorecards
     WHERE workspace_id = $1
       AND agent_id = $2
       AND created_at >= now() - interval '${PROMOTION_WINDOW_DAYS} days'
     GROUP BY decision`,
    [input.workspace_id, input.agent_id],
  );
  let pass_count = 0;
  let warn_count = 0;
  let fail_count = 0;
  for (const row of counts.rows) {
    const count = Number(row.count);
    if (row.decision === "pass") pass_count = count;
    else if (row.decision === "warn") warn_count = count;
    else if (row.decision === "fail") fail_count = count;
  }
  const total = pass_count + warn_count + fail_count;
  const fail_ratio = total > 0 ? fail_count / total : 0;

  const pendingRecommendation = await pool.query<{ found: string }>(
    `SELECT '1' AS found
     FROM sec_autonomy_recommendations
     WHERE workspace_id = $1
       AND agent_id = $2
       AND status = 'pending'
     LIMIT 1`,
    [input.workspace_id, input.agent_id],
  );
  const openIncident = await pool.query<{ found: string }>(
    `SELECT '1' AS found
     FROM proj_incidents
     WHERE workspace_id = $1
       AND status = 'open'
       AND title = $2
     LIMIT 1`,
    [input.workspace_id, `Promotion Loop: ${input.agent_id}`],
  );
  const pendingRevoke = await pool.query<{ found: string }>(
    `SELECT '1' AS found
     FROM proj_approvals
     WHERE workspace_id = $1
       AND action = 'capability.revoke'
       AND status IN ('pending', 'held')
       AND context->>'agent_id' = $2
     LIMIT 1`,
    [input.workspace_id, input.agent_id],
  );
  const agent = await pool.query<{ quarantined_at: string | null }>(
    `SELECT quarantined_at::text
     FROM sec_agents
     WHERE agent_id = $1`,
    [input.agent_id],
  );

  const lastDecision = await pool.query<{
    decision: string | null;
    reason: string | null;
  }>(
    `SELECT
       data->>'decision' AS decision,
       data->>'reason' AS reason
     FROM evt_events
     WHERE workspace_id = $1
       AND event_type = 'promotion.evaluated'
       AND data->>'agent_id' = $2
     ORDER BY recorded_at DESC
     LIMIT 1`,
    [input.workspace_id, input.agent_id],
  );

  return {
    window_days: PROMOTION_WINDOW_DAYS,
    pass_count,
    warn_count,
    fail_count,
    fail_ratio,
    pending_recommendation: pendingRecommendation.rowCount === 1,
    open_loop_incident: openIncident.rowCount === 1,
    pending_revoke_approval: pendingRevoke.rowCount === 1,
    quarantined: agent.rowCount === 1 && Boolean(agent.rows[0].quarantined_at),
    last_decision: lastDecision.rowCount === 1 ? (lastDecision.rows[0].decision ?? undefined) : undefined,
    last_decision_reason:
      lastDecision.rowCount === 1 ? (lastDecision.rows[0].reason ?? undefined) : undefined,
  };
}
