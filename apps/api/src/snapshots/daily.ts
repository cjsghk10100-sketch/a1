import { randomUUID } from "node:crypto";

import type { DailyAgentSnapshotRecordV1 } from "@agentapp/shared";

import type { DbPool } from "../db/pool.js";
import { appendToStream } from "../eventStore/index.js";

const DAY_MS = 24 * 60 * 60 * 1000;

type AgentRow = {
  agent_id: string;
  principal_id: string;
};

type TrustRow = {
  trust_score: number;
  success_rate_7d: number;
  policy_violations_7d: number;
  components: Record<string, unknown>;
};

type SnapshotMetrics = {
  trust_score: number;
  autonomy_rate_7d: number;
  new_skills_learned_7d: number;
  constraints_learned_7d: number;
  repeated_mistakes_7d: number;
  extras: Record<string, unknown>;
};

export interface RunDailySnapshotOptions {
  workspace_id?: string;
  snapshot_date?: string; // YYYY-MM-DD (UTC)
}

export interface RunDailySnapshotResult {
  workspace_id: string;
  snapshot_date: string;
  scanned_agents: number;
  written_rows: number;
  unchanged_rows: number;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
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

function addIsoDays(date: string, deltaDays: number): string {
  const t = Date.parse(`${date}T00:00:00.000Z`);
  return new Date(t + deltaDays * DAY_MS).toISOString().slice(0, 10);
}

async function scalarCount(pool: DbPool, sql: string, args: unknown[]): Promise<number> {
  const res = await pool.query<{ count: string }>(sql, args);
  return Math.max(0, Number(res.rows[0]?.count ?? "0"));
}

async function computeAgentMetrics(
  pool: DbPool,
  input: {
    workspace_id: string;
    snapshot_date: string;
    range_start: string; // timestamptz (UTC)
    range_end: string; // timestamptz (UTC, exclusive)
    agent: AgentRow;
  },
): Promise<SnapshotMetrics> {
  const trust = await pool.query<TrustRow>(
    `SELECT trust_score, success_rate_7d, policy_violations_7d, components
     FROM sec_agent_trust
     WHERE workspace_id = $1
       AND agent_id = $2
     LIMIT 1`,
    [input.workspace_id, input.agent.agent_id],
  );
  const trustRow = trust.rows[0];

  const runs_7d = await scalarCount(
    pool,
    `SELECT count(*)::text AS count
     FROM evt_events
     WHERE workspace_id = $1
       AND actor_principal_id = $2
       AND event_type IN ('run.completed', 'run.failed')
       AND occurred_at >= ($3::timestamptz)
       AND occurred_at < ($4::timestamptz)`,
    [input.workspace_id, input.agent.principal_id, input.range_start, input.range_end],
  );

  const blocked_actions_7d = await scalarCount(
    pool,
    `SELECT count(*)::text AS count
     FROM evt_events
     WHERE workspace_id = $1
       AND actor_principal_id = $2
       AND event_type IN ('policy.denied', 'policy.requires_approval', 'egress.blocked')
       AND occurred_at >= ($3::timestamptz)
       AND occurred_at < ($4::timestamptz)`,
    [input.workspace_id, input.agent.principal_id, input.range_start, input.range_end],
  );

  const new_skills_learned_7d = await scalarCount(
    pool,
    `SELECT count(*)::text AS count
     FROM sec_agent_skills
     WHERE workspace_id = $1
       AND agent_id = $2
       AND learned_at IS NOT NULL
       AND learned_at >= ($3::timestamptz)
       AND learned_at < ($4::timestamptz)`,
    [input.workspace_id, input.agent.agent_id, input.range_start, input.range_end],
  );

  const constraints_learned_7d = await scalarCount(
    pool,
    `SELECT count(*)::text AS count
     FROM sec_constraints
     WHERE workspace_id = $1
       AND (
         agent_id = $2
         OR (agent_id IS NULL AND principal_id = $3)
       )
       AND first_learned_at >= ($4::timestamptz)
       AND first_learned_at < ($5::timestamptz)`,
    [input.workspace_id, input.agent.agent_id, input.agent.principal_id, input.range_start, input.range_end],
  );

  const repeated_mistakes_7d = await scalarCount(
    pool,
    `SELECT count(*)::text AS count
     FROM evt_events
     WHERE workspace_id = $1
       AND event_type = 'mistake.repeated'
       AND occurred_at >= ($2::timestamptz)
       AND occurred_at < ($3::timestamptz)
       AND (
         data->>'agent_id' = $4
         OR actor_principal_id = $5
       )`,
    [input.workspace_id, input.range_start, input.range_end, input.agent.agent_id, input.agent.principal_id],
  );

  const autonomy_rate_7d = runs_7d > 0 ? clamp01(1 - blocked_actions_7d / runs_7d) : 0;
  const trust_score = trustRow ? clamp01(trustRow.trust_score) : 0;

  return {
    trust_score,
    autonomy_rate_7d,
    new_skills_learned_7d,
    constraints_learned_7d,
    repeated_mistakes_7d,
    extras: {
      snapshot_version: 1,
      runs_7d,
      blocked_actions_7d,
      success_rate_7d: trustRow?.success_rate_7d ?? 0,
      policy_violations_7d: trustRow?.policy_violations_7d ?? 0,
      trust_components: trustRow?.components ?? {},
    },
  };
}

export async function runDailySnapshotJob(
  pool: DbPool,
  options: RunDailySnapshotOptions = {},
): Promise<RunDailySnapshotResult> {
  const workspace_id = options.workspace_id?.trim() || "ws_dev";
  const snapshot_date = toIsoDate(options.snapshot_date);
  const occurred_at = `${snapshot_date}T00:00:00.000Z`;
  const next_day = nextIsoDate(snapshot_date);
  const range_start = `${addIsoDays(snapshot_date, -6)}T00:00:00.000Z`;
  const range_end = `${next_day}T00:00:00.000Z`;
  const correlation_id = randomUUID();

  const agents = await pool.query<AgentRow>(
    `SELECT agent_id, principal_id
     FROM sec_agents
     ORDER BY created_at ASC`,
  );

  let written_rows = 0;
  let unchanged_rows = 0;

  for (const agent of agents.rows) {
    const metrics = await computeAgentMetrics(pool, {
      workspace_id,
      snapshot_date,
      range_start,
      range_end,
      agent,
    });

    const upsert = await pool.query<DailyAgentSnapshotRecordV1>(
      `INSERT INTO sec_daily_agent_snapshots (
         workspace_id,
         agent_id,
         snapshot_date,
         trust_score,
         autonomy_rate_7d,
         new_skills_learned_7d,
         constraints_learned_7d,
         repeated_mistakes_7d,
         extras,
         created_at,
         updated_at
       ) VALUES (
         $1,$2,$3::date,$4,$5,$6,$7,$8,$9::jsonb,$10,$10
       )
       ON CONFLICT (workspace_id, agent_id, snapshot_date)
       DO UPDATE SET
         trust_score = EXCLUDED.trust_score,
         autonomy_rate_7d = EXCLUDED.autonomy_rate_7d,
         new_skills_learned_7d = EXCLUDED.new_skills_learned_7d,
         constraints_learned_7d = EXCLUDED.constraints_learned_7d,
         repeated_mistakes_7d = EXCLUDED.repeated_mistakes_7d,
         extras = EXCLUDED.extras,
         updated_at = EXCLUDED.updated_at
       WHERE
         sec_daily_agent_snapshots.trust_score IS DISTINCT FROM EXCLUDED.trust_score OR
         sec_daily_agent_snapshots.autonomy_rate_7d IS DISTINCT FROM EXCLUDED.autonomy_rate_7d OR
         sec_daily_agent_snapshots.new_skills_learned_7d IS DISTINCT FROM EXCLUDED.new_skills_learned_7d OR
         sec_daily_agent_snapshots.constraints_learned_7d IS DISTINCT FROM EXCLUDED.constraints_learned_7d OR
         sec_daily_agent_snapshots.repeated_mistakes_7d IS DISTINCT FROM EXCLUDED.repeated_mistakes_7d OR
         sec_daily_agent_snapshots.extras IS DISTINCT FROM EXCLUDED.extras
       RETURNING
         workspace_id,
         agent_id,
         snapshot_date::text AS snapshot_date,
         trust_score,
         autonomy_rate_7d,
         new_skills_learned_7d,
         constraints_learned_7d,
         repeated_mistakes_7d,
         extras,
         created_at::text AS created_at,
         updated_at::text AS updated_at`,
      [
        workspace_id,
        agent.agent_id,
        snapshot_date,
        metrics.trust_score,
        metrics.autonomy_rate_7d,
        metrics.new_skills_learned_7d,
        metrics.constraints_learned_7d,
        metrics.repeated_mistakes_7d,
        JSON.stringify(metrics.extras),
        occurred_at,
      ],
    );

    if (upsert.rowCount !== 1) {
      unchanged_rows += 1;
      continue;
    }

    written_rows += 1;
    await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "daily.agent.snapshot",
      event_version: 1,
      occurred_at,
      workspace_id,
      actor: { actor_type: "service", actor_id: "snapshotter" },
      stream: { stream_type: "workspace", stream_id: workspace_id },
      correlation_id,
      data: {
        workspace_id,
        agent_id: agent.agent_id,
        snapshot_date,
        trust_score: metrics.trust_score,
        autonomy_rate_7d: metrics.autonomy_rate_7d,
        new_skills_learned_7d: metrics.new_skills_learned_7d,
        constraints_learned_7d: metrics.constraints_learned_7d,
        repeated_mistakes_7d: metrics.repeated_mistakes_7d,
        extras: metrics.extras,
        range_start: `${snapshot_date}T00:00:00.000Z`,
        range_end: `${next_day}T00:00:00.000Z`,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });
  }

  return {
    workspace_id,
    snapshot_date,
    scanned_agents: Math.max(0, Number(agents.rowCount ?? 0)),
    written_rows,
    unchanged_rows,
  };
}
