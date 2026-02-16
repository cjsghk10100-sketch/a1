import { loadConfig } from "../src/config.js";
import { createPool } from "../src/db/pool.js";
import { runDailySnapshotJob } from "../src/snapshots/daily.js";

function parseWorkspaceId(): string | undefined {
  const raw = process.env.WORKSPACE_ID;
  if (!raw) return undefined;
  const v = raw.trim();
  return v.length ? v : undefined;
}

function parseSnapshotDate(): string | undefined {
  const raw = process.env.SNAPSHOT_DATE;
  if (!raw) return undefined;
  const v = raw.trim();
  if (!v) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw new Error("SNAPSHOT_DATE must be YYYY-MM-DD");
  }
  return v;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);

  try {
    const result = await runDailySnapshotJob(pool, {
      workspace_id: parseWorkspaceId(),
      snapshot_date: parseSnapshotDate(),
    });
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          ok: true,
          workspace_id: result.workspace_id,
          snapshot_date: result.snapshot_date,
          scanned_agents: result.scanned_agents,
          written_rows: result.written_rows,
          unchanged_rows: result.unchanged_rows,
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
