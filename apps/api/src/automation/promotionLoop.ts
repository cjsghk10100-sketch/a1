import { createHash, randomUUID } from "node:crypto";

import { newIncidentId, type ActorType } from "@agentapp/shared";

import { SCHEMA_VERSION } from "../contracts/schemaVersion.js";
import type { DbClient, DbPool } from "../db/pool.js";
import { appendToStream } from "../eventStore/index.js";

type Queryable = Pick<DbPool, "query"> | Pick<DbClient, "query">;

type LoggerLike = {
  debug?: (obj: Record<string, unknown>, msg?: string) => void;
  warn?: (obj: Record<string, unknown>, msg?: string) => void;
  error?: (obj: Record<string, unknown>, msg?: string) => void;
};

type Trigger = "scorecard.recorded" | "run.failed";
type RiskTier = "low" | "medium" | "high";

type AutomationContext = {
  workspace_id: string;
  entity_type: string;
  entity_id: string;
  trigger: Trigger;
  event_data?: Record<string, unknown>;
  run_id?: string;
  scorecard_id?: string;
  risk_tier?: string;
  correlation_id?: string;
  actor?: { actor_type: ActorType; actor_id: string };
  log?: LoggerLike;
};

type LatestEventRow = {
  event_id: string;
  event_type: string;
  occurred_at: string;
  stream_seq?: string | number | null;
  entity_type: string | null;
  entity_id: string | null;
  run_id: string | null;
  correlation_id: string | null;
};

const KNOWN_RISK_TIERS = new Set(["low", "medium", "high"]);

