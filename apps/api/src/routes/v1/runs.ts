import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import { newRunId, newStepId, type RunEventV1, type RunStatus } from "@agentapp/shared";

import type { DbClient, DbPool } from "../../db/pool.js";
import { appendToStream } from "../../eventStore/index.js";
import { applyRunEvent } from "../../projectors/runProjector.js";

// Keep lock namespace aligned with runtime worker to prevent duplicate start/claim races.
const RUN_LOCK_NAMESPACE = 215;
const CLAIM_LEASE_TTL_SECONDS = 30;
const CLAIM_LEASE_INTERVAL = `${CLAIM_LEASE_TTL_SECONDS} seconds`;

type RunRow = {
  run_id: string;
  workspace_id: string;
  room_id: string | null;
  thread_id: string | null;
  correlation_id: string;
  last_event_id: string | null;
  status: string;
};

type ClaimableRunRow = RunRow & {
  title: string | null;
  goal: string | null;
  input: Record<string, unknown> | null;
  tags: string[] | null;
  claim_token: string | null;
  claimed_by_actor_id: string | null;
  lease_expires_at: string | null;
  lease_heartbeat_at: string | null;
};

function getHeaderString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function workspaceIdFromReq(req: { headers: Record<string, unknown> }): string {
  const raw = getHeaderString(req.headers["x-workspace-id"] as string | string[] | undefined);
  return raw?.trim() || "ws_dev";
}

function normalizeRunStatus(raw: unknown): RunStatus | null {
  return raw === "queued" || raw === "running" || raw === "succeeded" || raw === "failed"
    ? raw
    : null;
}

async function tryAcquireRunLock(pool: DbPool, run_id: string): Promise<DbClient | null> {
  const client = await pool.connect();
  try {
    const lock = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1::int, hashtext($2)::int) AS locked",
      [RUN_LOCK_NAMESPACE, run_id],
    );
    if (lock.rows[0]?.locked) return client;
    client.release();
    return null;
  } catch (err) {
    client.release();
    throw err;
  }
}

async function releaseRunLock(client: DbClient, run_id: string): Promise<void> {
  try {
    await client.query("SELECT pg_advisory_unlock($1::int, hashtext($2)::int)", [
      RUN_LOCK_NAMESPACE,
      run_id,
    ]);
  } finally {
    client.release();
  }
}

async function listQueuedRunIds(
  pool: DbPool,
  input: { workspace_id: string; room_id?: string | null; limit: number },
): Promise<string[]> {
  const args: unknown[] = [input.workspace_id];
  let where = `workspace_id = $1 AND (
    status = 'queued'
    OR (status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < now())
  )`;
  if (input.room_id) {
    args.push(input.room_id);
    where += ` AND room_id = $${args.length}`;
  }
  args.push(input.limit);

  const res = await pool.query<{ run_id: string }>(
    `SELECT run_id
     FROM proj_runs
     WHERE ${where}
     ORDER BY
      CASE WHEN status = 'queued' THEN 0 ELSE 1 END ASC,
      created_at ASC
     LIMIT $${args.length}`,
    args,
  );
  return res.rows.map((row) => row.run_id);
}

async function assignRunLease(
  client: DbClient,
  input: { run_id: string; workspace_id: string; actor_id: string },
): Promise<{ claim_token: string; lease_expires_at: string; lease_heartbeat_at: string }> {
  const claim_token = randomUUID();
  const lease = await client.query<{
    claim_token: string;
    lease_expires_at: string;
    lease_heartbeat_at: string;
  }>(
    `UPDATE proj_runs
     SET
      claim_token = $2,
      claimed_by_actor_id = $3,
      lease_heartbeat_at = now(),
      lease_expires_at = now() + $4::interval,
      updated_at = now()
     WHERE run_id = $1
       AND workspace_id = $5
     RETURNING claim_token, lease_expires_at::text, lease_heartbeat_at::text`,
    [
      input.run_id,
      claim_token,
      input.actor_id,
      CLAIM_LEASE_INTERVAL,
      input.workspace_id,
    ],
  );
  if (lease.rowCount !== 1) {
    throw new Error("failed_to_assign_run_lease");
  }
  return lease.rows[0];
}

