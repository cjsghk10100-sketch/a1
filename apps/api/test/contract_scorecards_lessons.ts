import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

import { buildServer } from "../src/server.js";
import { createPool } from "../src/db/pool.js";

const { Client } = pg;

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
      const sql = await readFile(path.join(migrationsDir, file), "utf8");
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

async function requestJson<T>(
  baseUrl: string,
  method: "GET" | "POST",
  urlPath: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; json: T }> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(headers ?? {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = (text.length ? JSON.parse(text) : {}) as T;
  return { status: res.status, json };
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
  if (!address || typeof address === "string") throw new Error("expected TCP address");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();

  try {
    const headers = { "x-workspace-id": "ws_contract" };

    const room = await requestJson<{ room_id: string }>(
      baseUrl,
      "POST",
      "/v1/rooms",
      { title: "Score room", room_mode: "default", default_lang: "en" },
      headers,
    );
    assert.equal(room.status, 201);
    const room_id = room.json.room_id;

    const run = await requestJson<{ run_id: string }>(
      baseUrl,
      "POST",
      "/v1/runs",
      { room_id, title: "score run" },
      headers,
    );
    assert.equal(run.status, 201);
    const run_id = run.json.run_id;

    await requestJson(baseUrl, "POST", `/v1/runs/${encodeURIComponent(run_id)}/start`, {}, headers);
    await requestJson(
      baseUrl,
      "POST",
      `/v1/runs/${encodeURIComponent(run_id)}/complete`,
      { summary: "done", output: { ok: true } },
      headers,
    );

    const evidence = await requestJson<{
      evidence: { evidence_id: string };
    }>(baseUrl, "GET", `/v1/runs/${encodeURIComponent(run_id)}/evidence`, undefined, headers);
    assert.equal(evidence.status, 200);
    const evidence_id = evidence.json.evidence.evidence_id;

    const otherRun = await requestJson<{ run_id: string }>(
      baseUrl,
      "POST",
      "/v1/runs",
      { room_id, title: "score run other" },
      headers,
    );
    assert.equal(otherRun.status, 201);
    const other_run_id = otherRun.json.run_id;
    await requestJson(baseUrl, "POST", `/v1/runs/${encodeURIComponent(other_run_id)}/start`, {}, headers);
    await requestJson(
      baseUrl,
      "POST",
      `/v1/runs/${encodeURIComponent(other_run_id)}/complete`,
      { summary: "done", output: { ok: true } },
      headers,
    );
    const otherEvidence = await requestJson<{
      evidence: { evidence_id: string };
    }>(baseUrl, "GET", `/v1/runs/${encodeURIComponent(other_run_id)}/evidence`, undefined, headers);
    assert.equal(otherEvidence.status, 200);
    const other_evidence_id = otherEvidence.json.evidence.evidence_id;

    const agent = await requestJson<{ agent_id: string }>(
      baseUrl,
      "POST",
      "/v1/agents",
      { display_name: "Score agent", actor_type: "service", actor_id: "score-agent" },
      headers,
    );
    assert.equal(agent.status, 201);
    const agent_id = agent.json.agent_id;

    const scoreA = await requestJson<{ scorecard_id: string }>(
      baseUrl,
      "POST",
      "/v1/scorecards",
      {
        run_id,
        evidence_id,
        agent_id,
        template_key: "run_quality",
        template_version: "1.0.0",
        metrics: [
          { key: "quality", value: 0.9, weight: 2 },
          { key: "latency", value: 0.6, weight: 1 },
        ],
      },
      headers,
    );
    assert.equal(scoreA.status, 201);

    const scoreB = await requestJson<{ scorecard_id: string }>(
      baseUrl,
      "POST",
      "/v1/scorecards",
      {
        run_id,
        evidence_id,
        agent_id,
        template_key: "run_quality",
        template_version: "1.0.0",
        metrics: [
          { key: "latency", value: 0.6, weight: 1 },
          { key: "quality", value: 0.9, weight: 2 },
        ],
      },
      headers,
    );
    assert.equal(scoreB.status, 201);

    const mismatchedEvidence = await requestJson<{ error: string }>(
      baseUrl,
      "POST",
      "/v1/scorecards",
      {
        run_id,
        evidence_id: other_evidence_id,
        agent_id,
        template_key: "run_quality",
        template_version: "1.0.0",
        metrics: [{ key: "quality", value: 0.9 }],
      },
      headers,
    );
    assert.equal(mismatchedEvidence.status, 400);
    assert.equal(mismatchedEvidence.json.error, "evidence_run_mismatch");

    const scoreARead = await requestJson<{
      scorecard: { metrics_hash: string; decision: string; score: number };
    }>(
      baseUrl,
      "GET",
      `/v1/scorecards/${encodeURIComponent(scoreA.json.scorecard_id)}`,
      undefined,
      headers,
    );
    const scoreBRead = await requestJson<{
      scorecard: { metrics_hash: string; decision: string; score: number };
    }>(
      baseUrl,
      "GET",
      `/v1/scorecards/${encodeURIComponent(scoreB.json.scorecard_id)}`,
      undefined,
      headers,
    );
    assert.equal(scoreARead.status, 200);
    assert.equal(scoreBRead.status, 200);
    assert.equal(scoreARead.json.scorecard.metrics_hash, scoreBRead.json.scorecard.metrics_hash);
    assert.equal(scoreARead.json.scorecard.decision, "pass");
    assert.ok(scoreARead.json.scorecard.score >= 0.75);

    const missingContext = await requestJson<{ error: string }>(
      baseUrl,
      "POST",
      "/v1/lessons",
      { category: "ops", summary: "missing links" },
      headers,
    );
    assert.equal(missingContext.status, 400);
    assert.equal(missingContext.json.error, "lesson_context_required");

    const lesson = await requestJson<{ lesson_id: string }>(
      baseUrl,
      "POST",
      "/v1/lessons",
      {
        run_id,
        scorecard_id: scoreA.json.scorecard_id,
        category: "quality",
        summary: "Keep weighted scoring",
        action_items: ["retain template v1"],
        tags: ["evaluation"],
      },
      headers,
    );
    assert.equal(lesson.status, 201);
    assert.ok(lesson.json.lesson_id.startsWith("les_"));

    const listLessons = await requestJson<{
      lessons: Array<{ lesson_id: string; run_id: string | null; scorecard_id: string | null }>;
    }>(
      baseUrl,
      "GET",
      `/v1/lessons?run_id=${encodeURIComponent(run_id)}`,
      undefined,
      headers,
    );
    assert.equal(listLessons.status, 200);
    assert.ok(listLessons.json.lessons.some((row) => row.lesson_id === lesson.json.lesson_id));

    const requiresEvidenceFail = await requestJson<{ error: string }>(
      baseUrl,
      "POST",
      "/v1/scorecards",
      {
        run_id,
        template_key: "strict_template",
        template_version: "1.0.0",
        requires_evidence: true,
        metrics: [{ key: "quality", value: 0.9 }],
      },
      headers,
    );
    assert.equal(requiresEvidenceFail.status, 400);
    assert.equal(requiresEvidenceFail.json.error, "missing_evidence_for_template");

    const requiresEvidenceOk = await requestJson<{ scorecard_id: string }>(
      baseUrl,
      "POST",
      "/v1/scorecards",
      {
        run_id,
        evidence_id,
        template_key: "strict_template",
        template_version: "1.0.0",
        requires_evidence: true,
        metrics: [{ key: "quality", value: 0.7 }],
      },
      headers,
    );
    assert.equal(requiresEvidenceOk.status, 201);

    const scoreCount = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM evt_events
       WHERE event_type = 'scorecard.recorded'
         AND workspace_id = $1`,
      ["ws_contract"],
    );
    assert.ok(Number(scoreCount.rows[0]?.count ?? "0") >= 3);

    const lessonCount = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM evt_events
       WHERE event_type = 'lesson.logged'
         AND workspace_id = $1`,
      ["ws_contract"],
    );
    assert.ok(Number(lessonCount.rows[0]?.count ?? "0") >= 1);
  } finally {
    await db.end();
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
