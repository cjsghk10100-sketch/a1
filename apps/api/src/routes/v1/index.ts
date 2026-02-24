import type { FastifyInstance } from "fastify";

import type { AppConfig } from "../../config.js";
import type { DbPool } from "../../db/pool.js";
import { registerActionRegistryRoutes } from "./actionRegistry.js";
import { registerAgentRoutes } from "./agents.js";
import { registerApprovalRoutes } from "./approvals.js";
import { registerArtifactRoutes } from "./artifacts.js";
import { registerAuthRoutes } from "./auth.js";
import { registerAuditRoutes } from "./audit.js";
import { registerCapabilityRoutes } from "./capabilities.js";
import { registerDataAccessRoutes } from "./dataAccess.js";
import { registerDiscordIngestRoutes } from "./discordIngest.js";
import { registerEvidenceRoutes } from "./evidence.js";
import { registerEgressRoutes } from "./egress.js";
import { registerEngineRoutes } from "./engines.js";
import { registerEventRoutes } from "./events.js";
import { registerIncidentRoutes } from "./incidents.js";
import { registerLifecycleRoutes } from "./lifecycle.js";
import { registerPolicyRoutes } from "./policy.js";
import { registerPrincipalRoutes } from "./principals.js";
import { registerResourceLabelRoutes } from "./resourceLabels.js";
import { registerRunRoutes } from "./runs.js";
import { registerSearchRoutes } from "./search.js";
import { registerSnapshotRoutes } from "./snapshots.js";
import { registerSurvivalRoutes } from "./survival.js";
import { registerSecretRoutes } from "./secrets.js";
import { registerSkillsLedgerRoutes } from "./skillsLedger.js";
import { registerSkillPackageRoutes } from "./skillPackages.js";
import { registerToolCallRoutes } from "./toolcalls.js";
import { registerRoomRoutes } from "./rooms.js";
import { registerStreamRoutes } from "./streams.js";
import { registerThreadRoutes } from "./threads.js";
import { registerTrustRoutes } from "./trust.js";

export async function registerV1Routes(
  app: FastifyInstance,
  pool: DbPool,
  config: AppConfig,
): Promise<void> {
  await registerAuthRoutes(app, pool, config);
  await registerActionRegistryRoutes(app, pool);
  await registerAgentRoutes(app, pool);
  await registerApprovalRoutes(app, pool);
  await registerArtifactRoutes(app, pool);
  await registerAuditRoutes(app, pool);
  await registerCapabilityRoutes(app, pool);
  await registerDataAccessRoutes(app, pool);
  await registerDiscordIngestRoutes(app, pool);
  await registerEvidenceRoutes(app, pool);
  await registerEgressRoutes(app, pool);
  await registerEngineRoutes(app, pool);
  await registerEventRoutes(app, pool);
  await registerIncidentRoutes(app, pool);
  await registerLifecycleRoutes(app, pool);
  await registerPolicyRoutes(app, pool);
  await registerPrincipalRoutes(app, pool);
  await registerResourceLabelRoutes(app, pool);
  await registerRunRoutes(app, pool);
  await registerSearchRoutes(app, pool);
  await registerSnapshotRoutes(app, pool);
  await registerSurvivalRoutes(app, pool);
  await registerSecretRoutes(app, pool);
  await registerSkillsLedgerRoutes(app, pool);
  await registerSkillPackageRoutes(app, pool);
  await registerToolCallRoutes(app, pool);
  await registerRoomRoutes(app, pool);
  await registerStreamRoutes(app, pool);
  await registerThreadRoutes(app, pool);
  await registerTrustRoutes(app, pool);
}
