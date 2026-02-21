export interface AppConfig {
  port: number;
  databaseUrl: string;
  runWorkerEmbedded?: boolean;
  runWorkerPollMs?: number;
  runWorkerBatchLimit?: number;
  runWorkerWorkspaceId?: string;
}

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
  return {
    port: parsePort(process.env.PORT),
    databaseUrl: requireEnv("DATABASE_URL"),
    runWorkerEmbedded: parseBoolean(process.env.RUN_WORKER_EMBEDDED, false),
    runWorkerPollMs: parsePositiveInt(process.env.RUN_WORKER_POLL_MS, "RUN_WORKER_POLL_MS", 1000),
    runWorkerBatchLimit: parseOptionalPositiveInt(
      process.env.RUN_WORKER_BATCH_LIMIT,
      "RUN_WORKER_BATCH_LIMIT",
    ),
    runWorkerWorkspaceId: parseOptionalId(process.env.RUN_WORKER_WORKSPACE_ID),
  };
}
