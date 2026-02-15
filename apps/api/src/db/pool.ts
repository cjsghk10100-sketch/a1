import pg from "pg";

const { Pool } = pg;

export type DbPool = pg.Pool;

export function createPool(databaseUrl: string): DbPool {
  return new Pool({ connectionString: databaseUrl });
}
