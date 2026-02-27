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

async function ensureLegacyHeaderAgent(db: pg.Client, agentId: string): Promise<string> {
  const principal = await db.query<{ principal_id: string }>(
    `SELECT principal_id
     FROM sec_principals
     WHERE legacy_actor_type = 'user'
       AND legacy_actor_id = 'legacy_header'
     LIMIT 1`,
  );
  assert.equal(principal.rowCount, 1);
  const principal_id = principal.rows[0].principal_id;

  const existing = await db.query<{ agent_id: string }>(
    `SELECT agent_id
     FROM sec_agents
     WHERE principal_id = $1
       AND revoked_at IS NULL
     LIMIT 1`,
    [principal_id],
  );
  if (existing.rowCount === 1) {
    return existing.rows[0].agent_id;
  }

  await db.query(
    `INSERT INTO sec_agents (agent_id, principal_id, display_name, created_at)
     VALUES ($1, $2, $3, now())`,
    [agentId, principal_id, "Work Item Lease Contract Agent"],
  );
  return agentId;
}

type LeaseResponse = {
  schema_version: string;
  replay: boolean;
  server_time: string;
  lease: {
    workspace_id: string;
    work_item_type: string;
    work_item_id: string;
    lease_id: string;
    agent_id: string;
    correlation_id: string;
    claimed_at?: string;
    last_heartbeat_at: string;
    expires_at: string;
    version: number;
  };
};

type ErrorResponse = {
  error: true;
  reason_code: string;
  reason: string;
  details: Record<string, unknown>;
};

