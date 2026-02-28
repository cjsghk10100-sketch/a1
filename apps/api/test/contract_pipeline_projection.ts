import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

import { SCHEMA_VERSION } from "../src/contracts/schemaVersion.js";
import { createPool } from "../src/db/pool.js";
import { buildServer } from "../src/server.js";

const { Client } = pg;

type ProjectionCursor = {
  updated_at: string;
  entity_type: string;
  entity_id: string;
};

type ProjectionItem = {
  entity_type: string;
  entity_id: string;
  title: string;
  status: string;
  room_id: string | null;
  thread_id: string | null;
  correlation_id: string;
  updated_at: string;
  last_event_id: string | null;
  diagnostics?: string[];
  links: {
    experiment_id: string | null;
    approval_id: string | null;
    run_id: string | null;
    evidence_id: string | null;
    scorecard_id: string | null;
    incident_id: string | null;
  };
};

type StageKey =
  | "1_inbox"
  | "2_pending_approval"
  | "3_execute_workspace"
  | "4_review_evidence"
  | "5_promoted"
  | "6_demoted";

type FlatProjectionResponse = {
  schema_version: string;
  generated_at: string;
  "1_inbox": ProjectionItem[];
  "2_pending_approval": ProjectionItem[];
  "3_execute_workspace": ProjectionItem[];
  "4_review_evidence": ProjectionItem[];
  "5_promoted": ProjectionItem[];
  "6_demoted": ProjectionItem[];
};

