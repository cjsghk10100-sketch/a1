import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

const { Client } = pg;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    // Avoid printing secrets or full env dumps.
    throw new Error(`${name} is required`);
  }
  return value;
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv("DATABASE_URL");

  const migrationsDir = path.resolve(process.cwd(), "migrations");
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );`,
    );

    const applied = await client.query<{ version: string }>(
      "SELECT version FROM schema_migrations ORDER BY version ASC",
    );
    const appliedSet = new Set(applied.rows.map((r) => r.version));

    for (const file of files) {
      if (appliedSet.has(file)) continue;

      const fullPath = path.join(migrationsDir, file);
      const sql = await readFile(fullPath, "utf8");

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
        await client.query("COMMIT");
        // Keep logs terse; don't print env vars or SQL contents.
        // eslint-disable-next-line no-console
        console.log(`applied ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
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
