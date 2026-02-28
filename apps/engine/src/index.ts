import { randomUUID } from "node:crypto";

import { runIngestOnce, startIngestLoop, type IngestConfig } from "./ingestDrop.js";

type JsonRecord = Record<string, unknown>;

type ClaimedRun = {
  run_id: string;
  workspace_id: string;
  room_id: string | null;
  thread_id: string | null;
  status: "running";
  title: string | null;
  goal: string | null;
  input: JsonRecord | null;
  tags: string[];
  correlation_id: string;
  claim_token: string;
  claimed_by_actor_id: string;
  lease_expires_at: string;
  lease_heartbeat_at: string;
  attempt_no?: number;
};

type ClaimResponse = {
  claimed: boolean;
  run: ClaimedRun | null;
};

type ToolInvokeResponse =
  | { tool_call_id: string }
  | {
      decision: "allow" | "deny" | "require_approval";
      reason_code?: string;
      reason?: string;
    };

type EngineConfig = {
  apiBaseUrl: string;
  workspaceId: string;
  roomId?: string;
  actorId: string;
  agentId: string;
  bearerToken?: string;
  refreshToken?: string;
  engineId?: string;
  engineToken?: string;
  pollMs: number;
  maxClaimsPerCycle: number;
  runOnce: boolean;
  ingestEnabled: boolean;
  pipelineRoot?: string;
  dropRoot?: string;
  maxItemConcurrency: number;
  maxAttempts: number;
  maxIngestFileBytes: number;
  maxArtifactBytes: number;
  httpTimeoutSec: number;
  stableCheckMs: number;
};

const LEASE_HEARTBEAT_INTERVAL_MS = 10_000;

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function readBoolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return fallback;
}

function readOptionalStringEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getConfig(): EngineConfig {
  const roomId = process.env.ENGINE_ROOM_ID?.trim();
  const engineId = process.env.ENGINE_ID?.trim();
  const engineToken = process.env.ENGINE_AUTH_TOKEN?.trim();
  const bearerToken =
    process.env.ENGINE_BEARER_TOKEN?.trim() ||
    process.env.ENGINE_OWNER_ACCESS_TOKEN?.trim() ||
    "";
  const refreshToken =
    process.env.ENGINE_REFRESH_TOKEN?.trim() ||
    process.env.ENGINE_OWNER_REFRESH_TOKEN?.trim() ||
    "";
  return {
    apiBaseUrl: process.env.ENGINE_API_BASE_URL?.trim() || "http://127.0.0.1:3000",
    workspaceId: process.env.ENGINE_WORKSPACE_ID?.trim() || "ws_dev",
    roomId: roomId && roomId.length > 0 ? roomId : undefined,
    actorId: process.env.ENGINE_ACTOR_ID?.trim() || "external_engine",
    agentId: process.env.ENGINE_AGENT_ID?.trim() || process.env.ENGINE_ACTOR_ID?.trim() || "external_engine",
    bearerToken: bearerToken.length > 0 ? bearerToken : undefined,
    refreshToken: refreshToken.length > 0 ? refreshToken : undefined,
    engineId: engineId && engineId.length > 0 ? engineId : undefined,
    engineToken: engineToken && engineToken.length > 0 ? engineToken : undefined,
    pollMs: readIntEnv("ENGINE_POLL_MS", 1200),
    maxClaimsPerCycle: readIntEnv("ENGINE_MAX_CLAIMS_PER_CYCLE", 1),
    runOnce: readBoolEnv("ENGINE_RUN_ONCE", false),
    ingestEnabled: readBoolEnv("ENGINE_INGEST_ENABLED", false),
    pipelineRoot: readOptionalStringEnv("ENGINE_PIPELINE_ROOT"),
    dropRoot: readOptionalStringEnv("ENGINE_DROP_ROOT"),
    maxItemConcurrency: readIntEnv("ENGINE_INGEST_MAX_ITEM_CONCURRENCY", 2),
    maxAttempts: readIntEnv("ENGINE_INGEST_MAX_ATTEMPTS", 5),
    maxIngestFileBytes: readIntEnv("ENGINE_INGEST_MAX_INGEST_FILE_BYTES", 1_048_576),
    maxArtifactBytes: readIntEnv("ENGINE_INGEST_MAX_ARTIFACT_BYTES", 20 * 1024 * 1024),
    httpTimeoutSec: readIntEnv("ENGINE_INGEST_HTTP_TIMEOUT_SEC", 15),
    stableCheckMs: readIntEnv("ENGINE_INGEST_STABLE_CHECK_MS", 250),
  };
}

