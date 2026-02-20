import { randomUUID } from "node:crypto";

import type {
  LifecycleState,
  LifecycleStateRecordV1,
  SurvivalLedgerTargetType,
} from "@agentapp/shared";

import type { DbPool } from "../db/pool.js";
import { appendToStream } from "../eventStore/index.js";

type SurvivalRow = {
  workspace_id: string;
  target_type: SurvivalLedgerTargetType;
  target_id: string;
  snapshot_date: string;
  success_count: number;
  failure_count: number;
  learning_count: number;
  repeated_mistakes_count: number;
  survival_score: number;
  budget_utilization: number;
  extras: Record<string, unknown>;
};

type ExistingStateRow = {
  workspace_id: string;
  target_type: SurvivalLedgerTargetType;
  target_id: string;
  current_state: LifecycleState;
  recommended_state: LifecycleState;
  last_snapshot_date: string;
  last_survival_score: number;
  last_budget_utilization: number;
  consecutive_healthy_days: number;
  consecutive_risky_days: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  last_transition_at: string | null;
  last_event_id: string | null;
};

type Recommendation = {
  recommended_state: LifecycleState;
  reason_codes: string[];
};

type StateDecision = {
  current_state: LifecycleState;
  recommended_state: LifecycleState;
  consecutive_healthy_days: number;
  consecutive_risky_days: number;
  reason_codes: string[];
  state_changed: boolean;
};

export interface RunLifecycleAutomationOptions {
  workspace_id?: string;
  snapshot_date?: string; // YYYY-MM-DD (UTC)
}

export interface RunLifecycleAutomationResult {
  workspace_id: string;
  snapshot_date: string;
  evaluated_targets: number;
  state_changes: number;
  unchanged_targets: number;
}

