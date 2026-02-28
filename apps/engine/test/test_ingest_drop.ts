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
};

async function startMockServer(state: MockState): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (req.method === "POST" && url.pathname === "/v1/artifacts") {
      state.artifactCalls += 1;
      let bodyRaw = "";
      for await (const chunk of req) bodyRaw += String(chunk);
      const body = bodyRaw ? (JSON.parse(bodyRaw) as Record<string, unknown>) : {};
      const correlationId = typeof body.correlation_id === "string" ? body.correlation_id : "corr";
      const messageId = typeof body.message_id === "string" ? body.message_id : "msg";
      const objectKey = `artifacts/ws_test/${encodeURIComponent(correlationId)}/${encodeURIComponent(messageId)}.json`;
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
      state.messagesCalls += 1;
      let bodyRaw = "";
      for await (const chunk of req) bodyRaw += String(chunk);
      const body = bodyRaw ? (JSON.parse(bodyRaw) as Record<string, unknown>) : {};
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

async function writeValidItem(dropRoot: string, fileName: string): Promise<void> {
  const artifactPath = path.join(dropRoot, "artifact.txt");
  await writeFile(artifactPath, "hello-ingest", "utf8");

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
    artifacts: [
      {
        path: "artifact.txt",
        content_type: "text/plain",
        filename: "artifact.txt",
      },
    ],
  };

  await writeFile(itemPath, `${JSON.stringify(wrapper, null, 2)}\n`, "utf8");
}

function buildConfig(baseUrl: string, dropRoot: string): IngestConfig {
  return {
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
  };
  const mock = await startMockServer(state);

  try {
    const dropRoot = await makeTempDropRoot();
    const cfg = buildConfig(mock.baseUrl, dropRoot);

    await writeValidItem(dropRoot, "item-a.ingest.json");

    await runIngestOnce(cfg);

    assert.equal(await existsAt(path.join(dropRoot, "_ingested"), "item-a.ingest.json"), true);
    assert.equal(await existsAt(path.join(dropRoot, "_quarantine"), "item-a.ingest.json"), false);
    assert.equal(state.messagesCalls, 1);

    await rename(
      path.join(dropRoot, "_ingested", "item-a.ingest.json"),
      path.join(dropRoot, "item-a.ingest.json"),
    );

    await runIngestOnce(cfg);
    assert.equal(await existsAt(path.join(dropRoot, "_ingested"), "item-a.ingest.json"), true);
    assert.equal(state.messagesCalls, 2);
    assert.equal(state.duplicateCalls, 1);

    state.permanent400 = true;
    await writeValidItem(dropRoot, "item-b.ingest.json");

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
  } finally {
    await mock.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exitCode = 1;
});
