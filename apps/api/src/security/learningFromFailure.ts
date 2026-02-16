import { randomUUID } from "node:crypto";

import { PolicyDecision, type ActorType, type Zone } from "@agentapp/shared";

import type { DbPool } from "../db/pool.js";
import { appendToStream } from "../eventStore/index.js";
import { scanForSecrets } from "./dlp.js";
import { sha256Hex, stableStringify } from "./hashChain.js";

export type LearningFailureCategory = "tool_call" | "data_access" | "action" | "egress";
type ConstraintCategory = "tool" | "data" | "action" | "egress";

interface LearningSubject {
  subject_key: string;
  principal_id: string | null;
  agent_id: string | null;
}

export interface LearningFromFailureInput {
  category: LearningFailureCategory;
  action: string;
  actor: { actor_type: ActorType; actor_id: string };
  workspace_id: string;
  room_id?: string;
  thread_id?: string;
  run_id?: string;
  step_id?: string;
  principal_id?: string;
  zone?: Zone;
  context?: Record<string, unknown>;
  decision: PolicyDecision;
  reason_code: string;
  reason?: string;
  enforcement_mode: "shadow" | "enforce";
  blocked: boolean;
  capability_token_id?: string;
  policy_event_id: string;
  correlation_id: string;
  occurred_at?: string;
}

const SENSITIVE_KEY_RE = /(secret|token|password|api[_-]?key|authorization|cookie|bearer|private[_-]?key)/i;
const MAX_DEPTH = 3;
const MAX_KEYS = 24;
const MAX_ARRAY = 12;
const MAX_TEXT = 240;

function newConstraintId(): string {
  return `cst_${randomUUID().replace(/-/g, "")}`;
}

function mapConstraintCategory(category: LearningFailureCategory): ConstraintCategory {
  switch (category) {
    case "tool_call":
      return "tool";
    case "data_access":
      return "data";
    case "egress":
      return "egress";
    default:
      return "action";
  }
}

function truncateText(value: string): string {
  if (value.length <= MAX_TEXT) return value;
  return `${value.slice(0, MAX_TEXT)}...`;
}

function sanitizeUnknown(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (depth >= MAX_DEPTH) return "[TRUNCATED]";

  if (typeof value === "string") {
    const text = truncateText(value);
    return scanForSecrets(text).contains_secrets ? "[REDACTED_SECRET]" : text;
  }

  if (typeof value === "number" || typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((entry) => sanitizeUnknown(entry, depth + 1));
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    let seen = 0;
    for (const [k, v] of Object.entries(obj)) {
      if (seen >= MAX_KEYS) break;
      out[k] = SENSITIVE_KEY_RE.test(k) ? "[REDACTED]" : sanitizeUnknown(v, depth + 1);
      seen += 1;
    }
    return out;
  }

  return String(value);
}

function buildGuidance(input: {
  category: ConstraintCategory;
  action: string;
  reason_code: string;
  blocked: boolean;
}): string {
  if (input.reason_code === "kill_switch_active") {
    return "Kill-switch is active. Use internal/sandbox operations or disable the kill-switch intentionally.";
  }
  if (input.reason_code === "external_write_requires_approval") {
    return "Request approval before external writes, or switch to an internal/read-only alternative.";
  }
  if (input.blocked) {
    return `Action "${input.action}" was blocked by policy. Try a lower-risk ${input.category} alternative first.`;
  }
  return `Action "${input.action}" requires policy handling. Add explicit approval/scope before retrying.`;
}

async function resolveLearningSubject(
  pool: DbPool,
  actor: { actor_type: ActorType; actor_id: string },
  principalCandidate: string | undefined,
): Promise<LearningSubject> {
  let principal_id: string | null = null;
  let agent_id: string | null = null;

  const candidate = principalCandidate?.trim();
  if (candidate) {
    const principal = await pool.query<{ principal_id: string }>(
      `SELECT principal_id
       FROM sec_principals
       WHERE principal_id = $1`,
      [candidate],
    );
    if (principal.rowCount === 1) {
      principal_id = candidate;
      const linkedAgent = await pool.query<{ agent_id: string }>(
        `SELECT agent_id
         FROM sec_agents
         WHERE principal_id = $1
         LIMIT 1`,
        [candidate],
      );
      if (linkedAgent.rowCount === 1) {
        agent_id = linkedAgent.rows[0].agent_id;
      }
    }
  }

  const subject_key = agent_id
    ? `agent:${agent_id}`
    : principal_id
      ? `principal:${principal_id}`
      : `actor:${actor.actor_type}:${actor.actor_id}`;

  return { subject_key, principal_id, agent_id };
}