export async function registerRunRoutes(app: FastifyInstance, pool: DbPool): Promise<void> {
  app.post<{
    Body: {
      room_id: string;
      thread_id?: string;
      title?: string;
      goal?: string;
      input?: Record<string, unknown>;
      tags?: string[];
      correlation_id?: string;
    };
  }>("/v1/runs", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);

    const room_id = req.body.room_id?.trim();
    if (!room_id) return reply.code(400).send({ error: "missing_room_id" });

    const room = await pool.query<{ workspace_id: string }>(
      "SELECT workspace_id FROM proj_rooms WHERE room_id = $1",
      [room_id],
    );
    if (room.rowCount !== 1) {
      return reply.code(404).send({ error: "room_not_found" });
    }

    if (room.rows[0].workspace_id !== workspace_id) {
      return reply.code(404).send({ error: "room_not_found" });
    }

    const thread_id = req.body.thread_id?.trim() || undefined;
    if (thread_id) {
      const thread = await pool.query<{ room_id: string; workspace_id: string }>(
        "SELECT room_id, workspace_id FROM proj_threads WHERE thread_id = $1",
        [thread_id],
      );
      if (thread.rowCount !== 1 || thread.rows[0].room_id !== room_id) {
        return reply.code(404).send({ error: "thread_not_found" });
      }
      if (thread.rows[0].workspace_id !== workspace_id) {
        return reply.code(404).send({ error: "thread_not_found" });
      }
    }

    const run_id = newRunId();
    const occurred_at = new Date().toISOString();
    const correlation_id = req.body.correlation_id?.trim() || randomUUID();

    const event = await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "run.created",
      event_version: 1,
      occurred_at,
      workspace_id,
      room_id,
      thread_id,
      run_id,
      actor: { actor_type: "service", actor_id: "api" },
      // Room feed is the primary realtime stream: all room-scoped events go to the room stream.
      stream: { stream_type: "room", stream_id: room_id },
      correlation_id,
      data: {
        run_id,
        title: req.body.title,
        goal: req.body.goal,
        input: req.body.input,
        tags: req.body.tags,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });

    await applyRunEvent(pool, event as RunEventV1);
    return reply.code(201).send({ run_id });
  });

  app.post<{
    Body: {
      room_id?: string;
      actor_id?: string;
    };
  }>("/v1/runs/claim", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const room_id = req.body.room_id?.trim() || null;
    const actor_id = req.body.actor_id?.trim() || "external_engine";

    const candidateIds = await listQueuedRunIds(pool, {
      workspace_id,
      room_id,
      limit: 100,
    });

    for (const run_id of candidateIds) {
      const lockClient = await tryAcquireRunLock(pool, run_id);
      if (!lockClient) continue;

      try {
        const existing = await lockClient.query<ClaimableRunRow>(
          `SELECT
             run_id,
             workspace_id,
             room_id,
             thread_id,
             correlation_id,
             last_event_id,
             status,
             title,
             goal,
             input,
             tags,
             claim_token,
             claimed_by_actor_id,
             lease_expires_at::text,
             lease_heartbeat_at::text
           FROM proj_runs
           WHERE run_id = $1`,
          [run_id],
        );
        if (existing.rowCount !== 1) continue;
        const run = existing.rows[0];

        if (run.workspace_id !== workspace_id) continue;
        if (room_id && run.room_id !== room_id) continue;
        if (run.status !== "queued" && run.status !== "running") continue;
        if (run.status === "running") {
          if (!run.lease_expires_at) continue;
          if (new Date(run.lease_expires_at).getTime() >= Date.now()) continue;
        }

        if (run.status === "queued") {
          const occurred_at = new Date().toISOString();
          const causation_id = run.last_event_id ?? undefined;

          const event = await appendToStream(pool, {
            event_id: randomUUID(),
            event_type: "run.started",
            event_version: 1,
            occurred_at,
            workspace_id,
            room_id: run.room_id ?? undefined,
            thread_id: run.thread_id ?? undefined,
            run_id: run.run_id,
            actor: { actor_type: "service", actor_id },
            stream:
              run.room_id != null
                ? { stream_type: "room", stream_id: run.room_id }
                : { stream_type: "workspace", stream_id: workspace_id },
            correlation_id: run.correlation_id,
            causation_id,
            data: { run_id: run.run_id },
            policy_context: {},
            model_context: {},
            display: {},
          });

          await applyRunEvent(pool, event as RunEventV1);
        }

        const lease = await assignRunLease(lockClient, {
          run_id: run.run_id,
          workspace_id,
          actor_id,
        });
        return reply.code(200).send({
          claimed: true,
          run: {
            run_id: run.run_id,
            workspace_id: run.workspace_id,
            room_id: run.room_id,
            thread_id: run.thread_id,
            status: "running",
            title: run.title,
            goal: run.goal,
            input: run.input,
            tags: run.tags ?? [],
            correlation_id: run.correlation_id,
            claim_token: lease.claim_token,
            claimed_by_actor_id: actor_id,
            lease_expires_at: lease.lease_expires_at,
            lease_heartbeat_at: lease.lease_heartbeat_at,
          },
        });
      } finally {
        await releaseRunLock(lockClient, run_id);
      }
    }

    return reply.code(200).send({ claimed: false, run: null });
  });

  app.post<{
    Params: { runId: string };
    Body: { actor_id?: string; claim_token?: string };
  }>("/v1/runs/:runId/lease/heartbeat", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const actor_id = req.body.actor_id?.trim() || "external_engine";
    const claim_token = req.body.claim_token?.trim() || "";
    if (!claim_token) return reply.code(400).send({ error: "missing_claim_token" });

    const update = await pool.query<{
      lease_expires_at: string;
      lease_heartbeat_at: string;
    }>(
      `UPDATE proj_runs
       SET
        lease_heartbeat_at = now(),
        lease_expires_at = now() + $4::interval,
        updated_at = now()
       WHERE run_id = $1
         AND workspace_id = $2
         AND status = 'running'
         AND claim_token = $3
         AND claimed_by_actor_id = $5
         AND lease_expires_at IS NOT NULL
         AND lease_expires_at > now()
       RETURNING lease_expires_at::text, lease_heartbeat_at::text`,
      [req.params.runId, workspace_id, claim_token, CLAIM_LEASE_INTERVAL, actor_id],
    );
    if (update.rowCount === 1) {
      return reply.code(200).send({
        ok: true,
        lease_expires_at: update.rows[0].lease_expires_at,
        lease_heartbeat_at: update.rows[0].lease_heartbeat_at,
      });
    }

    const existing = await pool.query<{
      run_id: string;
      status: string;
      claim_token: string | null;
      claimed_by_actor_id: string | null;
      lease_expires_at: string | null;
    }>(
      `SELECT run_id, status, claim_token, claimed_by_actor_id, lease_expires_at::text
       FROM proj_runs
       WHERE run_id = $1
         AND workspace_id = $2`,
      [req.params.runId, workspace_id],
    );
    if (existing.rowCount !== 1) return reply.code(404).send({ error: "run_not_found" });

    const run = existing.rows[0];
    if (run.status !== "running") return reply.code(409).send({ error: "run_not_running" });
    if (run.claim_token !== claim_token || run.claimed_by_actor_id !== actor_id) {
      return reply.code(409).send({ error: "lease_token_mismatch" });
    }
    if (!run.lease_expires_at || new Date(run.lease_expires_at).getTime() <= Date.now()) {
      return reply.code(409).send({ error: "lease_expired" });
    }
    return reply.code(409).send({ error: "lease_heartbeat_conflict" });
  });

  app.post<{
    Params: { runId: string };
    Body: { actor_id?: string; claim_token?: string };
  }>("/v1/runs/:runId/lease/release", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const actor_id = req.body.actor_id?.trim() || "external_engine";
    const claim_token = req.body.claim_token?.trim() || "";
    if (!claim_token) return reply.code(400).send({ error: "missing_claim_token" });

    const released = await pool.query(
      `UPDATE proj_runs
       SET
        claim_token = NULL,
        claimed_by_actor_id = NULL,
        lease_expires_at = NULL,
        lease_heartbeat_at = NULL,
        updated_at = now()
       WHERE run_id = $1
         AND workspace_id = $2
         AND claim_token = $3
         AND claimed_by_actor_id = $4`,
      [req.params.runId, workspace_id, claim_token, actor_id],
    );
    if (released.rowCount === 1) {
      return reply.code(200).send({ ok: true, released: true });
    }

    const existing = await pool.query<{
      run_id: string;
      status: string;
      claim_token: string | null;
      claimed_by_actor_id: string | null;
    }>(
      `SELECT run_id, status, claim_token, claimed_by_actor_id
       FROM proj_runs
       WHERE run_id = $1
         AND workspace_id = $2`,
      [req.params.runId, workspace_id],
    );
    if (existing.rowCount !== 1) return reply.code(404).send({ error: "run_not_found" });

    const run = existing.rows[0];
    if (!run.claim_token && !run.claimed_by_actor_id) {
      return reply.code(200).send({ ok: true, released: false });
    }
    if (run.claim_token !== claim_token || run.claimed_by_actor_id !== actor_id) {
      return reply.code(409).send({ error: "lease_token_mismatch" });
    }
    return reply.code(200).send({ ok: true, released: false });
  });

  app.post<{
    Params: { runId: string };
  }>("/v1/runs/:runId/start", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const lockClient = await tryAcquireRunLock(pool, req.params.runId);
    if (!lockClient) {
      return reply.code(409).send({ error: "run_locked" });
    }

    try {
      const existing = await lockClient.query<RunRow>(
        "SELECT run_id, workspace_id, room_id, thread_id, correlation_id, last_event_id, status FROM proj_runs WHERE run_id = $1",
        [req.params.runId],
      );
      if (existing.rowCount !== 1 || existing.rows[0].workspace_id !== workspace_id) {
        return reply.code(404).send({ error: "run_not_found" });
      }

      if (existing.rows[0].status !== "queued") {
        return reply.code(409).send({ error: "run_not_queued" });
      }

      const occurred_at = new Date().toISOString();
      const causation_id = existing.rows[0].last_event_id ?? undefined;

      const event = await appendToStream(pool, {
        event_id: randomUUID(),
        event_type: "run.started",
        event_version: 1,
        occurred_at,
        workspace_id,
        room_id: existing.rows[0].room_id ?? undefined,
        thread_id: existing.rows[0].thread_id ?? undefined,
        run_id: existing.rows[0].run_id,
        actor: { actor_type: "service", actor_id: "api" },
        stream:
          existing.rows[0].room_id != null
            ? { stream_type: "room", stream_id: existing.rows[0].room_id }
            : { stream_type: "workspace", stream_id: workspace_id },
        correlation_id: existing.rows[0].correlation_id,
        causation_id,
        data: { run_id: existing.rows[0].run_id },
        policy_context: {},
        model_context: {},
        display: {},
      });

      await applyRunEvent(pool, event as RunEventV1);
      return reply.code(200).send({ ok: true });
    } finally {
      await releaseRunLock(lockClient, req.params.runId);
    }
  });

  app.post<{
    Params: { runId: string };
    Body: { summary?: string; output?: Record<string, unknown> };
  }>("/v1/runs/:runId/complete", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);

    const existing = await pool.query<{
      run_id: string;
      workspace_id: string;
      room_id: string | null;
      thread_id: string | null;
      correlation_id: string;
      last_event_id: string | null;
      status: string;
    }>(
      "SELECT run_id, workspace_id, room_id, thread_id, correlation_id, last_event_id, status FROM proj_runs WHERE run_id = $1",
      [req.params.runId],
    );
    if (existing.rowCount !== 1 || existing.rows[0].workspace_id !== workspace_id) {
      return reply.code(404).send({ error: "run_not_found" });
    }

    if (existing.rows[0].status === "succeeded" || existing.rows[0].status === "failed") {
      return reply.code(409).send({ error: "run_already_ended" });
    }

    const occurred_at = new Date().toISOString();
    const causation_id = existing.rows[0].last_event_id ?? undefined;

    const event = await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "run.completed",
      event_version: 1,
      occurred_at,
      workspace_id,
      room_id: existing.rows[0].room_id ?? undefined,
      thread_id: existing.rows[0].thread_id ?? undefined,
      run_id: existing.rows[0].run_id,
      actor: { actor_type: "service", actor_id: "api" },
      stream:
        existing.rows[0].room_id != null
          ? { stream_type: "room", stream_id: existing.rows[0].room_id }
          : { stream_type: "workspace", stream_id: workspace_id },
      correlation_id: existing.rows[0].correlation_id,
      causation_id,
      data: {
        run_id: existing.rows[0].run_id,
        summary: req.body.summary,
        output: req.body.output,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });

    await applyRunEvent(pool, event as RunEventV1);
    return reply.code(200).send({ ok: true });
  });

  app.post<{
    Params: { runId: string };
    Body: { message?: string; error?: Record<string, unknown> };
  }>("/v1/runs/:runId/fail", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);

    const existing = await pool.query<{
      run_id: string;
      workspace_id: string;
      room_id: string | null;
      thread_id: string | null;
      correlation_id: string;
      last_event_id: string | null;
      status: string;
    }>(
      "SELECT run_id, workspace_id, room_id, thread_id, correlation_id, last_event_id, status FROM proj_runs WHERE run_id = $1",
      [req.params.runId],
    );
    if (existing.rowCount !== 1 || existing.rows[0].workspace_id !== workspace_id) {
      return reply.code(404).send({ error: "run_not_found" });
    }

    if (existing.rows[0].status === "succeeded" || existing.rows[0].status === "failed") {
      return reply.code(409).send({ error: "run_already_ended" });
    }

    const occurred_at = new Date().toISOString();
    const causation_id = existing.rows[0].last_event_id ?? undefined;

    const event = await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "run.failed",
      event_version: 1,
      occurred_at,
      workspace_id,
      room_id: existing.rows[0].room_id ?? undefined,
      thread_id: existing.rows[0].thread_id ?? undefined,
      run_id: existing.rows[0].run_id,
      actor: { actor_type: "service", actor_id: "api" },
      stream:
        existing.rows[0].room_id != null
          ? { stream_type: "room", stream_id: existing.rows[0].room_id }
          : { stream_type: "workspace", stream_id: workspace_id },
      correlation_id: existing.rows[0].correlation_id,
      causation_id,
      data: {
        run_id: existing.rows[0].run_id,
        message: req.body.message,
        error: req.body.error,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });

    await applyRunEvent(pool, event as RunEventV1);
    return reply.code(200).send({ ok: true });
  });

  app.post<{
    Params: { runId: string };
    Body: { kind: string; title?: string; input?: Record<string, unknown> };
  }>("/v1/runs/:runId/steps", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);

    if (!req.body.kind?.trim()) {
      return reply.code(400).send({ error: "missing_kind" });
    }

    const existing = await pool.query<{
      run_id: string;
      workspace_id: string;
      room_id: string | null;
      thread_id: string | null;
      correlation_id: string;
      last_event_id: string | null;
      status: string;
    }>(
      "SELECT run_id, workspace_id, room_id, thread_id, correlation_id, last_event_id, status FROM proj_runs WHERE run_id = $1",
      [req.params.runId],
    );
    if (existing.rowCount !== 1 || existing.rows[0].workspace_id !== workspace_id) {
      return reply.code(404).send({ error: "run_not_found" });
    }

    if (existing.rows[0].status !== "running") {
      return reply.code(409).send({ error: "run_not_running" });
    }

    const step_id = newStepId();
    const occurred_at = new Date().toISOString();
    const causation_id = existing.rows[0].last_event_id ?? undefined;

    const event = await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "step.created",
      event_version: 1,
      occurred_at,
      workspace_id,
      room_id: existing.rows[0].room_id ?? undefined,
      thread_id: existing.rows[0].thread_id ?? undefined,
      run_id: existing.rows[0].run_id,
      step_id,
      actor: { actor_type: "service", actor_id: "api" },
      stream:
        existing.rows[0].room_id != null
          ? { stream_type: "room", stream_id: existing.rows[0].room_id }
          : { stream_type: "workspace", stream_id: workspace_id },
      correlation_id: existing.rows[0].correlation_id,
      causation_id,
      data: {
        step_id,
        kind: req.body.kind,
        title: req.body.title,
        input: req.body.input,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });

    await applyRunEvent(pool, event as RunEventV1);
    return reply.code(201).send({ step_id });
  });

  app.get<{
    Querystring: { room_id?: string; status?: string; limit?: string };
  }>("/v1/runs", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);

    const room_id = req.query.room_id?.trim() || null;
    const status = normalizeRunStatus(req.query.status);
    if (req.query.status && !status) {
      return reply.code(400).send({ error: "invalid_status" });
    }

    const rawLimit = Number(req.query.limit ?? "50");
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, rawLimit)) : 50;

    const args: unknown[] = [workspace_id];
    let where = "workspace_id = $1";

    if (room_id) {
      args.push(room_id);
      where += ` AND room_id = $${args.length}`;
    }
    if (status) {
      args.push(status);
      where += ` AND status = $${args.length}`;
    }

    args.push(limit);

    const res = await pool.query(
      `SELECT
        run_id,
        workspace_id, room_id, thread_id,
        status,
        title, goal, input, output, error, tags,
        claim_token, claimed_by_actor_id, lease_expires_at, lease_heartbeat_at,
        created_at, started_at, ended_at, updated_at,
        correlation_id, last_event_id
      FROM proj_runs
      WHERE ${where}
      ORDER BY updated_at DESC
      LIMIT $${args.length}`,
      args,
    );

    return reply.code(200).send({ runs: res.rows });
  });

  app.get<{
    Params: { runId: string };
  }>("/v1/runs/:runId", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);

    const res = await pool.query(
      `SELECT
        run_id,
        workspace_id, room_id, thread_id,
        status,
        title, goal, input, output, error, tags,
        claim_token, claimed_by_actor_id, lease_expires_at, lease_heartbeat_at,
        created_at, started_at, ended_at, updated_at,
        correlation_id, last_event_id
      FROM proj_runs
      WHERE run_id = $1
        AND workspace_id = $2`,
      [req.params.runId, workspace_id],
    );
    if (res.rowCount !== 1) {
      return reply.code(404).send({ error: "run_not_found" });
    }
    return reply.code(200).send({ run: res.rows[0] });
  });

  app.get<{
    Params: { runId: string };
  }>("/v1/runs/:runId/steps", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);

    const run = await pool.query<{ workspace_id: string }>(
      "SELECT workspace_id FROM proj_runs WHERE run_id = $1",
      [req.params.runId],
    );
    if (run.rowCount !== 1 || run.rows[0].workspace_id !== workspace_id) {
      return reply.code(404).send({ error: "run_not_found" });
    }

    const res = await pool.query(
      `SELECT
        step_id,
        run_id, workspace_id, room_id, thread_id,
        kind, status,
        title, input, output, error,
        created_at, updated_at,
        last_event_id
      FROM proj_steps
      WHERE run_id = $1
      ORDER BY created_at ASC`,
      [req.params.runId],
    );
    return reply.code(200).send({ steps: res.rows });
  });
}
