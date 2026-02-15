import type { FastifyInstance } from "fastify";

import type { DbPool } from "../../db/pool.js";
import { registerApprovalRoutes } from "./approvals.js";
import { registerEventRoutes } from "./events.js";
import { registerPolicyRoutes } from "./policy.js";
import { registerRunRoutes } from "./runs.js";
import { registerRoomRoutes } from "./rooms.js";
import { registerStreamRoutes } from "./streams.js";
import { registerThreadRoutes } from "./threads.js";

export async function registerV1Routes(app: FastifyInstance, pool: DbPool): Promise<void> {
  await registerApprovalRoutes(app, pool);
  await registerEventRoutes(app, pool);
  await registerPolicyRoutes(app, pool);
  await registerRunRoutes(app, pool);
  await registerRoomRoutes(app, pool);
  await registerStreamRoutes(app, pool);
  await registerThreadRoutes(app, pool);
}
