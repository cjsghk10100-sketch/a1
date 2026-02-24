const { spawn } = require("node:child_process");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const { app, BrowserWindow, ipcMain } = require("electron");

const REPO_ROOT =
  process.env.DESKTOP_REPO_ROOT?.trim() || path.resolve(__dirname, "../../..");
const PRELOAD_PATH = path.join(__dirname, "preload.cjs");
const PNPM_BIN = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const RUNTIME_PHASE = {
  Starting: "starting",
  Healthy: "healthy",
  Degraded: "degraded",
  Fatal: "fatal",
  Stopped: "stopped",
};

const COMPONENT_STATE = {
  Starting: "starting",
  Healthy: "healthy",
  Restarting: "restarting",
  Stopped: "stopped",
  Fatal: "fatal",
  Disabled: "disabled",
};

function nowIso() {
  return new Date().toISOString();
}

function parsePort(raw, fallback) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) return fallback;
  return n;
}

function parseTimeout(raw, fallback) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

function parsePositiveInt(raw, fallback) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

function parseBoolean(raw, fallback) {
  if (raw == null) return fallback;
  const value = String(raw).trim().toLowerCase();
  if (value === "1" || value === "true" || value === "yes" || value === "on") return true;
  if (value === "0" || value === "false" || value === "no" || value === "off") return false;
  return fallback;
}

function parseRunnerMode(raw) {
  const mode = String(raw || "").trim().toLowerCase();
  if (mode === "external") return "external";
  return "embedded";
}

const apiPort = parsePort(process.env.DESKTOP_API_PORT, 3000);
const webPort = parsePort(process.env.DESKTOP_WEB_PORT, 5173);
const apiTimeoutMs = parseTimeout(process.env.DESKTOP_API_START_TIMEOUT_MS, 45_000);
const webTimeoutMs = parseTimeout(process.env.DESKTOP_WEB_START_TIMEOUT_MS, 45_000);
const runnerMode = parseRunnerMode(process.env.DESKTOP_RUNNER_MODE);
const engineWorkspaceId = process.env.DESKTOP_ENGINE_WORKSPACE_ID?.trim() || "ws_dev";
const engineRoomId = process.env.DESKTOP_ENGINE_ROOM_ID?.trim() || "";
const engineActorId = process.env.DESKTOP_ENGINE_ACTOR_ID?.trim() || "desktop_engine";
const enginePollMs = parsePositiveInt(process.env.DESKTOP_ENGINE_POLL_MS, 1200);
const engineMaxClaimsPerCycle = parsePositiveInt(process.env.DESKTOP_ENGINE_MAX_CLAIMS_PER_CYCLE, 1);
const engineBearerToken = process.env.DESKTOP_ENGINE_BEARER_TOKEN?.trim() || "";
const bootstrapToken =
  process.env.DESKTOP_BOOTSTRAP_TOKEN?.trim() || process.env.AUTH_BOOTSTRAP_TOKEN?.trim() || "";
const ownerPassphrase =
  process.env.DESKTOP_OWNER_PASSPHRASE?.trim() ||
  process.env.VITE_AUTH_OWNER_PASSPHRASE?.trim() ||
  "";
const restartMaxAttempts = parsePositiveInt(process.env.DESKTOP_RESTART_MAX_ATTEMPTS, 5);
const restartBaseDelayMs = parsePositiveInt(process.env.DESKTOP_RESTART_BASE_DELAY_MS, 1000);
const restartMaxDelayMs = parsePositiveInt(process.env.DESKTOP_RESTART_MAX_DELAY_MS, 30_000);
const noWindow = parseBoolean(process.env.DESKTOP_NO_WINDOW, false);
const exitAfterReady = parseBoolean(process.env.DESKTOP_EXIT_AFTER_READY, false);

const webBaseUrl = `http://127.0.0.1:${webPort}`;
const bootstrapUrl = `${webBaseUrl}/desktop-bootstrap`;

/** @type {BrowserWindow | null} */
let mainWindow = null;
let shuttingDown = false;
let allowAppExit = false;
let hasReachedHealthy = false;
/** @type {Promise<void> | null} */
let shutdownPromise = null;

const runtimeState = {
  phase: RUNTIME_PHASE.Starting,
  mode: runnerMode,
  updated_at: nowIso(),
  last_error_code: null,
  last_error_message: null,
  last_error_component: null,
  last_error_at: null,
};

