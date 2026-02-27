import { randomUUID } from "node:crypto";

import type { EventEnvelopeV1 } from "@agentapp/shared";
import { newIncidentId } from "@agentapp/shared";

import type { DbClient, DbPool } from "../db/pool.js";
import { appendToStream } from "../eventStore/index.js";
import type { HeartCronConfig } from "./config.js";

type Queryable = DbPool | DbClient;

type SweepJob = "approval_timeout" | "run_stuck" | "demoted_stale" | "watchdog";

type SweepCounter = {
  scanned: number;
  emitted: number;
  replayed: number;
  skipped_locked: number;
  skipped_condition: number;
  errors: number;
};

type ApprovalCandidate = {
  approval_id: string;
};

type RunCandidate = {
  run_id: string;
};

type ApprovalLockedRow = {
  approval_id: string;
  room_id: string | null;
  thread_id: string | null;
  run_id: string | null;
  correlation_id: string;
  title: string | null;
  status: "pending" | "held";
  server_time: string;
};

type RunLockedRow = {
  run_id: string;
  room_id: string | null;
  thread_id: string | null;
  correlation_id: string;
  title: string | null;
  status: "queued" | "running" | "failed";
  server_time: string;
};

type CronIncidentEnvelope = EventEnvelopeV1 & {
  entity_type: string;
  entity_id: string;
};

const TRIAGE_ERROR_CODES = [
  "policy_denied",
  "approval_required",
  "permission_denied",
  "external_write_kill_switch",
] as const;
const WORKSPACE_DISCOVERY_LIMIT = 1000;

function clampBatchLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 100;
  return Math.max(1, Math.min(100, Math.floor(limit)));
}

function msToWholeSeconds(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 1;
  return Math.max(1, Math.floor(ms / 1000));
}

function isNowaitLockUnavailable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  return (err as { code?: string }).code === "55P03";
}

function isIdempotencyReplayUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const pgError = err as { code?: string; constraint?: string };
  if (pgError.code !== "23505") return false;
  if (typeof pgError.constraint !== "string") return false;
  return pgError.constraint.includes("idempotency");
}

function makeIdempotencyKey(input: {
  job: SweepJob;
  workspaceId: string;
  entity_type: string;
  entity_id: string;
  anchor: string;
}): string {
  return `cron:${input.job}:${input.workspaceId}:${input.entity_type}:${input.entity_id}:${input.anchor}`;
}

async function rollbackQuietly(client: DbClient): Promise<void> {
  await client.query("ROLLBACK").catch(() => {});
}

async function emitIncidentInTx(
  pool: DbPool,
  client: DbClient,
  input: {
    job: SweepJob;
    workspaceId: string;
    entityType: string;
    entityId: string;
    roomId?: string | null;
    threadId?: string | null;
    runId?: string | null;
    correlationId: string;
    title: string;
    summary: string;
    occurredAt: string;
    windowAnchor: string;
  },
): Promise<void> {
  const idempotency_key = makeIdempotencyKey({
    job: input.job,
    workspaceId: input.workspaceId,
    entity_type: input.entityType,
    entity_id: input.entityId,
    anchor: input.windowAnchor,
  });

  const event: CronIncidentEnvelope = {
    event_id: randomUUID(),
    event_type: "incident.opened",
    event_version: 1,
    occurred_at: input.occurredAt,
    workspace_id: input.workspaceId,
    room_id: input.roomId ?? undefined,
    thread_id: input.threadId ?? undefined,
    run_id: input.runId ?? undefined,
    actor: {
      actor_type: "service",
      actor_id: "cron",
    },
    stream: {
      stream_type: "workspace",
      stream_id: input.workspaceId,
    },
    correlation_id: input.correlationId,
    idempotency_key,
    entity_type: input.entityType,
    entity_id: input.entityId,
    data: {
      incident_id: newIncidentId(),
      category: `cron.${input.job}`,
      title: input.title,
      summary: input.summary,
      severity: "medium",
      run_id: input.runId ?? null,
      entity_type: input.entityType,
      entity_id: input.entityId,
      source: "cron",
      cron_job: input.job,
      window_anchor: input.windowAnchor,
      workspace_id: input.workspaceId,
      work_item_type: input.entityType,
      work_item_id: input.entityId,
    },
    policy_context: {},
    model_context: {},
    display: {},
  };

  await appendToStream(pool, event, client);
}