type EnvelopeProjectionResponse = {
  meta: {
    schema_version: string;
    workspace_id: string;
    generated_at: string;
    limit: number;
    truncated: boolean;
    next_cursor: ProjectionCursor | null;
  };
  stages: Record<StageKey, ProjectionItem[]>;
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
  headers: Record<string, string>,
): Promise<T> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
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
  headers: Record<string, string>,
): Promise<T> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: "GET",
    headers,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GET ${urlPath} failed: ${res.status} ${text}`);
  }
  return JSON.parse(text) as T;
}

function findItem(stages: Record<StageKey, ProjectionItem[]>, entityId: string): ProjectionItem | null {
  const keys: StageKey[] = [
    "1_inbox",
    "2_pending_approval",
    "3_execute_workspace",
    "4_review_evidence",
    "5_promoted",
    "6_demoted",
  ];
  for (const key of keys) {
    const stage = stages[key];
    const found = stage.find((item) => item.entity_id === entityId);
    if (found) return found;
  }
  return null;
}

function findStageFor(stages: FlatProjectionResponse, entityId: string): StageKey | null {
  const keys: StageKey[] = [
    "1_inbox",
    "2_pending_approval",
    "3_execute_workspace",
    "4_review_evidence",
    "5_promoted",
    "6_demoted",
  ];
  for (const key of keys) {
    if (stages[key].some((item) => item.entity_id === entityId)) return key;
  }
  return null;
}

function assertStageKeys(stages: FlatProjectionResponse): void {
  assert.ok(Array.isArray(stages["1_inbox"]));
  assert.ok(Array.isArray(stages["2_pending_approval"]));
  assert.ok(Array.isArray(stages["3_execute_workspace"]));
  assert.ok(Array.isArray(stages["4_review_evidence"]));
  assert.ok(Array.isArray(stages["5_promoted"]));
  assert.ok(Array.isArray(stages["6_demoted"]));
}

async function lookupEvidenceId(pool: ReturnType<typeof createPool>, workspace_id: string, run_id: string): Promise<string> {
  const row = await pool.query<{ evidence_id: string }>(
    `SELECT evidence_id
     FROM proj_evidence_manifests
     WHERE workspace_id = $1
       AND run_id = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [workspace_id, run_id],
  );
  if (row.rowCount !== 1) throw new Error(`missing evidence for run ${run_id}`);
  return row.rows[0].evidence_id;
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
  const workspace_id = `ws_contract_projection_gate_${Date.now()}`;
  const workspaceHeader = { "x-workspace-id": workspace_id };

  try {
    const { room_id } = await postJson<{ room_id: string }>(
      baseUrl,
      "/v1/rooms",
      { title: "Projection Gate Contract", room_mode: "default", default_lang: "en" },
      workspaceHeader,
    );

    const draftExperiment = await postJson<{ experiment_id: string }>(
      baseUrl,
      "/v1/experiments",
      {
        room_id,
        title: "Draft Experiment",
        hypothesis: "test",
        success_criteria: {},
        stop_conditions: {},
        budget_cap_units: 10,
        risk_tier: "low",
      },
      workspaceHeader,
    );

    const activeExperiment = await postJson<{ experiment_id: string }>(
      baseUrl,
      "/v1/experiments",
      {
        room_id,
        title: "Active Experiment",
        hypothesis: "active",
        success_criteria: {},
        stop_conditions: {},
        budget_cap_units: 10,
        risk_tier: "low",
      },
      workspaceHeader,
    );

    const pendingApproval = await postJson<{ approval_id: string }>(
      baseUrl,
      "/v1/approvals",
      { action: "external.write", title: "Pending approval", room_id },
      workspaceHeader,
    );

    const executeRun = await postJson<{ run_id: string }>(
      baseUrl,
      "/v1/runs",
      { room_id, title: "Execute Run", experiment_id: activeExperiment.experiment_id },
      workspaceHeader,
    );
    await postJson<{ ok: true }>(baseUrl, `/v1/runs/${executeRun.run_id}/start`, {}, workspaceHeader);

    const reviewRun = await postJson<{ run_id: string }>(
      baseUrl,
      "/v1/runs",
      { room_id, title: "Review Run", experiment_id: activeExperiment.experiment_id },
      workspaceHeader,
    );
    await postJson<{ ok: true }>(baseUrl, `/v1/runs/${reviewRun.run_id}/start`, {}, workspaceHeader);
    await postJson<{ ok: true }>(
      baseUrl,
      `/v1/runs/${reviewRun.run_id}/complete`,
      { summary: "done", output: { ok: true } },
      workspaceHeader,
    );
    const reviewEvidenceId = await lookupEvidenceId(pool, workspace_id, reviewRun.run_id);

    const promoteRun = await postJson<{ run_id: string }>(
      baseUrl,
      "/v1/runs",
      { room_id, title: "Promote Run", experiment_id: activeExperiment.experiment_id },
      workspaceHeader,
    );
    await postJson<{ ok: true }>(baseUrl, `/v1/runs/${promoteRun.run_id}/start`, {}, workspaceHeader);
    await postJson<{ ok: true }>(
      baseUrl,
      `/v1/runs/${promoteRun.run_id}/complete`,
      { summary: "done", output: { ok: true } },
      workspaceHeader,
    );
    const promoteEvidenceId = await lookupEvidenceId(pool, workspace_id, promoteRun.run_id);
    await postJson<{ scorecard_id: string }>(
      baseUrl,
      "/v1/scorecards",
      {
        run_id: promoteRun.run_id,
        evidence_id: promoteEvidenceId,
        template_key: "default",
        template_version: "1",
        metrics: [{ key: "quality", value: 1, weight: 1 }],
      },
      workspaceHeader,
    );

    const failRun = await postJson<{ run_id: string }>(
      baseUrl,
      "/v1/runs",
      { room_id, title: "Fail Run", experiment_id: activeExperiment.experiment_id },
      workspaceHeader,
    );
    await postJson<{ ok: true }>(baseUrl, `/v1/runs/${failRun.run_id}/start`, {}, workspaceHeader);
    await postJson<{ ok: true }>(
      baseUrl,
      `/v1/runs/${failRun.run_id}/fail`,
      { message: "failed", error: { code: "test_failure" } },
      workspaceHeader,
    );

    const ghostRun = await postJson<{ run_id: string }>(
      baseUrl,
      "/v1/runs",
      { room_id, title: "Ghost Run", experiment_id: activeExperiment.experiment_id },
      workspaceHeader,
    );
    await postJson<{ ok: true }>(baseUrl, `/v1/runs/${ghostRun.run_id}/start`, {}, workspaceHeader);
    await postJson<{ ok: true }>(
      baseUrl,
      `/v1/runs/${ghostRun.run_id}/complete`,
      { summary: "done", output: { ok: true } },
      workspaceHeader,
    );
    const ghostEvidenceId = await lookupEvidenceId(pool, workspace_id, ghostRun.run_id);
    const ghostScorecard = await postJson<{ scorecard_id: string }>(
      baseUrl,
      "/v1/scorecards",
      {
        run_id: ghostRun.run_id,
        evidence_id: ghostEvidenceId,
        template_key: "default",
        template_version: "1",
        metrics: [{ key: "quality", value: 1, weight: 1 }],
      },
      workspaceHeader,
    );
    await pool.query(
      `UPDATE proj_scorecards
       SET evidence_id = $3,
           updated_at = now()
       WHERE workspace_id = $1
         AND scorecard_id = $2`,
      [workspace_id, ghostScorecard.scorecard_id, reviewEvidenceId],
    );

    const flat = await getJson<FlatProjectionResponse>(
      baseUrl,
      "/v1/pipeline/projection?limit=200",
      workspaceHeader,
    );
    assert.equal(flat.schema_version, SCHEMA_VERSION);
    assert.ok(!Number.isNaN(Date.parse(flat.generated_at)));
    assertStageKeys(flat);

    assert.equal(findStageFor(flat, draftExperiment.experiment_id), "1_inbox");
    assert.equal(findStageFor(flat, pendingApproval.approval_id), "2_pending_approval");
    assert.equal(findStageFor(flat, executeRun.run_id), "3_execute_workspace");
    assert.equal(findStageFor(flat, reviewRun.run_id), "4_review_evidence");
    assert.equal(findStageFor(flat, promoteRun.run_id), "5_promoted");
    assert.equal(findStageFor(flat, failRun.run_id), "6_demoted");

    const ghostStage = findStageFor(flat, ghostRun.run_id);
    assert.equal(ghostStage, "4_review_evidence");
    const ghostItem = findItem(flat, ghostRun.run_id);
    assert.ok(ghostItem);
    assert.ok(Array.isArray(ghostItem?.diagnostics));
    assert.ok(ghostItem?.diagnostics?.includes("ghost_evidence_or_mismatch"));

    const opened = await postJson<{ incident_id: string }>(
      baseUrl,
      "/v1/incidents",
      {
        title: "Promote run incident",
        summary: "gate demotion",
        run_id: promoteRun.run_id,
      },
      workspaceHeader,
    );
    const withOpenIncident = await getJson<FlatProjectionResponse>(
      baseUrl,
      "/v1/pipeline/projection?limit=200",
      workspaceHeader,
    );
    assert.equal(findStageFor(withOpenIncident, promoteRun.run_id), "6_demoted");

    await postJson<{ ok: true }>(
      baseUrl,
      `/v1/incidents/${opened.incident_id}/rca`,
      { summary: "rca summary" },
      workspaceHeader,
    );
    await postJson<{ ok: true }>(
      baseUrl,
      `/v1/incidents/${opened.incident_id}/learning`,
      { note: "close gate", tags: ["test"] },
      workspaceHeader,
    );
    await postJson<{ ok: true }>(
      baseUrl,
      `/v1/incidents/${opened.incident_id}/close`,
      { reason: "resolved" },
      workspaceHeader,
    );
    const afterClose = await getJson<FlatProjectionResponse>(
      baseUrl,
      "/v1/pipeline/projection?limit=200",
      workspaceHeader,
    );
    assert.equal(findStageFor(afterClose, promoteRun.run_id), "5_promoted");

    const archivedExperiment = await postJson<{ experiment_id: string }>(
      baseUrl,
      "/v1/experiments",
      {
        room_id,
        title: "Archived Experiment",
        hypothesis: "archived",
        success_criteria: {},
        stop_conditions: {},
        budget_cap_units: 1,
        risk_tier: "low",
      },
      workspaceHeader,
    );
    const archivedRun = await postJson<{ run_id: string }>(
      baseUrl,
      "/v1/runs",
      { room_id, title: "Archived Run", experiment_id: archivedExperiment.experiment_id },
      workspaceHeader,
    );
    await postJson<{ ok: true }>(baseUrl, `/v1/runs/${archivedRun.run_id}/start`, {}, workspaceHeader);
    await postJson<{ ok: true }>(
      baseUrl,
      `/v1/runs/${archivedRun.run_id}/complete`,
      { summary: "archive-ready", output: { ok: true } },
      workspaceHeader,
    );
    await postJson<{ ok: true }>(
      baseUrl,
      `/v1/experiments/${archivedExperiment.experiment_id}/close`,
      { status: "closed" },
      workspaceHeader,
    );
    await pool.query(
      `UPDATE proj_runs
       SET status = 'running',
           updated_at = now() + interval '1 minute'
       WHERE workspace_id = $1
         AND run_id = $2`,
      [workspace_id, archivedRun.run_id],
    );
    const noZombie = await getJson<FlatProjectionResponse>(
      baseUrl,
      "/v1/pipeline/projection?limit=200",
      workspaceHeader,
    );
    assert.equal(findStageFor(noZombie, archivedExperiment.experiment_id), null);
    assert.equal(findStageFor(noZombie, archivedRun.run_id), null);

    await pool.query(
      `INSERT INTO proj_scorecards (
        scorecard_id, workspace_id, experiment_id, run_id, evidence_id, agent_id, principal_id,
        template_key, template_version, metrics, metrics_hash, score, decision, rationale, metadata,
        created_by_type, created_by_id, created_at, updated_at, correlation_id, last_event_id
      ) VALUES (
        $1,$2,NULL,NULL,NULL,NULL,NULL,$3,$4,'[]'::jsonb,$5,$6,$7,NULL,'{}'::jsonb,
        'service','contract_test',now(),now(),'',$8
      )`,
      [
        `sc_partial_${Date.now()}`,
        workspace_id,
        "partial",
        "1",
        "sha256:partial",
        0.5,
        "warn",
        `evt_partial_${Date.now()}`,
      ],
    );
    const partialScorecardId = (
      await pool.query<{ scorecard_id: string }>(
        `SELECT scorecard_id
         FROM proj_scorecards
         WHERE workspace_id = $1
           AND template_key = 'partial'
         ORDER BY created_at DESC
         LIMIT 1`,
        [workspace_id],
      )
    ).rows[0]?.scorecard_id;
    assert.ok(partialScorecardId);
    const partialSafe = await getJson<FlatProjectionResponse>(
      baseUrl,
      "/v1/pipeline/projection?limit=200",
      workspaceHeader,
    );
    const partialItem = findItem(partialSafe, partialScorecardId as string);
    assert.ok(partialItem);
    assert.equal(findStageFor(partialSafe, partialScorecardId as string), "1_inbox");
    assert.ok(partialItem?.diagnostics?.includes("missing_data"));

    const tieApprovals: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const approval = await postJson<{ approval_id: string }>(
        baseUrl,
        "/v1/approvals",
        { action: "external.write", title: `Tie Approval ${i}`, room_id },
        workspaceHeader,
      );
      tieApprovals.push(approval.approval_id);
    }
    await pool.query(
      `UPDATE proj_approvals
       SET updated_at = '2026-01-01T00:00:00.000Z'::timestamptz
       WHERE workspace_id = $1
         AND approval_id = ANY($2::text[])`,
      [workspace_id, tieApprovals],
    );

    const page1 = await getJson<EnvelopeProjectionResponse>(
      baseUrl,
      "/v1/pipeline/projection?format=envelope&limit=2",
      workspaceHeader,
    );
    assert.equal(page1.meta.schema_version, SCHEMA_VERSION);
    assert.equal(page1.meta.workspace_id, workspace_id);
    assert.equal(page1.meta.limit, 2);
    assert.equal(page1.meta.truncated, true);
    assert.ok(page1.meta.next_cursor);
    assert.equal(typeof page1.meta.next_cursor?.updated_at, "string");
    assert.equal(typeof page1.meta.next_cursor?.entity_type, "string");
    assert.equal(typeof page1.meta.next_cursor?.entity_id, "string");

    const page1Ids = new Set(
      [
        ...page1.stages["1_inbox"],
        ...page1.stages["2_pending_approval"],
        ...page1.stages["3_execute_workspace"],
        ...page1.stages["4_review_evidence"],
        ...page1.stages["5_promoted"],
        ...page1.stages["6_demoted"],
      ].map((item) => `${item.entity_type}:${item.entity_id}`),
    );

    const cursor = page1.meta.next_cursor as ProjectionCursor;
    const page2 = await getJson<EnvelopeProjectionResponse>(
      baseUrl,
      `/v1/pipeline/projection?format=envelope&limit=2&cursor_updated_at=${encodeURIComponent(cursor.updated_at)}&cursor_entity_type=${encodeURIComponent(cursor.entity_type)}&cursor_entity_id=${encodeURIComponent(cursor.entity_id)}`,
      workspaceHeader,
    );
    const page2Ids = new Set(
      [
        ...page2.stages["1_inbox"],
        ...page2.stages["2_pending_approval"],
        ...page2.stages["3_execute_workspace"],
        ...page2.stages["4_review_evidence"],
        ...page2.stages["5_promoted"],
        ...page2.stages["6_demoted"],
      ].map((item) => `${item.entity_type}:${item.entity_id}`),
    );
    for (const id of page2Ids) {
      assert.equal(page1Ids.has(id), false);
    }

    const missingCursorRes = await fetch(
      `${baseUrl}/v1/pipeline/projection?format=envelope&limit=2&cursor_updated_at=${encodeURIComponent(cursor.updated_at)}`,
      { headers: workspaceHeader },
    );
    assert.equal(missingCursorRes.status, 400);
    const missingCursorBody = (await missingCursorRes.json()) as { reason_code: string };
    assert.equal(missingCursorBody.reason_code, "missing_required_field");

    const missingWorkspaceRes = await fetch(`${baseUrl}/v1/pipeline/projection?limit=10`);
    assert.equal(missingWorkspaceRes.status, 401);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
