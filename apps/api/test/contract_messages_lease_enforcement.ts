import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

import { createPool } from "../src/db/pool.js";
import { buildServer } from "../src/server.js";

const { Client } = pg;
type SqlClient = InstanceType<typeof Client>;

type JsonResponse = {
  status: number;
  json: unknown;
  text: string;
  headers: Headers;
};

type ContractErrorJson = {
  error: true;
  reason_code: string;
  reason: string;
  details: Record<string, unknown>;
};

type MessageSuccessJson = {
  message_id: string;
  idempotent_replay: boolean;
  reason_code?: string;
};

const TEST_RUN_ID = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const WORKSPACE_ID = `ws_contract_messages_lease_${TEST_RUN_ID}`;

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

  return { status: res.status, json, text, headers: res.headers };
}

function assertContractError(json: unknown, reason_code: string): void {
  const payload = json as Partial<ContractErrorJson>;
  assert.equal(payload.error, true);
  assert.equal(payload.reason_code, reason_code);
  assert.equal(typeof payload.reason, "string");
  assert.ok((payload.reason ?? "").length > 0);
}

async function ensureLegacyPrincipalId(db: SqlClient): Promise<string> {
  const principal = await db.query<{ principal_id: string }>(
    `SELECT principal_id
     FROM sec_principals
     WHERE legacy_actor_type = 'user'
       AND legacy_actor_id = 'legacy_header'
     LIMIT 1`,
  );
  assert.equal(principal.rowCount, 1);
  return principal.rows[0].principal_id;
}

async function setAuthenticatedAgent(db: SqlClient, principal_id: string, agent_id: string): Promise<void> {
  const existing = await db.query<{ agent_id: string }>(
    `SELECT agent_id
     FROM sec_agents
     WHERE principal_id = $1
     LIMIT 1`,
    [principal_id],
  );
  const existingAgentId = existing.rows[0]?.agent_id;

  if (existingAgentId && existingAgentId !== agent_id) {
    const references = await db.query<{
      table_schema: string;
      table_name: string;
      column_name: string;
    }>(
      `SELECT
         ns.nspname AS table_schema,
         cls.relname AS table_name,
         att.attname AS column_name
       FROM pg_constraint con
       JOIN pg_class cls
         ON cls.oid = con.conrelid
       JOIN pg_namespace ns
         ON ns.oid = cls.relnamespace
       JOIN LATERAL unnest(con.conkey) AS key(attnum)
         ON TRUE
       JOIN pg_attribute att
         ON att.attrelid = con.conrelid
        AND att.attnum = key.attnum
       WHERE con.contype = 'f'
         AND con.confrelid = 'sec_agents'::regclass`,
    );

    for (const ref of references.rows) {
      const tableRef = `\"${ref.table_schema}\".\"${ref.table_name}\"`;
      const columnRef = `\"${ref.column_name}\"`;
      await db.query(`DELETE FROM ${tableRef} WHERE ${columnRef} = $1`, [existingAgentId]);
    }
  }

  await db.query(
    `INSERT INTO sec_agents (agent_id, principal_id, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (principal_id) DO UPDATE SET
       agent_id = EXCLUDED.agent_id,
       display_name = EXCLUDED.display_name,
       revoked_at = NULL`,
    [agent_id, principal_id, `Contract Agent ${agent_id}`],
  );
}