async function processApprovalTimeoutCandidate(
  pool: DbPool,
  workspaceId: string,
  approvalId: string,
  timeoutSec: number,
  cfg: HeartCronConfig,
): Promise<keyof SweepCounter> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let locked: ApprovalLockedRow | null = null;
    try {
      const lockRes = await client.query<ApprovalLockedRow>(
        `SELECT
           approval_id,
           room_id,
           thread_id,
           run_id,
           correlation_id,
           title,
           status,
           now()::text AS server_time
         FROM proj_approvals
         WHERE workspace_id = $1
           AND approval_id = $2
           AND status IN ('pending', 'held')
           AND updated_at < (now() - make_interval(secs => $3))
         FOR UPDATE NOWAIT`,
        [workspaceId, approvalId, timeoutSec],
      );
      locked = lockRes.rows[0] ?? null;
    } catch (err) {
      if (!isNowaitLockUnavailable(err)) throw err;
      await rollbackQuietly(client);
      return "skipped_locked";
    }

    if (!locked) {
      await rollbackQuietly(client);
      return "skipped_condition";
    }

    const windowAnchor = await getWindowAnchor(client, cfg.windowSec);
    const title = locked.title?.trim() || "Approval timed out";

    try {
      await emitIncidentInTx(pool, client, {
        job: "approval_timeout",
        workspaceId,
        entityType: "approval",
        entityId: locked.approval_id,
        roomId: locked.room_id,
        threadId: locked.thread_id,
        runId: locked.run_id,
        correlationId: locked.correlation_id,
        title,
        summary: "Approval remained pending beyond timeout threshold.",
        occurredAt: locked.server_time,
        windowAnchor,
      });
    } catch (err) {
      if (!isIdempotencyReplayUniqueViolation(err)) throw err;
      await rollbackQuietly(client);
      return "replayed";
    }

    await client.query("COMMIT");
    return "emitted";
  } catch {
    await rollbackQuietly(client);
    return "errors";
  } finally {
    client.release();
  }
}

async function processRunStuckCandidate(
  pool: DbPool,
  workspaceId: string,
  runId: string,
  timeoutSec: number,
  cfg: HeartCronConfig,
): Promise<keyof SweepCounter> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let locked: RunLockedRow | null = null;
    try {
      const lockRes = await client.query<RunLockedRow>(
        `SELECT
           run_id,
           room_id,
           thread_id,
           correlation_id,
           title,
           status,
           now()::text AS server_time
         FROM proj_runs
         WHERE workspace_id = $1
           AND run_id = $2
           AND status IN ('queued', 'running')
           AND updated_at < (now() - make_interval(secs => $3))
         FOR UPDATE NOWAIT`,
        [workspaceId, runId, timeoutSec],
      );
      locked = lockRes.rows[0] ?? null;
    } catch (err) {
      if (!isNowaitLockUnavailable(err)) throw err;
      await rollbackQuietly(client);
      return "skipped_locked";
    }

    if (!locked) {
      await rollbackQuietly(client);
      return "skipped_condition";
    }

    const windowAnchor = await getWindowAnchor(client, cfg.windowSec);
    const title = locked.title?.trim() || "Run stuck";

    try {
      await emitIncidentInTx(pool, client, {
        job: "run_stuck",
        workspaceId,
        entityType: "run",
        entityId: locked.run_id,
        roomId: locked.room_id,
        threadId: locked.thread_id,
        runId: locked.run_id,
        correlationId: locked.correlation_id,
        title,
        summary: "Run remained queued/running beyond stuck timeout threshold.",
        occurredAt: locked.server_time,
        windowAnchor,
      });
    } catch (err) {
      if (!isIdempotencyReplayUniqueViolation(err)) throw err;
      await rollbackQuietly(client);
      return "replayed";
    }

    await client.query("COMMIT");
    return "emitted";
  } catch {
    await rollbackQuietly(client);
    return "errors";
  } finally {
    client.release();
  }
}