function createManagedComponent(name, options) {
  const initialState = options.enabled ? COMPONENT_STATE.Stopped : COMPONENT_STATE.Disabled;
  return {
    name,
    enabled: Boolean(options.enabled),
    required: Boolean(options.required),
    args: options.args,
    env: options.env,
    ready_url: options.ready_url ?? null,
    ready_timeout_ms: options.ready_timeout_ms ?? 0,
    state: initialState,
    child: null,
    restart_attempts: 0,
    restart_timer: null,
    next_restart_at: null,
    pid: null,
    last_started_at: null,
    last_exit_at: null,
    last_exit_code: null,
    last_exit_signal: null,
    last_error_code: null,
    last_error_message: null,
    updated_at: nowIso(),
  };
}

const components = {
  api: createManagedComponent("api", {
    enabled: true,
    required: true,
    args: ["-C", "apps/api", "start"],
    env: {
      PORT: String(apiPort),
      RUN_WORKER_EMBEDDED: runnerMode === "embedded" ? "1" : "0",
      AUTH_REQUIRE_SESSION: "1",
      AUTH_ALLOW_LEGACY_WORKSPACE_HEADER: runnerMode === "external" ? "1" : "0",
      ...(bootstrapToken ? { AUTH_BOOTSTRAP_TOKEN: bootstrapToken } : {}),
    },
    ready_url: `http://127.0.0.1:${apiPort}/health`,
    ready_timeout_ms: apiTimeoutMs,
  }),
  web: createManagedComponent("web", {
    enabled: true,
    required: true,
    args: ["-C", "apps/web", "dev", "--host", "127.0.0.1", "--port", String(webPort)],
    env: {
      VITE_DEV_API_BASE_URL: `http://127.0.0.1:${apiPort}`,
      VITE_DESKTOP_RUNNER_MODE: runnerMode,
      VITE_DESKTOP_API_PORT: String(apiPort),
      VITE_DESKTOP_WEB_PORT: String(webPort),
      VITE_DESKTOP_ENGINE_WORKSPACE_ID: engineWorkspaceId,
      VITE_DESKTOP_ENGINE_ROOM_ID: engineRoomId,
      VITE_DESKTOP_ENGINE_ACTOR_ID: engineActorId,
      VITE_DESKTOP_ENGINE_POLL_MS: String(enginePollMs),
      VITE_DESKTOP_ENGINE_MAX_CLAIMS_PER_CYCLE: String(engineMaxClaimsPerCycle),
      ...(ownerPassphrase ? { VITE_AUTH_OWNER_PASSPHRASE: ownerPassphrase } : {}),
      ...(bootstrapToken ? { VITE_AUTH_BOOTSTRAP_TOKEN: bootstrapToken } : {}),
    },
    ready_url: webBaseUrl,
    ready_timeout_ms: webTimeoutMs,
  }),
  engine: createManagedComponent("engine", {
    enabled: runnerMode === "external",
    required: runnerMode === "external",
    args: ["-C", "apps/engine", "start"],
    env: {
      ENGINE_API_BASE_URL: `http://127.0.0.1:${apiPort}`,
      ENGINE_WORKSPACE_ID: engineWorkspaceId,
      ENGINE_ACTOR_ID: engineActorId,
      ...(engineBearerToken ? { ENGINE_BEARER_TOKEN: engineBearerToken } : {}),
      ENGINE_POLL_MS: String(enginePollMs),
      ENGINE_MAX_CLAIMS_PER_CYCLE: String(engineMaxClaimsPerCycle),
      ...(engineRoomId ? { ENGINE_ROOM_ID: engineRoomId } : {}),
    },
  }),
};

function logLine(prefix, line) {
  const value = String(line).trim();
  if (!value.length) return;
  // eslint-disable-next-line no-console
  console.log(`[desktop:${prefix}] ${value}`);
}

function ping(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 1500 }, (res) => {
      const status = res.statusCode ?? 0;
      res.resume();
      resolve(status >= 200 && status < 500);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

function ensurePortAvailable(port, label) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", (err) => {
      const code = err && typeof err === "object" && "code" in err ? err.code : "UNKNOWN";
      if (code === "EADDRINUSE") {
        reject(new Error(`port_in_use:${label}:${port}`));
        return;
      }
      reject(new Error(`port_check_failed:${label}:${port}:${String(code)}`));
    });
    server.once("listening", () => {
      server.close((err) => {
        if (err) {
          reject(new Error(`port_check_failed:${label}:${port}:close_error`));
          return;
        }
        resolve();
      });
    });
    server.listen(port, "127.0.0.1");
  });
}

