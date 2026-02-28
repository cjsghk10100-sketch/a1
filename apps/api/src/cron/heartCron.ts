import { randomUUID } from "node:crypto";

import type { DbPool } from "../db/pool.js";
import { loadHeartCronConfig, type HeartCronConfig } from "./config.js";
import { readCronHealth, recordCronFailure, recordCronSuccess, shouldRunCron } from "./health.js";
import { acquireLock, heartbeatLock, LockLostError, releaseLock } from "./lock.js";
import {
  emitWatchdogIncident,
  listCandidateWorkspaces,
  runApprovalTimeoutSweep,
  runDemotedStaleSweep,
  runRunStuckSweep,
} from "./sweeps.js";

export const HEART_CRON_LOCK_NAME = "heart_cron";
export const HEART_CRON_CHECK_NAME = "heart_cron";

type LoggerLike = {
  info?: (obj: unknown, msg?: string) => void;
  warn?: (obj: unknown, msg?: string) => void;
  error?: (obj: unknown, msg?: string) => void;
};

type TickHeartCronOptions = {
  onLockAcquired?: (input: { lock_token: string; holder_id: string }) => Promise<void> | void;
  configOverride?: HeartCronConfig;
};

type SweepCounts = {
  approval_timeout: Awaited<ReturnType<typeof runApprovalTimeoutSweep>>;
  run_stuck: Awaited<ReturnType<typeof runRunStuckSweep>>;
  demoted_stale: Awaited<ReturnType<typeof runDemotedStaleSweep>>;
};

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function randomJitterMs(maxMs: number): number {
  if (!Number.isFinite(maxMs) || maxMs <= 0) return 0;
  return Math.floor(Math.random() * (maxMs + 1));
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const limit = Math.max(1, Math.min(items.length || 1, concurrency));
  let cursor = 0;
  let fatalError: unknown = null;

  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      if (fatalError) return;
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        await worker(items[index]);
      } catch (err) {
        fatalError = err;
        return;
      }
    }
  });

  await Promise.all(workers);
  if (fatalError) throw fatalError;
}

function sumCounts(rows: SweepCounts[]): SweepCounts {
  const base = {
    scanned: 0,
    emitted: 0,
    replayed: 0,
    skipped_locked: 0,
    skipped_condition: 0,
    errors: 0,
  };
  const totals: SweepCounts = {
    approval_timeout: { ...base },
    run_stuck: { ...base },
    demoted_stale: { ...base },
  };
  for (const row of rows) {
    for (const key of ["approval_timeout", "run_stuck", "demoted_stale"] as const) {
      totals[key].scanned += row[key].scanned;
      totals[key].emitted += row[key].emitted;
      totals[key].replayed += row[key].replayed;
      totals[key].skipped_locked += row[key].skipped_locked;
      totals[key].skipped_condition += row[key].skipped_condition;
      totals[key].errors += row[key].errors;
    }
  }
  return totals;
}

