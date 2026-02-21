import { randomUUID } from "node:crypto";

import { newStepId, newToolCallId, type RunEventV1, type ToolEventV1 } from "@agentapp/shared";

import type { DbClient, DbPool } from "../db/pool.js";
import { appendToStream } from "../eventStore/index.js";
import { applyRunEvent } from "../projectors/runProjector.js";
import { applyToolEvent } from "../projectors/toolProjector.js";

const RUN_WORKER_LOCK_NAMESPACE = 215;
const DEFAULT_BATCH_LIMIT = 5;
const MAX_BATCH_LIMIT = 100;

type WorkerLogger = Pick<Console, "info" | "warn" | "error">;

type QueuedRunRow = {
  run_id: string;
  workspace_id: string;
  room_id: string | null;
  thread_id: string | null;
  correlation_id: string;
  last_event_id: string | null;
  status: string;
};

type StreamRef = { stream_type: "room" | "workspace"; stream_id: string };

type ProcessRunResult = "completed" | "failed" | "skipped";

export interface RunWorkerOptions {
  workspace_id?: string;
  batch_limit?: number;
  logger?: WorkerLogger;
}

export interface RunWorkerCycleResult {
  workspace_id?: string;
  scanned: number;
  claimed: number;
  completed: number;
  failed: number;
  skipped: number;
}

function normalizeBatchLimit(raw: number | undefined): number {
  if (!Number.isFinite(raw)) return DEFAULT_BATCH_LIMIT;
  const clamped = Math.floor(raw as number);
  return Math.max(1, Math.min(MAX_BATCH_LIMIT, clamped));
}

function streamForRun(row: QueuedRunRow): StreamRef {
  if (row.room_id) {
    return { stream_type: "room", stream_id: row.room_id };
  }
  return { stream_type: "workspace", stream_id: row.workspace_id };
}

function runActor() {
  return { actor_type: "service" as const, actor_id: "run_worker" };
}

async function listQueuedRunIds(
  pool: DbPool,
  input: { workspace_id?: string; limit: number },
): Promise<string[]> {
  const args: unknown[] = [];
  let where = "status = 'queued'";
  if (input.workspace_id) {
    args.push(input.workspace_id);
    where += ` AND workspace_id = $${args.length}`;
  }
  args.push(input.limit);

  const res = await pool.query<{ run_id: string }>(
    `SELECT run_id
     FROM proj_runs
     WHERE ${where}
     ORDER BY created_at ASC
     LIMIT $${args.length}`,
    args,
  );
  return res.rows.map((r) => r.run_id);
}

async function tryAcquireRunLock(pool: DbPool, run_id: string): Promise<DbClient | null> {
  const client = await pool.connect();
  try {
    const lock = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1::int, hashtext($2)::int) AS locked",
      [RUN_WORKER_LOCK_NAMESPACE, run_id],
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
      RUN_WORKER_LOCK_NAMESPACE,
      run_id,
    ]);
  } finally {
    client.release();
  }
}

async function loadRun(pool: DbPool, run_id: string): Promise<QueuedRunRow | null> {
  const res = await pool.query<QueuedRunRow>(
    `SELECT
       run_id,
       workspace_id,
       room_id,
       thread_id,
       correlation_id,
       last_event_id,
       status
     FROM proj_runs
     WHERE run_id = $1`,
    [run_id],
  );
  if (res.rowCount !== 1) return null;
  return res.rows[0];
}

async function appendRunStarted(pool: DbPool, run: QueuedRunRow): Promise<RunEventV1 & { event_id: string }> {
  const occurred_at = new Date().toISOString();
  const stream = streamForRun(run);
  const event = await appendToStream(pool, {
    event_id: randomUUID(),
    event_type: "run.started",
    event_version: 1,
    occurred_at,
    workspace_id: run.workspace_id,
    room_id: run.room_id ?? undefined,
    thread_id: run.thread_id ?? undefined,
    run_id: run.run_id,
    actor: runActor(),
    zone: "sandbox",
    stream,
    correlation_id: run.correlation_id,
    causation_id: run.last_event_id ?? undefined,
    data: { run_id: run.run_id },
    policy_context: {},
    model_context: {},
    display: {},
  });
  await applyRunEvent(pool, event as RunEventV1);
  return event as RunEventV1 & { event_id: string };
}

