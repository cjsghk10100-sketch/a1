import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

import { createPool } from "../src/db/pool.js";
import { buildServer } from "../src/server.js";

const { Client } = pg;

type ApprovalStageItem = {
  entity_type: "approval";
  entity_id: string;
  title: string;
  status: "pending" | "held";
  room_id: string | null;
  thread_id: string | null;
  correlation_id: string;
  updated_at: string;
  last_event_id: string | null;
  links: {
    experiment_id: string | null;
    approval_id: string | null;
    run_id: string | null;
    evidence_id: string | null;
    scorecard_id: string | null;
    incident_id: string | null;
  };
};

type RunStageItem = {
  entity_type: "run";
  entity_id: string;
  title: string;
  status: "queued" | "running" | "succeeded" | "failed";
  room_id: string | null;
  thread_id: string | null;
  correlation_id: string;
  updated_at: string;
  last_event_id: string | null;
  links: {
    experiment_id: string | null;
    approval_id: string | null;
    run_id: string | null;
    evidence_id: string | null;
    scorecard_id: string | null;
    incident_id: string | null;
  };
};

type ProjectionResponse = {
  schema_version: string;
  generated_at: string;
  "1_inbox": Array<Record<string, never>>;
  "2_pending_approval": ApprovalStageItem[];
  "3_execute_workspace": RunStageItem[];
  "4_review_evidence": RunStageItem[];
  "5_promoted": Array<Record<string, never>>;
  "6_demoted": RunStageItem[];
};

