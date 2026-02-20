import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import {
  PolicyDecision,
  ResourceLabel,
  type ActorType,
  type DataAccessDecisionResponseV1,
  type DataAccessRequestV1,
  type ResourceLabel as ResourceLabelValue,
  type Zone,
} from "@agentapp/shared";

import type { DbPool } from "../../db/pool.js";
import { appendToStream } from "../../eventStore/index.js";
import { authorize_data_access } from "../../policy/authorize.js";

function getHeaderString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function workspaceIdFromReq(req: { headers: Record<string, unknown> }): string {
  const raw = getHeaderString(req.headers["x-workspace-id"] as string | string[] | undefined);
  return raw?.trim() || "ws_dev";
}

function normalizeActorType(raw: unknown): ActorType {
  if (raw === "service" || raw === "agent") return raw;
  return "user";
}

function normalizeZone(raw: unknown): Zone | undefined {
  if (raw === "sandbox" || raw === "supervised" || raw === "high_stakes") return raw;
  return undefined;
}

function normalizeRequiredString(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return v.length ? v : null;
}

function normalizeOptionalString(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim();
  return v.length ? v : undefined;
}

function normalizeAction(raw: unknown): string | null {
  const v = normalizeRequiredString(raw);
  if (!v) return null;
  if (v === "data_read") return "data.read";
  if (v === "data_write") return "data.write";
  if (v === "data.read" || v === "data.write") return v;
  return null;
}