export async function tickHeartCron(
  pool: DbPool,
  options: TickHeartCronOptions = {},
): Promise<void> {
  const cfg = options.configOverride ?? loadHeartCronConfig();
  const jitterMs = randomJitterMs(cfg.jitterMaxMs);
  await sleep(jitterMs);

  const canRun = await shouldRunCron(pool, HEART_CRON_CHECK_NAME, cfg.watchdogHaltThreshold);
  if (!canRun) return;

  const holder_id = `cron:${process.pid}:${randomUUID()}`;
  const acquired = await acquireLock(pool, HEART_CRON_LOCK_NAME, holder_id, cfg.lockLeaseMs);
  if (!acquired) return;

  let lockLost = false;
  let lockLostError: unknown = null;
  let currentWorkspace: string | null = null;
  let workspaceCount = 0;
  const perWorkspaceCounts: SweepCounts[] = [];
  const lock_token = acquired.lock_token;

  let heartbeatInFlight = false;
  const heartbeatTimer = setInterval(() => {
    if (heartbeatInFlight || lockLost) return;
    heartbeatInFlight = true;
    void heartbeatLock(pool, HEART_CRON_LOCK_NAME, lock_token, cfg.lockLeaseMs)
      .catch((err) => {
        lockLost = true;
        lockLostError = err;
      })
      .finally(() => {
        heartbeatInFlight = false;
      });
  }, cfg.lockHeartbeatMs);

  try {
    await options.onLockAcquired?.({ lock_token, holder_id });
    await heartbeatLock(pool, HEART_CRON_LOCK_NAME, lock_token, cfg.lockLeaseMs);

    const workspaceIds = await listCandidateWorkspaces(pool, cfg);
    workspaceCount = workspaceIds.length;

    await runWithConcurrency(
      workspaceIds,
      cfg.workspaceConcurrency,
      async (workspaceId) => {
        if (lockLost) throw lockLostError ?? new LockLostError();
        currentWorkspace = workspaceId;

        const stopSignal = () => lockLost;
        const approval = await runApprovalTimeoutSweep(pool, workspaceId, cfg, stopSignal);
        if (lockLost) throw lockLostError ?? new LockLostError();

        const stuck = await runRunStuckSweep(pool, workspaceId, cfg, stopSignal);
        if (lockLost) throw lockLostError ?? new LockLostError();

        const demoted = await runDemotedStaleSweep(pool, workspaceId, cfg, stopSignal);
        if (lockLost) throw lockLostError ?? new LockLostError();

        perWorkspaceCounts.push({
          approval_timeout: approval,
          run_stuck: stuck,
          demoted_stale: demoted,
        });
      },
    );

    const totals = sumCounts(perWorkspaceCounts);
    const totalErrors =
      totals.approval_timeout.errors + totals.run_stuck.errors + totals.demoted_stale.errors;
    if (totalErrors > 0) {
      throw new Error(`heart_cron_sweep_errors:${totalErrors}`);
    }
    await recordCronSuccess(pool, HEART_CRON_CHECK_NAME, {
      source: "cron",
      lock_name: HEART_CRON_LOCK_NAME,
      holder_id,
      workspace_count: workspaceCount,
      jitter_ms: jitterMs,
      counts: totals,
    });
  } catch (err) {
    const failureCount = await recordCronFailure(pool, HEART_CRON_CHECK_NAME, toErrorMessage(err), {
      source: "cron",
      lock_name: HEART_CRON_LOCK_NAME,
      holder_id,
      workspace_count: workspaceCount,
      current_workspace: currentWorkspace,
    });

    if (failureCount >= cfg.watchdogAlertThreshold) {
      const watchdogWorkspace =
        currentWorkspace ??
        process.env.CRON_WATCHDOG_WORKSPACE_ID?.trim() ??
        "ws_dev";

      await emitWatchdogIncident(pool, {
        workspaceId: watchdogWorkspace,
        failureCount,
        message: `heart_cron failures=${failureCount}: ${toErrorMessage(err)}`,
        windowSec: cfg.windowSec,
      }).catch(() => {});
    }

    throw err;
  } finally {
    clearInterval(heartbeatTimer);
    await releaseLock(pool, HEART_CRON_LOCK_NAME, lock_token).catch(() => {});
  }
}

export function startHeartCron(pool: DbPool, logger?: LoggerLike): (() => void) | null {
  if (process.env.CRON_HEART_ENABLED !== "1") return null;
  const cfg = loadHeartCronConfig();
  let running = false;
  let stopped = false;

  const runTick = async (): Promise<void> => {
    if (stopped || running) return;
    running = true;
    try {
      await tickHeartCron(pool, { configOverride: cfg });
    } catch (err) {
      logger?.error?.({ err }, "heart cron tick failed");
    } finally {
      running = false;
    }
  };

  void runTick();
  const timer = setInterval(() => {
    void runTick();
  }, cfg.tickIntervalMs);

  logger?.info?.(
    {
      source: "cron",
      lock_name: HEART_CRON_LOCK_NAME,
      tick_interval_ms: cfg.tickIntervalMs,
      lock_lease_ms: cfg.lockLeaseMs,
      heartbeat_ms: cfg.lockHeartbeatMs,
      workspace_concurrency: cfg.workspaceConcurrency,
      batch_limit: cfg.batchLimit,
    },
    "heart cron enabled",
  );

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

export async function readHeartCronHealth(pool: DbPool): Promise<{
  halted: boolean;
  last_success_at: string | null;
  last_failure_at: string | null;
  consecutive_failures: number;
  last_error: string | null;
  metadata: unknown;
}> {
  const cfg = loadHeartCronConfig();
  const health = await readCronHealth(pool, HEART_CRON_CHECK_NAME);
  if (!health) {
    return {
      halted: false,
      last_success_at: null,
      last_failure_at: null,
      consecutive_failures: 0,
      last_error: null,
      metadata: {},
    };
  }
  return {
    halted: health.consecutive_failures >= cfg.watchdogHaltThreshold,
    last_success_at: health.last_success_at,
    last_failure_at: health.last_failure_at,
    consecutive_failures: health.consecutive_failures,
    last_error: health.last_error,
    metadata: health.metadata,
  };
}
