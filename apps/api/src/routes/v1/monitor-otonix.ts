import type { FastifyInstance } from "fastify";

import {
  buildContractError,
  httpStatusForReasonCode,
} from "../../contracts/pipeline_v2_contract.js";
import {
  SCHEMA_VERSION,
  assertSupportedSchemaVersion,
} from "../../contracts/schemaVersion.js";
import type { DbPool } from "../../db/pool.js";
import { getRequestAuth } from "../../security/requestAuth.js";

const HTTP_OK = httpStatusForReasonCode("duplicate_idempotent_replay");
const READ_ONLY_ACTION_ALLOWLIST = [
  "health_summary",
  "health_issues",
  "finance_projection",
] as const;

type MonitorAction = (typeof READ_ONLY_ACTION_ALLOWLIST)[number];
type MonitorTargetRequest = {
  method: "GET" | "POST";
  path: string;
  required_query_fields?: readonly string[];
  required_body_fields?: readonly string[];
  default_query?: Record<string, string>;
  example_body?: Record<string, unknown>;
};

const TARGET_REQUEST_BY_ACTION: Record<MonitorAction, MonitorTargetRequest> = {
  health_summary: {
    method: "POST",
    path: "/v1/system/health",
    required_body_fields: ["schema_version"],
    example_body: { schema_version: SCHEMA_VERSION },
  },
  health_issues: {
    method: "GET",
    path: "/v1/system/health/issues",
    required_query_fields: ["kind"],
    default_query: { kind: "active_incidents" },
  },
  finance_projection: {
    method: "POST",
    path: "/v1/finance/projection",
    required_body_fields: ["schema_version"],
    example_body: { schema_version: SCHEMA_VERSION },
  },
};

function workspaceIdFromReq(req: {
  headers: Record<string, unknown>;
  raw?: { rawHeaders?: string[] };
}): string | null {
  const rawHeaders = req.raw?.rawHeaders;
  if (!Array.isArray(rawHeaders)) return null;

  for (let i = 0; i < rawHeaders.length - 1; i += 2) {
    if (rawHeaders[i]?.toLowerCase() !== "x-workspace-id") continue;
    const headerValue = rawHeaders[i + 1];
    if (typeof headerValue !== "string") return null;
    const trimmed = headerValue.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  return null;
}

function isWriteLikeAction(action: string): boolean {
  return /(^|[_-])(write|create|update|delete|remove|revoke|grant|promote|demote|execute)([_-]|$)/i.test(
    action,
  );
}

function isAllowedReadAction(action: string): action is MonitorAction {
  return (READ_ONLY_ACTION_ALLOWLIST as readonly string[]).includes(action);
}

function buildActionTarget(action: MonitorAction): string {
  const target = TARGET_REQUEST_BY_ACTION[action];
  if (!target.default_query) return target.path;
  const qs = new URLSearchParams(target.default_query).toString();
  return qs.length > 0 ? `${target.path}?${qs}` : target.path;
}

export async function registerMonitorOtonixRoutes(
  app: FastifyInstance,
  _pool: DbPool,
): Promise<void> {
  app.get<{ Querystring: Record<string, unknown> }>("/monitor/otonix", async (req, reply) => {
    const schemaVersionInput = req.query?.schema_version;
    if (schemaVersionInput !== undefined) {
      try {
        assertSupportedSchemaVersion(schemaVersionInput);
      } catch {
        const reason_code = "unsupported_version" as const;
        return reply
          .code(httpStatusForReasonCode(reason_code))
          .send(
            buildContractError(reason_code, {
              schema_version: schemaVersionInput,
            }),
          );
      }
    }

    const workspace_id = workspaceIdFromReq(req);
    if (!workspace_id) {
      const reason_code = "missing_workspace_header" as const;
      return reply
        .code(httpStatusForReasonCode(reason_code))
        .send(buildContractError(reason_code, { header: "x-workspace-id" }));
    }

    const auth = getRequestAuth(req);
    if (auth.workspace_id !== workspace_id) {
      const reason_code = "unauthorized_workspace" as const;
      return reply
        .code(httpStatusForReasonCode(reason_code))
        .send(
          buildContractError(reason_code, {
            header_workspace_id: workspace_id,
            auth_workspace_id: auth.workspace_id,
          }),
        );
    }

    const rawAction = typeof req.query?.action === "string" ? req.query.action.trim() : "";
    if (!rawAction) {
      const reason_code = "invalid_payload_combination" as const;
      return reply
        .code(httpStatusForReasonCode(reason_code))
        .send(
          buildContractError(reason_code, {
            field: "action",
            monitor: "otonix",
            allowed_actions: READ_ONLY_ACTION_ALLOWLIST,
          }),
        );
    }

    if (isWriteLikeAction(rawAction)) {
      const reason_code = "invalid_payload_combination" as const;
      return reply
        .code(httpStatusForReasonCode(reason_code))
        .send(
          buildContractError(reason_code, {
            monitor: "otonix",
            action: rawAction,
            read_only: true,
            write_action_blocked: true,
            allowed_actions: READ_ONLY_ACTION_ALLOWLIST,
          }),
        );
    }

    if (!isAllowedReadAction(rawAction)) {
      const reason_code = "invalid_payload_combination" as const;
      return reply
        .code(httpStatusForReasonCode(reason_code))
        .send(
          buildContractError(reason_code, {
            monitor: "otonix",
            action: rawAction,
            read_only: true,
            allowed_actions: READ_ONLY_ACTION_ALLOWLIST,
          }),
        );
    }

    const target_request = TARGET_REQUEST_BY_ACTION[rawAction];
    return reply.code(HTTP_OK).send({
      schema_version: SCHEMA_VERSION,
      workspace_id,
      monitor: "otonix",
      read_only: true,
      action: rawAction,
      allowed_actions: READ_ONLY_ACTION_ALLOWLIST,
      target: buildActionTarget(rawAction),
      target_request,
    });
  });
}