async function waitUntilReachable(url, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const reachable = await ping(url);
    if (reachable) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`startup_timeout:${url}`);
}

function componentSnapshot(component) {
  return {
    name: component.name,
    required: component.required,
    enabled: component.enabled,
    state: component.state,
    pid: component.pid,
    restart_attempts: component.restart_attempts,
    next_restart_at: component.next_restart_at,
    last_started_at: component.last_started_at,
    last_exit_at: component.last_exit_at,
    last_exit_code: component.last_exit_code,
    last_exit_signal: component.last_exit_signal,
    last_error_code: component.last_error_code,
    last_error_message: component.last_error_message,
    updated_at: component.updated_at,
  };
}

function buildRuntimeSnapshot() {
  const all = Object.values(components);
  const restart_attempts_total = all.reduce((sum, component) => sum + component.restart_attempts, 0);
  const required = all.filter((component) => component.required);
  const degraded = required.find((component) => component.state !== COMPONENT_STATE.Healthy && component.state !== COMPONENT_STATE.Disabled);
  const fatal = required.find((component) => component.state === COMPONENT_STATE.Fatal);

  return {
    phase: runtimeState.phase,
    mode: runtimeState.mode,
    updated_at: runtimeState.updated_at,
    restart_attempts_total,
    degraded_component: degraded?.name ?? null,
    fatal_component: fatal?.name ?? null,
    last_error_code: runtimeState.last_error_code,
    last_error_message: runtimeState.last_error_message,
    last_error_component: runtimeState.last_error_component,
    last_error_at: runtimeState.last_error_at,
    components: {
      api: componentSnapshot(components.api),
      web: componentSnapshot(components.web),
      ...(components.engine.enabled ? { engine: componentSnapshot(components.engine) } : {}),
    },
  };
}

function broadcastRuntimeStatus() {
  const payload = buildRuntimeSnapshot();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("desktop.runtime.status", payload);
    }
  }
}

function computeRuntimePhase() {
  if (shuttingDown) return RUNTIME_PHASE.Stopped;

  const required = Object.values(components).filter((component) => component.required);
  if (required.some((component) => component.state === COMPONENT_STATE.Fatal)) {
    return RUNTIME_PHASE.Fatal;
  }
  if (required.length > 0 && required.every((component) => component.state === COMPONENT_STATE.Healthy)) {
    return RUNTIME_PHASE.Healthy;
  }
  if (!hasReachedHealthy) return RUNTIME_PHASE.Starting;
  return RUNTIME_PHASE.Degraded;
}

function refreshRuntimePhase() {
  const phase = computeRuntimePhase();
  if (phase === RUNTIME_PHASE.Healthy) hasReachedHealthy = true;
  runtimeState.phase = phase;
  runtimeState.updated_at = nowIso();
  broadcastRuntimeStatus();
}

function setRuntimeError(component, code, message) {
  runtimeState.last_error_code = code;
  runtimeState.last_error_message = message ?? null;
  runtimeState.last_error_component = component.name;
  runtimeState.last_error_at = nowIso();
}

function updateComponent(component, patch) {
  Object.assign(component, patch);
  component.updated_at = nowIso();
  refreshRuntimePhase();
}

