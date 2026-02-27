import {
  SCHEMA_VERSION,
  isSupportedSchemaVersion,
  type SupportedSchemaVersion,
} from "./schemaVersion.js";

export const PIPELINE_CONTRACT_VERSION = SCHEMA_VERSION;
export const MAX_INLINE_PAYLOAD_BYTES = 8 * 1024;

export const REASON_CODE_TO_HTTP = {
  unsupported_version: 400,
  missing_workspace_header: 401,
  unknown_agent: 403,
  unauthorized_workspace: 403,
  missing_required_field: 400,
  invalid_work_item_type: 400,
  already_claimed: 409,
  correlation_id_mismatch: 409,
  lease_not_owned: 409,
  lease_expired_or_preempted: 403,
  heartbeat_rate_limited: 429,
  rate_limited: 429,
  lease_version_mismatch: 409,
  missing_work_link: 400,
  invalid_intent_for_type: 400,
  missing_field: 400,
  invalid_payload_combination: 400,
  payload_too_large: 413,
  artifact_not_found: 422,
  storage_unavailable: 503,
  invalid_content_type: 400,
  invalid_object_key: 400,
  duplicate_idempotent_replay: 200,
  idempotency_conflict_unresolved: 409,
  projection_unavailable: 503,
  internal_error: 500,
} as const;

export type ContractReasonCode = keyof typeof REASON_CODE_TO_HTTP;

export type ContractErrorPayload = {
  error: true;
  reason_code: ContractReasonCode;
  reason: string;
  details: Record<string, unknown>;
};

export class ContractViolationError extends Error {
  reason_code: ContractReasonCode;
  details: Record<string, unknown>;

  constructor(reason_code: ContractReasonCode, reason?: string, details?: Record<string, unknown>) {
    super(reason ?? reason_code);
    this.name = "ContractViolationError";
    this.reason_code = reason_code;
    this.details = details ?? {};
  }
}

export function httpStatusForReasonCode(reason_code: ContractReasonCode): number {
  return REASON_CODE_TO_HTTP[reason_code];
}

export function buildContractError(
  reason_code: ContractReasonCode,
  details?: Record<string, unknown>,
  reason?: string,
): ContractErrorPayload {
  return {
    error: true,
    reason_code,
    reason: reason ?? reason_code,
    details: details ?? {},
  };
}

export function errorPayloadFromUnknown(
  err: unknown,
  fallbackCode: ContractReasonCode,
): ContractErrorPayload {
  if (err instanceof ContractViolationError) {
    return buildContractError(err.reason_code, err.details, err.message);
  }
  const reason = err instanceof Error ? err.message : String(err);
  return buildContractError(fallbackCode, {}, reason);
}

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ContractViolationError("missing_field", "request body must be an object");
  }
  return input as Record<string, unknown>;
}

