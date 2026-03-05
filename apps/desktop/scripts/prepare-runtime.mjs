import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const desktopRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopRoot, "../..");
const opsDistDir = path.join(repoRoot, "apps/ops-dashboard/dist");
const runtimeDir = path.join(desktopRoot, "runtime", "ops-dashboard");

await rm(runtimeDir, { recursive: true, force: true });
await mkdir(path.dirname(runtimeDir), { recursive: true });
await cp(opsDistDir, runtimeDir, { recursive: true });

process.stdout.write(`[desktop] runtime assets prepared: ${runtimeDir}\n`);
