import type { FastifyInstance } from "fastify";

import type { ActorType, PolicyCheckResultV1 } from "@agentapp/shared";

import type { DbPool } from "../../db/pool.js";
import { evaluatePolicyV1 } from "../../policy/policyGate.js";

function getHeaderString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function workspaceIdFromReq(req: { headers: Record<string, unknown> }): string {
  const raw = getHeaderString(req.headers["x-workspace-id"] as string | string[] | undefined);
  return raw?.trim() || "ws_dev";
}

function normalizeActorType(raw: unknown): ActorType {
  return raw === "service" ? "service" : "user";
}

export async function registerPolicyRoutes(app: FastifyInstance, _pool: DbPool): Promise<void> {
  app.post<{
    Body: {
      action: string;
      actor_type?: ActorType;
      actor_id?: string;
      room_id?: string;
      thread_id?: string;
      run_id?: string;
      step_id?: string;
      context?: Record<string, unknown>;
    };
  }>("/v1/policy/evaluate", async (req): Promise<PolicyCheckResultV1> => {
    const workspace_id = workspaceIdFromReq(req);

    const actor_type = normalizeActorType(req.body.actor_type);
    const actor_id =
      req.body.actor_id?.trim() || (actor_type === "service" ? "api" : "anon");

    return evaluatePolicyV1({
      action: req.body.action,
      actor: { actor_type, actor_id },
      workspace_id,
      room_id: req.body.room_id,
      thread_id: req.body.thread_id,
      run_id: req.body.run_id,
      step_id: req.body.step_id,
      context: req.body.context,
    });
  });
}