async function appendStepCreated(
  pool: DbPool,
  run: QueuedRunRow,
  causation_id: string,
): Promise<{ step_id: string; event_id: string }> {
  const step_id = newStepId();
  const occurred_at = new Date().toISOString();
  const stream = streamForRun(run);
  const event = await appendToStream(pool, {
    event_id: randomUUID(),
    event_type: "step.created",
    event_version: 1,
    occurred_at,
    workspace_id: run.workspace_id,
    room_id: run.room_id ?? undefined,
    thread_id: run.thread_id ?? undefined,
    run_id: run.run_id,
    step_id,
    actor: runActor(),
    zone: "sandbox",
    stream,
    correlation_id: run.correlation_id,
    causation_id,
    data: {
      step_id,
      kind: "runtime",
      title: "Runtime worker step",
      input: {
        source: "run_worker",
      },
    },
    policy_context: {},
    model_context: {},
    display: {},
  });
  await applyRunEvent(pool, event as RunEventV1);
  return { step_id, event_id: event.event_id };
}

async function appendRuntimeTool(
  pool: DbPool,
  run: QueuedRunRow,
  step_id: string,
  causation_id: string,
): Promise<{ tool_call_id: string; event_id: string }> {
  const tool_call_id = newToolCallId();
  const stream = streamForRun(run);

  const invoked = await appendToStream(pool, {
    event_id: randomUUID(),
    event_type: "tool.invoked",
    event_version: 1,
    occurred_at: new Date().toISOString(),
    workspace_id: run.workspace_id,
    room_id: run.room_id ?? undefined,
    thread_id: run.thread_id ?? undefined,
    run_id: run.run_id,
    step_id,
    actor: runActor(),
    zone: "sandbox",
    stream,
    correlation_id: run.correlation_id,
    causation_id,
    data: {
      tool_call_id,
      tool_name: "runtime.noop",
      title: "Runtime noop tool",
      input: {
        source: "run_worker",
      },
    },
    policy_context: {},
    model_context: {},
    display: {},
  });
  await applyToolEvent(pool, invoked as ToolEventV1);

  const succeeded = await appendToStream(pool, {
    event_id: randomUUID(),
    event_type: "tool.succeeded",
    event_version: 1,
    occurred_at: new Date().toISOString(),
    workspace_id: run.workspace_id,
    room_id: run.room_id ?? undefined,
    thread_id: run.thread_id ?? undefined,
    run_id: run.run_id,
    step_id,
    actor: runActor(),
    zone: "sandbox",
    stream,
    correlation_id: run.correlation_id,
    causation_id: invoked.event_id,
    data: {
      tool_call_id,
      output: {
        ok: true,
        source: "run_worker",
      },
    },
    policy_context: {},
    model_context: {},
    display: {},
  });
  await applyToolEvent(pool, succeeded as ToolEventV1);
  return { tool_call_id, event_id: succeeded.event_id };
}

async function appendRunCompleted(
  pool: DbPool,
  run: QueuedRunRow,
  input: { step_id: string; tool_call_id: string; causation_id: string },
): Promise<void> {
  const stream = streamForRun(run);
  const event = await appendToStream(pool, {
    event_id: randomUUID(),
    event_type: "run.completed",
    event_version: 1,
    occurred_at: new Date().toISOString(),
    workspace_id: run.workspace_id,
    room_id: run.room_id ?? undefined,
    thread_id: run.thread_id ?? undefined,
    run_id: run.run_id,
    actor: runActor(),
    zone: "sandbox",
    stream,
    correlation_id: run.correlation_id,
    causation_id: input.causation_id,
    data: {
      run_id: run.run_id,
      summary: "Completed by local runtime worker",
      output: {
        source: "run_worker",
        automated: true,
        step_id: input.step_id,
        tool_call_id: input.tool_call_id,
      },
    },
    policy_context: {},
    model_context: {},
    display: {},
  });
  await applyRunEvent(pool, event as RunEventV1);
}

