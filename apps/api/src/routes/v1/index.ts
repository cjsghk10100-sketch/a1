import type { FastifyInstance } from "fastify";

import type { DbPool } from "../../db/pool.js";
import { registerActionRegistryRoutes } from "./actionRegistry.js";
import { registerAgentRoutes } from "./agents.js";
import { registerApprovalRoutes } from "./approvals.js";
import { registerArtifactRoutes } from "./artifacts.js";
import { registerCapabilityRoutes } from "./capabilities.js";
import { registerDataAccessRoutes } from "./dataAccess.js";
import { registerEgressRoutes } from "./egress.js";
import { registerEventRoutes } from "./events.js";
import { registerPolicyRoutes } from "./policy.js";
import { registerResourceLabelRoutes } from "./resourceLabels.js";
import { registerRunRoutes } from "./runs.js";
import { registerSnapshotRoutes } from "./snapshots.js";
import { registerSecretRoutes } from "./secrets.js";
import { registerSkillsLedgerRoutes } from "./skillsLedger.js";
import { registerSkillPackageRoutes } from "./skillPackages.js";
import { registerToolCallRoutes } from "./toolcalls.js";
import { registerRoomRoutes } from "./rooms.js";
import { registerStreamRoutes } from "./streams.js";
import { registerThreadRoutes } from "./threads.js";
import { registerTrustRoutes } from "./trust.js";

export async function registerV1Routes(app: FastifyInstance, pool: DbPool): Promise<void> {
  await registerActionRegistryRoutes(app, pool);
  await registerAgentRoutes(app, pool);
  await registerApprovalRoutes(app, pool);
  await registerArtifactRoutes(app, pool);
  await registerCapabilityRoutes(app, pool);
  await registerDataAccessRoutes(app, pool);
  await registerEgressRoutes(app, pool);
  await registerEventRoutes(app, pool);
  await registerPolicyRoutes(app, pool);
  await registerResourceLabelRoutes(app, pool);
  await registerRunRoutes(app, pool);
  await registerSnapshotRoutes(app, pool);
  await registerSecretRoutes(app, pool);
  await registerSkillsLedgerRoutes(app, pool);
  await registerSkillPackageRoutes(app, pool);
  await registerToolCallRoutes(app, pool);
  await registerRoomRoutes(app, pool);
  await registerStreamRoutes(app, pool);
  await registerThreadRoutes(app, pool);
  await registerTrustRoutes(app, pool);
}