function spawnManagedProcess(component) {
  const child = spawn(PNPM_BIN, component.args, {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      ...component.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.on("data", (buf) => logLine(component.name, buf));
  child.stderr?.on("data", (buf) => logLine(component.name, buf));
  child.on("error", (err) => {
    if (shuttingDown) return;
    setRuntimeError(component, "spawn_error", String(err instanceof Error ? err.message : err));
    updateComponent(component, {
      last_error_code: "spawn_error",
      last_error_message: String(err instanceof Error ? err.message : err),
    });
  });
  child.on("exit", (code, signal) => {
    const now = nowIso();
    updateComponent(component, {
      child: null,
      pid: null,
      last_exit_at: now,
      last_exit_code: code ?? null,
      last_exit_signal: signal ?? null,
      state: shuttingDown ? COMPONENT_STATE.Stopped : COMPONENT_STATE.Stopped,
      next_restart_at: null,
    });
    if (shuttingDown || !component.enabled) return;

    const errorCode = `exit_${code == null ? "null" : String(code)}_${signal ?? "none"}`;
    const errorMessage = `Process exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "null"})`;
    scheduleRestart(component, errorCode, errorMessage);
  });

  return child;
}

function restartDelayMs(attempt) {
  const exp = Math.max(0, attempt - 1);
  const delay = restartBaseDelayMs * 2 ** exp;
  return Math.min(restartMaxDelayMs, delay);
}

function scheduleRestart(component, errorCode, errorMessage) {
  if (shuttingDown || !component.enabled) return;
  if (component.restart_timer) {
    clearTimeout(component.restart_timer);
    component.restart_timer = null;
  }

  const nextAttempts = component.restart_attempts + 1;
  setRuntimeError(component, errorCode, errorMessage);

  if (nextAttempts > restartMaxAttempts) {
    updateComponent(component, {
      restart_attempts: nextAttempts,
      state: COMPONENT_STATE.Fatal,
      last_error_code: errorCode,
      last_error_message: errorMessage,
      next_restart_at: null,
    });
    // eslint-disable-next-line no-console
    console.error(`[desktop:${component.name}] restart exhausted -> fatal (${errorCode})`);
    return;
  }

  const delay = restartDelayMs(nextAttempts);
  const nextRestartAt = new Date(Date.now() + delay).toISOString();
  updateComponent(component, {
    restart_attempts: nextAttempts,
    state: COMPONENT_STATE.Restarting,
    last_error_code: errorCode,
    last_error_message: errorMessage,
    next_restart_at: nextRestartAt,
  });

  component.restart_timer = setTimeout(() => {
    component.restart_timer = null;
    void startComponent(component, "restart");
  }, delay);
  component.restart_timer.unref?.();
}

function killProcess(child, label) {
  if (!child || child.killed) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const complete = () => {
      if (done) return;
      done = true;
      resolve();
    };
    child.once("exit", complete);
    try {
      child.kill("SIGTERM");
    } catch {
      complete();
      return;
    }
    setTimeout(() => {
      if (done) return;
      try {
        child.kill("SIGKILL");
      } catch {
        // eslint-disable-next-line no-console
        console.warn(`[desktop:${label}] failed to force-kill process`);
      } finally {
        complete();
      }
    }, 4000);
  });
}

async function startComponent(component, reason = "initial") {
  if (!component.enabled || shuttingDown) return;
  if (component.restart_timer) {
    clearTimeout(component.restart_timer);
    component.restart_timer = null;
  }
  if (component.child && !component.child.killed) return;

  updateComponent(component, {
    state: reason === "restart" ? COMPONENT_STATE.Restarting : COMPONENT_STATE.Starting,
    next_restart_at: null,
  });

  const child = spawnManagedProcess(component);
  updateComponent(component, {
    child,
    pid: child.pid ?? null,
    state: COMPONENT_STATE.Starting,
    last_started_at: nowIso(),
  });

  if (!component.ready_url) {
    updateComponent(component, {
      state: COMPONENT_STATE.Healthy,
      last_error_code: null,
      last_error_message: null,
    });
    return;
  }

  try {
    await waitUntilReachable(component.ready_url, component.ready_timeout_ms);
    if (shuttingDown || component.child !== child) return;
    updateComponent(component, {
      state: COMPONENT_STATE.Healthy,
      last_error_code: null,
      last_error_message: null,
    });
  } catch (err) {
    if (shuttingDown || component.child !== child) return;
    const message = err instanceof Error ? err.message : String(err);
    setRuntimeError(component, "startup_timeout", message);
    updateComponent(component, {
      last_error_code: "startup_timeout",
      last_error_message: message,
    });
    await killProcess(child, component.name);
  }
}

async function waitForRuntimeReady(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (computeRuntimePhase() === RUNTIME_PHASE.Fatal) {
      const snapshot = buildRuntimeSnapshot();
      throw new Error(
        `runtime_fatal:${snapshot.fatal_component ?? "unknown"}:${snapshot.last_error_code ?? "unknown"}`,
      );
    }
    const apiReady = components.api.state === COMPONENT_STATE.Healthy;
    const webReady = components.web.state === COMPONENT_STATE.Healthy;
    const engineReady = !components.engine.required || components.engine.state === COMPONENT_STATE.Healthy;
    if (apiReady && webReady && engineReady) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`startup_timeout:runtime:${timeoutMs}`);
}

