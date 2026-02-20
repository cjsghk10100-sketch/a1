import type {
  IncidentClosedV1,
  IncidentEventV1,
  IncidentLearningLoggedV1,
  IncidentOpenedV1,
  IncidentRcaUpdatedV1,
} from "@agentapp/shared";

import type { DbClient, DbPool } from "../db/pool.js";
import { tryMarkApplied } from "./projectorDb.js";

export const INCIDENT_PROJECTOR_NAME = "incidents";

function toJsonb(value: unknown): string {
  return JSON.stringify(value ?? {});
}

async function applyInTx(tx: DbClient, event: IncidentEventV1): Promise<void> {
  const applied = await tryMarkApplied(tx, INCIDENT_PROJECTOR_NAME, event.event_id);
  if (!applied) return;

  switch (event.event_type) {
    case "incident.opened":
      await applyIncidentOpened(tx, event as IncidentOpenedV1);
      return;
    case "incident.rca.updated":
      await applyIncidentRcaUpdated(tx, event as IncidentRcaUpdatedV1);
      return;
    case "incident.learning.logged":
      await applyIncidentLearningLogged(tx, event as IncidentLearningLoggedV1);
      return;
    case "incident.closed":
      await applyIncidentClosed(tx, event as IncidentClosedV1);
      return;
  }
}

async function applyIncidentOpened(tx: DbClient, event: IncidentOpenedV1): Promise<void> {
  if (!event.workspace_id) throw new Error("incident.opened requires workspace_id");
  if (!event.data.incident_id) throw new Error("incident.opened requires incident_id");
  if (!event.data.title?.trim()) throw new Error("incident.opened requires title");

  await tx.query(
    `INSERT INTO proj_incidents (
      incident_id,
      workspace_id, room_id, thread_id, run_id,
      status, title, summary, severity,
      rca, rca_updated_at, learning_count, closed_reason,
      created_by_type, created_by_id,
      created_at, closed_at, updated_at,
      correlation_id, last_event_id
    ) VALUES (
      $1,
      $2, $3, $4, $5,
      'open', $6, $7, $8,
      '{}'::jsonb, NULL, 0, NULL,
      $9, $10,
      $11, NULL, $12,
      $13, $14
    )
    ON CONFLICT (incident_id) DO NOTHING`,
    [
      event.data.incident_id,
      event.workspace_id,
      event.room_id ?? null,
      event.thread_id ?? null,
      event.run_id ?? event.data.run_id ?? null,
      event.data.title,
      event.data.summary ?? null,
      event.data.severity ?? null,
      event.actor.actor_type,
      event.actor.actor_id,
      event.occurred_at,
      event.occurred_at,
      event.correlation_id,
      event.event_id,
    ],
  );
}

async function applyIncidentRcaUpdated(tx: DbClient, event: IncidentRcaUpdatedV1): Promise<void> {
  const incident_id = event.data.incident_id;
  if (!incident_id) throw new Error("incident.rca.updated requires incident_id");

  const res = await tx.query(
    `UPDATE proj_incidents
     SET
       rca = $2::jsonb,
       rca_updated_at = $3,
       updated_at = $3,
       last_event_id = $4
     WHERE incident_id = $1`,
    [incident_id, toJsonb(event.data.rca), event.occurred_at, event.event_id],
  );

  if (res.rowCount !== 1) {
    throw new Error("incident.rca.updated target not found in proj_incidents");
  }
}

async function applyIncidentLearningLogged(tx: DbClient, event: IncidentLearningLoggedV1): Promise<void> {
  const incident_id = event.data.incident_id;
  const learning_id = event.data.learning_id;
  if (!incident_id) throw new Error("incident.learning.logged requires incident_id");
  if (!learning_id) throw new Error("incident.learning.logged requires learning_id");
  if (!event.data.note?.trim()) throw new Error("incident.learning.logged requires note");

  await tx.query(
    `INSERT INTO proj_incident_learning (
      learning_id, incident_id,
      workspace_id, room_id, run_id,
      note, tags,
      created_by_type, created_by_id,
      created_at, last_event_id
    ) VALUES (
      $1, $2,
      $3, $4, $5,
      $6, $7,
      $8, $9,
      $10, $11
    )
    ON CONFLICT (learning_id) DO NOTHING`,
    [
      learning_id,
      incident_id,
      event.workspace_id,
      event.room_id ?? null,
      event.run_id ?? null,
      event.data.note,
      event.data.tags ?? [],
      event.actor.actor_type,
      event.actor.actor_id,
      event.occurred_at,
      event.event_id,
    ],
  );

  const res = await tx.query(
    `UPDATE proj_incidents AS i
     SET
       learning_count = s.learning_count,
       updated_at = $2,
       last_event_id = $3
     FROM (
       SELECT incident_id, COUNT(*)::int AS learning_count
       FROM proj_incident_learning
       WHERE incident_id = $1
       GROUP BY incident_id
     ) AS s
     WHERE i.incident_id = s.incident_id
       AND i.incident_id = $1`,
    [incident_id, event.occurred_at, event.event_id],
  );

  if (res.rowCount !== 1) {
    throw new Error("incident.learning.logged target not found in proj_incidents");
  }
}

async function applyIncidentClosed(tx: DbClient, event: IncidentClosedV1): Promise<void> {
  const incident_id = event.data.incident_id;
  if (!incident_id) throw new Error("incident.closed requires incident_id");

  const res = await tx.query(
    `UPDATE proj_incidents
     SET
       status = 'closed',
       closed_reason = COALESCE($2, closed_reason),
       closed_at = COALESCE(closed_at, $3),
       updated_at = $3,
       last_event_id = $4
     WHERE incident_id = $1
       AND status = 'open'`,
    [incident_id, event.data.reason ?? null, event.occurred_at, event.event_id],
  );

  if (res.rowCount !== 1) {
    throw new Error("incident.closed target not open in proj_incidents");
  }
}

export async function applyIncidentEvent(pool: DbPool, envelope: IncidentEventV1): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await applyInTx(client, envelope);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
