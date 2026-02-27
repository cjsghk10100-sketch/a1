import { loadConfig } from "../src/config.js";
import { tickHeartCron } from "../src/cron/heartCron.js";
import { createPool } from "../src/db/pool.js";

async function run(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  try {
    await tickHeartCron(pool);
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
