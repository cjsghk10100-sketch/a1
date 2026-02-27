import { randomUUID } from "node:crypto";

import type { DbPool } from "../db/pool.js";

export class LockLostError extends Error {
  constructor(message = "cron_lock_lost") {
    super(message);
    this.name = "LockLostError";
  }
}

function isUniqueLockConflict(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  return (err as { code?: string }).code === "23505";
}

export async function acquireLock(
  pool: DbPool,
  lock_name: string,
  holder_id: string,
  lockLeaseMs: number,
): Promise<{ lock_token: string } | null> {
  const lock_token = randomUUID();
  try {
    const insert = await pool.query<{ lock_token: string }>(
      `INSERT INTO cron_locks (
         lock_name,
         holder_id,
         lock_token,
         acquired_at,
         expires_at,
         heartbeat_at
       ) VALUES (
         $1,
         $2,
         $3,
         now(),
         now() + ($4::double precision * interval '1 millisecond'),
         now()
       )
       RETURNING lock_token`,
      [lock_name, holder_id, lock_token, lockLeaseMs],
    );
    if (insert.rowCount === 1) return { lock_token: insert.rows[0].lock_token };
    return null;
  } catch (err) {
    if (!isUniqueLockConflict(err)) throw err;
  }

  const steal = await pool.query<{ lock_token: string }>(
    `UPDATE cron_locks
     SET
       holder_id = $2,
       lock_token = $3,
       acquired_at = now(),
       heartbeat_at = now(),
       expires_at = now() + ($4::double precision * interval '1 millisecond')
     WHERE lock_name = $1
       AND expires_at < now()
     RETURNING lock_token`,
    [lock_name, holder_id, lock_token, lockLeaseMs],
  );
  if (steal.rowCount === 1) return { lock_token: steal.rows[0].lock_token };
  return null;
}

export async function heartbeatLock(
  pool: DbPool,
  lock_name: string,
  lock_token: string,
  lockLeaseMs: number,
): Promise<void> {
  const updated = await pool.query(
    `UPDATE cron_locks
     SET
       heartbeat_at = now(),
       expires_at = now() + ($3::double precision * interval '1 millisecond')
     WHERE lock_name = $1
       AND lock_token = $2`,
    [lock_name, lock_token, lockLeaseMs],
  );
  if (updated.rowCount === 0) {
    throw new LockLostError();
  }
}

export async function releaseLock(
  pool: DbPool,
  lock_name: string,
  lock_token: string,
): Promise<void> {
  await pool.query(
    `DELETE FROM cron_locks
     WHERE lock_name = $1
       AND lock_token = $2`,
    [lock_name, lock_token],
  );
}