function isObject(value: unknown): value is JsonRecord {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function buildUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

function requestHeaders(cfg: EngineConfig, includeJson = true): Record<string, string> {
  const headers: Record<string, string> = {
    "x-workspace-id": cfg.workspaceId,
  };
  if (includeJson) headers["content-type"] = "application/json";
  if (cfg.bearerToken) headers.authorization = `Bearer ${cfg.bearerToken}`;
  if (cfg.engineId && cfg.engineToken) {
    headers["x-engine-id"] = cfg.engineId;
    headers["x-engine-token"] = cfg.engineToken;
  }
  return headers;
}

class ApiPostError extends Error {
  public readonly status: number;
  public readonly path: string;
  public readonly bodyText: string;

  constructor(path: string, status: number, bodyText: string) {
    super(`api_post_failed:${path}:status=${status}:body=${bodyText.slice(0, 280) || "<empty>"}`);
    this.name = "ApiPostError";
    this.path = path;
    this.status = status;
    this.bodyText = bodyText;
  }
}

function parseJsonSafe(bodyText: string): unknown {
  if (!bodyText) return null;
  try {
    return JSON.parse(bodyText) as unknown;
  } catch {
    return bodyText;
  }
}

function readSessionTokens(body: unknown): { access_token: string; refresh_token: string } | null {
  if (!body || typeof body !== "object") return null;
  const session = (body as { session?: unknown }).session;
  if (!session || typeof session !== "object") return null;
  const access_token = (session as { access_token?: unknown }).access_token;
  const refresh_token = (session as { refresh_token?: unknown }).refresh_token;
  if (typeof access_token !== "string" || typeof refresh_token !== "string") return null;
  if (!access_token.trim() || !refresh_token.trim()) return null;
  return { access_token, refresh_token };
}

async function refreshBearerToken(cfg: EngineConfig): Promise<boolean> {
  if (!cfg.refreshToken) return false;
  const res = await fetch(buildUrl(cfg.apiBaseUrl, "/v1/auth/refresh"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ refresh_token: cfg.refreshToken }),
  });
  const bodyText = await res.text();
  const body = parseJsonSafe(bodyText);
  if (!res.ok) return false;
  const tokens = readSessionTokens(body);
  if (!tokens) return false;
  cfg.bearerToken = tokens.access_token;
  cfg.refreshToken = tokens.refresh_token;
  return true;
}

async function apiPost<T>(
  cfg: EngineConfig,
  path: string,
  payload: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const send = async (): Promise<{ status: number; bodyText: string; body: unknown }> => {
    const res = await fetch(buildUrl(cfg.apiBaseUrl, path), {
      method: "POST",
      headers: requestHeaders(cfg, true),
      body: JSON.stringify(payload),
      signal,
    });
    const bodyText = await res.text();
    return {
      status: res.status,
      bodyText,
      body: parseJsonSafe(bodyText),
    };
  };

  let response = await send();
  if (
    response.status === 401 &&
    !path.startsWith("/v1/auth/") &&
    (await refreshBearerToken(cfg))
  ) {
    response = await send();
  }

  if (response.status < 200 || response.status >= 300) {
    throw new ApiPostError(path, response.status, response.bodyText);
  }
  return response.body as T;
}

function getRunInputFlag(run: ClaimedRun, key: string): unknown {
  const input = run.input;
  if (!isObject(input)) return undefined;
  const runtime = input.runtime;
  if (!isObject(runtime)) return undefined;
  return runtime[key];
}

function makeStepInput(run: ClaimedRun): JsonRecord {
  return {
    run_id: run.run_id,
    source: "external_engine",
    received_at: new Date().toISOString(),
    input: run.input ?? {},
  };
}

function makeToolOutput(run: ClaimedRun): JsonRecord {
  return {
    engine: "external",
    run_id: run.run_id,
    title: run.title,
    goal: run.goal,
    echoed_input: run.input ?? {},
    processed_at: new Date().toISOString(),
  };
}