function nonEmptyString(
  value: unknown,
  opts: { reason_code: ContractReasonCode; field: string },
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ContractViolationError(opts.reason_code, `${opts.field} is required`, {
      field: opts.field,
    });
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function payloadByteLength(payload: unknown): number {
  if (typeof payload === "string") return Buffer.byteLength(payload, "utf8");
  return Buffer.byteLength(JSON.stringify(payload ?? null), "utf8");
}

type ArtifactObjectKeyParts = {
  workspace_id: string;
  correlation_id: string;
  message_id: string;
};

function assertKeyPart(value: string, field: string): void {
  if (!/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new ContractViolationError("invalid_object_key", `${field} contains unsupported characters`, {
      field,
    });
  }
}

export function buildArtifactObjectKey(parts: ArtifactObjectKeyParts): string {
  const workspace_id = nonEmptyString(parts.workspace_id, {
    reason_code: "missing_field",
    field: "workspace_id",
  });
  const correlation_id = nonEmptyString(parts.correlation_id, {
    reason_code: "missing_field",
    field: "correlation_id",
  });
  const message_id = nonEmptyString(parts.message_id, {
    reason_code: "missing_field",
    field: "message_id",
  });
  assertKeyPart(workspace_id, "workspace_id");
  assertKeyPart(correlation_id, "correlation_id");
  assertKeyPart(message_id, "message_id");
  return `artifacts/${workspace_id}/${correlation_id}/${message_id}.json`;
}

export function assertSafeObjectKey(object_key: unknown): asserts object_key is string {
  if (typeof object_key !== "string") {
    throw new ContractViolationError("invalid_object_key", "object_key must be a string");
  }
  const normalized = object_key.trim();
  if (!normalized.startsWith("artifacts/")) {
    throw new ContractViolationError("invalid_object_key", "object_key must start with artifacts/");
  }
  if (
    normalized.length === 0 ||
    normalized.length > 1024 ||
    normalized.includes("..") ||
    normalized.includes("\\") ||
    normalized.includes("\0") ||
    normalized.startsWith("/") ||
    normalized.includes("//")
  ) {
    throw new ContractViolationError("invalid_object_key", "object_key contains unsafe path segments");
  }
}

export type MessageIntent = "message" | "heartbeat";

export type MessagePayloadRef = {
  object_key: string;
};

export type MessageCreateRequest = {
  schema_version: SupportedSchemaVersion;
  workspace_id?: string;
  from_agent_id: string;
  room_id?: string;
  thread_id?: string;
  correlation_id?: string;
  intent?: MessageIntent;
  idempotency_key: string;
  payload?: unknown;
  payload_ref?: MessagePayloadRef;
};

export function assertMessageCreateRequest(input: unknown): asserts input is MessageCreateRequest {
  const body = asRecord(input);
  const schema_version = body.schema_version;
  if (!isSupportedSchemaVersion(schema_version)) {
    throw new ContractViolationError("unsupported_version", "schema_version is not supported", {
      schema_version,
    });
  }

  nonEmptyString(body.from_agent_id, { reason_code: "missing_field", field: "from_agent_id" });
  nonEmptyString(body.idempotency_key, { reason_code: "missing_field", field: "idempotency_key" });

  const intent = optionalString(body.intent);
  const hasPayload = Object.prototype.hasOwnProperty.call(body, "payload") && body.payload !== undefined;
  const hasPayloadRef =
    Object.prototype.hasOwnProperty.call(body, "payload_ref") && body.payload_ref !== undefined;

  if (hasPayloadRef) {
    const payloadRef = asRecord(body.payload_ref);
    assertSafeObjectKey(payloadRef.object_key);
  }

  const heartbeat = intent === "heartbeat";
  if (!heartbeat) {
    if ((hasPayload && hasPayloadRef) || (!hasPayload && !hasPayloadRef)) {
      throw new ContractViolationError(
        "invalid_payload_combination",
        "exactly one of payload or payload_ref is required",
      );
    }
  } else if (hasPayload && hasPayloadRef) {
    throw new ContractViolationError(
      "invalid_payload_combination",
      "heartbeat allows payload omission but cannot provide both payload and payload_ref",
    );
  }

  if (hasPayload && payloadByteLength(body.payload) > MAX_INLINE_PAYLOAD_BYTES) {
    throw new ContractViolationError("payload_too_large", "payload exceeds max inline bytes", {
      max_bytes: MAX_INLINE_PAYLOAD_BYTES,
    });
  }
}

export type ArtifactCreateRequest = {
  schema_version: SupportedSchemaVersion;
  correlation_id: string;
  message_id: string;
  content_type: "application/json";
};

export function assertArtifactCreateRequest(input: unknown): asserts input is ArtifactCreateRequest {
  const body = asRecord(input);
  if (Object.prototype.hasOwnProperty.call(body, "object_key")) {
    throw new ContractViolationError("invalid_object_key", "object_key must be server-generated");
  }
  const schema_version = body.schema_version;
  if (!isSupportedSchemaVersion(schema_version)) {
    throw new ContractViolationError("unsupported_version", "schema_version is not supported", {
      schema_version,
    });
  }

  nonEmptyString(body.correlation_id, { reason_code: "missing_field", field: "correlation_id" });
  nonEmptyString(body.message_id, { reason_code: "missing_field", field: "message_id" });

  if (body.content_type !== "application/json") {
    throw new ContractViolationError("invalid_content_type", "content_type must be application/json", {
      expected: "application/json",
    });
  }
}

export type PipelineStageKey =
  | "1_inbox"
  | "2_pending_approval"
  | "3_execute_workspace"
  | "4_review_evidence"
  | "5_promoted"
  | "6_demoted";

export type PipelineItemLinks = {
  experiment_id: string | null;
  approval_id: string | null;
  run_id: string | null;
  evidence_id: string | null;
  scorecard_id: string | null;
  incident_id: string | null;
};

export type PipelineApprovalItem = {
  entity_type: "approval";
  entity_id: string;
  title: string;
  status: "pending" | "held";
  room_id: string | null;
  thread_id: string | null;
  correlation_id: string;
  updated_at: string;
  last_event_id: string | null;
  links: PipelineItemLinks;
};

export type PipelineRunItem = {
  entity_type: "run";
  entity_id: string;
  title: string;
  status: "queued" | "running" | "succeeded" | "failed";
  room_id: string | null;
  thread_id: string | null;
  correlation_id: string;
  updated_at: string;
  last_event_id: string | null;
  links: PipelineItemLinks;
};

export type PipelineStageStats = Record<
  PipelineStageKey,
  {
    returned: number;
    truncated: boolean;
  }
>;

export type PipelineProjectionStages = {
  "1_inbox": Array<Record<string, never>>;
  "2_pending_approval": PipelineApprovalItem[];
  "3_execute_workspace": PipelineRunItem[];
  "4_review_evidence": PipelineRunItem[];
  "5_promoted": Array<Record<string, never>>;
  "6_demoted": PipelineRunItem[];
};

export type PipelineProjectionResponseV2_1 = {
  meta: {
    schema_version: typeof PIPELINE_CONTRACT_VERSION;
    generated_at: string;
    limit: number;
    truncated: boolean;
    stage_stats: PipelineStageStats;
    watermark_event_id: string | null;
  };
  stages: PipelineProjectionStages;
};

export type VersionedWriteBody = {
  schema_version?: SupportedSchemaVersion;
};