async function processDemotedStaleCandidate(
  pool: DbPool,
  workspaceId: string,
  runId: string,
  staleSec: number,
  cfg: HeartCronConfig,
): Promise<keyof SweepCounter> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let locked: RunLockedRow | null = null;
    try {
      const lockRes = await client.query<RunLockedRow>(
        `SELECT
           r.run_id,
           r.room_id,
           r.thread_id,
           r.correlation_id,
           r.title,
           r.status,
           now()::text AS server_time
         FROM proj_runs AS r
         WHERE r.workspace_id = $1
           AND r.run_id = $2
           AND r.status = 'failed'
           AND r.updated_at < (now() - make_interval(secs => $3))
           AND NOT (
             EXISTS (
               SELECT 1
               FROM proj_incidents AS i
               WHERE i.workspace_id = r.workspace_id
                 AND i.status = 'open'
                 AND (i.run_id = r.run_id OR i.correlation_id = r.correlation_id)
             )
             OR COALESCE(r.error->>'code', '') = ANY($4::text[])
             OR COALESCE(r.error->>'kind', '') = 'policy'
           )
         FOR UPDATE NOWAIT`,
        [workspaceId, runId, staleSec, TRIAGE_ERROR_CODES],
      );
      locked = lockRes.rows[0] ?? null;
    } catch (err) {
      if (!isNowaitLockUnavailable(err)) throw err;
      await rollbackQuietly(client);
      return "skipped_locked";
    }

    if (!locked) {
      await rollbackQuietly(client);
      return "skipped_condition";
    }

    const windowAnchor = await getWindowAnchor(client, cfg.windowSec);
    const title = locked.title?.trim() || "Demoted stale run";

    try {
      await emitIncidentInTx(pool, client, {
        job: "demoted_stale",
        workspaceId,
        entityType: "run",
        entityId: locked.run_id,
        roomId: locked.room_id,
        threadId: locked.thread_id,
        runId: locked.run_id,
        correlationId: locked.correlation_id,
        title,
        summary: "Demoted run remained stale beyond threshold.",
        occurredAt: locked.server_time,
        windowAnchor,
      });
    } catch (err) {
      if (!isIdempotencyReplayUniqueViolation(err)) throw err;
      await rollbackQuietly(client);
      return "replayed";
    }

    await client.query("COMMIT");
    return "emitted";
  } catch {
    await rollbackQuietly(client);
    return "errors";
  } finally {
    client.release();
  }
}

function blankCounter(scanned = 0): SweepCounter {
  return {
    scanned,
    emitted: 0,
    replayed: 0,
    skipped_locked: 0,
    skipped_condition: 0,
    errors: 0,
  };
}

export async function getWindowAnchor(poolOrClient: Queryable, windowSec: number): Promise<string> {
  const safeWindowSec = Math.max(1, Math.floor(windowSec));
  const res = await poolOrClient.query<{ anchor: string }>(
    `SELECT to_char(
       to_timestamp(floor(extract(epoch FROM now()) / $1) * $1) AT TIME ZONE 'utc',
       'YYYY-MM-DD"T"HH24:MI:SS"Z"'
     ) AS anchor`,
    [safeWindowSec],
  );
  return res.rows[0]?.anchor ?? "1970-01-01T00:00:00Z";
}

export async function emitWatchdogIncident(
  pool: DbPool,
  input: {
    workspaceId: string;
    failureCount: number;
    message: string;
    windowSec: number;
  },
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const anchor = await getWindowAnchor(client, input.windowSec);
    const serverNow = await client.query<{ server_time: string }>(
      `SELECT now()::text AS server_time`,
    );
    const occurredAt = serverNow.rows[0]?.server_time;
    if (!occurredAt) {
      throw new Error("cron_watchdog_server_time_missing");
    }

    try {
      await emitIncidentInTx(pool, client, {
        job: "watchdog",
        workspaceId: input.workspaceId,
        entityType: "cron",
        entityId: "heart_cron",
        correlationId: `${input.workspaceId}:watchdog:heart_cron`,
        title: "Cron watchdog alert",
        summary: input.message,
        occurredAt,
        windowAnchor: anchor,
      });
    } catch (err) {
      if (!isIdempotencyReplayUniqueViolation(err)) throw err;
      await rollbackQuietly(client);
      return;
    }

    await client.query("COMMIT");
  } catch {
    await rollbackQuietly(client);
    throw new Error("cron_watchdog_emit_failed");
  } finally {
    client.release();
  }
}

export async function listCandidateWorkspaces(
  pool: DbPool,
  cfg: HeartCronConfig,
): Promise<string[]> {
  const approvalTimeoutSec = msToWholeSeconds(cfg.approvalTimeoutMs);
  const runStuckTimeoutSec = msToWholeSeconds(cfg.runStuckTimeoutMs);
  const demotedStaleSec = msToWholeSeconds(cfg.demotedStaleMs);

  const [approvalWs, runWs, demotedWs] = await Promise.all([
    pool.query<{ workspace_id: string }>(
      `SELECT DISTINCT workspace_id
       FROM proj_approvals
       WHERE status IN ('pending', 'held')
         AND updated_at < (now() - make_interval(secs => $1))
       ORDER BY workspace_id ASC
       LIMIT $2`,
      [approvalTimeoutSec, WORKSPACE_DISCOVERY_LIMIT],
    ),
    pool.query<{ workspace_id: string }>(
      `SELECT DISTINCT workspace_id
       FROM proj_runs
       WHERE status IN ('queued', 'running')
         AND updated_at < (now() - make_interval(secs => $1))
       ORDER BY workspace_id ASC
       LIMIT $2`,
      [runStuckTimeoutSec, WORKSPACE_DISCOVERY_LIMIT],
    ),
    pool.query<{ workspace_id: string }>(
      `SELECT DISTINCT r.workspace_id
       FROM proj_runs AS r
       WHERE r.status = 'failed'
         AND r.updated_at < (now() - make_interval(secs => $1))
         AND NOT (
           EXISTS (
             SELECT 1
             FROM proj_incidents AS i
             WHERE i.workspace_id = r.workspace_id
               AND i.status = 'open'
               AND (i.run_id = r.run_id OR i.correlation_id = r.correlation_id)
           )
           OR COALESCE(r.error->>'code', '') = ANY($2::text[])
           OR COALESCE(r.error->>'kind', '') = 'policy'
         )
       ORDER BY r.workspace_id ASC
       LIMIT $3`,
      [demotedStaleSec, TRIAGE_ERROR_CODES, WORKSPACE_DISCOVERY_LIMIT],
    ),
  ]);

  const workspaces = new Set<string>();
  for (const row of approvalWs.rows) workspaces.add(row.workspace_id);
  for (const row of runWs.rows) workspaces.add(row.workspace_id);
  for (const row of demotedWs.rows) workspaces.add(row.workspace_id);

  return [...workspaces].sort((a, b) => a.localeCompare(b));
}