type EnvelopeProjectionResponse = {
  meta: {
    schema_version: string;
    generated_at: string;
    limit: number;
    truncated: boolean;
    stage_stats: Record<
      "1_inbox" | "2_pending_approval" | "3_execute_workspace" | "4_review_evidence" | "5_promoted" | "6_demoted",
      { returned: number; truncated: boolean }
    >;
    watermark_event_id: string | null;
  };
  stages: {
    "1_inbox": Array<Record<string, never>>;
    "2_pending_approval": ApprovalStageItem[];
    "3_execute_workspace": RunStageItem[];
    "4_review_evidence": RunStageItem[];
    "5_promoted": Array<Record<string, never>>;
    "6_demoted": RunStageItem[];
  };
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

async function postJson<T>(
  baseUrl: string,
  urlPath: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(headers ?? {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`POST ${urlPath} failed: ${res.status} ${text}`);
  }
  return JSON.parse(text) as T;
}

async function getJson<T>(
  baseUrl: string,
  urlPath: string,
  headers?: Record<string, string>,
): Promise<T> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: "GET",
    headers: { ...(headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GET ${urlPath} failed: ${res.status} ${text}`);
  }
  return JSON.parse(text) as T;
}

function compareByUpdatedAtDescAndEntityIdAsc<T extends { updated_at: string; entity_id: string }>(
  a: T,
  b: T,
): number {
  const timeDiff = new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  if (timeDiff !== 0) return timeDiff;
  return a.entity_id.localeCompare(b.entity_id);
}

function assertNoLeaseFields(items: RunStageItem[]): void {
  for (const item of items) {
    assert.ok(!("lease_heartbeat_at" in item));
    assert.ok(!("lease_expires_at" in item));
    assert.ok(!("claim_token" in item));
    assert.ok(!("claimed_by_actor_id" in item));
  }
}

function assertLinksShape(item: ApprovalStageItem | RunStageItem): void {
  assert.ok(typeof item.links === "object" && item.links != null);
  assert.ok("experiment_id" in item.links);
  assert.ok("approval_id" in item.links);
  assert.ok("run_id" in item.links);
  assert.ok("evidence_id" in item.links);
  assert.ok("scorecard_id" in item.links);
  assert.ok("incident_id" in item.links);
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv("DATABASE_URL");
  await applyMigrations(databaseUrl);

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

  const workspaceHeader = { "x-workspace-id": `ws_contract_pipeline_projection_${Date.now()}` };

  try {
    const { room_id } = await postJson<{ room_id: string }>(
      baseUrl,
      "/v1/rooms",
      { title: "Pipeline Projection Contract Room", room_mode: "default", default_lang: "en" },
      workspaceHeader,
    );

    const queuedRun = await postJson<{ run_id: string }>(
      baseUrl,
      "/v1/runs",
      { room_id, title: "Queued run for projection" },
      workspaceHeader,
    );

    const runningRun = await postJson<{ run_id: string }>(
      baseUrl,
      "/v1/runs",
      { room_id, title: "Running run for projection" },
      workspaceHeader,
    );
    await postJson<{ ok: boolean }>(
      baseUrl,
      `/v1/runs/${runningRun.run_id}/start`,
      {},
      workspaceHeader,
    );

    const succeededRun = await postJson<{ run_id: string }>(
      baseUrl,
      "/v1/runs",
      { room_id, title: "Succeeded run for projection" },
      workspaceHeader,
    );
    await postJson<{ ok: boolean }>(
      baseUrl,
      `/v1/runs/${succeededRun.run_id}/start`,
      {},
      workspaceHeader,
    );
    await postJson<{ ok: boolean }>(
      baseUrl,
      `/v1/runs/${succeededRun.run_id}/complete`,
      { summary: "done", output: { ok: true } },
      workspaceHeader,
    );

    const failedRun = await postJson<{ run_id: string }>(
      baseUrl,
      "/v1/runs",
      { room_id, title: "Failed run for projection" },
      workspaceHeader,
    );
    await postJson<{ ok: boolean }>(
      baseUrl,
      `/v1/runs/${failedRun.run_id}/start`,
      {},
      workspaceHeader,
    );
    await postJson<{ ok: boolean }>(
      baseUrl,
      `/v1/runs/${failedRun.run_id}/fail`,
      { message: "failed", error: { code: "test_failure" } },
      workspaceHeader,
    );

    const pendingApproval = await postJson<{ approval_id: string }>(
      baseUrl,
      "/v1/approvals",
      { action: "external.write", title: "Pending approval", room_id },
      workspaceHeader,
    );
    const holdApproval = await postJson<{ approval_id: string }>(
      baseUrl,
      "/v1/approvals",
      { action: "external.write", title: "Hold approval", room_id },
      workspaceHeader,
    );
    await postJson<{ ok: boolean }>(
      baseUrl,
      `/v1/approvals/${holdApproval.approval_id}/decide`,
      { decision: "hold", reason: "manual review" },
      workspaceHeader,
    );

    const projection = await getJson<ProjectionResponse>(
      baseUrl,
      "/v1/pipeline/projection?limit=200",
      workspaceHeader,
    );

    assert.equal(projection.schema_version, "pipeline_projection.v0.1");
    assert.ok(!Number.isNaN(new Date(projection.generated_at).getTime()));
    assert.ok(Array.isArray(projection["1_inbox"]));
    assert.ok(Array.isArray(projection["2_pending_approval"]));
    assert.ok(Array.isArray(projection["3_execute_workspace"]));
    assert.ok(Array.isArray(projection["4_review_evidence"]));
    assert.ok(Array.isArray(projection["5_promoted"]));
    assert.ok(Array.isArray(projection["6_demoted"]));
    assert.equal(projection["1_inbox"].length, 0);
    assert.equal(projection["5_promoted"].length, 0);

    const approvalIds = new Set(projection["2_pending_approval"].map((item) => item.entity_id));
    assert.ok(approvalIds.has(pendingApproval.approval_id));
    assert.ok(approvalIds.has(holdApproval.approval_id));
    for (const item of projection["2_pending_approval"]) {
      assert.equal(item.entity_type, "approval");
      assert.ok(item.status === "pending" || item.status === "held");
      assert.equal(typeof item.title, "string");
      assertLinksShape(item);
    }
    assert.deepEqual(
      projection["2_pending_approval"],
      [...projection["2_pending_approval"]].sort(compareByUpdatedAtDescAndEntityIdAsc),
    );

    const executeRunIds = new Set(projection["3_execute_workspace"].map((item) => item.entity_id));
    assert.ok(executeRunIds.has(queuedRun.run_id));
    assert.ok(executeRunIds.has(runningRun.run_id));
    for (const item of projection["3_execute_workspace"]) {
      assert.ok(item.status === "queued" || item.status === "running");
      assert.equal(item.entity_type, "run");
      assert.equal(typeof item.title, "string");
      assertLinksShape(item);
    }
    assert.deepEqual(
      projection["3_execute_workspace"],
      [...projection["3_execute_workspace"]].sort(compareByUpdatedAtDescAndEntityIdAsc),
    );
    assertNoLeaseFields(projection["3_execute_workspace"]);

    const reviewRunIds = new Set(projection["4_review_evidence"].map((item) => item.entity_id));
    assert.ok(reviewRunIds.has(succeededRun.run_id));
    assert.ok(!reviewRunIds.has(failedRun.run_id));
    for (const item of projection["4_review_evidence"]) {
      assert.ok(item.status === "succeeded" || item.status === "failed");
      assert.equal(item.entity_type, "run");
      assert.equal(typeof item.title, "string");
      assertLinksShape(item);
    }
    assert.deepEqual(
      projection["4_review_evidence"],
      [...projection["4_review_evidence"]].sort(compareByUpdatedAtDescAndEntityIdAsc),
    );
    assertNoLeaseFields(projection["4_review_evidence"]);

    const demotedRunIds = new Set(projection["6_demoted"].map((item) => item.entity_id));
    assert.ok(demotedRunIds.has(failedRun.run_id));
    for (const item of projection["6_demoted"]) {
      assert.equal(item.status, "failed");
      assert.equal(item.entity_type, "run");
      assert.equal(typeof item.title, "string");
      assertLinksShape(item);
    }
    assert.deepEqual(
      projection["6_demoted"],
      [...projection["6_demoted"]].sort(compareByUpdatedAtDescAndEntityIdAsc),
    );
    assertNoLeaseFields(projection["6_demoted"]);

    const envelope = await getJson<EnvelopeProjectionResponse>(
      baseUrl,
      "/v1/pipeline/projection?limit=200&format=envelope",
      workspaceHeader,
    );
    assert.equal(envelope.meta.schema_version, "2.1");
    assert.equal(envelope.meta.limit, 200);
    assert.ok(!Number.isNaN(new Date(envelope.meta.generated_at).getTime()));
    assert.ok(Array.isArray(envelope.stages["1_inbox"]));
    assert.ok(Array.isArray(envelope.stages["2_pending_approval"]));
    assert.ok(Array.isArray(envelope.stages["3_execute_workspace"]));
    assert.ok(Array.isArray(envelope.stages["4_review_evidence"]));
    assert.ok(Array.isArray(envelope.stages["5_promoted"]));
    assert.ok(Array.isArray(envelope.stages["6_demoted"]));
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
