import { apiPost } from "./http";

export type LegacyActorType = "user" | "service";

export type PrincipalType = "user" | "service" | "agent";

export interface PrincipalRecord {
  principal_id: string;
  principal_type: PrincipalType | string;
  legacy_actor_type: LegacyActorType | null;
  legacy_actor_id: string | null;
  created_at: string;
}

export async function ensureLegacyPrincipal(params: {
  actor_type: LegacyActorType;
  actor_id: string;
}): Promise<PrincipalRecord> {
  const actor_type = params.actor_type;
  const actor_id = params.actor_id.trim();
  if (!actor_id) throw new Error("actor_id_required");

  const res = await apiPost<{ principal: PrincipalRecord }>("/v1/principals/legacy/ensure", {
    actor_type,
    actor_id,
  });
  return res.principal;
}

