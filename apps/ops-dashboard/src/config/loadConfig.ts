export type AppConfig = {
  apiBaseUrl: string;
  defaultWorkspaceId: string;
  bearerToken: string;
  schemaVersion: string;
  healthPollSec: number;
  financePollSec: number;
  financeDaysBack: number;
};

let cachedConfig: AppConfig | null = null;

function asPositiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

export async function loadConfig(): Promise<AppConfig> {
  if (cachedConfig) return cachedConfig;
  const res = await fetch("/config.json", { cache: "no-store" });
  if (!res.ok) {
    throw new Error("Failed to load /config.json");
  }
  const raw = (await res.json()) as Record<string, unknown>;
  const config: AppConfig = {
    apiBaseUrl: String(raw.apiBaseUrl ?? "").trim(),
    defaultWorkspaceId: String(raw.defaultWorkspaceId ?? "").trim(),
    bearerToken: String(raw.bearerToken ?? "").trim(),
    schemaVersion: String(raw.schemaVersion ?? "2.1").trim() || "2.1",
    healthPollSec: Math.max(15, asPositiveInt(raw.healthPollSec, 15)),
    financePollSec: Math.max(30, asPositiveInt(raw.financePollSec, 30)),
    financeDaysBack: Math.max(1, Math.min(365, asPositiveInt(raw.financeDaysBack, 14))),
  };

  if (!config.apiBaseUrl || !config.defaultWorkspaceId || !config.bearerToken) {
    throw new Error("Invalid /config.json: apiBaseUrl/defaultWorkspaceId/bearerToken are required");
  }

  cachedConfig = config;
  return cachedConfig;
}

export function clearConfigCache(): void {
  cachedConfig = null;
}
