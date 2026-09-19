import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const b2bRoutesSource = readFileSync(resolve(process.cwd(), "server/b2b-routes.ts"), "utf8");
const queueHandlerStart = b2bRoutesSource.indexOf('app.get("/api/b2b/call-queue"');
const queueHandlerEnd = b2bRoutesSource.indexOf('app.post("/api/b2b/outbound-call"', queueHandlerStart);
const queueHandler = b2bRoutesSource.slice(queueHandlerStart, queueHandlerEnd);

const assignmentStart = b2bRoutesSource.indexOf('app.post("/api/b2b/call-queue/:id/assign"');
const assignmentEnd = b2bRoutesSource.indexOf('app.post("/api/b2b/translation-routes"', assignmentStart);
const assignmentHandlers = b2bRoutesSource.slice(assignmentStart, assignmentEnd);

describe("Phase A canonical B2B queue source", () => {
  it("reads the control-room queue from queuedCalls and callQueues, not bridgedCalls", () => {
    expect(queueHandler).toContain("queuedCalls");
    expect(queueHandler).toContain("callQueues");
    expect(queueHandler).toContain("queuedCalls.organizationId");
    expect(queueHandler).not.toContain("bridgedCalls");
  });

  it("routes manual and automatic assignment through the canonical assignment service", () => {
    expect(assignmentHandlers).toContain("assignQueuedCallToAgent");
    expect(assignmentHandlers).toContain("queuedCalls.organizationId");
    expect(assignmentHandlers).not.toContain("db.update(bridgedCalls)");
  });
});