async function appendRunFailed(
  pool: DbPool,
  run: QueuedRunRow,
  input: { causation_id?: string; message: string },
): Promise<void> {
  const latest = await loadRun(pool, run.run_id);
  if (!latest) return;
  if (latest.status === "succeeded" || latest.status === "failed") return;

  const stream = streamForRun(latest);
  const event = await appendToStream(pool, {
    event_id: randomUUID(),
    event_type: "run.failed",
    event_version: 1,
    occurred_at: new Date().toISOString(),
    workspace_id: latest.workspace_id,
    room_id: latest.room_id ?? undefined,
    thread_id: latest.thread_id ?? undefined,
    run_id: latest.run_id,
    actor: runActor(),
    zone: "sandbox",
    stream,
    correlation_id: latest.correlation_id,
    causation_id: input.causation_id ?? latest.last_event_id ?? undefined,
    data: {
      run_id: latest.run_id,
      message: input.message,
      error: {
        source: "run_worker",
      },
    },
    policy_context: {},
    model_context: {},
    display: {},
  });
  await applyRunEvent(pool, event as RunEventV1);
}

async function processRun(pool: DbPool, run: QueuedRunRow, logger: WorkerLogger): Promise<ProcessRunResult> {
  if (run.status !== "queued") return "skipped";

  let lastEventId: string | undefined = run.last_event_id ?? undefined;
  let started = false;
  try {
    const startedEvent = await appendRunStarted(pool, run);
    started = true;
    lastEventId = startedEvent.event_id;

    const step = await appendStepCreated(pool, run, lastEventId);
    lastEventId = step.event_id;

    const tool = await appendRuntimeTool(pool, run, step.step_id, lastEventId);
    lastEventId = tool.event_id;

    await appendRunCompleted(pool, run, {
      step_id: step.step_id,
      tool_call_id: tool.tool_call_id,
      causation_id: lastEventId,
    });

    return "completed";
  } catch (err) {
    const message = err instanceof Error ? err.message : "run_worker_execution_failed";
    logger.warn(`[run_worker] failed run ${run.run_id}: ${message}`);
    if (started) {
      try {
        await appendRunFailed(pool, run, {
          causation_id: lastEventId,
          message,
        });
      } catch (failErr) {
        logger.error(
          `[run_worker] failed to append run.failed for ${run.run_id}: ${
            failErr instanceof Error ? failErr.message : String(failErr)
          }`,
        );
      }
    }
    return "failed";
  }
}

export async function runQueuedRunsWorker(
  pool: DbPool,
  options: RunWorkerOptions = {},
): Promise<RunWorkerCycleResult> {
  const logger = options.logger ?? console;
  const batch_limit = normalizeBatchLimit(options.batch_limit);
  const result: RunWorkerCycleResult = {
    workspace_id: options.workspace_id,
    scanned: 0,
    claimed: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
  };

  while (result.claimed < batch_limit) {
    const remaining = batch_limit - result.claimed;
    const candidates = await listQueuedRunIds(pool, {
      workspace_id: options.workspace_id,
      limit: remaining * 4,
    });
    if (candidates.length === 0) break;

    let progressed = false;
    for (const run_id of candidates) {
      if (result.claimed >= batch_limit) break;
      result.scanned += 1;

      const lockClient = await tryAcquireRunLock(pool, run_id);
      if (!lockClient) continue;
      progressed = true;

      try {
        const run = await loadRun(pool, run_id);
        if (!run || run.status !== "queued") {
          result.skipped += 1;
          continue;
        }
        if (options.workspace_id && run.workspace_id !== options.workspace_id) {
          result.skipped += 1;
          continue;
        }

        result.claimed += 1;
        const processed = await processRun(pool, run, logger);
        if (processed === "completed") result.completed += 1;
        else if (processed === "failed") result.failed += 1;
        else result.skipped += 1;
      } finally {
        await releaseRunLock(lockClient, run_id);
      }
    }

    if (!progressed) break;
  }

  return result;
}
