import assert from "node:assert/strict";
import http from "node:http";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

import { createPool } from "../src/db/pool.js";
import { buildServer } from "../src/server.js";

const { Client } = pg;

type JsonResponse = {
  status: number;
  json: unknown;
  text: string;
};

type ContractErrorJson = {
  error: true;
  reason_code: string;
  reason: string;
  details: Record<string, unknown>;
};

type StorageMock = {
  baseUrl: string;
  existingKeys: Set<string>;
  close: () => Promise<void>;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function applyMigrations(databaseUrl: string): Promise<void> {
  const migrationsDir = path.resolve(process.cwd(), "migrations");
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );`,
    );

    const applied = await client.query<{ version: string }>(
      "SELECT version FROM schema_migrations ORDER BY version ASC",
    );
    const appliedSet = new Set(applied.rows.map((r) => r.version));

    for (const file of files) {
      if (appliedSet.has(file)) continue;

      const fullPath = path.join(migrationsDir, file);
      const sql = await readFile(fullPath, "utf8");

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }
  } finally {
    await client.end();
  }
}

async function postJsonAny(
  baseUrl: string,
  urlPath: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<JsonResponse> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(headers ?? {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  return { status: res.status, json, text };
}

function assertContractError(json: unknown, reason_code: string): void {
  const payload = json as Partial<ContractErrorJson>;
  assert.equal(payload.error, true);
  assert.equal(payload.reason_code, reason_code);
  assert.equal(typeof payload.reason, "string");
  assert.ok((payload.reason ?? "").length > 0);
  assert.equal(typeof payload.details, "object");
  assert.ok(payload.details != null);
}

async function startStorageMock(): Promise<StorageMock> {
  const existingKeys = new Set<string>();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const object_key = url.searchParams.get("object_key") ?? "";

    if (req.method === "HEAD" && url.pathname === "/head") {
      if (existingKeys.has(object_key)) {
        res.writeHead(200);
      } else {
        res.writeHead(404);
      }
      res.end();
      return;
    }

    if (url.pathname === "/upload") {
      res.writeHead(200);
      res.end();
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("storage mock did not bind to a TCP port");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    existingKeys,
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

async function main(): Promise<void> {
  const databaseUrl = requireEnv("DATABASE_URL");
  await applyMigrations(databaseUrl);

  const storageMock = await startStorageMock();
  const prevHeadUrl = process.env.ARTIFACT_STORAGE_HEAD_URL;
  const prevUploadUrl = process.env.ARTIFACT_UPLOAD_BASE_URL;
  process.env.ARTIFACT_STORAGE_HEAD_URL = `${storageMock.baseUrl}/head?object_key={object_key}`;
  process.env.ARTIFACT_UPLOAD_BASE_URL = `${storageMock.baseUrl}/upload`;

  const pool = createPool(databaseUrl);
  const app = await buildServer({
    config: { port: 0, databaseUrl },
    pool,
  });

  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected server to listen on a TCP port");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const workspace_id = "ws_contract_messages_artifacts";
  const workspaceHeader = { "x-workspace-id": workspace_id };

  try {
    const seedRoom = await postJsonAny(
      baseUrl,
      "/v1/rooms",
      { title: "seed", room_mode: "default", default_lang: "en" },
      workspaceHeader,
    );
    assert.equal(seedRoom.status, 201, seedRoom.text);

    const db = new Client({ connectionString: databaseUrl });
    await db.connect();
    try {
      const legacyPrincipal = await db.query<{ principal_id: string }>(
        `SELECT principal_id
         FROM sec_principals
         WHERE legacy_actor_type = 'user'
           AND legacy_actor_id = 'legacy_header'
         LIMIT 1`,
      );
      assert.equal(legacyPrincipal.rowCount, 1);
      const principal_id = legacyPrincipal.rows[0].principal_id;
      const authenticatedAgentId = "agt_contract_sender";

      await db.query(
        `INSERT INTO sec_agents (agent_id, principal_id, display_name)
         VALUES ($1, $2, $3)
         ON CONFLICT (principal_id) DO UPDATE SET
           agent_id = EXCLUDED.agent_id,
           display_name = EXCLUDED.display_name,
           revoked_at = NULL`,
        [authenticatedAgentId, principal_id, "Contract Sender"],
      );

      const unsupported = await postJsonAny(
        baseUrl,
        "/v1/messages",
        {
          schema_version: "1.0",
          from_agent_id: authenticatedAgentId,
          idempotency_key: "msg:unsupported",
          payload: { hello: "world" },
        },
        workspaceHeader,
      );
      assert.equal(unsupported.status, 400);
      assertContractError(unsupported.json, "unsupported_version");

      const unknownAgent = await postJsonAny(
        baseUrl,
        "/v1/messages",
        {
          schema_version: "2.1",
          from_agent_id: "agt_other",
          idempotency_key: "msg:unknown-agent",
          payload: { hello: "world" },
        },
        workspaceHeader,
      );
      assert.equal(unknownAgent.status, 403);
      assertContractError(unknownAgent.json, "unknown_agent");

      const unauthorizedWorkspace = await postJsonAny(
        baseUrl,
        "/v1/messages",
        {
          schema_version: "2.1",
          workspace_id: "ws_other",
          from_agent_id: authenticatedAgentId,
          idempotency_key: "msg:unauthorized-workspace",
          payload: { hello: "world" },
        },
        workspaceHeader,
      );
      assert.equal(unauthorizedWorkspace.status, 403);
      assertContractError(unauthorizedWorkspace.json, "unauthorized_workspace");

      const oversized = await postJsonAny(
        baseUrl,
        "/v1/messages",
        {
          schema_version: "2.1",
          from_agent_id: authenticatedAgentId,
          idempotency_key: "msg:too-large",
          payload: { text: "x".repeat(8_193) },
        },
        workspaceHeader,
      );
      assert.equal(oversized.status, 413);
      assertContractError(oversized.json, "payload_too_large");

      const missingArtifact = await postJsonAny(
        baseUrl,
        "/v1/messages",
        {
          schema_version: "2.1",
          from_agent_id: authenticatedAgentId,
          idempotency_key: "msg:missing-artifact",
          payload_ref: {
            object_key: "artifacts/ws_contract_messages_artifacts/missing/missing.json",
          },
        },
        workspaceHeader,
      );
      assert.equal(missingArtifact.status, 422);
      assertContractError(missingArtifact.json, "artifact_not_found");

      const issueArtifact = await postJsonAny(
        baseUrl,
        "/v1/artifacts",
        {
          schema_version: "2.1",
          correlation_id: `corr_contract_artifact_${Date.now().toString(36)}`,
          message_id: `msg_contract_artifact_${Date.now().toString(36)}`,
          content_type: "application/json",
        },
        workspaceHeader,
      );
      assert.equal(issueArtifact.status, 201, issueArtifact.text);
      const issued = issueArtifact.json as {
        artifact_id: string;
        object_key: string;
        upload_url: string;
        content_type: string;
      };
      assert.ok(issued.artifact_id.startsWith("art_"));
      assert.ok(
        issued.object_key.startsWith("artifacts/ws_contract_messages_artifacts/corr_contract_artifact_"),
      );
      assert.equal(issued.content_type, "application/json");
      assert.ok(issued.upload_url.includes("object_key="));

      const uploadIssueEvents = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM evt_events
         WHERE workspace_id = $1
           AND event_type = 'artifact.upload_url_issued'
           AND data->>'object_key' = $2`,
        [workspace_id, issued.object_key],
      );
      assert.equal(Number(uploadIssueEvents.rows[0]?.count ?? "0"), 0);

      const idempotencyKey = `msg:replay:key:${Date.now().toString(36)}`;
      const first = await postJsonAny(
        baseUrl,
        "/v1/messages",
        {
          schema_version: "2.1",
          from_agent_id: authenticatedAgentId,
          idempotency_key: idempotencyKey,
          payload: { hello: "world" },
        },
        workspaceHeader,
      );
      assert.equal(first.status, 201, first.text);
      const firstJson = first.json as { message_id: string; idempotent_replay: boolean };
      assert.equal(firstJson.idempotent_replay, false);
      assert.ok(firstJson.message_id.startsWith("msg_"));

      const second = await postJsonAny(
        baseUrl,
        "/v1/messages",
        {
          schema_version: "2.1",
          from_agent_id: authenticatedAgentId,
          idempotency_key: idempotencyKey,
          payload: { hello: "world" },
        },
        workspaceHeader,
      );
      assert.equal(second.status, 200, second.text);
      const secondJson = second.json as {
        message_id: string;
        idempotent_replay: boolean;
        reason_code: string;
      };
      assert.equal(secondJson.idempotent_replay, true);
      assert.equal(secondJson.reason_code, "duplicate_idempotent_replay");
      assert.equal(secondJson.message_id, firstJson.message_id);

      const duplicateCount = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM evt_events
         WHERE workspace_id = $1
           AND stream_type = 'workspace'
           AND stream_id = $1
           AND event_type = 'message.created'
           AND idempotency_key = $2`,
        [workspace_id, idempotencyKey],
      );
      assert.equal(Number(duplicateCount.rows[0]?.count ?? "0"), 1);
    } finally {
      await db.end();
    }
  } finally {
    await app.close();
    await storageMock.close();
    if (prevHeadUrl === undefined) delete process.env.ARTIFACT_STORAGE_HEAD_URL;
    else process.env.ARTIFACT_STORAGE_HEAD_URL = prevHeadUrl;
    if (prevUploadUrl === undefined) delete process.env.ARTIFACT_UPLOAD_BASE_URL;
    else process.env.ARTIFACT_UPLOAD_BASE_URL = prevUploadUrl;
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
