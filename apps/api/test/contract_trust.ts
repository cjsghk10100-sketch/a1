import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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

    const requestAgentEgress = async (input: {
      agent_id: string;
      principal_id: string;
      target_url?: string;
    }): Promise<{ status: number; decision: string; reason_code: string }> => {
      const res = await requestJson(
        baseUrl,
        "POST",
        "/v1/egress/requests",
        {
          action: "external.write",
          target_url: input.target_url ?? "https://api.example.com/sync",
          method: "POST",
          actor_type: "agent",
          actor_id: input.agent_id,
          principal_id: input.principal_id,
          zone: "supervised",
        },
        workspaceHeader,
      );
      const body = res.json as { decision: string; reason_code: string };
      return {
        status: res.status,
        decision: body.decision,
        reason_code: body.reason_code,
      };
    };

    const registered = await requestJson(
      baseUrl,
      "POST",
      "/v1/agents",
      { display_name: "Trust Agent" },
      workspaceHeader,
    );
    assert.equal(registered.status, 201);
    const agent = registered.json as { agent_id: string; principal_id: string };
    assert.ok(agent.agent_id.startsWith("agt_"));
    assert.ok(agent.principal_id.length > 0);

    const initialTrust = await requestJson(
      baseUrl,
      "GET",
      `/v1/agents/${encodeURIComponent(agent.agent_id)}/trust`,
      undefined,
      workspaceHeader,
    );
    assert.equal(initialTrust.status, 200);
    const trustRead = initialTrust.json as {
      trust: { trust_score: number; agent_id: string; workspace_id: string };
    };
    assert.equal(trustRead.trust.agent_id, agent.agent_id);
    assert.equal(trustRead.trust.workspace_id, "ws_contract");
    assert.ok(trustRead.trust.trust_score >= 0 && trustRead.trust.trust_score <= 1);

    const granterPrincipalId = randomUUID();
    await db.query("INSERT INTO sec_principals (principal_id, principal_type) VALUES ($1, 'user')", [
      granterPrincipalId,
    ]);

    const lowRiskTokenId = randomUUID();
    await db.query(
      `INSERT INTO sec_capability_tokens (
         token_id,
         workspace_id,
         issued_to_principal_id,
         granted_by_principal_id,
         parent_token_id,
         scopes,
         valid_until,
         created_at
       ) VALUES (
         $1,$2,$3,$4,NULL,$5::jsonb,$6,$7
       )`,
      [
        lowRiskTokenId,
        "ws_contract",
        agent.principal_id,
        granterPrincipalId,
        JSON.stringify({
          action_types: ["artifact.create"],
          data_access: { write: ["artifacts"] },
        }),
        new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        new Date().toISOString(),
      ],
    );

    const baselineRecommendation = await requestJson(
      baseUrl,
      "GET",
      `/v1/agents/${encodeURIComponent(agent.agent_id)}/approval-recommendation`,
      undefined,
      workspaceHeader,
    );
    assert.equal(baselineRecommendation.status, 200);
    const baselineRecommendationBody = baselineRecommendation.json as {
      recommendation: {
        targets: Array<{
          target: string;
          mode: string;
          basis_codes: string[];
        }>;
        context: {
          assessment_failed_7d: number;
          assessment_completed_30d: number;
          assessment_passed_30d: number;
          assessment_pass_rate_30d: number | null;
          is_quarantined: boolean;
          action_policy_flags: {
            highCost: number;
            hardRecovery: number;
          };
        };
      };
    };
    const baselineTargetMap = new Map(
      baselineRecommendationBody.recommendation.targets.map((target) => [target.target, target]),
    );
    assert.equal(baselineTargetMap.get("internal_write")?.mode, "post");
    assert.ok(baselineTargetMap.get("internal_write")?.basis_codes.includes("post_required"));
    assert.equal(baselineRecommendationBody.recommendation.context.is_quarantined, false);
    assert.equal(baselineRecommendationBody.recommendation.context.assessment_failed_7d, 0);
    assert.equal(baselineRecommendationBody.recommendation.context.assessment_completed_30d, 0);
    assert.equal(baselineRecommendationBody.recommendation.context.assessment_passed_30d, 0);
    assert.equal(baselineRecommendationBody.recommendation.context.assessment_pass_rate_30d, null);

    const assessedFailedA = await requestJson(
      baseUrl,
      "POST",
      `/v1/agents/${encodeURIComponent(agent.agent_id)}/skills/analysis.skill/assess`,
      {
        status: "failed",
        score: 0.2,
        suite: { cases: [{ id: "trust-case-1" }] },
        results: { pass: false },
      },
      workspaceHeader,
    );
    assert.equal(assessedFailedA.status, 201);

    const assessedFailedB = await requestJson(
      baseUrl,
      "POST",
      `/v1/agents/${encodeURIComponent(agent.agent_id)}/skills/review.skill/assess`,
      {
        status: "failed",
        score: 0.1,
        suite: { cases: [{ id: "trust-case-2" }] },
        results: { pass: false },
      },
      workspaceHeader,
    );
    assert.equal(assessedFailedB.status, 201);

    const regressionRecommendation = await requestJson(
      baseUrl,
      "GET",
      `/v1/agents/${encodeURIComponent(agent.agent_id)}/approval-recommendation`,
      undefined,
      workspaceHeader,
    );
    assert.equal(regressionRecommendation.status, 200);
    const regressionRecommendationBody = regressionRecommendation.json as {
      recommendation: {
        targets: Array<{
          target: string;
          mode: string;
          basis_codes: string[];
        }>;
        context: {
          assessment_failed_7d: number;
          assessment_completed_30d: number;
          assessment_passed_30d: number;
          assessment_pass_rate_30d: number | null;
        };
      };
    };
    const regressionTargetMap = new Map(
      regressionRecommendationBody.recommendation.targets.map((target) => [target.target, target]),
    );
    assert.equal(regressionTargetMap.get("internal_write")?.mode, "pre");
    assert.ok(regressionTargetMap.get("internal_write")?.basis_codes.includes("assessment_regression"));
    assert.ok(regressionRecommendationBody.recommendation.context.assessment_failed_7d >= 2);
    assert.ok(regressionRecommendationBody.recommendation.context.assessment_completed_30d >= 2);
    assert.equal(regressionRecommendationBody.recommendation.context.assessment_passed_30d, 0);
    assert.equal(regressionRecommendationBody.recommendation.context.assessment_pass_rate_30d, 0);

    const capabilityTokenId = randomUUID();
    await db.query(
      `INSERT INTO sec_capability_tokens (
         token_id,
         workspace_id,
         issued_to_principal_id,
         granted_by_principal_id,
         parent_token_id,
         scopes,
         valid_until,
         created_at
       ) VALUES (
         $1,$2,$3,$4,NULL,$5::jsonb,$6,$7
       )`,
      [
        capabilityTokenId,
        "ws_contract",
        agent.principal_id,
        granterPrincipalId,
        JSON.stringify({
          action_types: ["external.write"],
          egress_domains: ["api.example.com"],
          data_access: { write: ["artifacts"] },
        }),
        new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        new Date().toISOString(),
      ],
    );

    const approvalRecommendation = await requestJson(
      baseUrl,
      "GET",
      `/v1/agents/${encodeURIComponent(agent.agent_id)}/approval-recommendation`,
      undefined,
      workspaceHeader,
    );
    assert.equal(approvalRecommendation.status, 200);
    const approvalRecommendationBody = approvalRecommendation.json as {
      recommendation: {
        targets: Array<{
          target: string;
          mode: string;
          basis_codes: string[];
        }>;
        context: {
          is_quarantined: boolean;
          action_policy_flags: {
            highCost: number;
            hardRecovery: number;
          };
        };
      };
    };
    const targetMap = new Map(
      approvalRecommendationBody.recommendation.targets.map((target) => [target.target, target]),
    );
    assert.equal(targetMap.get("internal_write")?.mode, "pre");
    assert.equal(targetMap.get("external_write")?.mode, "pre");
    assert.equal(targetMap.get("high_stakes")?.mode, "pre");
    assert.ok(targetMap.get("external_write")?.basis_codes.includes("high_cost"));
    assert.ok(targetMap.get("external_write")?.basis_codes.includes("hard_recovery"));
    assert.equal(approvalRecommendationBody.recommendation.context.is_quarantined, false);
    assert.ok(approvalRecommendationBody.recommendation.context.action_policy_flags.highCost >= 1);
    assert.ok(approvalRecommendationBody.recommendation.context.action_policy_flags.hardRecovery >= 1);

    const recommend = await requestJson(
      baseUrl,
      "POST",
      `/v1/agents/${encodeURIComponent(agent.agent_id)}/autonomy/recommend`,
      {
        scope_delta: {
          tools: ["web_search"],
          action_types: ["artifact.create"],
          data_access: { write: ["artifacts"] },
        },
        rationale: "High quality execution trend",
        signals: {
          success_rate_7d: 0.95,
          eval_quality_trend: 0.8,
          user_feedback_score: 0.9,
          policy_violations_7d: 0,
          time_in_service_days: 45,
        },
      },
      workspaceHeader,
    );
    assert.equal(recommend.status, 201);
    const recommended = recommend.json as {
      recommendation: {
        recommendation_id: string;
        status: string;
        scope_delta: { tools?: string[] };
      };
      trust: { trust_score: number };
    };
    assert.ok(recommended.recommendation.recommendation_id.startsWith("arec_"));
    assert.equal(recommended.recommendation.status, "pending");
    assert.ok(recommended.recommendation.scope_delta.tools?.includes("web_search"));
    assert.ok(recommended.trust.trust_score > trustRead.trust.trust_score);

    const recRow = await db.query<{
      status: string;
      trust_score_before: number;
      trust_score_after: number;
      scope_delta: { tools?: string[] };
    }>(
      `SELECT status, trust_score_before, trust_score_after, scope_delta
       FROM sec_autonomy_recommendations
       WHERE recommendation_id = $1`,
      [recommended.recommendation.recommendation_id],
    );
    assert.equal(recRow.rowCount, 1);
    assert.equal(recRow.rows[0].status, "pending");
    assert.ok(recRow.rows[0].trust_score_after > recRow.rows[0].trust_score_before);
    assert.ok(recRow.rows[0].scope_delta.tools?.includes("web_search"));

    const recommendEvent = await db.query<{ event_type: string }>(
      `SELECT event_type
       FROM evt_events
       WHERE event_type = 'autonomy.upgrade.recommended'
         AND data->>'recommendation_id' = $1`,
      [recommended.recommendation.recommendation_id],
    );
    assert.equal(recommendEvent.rowCount, 1);

    const approve = await requestJson(
      baseUrl,
      "POST",
      `/v1/agents/${encodeURIComponent(agent.agent_id)}/autonomy/approve`,
      {
        recommendation_id: recommended.recommendation.recommendation_id,
        granted_by_principal_id: granterPrincipalId,
      },
      workspaceHeader,
    );
    assert.equal(approve.status, 200);
    const approved = approve.json as { recommendation_id: string; token_id: string };
    assert.equal(approved.recommendation_id, recommended.recommendation.recommendation_id);
    assert.ok(approved.token_id.length > 0);

    const tokenRow = await db.query<{
      issued_to_principal_id: string;
      granted_by_principal_id: string;
      scopes: { tools?: string[] };
    }>(
      `SELECT issued_to_principal_id, granted_by_principal_id, scopes
       FROM sec_capability_tokens
       WHERE token_id = $1`,
      [approved.token_id],
    );
    assert.equal(tokenRow.rowCount, 1);
    assert.equal(tokenRow.rows[0].issued_to_principal_id, agent.principal_id);
    assert.equal(tokenRow.rows[0].granted_by_principal_id, granterPrincipalId);
    assert.ok(tokenRow.rows[0].scopes.tools?.includes("web_search"));

    const approvedRec = await db.query<{
      status: string;
      approved_token_id: string | null;
      approved_by_principal_id: string | null;
    }>(
      `SELECT status, approved_token_id, approved_by_principal_id
       FROM sec_autonomy_recommendations
       WHERE recommendation_id = $1`,
      [recommended.recommendation.recommendation_id],
    );
    assert.equal(approvedRec.rowCount, 1);
    assert.equal(approvedRec.rows[0].status, "approved");
    assert.equal(approvedRec.rows[0].approved_token_id, approved.token_id);
    assert.equal(approvedRec.rows[0].approved_by_principal_id, granterPrincipalId);

    const approvedEvent = await db.query<{ event_type: string }>(
      `SELECT event_type
       FROM evt_events
       WHERE event_type = 'autonomy.upgrade.approved'
         AND data->>'recommendation_id' = $1`,
      [recommended.recommendation.recommendation_id],
    );
    assert.equal(approvedEvent.rowCount, 1);

    const idempotentApprove = await requestJson(
      baseUrl,
      "POST",
      `/v1/agents/${encodeURIComponent(agent.agent_id)}/autonomy/approve`,
      {
        recommendation_id: recommended.recommendation.recommendation_id,
        granted_by_principal_id: granterPrincipalId,
      },
      workspaceHeader,
    );
    assert.equal(idempotentApprove.status, 200);
    const idempotentBody = idempotentApprove.json as {
      recommendation_id: string;
      token_id: string;
      already_approved?: boolean;
    };
    assert.equal(idempotentBody.recommendation_id, recommended.recommendation.recommendation_id);
    assert.equal(idempotentBody.token_id, approved.token_id);
    assert.equal(idempotentBody.already_approved, true);

    const prevMode = process.env.POLICY_ENFORCEMENT_MODE;
    try {
      process.env.POLICY_ENFORCEMENT_MODE = "shadow";
      for (let i = 0; i < 3; i += 1) {
        const shadowEgress = await requestAgentEgress({
          agent_id: agent.agent_id,
          principal_id: agent.principal_id,
        });
        assert.equal(shadowEgress.status, 201);
        assert.equal(shadowEgress.decision, "require_approval");
        assert.equal(shadowEgress.reason_code, "external_write_requires_approval");
      }

      const shadowRecalc = await requestJson(
        baseUrl,
        "POST",
        `/v1/agents/${encodeURIComponent(agent.agent_id)}/trust/recalculate`,
        {
          actor_type: "service",
          actor_id: "contract_recalc",
        },
        workspaceHeader,
      );
      assert.equal(shadowRecalc.status, 200);
      const shadowBody = shadowRecalc.json as {
        trust: { policy_violations_7d: number };
      };
      assert.equal(shadowBody.trust.policy_violations_7d, 0);

      process.env.POLICY_ENFORCEMENT_MODE = "enforce";
      for (let i = 0; i < 3; i += 1) {
        const enforcedEgress = await requestAgentEgress({
          agent_id: agent.agent_id,
          principal_id: agent.principal_id,
        });
        assert.equal(enforcedEgress.status, 201);
        assert.equal(enforcedEgress.decision, "require_approval");
        assert.equal(enforcedEgress.reason_code, "external_write_requires_approval");
      }

      const enforcedRecalc = await requestJson(
        baseUrl,
        "POST",
        `/v1/agents/${encodeURIComponent(agent.agent_id)}/trust/recalculate`,
        {
          actor_type: "service",
          actor_id: "contract_recalc",
        },
        workspaceHeader,
      );
      assert.equal(enforcedRecalc.status, 200);
      const enforcedBody = enforcedRecalc.json as {
        trust: { policy_violations_7d: number };
      };
      assert.equal(enforcedBody.trust.policy_violations_7d, 1);

      const quarantine = await requestJson(
        baseUrl,
        "POST",
        `/v1/agents/${encodeURIComponent(agent.agent_id)}/quarantine`,
        {
          quarantine_reason: "contract_test_quarantine",
          actor_type: "service",
          actor_id: "qa",
        },
        workspaceHeader,
      );
      assert.equal(quarantine.status, 200);

      for (let i = 0; i < 2; i += 1) {
        const quarantinedEgress = await requestAgentEgress({
          agent_id: agent.agent_id,
          principal_id: agent.principal_id,
        });
        assert.equal(quarantinedEgress.status, 201);
        assert.equal(quarantinedEgress.decision, "deny");
        assert.equal(quarantinedEgress.reason_code, "agent_quarantined");
      }

      const quarantinedRecalc = await requestJson(
        baseUrl,
        "POST",
        `/v1/agents/${encodeURIComponent(agent.agent_id)}/trust/recalculate`,
        {
          actor_type: "service",
          actor_id: "contract_recalc",
        },
        workspaceHeader,
      );
      assert.equal(quarantinedRecalc.status, 200);
      const quarantinedBody = quarantinedRecalc.json as {
        trust: { policy_violations_7d: number };
      };
      assert.equal(quarantinedBody.trust.policy_violations_7d, 1);
    } finally {
      if (prevMode == null) {
        delete process.env.POLICY_ENFORCEMENT_MODE;
      } else {
        process.env.POLICY_ENFORCEMENT_MODE = prevMode;
      }
    }
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