async function stopRuntimeOnce() {
  if (!shutdownPromise) {
    shutdownPromise = (async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      refreshRuntimePhase();
      for (const component of Object.values(components)) {
        if (component.restart_timer) {
          clearTimeout(component.restart_timer);
          component.restart_timer = null;
        }
      }
      await Promise.all([
        killProcess(components.engine.child, "engine"),
        killProcess(components.web.child, "web"),
        killProcess(components.api.child, "api"),
      ]);
      updateComponent(components.engine, { child: null, pid: null, state: COMPONENT_STATE.Stopped });
      updateComponent(components.web, { child: null, pid: null, state: COMPONENT_STATE.Stopped });
      updateComponent(components.api, { child: null, pid: null, state: COMPONENT_STATE.Stopped });
    })();
  }
  await shutdownPromise;
}

async function gracefulExit(code = 0) {
  await stopRuntimeOnce();
  allowAppExit = true;
  app.exit(code);
}

function createWindow(startUrl) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: PRELOAD_PATH,
    },
  });
  void mainWindow.loadURL(startUrl);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createFailureWindow(error) {
  const message = String(error instanceof Error ? error.message : error).replaceAll("<", "&lt;");
  const runnerModeHelp =
    runnerMode === "external"
      ? "DESKTOP_API_PORT=3301 DESKTOP_WEB_PORT=5174 pnpm desktop:dev:external"
      : "DESKTOP_API_PORT=3301 DESKTOP_WEB_PORT=5174 pnpm desktop:dev:embedded";
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Agent OS Desktop</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 24px; background: #0b1220; color: #e8f0ff; }
      .card { border: 1px solid #31445f; border-radius: 12px; padding: 16px; background: rgba(255,255,255,0.04); max-width: 860px; }
      h1 { margin-top: 0; font-size: 18px; }
      code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      pre { background: rgba(0,0,0,0.3); border: 1px solid #31445f; border-radius: 8px; padding: 10px; overflow: auto; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Desktop startup failed</h1>
      <p>Could not start local runtime. Check DB/API logs in the terminal.</p>
      <pre>${message}</pre>
      <p>Recovery:</p>
      <pre>docker compose -f infra/docker-compose.yml up -d
pnpm -C apps/api db:migrate
pnpm desktop:dev:env

# if port conflict is reported:
${runnerModeHelp}</pre>
    </div>
  </body>
</html>`;
  const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  createWindow(dataUrl);
}

async function startRuntime() {
  await Promise.all([ensurePortAvailable(apiPort, "api"), ensurePortAvailable(webPort, "web")]);
  await startComponent(components.api, "initial");
  await startComponent(components.web, "initial");
  if (components.engine.enabled) {
    await startComponent(components.engine, "initial");
  }
  await waitForRuntimeReady(Math.max(apiTimeoutMs, webTimeoutMs));
}

async function boot() {
  try {
    // eslint-disable-next-line no-console
    console.log(
      `[desktop] booting runtime (mode:${runnerMode}, api:${apiPort}, web:${webPort}, api_timeout:${apiTimeoutMs}ms, web_timeout:${webTimeoutMs}ms, max_restarts:${restartMaxAttempts})`,
    );
    await startRuntime();
    if (!noWindow) createWindow(bootstrapUrl);
    if (exitAfterReady) {
      // eslint-disable-next-line no-console
      console.log("[desktop] exit_after_ready=1 -> shutting down");
      await gracefulExit(0);
    }
  } catch (err) {
    if (noWindow) {
      // eslint-disable-next-line no-console
      console.error(`[desktop] startup failed in no-window mode: ${String(err instanceof Error ? err.message : err)}`);
      await gracefulExit(1);
      return;
    }
    createFailureWindow(err);
  }
}

ipcMain.handle("desktop.runtime.getStatus", () => buildRuntimeSnapshot());

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

process.on("SIGINT", () => {
  void gracefulExit(0);
});
process.on("SIGTERM", () => {
  void gracefulExit(0);
});

app.whenReady().then(() => {
  void boot();
});

app.on("before-quit", (event) => {
  if (allowAppExit) return;
  event.preventDefault();
  void gracefulExit(0);
});

app.on("window-all-closed", () => {
  if (noWindow && !exitAfterReady) return;
  app.quit();
});