function isAutomationEnabled(): boolean {
  const raw = process.env.PROMOTION_LOOP_ENABLED;
  if (!raw) return true;
  const value = raw.trim().toLowerCase();
  if (value === "0" || value === "false" || value === "off" || value === "no") return false;
  return true;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeRiskTier(value: unknown): RiskTier | undefined {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return undefined;
  if (!KNOWN_RISK_TIERS.has(normalized)) return undefined;
  return normalized as RiskTier;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  return (err as { code?: string }).code === "23505";
}

function isUndefinedColumn(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  return (err as { code?: string }).code === "42703";
}

function domainCorrelationId(ctx: AutomationContext, subjectId: string): string {
  const existing = normalizeOptionalString(ctx.correlation_id);
  if (existing) return existing;
  return `auto:${ctx.workspace_id}:${ctx.entity_type}:${ctx.entity_id}:${ctx.trigger}:${subjectId}`;
}

function resolveActor(ctx: AutomationContext): { actor_type: ActorType; actor_id: string } {
  if (ctx.actor?.actor_type && normalizeOptionalString(ctx.actor.actor_id)) {
    return {
      actor_type: ctx.actor.actor_type,
      actor_id: normalizeOptionalString(ctx.actor.actor_id) as string,
    };
  }
  return { actor_type: "service", actor_id: "api" };
}

async function getStableActiveAgentId(queryable: Queryable): Promise<string | null> {
  const agent = await queryable.query<{ agent_id: string }>(
    `SELECT agent_id
     FROM sec_agents
     WHERE revoked_at IS NULL
     ORDER BY created_at ASC, agent_id ASC
     LIMIT 1`,
  );
  if (agent.rowCount !== 1) return null;
  return agent.rows[0].agent_id;
}

async function appendWithIdempotentReplay(
  pool: DbPool,
  input: {
    workspace_id: string;
    event: Parameters<typeof appendToStream>[1];
    idempotency_key: string;
    expected_event_type: string;
    expected_entity_id?: string | null;
    log?: LoggerLike;
  },
): Promise<void> {
  try {
    await appendToStream(pool, input.event);
    return;
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }

  const existing = await pool.query<{
    event_type: string;
    entity_id: string | null;
  }>(
    `SELECT event_type, entity_id
     FROM evt_events
     WHERE workspace_id = $1
       AND idempotency_key = $2
     ORDER BY recorded_at DESC
     LIMIT 1`,
    [input.workspace_id, input.idempotency_key],
  );
  if (existing.rowCount !== 1) return;

  const row = existing.rows[0];
  if (row.event_type !== input.expected_event_type) {
    input.log?.error?.(
      {
        event: "idempotency_collision",
        idempotency_key: input.idempotency_key,
        expected_event_type: input.expected_event_type,
        expected_entity_id: input.expected_entity_id,
        actual_event_type: row.event_type,
        actual_entity_id: row.entity_id,
      },
      "automation idempotency collision",
    );
    return;
  }

  if (input.expected_entity_id != null && (row.entity_id ?? "") !== input.expected_entity_id) {
    input.log?.error?.(
      {
        event: "idempotency_collision",
        idempotency_key: input.idempotency_key,
        expected_event_type: input.expected_event_type,
        expected_entity_id: input.expected_entity_id,
        actual_event_type: row.event_type,
        actual_entity_id: row.entity_id,
      },
      "automation idempotency collision",
    );
  }
}

function deterministicMessageId(idempotency_key: string): string {
  const hash = createHash("sha256").update(idempotency_key).digest("hex").slice(0, 26);
  return `msg_${hash}`;
}

async function projectionHasActiveIncident(
  queryable: Queryable,
  workspace_id: string,
  run_id: string,
): Promise<boolean> {
  const open = await queryable.query(
    `SELECT 1
     FROM proj_incidents
     WHERE workspace_id = $1
       AND run_id = $2
       AND status = 'open'
     LIMIT 1`,
    [workspace_id, run_id],
  );
  return (open.rowCount ?? 0) > 0;
}

async function eventsHasActiveIncident(
  queryable: Queryable,
  workspace_id: string,
  run_id: string,
): Promise<boolean> {
  const latest = await queryable.query<{ event_type: string }>(
    `SELECT event_type
     FROM evt_events
     WHERE workspace_id = $1
       AND run_id = $2
       AND event_type IN ('incident.opened', 'incident.closed')
     ORDER BY occurred_at DESC, stream_seq DESC, event_id DESC
     LIMIT 1`,
    [workspace_id, run_id],
  );
  if (latest.rowCount !== 1) return false;
  return latest.rows[0].event_type === "incident.opened";
}

async function hasActiveIncident(
  queryable: Queryable,
  workspace_id: string,
  run_id: string,
): Promise<boolean> {
  try {
    return await projectionHasActiveIncident(queryable, workspace_id, run_id);
  } catch {
    return await eventsHasActiveIncident(queryable, workspace_id, run_id);
  }
}

async function projectionRunTerminal(
  queryable: Queryable,
  workspace_id: string,
  run_id: string,
): Promise<boolean> {
  const run = await queryable.query<{ status: string }>(
    `SELECT status
     FROM proj_runs
     WHERE workspace_id = $1
       AND run_id = $2
     LIMIT 1`,
    [workspace_id, run_id],
  );
  if (run.rowCount !== 1) return false;
  return run.rows[0].status === "failed" || run.rows[0].status === "cancelled";
}

async function eventsRunTerminal(
  queryable: Queryable,
  workspace_id: string,
  run_id: string,
): Promise<boolean> {
  const latest = await queryable.query<{ event_type: string }>(
    `SELECT event_type
     FROM evt_events
     WHERE workspace_id = $1
       AND run_id = $2
       AND event_type LIKE 'run.%'
     ORDER BY occurred_at DESC, stream_seq DESC, event_id DESC
     LIMIT 1`,
    [workspace_id, run_id],
  );
  if (latest.rowCount !== 1) return false;
  return latest.rows[0].event_type === "run.failed" || latest.rows[0].event_type === "run.cancelled";
}

async function isRunTerminal(
  queryable: Queryable,
  workspace_id: string,
  run_id: string,
): Promise<boolean> {
  try {
    return await projectionRunTerminal(queryable, workspace_id, run_id);
  } catch {
    return await eventsRunTerminal(queryable, workspace_id, run_id);
  }
}

async function hasRunEventsForRun(
  queryable: Queryable,
  workspace_id: string,
  run_id: string,
): Promise<boolean> {
  const row = await queryable.query(
    `SELECT 1
     FROM evt_events
     WHERE workspace_id = $1
       AND run_id = $2
       AND event_type LIKE 'run.%'
     LIMIT 1`,
    [workspace_id, run_id],
  );
  return (row.rowCount ?? 0) > 0;
}

async function hasRevokedApprovalForRun(
  queryable: Queryable,
  workspace_id: string,
  run_id: string,
): Promise<boolean> {
  const row = await queryable.query(
    `SELECT 1
     FROM evt_events
     WHERE workspace_id = $1
       AND run_id = $2
       AND (
         event_type = 'approval.revoked'
         OR (event_type = 'approval.decided' AND data->>'decision' = 'deny')
       )
     ORDER BY occurred_at DESC, stream_seq DESC, event_id DESC
     LIMIT 1`,
    [workspace_id, run_id],
  );
  return (row.rowCount ?? 0) > 0;
}

async function resolveRiskTier(
  queryable: Queryable,
  workspace_id: string,
  run_id: string | undefined,
  scorecard_id: string | undefined,
  ctxRiskTier: string | undefined,
  eventData: Record<string, unknown> | undefined,
): Promise<RiskTier | undefined> {
  const direct = normalizeRiskTier(ctxRiskTier) ?? normalizeRiskTier(eventData?.risk_tier);
  if (direct) return direct;

  const metadata = isRecord(eventData?.metadata) ? eventData?.metadata : undefined;
  const fromMetadata = normalizeRiskTier(metadata?.risk_tier);
  if (fromMetadata) return fromMetadata;

  const lookupRunId = run_id ?? normalizeOptionalString(eventData?.run_id) ?? null;
  if (!lookupRunId && scorecard_id) {
    const scorecardRun = await queryable.query<{ run_id: string | null }>(
      `SELECT run_id
       FROM proj_scorecards
       WHERE workspace_id = $1
         AND scorecard_id = $2
       LIMIT 1`,
      [workspace_id, scorecard_id],
    );
    const value = scorecardRun.rows[0]?.run_id;
    if (value) {
      const experimentRisk = await queryable.query<{ risk_tier: RiskTier | null }>(
        `SELECT e.risk_tier
         FROM proj_runs r
         LEFT JOIN proj_experiments e
           ON e.workspace_id = r.workspace_id
          AND e.experiment_id = r.experiment_id
         WHERE r.workspace_id = $1
           AND r.run_id = $2
         LIMIT 1`,
        [workspace_id, value],
      );
      return normalizeRiskTier(experimentRisk.rows[0]?.risk_tier);
    }
  }

  if (!lookupRunId) return undefined;
  const risk = await queryable.query<{ risk_tier: RiskTier | null }>(
    `SELECT e.risk_tier
     FROM proj_runs r
     LEFT JOIN proj_experiments e
       ON e.workspace_id = r.workspace_id
      AND e.experiment_id = r.experiment_id
     WHERE r.workspace_id = $1
       AND r.run_id = $2
     LIMIT 1`,
    [workspace_id, lookupRunId],
  );
  return normalizeRiskTier(risk.rows[0]?.risk_tier);
}

function extractIterationValues(eventData: Record<string, unknown> | undefined): {
  iteration_count: number | null;
  max_iterations: number | null;
} {
  if (!eventData) {
    return { iteration_count: null, max_iterations: null };
  }

  let iteration_count: number | null = null;
  let max_iterations: number | null = null;

  const metadata = isRecord(eventData.metadata) ? eventData.metadata : undefined;
  const fromMetadataIteration = Number(metadata?.iteration_count);
  const fromMetadataMax = Number(metadata?.max_iterations);
  if (Number.isFinite(fromMetadataIteration)) {
    iteration_count = Math.floor(fromMetadataIteration);
  }
  if (Number.isFinite(fromMetadataMax)) {
    max_iterations = Math.floor(fromMetadataMax);
  }

  const metrics = Array.isArray(eventData.metrics) ? eventData.metrics : [];
  for (const item of metrics) {
    if (!isRecord(item)) continue;
    const key = normalizeOptionalString(item.key);
    const value = Number(item.value);
    if (!Number.isFinite(value) || !key) continue;
    if (key === "iteration_count") iteration_count = Math.floor(value);
    if (key === "max_iterations") max_iterations = Math.floor(value);
  }

  return { iteration_count, max_iterations };
}

function hasRequiredScorecardMetrics(eventData: Record<string, unknown> | undefined): boolean {
  if (!eventData) return false;
  const metrics = eventData.metrics;
  if (!Array.isArray(metrics) || metrics.length === 0) return false;
  for (const metric of metrics) {
    if (!isRecord(metric)) return false;
    if (!normalizeOptionalString(metric.key)) return false;
    const value = Number(metric.value);
    if (!Number.isFinite(value)) return false;
  }
  return true;
}

function scorecardIsPass(eventData: Record<string, unknown> | undefined): boolean {
  if (!eventData) return false;
  const decision = normalizeOptionalString(eventData.decision);
  if (decision === "pass") return true;
  return eventData.pass === true;
}

async function emitRunFailedIncident(
  pool: DbPool,
  input: {
    workspace_id: string;
    run_id: string;
    correlation_id: string;
    actor: { actor_type: ActorType; actor_id: string };
    log?: LoggerLike;
  },
): Promise<void> {
  const idempotency_key = `incident:run_failed:${input.workspace_id}:${input.run_id}`;
  const incident_id = newIncidentId();
  await appendWithIdempotentReplay(pool, {
    workspace_id: input.workspace_id,
    idempotency_key,
    expected_event_type: "incident.opened",
    expected_entity_id: input.run_id,
    log: input.log,
    event: {
      event_id: randomUUID(),
      event_type: "incident.opened",
      event_version: 1,
      occurred_at: new Date().toISOString(),
      workspace_id: input.workspace_id,
      run_id: input.run_id,
      actor: input.actor,
      stream: { stream_type: "workspace", stream_id: input.workspace_id },
      correlation_id: input.correlation_id,
      idempotency_key,
      entity_type: "run",
      entity_id: input.run_id,
      data: {
        incident_id,
        category: "run_failed",
        title: "Run failed triage",
        summary: `run_id=${input.run_id}`,
        severity: "high",
        run_id: input.run_id,
        entity_type: "run",
        entity_id: input.run_id,
      },
      policy_context: {},
      model_context: {},
      display: {},
    } as Parameters<typeof appendToStream>[1],
  });
}

async function emitIterationOverflowIncident(
  pool: DbPool,
  input: {
    workspace_id: string;
    scorecard_id: string;
    run_id?: string;
    correlation_id: string;
    actor: { actor_type: ActorType; actor_id: string };
    log?: LoggerLike;
  },
): Promise<void> {
  const idempotency_key = `incident:iteration_overflow:${input.workspace_id}:${input.scorecard_id}`;
  const incident_id = newIncidentId();
  await appendWithIdempotentReplay(pool, {
    workspace_id: input.workspace_id,
    idempotency_key,
    expected_event_type: "incident.opened",
    expected_entity_id: input.scorecard_id,
    log: input.log,
    event: {
      event_id: randomUUID(),
      event_type: "incident.opened",
      event_version: 1,
      occurred_at: new Date().toISOString(),
      workspace_id: input.workspace_id,
      run_id: input.run_id,
      actor: input.actor,
      stream: { stream_type: "workspace", stream_id: input.workspace_id },
      correlation_id: input.correlation_id,
      idempotency_key,
      entity_type: "scorecard",
      entity_id: input.scorecard_id,
      data: {
        incident_id,
        category: "iteration_overflow",
        title: "Scorecard iteration overflow",
        summary: `scorecard_id=${input.scorecard_id}`,
        severity: "high",
        run_id: input.run_id,
        entity_type: "scorecard",
        entity_id: input.scorecard_id,
      },
      policy_context: {},
      model_context: {},
      display: {},
    } as Parameters<typeof appendToStream>[1],
  });
}

async function emitHumanDecisionMessage(
  pool: DbPool,
  input: {
    workspace_id: string;
    from_agent_id: string;
    to_agent_id?: string;
    idempotency_key: string;
    correlation_id: string;
    summary: string;
    trigger: string;
    run_id?: string;
    scorecard_id?: string;
    log?: LoggerLike;
  },
): Promise<void> {
  const message_id = deterministicMessageId(input.idempotency_key);
  await appendWithIdempotentReplay(pool, {
    workspace_id: input.workspace_id,
    idempotency_key: input.idempotency_key,
    expected_event_type: "message.created",
    expected_entity_id: message_id,
    log: input.log,
    event: {
      event_id: randomUUID(),
      event_type: "message.created",
      event_version: 1,
      occurred_at: new Date().toISOString(),
      workspace_id: input.workspace_id,
      actor: { actor_type: "service", actor_id: "automation-loop" },
      stream: { stream_type: "workspace", stream_id: input.workspace_id },
      correlation_id: input.correlation_id,
      idempotency_key: input.idempotency_key,
      entity_type: "message",
      entity_id: message_id,
      data: {
        schema_version: SCHEMA_VERSION,
        message_id,
        workspace_id: input.workspace_id,
        from_agent_id: input.from_agent_id,
        to_agent_id: input.to_agent_id ?? null,
        correlation_id: input.correlation_id,
        idempotency_key: input.idempotency_key,
        intent: "request_human_decision",
        summary: input.summary.slice(0, 240),
        work_links: {
          run_id: input.run_id ?? null,
          scorecard_id: input.scorecard_id ?? null,
        },
        payload: {
          trigger: input.trigger,
          run_id: input.run_id ?? null,
          scorecard_id: input.scorecard_id ?? null,
        },
        payload_ref: null,
      },
      policy_context: {},
      model_context: {},
      display: {},
    } as Parameters<typeof appendToStream>[1],
  });
}

async function emitApprovalRequestMessage(
  pool: DbPool,
  input: {
    workspace_id: string;
    from_agent_id: string;
    to_agent_id?: string;
    scorecard_id: string;
    run_id?: string;
    correlation_id: string;
    log?: LoggerLike;
  },
): Promise<void> {
  const idempotency_key = `message:request_approval:${input.workspace_id}:${input.scorecard_id}`;
  const message_id = deterministicMessageId(idempotency_key);
  await appendWithIdempotentReplay(pool, {
    workspace_id: input.workspace_id,
    idempotency_key,
    expected_event_type: "message.created",
    expected_entity_id: message_id,
    log: input.log,
    event: {
      event_id: randomUUID(),
      event_type: "message.created",
      event_version: 1,
      occurred_at: new Date().toISOString(),
      workspace_id: input.workspace_id,
      actor: { actor_type: "service", actor_id: "automation-loop" },
      stream: { stream_type: "workspace", stream_id: input.workspace_id },
      correlation_id: input.correlation_id,
      idempotency_key,
      entity_type: "message",
      entity_id: message_id,
      data: {
        schema_version: SCHEMA_VERSION,
        message_id,
        workspace_id: input.workspace_id,
        from_agent_id: input.from_agent_id,
        to_agent_id: input.to_agent_id ?? null,
        correlation_id: input.correlation_id,
        idempotency_key,
        intent: "request_approval",
        summary: `Approval requested for scorecard ${input.scorecard_id}`,
        work_links: {
          run_id: input.run_id ?? null,
          scorecard_id: input.scorecard_id,
        },
        payload: {
          reason: "scorecard_pass",
          run_id: input.run_id ?? null,
          scorecard_id: input.scorecard_id,
        },
        payload_ref: null,
      },
      policy_context: {},
      model_context: {},
      display: {},
    } as Parameters<typeof appendToStream>[1],
  });
}

async function handleRunFailed(pool: DbPool, ctx: AutomationContext): Promise<void> {
  const run_id = normalizeOptionalString(ctx.run_id) ?? normalizeOptionalString(ctx.entity_id);
  if (!run_id) return;

  const revoked = await hasRevokedApprovalForRun(pool, ctx.workspace_id, run_id);
  if (revoked) {
    ctx.log?.debug?.(
      { workspace_id: ctx.workspace_id, run_id, trigger: ctx.trigger },
      "automation skipped run_failed due to approval revocation",
    );
    return;
  }

  const correlation_id = domainCorrelationId(ctx, run_id);
  const actor = resolveActor(ctx);
  await emitRunFailedIncident(pool, {
    workspace_id: ctx.workspace_id,
    run_id,
    correlation_id,
    actor,
    log: ctx.log,
  });

  const activeIncident = await hasActiveIncident(pool, ctx.workspace_id, run_id);
  if (activeIncident) return;

  const risk_tier = await resolveRiskTier(
    pool,
    ctx.workspace_id,
    run_id,
    undefined,
    ctx.risk_tier,
    ctx.event_data,
  );
  if (risk_tier !== "high") return;

  const idempotency_key = `message:request_human_decision:run_failed:${ctx.workspace_id}:${run_id}`;
  const from_agent_id = (await getStableActiveAgentId(pool)) ?? "system";
  const to_agent_id = await getStableActiveAgentId(pool);
  await emitHumanDecisionMessage(pool, {
    workspace_id: ctx.workspace_id,
    from_agent_id,
    to_agent_id: to_agent_id ?? undefined,
    idempotency_key,
    correlation_id,
    summary: `Human decision required for failed run ${run_id}`,
    trigger: "run_failed",
    run_id,
    log: ctx.log,
  });
}

async function handleScorecardRecorded(pool: DbPool, ctx: AutomationContext): Promise<void> {
  const scorecard_id = normalizeOptionalString(ctx.scorecard_id) ?? normalizeOptionalString(ctx.entity_id);
  if (!scorecard_id) return;

  if (!hasRequiredScorecardMetrics(ctx.event_data)) {
    ctx.log?.warn?.(
      { workspace_id: ctx.workspace_id, scorecard_id, trigger: ctx.trigger },
      "automation skipped scorecard due to missing metrics",
    );
    return;
  }

  const run_id = normalizeOptionalString(ctx.run_id) ?? normalizeOptionalString(ctx.event_data?.run_id);
  const correlation_id = domainCorrelationId(ctx, scorecard_id);
  const actor = resolveActor(ctx);
  const risk_tier = await resolveRiskTier(
    pool,
    ctx.workspace_id,
    run_id,
    scorecard_id,
    ctx.risk_tier,
    ctx.event_data,
  );
  const { iteration_count, max_iterations } = extractIterationValues(ctx.event_data);

  if (
    iteration_count != null &&
    max_iterations != null &&
    max_iterations >= 0 &&
    iteration_count > max_iterations
  ) {
    await emitIterationOverflowIncident(pool, {
      workspace_id: ctx.workspace_id,
      scorecard_id,
      run_id: run_id ?? undefined,
      correlation_id,
      actor,
      log: ctx.log,
    });

    if (risk_tier === "high") {
      const idempotency_key = `message:request_human_decision:iteration_overflow:${ctx.workspace_id}:${scorecard_id}`;
      const from_agent_id = (await getStableActiveAgentId(pool)) ?? "system";
      const to_agent_id = await getStableActiveAgentId(pool);
      await emitHumanDecisionMessage(pool, {
        workspace_id: ctx.workspace_id,
        from_agent_id,
        to_agent_id: to_agent_id ?? undefined,
        idempotency_key,
        correlation_id,
        summary: `Human decision required for scorecard iteration overflow ${scorecard_id}`,
        trigger: "iteration_overflow",
        run_id: run_id ?? undefined,
        scorecard_id,
        log: ctx.log,
      });
    }
  }

  if (!scorecardIsPass(ctx.event_data)) return;
  if (!run_id) {
    ctx.log?.debug?.(
      { workspace_id: ctx.workspace_id, scorecard_id, trigger: ctx.trigger },
      "automation skipped approval request due to missing run_id",
    );
    return;
  }

  const hasRun = await hasRunEventsForRun(pool, ctx.workspace_id, run_id);
  if (!hasRun) {
    ctx.log?.warn?.(
      { workspace_id: ctx.workspace_id, scorecard_id, run_id, trigger: ctx.trigger },
      "automation orphan scorecard guard blocked promotion",
    );
    return;
  }

  const terminalRun = await isRunTerminal(pool, ctx.workspace_id, run_id);
  if (terminalRun) return;
  const activeIncident = await hasActiveIncident(pool, ctx.workspace_id, run_id);
  if (activeIncident) return;

  const from_agent_id = (await getStableActiveAgentId(pool)) ?? "system";
  const to_agent_id = await getStableActiveAgentId(pool);
  await emitApprovalRequestMessage(pool, {
    workspace_id: ctx.workspace_id,
    from_agent_id,
    to_agent_id: to_agent_id ?? undefined,
    scorecard_id,
    run_id,
    correlation_id,
    log: ctx.log,
  });
}

async function emitFallbackIncident(pool: DbPool, ctx: AutomationContext, err: unknown): Promise<void> {
  const reason = err instanceof Error ? err.message : String(err);
  const subjectId = normalizeOptionalString(ctx.run_id) ?? normalizeOptionalString(ctx.scorecard_id) ?? ctx.entity_id;
  const correlation_id = domainCorrelationId(ctx, subjectId);
  const idempotency_key = `incident:automation_internal_error:${ctx.workspace_id}:${ctx.entity_type}:${ctx.entity_id}:${ctx.trigger}`;

  await appendWithIdempotentReplay(pool, {
    workspace_id: ctx.workspace_id,
    idempotency_key,
    expected_event_type: "incident.opened",
    expected_entity_id: subjectId,
    log: ctx.log,
    event: {
      event_id: randomUUID(),
      event_type: "incident.opened",
      event_version: 1,
      occurred_at: new Date().toISOString(),
      workspace_id: ctx.workspace_id,
      run_id: normalizeOptionalString(ctx.run_id),
      actor: { actor_type: "service", actor_id: "automation-loop" },
      stream: { stream_type: "workspace", stream_id: ctx.workspace_id },
      correlation_id,
      idempotency_key,
      entity_type: ctx.entity_type,
      entity_id: subjectId,
      data: {
        incident_id: newIncidentId(),
        category: "run_failed",
        title: "Automation internal error",
        summary: `automation_internal_error trigger=${ctx.trigger}`,
        severity: "medium",
        entity_type: ctx.entity_type,
        entity_id: subjectId,
        details: {
          trigger: ctx.trigger,
          error: reason.slice(0, 500),
        },
      },
      policy_context: {},
      model_context: {},
      display: {},
    } as Parameters<typeof appendToStream>[1],
  });
}

export async function getLatestEvent(
  queryable: Queryable,
  params: {
    workspace_id: string;
    entity_type: string;
    entity_id: string;
    event_types?: string[];
  },
): Promise<LatestEventRow | null> {
  const { workspace_id, entity_type, entity_id, event_types } = params;
  const args: unknown[] = [workspace_id, entity_type, entity_id];
  const where: string[] = ["workspace_id = $1", "entity_type = $2", "entity_id = $3"];

  if (event_types && event_types.length > 0) {
    args.push(event_types);
    where.push(`event_type = ANY($${args.length}::text[])`);
  }

  const queryWithStreamSeq = `SELECT
      event_id,
      event_type,
      occurred_at::text AS occurred_at,
      stream_seq,
      entity_type,
      entity_id,
      run_id,
      correlation_id
    FROM evt_events
    WHERE ${where.join(" AND ")}
    ORDER BY occurred_at DESC, stream_seq DESC, event_id DESC
    LIMIT 1`;

  try {
    const withSeq = await queryable.query<LatestEventRow>(queryWithStreamSeq, args);
    return withSeq.rowCount === 1 ? withSeq.rows[0] : null;
  } catch (err) {
    if (!isUndefinedColumn(err)) throw err;
  }

  const queryWithoutStreamSeq = `SELECT
      event_id,
      event_type,
      occurred_at::text AS occurred_at,
      NULL::bigint AS stream_seq,
      entity_type,
      entity_id,
      run_id,
      correlation_id
    FROM evt_events
    WHERE ${where.join(" AND ")}
    ORDER BY occurred_at DESC, event_id DESC
    LIMIT 1`;

  const fallback = await queryable.query<LatestEventRow>(queryWithoutStreamSeq, args);
  return fallback.rowCount === 1 ? fallback.rows[0] : null;
}

async function runAutomationLogic(pool: DbPool, ctx: AutomationContext): Promise<void> {
  if (process.env.AUTOMATION_FAIL_TEST === "1") {
    throw new Error("automation_fail_test");
  }

  if (ctx.trigger === "run.failed") {
    await handleRunFailed(pool, ctx);
    return;
  }
  if (ctx.trigger === "scorecard.recorded") {
    await handleScorecardRecorded(pool, ctx);
  }
}

async function runAutomationWithRetry(pool: DbPool, ctx: AutomationContext): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await runAutomationLogic(pool, ctx);
      return;
    } catch (err) {
      lastError = err;
      ctx.log?.warn?.(
        {
          workspace_id: ctx.workspace_id,
          entity_type: ctx.entity_type,
          entity_id: ctx.entity_id,
          trigger: ctx.trigger,
          attempt: attempt + 1,
          err,
        },
        "automation attempt failed",
      );
    }
  }
  throw lastError;
}

export async function applyAutomation(pool: DbPool, ctx: AutomationContext): Promise<void> {
  if (!isAutomationEnabled()) {
    ctx.log?.debug?.(
      {
        workspace_id: ctx.workspace_id,
        entity_type: ctx.entity_type,
        entity_id: ctx.entity_id,
        trigger: ctx.trigger,
      },
      "automation: kill switch active",
    );
    return;
  }

  try {
    await runAutomationWithRetry(pool, ctx);
  } catch (err) {
    ctx.log?.error?.(
      {
        workspace_id: ctx.workspace_id,
        entity_type: ctx.entity_type,
        entity_id: ctx.entity_id,
        trigger: ctx.trigger,
        err,
      },
      "automation loop failed",
    );
    try {
      await emitFallbackIncident(pool, ctx, err);
    } catch (fallbackErr) {
      ctx.log?.error?.(
        {
          workspace_id: ctx.workspace_id,
          entity_type: ctx.entity_type,
          entity_id: ctx.entity_id,
          trigger: ctx.trigger,
          err: fallbackErr,
        },
        "automation fallback incident failed",
      );
    }
  }
}

export { isUniqueViolation };
