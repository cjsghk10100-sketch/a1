import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
  delete process.env.POLICY_KILL_SWITCH_EXTERNAL_WRITE;
  delete process.env.POLICY_ENFORCEMENT_MODE;
  process.env.EGRESS_MAX_REQUESTS_PER_HOUR = "2";

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
    const workspaceHeader = { "x-workspace-id": `ws_contract_egress_${Date.now()}` };
    const { room_id } = await postJson<{ room_id: string }>(
      baseUrl,
      "/v1/rooms",
      { title: "Egress Contract Room", room_mode: "default", default_lang: "en" },
      workspaceHeader,
    );

    const scopedPrincipalId = randomUUID();
    const scopedGrantorId = randomUUID();
    await db.query(
      `INSERT INTO sec_principals (principal_id, principal_type)
       VALUES ($1, 'agent'), ($2, 'user')`,
      [scopedPrincipalId, scopedGrantorId],
    );

    const scopedToken = await postJson<{ token_id: string }>(
      baseUrl,
      "/v1/capabilities/grant",
      {
        issued_to_principal_id: scopedPrincipalId,
        granted_by_principal_id: scopedGrantorId,
        scopes: {
          rooms: [room_id],
          action_types: ["internal.read"],
          egress_domains: ["example.com"],
        },
      },
      workspaceHeader,
    );

    const scopedAllowed = await postJson<{
      egress_request_id: string;
      decision: string;
      reason_code: string;
    }>(
      baseUrl,
      "/v1/egress/requests",
      {
        action: "internal.read",
        target_url: "https://example.com/scoped",
        method: "GET",
        room_id,
        principal_id: scopedPrincipalId,
        capability_token_id: scopedToken.token_id,
      },
      workspaceHeader,
    );
    assert.equal(scopedAllowed.decision, "allow");

    const scopedDeniedDomain = await postJson<{
      egress_request_id: string;
      decision: string;
      reason_code: string;
    }>(
      baseUrl,
      "/v1/egress/requests",
      {
        action: "internal.read",
        target_url: "https://not-allowed.example.net/blocked",
        method: "GET",
        room_id,
        principal_id: scopedPrincipalId,
        capability_token_id: scopedToken.token_id,
      },
      workspaceHeader,
    );
    assert.equal(scopedDeniedDomain.decision, "deny");
    assert.equal(scopedDeniedDomain.reason_code, "capability_scope_domain_not_allowed");

    const allowed = await postJson<{
      egress_request_id: string;
      decision: string;
      reason_code: string;
      approval_id?: string;
    }>(
      baseUrl,
      "/v1/egress/requests",
      {
        action: "internal.read",
        target_url: "https://example.com/data",
        method: "GET",
        room_id,
      },
      workspaceHeader,
    );
    assert.equal(allowed.decision, "allow");
    assert.equal(allowed.approval_id, undefined);

    const allowRow = await db.query<{
      policy_decision: string;
      approval_id: string | null;
      target_domain: string;
    }>(
      `SELECT policy_decision, approval_id, target_domain
       FROM sec_egress_requests
       WHERE egress_request_id = $1`,
      [allowed.egress_request_id],
    );
    assert.equal(allowRow.rowCount, 1);
    assert.equal(allowRow.rows[0].policy_decision, "allow");
    assert.equal(allowRow.rows[0].approval_id, null);
    assert.equal(allowRow.rows[0].target_domain, "example.com");

    const allowEvents = await db.query<{ event_type: string }>(
      `SELECT event_type
       FROM evt_events
       WHERE event_type IN ('egress.requested', 'egress.allowed')
         AND data->>'egress_request_id' = $1`,
      [allowed.egress_request_id],
    );
    assert.equal(allowEvents.rowCount, 2);

    const required = await postJson<{
      egress_request_id: string;
      decision: string;
      reason_code: string;
      approval_id?: string;
    }>(
      baseUrl,
      "/v1/egress/requests",
      {
        action: "external.write",
        target_url: "https://example.org/submit",
        method: "POST",
        room_id,
      },
      workspaceHeader,
    );
    assert.equal(required.decision, "require_approval");
    assert.ok(typeof required.approval_id === "string");

    const requiredRow = await db.query<{
      policy_decision: string;
      approval_id: string | null;
    }>(
      `SELECT policy_decision, approval_id
       FROM sec_egress_requests
       WHERE egress_request_id = $1`,
      [required.egress_request_id],
    );
    assert.equal(requiredRow.rowCount, 1);
    assert.equal(requiredRow.rows[0].policy_decision, "require_approval");
    assert.ok(typeof requiredRow.rows[0].approval_id === "string");

    const approvalProjection = await db.query<{ approval_id: string }>(
      "SELECT approval_id FROM proj_approvals WHERE approval_id = $1",
      [required.approval_id ?? ""],
    );
    assert.equal(approvalProjection.rowCount, 1);

    const blockedEvent = await db.query<{ event_type: string }>(
      `SELECT event_type
       FROM evt_events
       WHERE event_type = 'egress.blocked'
         AND data->>'egress_request_id' = $1`,
      [required.egress_request_id],
    );
    assert.equal(blockedEvent.rowCount, 1);

    const quotaExceeded = await postJson<{
      egress_request_id: string;
      decision: string;
      reason_code: string;
      approval_id?: string;
    }>(
      baseUrl,
      "/v1/egress/requests",
      {
        action: "internal.read",
        target_url: "https://example.com/third",
        method: "GET",
        room_id,
      },
      workspaceHeader,
    );
    assert.equal(quotaExceeded.decision, "deny");
    assert.equal(quotaExceeded.reason_code, "quota_exceeded");
    assert.equal(quotaExceeded.approval_id, undefined);

    const quotaRow = await db.query<{ policy_decision: string; policy_reason_code: string | null }>(
      `SELECT policy_decision, policy_reason_code
       FROM sec_egress_requests
       WHERE egress_request_id = $1`,
      [quotaExceeded.egress_request_id],
    );
    assert.equal(quotaRow.rowCount, 1);
    assert.equal(quotaRow.rows[0].policy_decision, "deny");
    assert.equal(quotaRow.rows[0].policy_reason_code, "quota_exceeded");

    const quotaEvent = await db.query<{ event_type: string }>(
      `SELECT event_type
       FROM evt_events
       WHERE event_type = 'quota.exceeded'
         AND data->>'egress_request_id' = $1`,
      [quotaExceeded.egress_request_id],
    );
    assert.equal(quotaEvent.rowCount, 1);

    process.env.POLICY_KILL_SWITCH_EXTERNAL_WRITE = "1";
    const denied = await postJson<{
      egress_request_id: string;
      decision: string;
      reason_code: string;
      approval_id?: string;
    }>(
      baseUrl,
      "/v1/egress/requests",
      {
        action: "external.write",
        target_url: "https://example.net/blocked",
        method: "POST",
        room_id,
      },
      workspaceHeader,
    );
    assert.equal(denied.decision, "deny");
    assert.equal(denied.reason_code, "kill_switch_active");
    assert.equal(denied.approval_id, undefined);

    const deniedRow = await db.query<{ policy_decision: string; approval_id: string | null }>(
      `SELECT policy_decision, approval_id
       FROM sec_egress_requests
       WHERE egress_request_id = $1`,
      [denied.egress_request_id],
    );
    assert.equal(deniedRow.rowCount, 1);
    assert.equal(deniedRow.rows[0].policy_decision, "deny");
    assert.equal(deniedRow.rows[0].approval_id, null);

    const list = await getJson<{ requests: Array<{ egress_request_id: string }> }>(
      baseUrl,
      `/v1/egress/requests?room_id=${encodeURIComponent(room_id)}&limit=10`,
      workspaceHeader,
    );
    assert.ok(list.requests.some((r) => r.egress_request_id === denied.egress_request_id));
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
