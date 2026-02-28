import { randomUUID } from "node:crypto";

import {
  newEvidenceId,
  type ActorType,
  type EvidenceEventV1,
  type EvidenceManifestRecordV1,
  type EvidenceManifestV1,
  type RunId,
  type StepId,
  type ToolCallId,
  type ArtifactId,
} from "@agentapp/shared";

import type { DbPool } from "../db/pool.js";
import { appendToStream } from "../eventStore/index.js";
import { applyEvidenceEvent } from "../projectors/evidenceProjector.js";
import { sha256Hex, stableStringify } from "../security/hashChain.js";

type RunTerminalRow = {
  run_id: string;
  workspace_id: string;
  room_id: string | null;
  thread_id: string | null;
  correlation_id: string;
  status: string;
};

type RunEventPointerRow = {
  event_id: string;
  event_type: string;
  occurred_at: string;
  stream_seq: string;
  event_hash: string | null;
};

type EvidenceManifestRow = {
  evidence_id: string;
  workspace_id: string;
  run_id: string;
  room_id: string | null;
  thread_id: string | null;
  correlation_id: string;
  run_status: "succeeded" | "failed";
  manifest: EvidenceManifestV1;
  manifest_hash: string;
  event_hash_root: string;
  stream_type: "room" | "workspace";
  stream_id: string;
  from_seq: string;
  to_seq: string;
  event_count: number;
  finalized_at: string;
  created_at: string;
  updated_at: string;
  last_event_id: string;
};

type ExistingEvidenceManifestEventRow = {
  event_id: string;
  event_version: number;
  occurred_at: string;
  workspace_id: string;
  room_id: string | null;
  thread_id: string | null;
  run_id: string | null;
  actor_type: ActorType;
  actor_id: string;
  stream_type: "room" | "workspace";
  stream_id: string;
  correlation_id: string;
  causation_id: string | null;
  data: Record<string, unknown> | null;
};

export class EvidenceManifestError extends Error {
  constructor(
    public readonly code: "run_not_found" | "run_not_ended" | "run_events_missing",
    public readonly statusCode: number,
  ) {
    super(code);
  }
}

function toRecord(row: EvidenceManifestRow): EvidenceManifestRecordV1 {
  return {
    evidence_id: row.evidence_id as EvidenceManifestRecordV1["evidence_id"],
    workspace_id: row.workspace_id,
    run_id: row.run_id as EvidenceManifestRecordV1["run_id"],
    room_id: row.room_id,
    thread_id: row.thread_id,
    correlation_id: row.correlation_id,
    run_status: row.run_status,
    manifest: row.manifest,
    manifest_hash: row.manifest_hash,
    event_hash_root: row.event_hash_root,
    stream_type: row.stream_type,
    stream_id: row.stream_id,
    from_seq: Number(row.from_seq),
    to_seq: Number(row.to_seq),
    event_count: row.event_count,
    finalized_at: row.finalized_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_event_id: row.last_event_id,
  };
}

function isUniqueViolation(err: unknown): err is Error & { code: string; constraint?: string } {
  return Boolean(err && typeof err === "object" && (err as { code?: string }).code === "23505");
}

