import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";

import { runIngestOnce, type IngestConfig } from "../src/ingestDrop.js";

type MockState = {
  messagesCalls: number;
  duplicateCalls: number;
  artifactCalls: number;
  uploads: number;
  permanent400: boolean;
  seenIdempotency: Set<string>;
  artifactObjectKeys: Set<string>;
  transportMessageFailuresRemaining: number;
  requireBearer: boolean;
  acceptedAccessToken: string;
  currentRefreshToken: string;
  refreshCalls: number;
};

type AuthHandle = {
  bearerToken: string;
  refreshToken: string;
};

function readBearerToken(req: http.IncomingMessage): string {
  const raw = req.headers.authorization;
  if (!raw || !raw.startsWith("Bearer ")) return "";
  return raw.slice("Bearer ".length).trim();
}

function sendUnauthorized(res: http.ServerResponse): void {
  res.writeHead(401, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      error: true,
      reason_code: "internal_error",
      reason: "invalid_session",
      details: {},
    }),
  );
}

async function readBodyJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  let bodyRaw = "";
  for await (const chunk of req) bodyRaw += String(chunk);
  if (!bodyRaw) return {};
  return JSON.parse(bodyRaw) as Record<string, unknown>;
}

async function startMockServer(state: MockState): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (req.method === "POST" && url.pathname === "/v1/auth/refresh") {
      const body = await readBodyJson(req);
      const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : "";
      if (!refreshToken || refreshToken !== state.currentRefreshToken) {
        sendUnauthorized(res);
        return;
      }
      state.refreshCalls += 1;
      state.acceptedAccessToken = `token_refreshed_${state.refreshCalls}`;
      state.currentRefreshToken = `refresh_refreshed_${state.refreshCalls}`;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          session: {
            access_token: state.acceptedAccessToken,
            refresh_token: state.currentRefreshToken,
          },
        }),
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/artifacts") {
      if (state.requireBearer && readBearerToken(req) !== state.acceptedAccessToken) {
        sendUnauthorized(res);
        return;
      }
      state.artifactCalls += 1;
      const body = await readBodyJson(req);
      const correlationId = typeof body.correlation_id === "string" ? body.correlation_id : "corr";
      const messageId = typeof body.message_id === "string" ? body.message_id : "msg";
      const objectKey = `artifacts/ws_test/${encodeURIComponent(correlationId)}/${encodeURIComponent(messageId)}.json`;
      state.artifactObjectKeys.add(objectKey);
      const origin = `http://${req.headers.host ?? "127.0.0.1"}`;
      res.writeHead(201, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          artifact_id: `art_${state.artifactCalls}`,
          object_key: objectKey,
          upload_url: `${origin}/upload/${state.artifactCalls}`,
          content_type: "application/json",
        }),
      );
      return;
    }

    if ((req.method === "PUT" || req.method === "POST") && url.pathname.startsWith("/upload/")) {
      state.uploads += 1;
      for await (const _chunk of req) {
        // consume stream
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/messages") {
      if (state.requireBearer && readBearerToken(req) !== state.acceptedAccessToken) {
        sendUnauthorized(res);
        return;
      }

      if (state.transportMessageFailuresRemaining > 0) {
        state.transportMessageFailuresRemaining -= 1;
        req.socket.destroy();
        return;
      }

      state.messagesCalls += 1;
      const body = await readBodyJson(req);
      const idempotencyKey = typeof body.idempotency_key === "string" ? body.idempotency_key : "";

      if (state.permanent400) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: true,
            reason_code: "missing_field",
            reason: "missing_field",
            details: { field: "payload" },
          }),
        );
        return;
      }

      if (state.seenIdempotency.has(idempotencyKey)) {
        state.duplicateCalls += 1;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            message_id: "msg_duplicate",
            idempotent_replay: true,
            reason_code: "duplicate_idempotent_replay",
          }),
        );
        return;
      }

      state.seenIdempotency.add(idempotencyKey);
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ message_id: "msg_created", idempotent_replay: false }));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("mock server did not bind to TCP port");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
    },
  };
}

async function makeTempDropRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ingest-drop-test-"));
  const dropRoot = path.join(dir, "_drop");
  await mkdir(dropRoot, { recursive: true });
  return dropRoot;
}

async function writeValidItem(dropRoot: string, fileName: string, artifactNames: string[]): Promise<void> {
  for (const artifactName of artifactNames) {
    const artifactPath = path.join(dropRoot, artifactName);
    await writeFile(artifactPath, `hello-${artifactName}`, "utf8");
  }

  const itemPath = path.join(dropRoot, fileName);
  const wrapper = {
    schema_version: "2.1",
    from_agent_id: "engine_agent",
    message: {
      schema_version: "2.1",
      from_agent_id: "engine_agent",
      intent: "message",
      payload: { text: "hello" },
    },
    artifacts: artifactNames.map((name) => ({
      path: name,
      content_type: "text/plain",
      filename: name,
    })),
  };

  await writeFile(itemPath, `${JSON.stringify(wrapper, null, 2)}\n`, "utf8");
}

