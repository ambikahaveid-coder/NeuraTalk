import type { Express } from "express";
import { loadUser, requireAuth } from "../../role-middleware";
import { queueJoinLimiter } from "../../rate-limit";
import * as ctrl from "./queue-controller";

export function registerQueueRoutes(app: Express): void {
  app.post("/api/queues/:queueId/join", loadUser, requireAuth, queueJoinLimiter, ctrl.joinQueue);
  app.get("/api/queues/:queueId/status/:callId", loadUser, requireAuth, ctrl.getStatus);
  app.post("/api/queues/calls/:callId/abandon", loadUser, requireAuth, ctrl.abandon);
}
