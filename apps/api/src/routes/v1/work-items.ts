import { randomUUID } from "node:crypto";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { EventEnvelopeV1 } from "@agentapp/shared";

import {
  REASON_CODE_TO_HTTP,
  buildContractError,
  httpStatusForReasonCode,
} from "../../contracts/pipeline_v2_contract.js";
import { SCHEMA_VERSION, assertSupportedSchemaVersion } from "../../contracts/schemaVersion.js";
import type { DbClient, DbPool } from "../../db/pool.js";
import { LEASE_DURATION_SECONDS, HEARTBEAT_MIN_INTERVAL_SEC, HEARTBEAT_MIN_INTERVAL_SEC_TEST } from "../../config.js";
import { appendToStream } from "../../eventStore/index.js";
import { getRequestAuth } from "../../security/requestAuth.js";

type WorkItemType = "experiment" | "approval" | "message" | "incident" | "artifact";

const WORK_ITEM_TYPES: WorkItemType[] = ["experiment", "approval", "message", "incident", "artifact"];

type ClaimBody = {
  schema_version?: string;
  workspace_id?: string;
  from_agent_id?: string;
  work_item_type?: string;
  work_item_id?: string;
  correlation_id?: string;
};

type HeartbeatBody = ClaimBody & {
  lease_id?: string;
  version?: number;
};

type ReleaseBody = ClaimBody & {
  lease_id?: string;
};

type OldLeaseHintRow = {
  old_lease_id: string;
  old_agent_id: string;
  old_expires_at: string;
};

type LeaseRow = {
  workspace_id: string;
  work_item_type: WorkItemType;
  work_item_id: string;
  lease_id: string;
  agent_id: string;
  correlation_id: string;
  claimed_at: string;
  last_heartbeat_at: string;
  expires_at: string;
  version: number;
  server_time: string;
};

type CurrentLeaseRow = {
  lease_id: string;
  agent_id: string;
  correlation_id: string;
  version: number;
  last_heartbeat_at: string;
  expires_at: string;
  server_time: string;
  heartbeat_rate_limited?: boolean;
};

type AgentRow = {
  agent_id: string;
};

type ValidatedCommon = {
  workspace_id: string;
  storedAgentId: string;
  work_item_type: WorkItemType;
  work_item_id: string;
  resolvedCorrelationId: string;
};

