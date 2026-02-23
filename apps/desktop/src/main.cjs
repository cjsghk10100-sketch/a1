const { spawn } = require("node:child_process");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const { app, BrowserWindow } = require("electron");

const REPO_ROOT = path.resolve(__dirname, "../../..");
const PNPM_BIN = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

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

const webBaseUrl = `http://127.0.0.1:${webPort}`;
const bootstrapUrl = `${webBaseUrl}/desktop-bootstrap`;

/** @type {import("node:child_process").ChildProcess | null} */
let apiProcess = null;
/** @type {import("node:child_process").ChildProcess | null} */
let webProcess = null;
/** @type {import("node:child_process").ChildProcess | null} */
let engineProcess = null;
/** @type {BrowserWindow | null} */
let mainWindow = null;

let shuttingDown = false;
let allowAppExit = false;
/** @type {Promise<void> | null} */
let shutdownPromise = null;

function logLine(prefix, line) {
  const value = String(line).trim();
  if (!value.length) return;
  // Keep logs actionable in desktop-launch terminal.
  // eslint-disable-next-line no-console
  console.log(`[desktop:${prefix}] ${value}`);
}

function spawnManagedProcess(name, args, extraEnv = {}) {
  const child = spawn(PNPM_BIN, args, {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.on("data", (buf) => logLine(name, buf));
  child.stderr?.on("data", (buf) => logLine(name, buf));
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    // eslint-disable-next-line no-console
    console.error(`[desktop:${name}] exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "null"})`);
  });

  child.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error(`[desktop:${name}] spawn failed:`, err);
  });

  return child;
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

async function stopRuntimeOnce() {
  if (!shutdownPromise) {
    shutdownPromise = (async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      await Promise.all([
        killProcess(engineProcess, "engine"),
        killProcess(webProcess, "web"),
        killProcess(apiProcess, "api"),
      ]);
      engineProcess = null;
      webProcess = null;
      apiProcess = null;
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

  apiProcess = spawnManagedProcess("api", ["-C", "apps/api", "start"], {
    PORT: String(apiPort),
    RUN_WORKER_EMBEDDED: runnerMode === "embedded" ? "1" : "0",
  });
  webProcess = spawnManagedProcess("web", [
    "-C",
    "apps/web",
    "dev",
    "--host",
    "127.0.0.1",
    "--port",
    String(webPort),
  ], {
    VITE_DEV_API_BASE_URL: `http://127.0.0.1:${apiPort}`,
    VITE_DESKTOP_RUNNER_MODE: runnerMode,
    VITE_DESKTOP_API_PORT: String(apiPort),
    VITE_DESKTOP_WEB_PORT: String(webPort),
    VITE_DESKTOP_ENGINE_WORKSPACE_ID: engineWorkspaceId,
    VITE_DESKTOP_ENGINE_ROOM_ID: engineRoomId,
    VITE_DESKTOP_ENGINE_ACTOR_ID: engineActorId,
    VITE_DESKTOP_ENGINE_POLL_MS: String(enginePollMs),
    VITE_DESKTOP_ENGINE_MAX_CLAIMS_PER_CYCLE: String(engineMaxClaimsPerCycle),
  });
  if (runnerMode === "external") {
    const engineEnv = {
      ENGINE_API_BASE_URL: `http://127.0.0.1:${apiPort}`,
      ENGINE_WORKSPACE_ID: engineWorkspaceId,
      ENGINE_ACTOR_ID: engineActorId,
      ENGINE_POLL_MS: String(enginePollMs),
      ENGINE_MAX_CLAIMS_PER_CYCLE: String(engineMaxClaimsPerCycle),
    };
    if (engineRoomId.length > 0) {
      engineEnv.ENGINE_ROOM_ID = engineRoomId;
    }
    engineProcess = spawnManagedProcess("engine", ["-C", "apps/engine", "start"], engineEnv);
  }

  await Promise.all([
    waitUntilReachable(`http://127.0.0.1:${apiPort}/health`, apiTimeoutMs).catch(() => undefined),
    waitUntilReachable(webBaseUrl, webTimeoutMs),
  ]);
}

async function boot() {
  try {
    // eslint-disable-next-line no-console
    console.log(
      `[desktop] booting runtime (mode:${runnerMode}, api:${apiPort}, web:${webPort}, api_timeout:${apiTimeoutMs}ms, web_timeout:${webTimeoutMs}ms)`,
    );
    await startRuntime();
    createWindow(bootstrapUrl);
  } catch (err) {
    createFailureWindow(err);
  }
}

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
  app.quit();
});