async function findManifestCreatedEventByRunId(
  pool: DbPool,
  input: { workspace_id: string; run_id: string },
): Promise<EvidenceEventV1 | null> {
  const res = await pool.query<ExistingEvidenceManifestEventRow>(
    `SELECT
       event_id,
       event_version,
       occurred_at::text AS occurred_at,
       workspace_id,
       room_id,
       thread_id,
       run_id,
       actor_type,
       actor_id,
       stream_type,
       stream_id,
       correlation_id,
       causation_id,
       data
     FROM evt_events
     WHERE workspace_id = $1
       AND run_id = $2
       AND event_type = 'evidence.manifest.created'
     ORDER BY occurred_at DESC, stream_seq DESC
     LIMIT 1`,
    [input.workspace_id, input.run_id],
  );
  if (res.rowCount !== 1) return null;

  const row = res.rows[0];
  if (!row.data || typeof row.data !== "object") return null;

  return {
    event_id: row.event_id,
    event_type: "evidence.manifest.created",
    event_version: row.event_version,
    occurred_at: row.occurred_at,
    workspace_id: row.workspace_id,
    room_id: row.room_id ?? undefined,
    thread_id: row.thread_id ?? undefined,
    run_id: row.run_id ?? undefined,
    actor: {
      actor_type: row.actor_type,
      actor_id: row.actor_id,
    },
    stream: {
      stream_type: row.stream_type,
      stream_id: row.stream_id,
    },
    correlation_id: row.correlation_id,
    causation_id: row.causation_id ?? undefined,
    data: row.data,
    policy_context: {},
    model_context: {},
    display: {},
  } as unknown as EvidenceEventV1;
}

export async function getEvidenceManifestByRunId(
  pool: DbPool,
  input: { workspace_id: string; run_id: string },
): Promise<EvidenceManifestRecordV1 | null> {
  const existing = await pool.query<EvidenceManifestRow>(
    `SELECT
       evidence_id,
       workspace_id,
       run_id,
       room_id,
       thread_id,
       correlation_id,
       run_status,
       manifest,
       manifest_hash,
       event_hash_root,
       stream_type,
       stream_id,
       from_seq::text,
       to_seq::text,
       event_count,
       finalized_at::text,
       created_at::text,
       updated_at::text,
       last_event_id
     FROM proj_evidence_manifests
     WHERE workspace_id = $1
       AND run_id = $2`,
    [input.workspace_id, input.run_id],
  );
  if (existing.rowCount !== 1) return null;
  return toRecord(existing.rows[0]);
}