function toIsoDate(input: string | undefined): string {
  if (input && /^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  const now = new Date();
  const utc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(utc).toISOString().slice(0, 10);
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}

function buildRecommendation(row: SurvivalRow): Recommendation {
  const reasons: string[] = [];
  let recommended_state: LifecycleState = "active";

  if (row.survival_score < 0.55) {
    recommended_state = "probation";
    reasons.push("degraded_survival_score");
  }
  if (row.survival_score < 0.3) {
    recommended_state = "sunset";
    reasons.push("critical_survival_score");
  }

  if (row.budget_utilization > 0.9 && recommended_state === "active") {
    recommended_state = "probation";
    reasons.push("budget_warning");
  }
  if (row.budget_utilization > 1.2) {
    recommended_state = "sunset";
    reasons.push("budget_exceeded");
  }

  if (row.failure_count > row.success_count && recommended_state === "active") {
    recommended_state = "probation";
    reasons.push("failures_exceed_success");
  }

  if (row.repeated_mistakes_count >= 2 && recommended_state === "active") {
    recommended_state = "probation";
    reasons.push("repeated_mistakes");
  }
  if (row.repeated_mistakes_count >= 4) {
    recommended_state = "sunset";
    reasons.push("repeated_mistakes_critical");
  }

  if (reasons.length === 0) reasons.push("stable");
  return { recommended_state, reason_codes: dedupe(reasons) };
}

function decideNextState(
  previous: ExistingStateRow | null,
  recommendation: Recommendation,
): StateDecision {
  const prev_state = previous?.current_state ?? null;
  const prev_healthy = previous?.consecutive_healthy_days ?? 0;
  const prev_risky = previous?.consecutive_risky_days ?? 0;

  const recommended_is_healthy = recommendation.recommended_state === "active";
  const consecutive_healthy_days = recommended_is_healthy ? prev_healthy + 1 : 0;
  const consecutive_risky_days = recommended_is_healthy ? 0 : prev_risky + 1;

  let current_state: LifecycleState;

  if (!prev_state) {
    current_state = recommendation.recommended_state === "sunset" ? "probation" : recommendation.recommended_state;
  } else if (prev_state === "active") {
    current_state = recommendation.recommended_state === "active" ? "active" : "probation";
  } else if (prev_state === "probation") {
    if (recommendation.recommended_state === "active") {
      current_state = consecutive_healthy_days >= 2 ? "active" : "probation";
    } else if (recommendation.recommended_state === "sunset") {
      current_state = consecutive_risky_days >= 2 ? "sunset" : "probation";
    } else {
      current_state = "probation";
    }
  } else {
    if (recommendation.recommended_state === "active" && consecutive_healthy_days >= 3) {
      current_state = "probation";
    } else {
      current_state = "sunset";
    }
  }

  return {
    current_state,
    recommended_state: recommendation.recommended_state,
    consecutive_healthy_days,
    consecutive_risky_days,
    reason_codes: recommendation.reason_codes,
    state_changed: prev_state !== current_state,
  };
}

async function loadSurvivalRows(
  pool: DbPool,
  workspace_id: string,
  snapshot_date: string,
): Promise<SurvivalRow[]> {
  const rows = await pool.query<SurvivalRow>(
    `SELECT
       workspace_id,
       target_type,
       target_id,
       snapshot_date::text AS snapshot_date,
       success_count,
       failure_count,
       learning_count,
       repeated_mistakes_count,
       survival_score,
       budget_utilization,
       extras
     FROM sec_survival_ledger_daily
     WHERE workspace_id = $1
       AND snapshot_date = $2::date
     ORDER BY target_type ASC, target_id ASC`,
    [workspace_id, snapshot_date],
  );
  return rows.rows;
}

async function loadExistingState(
  pool: DbPool,
  row: SurvivalRow,
): Promise<ExistingStateRow | null> {
  const res = await pool.query<ExistingStateRow>(
    `SELECT
       workspace_id,
       target_type,
       target_id,
       current_state,
       recommended_state,
       last_snapshot_date::text AS last_snapshot_date,
       last_survival_score,
       last_budget_utilization,
       consecutive_healthy_days,
       consecutive_risky_days,
       metadata,
       created_at::text AS created_at,
       updated_at::text AS updated_at,
       last_transition_at::text AS last_transition_at,
       last_event_id
     FROM sec_lifecycle_states
     WHERE workspace_id = $1
       AND target_type = $2
       AND target_id = $3`,
    [row.workspace_id, row.target_type, row.target_id],
  );
  if (res.rowCount !== 1) return null;
  return res.rows[0];
}

async function upsertState(
  pool: DbPool,
  input: {
    row: SurvivalRow;
    decision: StateDecision;
    metadata: Record<string, unknown>;
    occurred_at: string;
    last_transition_at: string | null;
    last_event_id: string | null;
  },
): Promise<LifecycleStateRecordV1> {
  const res = await pool.query<LifecycleStateRecordV1>(
    `INSERT INTO sec_lifecycle_states (
       workspace_id,
       target_type,
       target_id,
       current_state,
       recommended_state,
       last_snapshot_date,
       last_survival_score,
       last_budget_utilization,
       consecutive_healthy_days,
       consecutive_risky_days,
       metadata,
       created_at,
       updated_at,
       last_transition_at,
       last_event_id
     ) VALUES (
       $1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10,$11::jsonb,$12,$12,$13,$14
     )
     ON CONFLICT (workspace_id, target_type, target_id)
     DO UPDATE SET
       current_state = EXCLUDED.current_state,
       recommended_state = EXCLUDED.recommended_state,
       last_snapshot_date = EXCLUDED.last_snapshot_date,
       last_survival_score = EXCLUDED.last_survival_score,
       last_budget_utilization = EXCLUDED.last_budget_utilization,
       consecutive_healthy_days = EXCLUDED.consecutive_healthy_days,
       consecutive_risky_days = EXCLUDED.consecutive_risky_days,
       metadata = EXCLUDED.metadata,
       updated_at = EXCLUDED.updated_at,
       last_transition_at = EXCLUDED.last_transition_at,
       last_event_id = EXCLUDED.last_event_id
     RETURNING
       workspace_id,
       target_type,
       target_id,
       current_state,
       recommended_state,
       last_snapshot_date::text AS last_snapshot_date,
       last_survival_score,
       last_budget_utilization,
       consecutive_healthy_days,
       consecutive_risky_days,
       metadata,
       created_at::text AS created_at,
       updated_at::text AS updated_at,
       last_transition_at::text AS last_transition_at,
       last_event_id`,
    [
      input.row.workspace_id,
      input.row.target_type,
      input.row.target_id,
      input.decision.current_state,
      input.decision.recommended_state,
      input.row.snapshot_date,
      input.row.survival_score,
      input.row.budget_utilization,
      input.decision.consecutive_healthy_days,
      input.decision.consecutive_risky_days,
      JSON.stringify(input.metadata),
      input.occurred_at,
      input.last_transition_at,
      input.last_event_id,
    ],
  );

  return res.rows[0];
}

export async function runLifecycleAutomation(
  pool: DbPool,
  options: RunLifecycleAutomationOptions = {},
): Promise<RunLifecycleAutomationResult> {
  const workspace_id = options.workspace_id?.trim() || "ws_dev";
  const snapshot_date = toIsoDate(options.snapshot_date);
  const occurred_at = `${snapshot_date}T00:00:00.000Z`;
  const correlation_id = randomUUID();

  const survivalRows = await loadSurvivalRows(pool, workspace_id, snapshot_date);
  let state_changes = 0;
  let unchanged_targets = 0;

  for (const row of survivalRows) {
    const existing = await loadExistingState(pool, row);
    const recommendation = buildRecommendation(row);
    const decision = decideNextState(existing, recommendation);

    const metadata = {
      lifecycle_version: 1,
      reason_codes: recommendation.reason_codes,
      score_inputs: {
        survival_score: row.survival_score,
        budget_utilization: row.budget_utilization,
        success_count: row.success_count,
        failure_count: row.failure_count,
        learning_count: row.learning_count,
        repeated_mistakes_count: row.repeated_mistakes_count,
      },
      survival_extras: row.extras ?? {},
    };

    const state = await upsertState(pool, {
      row,
      decision,
      metadata,
      occurred_at,
      last_transition_at: decision.state_changed
        ? occurred_at
        : (existing?.last_transition_at ?? null),
      last_event_id: existing?.last_event_id ?? null,
    });

    if (!decision.state_changed) {
      unchanged_targets += 1;
      continue;
    }

    state_changes += 1;
    const transition_id = `lct_${randomUUID().replaceAll("-", "")}`;

    await pool.query(
      `INSERT INTO sec_lifecycle_transitions (
         transition_id,
         workspace_id,
         target_type,
         target_id,
         from_state,
         to_state,
         recommended_state,
         reason_codes,
         snapshot_date,
         survival_score,
         budget_utilization,
         correlation_id,
         event_id,
         metadata,
         created_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11,$12,NULL,$13::jsonb,$14
       )`,
      [
        transition_id,
        row.workspace_id,
        row.target_type,
        row.target_id,
        existing?.current_state ?? null,
        decision.current_state,
        decision.recommended_state,
        decision.reason_codes,
        snapshot_date,
        row.survival_score,
        row.budget_utilization,
        correlation_id,
        JSON.stringify(metadata),
        occurred_at,
      ],
    );

    const lifecycleEvent = await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "lifecycle.state.changed",
      event_version: 1,
      occurred_at,
      workspace_id: row.workspace_id,
      actor: { actor_type: "service", actor_id: "lifecycle-automation" },
      stream: { stream_type: "workspace", stream_id: row.workspace_id },
      correlation_id,
      causation_id: state.last_event_id ?? undefined,
      data: {
        workspace_id: row.workspace_id,
        target_type: row.target_type,
        target_id: row.target_id,
        from_state: existing?.current_state,
        to_state: decision.current_state,
        recommended_state: decision.recommended_state,
        reason_codes: decision.reason_codes,
        snapshot_date,
        survival_score: row.survival_score,
        budget_utilization: row.budget_utilization,
        counters: {
          consecutive_healthy_days: decision.consecutive_healthy_days,
          consecutive_risky_days: decision.consecutive_risky_days,
        },
        metadata,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });

    await pool.query(
      `UPDATE sec_lifecycle_transitions
       SET event_id = $2
       WHERE transition_id = $1`,
      [transition_id, lifecycleEvent.event_id],
    );

    await pool.query(
      `UPDATE sec_lifecycle_states
       SET last_event_id = $4,
           last_transition_at = $5,
           updated_at = $5
       WHERE workspace_id = $1
         AND target_type = $2
         AND target_id = $3`,
      [
        row.workspace_id,
        row.target_type,
        row.target_id,
        lifecycleEvent.event_id,
        occurred_at,
      ],
    );
  }

  return {
    workspace_id,
    snapshot_date,
    evaluated_targets: survivalRows.length,
    state_changes,
    unchanged_targets,
  };
}