async function claimWithRetry(
  baseUrl: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<{ status: number; json: unknown }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await requestJson(baseUrl, "POST", "/v1/work-items/claim", body, headers);
    if (res.status !== 409) return { status: res.status, json: res.json };
    const err = res.json as ErrorResponse;
    if (err.reason_code !== "already_claimed") {
      return { status: res.status, json: res.json };
    }
  }
  const final = await requestJson(baseUrl, "POST", "/v1/work-items/claim", body, headers);
  return { status: final.status, json: final.json };
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv("DATABASE_URL");
  await applyMigrations(databaseUrl);
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
    const workspaceId = `ws_contract_work_items_${randomUUID().slice(0, 8)}`;
    const headers = { "x-workspace-id": workspaceId };

    // Route mount check: must be mounted and executable.
    const mountCheck = await requestJson(
      baseUrl,
      "POST",
      "/v1/work-items/claim",
      {
        schema_version: "2.1",
        from_agent_id: "agent_missing",
        work_item_type: "incident",
        work_item_id: "inc_route_mount",
      },
      headers,
    );
    assert.notEqual(mountCheck.status, 404);
    assert.notEqual(mountCheck.status, 500);

    const agentId = await ensureLegacyHeaderAgent(
      db,
      `agent_work_item_contract_${randomUUID().slice(0, 6)}`,
    );

    const concurrentBody = {
      schema_version: "2.1",
      from_agent_id: agentId,
      work_item_type: "incident",
      work_item_id: "inc_concurrency",
      correlation_id: "corr:inc_concurrency",
    };

    const concurrent = await Promise.all(
      Array.from({ length: 20 }, () => claimWithRetry(baseUrl, headers, concurrentBody)),
    );
    const created = concurrent.filter((r) => r.status === 201);
    const replayed = concurrent.filter((r) => r.status === 200);
    assert.equal(created.length, 1, "exactly one claim should create lease");
    assert.equal(created.length + replayed.length, 20, "all claim attempts should be create/replay");

    const firstClaim = created[0].json as LeaseResponse;

    const preemptFirst = await requestJson(
      baseUrl,
      "POST",
      "/v1/work-items/claim",
      {
        schema_version: "2.1",
        from_agent_id: agentId,
        work_item_type: "incident",
        work_item_id: "inc_preempt",
        correlation_id: "corr:inc_preempt:first",
      },
      headers,
    );
    assert.equal(preemptFirst.status, 201);
    const preemptFirstJson = preemptFirst.json as LeaseResponse;

    await db.query(
      `UPDATE work_item_leases
       SET expires_at = now() - interval '1 second'
       WHERE workspace_id = $1
         AND work_item_type = 'incident'
         AND work_item_id = 'inc_preempt'`,
      [workspaceId],
    );

    const preemptSecond = await requestJson(
      baseUrl,
      "POST",
      "/v1/work-items/claim",
      {
        schema_version: "2.1",
        from_agent_id: agentId,
        work_item_type: "incident",
        work_item_id: "inc_preempt",
        correlation_id: "corr:inc_preempt:second",
      },
      headers,
    );
    assert.equal(preemptSecond.status, 201);
    const preemptSecondJson = preemptSecond.json as LeaseResponse;
    assert.notEqual(preemptFirstJson.lease.lease_id, preemptSecondJson.lease.lease_id);
    assert.equal(preemptSecondJson.lease.version, 1);

    const preemptEvents = await db.query<{ event_type: string; idempotency_key: string; stream_seq: number }>(
      `SELECT event_type, idempotency_key, stream_seq
       FROM evt_events
       WHERE workspace_id = $1
         AND entity_type = 'incident'
         AND entity_id = 'inc_preempt'
         AND event_type IN ('lease.preempted', 'lease.claimed')
       ORDER BY stream_type ASC, stream_id ASC, stream_seq ASC`,
      [workspaceId],
    );

    const preemptKey =
      `preempt:${workspaceId}:incident:inc_preempt:${preemptFirstJson.lease.lease_id}:${preemptSecondJson.lease.lease_id}`;
    const secondClaimKey =
      `claim:${workspaceId}:incident:inc_preempt:${preemptSecondJson.lease.lease_id}`;
    const preemptEvent = preemptEvents.rows.find((r) => r.idempotency_key === preemptKey);
    const secondClaimEvent = preemptEvents.rows.find((r) => r.idempotency_key === secondClaimKey);
    assert.ok(preemptEvent, "preempt event must exist");
    assert.ok(secondClaimEvent, "second claim event must exist");
    assert.ok((preemptEvent?.stream_seq ?? 0) < (secondClaimEvent?.stream_seq ?? 0));

    const hbClaim = await requestJson(
      baseUrl,
      "POST",
      "/v1/work-items/claim",
      {
        schema_version: "2.1",
        from_agent_id: agentId,
        work_item_type: "incident",
        work_item_id: "inc_heartbeat",
        correlation_id: "corr:inc_heartbeat",
      },
      headers,
    );
    assert.equal(hbClaim.status, 201);
    const hbLease = (hbClaim.json as LeaseResponse).lease;

    process.env.HEARTBEAT_MIN_INTERVAL_SEC = "0";
    const hb1 = await requestJson(
      baseUrl,
      "POST",
      "/v1/work-items/heartbeat",
      {
        schema_version: "2.1",
        from_agent_id: agentId,
        work_item_type: "incident",
        work_item_id: "inc_heartbeat",
        lease_id: hbLease.lease_id,
        version: hbLease.version,
      },
      headers,
    );
    assert.equal(hb1.status, 200);
    const hb1Json = hb1.json as LeaseResponse;

    process.env.HEARTBEAT_MIN_INTERVAL_SEC = "1";
    const hb2 = await requestJson(
      baseUrl,
      "POST",
      "/v1/work-items/heartbeat",
      {
        schema_version: "2.1",
        from_agent_id: agentId,
        work_item_type: "incident",
        work_item_id: "inc_heartbeat",
        lease_id: hbLease.lease_id,
        version: hb1Json.lease.version,
      },
      headers,
    );
    assert.equal(hb2.status, 429);
    assert.equal((hb2.json as ErrorResponse).reason_code, "heartbeat_rate_limited");
    delete process.env.HEARTBEAT_MIN_INTERVAL_SEC;

    const releaseA = await requestJson(
      baseUrl,
      "POST",
      "/v1/work-items/claim",
      {
        schema_version: "2.1",
        from_agent_id: agentId,
        work_item_type: "incident",
        work_item_id: "inc_release_guard",
        correlation_id: "corr:inc_release_guard:a",
      },
      headers,
    );
    assert.equal(releaseA.status, 201);
    const leaseA = (releaseA.json as LeaseResponse).lease;

    await db.query(
      `UPDATE work_item_leases
       SET expires_at = now() - interval '1 second'
       WHERE workspace_id = $1
         AND work_item_type = 'incident'
         AND work_item_id = 'inc_release_guard'`,
      [workspaceId],
    );

    const releaseB = await requestJson(
      baseUrl,
      "POST",
      "/v1/work-items/claim",
      {
        schema_version: "2.1",
        from_agent_id: agentId,
        work_item_type: "incident",
        work_item_id: "inc_release_guard",
        correlation_id: "corr:inc_release_guard:b",
      },
      headers,
    );
    assert.equal(releaseB.status, 201);
    const leaseB = (releaseB.json as LeaseResponse).lease;

    const staleRelease = await requestJson(
      baseUrl,
      "POST",
      "/v1/work-items/release",
      {
        schema_version: "2.1",
        from_agent_id: agentId,
        work_item_type: "incident",
        work_item_id: "inc_release_guard",
        lease_id: leaseA.lease_id,
      },
      headers,
    );
    assert.equal(staleRelease.status, 200);
    assert.equal((staleRelease.json as { released: boolean }).released, false);

    const activeRow = await db.query<{ lease_id: string }>(
      `SELECT lease_id
       FROM work_item_leases
       WHERE workspace_id = $1
         AND work_item_type = 'incident'
         AND work_item_id = 'inc_release_guard'`,
      [workspaceId],
    );
    assert.equal(activeRow.rowCount, 1);
    assert.equal(activeRow.rows[0].lease_id, leaseB.lease_id);

    const activeRelease = await requestJson(
      baseUrl,
      "POST",
      "/v1/work-items/release",
      {
        schema_version: "2.1",
        from_agent_id: agentId,
        work_item_type: "incident",
        work_item_id: "inc_release_guard",
        lease_id: leaseB.lease_id,
      },
      headers,
    );
    assert.equal(activeRelease.status, 200);
    assert.equal((activeRelease.json as { released: boolean }).released, true);

    const releasedRow = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM work_item_leases
       WHERE workspace_id = $1
         AND work_item_type = 'incident'
         AND work_item_id = 'inc_release_guard'`,
      [workspaceId],
    );
    assert.equal(Number.parseInt(releasedRow.rows[0].count, 10), 0);

    const eventCounts = await db.query<{ event_type: string; count: string }>(
      `SELECT event_type, count(*)::text AS count
       FROM evt_events
       WHERE workspace_id = $1
         AND entity_type = 'incident'
         AND entity_id IN ('inc_concurrency', 'inc_preempt', 'inc_release_guard')
         AND event_type IN ('lease.claimed', 'lease.released', 'lease.preempted', 'lease.heartbeat')
       GROUP BY event_type`,
      [workspaceId],
    );
    const counts = new Map(eventCounts.rows.map((r) => [r.event_type, Number.parseInt(r.count, 10)]));
    assert.ok((counts.get("lease.claimed") ?? 0) >= 3);
    assert.ok((counts.get("lease.released") ?? 0) >= 1);
    assert.equal(counts.get("lease.heartbeat") ?? 0, 0);

    let checkError: unknown = null;
    try {
      await db.query(
        `INSERT INTO work_item_leases (
           workspace_id,
           work_item_type,
           work_item_id,
           lease_id,
           agent_id,
           correlation_id,
           expires_at,
           version
         ) VALUES (
           $1, 'run', $2, $3, $4, $5, now() + interval '1 minute', 1
         )`,
        [workspaceId, "invalid_type_row", `lease_${randomUUID()}`, agentId, `corr:${randomUUID()}`],
      );
    } catch (err) {
      checkError = err;
    }
    assert.ok(checkError instanceof Error, "DB CHECK must reject work_item_type='run'");

    const correlationMismatch = await requestJson(
      baseUrl,
      "POST",
      "/v1/work-items/claim",
      {
        schema_version: "2.1",
        from_agent_id: agentId,
        work_item_type: "incident",
        work_item_id: "inc_concurrency",
        correlation_id: "corr:inc_concurrency:mismatch",
      },
      headers,
    );
    assert.equal(correlationMismatch.status, 409);
    assert.equal((correlationMismatch.json as ErrorResponse).reason_code, "correlation_id_mismatch");

    const heartbeatVersionMismatch = await requestJson(
      baseUrl,
      "POST",
      "/v1/work-items/heartbeat",
      {
        schema_version: "2.1",
        from_agent_id: agentId,
        work_item_type: "incident",
        work_item_id: "inc_heartbeat",
        lease_id: hbLease.lease_id,
        version: 999,
      },
      headers,
    );
    assert.equal(heartbeatVersionMismatch.status, 409);
    const versionMismatchJson = heartbeatVersionMismatch.json as ErrorResponse;
    assert.equal(versionMismatchJson.reason_code, "lease_version_mismatch");
    assert.ok(versionMismatchJson.details.current_version != null);
    assert.equal(versionMismatchJson.details.lease_id, hbLease.lease_id);

    // keep reference so TS doesn't optimize away created lease use
    assert.ok(firstClaim.lease.lease_id.length > 0);
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
