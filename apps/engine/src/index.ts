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
  pollMs: number;
  maxClaimsPerCycle: number;
  runOnce: boolean;
};

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

function getConfig(): EngineConfig {
  const roomId = process.env.ENGINE_ROOM_ID?.trim();
  return {
    apiBaseUrl: process.env.ENGINE_API_BASE_URL?.trim() || "http://127.0.0.1:3000",
    workspaceId: process.env.ENGINE_WORKSPACE_ID?.trim() || "ws_dev",
    roomId: roomId && roomId.length > 0 ? roomId : undefined,
    actorId: process.env.ENGINE_ACTOR_ID?.trim() || "external_engine",
    pollMs: readIntEnv("ENGINE_POLL_MS", 1200),
    maxClaimsPerCycle: readIntEnv("ENGINE_MAX_CLAIMS_PER_CYCLE", 1),
    runOnce: readBoolEnv("ENGINE_RUN_ONCE", false),
  };
}

function isObject(value: unknown): value is JsonRecord {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function buildUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

async function apiPost<T>(
  cfg: EngineConfig,
  path: string,
  payload: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(buildUrl(cfg.apiBaseUrl, path), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-workspace-id": cfg.workspaceId,
    },
    body: JSON.stringify(payload),
    signal,
  });
  const bodyText = await res.text();
  const body = bodyText ? (JSON.parse(bodyText) as unknown) : null;
  if (!res.ok) {
    throw new Error(
      `api_post_failed:${path}:status=${res.status}:body=${bodyText.slice(0, 280) || "<empty>"}`,
    );
  }
  return body as T;
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

async function processRun(cfg: EngineConfig, run: ClaimedRun): Promise<void> {
  const shouldFail = getRunInputFlag(run, "simulate_fail") === true;

  const { step_id } = await apiPost<{ step_id: string }>(cfg, `/v1/runs/${run.run_id}/steps`, {
    kind: "engine.task",
    title: `Engine execution for ${run.run_id}`,
    input: makeStepInput(run),
  });

  const toolInvoke = await apiPost<ToolInvokeResponse>(cfg, `/v1/steps/${step_id}/toolcalls`, {
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
    await apiPost(cfg, `/v1/runs/${run.run_id}/fail`, {
      message: "tool invocation blocked",
      error: {
        code: "ENGINE_TOOL_BLOCKED",
        decision: toolInvoke.decision,
        reason,
      },
    });
    // eslint-disable-next-line no-console
    console.warn(`[engine] run ${run.run_id} blocked by tool policy: ${reason}`);
    return;
  }

  if (shouldFail) {
    await apiPost(cfg, `/v1/toolcalls/${toolInvoke.tool_call_id}/fail`, {
      message: "simulated failure",
      error: { code: "SIMULATED_FAILURE", run_id: run.run_id },
    });
    await apiPost(cfg, `/v1/runs/${run.run_id}/fail`, {
      message: "simulated run failure",
      error: { code: "SIMULATED_FAILURE", run_id: run.run_id },
    });
    // eslint-disable-next-line no-console
    console.warn(`[engine] run ${run.run_id} failed intentionally (simulate_fail=true)`);
    return;
  }

  const output = makeToolOutput(run);

  await apiPost(cfg, `/v1/toolcalls/${toolInvoke.tool_call_id}/succeed`, {
    output,
  });

  await apiPost(cfg, `/v1/steps/${step_id}/artifacts`, {
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

  await apiPost(cfg, `/v1/runs/${run.run_id}/complete`, {
    summary: "Completed by external engine runner",
    output,
  });

  // eslint-disable-next-line no-console
  console.log(`[engine] run completed: ${run.run_id}`);
}

async function claimRun(cfg: EngineConfig): Promise<ClaimResponse> {
  const payload: { actor_id: string; room_id?: string } = {
    actor_id: cfg.actorId,
  };
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

async function main(): Promise<void> {
  const cfg = getConfig();
  // eslint-disable-next-line no-console
  console.log(
    `[engine] started (api=${cfg.apiBaseUrl}, workspace=${cfg.workspaceId}, room=${cfg.roomId ?? "*"}, actor=${cfg.actorId}, poll=${cfg.pollMs}ms)`,
  );

  if (cfg.runOnce) {
    const count = await runCycle(cfg);
    // eslint-disable-next-line no-console
    console.log(`[engine] run-once handled ${count} run(s)`);
    return;
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