function getHeaderString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function workspaceIdFromHeader(req: { headers: Record<string, unknown> }): string | null {
  const raw = getHeaderString(req.headers["x-workspace-id"] as string | string[] | undefined);
  const normalized = raw?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function normalizeOptionalString(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isWorkItemType(raw: string | undefined): raw is WorkItemType {
  if (!raw) return false;
  return WORK_ITEM_TYPES.includes(raw as WorkItemType);
}

function leaseDurationSeconds(): number {
  const raw = Number(process.env.LEASE_DURATION_SECONDS);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  return LEASE_DURATION_SECONDS;
}

function heartbeatMinIntervalSec(): number {
  const envOverride = Number(process.env.HEARTBEAT_MIN_INTERVAL_SEC);
  const minInterval =
    process.env.NODE_ENV === "test"
      ? HEARTBEAT_MIN_INTERVAL_SEC_TEST
      : (Number.isFinite(envOverride) ? envOverride : HEARTBEAT_MIN_INTERVAL_SEC);
  return Math.max(0, Math.floor(minInterval));
}

function sendContractError(
  reply: FastifyReply,
  reason_code: keyof typeof REASON_CODE_TO_HTTP,
  details?: Record<string, unknown>,
): FastifyReply {
  return reply.code(httpStatusForReasonCode(reason_code)).send(buildContractError(reason_code, details));
}

async function findAuthenticatedAgentId(pool: DbPool, principal_id: string): Promise<string | null> {
  const res = await pool.query<AgentRow>(
    `SELECT agent_id
     FROM sec_agents
     WHERE principal_id = $1
       AND revoked_at IS NULL
     LIMIT 1`,
    [principal_id],
  );
  return res.rows[0]?.agent_id ?? null;
}

async function validateCommon(
  req: FastifyRequest<{ Body: ClaimBody | HeartbeatBody | ReleaseBody }>,
  reply: FastifyReply,
  pool: DbPool,
): Promise<ValidatedCommon | null> {
  // 1) assertSupportedSchemaVersion
  try {
    assertSupportedSchemaVersion(req.body?.schema_version);
  } catch {
    sendContractError(reply, "unsupported_version", { schema_version: req.body?.schema_version });
    return null;
  }

  // 2) x-workspace-id required
  const workspace_id = workspaceIdFromHeader(req);
  if (!workspace_id) {
    sendContractError(reply, "missing_workspace_header", { header: "x-workspace-id" });
    return null;
  }

  // 3) optional body.workspace_id mismatch
  const bodyWorkspaceId = normalizeOptionalString(req.body?.workspace_id);
  if (bodyWorkspaceId && bodyWorkspaceId !== workspace_id) {
    sendContractError(reply, "unauthorized_workspace", {
      header_workspace_id: workspace_id,
      body_workspace_id: bodyWorkspaceId,
    });
    return null;
  }

  // 4) auth identity vs from_agent_id
  let storedAgentId: string | null = null;
  try {
    const auth = getRequestAuth(req);
    storedAgentId = await findAuthenticatedAgentId(pool, auth.principal_id);
  } catch {
    sendContractError(reply, "internal_error");
    return null;
  }

  const from_agent_id = normalizeOptionalString(req.body?.from_agent_id);
  if (!storedAgentId || !from_agent_id || from_agent_id !== storedAgentId) {
    sendContractError(reply, "unknown_agent", { from_agent_id: req.body?.from_agent_id });
    return null;
  }

  // 5) missing work_item_type/work_item_id
  const work_item_type_raw = normalizeOptionalString(req.body?.work_item_type);
  const work_item_id = normalizeOptionalString(req.body?.work_item_id);
  if (!work_item_type_raw || !work_item_id) {
    sendContractError(reply, "missing_required_field", {
      work_item_type: req.body?.work_item_type,
      work_item_id: req.body?.work_item_id,
    });
    return null;
  }

  // 6) invalid work_item_type
  if (!isWorkItemType(work_item_type_raw)) {
    sendContractError(reply, "invalid_work_item_type", {
      work_item_type: work_item_type_raw,
      allowed: WORK_ITEM_TYPES,
    });
    return null;
  }

  const resolvedCorrelationId =
    normalizeOptionalString(req.body?.correlation_id) ??
    `${workspace_id}:${work_item_type_raw}:${work_item_id}`;

  return {
    workspace_id,
    storedAgentId,
    work_item_type: work_item_type_raw,
    work_item_id,
    resolvedCorrelationId,
  };
}

function claimIdempotencyKey(input: {
  workspaceId: string;
  work_item_type: WorkItemType;
  work_item_id: string;
  lease_id: string;
}): string {
  return `claim:${input.workspaceId}:${input.work_item_type}:${input.work_item_id}:${input.lease_id}`;
}

function preemptIdempotencyKey(input: {
  workspaceId: string;
  work_item_type: WorkItemType;
  work_item_id: string;
  oldLeaseId: string;
  newLeaseId: string;
}): string {
  return `preempt:${input.workspaceId}:${input.work_item_type}:${input.work_item_id}:${input.oldLeaseId}:${input.newLeaseId}`;
}

function releaseIdempotencyKey(input: {
  workspaceId: string;
  work_item_type: WorkItemType;
  work_item_id: string;
  lease_id: string;
}): string {
  return `release:${input.workspaceId}:${input.work_item_type}:${input.work_item_id}:${input.lease_id}`;
}

function leaseEventEnvelope(input: {
  event_type: string;
  occurred_at: string;
  workspace_id: string;
  work_item_type: WorkItemType;
  work_item_id: string;
  agent_id: string;
  correlation_id: string;
  idempotency_key: string;
  data: Record<string, unknown>;
}): EventEnvelopeV1 {
  return {
    event_id: randomUUID(),
    event_type: input.event_type,
    event_version: 1,
    occurred_at: input.occurred_at,
    workspace_id: input.workspace_id,
    actor: {
      actor_type: "agent",
      actor_id: input.agent_id,
    },
    stream: {
      stream_type: "workspace",
      stream_id: input.workspace_id,
    },
    correlation_id: input.correlation_id,
    data: input.data,
    idempotency_key: input.idempotency_key,
    policy_context: {},
    model_context: {},
    display: {},
    entity_type: input.work_item_type,
    entity_id: input.work_item_id,
  } as EventEnvelopeV1;
}

export async function registerWorkItemsRoutes(app: FastifyInstance, pool: DbPool): Promise<void> {
  app.post<{ Body: ClaimBody }>("/v1/work-items/claim", async (req, reply) => {
    const validated = await validateCommon(req, reply, pool);
    if (!validated) return;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const oldLease = await client.query<OldLeaseHintRow>(
        `SELECT
           lease_id AS old_lease_id,
           agent_id AS old_agent_id,
           expires_at::text AS old_expires_at
         FROM work_item_leases
         WHERE workspace_id = $1
           AND work_item_type = $2
           AND work_item_id = $3`,
        [validated.workspace_id, validated.work_item_type, validated.work_item_id],
      );

      const lease_id = `lease_${randomUUID()}`;
      const claimed = await client.query<LeaseRow>(
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
           $1, $2, $3, $4, $5, $6,
           now(), now(), now() + make_interval(secs => $7), 1
         )
         ON CONFLICT (workspace_id, work_item_type, work_item_id)
         DO UPDATE SET
           lease_id = EXCLUDED.lease_id,
           agent_id = EXCLUDED.agent_id,
           correlation_id = EXCLUDED.correlation_id,
           claimed_at = now(),
           last_heartbeat_at = now(),
           expires_at = now() + make_interval(secs => $7),
           version = 1
         WHERE work_item_leases.expires_at < now()
         RETURNING
           workspace_id,
           work_item_type,
           work_item_id,
           lease_id,
           agent_id,
           correlation_id,
           claimed_at::text,
           last_heartbeat_at::text,
           expires_at::text,
           version,
           now()::text AS server_time`,
        [
          validated.workspace_id,
          validated.work_item_type,
          validated.work_item_id,
          lease_id,
          validated.storedAgentId,
          validated.resolvedCorrelationId,
          leaseDurationSeconds(),
        ],
      );

      if (claimed.rowCount === 1) {
        const lease = claimed.rows[0];
        const oldRow = oldLease.rows[0];

        if (oldRow?.old_expires_at) {
          const preemptCheck = await client.query<{ is_expired: boolean }>(
            `SELECT ($1::timestamptz < $2::timestamptz) AS is_expired`,
            [oldRow.old_expires_at, lease.server_time],
          );

          if (preemptCheck.rows[0]?.is_expired === true) {
            await appendToStream(
              pool,
              leaseEventEnvelope({
                event_type: "lease.preempted",
                occurred_at: lease.server_time,
                workspace_id: validated.workspace_id,
                work_item_type: validated.work_item_type,
                work_item_id: validated.work_item_id,
                agent_id: validated.storedAgentId,
                correlation_id: validated.resolvedCorrelationId,
                idempotency_key: preemptIdempotencyKey({
                  workspaceId: validated.workspace_id,
                  work_item_type: validated.work_item_type,
                  work_item_id: validated.work_item_id,
                  oldLeaseId: oldRow.old_lease_id,
                  newLeaseId: lease.lease_id,
                }),
                data: {
                  workspace_id: validated.workspace_id,
                  work_item_type: validated.work_item_type,
                  work_item_id: validated.work_item_id,
                  old_lease_id: oldRow.old_lease_id,
                  old_agent_id: oldRow.old_agent_id,
                  old_expires_at: oldRow.old_expires_at,
                  previous_actor_id: oldRow.old_agent_id,
                  next_actor_id: validated.storedAgentId,
                  new_lease_id: lease.lease_id,
                  reason: "expired_lease_reclaimed",
                },
              }),
              client,
            );
          }
        }

        await appendToStream(
          pool,
          leaseEventEnvelope({
            event_type: "lease.claimed",
            occurred_at: lease.server_time,
            workspace_id: validated.workspace_id,
            work_item_type: validated.work_item_type,
            work_item_id: validated.work_item_id,
            agent_id: validated.storedAgentId,
            correlation_id: validated.resolvedCorrelationId,
            idempotency_key: claimIdempotencyKey({
              workspaceId: validated.workspace_id,
              work_item_type: validated.work_item_type,
              work_item_id: validated.work_item_id,
              lease_id: lease.lease_id,
            }),
            data: {
              workspace_id: validated.workspace_id,
              work_item_type: validated.work_item_type,
              work_item_id: validated.work_item_id,
              lease_id: lease.lease_id,
              agent_id: validated.storedAgentId,
              correlation_id: validated.resolvedCorrelationId,
              version: lease.version,
              claimed_at: lease.claimed_at,
              expires_at: lease.expires_at,
            },
          }),
          client,
        );

        await client.query("COMMIT");
        return reply.code(201).send({
          schema_version: SCHEMA_VERSION,
          replay: false,
          server_time: lease.server_time,
          lease: {
            workspace_id: lease.workspace_id,
            work_item_type: lease.work_item_type,
            work_item_id: lease.work_item_id,
            lease_id: lease.lease_id,
            agent_id: lease.agent_id,
            correlation_id: lease.correlation_id,
            claimed_at: lease.claimed_at,
            last_heartbeat_at: lease.last_heartbeat_at,
            expires_at: lease.expires_at,
            version: lease.version,
          },
        });
      }

      const current = await client.query<CurrentLeaseRow>(
        `SELECT
           lease_id,
           agent_id,
           correlation_id,
           version,
           last_heartbeat_at::text,
           expires_at::text,
           now()::text AS server_time
         FROM work_item_leases
         WHERE workspace_id = $1
           AND work_item_type = $2
           AND work_item_id = $3`,
        [validated.workspace_id, validated.work_item_type, validated.work_item_id],
      );

      const currentLease = current.rows[0];
      if (currentLease && currentLease.agent_id === validated.storedAgentId) {
        if (validated.resolvedCorrelationId !== currentLease.correlation_id) {
          await client.query("ROLLBACK").catch(() => {});
          return sendContractError(reply, "correlation_id_mismatch", {
            resolved_correlation_id: validated.resolvedCorrelationId,
            stored_correlation_id: currentLease.correlation_id,
            lease_id: currentLease.lease_id,
            server_time: currentLease.server_time,
          });
        }

        await client.query("COMMIT");
        return reply.code(200).send({
          schema_version: SCHEMA_VERSION,
          replay: true,
          server_time: currentLease.server_time,
          lease: {
            workspace_id: validated.workspace_id,
            work_item_type: validated.work_item_type,
            work_item_id: validated.work_item_id,
            lease_id: currentLease.lease_id,
            agent_id: currentLease.agent_id,
            correlation_id: currentLease.correlation_id,
            last_heartbeat_at: currentLease.last_heartbeat_at,
            expires_at: currentLease.expires_at,
            version: currentLease.version,
          },
        });
      }

      await client.query("ROLLBACK").catch(() => {});
      return sendContractError(reply, "already_claimed", {
        work_item_type: validated.work_item_type,
        work_item_id: validated.work_item_id,
        lease_id: currentLease?.lease_id,
        server_time: currentLease?.server_time,
      });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  });

  app.post<{ Body: HeartbeatBody }>("/v1/work-items/heartbeat", async (req, reply) => {
    const validated = await validateCommon(req, reply, pool);
    if (!validated) return;

    const lease_id = normalizeOptionalString(req.body.lease_id);
    const version = Number(req.body.version);
    if (!lease_id || !Number.isInteger(version) || version <= 0) {
      return sendContractError(reply, "missing_required_field", {
        lease_id: req.body.lease_id,
        version: req.body.version,
      });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const updated = await client.query<LeaseRow>(
        `UPDATE work_item_leases
         SET
           last_heartbeat_at = now(),
           expires_at = now() + make_interval(secs => $8),
           version = version + 1
         WHERE workspace_id = $1
           AND work_item_type = $2
           AND work_item_id = $3
           AND lease_id = $4
           AND agent_id = $5
           AND version = $6
           AND expires_at > now()
           AND (now() - last_heartbeat_at) >= make_interval(secs => $7)
         RETURNING
           workspace_id,
           work_item_type,
           work_item_id,
           lease_id,
           agent_id,
           correlation_id,
           claimed_at::text,
           last_heartbeat_at::text,
           expires_at::text,
           version,
           now()::text AS server_time`,
        [
          validated.workspace_id,
          validated.work_item_type,
          validated.work_item_id,
          lease_id,
          validated.storedAgentId,
          version,
          heartbeatMinIntervalSec(),
          leaseDurationSeconds(),
        ],
      );

      if (updated.rowCount === 1) {
        const lease = updated.rows[0];
        await client.query("COMMIT");
        return reply.code(200).send({
          schema_version: SCHEMA_VERSION,
          server_time: lease.server_time,
          lease: {
            workspace_id: lease.workspace_id,
            work_item_type: lease.work_item_type,
            work_item_id: lease.work_item_id,
            lease_id: lease.lease_id,
            agent_id: lease.agent_id,
            correlation_id: lease.correlation_id,
            last_heartbeat_at: lease.last_heartbeat_at,
            expires_at: lease.expires_at,
            version: lease.version,
          },
        });
      }

      const diagnostic = await client.query<CurrentLeaseRow>(
        `SELECT
           lease_id,
           agent_id,
           correlation_id,
           version,
           last_heartbeat_at::text,
           expires_at::text,
           now()::text AS server_time,
           ((now() - last_heartbeat_at) < make_interval(secs => $4)) AS heartbeat_rate_limited
         FROM work_item_leases
         WHERE workspace_id = $1
           AND work_item_type = $2
           AND work_item_id = $3`,
        [
          validated.workspace_id,
          validated.work_item_type,
          validated.work_item_id,
          heartbeatMinIntervalSec(),
        ],
      );

      const row = diagnostic.rows[0];
      if (!row || row.lease_id !== lease_id || row.agent_id !== validated.storedAgentId) {
        await client.query("ROLLBACK").catch(() => {});
        return sendContractError(reply, "lease_not_owned", {
          work_item_type: validated.work_item_type,
          work_item_id: validated.work_item_id,
          lease_id,
          server_time: row?.server_time,
        });
      }

      if (row.version !== version) {
        await client.query("ROLLBACK").catch(() => {});
        return sendContractError(reply, "lease_version_mismatch", {
          current_version: row.version,
          lease_id: row.lease_id,
          server_time: row.server_time,
        });
      }

      if (row.heartbeat_rate_limited === true) {
        await client.query("ROLLBACK").catch(() => {});
        return sendContractError(reply, "heartbeat_rate_limited", {
          lease_id: row.lease_id,
          current_version: row.version,
          server_time: row.server_time,
        });
      }

      await client.query("ROLLBACK").catch(() => {});
      return sendContractError(reply, "lease_not_owned", {
        work_item_type: validated.work_item_type,
        work_item_id: validated.work_item_id,
        lease_id: row.lease_id,
        server_time: row.server_time,
      });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  });

  app.post<{ Body: ReleaseBody }>("/v1/work-items/release", async (req, reply) => {
    const validated = await validateCommon(req, reply, pool);
    if (!validated) return;

    const lease_id = normalizeOptionalString(req.body.lease_id);
    if (!lease_id) {
      return sendContractError(reply, "missing_required_field", {
        lease_id: req.body.lease_id,
      });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const existing = await client.query<CurrentLeaseRow>(
        `SELECT
           lease_id,
           agent_id,
           correlation_id,
           version,
           last_heartbeat_at::text,
           expires_at::text,
           now()::text AS server_time
         FROM work_item_leases
         WHERE workspace_id = $1
           AND work_item_type = $2
           AND work_item_id = $3
         FOR UPDATE`,
        [validated.workspace_id, validated.work_item_type, validated.work_item_id],
      );

      if (existing.rowCount !== 1) {
        const serverTime = await client.query<{ server_time: string }>(
          "SELECT now()::text AS server_time",
        );
        await client.query("COMMIT");
        return reply.code(200).send({
          schema_version: SCHEMA_VERSION,
          replay: true,
          released: false,
          server_time: serverTime.rows[0].server_time,
        });
      }

      const current = existing.rows[0];
      if (current.lease_id !== lease_id) {
        await client.query("COMMIT");
        return reply.code(200).send({
          schema_version: SCHEMA_VERSION,
          replay: true,
          released: false,
          server_time: current.server_time,
        });
      }

      if (current.agent_id !== validated.storedAgentId) {
        await client.query("ROLLBACK").catch(() => {});
        return sendContractError(reply, "lease_not_owned", {
          work_item_type: validated.work_item_type,
          work_item_id: validated.work_item_id,
          lease_id,
          server_time: current.server_time,
        });
      }

      const deleted = await client.query<{ server_time: string }>(
        `DELETE FROM work_item_leases
         WHERE workspace_id = $1
           AND work_item_type = $2
           AND work_item_id = $3
           AND lease_id = $4
         RETURNING now()::text AS server_time`,
        [validated.workspace_id, validated.work_item_type, validated.work_item_id, lease_id],
      );

      if (deleted.rowCount !== 1) {
        await client.query("COMMIT");
        return reply.code(200).send({
          schema_version: SCHEMA_VERSION,
          replay: true,
          released: false,
          server_time: current.server_time,
        });
      }

      await appendToStream(
        pool,
        leaseEventEnvelope({
          event_type: "lease.released",
          occurred_at: deleted.rows[0].server_time,
          workspace_id: validated.workspace_id,
          work_item_type: validated.work_item_type,
          work_item_id: validated.work_item_id,
          agent_id: validated.storedAgentId,
          correlation_id: current.correlation_id,
          idempotency_key: releaseIdempotencyKey({
            workspaceId: validated.workspace_id,
            work_item_type: validated.work_item_type,
            work_item_id: validated.work_item_id,
            lease_id,
          }),
          data: {
            workspace_id: validated.workspace_id,
            work_item_type: validated.work_item_type,
            work_item_id: validated.work_item_id,
            lease_id,
            agent_id: validated.storedAgentId,
            correlation_id: current.correlation_id,
            version: current.version,
          },
        }),
        client,
      );

      await client.query("COMMIT");
      return reply.code(200).send({
        schema_version: SCHEMA_VERSION,
        replay: false,
        released: true,
        server_time: deleted.rows[0].server_time,
      });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  });
}
