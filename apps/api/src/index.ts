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
  // Avoid logging env, but keep the message.
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
