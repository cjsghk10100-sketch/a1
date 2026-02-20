import { randomUUID } from "node:crypto";

import type { DbClient } from "../db/pool.js";

type LegacyActorType = "service" | "user" | "agent";
type PrincipalType = "user" | "agent" | "service";

// Best-effort in-process cache to avoid an extra SELECT on hot paths.
// Safe because principal ids are immutable once created.
const cache = new Map<string, string>();

export async function ensurePrincipalForLegacyActor(
  tx: DbClient,
  actor_type: LegacyActorType,
  actor_id: string,
): Promise<string> {
  const key = `${actor_type}:${actor_id}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const found = await tx.query<{ principal_id: string }>(
    `SELECT principal_id
     FROM sec_principals
     WHERE legacy_actor_type = $1
       AND legacy_actor_id = $2
     LIMIT 1`,
    [actor_type, actor_id],
  );

  if (found.rowCount === 1) {
    const principal_id = found.rows[0].principal_id;
    cache.set(key, principal_id);
    return principal_id;
  }

  const principal_type: PrincipalType =
    actor_type === "service" ? "service" : actor_type === "agent" ? "agent" : "user";

  const inserted = await tx.query<{ principal_id: string }>(
    `INSERT INTO sec_principals (
        principal_id,
        principal_type,
        legacy_actor_type,
        legacy_actor_id
      ) VALUES ($1, $2, $3, $4)
      ON CONFLICT (legacy_actor_type, legacy_actor_id)
      DO UPDATE SET legacy_actor_id = EXCLUDED.legacy_actor_id
      RETURNING principal_id`,
    [randomUUID(), principal_type, actor_type, actor_id],
  );

  const principal_id = inserted.rows[0]?.principal_id;
  if (!principal_id) {
    throw new Error("failed_to_create_principal");
  }

  cache.set(key, principal_id);
  return principal_id;
}