export async function recordLearningFromFailure(
  pool: DbPool,
  input: LearningFromFailureInput,
): Promise<void> {
  if (input.decision === PolicyDecision.Allow) return;

  const occurred_at = input.occurred_at ?? new Date().toISOString();
  const category = mapConstraintCategory(input.category);
  const subject = await resolveLearningSubject(pool, input.actor, input.principal_id);

  const sanitizedContext = sanitizeUnknown(input.context ?? {});
  const patternPayload = {
    category,
    action: input.action,
    reason_code: input.reason_code,
    blocked: input.blocked,
    context: sanitizedContext,
  };
  const pattern = stableStringify(patternPayload);
  const pattern_hash = sha256Hex(pattern);
  const guidance = buildGuidance({
    category,
    action: input.action,
    reason_code: input.reason_code,
    blocked: input.blocked,
  });

  const constraintWrite = await pool.query<{
    constraint_id: string;
    seen_count: number;
  }>(
    `INSERT INTO sec_constraints (
       constraint_id,
       workspace_id,
       subject_key,
       principal_id,
       agent_id,
       category,
       action,
       reason_code,
       pattern,
       pattern_hash,
       guidance,
       learned_from_event_id,
       seen_count,
       first_learned_at,
       last_seen_at,
       created_at,
       updated_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1,$13,$13,$13,$13
     )
     ON CONFLICT (workspace_id, subject_key, category, pattern_hash)
     DO UPDATE SET
       action = EXCLUDED.action,
       reason_code = EXCLUDED.reason_code,
       pattern = EXCLUDED.pattern,
       guidance = EXCLUDED.guidance,
       learned_from_event_id = EXCLUDED.learned_from_event_id,
       seen_count = sec_constraints.seen_count + 1,
       last_seen_at = EXCLUDED.last_seen_at,
       updated_at = EXCLUDED.updated_at
     RETURNING constraint_id, seen_count`,
    [
      newConstraintId(),
      input.workspace_id,
      subject.subject_key,
      subject.principal_id,
      subject.agent_id,
      category,
      input.action,
      input.reason_code,
      pattern,
      pattern_hash,
      guidance,
      input.policy_event_id,
      occurred_at,
    ],
  );
  const constraint = constraintWrite.rows[0];

  const counterWrite = await pool.query<{ seen_count: number }>(
    `INSERT INTO sec_mistake_counters (
       workspace_id,
       subject_key,
       principal_id,
       agent_id,
       category,
       action,
       reason_code,
       pattern_hash,
       seen_count,
       first_seen_at,
       last_seen_at,
       last_failure_event_id,
       last_constraint_id
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,1,$9,$9,$10,$11
     )
     ON CONFLICT (workspace_id, subject_key, category, pattern_hash)
     DO UPDATE SET
       action = EXCLUDED.action,
       reason_code = EXCLUDED.reason_code,
       seen_count = sec_mistake_counters.seen_count + 1,
       last_seen_at = EXCLUDED.last_seen_at,
       last_failure_event_id = EXCLUDED.last_failure_event_id,
       last_constraint_id = EXCLUDED.last_constraint_id
     RETURNING seen_count`,
    [
      input.workspace_id,
      subject.subject_key,
      subject.principal_id,
      subject.agent_id,
      category,
      input.action,
      input.reason_code,
      pattern_hash,
      occurred_at,
      input.policy_event_id,
      constraint.constraint_id,
    ],
  );
  const repeat_count = counterWrite.rows[0].seen_count;

  const stream = input.room_id
    ? { stream_type: "room" as const, stream_id: input.room_id }
    : { stream_type: "workspace" as const, stream_id: input.workspace_id };

  const learningEvent = await appendToStream(pool, {
    event_id: randomUUID(),
    event_type: "learning.from_failure",
    event_version: 1,
    occurred_at,
    workspace_id: input.workspace_id,
    room_id: input.room_id,
    thread_id: input.thread_id,
    run_id: input.run_id,
    step_id: input.step_id,
    actor: input.actor,
    actor_principal_id: subject.principal_id ?? undefined,
    zone: input.zone,
    stream,
    correlation_id: input.correlation_id,
    causation_id: input.policy_event_id,
    data: {
      category,
      action: input.action,
      decision: input.decision,
      reason_code: input.reason_code,
      reason: input.reason,
      enforcement_mode: input.enforcement_mode,
      blocked: input.blocked,
      subject_key: subject.subject_key,
      principal_id: subject.principal_id,
      agent_id: subject.agent_id,
      pattern_hash,
      guidance,
      context: sanitizedContext,
      capability_token_id: input.capability_token_id,
      policy_event_id: input.policy_event_id,
    },
    policy_context: {},
    model_context: {},
    display: {},
  });

  const constraintEvent = await appendToStream(pool, {
    event_id: randomUUID(),
    event_type: "constraint.learned",
    event_version: 1,
    occurred_at,
    workspace_id: input.workspace_id,
    room_id: input.room_id,
    thread_id: input.thread_id,
    run_id: input.run_id,
    step_id: input.step_id,
    actor: input.actor,
    actor_principal_id: subject.principal_id ?? undefined,
    zone: input.zone,
    stream,
    correlation_id: input.correlation_id,
    causation_id: learningEvent.event_id,
    data: {
      constraint_id: constraint.constraint_id,
      category,
      action: input.action,
      reason_code: input.reason_code,
      pattern_hash,
      guidance,
      seen_count: constraint.seen_count,
      repeat_count,
      subject_key: subject.subject_key,
      principal_id: subject.principal_id,
      agent_id: subject.agent_id,
      learned_from_event_id: input.policy_event_id,
    },
    policy_context: {},
    model_context: {},
    display: {},
  });

  // Emit once when the same mistake is observed for the second time.
  if (repeat_count === 2) {
    await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "mistake.repeated",
      event_version: 1,
      occurred_at,
      workspace_id: input.workspace_id,
      room_id: input.room_id,
      thread_id: input.thread_id,
      run_id: input.run_id,
      step_id: input.step_id,
      actor: input.actor,
      actor_principal_id: subject.principal_id ?? undefined,
      zone: input.zone,
      stream,
      correlation_id: input.correlation_id,
      causation_id: constraintEvent.event_id,
      data: {
        constraint_id: constraint.constraint_id,
        category,
        action: input.action,
        reason_code: input.reason_code,
        repeat_count,
        pattern_hash,
        guidance,
        subject_key: subject.subject_key,
        principal_id: subject.principal_id,
        agent_id: subject.agent_id,
        learned_from_event_id: input.policy_event_id,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });
  }
}
