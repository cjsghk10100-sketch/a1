import { loadConfig } from "../src/config.js";
import { createPool } from "../src/db/pool.js";
import { runQueuedRunsWorker } from "../src/runtime/runWorker.js";

function parseWorkspaceId(): string | undefined {
  const raw = process.env.WORKSPACE_ID;
  if (!raw) return undefined;
  const v = raw.trim();
  return v.length ? v : undefined;
}

function parseBatchLimit(): number | undefined {
  const raw = process.env.RUN_WORKER_BATCH_LIMIT;
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) return undefined;
  return Math.floor(value);
}

function parsePollMs(): number {
  const raw = process.env.RUN_WORKER_POLL_MS;
  if (!raw) return 1000;
  const value = Number(raw);
  if (!Number.isFinite(value)) return 1000;
  return Math.max(200, Math.floor(value));
}

function parseOnce(): boolean {
  const raw = process.env.RUN_WORKER_ONCE?.trim().toLowerCase();
  if (!raw) return true;
  if (raw === "0" || raw === "false" || raw === "no") return false;
  return true;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCycleOrLoop(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);

  try {
    const workspace_id = parseWorkspaceId();
    const batch_limit = parseBatchLimit();
    const once = parseOnce();
    const pollMs = parsePollMs();

    do {
      const result = await runQueuedRunsWorker(pool, {
        workspace_id,
        batch_limit,
      });

      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify(
          {
            ok: true,
            once,
            poll_ms: pollMs,
            ...result,
          },
          null,
          2,
        ),
      );

      if (once) break;
      await sleep(pollMs);
    } while (true);
  } finally {
    await pool.end();
  }
}

runCycleOrLoop().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
