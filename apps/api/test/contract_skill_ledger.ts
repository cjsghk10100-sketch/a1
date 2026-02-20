import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

import { createPool } from "../src/db/pool.js";
import { buildServer } from "../src/server.js";

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

async function requestJson(
  baseUrl: string,
  method: "GET" | "POST",
  urlPath: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; json: unknown; text: string }> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(headers ?? {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text.length > 0 ? (JSON.parse(text) as unknown) : {};
  return { status: res.status, json, text };
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
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();

  try {
    const workspaceHeader = { "x-workspace-id": "ws_contract" };

    const registered = await requestJson(
      baseUrl,
      "POST",
      "/v1/agents",
      { display_name: "Ledger Agent" },
      workspaceHeader,
    );
    assert.equal(registered.status, 201);
    const agent = registered.json as { agent_id: string };

    const upsertSkill = await requestJson(
      baseUrl,
      "POST",
      "/v1/skills/catalog",
      {
        skill_id: "analysis.skill",
        name: "Analysis Skill",
        skill_type: "workflow",
        risk_class: "low",
        assessment_suite: {
          cases: [{ id: "case-1", prompt: "summarize quickly", expected: "short answer" }],
        },
      },
      workspaceHeader,
    );
    assert.equal(upsertSkill.status, 201);
    const skillCatalogRow = upsertSkill.json as { skill: { skill_id: string; name: string } };
    assert.equal(skillCatalogRow.skill.skill_id, "analysis.skill");
    assert.equal(skillCatalogRow.skill.name, "Analysis Skill");

    const listedCatalog = await requestJson(baseUrl, "GET", "/v1/skills/catalog?limit=10", undefined, workspaceHeader);
    assert.equal(listedCatalog.status, 200);
    const catalog = listedCatalog.json as { skills: Array<{ skill_id: string }> };
    assert.ok(catalog.skills.some((row) => row.skill_id === "analysis.skill"));

    const learned = await requestJson(
      baseUrl,
      "POST",
      `/v1/agents/${encodeURIComponent(agent.agent_id)}/skills/learn`,
      {
        skill_id: "analysis.skill",
        level: 3,
        reliability_score: 0.6,
        impact_score: 0.4,
        set_primary: true,
      },
      workspaceHeader,
    );
    assert.equal(learned.status, 201);
    const learnedRow = learned.json as { skill: { skill_id: string; level: number; is_primary: boolean } };
    assert.equal(learnedRow.skill.skill_id, "analysis.skill");
    assert.equal(learnedRow.skill.level, 3);
    assert.equal(learnedRow.skill.is_primary, true);

    const listedAgentSkills = await requestJson(
      baseUrl,
      "GET",
      `/v1/agents/${encodeURIComponent(agent.agent_id)}/skills?limit=10`,
      undefined,
      workspaceHeader,
    );
    assert.equal(listedAgentSkills.status, 200);
    const agentSkills = listedAgentSkills.json as {
      skills: Array<{ skill_id: string; level: number; is_primary: boolean }>;
    };
    assert.ok(
      agentSkills.skills.some(
        (row) => row.skill_id === "analysis.skill" && row.level === 3 && row.is_primary === true,
      ),
    );

    const assessed = await requestJson(
      baseUrl,
      "POST",
      `/v1/agents/${encodeURIComponent(agent.agent_id)}/skills/analysis.skill/assess`,
      {
        status: "passed",
        score: 0.9,
        suite: { cases: [{ id: "case-1" }] },
        results: { pass: true },
      },
      workspaceHeader,
    );
    assert.equal(assessed.status, 201);
    const assessment = assessed.json as {
      assessment_id: string;
      status: string;
      score: number;
      reliability_score: number;
    };
    assert.ok(assessment.assessment_id.startsWith("asmt_"));
    assert.equal(assessment.status, "passed");
    assert.equal(assessment.score, 0.9);
    assert.ok(assessment.reliability_score > 0);

    const assessedFailed = await requestJson(
      baseUrl,
      "POST",
      `/v1/agents/${encodeURIComponent(agent.agent_id)}/skills/research.skill/assess`,
      {
        status: "failed",
        score: 0.2,
        suite: { cases: [{ id: "case-2" }] },
        results: { pass: false },
      },
      workspaceHeader,
    );
    assert.equal(assessedFailed.status, 201);
    const failedAssessment = assessedFailed.json as {
      assessment_id: string;
      status: string;
      score: number;
    };
    assert.ok(failedAssessment.assessment_id.startsWith("asmt_"));
    assert.equal(failedAssessment.status, "failed");
    assert.equal(failedAssessment.score, 0.2);

    const listedAssessments = await requestJson(
      baseUrl,
      "GET",
      `/v1/agents/${encodeURIComponent(agent.agent_id)}/skills/assessments?limit=20`,
      undefined,
      workspaceHeader,
    );
    assert.equal(listedAssessments.status, 200);
    const allAssessments = listedAssessments.json as {
      assessments: Array<{
        assessment_id: string;
        skill_id: string;
        status: "started" | "passed" | "failed";
      }>;
    };
    assert.ok(allAssessments.assessments.some((row) => row.assessment_id === assessment.assessment_id));
    assert.ok(allAssessments.assessments.some((row) => row.assessment_id === failedAssessment.assessment_id));

    const listedPassed = await requestJson(
      baseUrl,
      "GET",
      `/v1/agents/${encodeURIComponent(agent.agent_id)}/skills/assessments?limit=20&status=passed`,
      undefined,
      workspaceHeader,
    );
    assert.equal(listedPassed.status, 200);
    const passedAssessments = listedPassed.json as {
      assessments: Array<{ assessment_id: string; status: "started" | "passed" | "failed" }>;
    };
    assert.ok(passedAssessments.assessments.length >= 1);
    assert.ok(passedAssessments.assessments.every((row) => row.status === "passed"));
    assert.ok(passedAssessments.assessments.some((row) => row.assessment_id === assessment.assessment_id));

    const listedBySkill = await requestJson(
      baseUrl,
      "GET",
      `/v1/agents/${encodeURIComponent(agent.agent_id)}/skills/assessments?limit=20&skill_id=analysis.skill`,
      undefined,
      workspaceHeader,
    );
    assert.equal(listedBySkill.status, 200);
    const skillAssessments = listedBySkill.json as {
      assessments: Array<{ assessment_id: string; skill_id: string }>;
    };
    assert.ok(skillAssessments.assessments.length >= 1);
    assert.ok(skillAssessments.assessments.every((row) => row.skill_id === "analysis.skill"));
    assert.ok(skillAssessments.assessments.some((row) => row.assessment_id === assessment.assessment_id));

    const invalidStatus = await requestJson(
      baseUrl,
      "GET",
      `/v1/agents/${encodeURIComponent(agent.agent_id)}/skills/assessments?status=bogus`,
      undefined,
      workspaceHeader,
    );
    assert.equal(invalidStatus.status, 400);
    const invalidStatusJson = invalidStatus.json as { error?: string };
    assert.equal(invalidStatusJson.error, "invalid_status");

    const assessmentEvents = await db.query<{ event_type: string }>(
      `SELECT event_type
       FROM evt_events
       WHERE event_type IN ('skill.assessment.started', 'skill.assessment.passed')
         AND data->>'assessment_id' = $1`,
      [assessment.assessment_id],
    );
    assert.equal(assessmentEvents.rowCount, 2);

    const room = await requestJson(
      baseUrl,
      "POST",
      "/v1/rooms",
      { title: "Ledger Room", room_mode: "default", default_lang: "en" },
      workspaceHeader,
    );
    assert.equal(room.status, 201);
    const room_id = (room.json as { room_id: string }).room_id;

    const run = await requestJson(
      baseUrl,
      "POST",
      "/v1/runs",
      { room_id, title: "Skill usage run", goal: "trigger tool usage attribution" },
      workspaceHeader,
    );
    assert.equal(run.status, 201);
    const run_id = (run.json as { run_id: string }).run_id;

    const started = await requestJson(
      baseUrl,
      "POST",
      `/v1/runs/${encodeURIComponent(run_id)}/start`,
      {},
      workspaceHeader,
    );
    assert.equal(started.status, 200);

    const step = await requestJson(
      baseUrl,
      "POST",
      `/v1/runs/${encodeURIComponent(run_id)}/steps`,
      { title: "tool usage step", kind: "tool" },
      workspaceHeader,
    );
    assert.equal(step.status, 201);
    const step_id = (step.json as { step_id: string }).step_id;

    const toolInvoke = await requestJson(
      baseUrl,
      "POST",
      `/v1/steps/${encodeURIComponent(step_id)}/toolcalls`,
      {
        tool_name: "web_search",
        title: "Search",
        input: { q: "agent os skill ledger" },
        agent_id: agent.agent_id,
      },
      workspaceHeader,
    );
    assert.equal(toolInvoke.status, 201);

    const attributedSkill = await db.query<{
      skill_id: string;
      usage_total: number;
      last_used_at: string | null;
    }>(
      `SELECT skill_id, usage_total, last_used_at
       FROM sec_agent_skills
       WHERE workspace_id = $1
         AND agent_id = $2
         AND skill_id = 'web_search'`,
      ["ws_contract", agent.agent_id],
    );
    assert.equal(attributedSkill.rowCount, 1);
    assert.ok(attributedSkill.rows[0].usage_total >= 1);
    assert.ok(attributedSkill.rows[0].last_used_at !== null);

    const primaryRows = await db.query<{ skill_id: string }>(
      `SELECT skill_id
       FROM sec_agent_skills
       WHERE workspace_id = $1
         AND agent_id = $2
         AND is_primary = TRUE`,
      ["ws_contract", agent.agent_id],
    );
    assert.equal(primaryRows.rowCount, 1);
    assert.equal(primaryRows.rows[0].skill_id, "web_search");

    const usageEvent = await db.query<{ event_type: string }>(
      `SELECT event_type
       FROM evt_events
       WHERE event_type = 'agent.skill.used'
         AND data->>'agent_id' = $1
         AND data->>'skill_id' = 'web_search'
       ORDER BY recorded_at DESC
       LIMIT 1`,
      [agent.agent_id],
    );
    assert.equal(usageEvent.rowCount, 1);
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
