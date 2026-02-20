import { randomUUID } from "node:crypto";

import {
  SurvivalLedgerTargetType,
  type SurvivalLedgerRecordV1,
} from "@agentapp/shared";

import type { DbPool } from "../db/pool.js";
import { appendToStream } from "../eventStore/index.js";

const DAY_MS = 24 * 60 * 60 * 1000;

type AgentRow = {
  agent_id: string;
  principal_id: string;
};

type EventMetricRow = {
  run_succeeded: number;
  run_failed: number;
  incidents_opened: number;
  incidents_closed: number;
  constraints_learned: number;
  repeated_mistakes: number;
  skill_learned: number;
  skill_used: number;
  policy_denied: number;
  egress_allowed: number;
  egress_blocked: number;
};

type EgressMetricRow = {
  requests_total: number;
  requests_blocked: number;
};

type SurvivalCoreMetrics = {
  success_count: number;
  failure_count: number;
  incident_opened_count: number;
  incident_closed_count: number;
  learning_count: number;
  repeated_mistakes_count: number;
  egress_requests_count: number;
  blocked_requests_count: number;
  estimated_cost_units: number;
  value_units: number;
  budget_cap_units: number;
  budget_utilization: number;
  survival_score: number;
  extras: Record<string, unknown>;
};

export interface RunDailySurvivalRollupOptions {
  workspace_id?: string;
  snapshot_date?: string; // YYYY-MM-DD (UTC)
}

