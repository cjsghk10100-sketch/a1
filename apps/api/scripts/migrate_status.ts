import { readdir } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

const { Client } = pg;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv("DATABASE_URL");
  const migrationsDir = path.resolve(process.cwd(), "migrations");

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );`,
    );

    const disk = (await readdir(migrationsDir))
      .filter((f) => f.endsWith(".sql"))
      .sort((a, b) => a.localeCompare(b));

    const applied = await client.query<{ version: string; applied_at: string }>(
      "SELECT version, applied_at FROM schema_migrations ORDER BY applied_at ASC",
    );
    const appliedSet = new Set(applied.rows.map((r) => r.version));

    // eslint-disable-next-line no-console
    console.log("Applied:");
    for (const row of applied.rows) {
      // eslint-disable-next-line no-console
      console.log(`- ${row.version}`);
    }

    // eslint-disable-next-line no-console
    console.log("\nPending:");
    const pending = disk.filter((f) => !appliedSet.has(f));
    if (pending.length === 0) {
      // eslint-disable-next-line no-console
      console.log("- (none)");
      return;
    }
    for (const f of pending) {
      // eslint-disable-next-line no-console
      console.log(`- ${f}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