async function upsertLease(
  db: SqlClient,
  input: {
    workspace_id: string;
    work_item_type: "approval" | "experiment" | "incident" | "message" | "artifact";
    work_item_id: string;
    lease_id: string;
    agent_id: string;
    correlation_id: string;
    expiresInterval: string;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO work_item_leases (
       workspace_id,
       work_item_type,
       work_item_id,
       lease_id,
       agent_id,
       correlation_id,
       claimed_at,
       last_heartbeat_at,
       expires_at,
       version
     ) VALUES (
       $1,$2,$3,$4,$5,$6,now(),now(),now() + ($7)::interval,1
     )
     ON CONFLICT (workspace_id, work_item_type, work_item_id)
     DO UPDATE SET
       lease_id = EXCLUDED.lease_id,
       agent_id = EXCLUDED.agent_id,
       correlation_id = EXCLUDED.correlation_id,
       claimed_at = now(),
       last_heartbeat_at = now(),
       expires_at = EXCLUDED.expires_at,
       version = 1`,
    [
      input.workspace_id,
      input.work_item_type,
      input.work_item_id,
      input.lease_id,
      input.agent_id,
      input.correlation_id,
      input.expiresInterval,
    ],
  );
}

function buildMessageBody(input: {
  idempotency_key: string;
  from_agent_id: string;
  intent?: string;
  work_links?: Record<string, string>;
}): Record<string, unknown> {
  const scopedIdempotencyKey = `${input.idempotency_key}:${TEST_RUN_ID}`;
  return {
    schema_version: "2.1",
    from_agent_id: input.from_agent_id,
    idempotency_key: scopedIdempotencyKey,
    intent: input.intent ?? "message",
    work_links: input.work_links,
    payload: { text: `payload:${scopedIdempotencyKey}` },
  };
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

  const workspaceHeader = { "x-workspace-id": WORKSPACE_ID };
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();

  let lockClient: SqlClient | null = null;

  async function cleanupLeases(): Promise<void> {
    await db.query(`DELETE FROM work_item_leases WHERE workspace_id = $1`, [WORKSPACE_ID]);
  }

  async function runCase(name: string, fn: () => Promise<void>): Promise<void> {
    await cleanupLeases();
    try {
      await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`[${name}] ${message}`);
    } finally {
      const activeLockClient = lockClient;
      if (activeLockClient) {
        await activeLockClient.query("ROLLBACK").catch(() => {});
        await activeLockClient.end().catch(() => {});
        lockClient = null;
      }
      await cleanupLeases();
    }
  }

  try {
    const seedRoom = await postJsonAny(
      baseUrl,
      "/v1/rooms",
      { title: "messages lease seed", room_mode: "default", default_lang: "en" },
      workspaceHeader,
    );
    assert.equal(seedRoom.status, 201, seedRoom.text);

    const principal_id = await ensureLegacyPrincipalId(db);

    await runCase("1_wrong_owner_blocked", async () => {
      await setAuthenticatedAgent(db, principal_id, "agt_owner_b");
      await upsertLease(db, {
        workspace_id: WORKSPACE_ID,
        work_item_type: "incident",
        work_item_id: "inc_wrong_owner",
        lease_id: "lease_wrong_owner",
        agent_id: "agt_owner_a",
        correlation_id: "corr:wrong_owner",
        expiresInterval: "10 minutes",
      });

      const res = await postJsonAny(
        baseUrl,
        "/v1/messages",
        buildMessageBody({
          idempotency_key: "msg:wrong_owner",
          from_agent_id: "agt_owner_b",
          intent: "message",
          work_links: { incident_id: "inc_wrong_owner" },
        }),
        workspaceHeader,
      );
      assert.equal(res.status, 403, res.text);
      assertContractError(res.json, "lease_expired_or_preempted");
    });

    await runCase("2_terminal_bypass_blocked", async () => {
      await setAuthenticatedAgent(db, principal_id, "agt_terminal_b");
      await upsertLease(db, {
        workspace_id: WORKSPACE_ID,
        work_item_type: "incident",
        work_item_id: "inc_terminal_owner",
        lease_id: "lease_terminal_owner",
        agent_id: "agt_terminal_a",
        correlation_id: "corr:terminal_owner",
        expiresInterval: "10 minutes",
      });

      const res = await postJsonAny(
        baseUrl,
        "/v1/messages",
        buildMessageBody({
          idempotency_key: "msg:terminal_owner",
          from_agent_id: "agt_terminal_b",
          intent: "resolve",
          work_links: { incident_id: "inc_terminal_owner" },
        }),
        workspaceHeader,
      );
      assert.equal(res.status, 403, res.text);
      assertContractError(res.json, "lease_expired_or_preempted");
    });

    await runCase("3_expired_foreign_lease_blocks", async () => {
      await setAuthenticatedAgent(db, principal_id, "agt_expired_b");
      await upsertLease(db, {
        workspace_id: WORKSPACE_ID,
        work_item_type: "incident",
        work_item_id: "inc_expired_foreign",
        lease_id: "lease_expired_foreign",
        agent_id: "agt_expired_a",
        correlation_id: "corr:expired_foreign",
        expiresInterval: "-1 second",
      });

      const res = await postJsonAny(
        baseUrl,
        "/v1/messages",
        buildMessageBody({
          idempotency_key: "msg:expired_foreign",
          from_agent_id: "agt_expired_b",
          intent: "message",
          work_links: { incident_id: "inc_expired_foreign" },
        }),
        workspaceHeader,
      );
      assert.equal(res.status, 403, res.text);
      assertContractError(res.json, "lease_expired_or_preempted");
    });

    await runCase("4_missing_lease_allowed_with_header", async () => {
      await setAuthenticatedAgent(db, principal_id, "agt_missing_lease");

      const res = await postJsonAny(
        baseUrl,
        "/v1/messages",
        buildMessageBody({
          idempotency_key: "msg:missing_lease",
          from_agent_id: "agt_missing_lease",
          intent: "message",
          work_links: { incident_id: "inc_missing_lease" },
        }),
        workspaceHeader,
      );
      assert.equal(res.status, 201, res.text);
      assert.equal(res.headers.get("x-lease-warning"), "missing_lease");
    });

    await runCase("5_terminal_auto_release", async () => {
      await setAuthenticatedAgent(db, principal_id, "agt_auto_release");
      await upsertLease(db, {
        workspace_id: WORKSPACE_ID,
        work_item_type: "incident",
        work_item_id: "inc_auto_release",
        lease_id: "lease_auto_release",
        agent_id: "agt_auto_release",
        correlation_id: "corr:auto_release",
        expiresInterval: "10 minutes",
      });

      const res = await postJsonAny(
        baseUrl,
        "/v1/messages",
        buildMessageBody({
          idempotency_key: "msg:auto_release",
          from_agent_id: "agt_auto_release",
          intent: "resolve",
          work_links: { incident_id: "inc_auto_release" },
        }),
        workspaceHeader,
      );
      assert.equal(res.status, 201, res.text);

      const remaining = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM work_item_leases
         WHERE workspace_id = $1
           AND work_item_type = 'incident'
           AND work_item_id = 'inc_auto_release'`,
        [WORKSPACE_ID],
      );
      assert.equal(Number.parseInt(remaining.rows[0].count, 10), 0);
    });

    await runCase("6_trojan_defense_run_terminal_blocked", async () => {
      await setAuthenticatedAgent(db, principal_id, "agt_trojan");

      const res = await postJsonAny(
        baseUrl,
        "/v1/messages",
        buildMessageBody({
          idempotency_key: "msg:trojan",
          from_agent_id: "agt_trojan",
          intent: "resolve",
          work_links: { run_id: "run_forbidden_terminal" },
        }),
        workspaceHeader,
      );
      assert.equal(res.status, 400, res.text);
      assertContractError(res.json, "invalid_intent_for_type");
    });

    await runCase("7_multi_key_resolution_stable", async () => {
      await setAuthenticatedAgent(db, principal_id, "agt_multi");
      await upsertLease(db, {
        workspace_id: WORKSPACE_ID,
        work_item_type: "approval",
        work_item_id: "appr_multi_key",
        lease_id: "lease_multi_key",
        agent_id: "agt_multi",
        correlation_id: "corr:multi_key",
        expiresInterval: "10 minutes",
      });

      const res = await postJsonAny(
        baseUrl,
        "/v1/messages",
        buildMessageBody({
          idempotency_key: "msg:multi_key",
          from_agent_id: "agt_multi",
          intent: "message",
          work_links: {
            approval_id: "appr_multi_key",
            experiment_id: "exp_multi_key",
          },
        }),
        workspaceHeader,
      );
      assert.equal(res.status, 201, res.text);
      assert.equal(res.headers.get("x-lease-warning"), null);
    });

    await runCase("8_duplicate_idempotent_replay", async () => {
      await setAuthenticatedAgent(db, principal_id, "agt_dedupe");

      const body = buildMessageBody({
        idempotency_key: "msg:dedupe",
        from_agent_id: "agt_dedupe",
        intent: "message",
        work_links: { incident_id: "inc_dedupe" },
      });

      const first = await postJsonAny(baseUrl, "/v1/messages", body, workspaceHeader);
      assert.equal(first.status, 201, first.text);
      const firstJson = first.json as MessageSuccessJson;
      assert.ok(firstJson.message_id.startsWith("msg_"));

      const second = await postJsonAny(baseUrl, "/v1/messages", body, workspaceHeader);
      assert.equal(second.status, 200, second.text);
      const secondJson = second.json as MessageSuccessJson;
      assert.equal(secondJson.idempotent_replay, true);
      assert.equal(secondJson.reason_code, "duplicate_idempotent_replay");
      assert.equal(secondJson.message_id, firstJson.message_id);
    });

    await runCase("9_cross_agent_idempotency_conflict", async () => {
      await setAuthenticatedAgent(db, principal_id, "agt_collision_a");
      const idempotencyKey = "msg:collision";

      const first = await postJsonAny(
        baseUrl,
        "/v1/messages",
        buildMessageBody({
          idempotency_key: idempotencyKey,
          from_agent_id: "agt_collision_a",
          intent: "message",
          work_links: { incident_id: "inc_collision" },
        }),
        workspaceHeader,
      );
      assert.equal(first.status, 201, first.text);

      await setAuthenticatedAgent(db, principal_id, "agt_collision_b");
      const second = await postJsonAny(
        baseUrl,
        "/v1/messages",
        buildMessageBody({
          idempotency_key: idempotencyKey,
          from_agent_id: "agt_collision_b",
          intent: "message",
          work_links: { incident_id: "inc_collision" },
        }),
        workspaceHeader,
      );
      assert.equal(second.status, 409, second.text);
      assertContractError(second.json, "idempotency_conflict_unresolved");
    });

    await runCase("10_nowait_lock_contention", async () => {
      await setAuthenticatedAgent(db, principal_id, "agt_lock");
      await upsertLease(db, {
        workspace_id: WORKSPACE_ID,
        work_item_type: "incident",
        work_item_id: "inc_lock",
        lease_id: "lease_lock",
        agent_id: "agt_lock",
        correlation_id: "corr:lock",
        expiresInterval: "10 minutes",
      });

      lockClient = new Client({ connectionString: databaseUrl });
      await lockClient.connect();
      const lockAcquired = (async () => {
        await lockClient!.query("BEGIN");
        await lockClient!.query(
          `SELECT lease_id
           FROM work_item_leases
           WHERE workspace_id = $1
             AND work_item_type = 'incident'
             AND work_item_id = 'inc_lock'
           FOR UPDATE`,
          [WORKSPACE_ID],
        );
        return true;
      })();

      const ready = await Promise.race([
        lockAcquired,
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 3000)),
      ]);
      assert.equal(ready, true, "lock acquisition timeout");

      const res = await postJsonAny(
        baseUrl,
        "/v1/messages",
        buildMessageBody({
          idempotency_key: "msg:lock",
          from_agent_id: "agt_lock",
          intent: "message",
          work_links: { incident_id: "inc_lock" },
        }),
        workspaceHeader,
      );
      assert.equal(res.status, 429, res.text);
      assertContractError(res.json, "heartbeat_rate_limited");
    });

    await runCase("11_anti_spoofing_before_lease_check", async () => {
      await setAuthenticatedAgent(db, principal_id, "agt_spoof_owner");
      await upsertLease(db, {
        workspace_id: WORKSPACE_ID,
        work_item_type: "incident",
        work_item_id: "inc_spoof",
        lease_id: "lease_spoof",
        agent_id: "agt_spoof_owner",
        correlation_id: "corr:spoof",
        expiresInterval: "10 minutes",
      });

      lockClient = new Client({ connectionString: databaseUrl });
      await lockClient.connect();
      const lockAcquired = (async () => {
        await lockClient!.query("BEGIN");
        await lockClient!.query(
          `SELECT lease_id
           FROM work_item_leases
           WHERE workspace_id = $1
             AND work_item_type = 'incident'
             AND work_item_id = 'inc_spoof'
           FOR UPDATE`,
          [WORKSPACE_ID],
        );
        return true;
      })();

      const ready = await Promise.race([
        lockAcquired,
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 3000)),
      ]);
      assert.equal(ready, true, "lock acquisition timeout");

      const res = await postJsonAny(
        baseUrl,
        "/v1/messages",
        buildMessageBody({
          idempotency_key: "msg:spoof",
          from_agent_id: "agt_not_owner",
          intent: "message",
          work_links: { incident_id: "inc_spoof" },
        }),
        workspaceHeader,
      );
      assert.equal(res.status, 403, res.text);
      assertContractError(res.json, "unknown_agent");
    });
  } finally {
    await db.query(`DELETE FROM work_item_leases WHERE workspace_id = $1`, [WORKSPACE_ID]).catch(() => {});
    await db.end();
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
