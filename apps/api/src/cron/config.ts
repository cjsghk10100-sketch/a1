export interface HeartCronConfig {
  lockLeaseMs: number;
  lockHeartbeatMs: number;
  tickIntervalMs: number;
  jitterMaxMs: number;
  batchLimit: number;
  approvalTimeoutMs: number;
  runStuckTimeoutMs: number;
  demotedStaleMs: number;
  watchdogAlertThreshold: number;
  watchdogHaltThreshold: number;
  workspaceConcurrency: number;
  windowSec: number;
}

const DEFAULT_LOCK_LEASE_MS = 30_000;
const DEFAULT_LOCK_HEARTBEAT_MS = 10_000;
const DEFAULT_TICK_INTERVAL_MS = 60_000;
const DEFAULT_JITTER_MAX_MS = 5_000;
const DEFAULT_BATCH_LIMIT = 100;
const DEFAULT_APPROVAL_TIMEOUT_MS = 300_000;
const DEFAULT_RUN_STUCK_TIMEOUT_MS = 600_000;
const DEFAULT_DEMOTED_STALE_MS = 86_400_000;
const DEFAULT_WATCHDOG_ALERT_THRESHOLD = 3;
const DEFAULT_WATCHDOG_HALT_THRESHOLD = 5;
const DEFAULT_WORKSPACE_CONCURRENCY = 4;
const DEFAULT_WINDOW_SEC = 300;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function parseNonNegativeInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

export function loadHeartCronConfig(): HeartCronConfig {
  const lockLeaseMs = parsePositiveInt(process.env.CRON_LOCK_LEASE_MS, DEFAULT_LOCK_LEASE_MS);
  const heartbeatRaw = parsePositiveInt(process.env.CRON_LOCK_HEARTBEAT_MS, DEFAULT_LOCK_HEARTBEAT_MS);
  const lockHeartbeatMs = Math.max(100, Math.min(heartbeatRaw, Math.floor(lockLeaseMs / 3)));

  const requestedBatchLimit = parsePositiveInt(process.env.CRON_BATCH_LIMIT, DEFAULT_BATCH_LIMIT);
  const batchLimit = Math.max(1, Math.min(100, requestedBatchLimit));

  const requestedConcurrency = parsePositiveInt(
    process.env.CRON_WORKSPACE_CONCURRENCY,
    DEFAULT_WORKSPACE_CONCURRENCY,
  );
  const workspaceConcurrency =
    process.env.NODE_ENV === "test" ? 1 : Math.max(1, requestedConcurrency);

  const windowSec = parsePositiveInt(process.env.CRON_WINDOW_SEC, DEFAULT_WINDOW_SEC);

  return {
    lockLeaseMs,
    lockHeartbeatMs,
    tickIntervalMs: parsePositiveInt(process.env.CRON_TICK_INTERVAL_MS, DEFAULT_TICK_INTERVAL_MS),
    jitterMaxMs: parseNonNegativeInt(process.env.CRON_JITTER_MAX_MS, DEFAULT_JITTER_MAX_MS),
    batchLimit,
    approvalTimeoutMs: parsePositiveInt(process.env.CRON_APPROVAL_TIMEOUT_MS, DEFAULT_APPROVAL_TIMEOUT_MS),
    runStuckTimeoutMs: parsePositiveInt(process.env.CRON_RUN_STUCK_TIMEOUT_MS, DEFAULT_RUN_STUCK_TIMEOUT_MS),
    demotedStaleMs: parsePositiveInt(process.env.CRON_DEMOTED_STALE_MS, DEFAULT_DEMOTED_STALE_MS),
    watchdogAlertThreshold: parsePositiveInt(
      process.env.CRON_WATCHDOG_ALERT_THRESHOLD,
      DEFAULT_WATCHDOG_ALERT_THRESHOLD,
    ),
    watchdogHaltThreshold: parsePositiveInt(
      process.env.CRON_WATCHDOG_HALT_THRESHOLD,
      DEFAULT_WATCHDOG_HALT_THRESHOLD,
    ),
    workspaceConcurrency,
    windowSec,
  };
}
