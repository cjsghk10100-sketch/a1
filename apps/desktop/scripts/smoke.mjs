import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PNPM_BIN = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../../..");

function parseMode() {
  const arg = process.argv.find((value) => value.startsWith("--mode="));
  const mode = arg ? arg.slice("--mode=".length).trim().toLowerCase() : "embedded";
  if (mode !== "embedded" && mode !== "external") {
    throw new Error(`invalid_mode:${mode}`);
  }
  return mode;
}

async function reservePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("failed_to_reserve_port")));
        return;
      }
      const port = address.port;
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitFor(checker, timeoutMs, intervalMs = 300) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const result = await checker();
      if (result) return;
    } catch {
      // retry until timeout
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("smoke_wait_timeout");
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  const json = text.length ? JSON.parse(text) : {};
  return { status: res.status, json };
}

async function ensureOwnerSession(baseUrl, workspaceId, bootstrapToken, passphrase) {
  const bootstrap = await fetchJson(`${baseUrl}/v1/auth/bootstrap-owner`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(bootstrapToken ? { "x-bootstrap-token": bootstrapToken } : {}),
    },
    body: JSON.stringify({
      workspace_id: workspaceId,
      display_name: "Desktop Smoke Owner",
      passphrase,
    }),
  });

  if (bootstrap.status === 201) {
    return bootstrap.json?.session?.access_token;
  }

  if (bootstrap.status !== 409) {
    throw new Error(`smoke_auth_bootstrap_failed:${bootstrap.status}`);
  }

  const login = await fetchJson(`${baseUrl}/v1/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      workspace_id: workspaceId,
      passphrase,
    }),
  });
  if (login.status !== 200) {
    throw new Error(`smoke_auth_login_failed:${login.status}`);
  }
  return login.json?.session?.access_token;
}

async function waitForHealth(baseUrl) {
  await waitFor(async () => {
    const res = await fetch(`${baseUrl}/health`, { method: "GET" });
    return res.ok;
  }, 90_000);
}

async function waitForBootstrap(webPort) {
  await waitFor(async () => {
    const res = await fetch(`http://127.0.0.1:${webPort}/desktop-bootstrap`, {
      method: "GET",
    });
    return res.status >= 200 && res.status < 500;
  }, 90_000);
}

async function createSmokeRun(baseUrl, workspaceId, accessToken) {
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${accessToken}`,
  };
  const room = await fetchJson(`${baseUrl}/v1/rooms`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: `smoke_room_${Date.now()}`,
      room_mode: "default",
      default_lang: "en",
    }),
  });
  if (room.status !== 201) {
    throw new Error(`smoke_room_create_failed:${room.status}`);
  }
  const roomId = room.json.room_id;

  const run = await fetchJson(`${baseUrl}/v1/runs`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      room_id: roomId,
      title: "desktop smoke run",
      goal: "desktop smoke verification",
    }),
  });
  if (run.status !== 201) {
    throw new Error(`smoke_run_create_failed:${run.status}`);
  }
  return { runId: run.json.run_id, headers };
}

async function waitForRunSucceeded(baseUrl, runId, headers) {
  await waitFor(async () => {
    const run = await fetchJson(`${baseUrl}/v1/runs/${encodeURIComponent(runId)}`, {
      method: "GET",
      headers,
    });
    if (run.status !== 200) return false;
    return run.json?.run?.status === "succeeded";
  }, 90_000);
}

function hasXvfbRun() {
  if (process.platform !== "linux") return false;
  const result = spawnSync("xvfb-run", ["--help"], {
    stdio: "ignore",
  });
  return result.error == null;
}

function spawnDesktop(env) {
  const shouldWrapWithXvfb = process.platform === "linux" && !process.env.DISPLAY && hasXvfbRun();
  const command = shouldWrapWithXvfb ? "xvfb-run" : PNPM_BIN;
  const args = shouldWrapWithXvfb
    ? ["-a", PNPM_BIN, "-C", "apps/desktop", "dev"]
    : ["-C", "apps/desktop", "dev"];

  return spawn(command, args, {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      ...env,
    },
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function stopProcess(child) {
  if (!child || child.killed) return;
  await new Promise((resolve) => {
    let done = false;
    const complete = () => {
      if (done) return;
      done = true;
      resolve();
    };
    child.once("exit", complete);
    child.kill("SIGTERM");
    if (process.platform !== "win32" && typeof child.pid === "number") {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // best effort
      }
    }
    setTimeout(() => {
      if (done) return;
      if (process.platform !== "win32" && typeof child.pid === "number") {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // best effort
        }
      }
      child.kill("SIGKILL");
      complete();
    }, 4000);
  });
}

async function main() {
  const mode = parseMode();
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for desktop smoke");
  }

  const apiPort = await reservePort();
  const webPort = await reservePort();
  const workspaceId = `ws_smoke_${mode}_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  const bootstrapToken = `smoke_bootstrap_${mode}`;
  const ownerPassphrase = `smoke_owner_${workspaceId}`;
  const desktopUserDataDir = await mkdtemp(path.join(os.tmpdir(), `agentapp-desktop-smoke-${mode}-`));
  const apiBaseUrl = `http://127.0.0.1:${apiPort}`;

  const env = {
    DATABASE_URL: databaseUrl,
    ELECTRON_DISABLE_SANDBOX: "1",
    DESKTOP_NO_WINDOW: "1",
    DESKTOP_API_START_TIMEOUT_MS: "90000",
    DESKTOP_WEB_START_TIMEOUT_MS: "90000",
    DESKTOP_API_PORT: String(apiPort),
    DESKTOP_WEB_PORT: String(webPort),
    DESKTOP_RUNNER_MODE: mode,
    DESKTOP_ENGINE_WORKSPACE_ID: workspaceId,
    DESKTOP_ENGINE_ACTOR_ID: `smoke_${mode}_engine`,
    DESKTOP_ENGINE_POLL_MS: "300",
    DESKTOP_ENGINE_MAX_CLAIMS_PER_CYCLE: "1",
    DESKTOP_BOOTSTRAP_TOKEN: bootstrapToken,
    DESKTOP_OWNER_PASSPHRASE: ownerPassphrase,
    DESKTOP_USER_DATA_DIR: desktopUserDataDir,
  };

  const child = spawnDesktop(env);
  let stderr = "";
  let stdout = "";
  child.stdout.on("data", (buf) => {
    stdout += String(buf);
    if (stdout.length > 8_000) {
      stdout = stdout.slice(-8_000);
    }
  });
  child.stderr.on("data", (buf) => {
    stderr += String(buf);
    if (stderr.length > 8_000) {
      stderr = stderr.slice(-8_000);
    }
  });

  try {
    await waitForHealth(apiBaseUrl);
    await waitForBootstrap(webPort);
    const accessToken = await ensureOwnerSession(
      apiBaseUrl,
      workspaceId,
      bootstrapToken,
      ownerPassphrase,
    );
    if (!accessToken) throw new Error("smoke_auth_token_missing");
    const { runId, headers } = await createSmokeRun(apiBaseUrl, workspaceId, accessToken);
    await waitForRunSucceeded(apiBaseUrl, runId, headers);
    // eslint-disable-next-line no-console
    console.log(`[desktop-smoke] ok (mode=${mode}, api=${apiPort}, web=${webPort}, run=${runId})`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `desktop_smoke_failed:${mode}:${message}:stdout=${stdout.slice(-1200)}:stderr=${stderr.slice(-1200)}`,
    );
  } finally {
    await stopProcess(child);
    await rm(desktopUserDataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