export async function finalizeRunEvidenceManifest(
  pool: DbPool,
  input: {
    workspace_id: string;
    run_id: string;
    actor?: { actor_type: ActorType; actor_id: string };
    actor_principal_id?: string;
    correlation_id?: string;
  },
): Promise<{ created: boolean; evidence: EvidenceManifestRecordV1 }> {
  const existing = await getEvidenceManifestByRunId(pool, {
    workspace_id: input.workspace_id,
    run_id: input.run_id,
  });
  if (existing) {
    return { created: false, evidence: existing };
  }

  const run = await pool.query<RunTerminalRow>(
    `SELECT
       run_id,
       workspace_id,
       room_id,
       thread_id,
       correlation_id,
       status
     FROM proj_runs
     WHERE workspace_id = $1
       AND run_id = $2`,
    [input.workspace_id, input.run_id],
  );
  if (run.rowCount !== 1) {
    throw new EvidenceManifestError("run_not_found", 404);
  }

  const runRow = run.rows[0];
  if (runRow.status !== "succeeded" && runRow.status !== "failed") {
    throw new EvidenceManifestError("run_not_ended", 409);
  }

  const stream_type = (runRow.room_id ? "room" : "workspace") as "room" | "workspace";
  const stream_id = runRow.room_id ?? runRow.workspace_id;

  const events = await pool.query<RunEventPointerRow>(
    `SELECT
       event_id,
       event_type,
       occurred_at::text,
       stream_seq::text,
       event_hash
     FROM evt_events
     WHERE workspace_id = $1
       AND run_id = $2
       AND stream_type = $3
       AND stream_id = $4
     ORDER BY stream_seq ASC`,
    [runRow.workspace_id, runRow.run_id, stream_type, stream_id],
  );
  if (events.rowCount === 0) {
    throw new EvidenceManifestError("run_events_missing", 500);
  }

  const stepRows = await pool.query<{ step_id: string }>(
    `SELECT step_id
     FROM proj_steps
     WHERE run_id = $1
     ORDER BY created_at ASC`,
    [runRow.run_id],
  );
  const toolRows = await pool.query<{ tool_call_id: string; status: string }>(
    `SELECT tool_call_id, status
     FROM proj_tool_calls
     WHERE run_id = $1
     ORDER BY started_at ASC`,
    [runRow.run_id],
  );
  const artifactRows = await pool.query<{ artifact_id: string }>(
    `SELECT artifact_id
     FROM proj_artifacts
     WHERE run_id = $1
     ORDER BY created_at ASC`,
    [runRow.run_id],
  );

  const eventPointers = events.rows.map((row) => ({
    event_id: row.event_id,
    event_type: row.event_type,
    occurred_at: row.occurred_at,
    stream_seq: Number(row.stream_seq),
    event_hash: row.event_hash ?? "sha256:missing",
  }));

  const from_seq = eventPointers[0].stream_seq;
  const to_seq = eventPointers[eventPointers.length - 1].stream_seq;
  const event_hash_root = `sha256:${sha256Hex(eventPointers.map((row) => row.event_hash).join("\n"))}`;
  const evidence_id = newEvidenceId();
  const finalized_at = new Date().toISOString();
  const manifest: EvidenceManifestV1 = {
    schema_version: 1,
    evidence_id,
    workspace_id: runRow.workspace_id,
    run_id: runRow.run_id as RunId,
    room_id: runRow.room_id,
    thread_id: runRow.thread_id,
    correlation_id: runRow.correlation_id,
    run_status: runRow.status as "succeeded" | "failed",
    stream_window: {
      stream_type,
      stream_id,
      from_seq,
      to_seq,
      event_count: eventPointers.length,
    },
    pointers: {
      step_ids: stepRows.rows.map((row) => row.step_id as StepId),
      tool_call_ids: toolRows.rows.map((row) => row.tool_call_id as ToolCallId),
      artifact_ids: artifactRows.rows.map((row) => row.artifact_id as ArtifactId),
      events: eventPointers,
    },
    completeness: {
      terminal_event_present: eventPointers.some(
        (row) => row.event_type === "run.completed" || row.event_type === "run.failed",
      ),
      all_toolcalls_terminal: toolRows.rows.every(
        (row) => row.status === "succeeded" || row.status === "failed",
      ),
      artifact_count: artifactRows.rowCount ?? 0,
    },
    generated_at: finalized_at,
  };
  const manifest_hash = `sha256:${sha256Hex(stableStringify(manifest))}`;

  try {
    const event = await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "evidence.manifest.created",
      event_version: 1,
      occurred_at: finalized_at,
      workspace_id: runRow.workspace_id,
      room_id: runRow.room_id ?? undefined,
      thread_id: runRow.thread_id ?? undefined,
      run_id: runRow.run_id,
      actor: input.actor ?? { actor_type: "service", actor_id: "api" },
      actor_principal_id: input.actor_principal_id,
      stream: { stream_type, stream_id },
      correlation_id: input.correlation_id ?? runRow.correlation_id ?? randomUUID(),
      idempotency_key: `evidence_manifest:${runRow.run_id}`,
      data: {
        evidence_id,
        run_id: runRow.run_id,
        room_id: runRow.room_id ?? undefined,
        thread_id: runRow.thread_id ?? undefined,
        correlation_id: runRow.correlation_id,
        run_status: runRow.status,
        manifest,
        manifest_hash,
        event_hash_root,
        stream_type,
        stream_id,
        from_seq,
        to_seq,
        event_count: eventPointers.length,
        finalized_at,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });
    await applyEvidenceEvent(pool, event as EvidenceEventV1);
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const existingEvent = await findManifestCreatedEventByRunId(pool, {
      workspace_id: input.workspace_id,
      run_id: input.run_id,
    });
    if (existingEvent) {
      await applyEvidenceEvent(pool, existingEvent);
    }
  }

  const persisted = await getEvidenceManifestByRunId(pool, {
    workspace_id: input.workspace_id,
    run_id: input.run_id,
  });
  if (!persisted) {
    throw new Error("evidence_manifest_persist_failed");
  }
  return { created: persisted.evidence_id === evidence_id, evidence: persisted };
}