async function safeFailRun(cfg: EngineConfig, runId: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : "engine_execution_failed";
  const error = {
    code: "ENGINE_EXECUTION_FAILED",
    detail: message,
  };
  try {
    await apiPost(cfg, `/v1/runs/${runId}/fail`, { message, error });
  } catch {
    // eslint-disable-next-line no-console
    console.error(`[engine] unable to fail run ${runId}; manual inspection required`);
  }
}

type EngineRegisterResponse = {
  engine: {
    engine_id: string;
    actor_id: string;
  };
  token: {
    engine_token: string;
  };
};

async function ensureEngineIdentity(cfg: EngineConfig): Promise<EngineConfig> {
  if (cfg.engineId && cfg.engineToken) return cfg;

  const registered = await apiPost<EngineRegisterResponse>(cfg, "/v1/engines/register", {
    actor_id: cfg.actorId,
    engine_name: `Engine ${cfg.actorId}`,
    token_label: "auto_bootstrap",
    scopes: {
      action_types: ["run.claim", "run.lease.heartbeat", "run.lease.release"],
      rooms: cfg.roomId ? [cfg.roomId] : ["*"],
    },
  });

  const engineId = registered.engine.engine_id;
  const engineToken = registered.token.engine_token;
  if (!engineId || !engineToken) {
    throw new Error("engine_bootstrap_missing_token");
  }

  // eslint-disable-next-line no-console
  console.log(`[engine] registered engine id=${engineId} actor=${registered.engine.actor_id}`);
  return {
    ...cfg,
    engineId,
    engineToken,
  };
}

async function processRun(cfg: EngineConfig, run: ClaimedRun): Promise<void> {
  const shouldFail = getRunInputFlag(run, "simulate_fail") === true;
  let heartbeatError: Error | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let runTerminalPersisted = false;

  const assertLeaseHealthy = () => {
    if (heartbeatError) throw heartbeatError;
  };
  const post = async <T>(path: string, payload: unknown): Promise<T> => {
    assertLeaseHealthy();
    return apiPost<T>(cfg, path, payload);
  };
  const heartbeat = async () => {
    await apiPost<{ ok: true }>(cfg, `/v1/runs/${run.run_id}/lease/heartbeat`, {
      claim_token: run.claim_token,
    });
  };
  try {
    await heartbeat();
    heartbeatTimer = setInterval(() => {
      void heartbeat().catch((err) => {
        if (heartbeatError) return;
        heartbeatError = err instanceof Error ? err : new Error(String(err));
        // eslint-disable-next-line no-console
        console.warn(`[engine] lease heartbeat failed for ${run.run_id}: ${heartbeatError.message}`);
      });
    }, LEASE_HEARTBEAT_INTERVAL_MS);
    heartbeatTimer.unref?.();

    const { step_id } = await post<{ step_id: string }>(`/v1/runs/${run.run_id}/steps`, {
      kind: "engine.task",
      title: `Engine execution for ${run.run_id}`,
      input: makeStepInput(run),
    });

    const toolInvoke = await post<ToolInvokeResponse>(`/v1/steps/${step_id}/toolcalls`, {
      tool_name: "engine.execute",
      title: "External engine execution",
      input: {
        mode: "runner",
        run_id: run.run_id,
      },
      actor_type: "service",
      actor_id: cfg.actorId,
    });

    if (!("tool_call_id" in toolInvoke)) {
      const reason = toolInvoke.reason || toolInvoke.reason_code || "tool_policy_blocked";
      await post(`/v1/runs/${run.run_id}/fail`, {
        message: "tool invocation blocked",
        error: {
          code: "ENGINE_TOOL_BLOCKED",
          decision: toolInvoke.decision,
          reason,
        },
      });
      runTerminalPersisted = true;
      // eslint-disable-next-line no-console
      console.warn(`[engine] run ${run.run_id} blocked by tool policy: ${reason}`);
      return;
    }

    if (shouldFail) {
      await post(`/v1/toolcalls/${toolInvoke.tool_call_id}/fail`, {
        message: "simulated failure",
        error: { code: "SIMULATED_FAILURE", run_id: run.run_id },
      });
      await post(`/v1/runs/${run.run_id}/fail`, {
        message: "simulated run failure",
        error: { code: "SIMULATED_FAILURE", run_id: run.run_id },
      });
      runTerminalPersisted = true;
      // eslint-disable-next-line no-console
      console.warn(`[engine] run ${run.run_id} failed intentionally (simulate_fail=true)`);
      return;
    }

    const output = makeToolOutput(run);

    await post(`/v1/toolcalls/${toolInvoke.tool_call_id}/succeed`, {
      output,
    });

    await post(`/v1/steps/${step_id}/artifacts`, {
      kind: "engine.result",
      title: "External engine output",
      content: {
        type: "json",
        json: output,
      },
      metadata: {
        actor_id: cfg.actorId,
        external_engine: true,
      },
    });

    await post(`/v1/runs/${run.run_id}/complete`, {
      summary: "Completed by external engine runner",
      output,
    });
    runTerminalPersisted = true;

    // eslint-disable-next-line no-console
    console.log(`[engine] run completed: ${run.run_id}`);
  } finally {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
    if (!runTerminalPersisted) {
      // eslint-disable-next-line no-console
      console.warn(
        `[engine] run ${run.run_id} ended without persisted terminal state; lease is kept until TTL expiry for safe reclaim`,
      );
    }
  }
}

