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
    headers: {
      ...(headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GET ${urlPath} failed: ${res.status} ${text}`);
  }
  return JSON.parse(text) as T;
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
    const runSuffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

    const registered = await postJson<{ agent_id: string; principal_id: string }>(
      baseUrl,
      "/v1/agents",
      { display_name: "Imported Agent" },
      workspaceHeader,
    );
    assert.ok(registered.agent_id.startsWith("agt_"));
    assert.ok(registered.principal_id.length > 0);

    const inventory = {
      packages: [
        {
          skill_id: `skill.good.verified.${runSuffix}`,
          version: "1.0.0",
          hash_sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          signature: "sig_v1",
          manifest: {
            required_tools: ["http_client"],
            data_access: { read: ["web"] },
            egress_domains: ["example.com"],
            sandbox_required: true,
          },
        },
        {
          skill_id: `skill.bad.missing_manifest.${runSuffix}`,
          version: "1.0.0",
          hash_sha256: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
        {
          skill_id: `skill.pending.no_signature.${runSuffix}`,
          version: "1.0.0",
          hash_sha256: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
          manifest: {
            required_tools: ["fs_reader"],
            data_access: { read: ["artifacts"] },
            egress_domains: [],
            sandbox_required: true,
          },
        },
      ],
    };

    const imported = await postJson<{
      summary: { total: number; verified: number; pending: number; quarantined: number };
      items: Array<{ skill_id: string; status: string; skill_package_id: string }>;
    }>(
      baseUrl,
      `/v1/agents/${encodeURIComponent(registered.agent_id)}/skills/import`,
      inventory,
      workspaceHeader,
    );
    assert.equal(imported.summary.total, 3);
    assert.equal(imported.summary.verified, 1);
    assert.equal(imported.summary.pending, 1);
    assert.equal(imported.summary.quarantined, 1);

    const importedAgain = await postJson<{
      summary: { total: number; verified: number; pending: number; quarantined: number };
    }>(
      baseUrl,
      `/v1/agents/${encodeURIComponent(registered.agent_id)}/skills/import`,
      inventory,
      workspaceHeader,
    );
    assert.equal(importedAgain.summary.total, 3);
    assert.equal(importedAgain.summary.verified, 1);
    assert.equal(importedAgain.summary.pending, 1);
    assert.equal(importedAgain.summary.quarantined, 1);

    const pendingImported = imported.items.find((item) => item.status === "pending");
    assert.ok(pendingImported);
    const verifiedImported = imported.items.find((item) => item.status === "verified");
    assert.ok(verifiedImported);

    const reviewed = await postJson<{
      summary: { total: number; verified: number; quarantined: number };
      items: Array<{
        skill_package_id: string;
        skill_id: string;
        status: string;
        reason?: string;
      }>;
    }>(
      baseUrl,
      `/v1/agents/${encodeURIComponent(registered.agent_id)}/skills/review-pending`,
      {},
      workspaceHeader,
    );
    assert.equal(reviewed.summary.total, 1);
    assert.equal(reviewed.summary.verified, 0);
    assert.equal(reviewed.summary.quarantined, 1);
    assert.equal(reviewed.items.length, 1);
    assert.equal(reviewed.items[0].skill_package_id, pendingImported?.skill_package_id);
    assert.equal(reviewed.items[0].status, "quarantined");
    assert.equal(reviewed.items[0].reason, "verify_signature_required");

    const assessedImported = await postJson<{
      summary: { total_candidates: number; assessed: number; skipped: number };
      items: Array<{
        skill_id: string;
        skill_package_id: string;
        status: "passed";
        assessment_id?: string;
        skipped_reason?: "already_assessed";
      }>;
    }>(
      baseUrl,
      `/v1/agents/${encodeURIComponent(registered.agent_id)}/skills/assess-imported`,
      {},
      workspaceHeader,
    );
    assert.equal(assessedImported.summary.total_candidates, 1);
    assert.equal(assessedImported.summary.assessed, 1);
    assert.equal(assessedImported.summary.skipped, 0);
    assert.equal(assessedImported.items.length, 1);
    assert.equal(assessedImported.items[0].skill_package_id, verifiedImported?.skill_package_id);
    assert.ok(assessedImported.items[0].assessment_id);

    const assessedImportedAgain = await postJson<{
      summary: { total_candidates: number; assessed: number; skipped: number };
    }>(
      baseUrl,
      `/v1/agents/${encodeURIComponent(registered.agent_id)}/skills/assess-imported`,
      {},
      workspaceHeader,
    );
    assert.equal(assessedImportedAgain.summary.total_candidates, 1);
    assert.equal(assessedImportedAgain.summary.assessed, 0);
    assert.equal(assessedImportedAgain.summary.skipped, 1);
    const onboardingStatus = await getJson<{
      summary: {
        total_linked: number;
        verified: number;
        verified_skills: number;
        pending: number;
        quarantined: number;
        verified_assessed: number;
        verified_unassessed: number;
      };
    }>(
      baseUrl,
      `/v1/agents/${encodeURIComponent(registered.agent_id)}/skills/onboarding-status`,
      workspaceHeader,
    );
    assert.equal(onboardingStatus.summary.total_linked, 3);
    assert.equal(onboardingStatus.summary.verified, 1);
    assert.equal(onboardingStatus.summary.verified_skills, 1);
    assert.equal(onboardingStatus.summary.pending, 0);
    assert.equal(onboardingStatus.summary.quarantined, 2);
    assert.equal(onboardingStatus.summary.verified_assessed, 1);
    assert.equal(onboardingStatus.summary.verified_unassessed, 0);

    const agentRow = await db.query<{ principal_id: string }>(
      "SELECT principal_id FROM sec_agents WHERE agent_id = $1",
      [registered.agent_id],
    );
    assert.equal(agentRow.rowCount, 1);
    assert.equal(agentRow.rows[0].principal_id, registered.principal_id);

    const principalRow = await db.query<{ principal_type: string }>(
      "SELECT principal_type FROM sec_principals WHERE principal_id = $1",
      [registered.principal_id],
    );
    assert.equal(principalRow.rowCount, 1);
    assert.equal(principalRow.rows[0].principal_type, "agent");

    const linkRows = await db.query<{ verification_status: string }>(
      `SELECT verification_status
       FROM sec_agent_skill_packages
       WHERE agent_id = $1`,
      [registered.agent_id],
    );
    assert.equal(linkRows.rowCount, 3);
    assert.ok(linkRows.rows.some((r) => r.verification_status === "verified"));
    assert.ok(!linkRows.rows.some((r) => r.verification_status === "pending"));
    assert.equal(
      linkRows.rows.filter((r) => r.verification_status === "quarantined").length,
      2,
    );

    const assessments = await db.query<{ skill_id: string; status: string }>(
      `SELECT skill_id, status
       FROM sec_skill_assessments
       WHERE workspace_id = $1
         AND agent_id = $2`,
      ["ws_contract", registered.agent_id],
    );
    assert.equal(assessments.rowCount, 1);
    assert.equal(assessments.rows[0].skill_id, verifiedImported?.skill_id);
    assert.equal(assessments.rows[0].status, "passed");

    const assessedSkill = await db.query<{
      skill_id: string;
      source_skill_package_id: string | null;
      assessment_total: number;
      assessment_passed: number;
    }>(
      `SELECT skill_id, source_skill_package_id, assessment_total, assessment_passed
       FROM sec_agent_skills
       WHERE workspace_id = $1
         AND agent_id = $2`,
      ["ws_contract", registered.agent_id],
    );
    assert.equal(assessedSkill.rowCount, 1);
    assert.equal(assessedSkill.rows[0].skill_id, verifiedImported?.skill_id);
    assert.equal(assessedSkill.rows[0].source_skill_package_id, verifiedImported?.skill_package_id);
    assert.equal(assessedSkill.rows[0].assessment_total, 1);
    assert.equal(assessedSkill.rows[0].assessment_passed, 1);

    const registered2 = await postJson<{ agent_id: string; principal_id: string }>(
      baseUrl,
      "/v1/agents",
      { display_name: "Imported Agent 2" },
      workspaceHeader,
    );
    assert.ok(registered2.agent_id.startsWith("agt_"));

    const inventory2 = {
      packages: [
        {
          skill_id: `skill.certify.pending.${runSuffix}`,
          version: "1.0.0",
          hash_sha256: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
          manifest: {
            required_tools: ["http_client"],
            data_access: { read: ["web"] },
            egress_domains: ["example.org"],
            sandbox_required: true,
          },
        },
        {
          skill_id: `skill.certify.verified.${runSuffix}`,
          version: "1.0.0",
          hash_sha256: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
          signature: "sig_v2",
          manifest: {
            required_tools: ["http_client"],
            data_access: { read: ["web"] },
            egress_domains: ["example.org"],
            sandbox_required: true,
          },
        },
      ],
    };

    const imported2 = await postJson<{
      summary: { total: number; verified: number; pending: number; quarantined: number };
      items: Array<{ skill_id: string; status: string; skill_package_id: string }>;
    }>(
      baseUrl,
      `/v1/agents/${encodeURIComponent(registered2.agent_id)}/skills/import`,
      inventory2,
      workspaceHeader,
    );
    assert.equal(imported2.summary.total, 2);
    assert.equal(imported2.summary.verified, 1);
    assert.equal(imported2.summary.pending, 1);
    assert.equal(imported2.summary.quarantined, 0);
    const onboardingStatus2Before = await getJson<{
      summary: {
        total_linked: number;
        verified: number;
        verified_skills: number;
        pending: number;
        quarantined: number;
        verified_assessed: number;
        verified_unassessed: number;
      };
    }>(
      baseUrl,
      `/v1/agents/${encodeURIComponent(registered2.agent_id)}/skills/onboarding-status`,
      workspaceHeader,
    );
    assert.equal(onboardingStatus2Before.summary.total_linked, 2);
    assert.equal(onboardingStatus2Before.summary.verified, 1);
    assert.equal(onboardingStatus2Before.summary.verified_skills, 1);
    assert.equal(onboardingStatus2Before.summary.pending, 1);
    assert.equal(onboardingStatus2Before.summary.quarantined, 0);
    assert.equal(onboardingStatus2Before.summary.verified_assessed, 0);
    assert.equal(onboardingStatus2Before.summary.verified_unassessed, 1);

    const certify = await postJson<{
      review: {
        summary: { total: number; verified: number; quarantined: number };
      };
      assess: {
        summary: { total_candidates: number; assessed: number; skipped: number };
      };
    }>(
      baseUrl,
      `/v1/agents/${encodeURIComponent(registered2.agent_id)}/skills/certify-imported`,
      {},
      workspaceHeader,
    );
    assert.equal(certify.review.summary.total, 1);
    assert.equal(certify.review.summary.verified, 0);
    assert.equal(certify.review.summary.quarantined, 1);
    assert.equal(certify.assess.summary.total_candidates, 1);
    assert.equal(certify.assess.summary.assessed, 1);
    assert.equal(certify.assess.summary.skipped, 0);
    const onboardingStatus2After = await getJson<{
      summary: {
        total_linked: number;
        verified: number;
        verified_skills: number;
        pending: number;
        quarantined: number;
        verified_assessed: number;
        verified_unassessed: number;
      };
    }>(
      baseUrl,
      `/v1/agents/${encodeURIComponent(registered2.agent_id)}/skills/onboarding-status`,
      workspaceHeader,
    );
    assert.equal(onboardingStatus2After.summary.total_linked, 2);
    assert.equal(onboardingStatus2After.summary.verified, 1);
    assert.equal(onboardingStatus2After.summary.verified_skills, 1);
    assert.equal(onboardingStatus2After.summary.pending, 0);
    assert.equal(onboardingStatus2After.summary.quarantined, 1);
    assert.equal(onboardingStatus2After.summary.verified_assessed, 1);
    assert.equal(onboardingStatus2After.summary.verified_unassessed, 0);

    const certifyAgain = await postJson<{
      review: {
        summary: { total: number; verified: number; quarantined: number };
      };
      assess: {
        summary: { total_candidates: number; assessed: number; skipped: number };
      };
    }>(
      baseUrl,
      `/v1/agents/${encodeURIComponent(registered2.agent_id)}/skills/certify-imported`,
      {},
      workspaceHeader,
    );
    assert.equal(certifyAgain.review.summary.total, 0);
    assert.equal(certifyAgain.review.summary.verified, 0);
    assert.equal(certifyAgain.review.summary.quarantined, 0);
    assert.equal(certifyAgain.assess.summary.total_candidates, 1);
    assert.equal(certifyAgain.assess.summary.assessed, 0);
    assert.equal(certifyAgain.assess.summary.skipped, 1);

    const registered3 = await postJson<{ agent_id: string; principal_id: string }>(
      baseUrl,
      "/v1/agents",
      { display_name: "Imported Agent 3" },
      workspaceHeader,
    );
    assert.ok(registered3.agent_id.startsWith("agt_"));

    const inventory3 = {
      packages: [
        {
          skill_id: `skill.importcertify.verified.${runSuffix}`,
          version: "1.0.0",
          hash_sha256: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          signature: "sig_v3",
          manifest: {
            required_tools: ["http_client"],
            data_access: { read: ["web"] },
            egress_domains: ["example.net"],
            sandbox_required: true,
          },
        },
        {
          skill_id: `skill.importcertify.pending.${runSuffix}`,
          version: "1.0.0",
          hash_sha256: "sha256:9999999999999999999999999999999999999999999999999999999999999999",
          manifest: {
            required_tools: ["http_client"],
            data_access: { read: ["web"] },
            egress_domains: ["example.net"],
            sandbox_required: true,
          },
        },
      ],
    };

    const importCertify = await postJson<{
      import: { summary: { total: number; verified: number; pending: number; quarantined: number } };
      certify: {
        review: { summary: { total: number; verified: number; quarantined: number } };
        assess: { summary: { total_candidates: number; assessed: number; skipped: number } };
      };
    }>(
      baseUrl,
      `/v1/agents/${encodeURIComponent(registered3.agent_id)}/skills/import-certify`,
      inventory3,
      workspaceHeader,
    );
    assert.equal(importCertify.import.summary.total, 2);
    assert.equal(importCertify.import.summary.verified, 1);
    assert.equal(importCertify.import.summary.pending, 1);
    assert.equal(importCertify.import.summary.quarantined, 0);
    assert.equal(importCertify.certify.review.summary.total, 1);
    assert.equal(importCertify.certify.review.summary.verified, 0);
    assert.equal(importCertify.certify.review.summary.quarantined, 1);
    assert.equal(importCertify.certify.assess.summary.total_candidates, 1);
    assert.equal(importCertify.certify.assess.summary.assessed, 1);
    assert.equal(importCertify.certify.assess.summary.skipped, 0);

    const importCertifyAgain = await postJson<{
      import: { summary: { total: number; verified: number; pending: number; quarantined: number } };
      certify: {
        review: { summary: { total: number; verified: number; quarantined: number } };
        assess: { summary: { total_candidates: number; assessed: number; skipped: number } };
      };
    }>(
      baseUrl,
      `/v1/agents/${encodeURIComponent(registered3.agent_id)}/skills/import-certify`,
      inventory3,
      workspaceHeader,
    );
    assert.equal(importCertifyAgain.import.summary.total, 2);
    assert.equal(importCertifyAgain.import.summary.verified, 1);
    assert.equal(importCertifyAgain.import.summary.pending, 0);
    assert.equal(importCertifyAgain.import.summary.quarantined, 1);
    assert.equal(importCertifyAgain.certify.review.summary.total, 0);
    assert.equal(importCertifyAgain.certify.review.summary.verified, 0);
    assert.equal(importCertifyAgain.certify.review.summary.quarantined, 0);
    assert.equal(importCertifyAgain.certify.assess.summary.total_candidates, 1);
    assert.equal(importCertifyAgain.certify.assess.summary.assessed, 0);
    assert.equal(importCertifyAgain.certify.assess.summary.skipped, 1);

    const registered4 = await postJson<{ agent_id: string; principal_id: string }>(
      baseUrl,
      "/v1/agents",
      { display_name: "Imported Agent 4" },
      workspaceHeader,
    );
    assert.ok(registered4.agent_id.startsWith("agt_"));

    const duplicateSkillId = `skill.dup.verified.${runSuffix}`;
    const inventory4 = {
      packages: [
        {
          skill_id: duplicateSkillId,
          version: "1.0.0",
          hash_sha256: "sha256:1010101010101010101010101010101010101010101010101010101010101010",
          signature: "sig_dup_1",
          manifest: {
            required_tools: ["http_client"],
            data_access: { read: ["web"] },
            egress_domains: ["example.dup"],
            sandbox_required: true,
          },
        },
        {
          skill_id: duplicateSkillId,
          version: "1.1.0",
          hash_sha256: "sha256:2020202020202020202020202020202020202020202020202020202020202020",
          signature: "sig_dup_2",
          manifest: {
            required_tools: ["http_client"],
            data_access: { read: ["web"] },
            egress_domains: ["example.dup"],
            sandbox_required: true,
          },
        },
      ],
    };
    const imported4 = await postJson<{
      summary: { total: number; verified: number; pending: number; quarantined: number };
      items: Array<{ skill_id: string; status: string; skill_package_id: string }>;
    }>(
      baseUrl,
      `/v1/agents/${encodeURIComponent(registered4.agent_id)}/skills/import`,
      inventory4,
      workspaceHeader,
    );
    assert.equal(imported4.summary.total, 2);
    assert.equal(imported4.summary.verified, 2);
    assert.equal(imported4.summary.pending, 0);
    assert.equal(imported4.summary.quarantined, 0);

    const assessedImported4 = await postJson<{
      summary: { total_candidates: number; assessed: number; skipped: number };
    }>(
      baseUrl,
      `/v1/agents/${encodeURIComponent(registered4.agent_id)}/skills/assess-imported`,
      {},
      workspaceHeader,
    );
    assert.equal(assessedImported4.summary.total_candidates, 1);
    assert.equal(assessedImported4.summary.assessed, 1);
    assert.equal(assessedImported4.summary.skipped, 0);

    const onboardingStatus4 = await getJson<{
      summary: {
        total_linked: number;
        verified: number;
        verified_skills: number;
        pending: number;
        quarantined: number;
        verified_assessed: number;
        verified_unassessed: number;
      };
    }>(
      baseUrl,
      `/v1/agents/${encodeURIComponent(registered4.agent_id)}/skills/onboarding-status`,
      workspaceHeader,
    );
    assert.equal(onboardingStatus4.summary.total_linked, 2);
    assert.equal(onboardingStatus4.summary.verified, 2);
    assert.equal(onboardingStatus4.summary.verified_skills, 1);
    assert.equal(onboardingStatus4.summary.pending, 0);
    assert.equal(onboardingStatus4.summary.quarantined, 0);
    assert.equal(onboardingStatus4.summary.verified_assessed, 1);
    assert.equal(onboardingStatus4.summary.verified_unassessed, 0);

    const registeredEvent = await db.query<{ event_type: string }>(
      `SELECT event_type
       FROM evt_events
       WHERE event_type = 'agent.registered'
         AND data->>'agent_id' = $1`,
      [registered.agent_id],
    );
    assert.equal(registeredEvent.rowCount, 1);

    const importedEvent = await db.query<{ event_type: string }>(
      `SELECT event_type
       FROM evt_events
       WHERE event_type = 'agent.skills.imported'
         AND data->>'agent_id' = $1`,
      [registered.agent_id],
    );
    assert.equal(importedEvent.rowCount, 2);
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
