import type { FastifyInstance } from "fastify";

import type { ActorType, Zone, EgressRequestCreateV1, EgressRequestDecisionV1 } from "@agentapp/shared";

import type { DbPool } from "../../db/pool.js";
import { InvalidEgressTargetError, requestEgress } from "../../egress/requestEgress.js";

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

function normalizeOptionalString(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim();
  return v.length ? v : undefined;
}

export async function registerEgressRoutes(app: FastifyInstance, pool: DbPool): Promise<void> {
  app.post<{
    Body: EgressRequestCreateV1;
  }>("/v1/egress/requests", async (req, reply): Promise<EgressRequestDecisionV1> => {
    const workspace_id = workspaceIdFromReq(req);

    const actor_type = normalizeActorType(req.body.actor_type);
    const actor_id =
      normalizeOptionalString(req.body.actor_id) || (actor_type === "service" ? "api" : "anon");

    try {
      const result = await requestEgress(pool, {
        workspace_id,
        action: req.body.action,
        target_url: req.body.target_url,
        method: normalizeOptionalString(req.body.method),
        room_id: normalizeOptionalString(req.body.room_id),
        run_id: normalizeOptionalString(req.body.run_id),
        step_id: normalizeOptionalString(req.body.step_id),
        actor_type,
        actor_id,
        principal_id: normalizeOptionalString(req.body.principal_id),
        capability_token_id: normalizeOptionalString(req.body.capability_token_id),
        zone: normalizeZone(req.body.zone),
        correlation_id: normalizeOptionalString(req.body.correlation_id),
        context: req.body.context,
      });

      if (result.reason) {
        return reply.code(201).send({
          egress_request_id: result.egress_request_id,
          decision: result.decision,
          reason_code: result.reason_code,
          reason: result.reason,
          approval_id: result.approval_id,
        });
      }

      return reply.code(201).send({
        egress_request_id: result.egress_request_id,
        decision: result.decision,
        reason_code: result.reason_code,
        approval_id: result.approval_id,
      });
    } catch (err) {
      if (err instanceof InvalidEgressTargetError) {
        return reply.code(400).send({ error: "invalid_target_url" });
      }
      throw err;
    }
  });

  app.get<{
    Querystring: { room_id?: string; limit?: string };
  }>("/v1/egress/requests", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const room_id = normalizeOptionalString(req.query.room_id) ?? null;
    const rawLimit = Number(req.query.limit ?? "50");
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, rawLimit)) : 50;

    const args: unknown[] = [workspace_id];
    let where = "workspace_id = $1";
    if (room_id) {
      args.push(room_id);
      where += ` AND room_id = $${args.length}`;
    }
    args.push(limit);

    const res = await pool.query(
      `SELECT
        egress_request_id,
        workspace_id,
        room_id,
        run_id,
        step_id,
        requested_by_type,
        requested_by_id,
        requested_by_principal_id,
        zone,
        action,
        method,
        target_url,
        target_domain,
        policy_decision,
        policy_reason_code,
        policy_reason,
        enforcement_mode,
        blocked,
        approval_id,
        correlation_id,
        created_at
      FROM sec_egress_requests
      WHERE ${where}
      ORDER BY created_at DESC
      LIMIT $${args.length}`,
      args,
    );

    return reply.code(200).send({ requests: res.rows });
  });
}
