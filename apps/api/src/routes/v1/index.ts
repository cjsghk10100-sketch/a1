import type { FastifyInstance } from "fastify";

import type { DbPool } from "../../db/pool.js";
import { registerRoomRoutes } from "./rooms.js";
import { registerStreamRoutes } from "./streams.js";
import { registerThreadRoutes } from "./threads.js";

export async function registerV1Routes(app: FastifyInstance, pool: DbPool): Promise<void> {
  await registerRoomRoutes(app, pool);
  await registerStreamRoutes(app, pool);
  await registerThreadRoutes(app, pool);
}