function normalizePurposeTags(raw: unknown): string[] | null {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return null;
  const out = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") return null;
    const v = item.trim();
    if (!v) continue;
    out.add(v);
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

function computePurposeMismatch(labelTags: string[], requestTags: string[]): boolean {
  if (!labelTags.length || !requestTags.length) return false;
  const set = new Set(labelTags);
  for (const t of requestTags) {
    if (set.has(t)) return false;
  }
  return true;
}

async function loadResolvedLabel(
  pool: DbPool,
  workspace_id: string,
  resource_type: string,
  resource_id: string,
): Promise<{ label: ResourceLabelValue; room_id: string | null; purpose_tags: string[] }> {
  const res = await pool.query<{
    label: ResourceLabelValue;
    room_id: string | null;
    purpose_tags: string[];
  }>(
    `SELECT label, room_id, purpose_tags
     FROM sec_resource_labels
     WHERE workspace_id = $1
       AND resource_type = $2
       AND resource_id = $3`,
    [workspace_id, resource_type, resource_id],
  );
  if (res.rowCount === 1) {
    return {
      label: res.rows[0].label,
      room_id: res.rows[0].room_id,
      purpose_tags: Array.isArray(res.rows[0].purpose_tags) ? res.rows[0].purpose_tags : [],
    };
  }
  return { label: ResourceLabel.Internal, room_id: null, purpose_tags: [] };
}

export async function registerDataAccessRoutes(app: FastifyInstance, pool: DbPool): Promise<void> {
  app.post<{
    Body: DataAccessRequestV1;
  }>("/v1/data/access/requests", async (req, reply): Promise<DataAccessDecisionResponseV1> => {
    const workspace_id = workspaceIdFromReq(req);

    const action = normalizeAction(req.body.action);
    const resource_type = normalizeRequiredString(req.body.resource_type);
    const resource_id = normalizeRequiredString(req.body.resource_id);
    const room_id = normalizeOptionalString(req.body.room_id);
    const purpose_tags = normalizePurposeTags(req.body.purpose_tags);
    const justification = normalizeOptionalString(req.body.justification);

    if (!action) return reply.code(400).send({ error: "invalid_action" });
    if (!resource_type || !resource_id) return reply.code(400).send({ error: "invalid_resource" });
    if (purpose_tags === null) return reply.code(400).send({ error: "invalid_purpose_tags" });

    const principal_id = normalizeOptionalString(req.body.principal_id);
    const capability_token_id = normalizeOptionalString(req.body.capability_token_id);
    const zone = normalizeZone(req.body.zone);

    const actor_type = normalizeActorType(req.body.actor_type);
    const actor_id =
      normalizeOptionalString(req.body.actor_id) || (actor_type === "service" ? "api" : "anon");

    const resolved = await loadResolvedLabel(pool, workspace_id, resource_type, resource_id);
    const purpose_hint_mismatch = computePurposeMismatch(resolved.purpose_tags, purpose_tags);
    const justification_provided = Boolean(justification);

    const stream = room_id
      ? { stream_type: "room" as const, stream_id: room_id }
      : { stream_type: "workspace" as const, stream_id: workspace_id };
    const correlation_id = randomUUID();

    const policy = await authorize_data_access(pool, {
      action,
      actor: { actor_type, actor_id },
      workspace_id,
      room_id,
      context: {
        data_access: {
          resource_type,
          resource_id,
          label: resolved.label,
          label_room_id: resolved.room_id,
          label_purpose_tags: resolved.purpose_tags,
          request_purpose_tags: purpose_tags,
          purpose_hint_mismatch,
          justification_provided,
        },
      },
      principal_id,
      capability_token_id,
      zone,
    });

    if (purpose_hint_mismatch) {
      await appendToStream(pool, {
        event_id: randomUUID(),
        event_type: "data.access.purpose_hint_mismatch",
        event_version: 1,
        occurred_at: new Date().toISOString(),
        workspace_id,
        room_id,
        actor: { actor_type, actor_id },
        actor_principal_id: principal_id,
        zone,
        stream,
        correlation_id,
        data: {
          action,
          resource_type,
          resource_id,
          resolved_label: resolved.label,
          resolved_room_id: resolved.room_id,
          resolved_purpose_tags: resolved.purpose_tags,
          request_purpose_tags: purpose_tags,
          justification_provided,
          decision: policy.decision,
          reason_code: policy.reason_code,
          blocked: policy.blocked,
          enforcement_mode: policy.enforcement_mode,
          capability_token_id,
        },
        policy_context: {},
        model_context: {},
        display: {},
      });

      const followup_event_type = justification_provided
        ? "data.access.justified"
        : "data.access.unjustified";

      await appendToStream(pool, {
        event_id: randomUUID(),
        event_type: followup_event_type,
        event_version: 1,
        occurred_at: new Date().toISOString(),
        workspace_id,
        room_id,
        actor: { actor_type, actor_id },
        actor_principal_id: principal_id,
        zone,
        stream,
        correlation_id,
        data: {
          action,
          resource_type,
          resource_id,
          resolved_label: resolved.label,
          resolved_room_id: resolved.room_id,
          resolved_purpose_tags: resolved.purpose_tags,
          request_purpose_tags: purpose_tags,
          justification_provided,
          decision: policy.decision,
          reason_code: policy.reason_code,
          blocked: policy.blocked,
          enforcement_mode: policy.enforcement_mode,
          capability_token_id,
        },
        policy_context: {},
        model_context: {},
        display: {},
      });
    }

    if (policy.decision === PolicyDecision.Deny) {
      await appendToStream(pool, {
        event_id: randomUUID(),
        event_type: "data.access.denied",
        event_version: 1,
        occurred_at: new Date().toISOString(),
        workspace_id,
        room_id,
        actor: { actor_type, actor_id },
        actor_principal_id: principal_id,
        zone,
        stream,
        correlation_id,
        data: {
          action,
          resource_type,
          resource_id,
          resolved_label: resolved.label,
          resolved_room_id: resolved.room_id,
          resolved_purpose_tags: resolved.purpose_tags,
          request_purpose_tags: purpose_tags,
          decision: policy.decision,
          reason_code: policy.reason_code,
          reason: policy.reason,
          blocked: policy.blocked,
          enforcement_mode: policy.enforcement_mode,
          capability_token_id,
        },
        policy_context: {},
        model_context: {},
        display: {},
      });
    }

    if (policy.reason) {
      return reply.code(200).send({
        decision: policy.decision,
        reason_code: policy.reason_code,
        reason: policy.reason,
        resolved_label: resolved.label,
        resolved_room_id: resolved.room_id,
        resolved_purpose_tags: resolved.purpose_tags,
      });
    }

    return reply.code(200).send({
      decision: policy.decision,
      reason_code: policy.reason_code,
      resolved_label: resolved.label,
      resolved_room_id: resolved.room_id,
      resolved_purpose_tags: resolved.purpose_tags,
    });
  });
}