function buildConfig(baseUrl: string, dropRoot: string, auth?: AuthHandle): IngestConfig {
  const cfg: IngestConfig = {
    apiBaseUrl: baseUrl,
    workspaceId: "ws_test",
    agentId: "engine_agent",
    runId: "run_test_ingest",
    ingestEnabled: true,
    dropRoot,
    maxItemConcurrency: 2,
    maxAttempts: 5,
    maxIngestFileBytes: 1024 * 1024,
    maxArtifactBytes: 5 * 1024 * 1024,
    httpTimeoutSec: 10,
    stableCheckMs: 5,
    pollMs: 50,
  };

  if (auth) {
    cfg.bearerToken = auth.bearerToken;
    cfg.refreshToken = auth.refreshToken;
    cfg.getBearerToken = () => auth.bearerToken;
    cfg.setBearerToken = (token: string) => {
      auth.bearerToken = token;
    };
    cfg.getRefreshToken = () => auth.refreshToken;
    cfg.setRefreshToken = (token: string) => {
      auth.refreshToken = token;
    };
  }

  return cfg;
}

async function existsAt(dir: string, fileName: string): Promise<boolean> {
  try {
    const st = await stat(path.join(dir, fileName));
    return st.isFile();
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const state: MockState = {
    messagesCalls: 0,
    duplicateCalls: 0,
    artifactCalls: 0,
    uploads: 0,
    permanent400: false,
    seenIdempotency: new Set<string>(),
    artifactObjectKeys: new Set<string>(),
    transportMessageFailuresRemaining: 0,
    requireBearer: false,
    acceptedAccessToken: "token_fresh_0",
    currentRefreshToken: "refresh_0",
    refreshCalls: 0,
  };

  const mock = await startMockServer(state);

  try {
    const dropRoot = await makeTempDropRoot();
    const cfg = buildConfig(mock.baseUrl, dropRoot);

    await writeValidItem(dropRoot, "item-a.ingest.json", ["artifact-a.txt", "artifact-b.txt"]);
    await runIngestOnce(cfg);

    assert.equal(await existsAt(path.join(dropRoot, "_ingested"), "item-a.ingest.json"), true);
    assert.equal(await existsAt(path.join(dropRoot, "_quarantine"), "item-a.ingest.json"), false);
    assert.equal(state.messagesCalls, 1);
    assert.equal(state.artifactCalls, 2);
    assert.equal(state.uploads, 2);
    assert.equal(state.artifactObjectKeys.size, 2);

    await rename(
      path.join(dropRoot, "_ingested", "item-a.ingest.json"),
      path.join(dropRoot, "item-a.ingest.json"),
    );

    await runIngestOnce(cfg);
    assert.equal(await existsAt(path.join(dropRoot, "_ingested"), "item-a.ingest.json"), true);
    assert.equal(state.messagesCalls, 2);
    assert.equal(state.duplicateCalls, 1);
    assert.equal(state.artifactCalls, 4);
    assert.equal(state.uploads, 4);
    assert.equal(state.artifactObjectKeys.size, 2);

    const prevArtifactCalls = state.artifactCalls;
    state.transportMessageFailuresRemaining = 1;
    await writeValidItem(dropRoot, "item-c.ingest.json", ["artifact-c.txt"]);

    await runIngestOnce(cfg);

    assert.equal(await existsAt(path.join(dropRoot, "_ingested"), "item-c.ingest.json"), true);
    assert.equal(await existsAt(path.join(dropRoot, "_quarantine"), "item-c.ingest.json"), false);
    assert.equal(state.transportMessageFailuresRemaining, 0);
    assert.ok(state.artifactCalls >= prevArtifactCalls + 2);

    state.requireBearer = true;
    state.acceptedAccessToken = "token_fresh_0";
    state.currentRefreshToken = "refresh_0";
    state.refreshCalls = 0;
    const auth: AuthHandle = {
      bearerToken: "token_stale_0",
      refreshToken: "refresh_0",
    };
    const authCfg = buildConfig(mock.baseUrl, dropRoot, auth);

    await writeValidItem(dropRoot, "item-d.ingest.json", ["artifact-d.txt"]);

    await runIngestOnce(authCfg);

    assert.equal(await existsAt(path.join(dropRoot, "_ingested"), "item-d.ingest.json"), true);
    assert.ok(state.refreshCalls >= 1);
    assert.equal(auth.bearerToken, state.acceptedAccessToken);
    assert.equal(auth.refreshToken, state.currentRefreshToken);

    state.requireBearer = false;
    state.permanent400 = true;
    await writeValidItem(dropRoot, "item-b.ingest.json", ["artifact-bad.txt"]);

    await runIngestOnce(cfg);

    assert.equal(await existsAt(path.join(dropRoot, "_quarantine"), "item-b.ingest.json"), true);
    const errorManifestPath = path.join(dropRoot, "_quarantine", "item-b.ingest.json.error.json");
    const errorManifest = JSON.parse(await readFile(errorManifestPath, "utf8")) as {
      reason_code?: string;
      http_status?: number;
    };
    assert.equal(errorManifest.http_status, 400);
    assert.equal(errorManifest.reason_code, "missing_field");

    const ingestedFiles = await readdir(path.join(dropRoot, "_ingested"));
    assert.ok(ingestedFiles.includes("item-a.ingest.json"));
    assert.ok(ingestedFiles.includes("item-c.ingest.json"));
    assert.ok(ingestedFiles.includes("item-d.ingest.json"));
  } finally {
    await mock.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exitCode = 1;
});