export interface RunDailySurvivalRollupResult {
  workspace_id: string;
  snapshot_date: string;
  scanned_targets: number;
  written_rows: number;
  unchanged_rows: number;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function clampNonNegative(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v;
}

function toIsoDate(input: string | undefined): string {
  if (input && /^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  const now = new Date();
  const utc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(utc).toISOString().slice(0, 10);
}

function nextIsoDate(date: string): string {
  const t = Date.parse(`${date}T00:00:00.000Z`);
  return new Date(t + DAY_MS).toISOString().slice(0, 10);
}

async function loadWorkspaceEventMetrics(
  pool: DbPool,
  workspace_id: string,
  range_start: string,
  range_end: string,
): Promise<EventMetricRow> {
  const res = await pool.query<{
    run_succeeded: string;
    run_failed: string;
    incidents_opened: string;
    incidents_closed: string;
    constraints_learned: string;
    repeated_mistakes: string;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE event_type = 'run.completed')::text AS run_succeeded,
       COUNT(*) FILTER (WHERE event_type = 'run.failed')::text AS run_failed,
       COUNT(*) FILTER (WHERE event_type = 'incident.opened')::text AS incidents_opened,
       COUNT(*) FILTER (WHERE event_type = 'incident.closed')::text AS incidents_closed,
       COUNT(*) FILTER (WHERE event_type = 'constraint.learned')::text AS constraints_learned,
       COUNT(*) FILTER (WHERE event_type = 'mistake.repeated')::text AS repeated_mistakes
     FROM evt_events
     WHERE workspace_id = $1
       AND occurred_at >= ($2::timestamptz)
       AND occurred_at < ($3::timestamptz)
       AND event_type = ANY($4::text[])`,
    [
      workspace_id,
      range_start,
      range_end,
      [
        "run.completed",
        "run.failed",
        "incident.opened",
        "incident.closed",
        "constraint.learned",
        "mistake.repeated",
      ],
    ],
  );

  return {
    run_succeeded: Number.parseInt(res.rows[0]?.run_succeeded ?? "0", 10),
    run_failed: Number.parseInt(res.rows[0]?.run_failed ?? "0", 10),
    incidents_opened: Number.parseInt(res.rows[0]?.incidents_opened ?? "0", 10),
    incidents_closed: Number.parseInt(res.rows[0]?.incidents_closed ?? "0", 10),
    constraints_learned: Number.parseInt(res.rows[0]?.constraints_learned ?? "0", 10),
    repeated_mistakes: Number.parseInt(res.rows[0]?.repeated_mistakes ?? "0", 10),
    skill_learned: 0,
    skill_used: 0,
    policy_denied: 0,
    egress_allowed: 0,
    egress_blocked: 0,
  };
}

async function loadAgentEventMetrics(
  pool: DbPool,
  workspace_id: string,
  principal_id: string,
  range_start: string,
  range_end: string,
): Promise<EventMetricRow> {
  const res = await pool.query<{
    incidents_opened: string;
    incidents_closed: string;
    constraints_learned: string;
    repeated_mistakes: string;
    skill_learned: string;
    skill_used: string;
    policy_denied: string;
    egress_allowed: string;
    egress_blocked: string;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE event_type = 'incident.opened')::text AS incidents_opened,
       COUNT(*) FILTER (WHERE event_type = 'incident.closed')::text AS incidents_closed,
       COUNT(*) FILTER (WHERE event_type = 'constraint.learned')::text AS constraints_learned,
       COUNT(*) FILTER (WHERE event_type = 'mistake.repeated')::text AS repeated_mistakes,
       COUNT(*) FILTER (WHERE event_type = 'agent.skill.learned')::text AS skill_learned,
       COUNT(*) FILTER (WHERE event_type = 'agent.skill.used')::text AS skill_used,
       COUNT(*) FILTER (WHERE event_type IN ('policy.denied', 'policy.requires_approval'))::text AS policy_denied,
       COUNT(*) FILTER (WHERE event_type = 'egress.allowed')::text AS egress_allowed,
       COUNT(*) FILTER (WHERE event_type = 'egress.blocked')::text AS egress_blocked
     FROM evt_events
     WHERE workspace_id = $1
       AND actor_principal_id = $2
       AND occurred_at >= ($3::timestamptz)
       AND occurred_at < ($4::timestamptz)
       AND event_type = ANY($5::text[])`,
    [
      workspace_id,
      principal_id,
      range_start,
      range_end,
      [
        "incident.opened",
        "incident.closed",
        "constraint.learned",
        "mistake.repeated",
        "agent.skill.learned",
        "agent.skill.used",
        "policy.denied",
        "policy.requires_approval",
        "egress.allowed",
        "egress.blocked",
      ],
    ],
  );

  return {
    run_succeeded: 0,
    run_failed: 0,
    incidents_opened: Number.parseInt(res.rows[0]?.incidents_opened ?? "0", 10),
    incidents_closed: Number.parseInt(res.rows[0]?.incidents_closed ?? "0", 10),
    constraints_learned: Number.parseInt(res.rows[0]?.constraints_learned ?? "0", 10),
    repeated_mistakes: Number.parseInt(res.rows[0]?.repeated_mistakes ?? "0", 10),
    skill_learned: Number.parseInt(res.rows[0]?.skill_learned ?? "0", 10),
    skill_used: Number.parseInt(res.rows[0]?.skill_used ?? "0", 10),
    policy_denied: Number.parseInt(res.rows[0]?.policy_denied ?? "0", 10),
    egress_allowed: Number.parseInt(res.rows[0]?.egress_allowed ?? "0", 10),
    egress_blocked: Number.parseInt(res.rows[0]?.egress_blocked ?? "0", 10),
  };
}

async function loadWorkspaceEgressMetrics(
  pool: DbPool,
  workspace_id: string,
  range_start: string,
  range_end: string,
): Promise<EgressMetricRow> {
  const res = await pool.query<{ requests_total: string; requests_blocked: string }>(
    `SELECT
       COUNT(*)::text AS requests_total,
       COUNT(*) FILTER (WHERE blocked OR policy_decision <> 'allow')::text AS requests_blocked
     FROM sec_egress_requests
     WHERE workspace_id = $1
       AND created_at >= ($2::timestamptz)
       AND created_at < ($3::timestamptz)`,
    [workspace_id, range_start, range_end],
  );
  return {
    requests_total: Number.parseInt(res.rows[0]?.requests_total ?? "0", 10),
    requests_blocked: Number.parseInt(res.rows[0]?.requests_blocked ?? "0", 10),
  };
}

async function loadAgentEgressMetrics(
  pool: DbPool,
  workspace_id: string,
  principal_id: string,
  range_start: string,
  range_end: string,
): Promise<EgressMetricRow> {
  const res = await pool.query<{ requests_total: string; requests_blocked: string }>(
    `SELECT
       COUNT(*)::text AS requests_total,
       COUNT(*) FILTER (WHERE blocked OR policy_decision <> 'allow')::text AS requests_blocked
     FROM sec_egress_requests
     WHERE workspace_id = $1
       AND requested_by_principal_id = $2
       AND created_at >= ($3::timestamptz)
       AND created_at < ($4::timestamptz)`,
    [workspace_id, principal_id, range_start, range_end],
  );
  return {
    requests_total: Number.parseInt(res.rows[0]?.requests_total ?? "0", 10),
    requests_blocked: Number.parseInt(res.rows[0]?.requests_blocked ?? "0", 10),
  };
}

function computeScore(
  success_count: number,
  failure_count: number,
  learning_count: number,
  incident_opened_count: number,
  estimated_cost_units: number,
  budget_cap_units: number,
): { budget_utilization: number; survival_score: number; success_ratio: number; learning_ratio: number; cost_ratio: number } {
  const successPlusFailure = success_count + failure_count;
  const success_ratio = successPlusFailure > 0 ? clamp01(success_count / successPlusFailure) : 0.5;
  const learning_need = Math.max(1, incident_opened_count + failure_count);
  const learning_ratio = clamp01(learning_count / learning_need);
  const budget_utilization =
    budget_cap_units > 0 ? clampNonNegative(estimated_cost_units / budget_cap_units) : 1;
  const cost_ratio = clamp01(1 - budget_utilization);

  const survival_score = clamp01(
    success_ratio * 0.55 + learning_ratio * 0.25 + cost_ratio * 0.2,
  );
  return { budget_utilization, survival_score, success_ratio, learning_ratio, cost_ratio };
}

function computeWorkspaceMetrics(
  events: EventMetricRow,
  egress: EgressMetricRow,
): SurvivalCoreMetrics {
  const learning_count = events.constraints_learned + events.incidents_closed;
  const success_count = events.run_succeeded + learning_count;
  const failure_count =
    events.run_failed + events.incidents_opened + events.repeated_mistakes + egress.requests_blocked;

  const estimated_cost_units = clampNonNegative(
    egress.requests_total * 1 + (events.run_succeeded + events.run_failed) * 0.2 + events.incidents_opened * 0.5,
  );
  const value_units = clampNonNegative(
    events.run_succeeded * 1.5 +
      learning_count * 1.2 -
      events.run_failed * 0.5 -
      egress.requests_blocked * 0.2,
  );
  const budget_cap_units = 100;
  const score = computeScore(
    success_count,
    failure_count,
    learning_count,
    events.incidents_opened,
    estimated_cost_units,
    budget_cap_units,
  );

  return {
    success_count,
    failure_count,
    incident_opened_count: events.incidents_opened,
    incident_closed_count: events.incidents_closed,
    learning_count,
    repeated_mistakes_count: events.repeated_mistakes,
    egress_requests_count: egress.requests_total,
    blocked_requests_count: egress.requests_blocked,
    estimated_cost_units,
    value_units,
    budget_cap_units,
    budget_utilization: score.budget_utilization,
    survival_score: score.survival_score,
    extras: {
      rollup_version: 1,
      score_components: {
        success_ratio: score.success_ratio,
        learning_ratio: score.learning_ratio,
        cost_ratio: score.cost_ratio,
      },
      run_succeeded: events.run_succeeded,
      run_failed: events.run_failed,
      constraints_learned: events.constraints_learned,
      incidents_opened: events.incidents_opened,
      incidents_closed: events.incidents_closed,
      repeated_mistakes: events.repeated_mistakes,
      egress_requests: egress.requests_total,
      egress_blocked: egress.requests_blocked,
    },
  };
}

function computeAgentMetrics(
  events: EventMetricRow,
  egress: EgressMetricRow,
): SurvivalCoreMetrics {
  const learning_count = events.constraints_learned + events.skill_learned;
  const success_count =
    events.egress_allowed + events.skill_used + events.skill_learned + events.incidents_closed + events.constraints_learned;
  const failure_count =
    events.egress_blocked + events.policy_denied + events.repeated_mistakes + events.incidents_opened;

  const estimated_cost_units = clampNonNegative(egress.requests_total * 1 + (events.skill_used + events.skill_learned) * 0.1);
  const value_units = clampNonNegative(success_count * 1.1 + learning_count * 0.8 - failure_count * 0.3);
  const budget_cap_units = 40;
  const score = computeScore(
    success_count,
    failure_count,
    learning_count,
    events.incidents_opened,
    estimated_cost_units,
    budget_cap_units,
  );

  return {
    success_count,
    failure_count,
    incident_opened_count: events.incidents_opened,
    incident_closed_count: events.incidents_closed,
    learning_count,
    repeated_mistakes_count: events.repeated_mistakes,
    egress_requests_count: egress.requests_total,
    blocked_requests_count: egress.requests_blocked,
    estimated_cost_units,
    value_units,
    budget_cap_units,
    budget_utilization: score.budget_utilization,
    survival_score: score.survival_score,
    extras: {
      rollup_version: 1,
      score_components: {
        success_ratio: score.success_ratio,
        learning_ratio: score.learning_ratio,
        cost_ratio: score.cost_ratio,
      },
      skill_used: events.skill_used,
      skill_learned: events.skill_learned,
      constraints_learned: events.constraints_learned,
      incidents_opened: events.incidents_opened,
      incidents_closed: events.incidents_closed,
      repeated_mistakes: events.repeated_mistakes,
      policy_denied: events.policy_denied,
      egress_allowed: events.egress_allowed,
      egress_blocked: events.egress_blocked,
    },
  };
}

async function upsertLedgerRow(
  pool: DbPool,
  row: Omit<SurvivalLedgerRecordV1, "created_at" | "updated_at">,
  occurred_at: string,
): Promise<SurvivalLedgerRecordV1 | null> {
  const upsert = await pool.query<SurvivalLedgerRecordV1>(
    `INSERT INTO sec_survival_ledger_daily (
       workspace_id, target_type, target_id, snapshot_date,
       success_count, failure_count, incident_opened_count, incident_closed_count,
       learning_count, repeated_mistakes_count, egress_requests_count, blocked_requests_count,
       estimated_cost_units, value_units, budget_cap_units, budget_utilization, survival_score,
       extras, created_at, updated_at
     ) VALUES (
       $1,$2,$3,$4::date,
       $5,$6,$7,$8,
       $9,$10,$11,$12,
       $13,$14,$15,$16,$17,
       $18::jsonb,$19,$19
     )
     ON CONFLICT (workspace_id, target_type, target_id, snapshot_date)
     DO UPDATE SET
       success_count = EXCLUDED.success_count,
       failure_count = EXCLUDED.failure_count,
       incident_opened_count = EXCLUDED.incident_opened_count,
       incident_closed_count = EXCLUDED.incident_closed_count,
       learning_count = EXCLUDED.learning_count,
       repeated_mistakes_count = EXCLUDED.repeated_mistakes_count,
       egress_requests_count = EXCLUDED.egress_requests_count,
       blocked_requests_count = EXCLUDED.blocked_requests_count,
       estimated_cost_units = EXCLUDED.estimated_cost_units,
       value_units = EXCLUDED.value_units,
       budget_cap_units = EXCLUDED.budget_cap_units,
       budget_utilization = EXCLUDED.budget_utilization,
       survival_score = EXCLUDED.survival_score,
       extras = EXCLUDED.extras,
       updated_at = EXCLUDED.updated_at
     WHERE
       sec_survival_ledger_daily.success_count IS DISTINCT FROM EXCLUDED.success_count OR
       sec_survival_ledger_daily.failure_count IS DISTINCT FROM EXCLUDED.failure_count OR
       sec_survival_ledger_daily.incident_opened_count IS DISTINCT FROM EXCLUDED.incident_opened_count OR
       sec_survival_ledger_daily.incident_closed_count IS DISTINCT FROM EXCLUDED.incident_closed_count OR
       sec_survival_ledger_daily.learning_count IS DISTINCT FROM EXCLUDED.learning_count OR
       sec_survival_ledger_daily.repeated_mistakes_count IS DISTINCT FROM EXCLUDED.repeated_mistakes_count OR
       sec_survival_ledger_daily.egress_requests_count IS DISTINCT FROM EXCLUDED.egress_requests_count OR
       sec_survival_ledger_daily.blocked_requests_count IS DISTINCT FROM EXCLUDED.blocked_requests_count OR
       sec_survival_ledger_daily.estimated_cost_units IS DISTINCT FROM EXCLUDED.estimated_cost_units OR
       sec_survival_ledger_daily.value_units IS DISTINCT FROM EXCLUDED.value_units OR
       sec_survival_ledger_daily.budget_cap_units IS DISTINCT FROM EXCLUDED.budget_cap_units OR
       sec_survival_ledger_daily.budget_utilization IS DISTINCT FROM EXCLUDED.budget_utilization OR
       sec_survival_ledger_daily.survival_score IS DISTINCT FROM EXCLUDED.survival_score OR
       sec_survival_ledger_daily.extras IS DISTINCT FROM EXCLUDED.extras
     RETURNING
       workspace_id,
       target_type,
       target_id,
       snapshot_date::text AS snapshot_date,
       success_count,
       failure_count,
       incident_opened_count,
       incident_closed_count,
       learning_count,
       repeated_mistakes_count,
       egress_requests_count,
       blocked_requests_count,
       estimated_cost_units,
       value_units,
       budget_cap_units,
       budget_utilization,
       survival_score,
       extras,
       created_at::text AS created_at,
       updated_at::text AS updated_at`,
    [
      row.workspace_id,
      row.target_type,
      row.target_id,
      row.snapshot_date,
      row.success_count,
      row.failure_count,
      row.incident_opened_count,
      row.incident_closed_count,
      row.learning_count,
      row.repeated_mistakes_count,
      row.egress_requests_count,
      row.blocked_requests_count,
      row.estimated_cost_units,
      row.value_units,
      row.budget_cap_units,
      row.budget_utilization,
      row.survival_score,
      JSON.stringify(row.extras),
      occurred_at,
    ],
  );

  return upsert.rowCount === 1 ? upsert.rows[0] : null;
}

async function appendRollupEvent(
  pool: DbPool,
  row: SurvivalLedgerRecordV1,
  correlation_id: string,
): Promise<void> {
  const occurred_at = `${row.snapshot_date}T00:00:00.000Z`;
  await appendToStream(pool, {
    event_id: randomUUID(),
    event_type: "survival.ledger.rolled_up",
    event_version: 1,
    occurred_at,
    workspace_id: row.workspace_id,
    actor: { actor_type: "service", actor_id: "survival-rollup" },
    stream: { stream_type: "workspace", stream_id: row.workspace_id },
    correlation_id,
    data: {
      workspace_id: row.workspace_id,
      target_type: row.target_type,
      target_id: row.target_id,
      snapshot_date: row.snapshot_date,
      success_count: row.success_count,
      failure_count: row.failure_count,
      incident_opened_count: row.incident_opened_count,
      incident_closed_count: row.incident_closed_count,
      learning_count: row.learning_count,
      repeated_mistakes_count: row.repeated_mistakes_count,
      egress_requests_count: row.egress_requests_count,
      blocked_requests_count: row.blocked_requests_count,
      estimated_cost_units: row.estimated_cost_units,
      value_units: row.value_units,
      budget_cap_units: row.budget_cap_units,
      budget_utilization: row.budget_utilization,
      survival_score: row.survival_score,
      extras: row.extras,
    },
    policy_context: {},
    model_context: {},
    display: {},
  });
}

export async function runDailySurvivalRollup(
  pool: DbPool,
  options: RunDailySurvivalRollupOptions = {},
): Promise<RunDailySurvivalRollupResult> {
  const workspace_id = options.workspace_id?.trim() || "ws_dev";
  const snapshot_date = toIsoDate(options.snapshot_date);
  const occurred_at = `${snapshot_date}T00:00:00.000Z`;
  const next_day = nextIsoDate(snapshot_date);
  const range_start = `${snapshot_date}T00:00:00.000Z`;
  const range_end = `${next_day}T00:00:00.000Z`;
  const correlation_id = randomUUID();

  let written_rows = 0;
  let unchanged_rows = 0;

  const workspaceEvents = await loadWorkspaceEventMetrics(pool, workspace_id, range_start, range_end);
  const workspaceEgress = await loadWorkspaceEgressMetrics(pool, workspace_id, range_start, range_end);
  const workspaceMetrics = computeWorkspaceMetrics(workspaceEvents, workspaceEgress);

  const workspaceUpsert = await upsertLedgerRow(
    pool,
    {
      workspace_id,
      target_type: SurvivalLedgerTargetType.Workspace,
      target_id: workspace_id,
      snapshot_date,
      ...workspaceMetrics,
    },
    occurred_at,
  );
  if (workspaceUpsert) {
    written_rows += 1;
    await appendRollupEvent(pool, workspaceUpsert, correlation_id);
  } else {
    unchanged_rows += 1;
  }

  const agents = await pool.query<AgentRow>(
    `SELECT agent_id, principal_id
     FROM sec_agents
     ORDER BY created_at ASC`,
  );

  for (const agent of agents.rows) {
    const agentEvents = await loadAgentEventMetrics(
      pool,
      workspace_id,
      agent.principal_id,
      range_start,
      range_end,
    );
    const agentEgress = await loadAgentEgressMetrics(
      pool,
      workspace_id,
      agent.principal_id,
      range_start,
      range_end,
    );
    const agentMetrics = computeAgentMetrics(agentEvents, agentEgress);

    const agentUpsert = await upsertLedgerRow(
      pool,
      {
        workspace_id,
        target_type: SurvivalLedgerTargetType.Agent,
        target_id: agent.agent_id,
        snapshot_date,
        ...agentMetrics,
      },
      occurred_at,
    );
    if (agentUpsert) {
      written_rows += 1;
      await appendRollupEvent(pool, agentUpsert, correlation_id);
    } else {
      unchanged_rows += 1;
    }
  }

  return {
    workspace_id,
    snapshot_date,
    scanned_targets: 1 + agents.rows.length,
    written_rows,
    unchanged_rows,
  };
}
