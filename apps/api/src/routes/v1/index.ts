import type { FastifyInstance } from "fastify";

import type { DbPool } from "../../db/pool.js";
import { registerActionRegistryRoutes } from "./actionRegistry.js";
import { registerApprovalRoutes } from "./approvals.js";
import { registerArtifactRoutes } from "./artifacts.js";
import { registerEventRoutes } from "./events.js";
import { registerPolicyRoutes } from "./policy.js";
import { registerRunRoutes } from "./runs.js";
import { registerToolCallRoutes } from "./toolcalls.js";
import { registerRoomRoutes } from "./rooms.js";
import { registerStreamRoutes } from "./streams.js";
import { registerThreadRoutes } from "./threads.js";

export async function registerV1Routes(app: FastifyInstance, pool: DbPool): Promise<void> {
  await registerActionRegistryRoutes(app, pool);
  await registerApprovalRoutes(app, pool);
  await registerArtifactRoutes(app, pool);
  await registerEventRoutes(app, pool);
  await registerPolicyRoutes(app, pool);
  await registerRunRoutes(app, pool);
  await registerToolCallRoutes(app, pool);
  await registerRoomRoutes(app, pool);
  await registerStreamRoutes(app, pool);
  await registerThreadRoutes(app, pool);
}