async function claimRun(cfg: EngineConfig): Promise<ClaimResponse> {
  const payload: { room_id?: string } = {};
  if (cfg.roomId) payload.room_id = cfg.roomId;
  return apiPost<ClaimResponse>(cfg, "/v1/runs/claim", payload);
}

async function runCycle(cfg: EngineConfig): Promise<number> {
  let handled = 0;
  for (let i = 0; i < cfg.maxClaimsPerCycle; i += 1) {
    const claim = await claimRun(cfg);
    if (!claim.claimed || !claim.run) break;
    handled += 1;
    try {
      await processRun(cfg, claim.run);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[engine] run ${claim.run.run_id} failed`, err);
      await safeFailRun(cfg, claim.run.run_id, err);
    }
  }
  return handled;
}

function toIngestConfig(cfg: EngineConfig): IngestConfig {
  return {
    apiBaseUrl: cfg.apiBaseUrl,
    workspaceId: cfg.workspaceId,
    agentId: cfg.agentId,
    runId: randomUUID(),
    bearerToken: cfg.bearerToken,
    engineId: cfg.engineId,
    engineToken: cfg.engineToken,
    ingestEnabled: cfg.ingestEnabled,
    pipelineRoot: cfg.pipelineRoot,
    dropRoot: cfg.dropRoot,
    maxItemConcurrency: cfg.maxItemConcurrency,
    maxAttempts: cfg.maxAttempts,
    maxIngestFileBytes: cfg.maxIngestFileBytes,
    maxArtifactBytes: cfg.maxArtifactBytes,
    httpTimeoutSec: cfg.httpTimeoutSec,
    stableCheckMs: cfg.stableCheckMs,
    pollMs: cfg.pollMs,
  };
}

async function main(): Promise<void> {
  const initialCfg = getConfig();
  const cfg = await ensureEngineIdentity(initialCfg);
  const ingestCfg = toIngestConfig(cfg);
  // eslint-disable-next-line no-console
  console.log(
    `[engine] started (api=${cfg.apiBaseUrl}, workspace=${cfg.workspaceId}, room=${cfg.roomId ?? "*"}, actor=${cfg.actorId}, engine_id=${cfg.engineId ?? "-"}, poll=${cfg.pollMs}ms)`,
  );
  if (cfg.ingestEnabled) {
    // eslint-disable-next-line no-console
    console.log(
      `[engine] ingest enabled (drop_root=${cfg.dropRoot ?? (cfg.pipelineRoot ?? process.cwd()) + "/_drop"}, concurrency=${cfg.maxItemConcurrency})`,
    );
  }

  if (cfg.runOnce) {
    if (cfg.ingestEnabled) {
      await runIngestOnce(ingestCfg);
    }
    const count = await runCycle(cfg);
    // eslint-disable-next-line no-console
    console.log(`[engine] run-once handled ${count} run(s)`);
    return;
  }

  if (cfg.ingestEnabled) {
    startIngestLoop(ingestCfg);
  }

  while (true) {
    try {
      const handled = await runCycle(cfg);
      if (handled === 0) {
        await new Promise((resolve) => setTimeout(resolve, cfg.pollMs));
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[engine] cycle error", err);
      await new Promise((resolve) => setTimeout(resolve, cfg.pollMs));
    }
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
