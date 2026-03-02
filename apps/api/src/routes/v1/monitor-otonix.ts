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

    return reply.code(HTTP_OK).send({
      schema_version: SCHEMA_VERSION,
      workspace_id,
      monitor: "otonix",
      read_only: true,
      action: rawAction,
      allowed_actions: READ_ONLY_ACTION_ALLOWLIST,
      target: {
        health_summary: "/v1/system/health",
        health_issues: "/v1/system/health/issues",
        finance_projection: "/v1/finance/projection",
      }[rawAction],
    });
  });
}