export async function runApprovalTimeoutSweep(
  pool: DbPool,
  workspaceId: string,
  cfg: HeartCronConfig,
  stopSignal?: () => boolean,
): Promise<SweepCounter> {
  const timeoutSec = msToWholeSeconds(cfg.approvalTimeoutMs);
  const batchLimit = clampBatchLimit(cfg.batchLimit);
  const candidates = await pool.query<ApprovalCandidate>(
    `SELECT approval_id
     FROM proj_approvals
     WHERE workspace_id = $1
       AND status IN ('pending', 'held')
       AND updated_at < (now() - make_interval(secs => $2))
     ORDER BY updated_at ASC, approval_id ASC
     LIMIT $3`,
    [workspaceId, timeoutSec, batchLimit],
  );

  const counter = blankCounter(candidates.rowCount ?? 0);
  for (const row of candidates.rows) {
    if (stopSignal?.()) break;
    const resultKey = await processApprovalTimeoutCandidate(pool, workspaceId, row.approval_id, timeoutSec, cfg);
    counter[resultKey] += 1;
  }
  return counter;
}

export async function runRunStuckSweep(
  pool: DbPool,
  workspaceId: string,
  cfg: HeartCronConfig,
  stopSignal?: () => boolean,
): Promise<SweepCounter> {
  const timeoutSec = msToWholeSeconds(cfg.runStuckTimeoutMs);
  const batchLimit = clampBatchLimit(cfg.batchLimit);
  const candidates = await pool.query<RunCandidate>(
    `SELECT run_id
     FROM proj_runs
     WHERE workspace_id = $1
       AND status IN ('queued', 'running')
       AND updated_at < (now() - make_interval(secs => $2))
     ORDER BY updated_at ASC, run_id ASC
     LIMIT $3`,
    [workspaceId, timeoutSec, batchLimit],
  );

  const counter = blankCounter(candidates.rowCount ?? 0);
  for (const row of candidates.rows) {
    if (stopSignal?.()) break;
    const resultKey = await processRunStuckCandidate(pool, workspaceId, row.run_id, timeoutSec, cfg);
    counter[resultKey] += 1;
  }
  return counter;
}

export async function runDemotedStaleSweep(
  pool: DbPool,
  workspaceId: string,
  cfg: HeartCronConfig,
  stopSignal?: () => boolean,
): Promise<SweepCounter> {
  const staleSec = msToWholeSeconds(cfg.demotedStaleMs);
  const batchLimit = clampBatchLimit(cfg.batchLimit);
  const candidates = await pool.query<RunCandidate>(
    `SELECT r.run_id
     FROM proj_runs AS r
     WHERE r.workspace_id = $1
       AND r.status = 'failed'
       AND r.updated_at < (now() - make_interval(secs => $2))
       AND NOT (
         EXISTS (
           SELECT 1
           FROM proj_incidents AS i
           WHERE i.workspace_id = r.workspace_id
             AND i.status = 'open'
             AND (i.run_id = r.run_id OR i.correlation_id = r.correlation_id)
         )
         OR COALESCE(r.error->>'code', '') = ANY($3::text[])
         OR COALESCE(r.error->>'kind', '') = 'policy'
       )
     ORDER BY r.updated_at ASC, r.run_id ASC
     LIMIT $4`,
    [workspaceId, staleSec, TRIAGE_ERROR_CODES, batchLimit],
  );

  const counter = blankCounter(candidates.rowCount ?? 0);
  for (const row of candidates.rows) {
    if (stopSignal?.()) break;
    const resultKey = await processDemotedStaleCandidate(pool, workspaceId, row.run_id, staleSec, cfg);
    counter[resultKey] += 1;
  }
  return counter;
}
