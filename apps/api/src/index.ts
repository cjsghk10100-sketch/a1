import { loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const app = await buildServer({ config, pool });

  await app.listen({
    host: "0.0.0.0",
    port: config.port,
  });
}

main().catch((err) => {
  const err_name = err instanceof Error ? err.name : "Error";
  // eslint-disable-next-line no-console
  console.error(`api_bootstrap_failed:${err_name}`);
  process.exitCode = 1;
});
