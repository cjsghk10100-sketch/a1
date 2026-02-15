import type { DbClient } from "../db/pool.js";

export async function tryMarkApplied(
  tx: DbClient,
  projectorName: string,
  eventId: string,
): Promise<boolean> {
  const res = await tx.query(
    "INSERT INTO proj_applied_events (projector_name, event_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [projectorName, eventId],
  );
  return res.rowCount === 1;
}
