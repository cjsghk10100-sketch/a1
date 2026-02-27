export interface AppConfig {
  port: number;
  databaseUrl: string;
  leaseDurationSeconds?: number;
  heartbeatMinIntervalSec?: number;
  heartbeatMinIntervalSecTest?: number;
  maxClaimAgeSec?: number;
  runWorkerEmbedded?: boolean;
  runWorkerPollMs?: number;
  runWorkerBatchLimit?: number;
  runWorkerWorkspaceId?: string;
  authRequireSession?: boolean;
  authAllowLegacyWorkspaceHeader?: boolean;
  authSessionSecret?: string;
  authSessionAccessTtlSec?: number;
  authSessionRefreshTtlSec?: number;
  authBootstrapToken?: string;
  authBootstrapAllowLoopback?: boolean;
}

export const LEASE_DURATION_SECONDS = 1800;
export const HEARTBEAT_MIN_INTERVAL_SEC = 10;
export const HEARTBEAT_MIN_INTERVAL_SEC_TEST = 0;
export const MAX_CLAIM_AGE_SEC = 900;

function parsePort(raw: string | undefined): number {
  if (!raw) return 3000;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return n;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseBoolean(raw: string | undefined, defaultValue: boolean): boolean {
  if (!raw) return defaultValue;
  const value = raw.trim().toLowerCase();
  if (value === "1" || value === "true" || value === "yes" || value === "on") return true;
  if (value === "0" || value === "false" || value === "no" || value === "off") return false;
  throw new Error("Boolean env value must be one of 1/0/true/false/yes/no/on/off");
}

function parsePositiveInt(
  raw: string | undefined,
  name: string,
  defaultValue: number,
): number {
  if (!raw) return defaultValue;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return n;
}

function parseOptionalPositiveInt(raw: string | undefined, name: string): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return n;
}

function parseOptionalId(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const v = raw.trim();
  return v.length ? v : undefined;
}

export function loadConfig(): AppConfig {
  const authSessionSecret =
    process.env.AUTH_SESSION_SECRET?.trim() || "agentapp_local_dev_session_secret";
  const authBootstrapToken = process.env.AUTH_BOOTSTRAP_TOKEN?.trim();

  return {
    port: parsePort(process.env.PORT),
    databaseUrl: requireEnv("DATABASE_URL"),
    leaseDurationSeconds: parsePositiveInt(
      process.env.LEASE_DURATION_SECONDS,
      "LEASE_DURATION_SECONDS",
      LEASE_DURATION_SECONDS,
    ),
    heartbeatMinIntervalSec: parsePositiveInt(
      process.env.HEARTBEAT_MIN_INTERVAL_SEC,
      "HEARTBEAT_MIN_INTERVAL_SEC",
      HEARTBEAT_MIN_INTERVAL_SEC,
    ),
    heartbeatMinIntervalSecTest: parsePositiveInt(
      process.env.HEARTBEAT_MIN_INTERVAL_SEC_TEST,
      "HEARTBEAT_MIN_INTERVAL_SEC_TEST",
      HEARTBEAT_MIN_INTERVAL_SEC_TEST,
    ),
    maxClaimAgeSec: parsePositiveInt(
      process.env.MAX_CLAIM_AGE_SEC,
      "MAX_CLAIM_AGE_SEC",
      MAX_CLAIM_AGE_SEC,
    ),
    runWorkerEmbedded: parseBoolean(process.env.RUN_WORKER_EMBEDDED, false),
    runWorkerPollMs: parsePositiveInt(process.env.RUN_WORKER_POLL_MS, "RUN_WORKER_POLL_MS", 1000),
    runWorkerBatchLimit: parseOptionalPositiveInt(
      process.env.RUN_WORKER_BATCH_LIMIT,
      "RUN_WORKER_BATCH_LIMIT",
    ),
    runWorkerWorkspaceId: parseOptionalId(process.env.RUN_WORKER_WORKSPACE_ID),
    authRequireSession: parseBoolean(process.env.AUTH_REQUIRE_SESSION, true),
    authAllowLegacyWorkspaceHeader: parseBoolean(
      process.env.AUTH_ALLOW_LEGACY_WORKSPACE_HEADER,
      false,
    ),
    authSessionSecret,
    authSessionAccessTtlSec: parsePositiveInt(
      process.env.AUTH_SESSION_ACCESS_TTL_SEC,
      "AUTH_SESSION_ACCESS_TTL_SEC",
      3600,
    ),
    authSessionRefreshTtlSec: parsePositiveInt(
      process.env.AUTH_SESSION_REFRESH_TTL_SEC,
      "AUTH_SESSION_REFRESH_TTL_SEC",
      60 * 60 * 24 * 30,
    ),
    authBootstrapToken: authBootstrapToken && authBootstrapToken.length > 0 ? authBootstrapToken : undefined,
    authBootstrapAllowLoopback: parseBoolean(process.env.AUTH_BOOTSTRAP_ALLOW_LOOPBACK, false),
  };
}
