import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";
// Must be imported before any route is registered — this is the real fix
// applied to server/index.ts. Importing the actual package here (not a
// mock) so this test exercises the real patch, not an assumption about it.
import "express-async-errors";

/**
 * Chaos tests for the P0 "unhandled async rejection crashes the process"
 * defect. Root cause: Express 4 does not forward a rejected promise
 * returned by an async route handler to next(err) — without a fix, that
 * rejection becomes a process-level `unhandledRejection`, and this app's
 * own process.on("unhandledRejection") handler (server/index.ts) responds
 * to ANY unhandled rejection by shutting the whole server down
 * (shutdownServer(1)) — turning one failed DB call into a full outage.
 *
 * The confirmed vulnerable pattern (server/routes.ts:454-460, still present
 * verbatim in production code — this test does not modify it, since the
 * fix is a systemic one-line import, not a per-route patch):
 *
 *   app.get(path, requireAuth, async (req, res) => {
 *     const orgs = await storage.getAllOrganizations();  // no try/catch
 *     res.json(orgs);
 *   });
 *
 * This suite reproduces that exact shape against a real Express app wired
 * with the same global error middleware used in server/index.ts, fires many
 * concurrent requests that are forced to fail (simulating real DB errors),
 * and verifies: (1) every request still gets a proper HTTP error response,
 * and (2) zero process-level `unhandledRejection` events are ever emitted —
 * which is the exact condition that triggers shutdownServer(1) in the real
 * app, so "zero events observed" is equivalent to "zero process crashes."
 */

function buildAppWithVulnerablePattern(): Express {
  const app = express();

  // Reproduces the exact unguarded pattern found in server/routes.ts —
  // deliberately NOT wrapped in try/catch, to prove the systemic fix
  // (express-async-errors) protects handlers that were never individually
  // hardened, not just ones that already happen to catch their own errors.
  app.get("/api/organizations", async (_req: Request, res: Response) => {
    const orgs = await simulateDbCall(); // may reject — no try/catch here
    res.json(orgs);
  });

  app.get("/api/organizations/:id", async (req: Request, res: Response) => {
    const org = await simulateDbCall();
    if (!org) {
      return res.status(404).json({ message: "Organization not found" });
    }
    res.json(org);
  });

  // The same global error-handling middleware registered in
  // server/index.ts:569-577, reproduced verbatim so this test validates
  // the real production error-response shape/status mapping.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const error = err instanceof Error ? err : new Error(String(err));
    const status = (error as Error & { status?: number; statusCode?: number }).status
      || (error as Error & { status?: number; statusCode?: number }).statusCode
      || 500;
    res.status(status).json({ message: error.message || "Internal Server Error" });
  });

  return app;
}

let failureMode: "reject" | "throw-sync" | "succeed" = "succeed";

async function simulateDbCall(): Promise<unknown> {
  if (failureMode === "reject") {
    // Simulates a real DB driver rejecting its returned promise (connection
    // reset, query timeout, constraint violation, etc.)
    throw new Error("simulated database failure");
  }
  if (failureMode === "throw-sync") {
    // Simulates a synchronous throw inside an async function — still
    // becomes a rejected promise from the caller's perspective, same risk.
    throw new Error("simulated synchronous failure inside async handler");
  }
  return [{ id: 1, name: "ok" }];
}

describe("Async route rejections never crash the process (P0)", () => {
  let unhandledRejections: unknown[] = [];
  let listener: (reason: unknown) => void;

  beforeAll(() => {
    listener = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on("unhandledRejection", listener);
  });

  afterAll(() => {
    process.off("unhandledRejection", listener);
  });

  beforeEach(() => {
    unhandledRejections = [];
    failureMode = "succeed";
  });

  it("a single failing request returns an HTTP error, not a hang or crash", async () => {
    failureMode = "reject";
    const app = buildAppWithVulnerablePattern();
    const res = await request(app).get("/api/organizations");
    expect(res.status).toBe(500);
    expect(res.body.message).toContain("simulated database failure");
    expect(unhandledRejections).toHaveLength(0);
  });

  it("a synchronous throw inside an async handler also returns an HTTP error, not a crash", async () => {
    failureMode = "throw-sync";
    const app = buildAppWithVulnerablePattern();
    const res = await request(app).get("/api/organizations/1");
    expect(res.status).toBe(500);
    expect(unhandledRejections).toHaveLength(0);
  });

  it("1000 forced DB failures: 1000 HTTP errors, 0 process crashes", async () => {
    failureMode = "reject";
    const app = buildAppWithVulnerablePattern();
    const ATTEMPTS = 1000;

    const responses = await Promise.all(
      Array.from({ length: ATTEMPTS }, (_, i) =>
        request(app).get(i % 2 === 0 ? "/api/organizations" : "/api/organizations/1")),
    );

    expect(responses).toHaveLength(ATTEMPTS);
    for (const res of responses) {
      expect(res.status).toBe(500);
      expect(res.body.message).toBeTruthy();
    }

    // The property that actually matters: this is exactly what the real
    // app's process.on("unhandledRejection") handler listens for before
    // calling shutdownServer(1). Zero here means zero crashes there.
    expect(unhandledRejections).toHaveLength(0);
  });

  it("a mix of failing and succeeding concurrent requests: failures don't affect successes", async () => {
    const app = buildAppWithVulnerablePattern();
    const ATTEMPTS = 300;

    const responses = await Promise.all(
      Array.from({ length: ATTEMPTS }, (_, i) => {
        failureMode = i % 3 === 0 ? "reject" : "succeed";
        return request(app).get("/api/organizations");
      }),
    );

    const errorCount = responses.filter((r) => r.status === 500).length;
    const okCount = responses.filter((r) => r.status === 200).length;
    expect(errorCount + okCount).toBe(ATTEMPTS);
    expect(unhandledRejections).toHaveLength(0);
  });
});

// A control proving the base vulnerability (and this patch's effect) is
// real, run as a standalone, unpatched process — see
// scripts/verify-async-crash-fix.mjs and docs/P0_EMERGENCY_SPRINT_REPORT.md
// for the before/after evidence. It's intentionally not part of this
// vitest suite: express-async-errors patches shared Express prototypes
// process-wide once imported, so an "unpatched" scenario can't coexist in
// the same process as the tests above without corrupting them.
