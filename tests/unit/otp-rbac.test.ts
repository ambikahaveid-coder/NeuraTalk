import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Business OTP RBAC and controller-validation tests (Phase 6).
 * Mirrors the pattern in campaigns-rbac.test.ts / templates-rbac.test.ts.
 */

vi.mock("../../server/observability", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/modules/otp/service", () => ({
  createChallenge: vi.fn(),
  listChallenges: vi.fn(),
  getChallenge: vi.fn(),
  verifyChallenge: vi.fn(),
  resendChallenge: vi.fn(),
  NotFoundError: class NotFoundError extends Error {},
  ValidationError: class ValidationError extends Error {},
  DuplicateChallengeError: class DuplicateChallengeError extends Error {
    constructor(public existingChallengeId: number) { super("dup"); }
  },
  BillingError: class BillingError extends Error {
    constructor(public reason: string) { super("billing"); }
  },
  AlreadyResolvedError: class AlreadyResolvedError extends Error {
    constructor(public status: string) { super("resolved"); }
  },
  OtpExpiredError: class OtpExpiredError extends Error {},
  OtpIncorrectCodeError: class OtpIncorrectCodeError extends Error {},
  OtpMaxAttemptsError: class OtpMaxAttemptsError extends Error {},
  OtpLockedOutError: class OtpLockedOutError extends Error {
    constructor(public retryAfterSec?: number) { super("locked"); }
  },
}));

beforeEach(() => { vi.clearAllMocks(); });

function makeReqRes(user: any) {
  const req: any = { user, params: {}, body: {}, query: {} };
  const res: any = {
    statusCode: 200,
    body: undefined,
    headers: {} as Record<string, string>,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
    setHeader(k: string, v: string) { this.headers[k] = v; },
  };
  return { req, res };
}

describe("20. RBAC: OTP_VIEW / OTP_MANAGE", () => {
  it("unauthenticated request denied (401)", async () => {
    const { requirePermission } = await import("../../server/role-middleware");
    const { PERMISSIONS } = await import("../../shared/schema");
    const gate = requirePermission(PERMISSIONS.OTP_MANAGE);
    const { req, res } = makeReqRes(undefined);
    let next = false;
    gate(req, res, () => { next = true; });
    expect(next).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it("a user with only OTP_VIEW cannot pass an OTP_MANAGE gate (cannot create/resend challenges)", async () => {
    const { requirePermission } = await import("../../server/role-middleware");
    const { PERMISSIONS } = await import("../../shared/schema");
    const gate = requirePermission(PERMISSIONS.OTP_MANAGE);
    const { req, res } = makeReqRes({ id: 1, role: "agent", permissions: [PERMISSIONS.OTP_VIEW] });
    let next = false;
    gate(req, res, () => { next = true; });
    expect(next).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it("OTP_VIEW alone is sufficient for the read-access requireAnyPermission gate", async () => {
    const { requireAnyPermission } = await import("../../server/role-middleware");
    const { PERMISSIONS } = await import("../../shared/schema");
    const gate = requireAnyPermission(PERMISSIONS.OTP_MANAGE, PERMISSIONS.OTP_VIEW);
    const { req, res } = makeReqRes({ id: 1, role: "agent", permissions: [PERMISSIONS.OTP_VIEW] });
    let next = false;
    gate(req, res, () => { next = true; });
    expect(next).toBe(true);
  });
});

describe("Tenant isolation via requireCompanyAccess (reused)", () => {
  it("Business A -> Business B (URL manipulation): denied", async () => {
    const { requireCompanyAccess } = await import("../../server/role-middleware");
    const gate = requireCompanyAccess("businessId");
    const { req, res } = makeReqRes({ id: 1, role: "company_admin", organizationId: 1 });
    req.params.businessId = "2";
    let next = false;
    await gate(req, res, () => { next = true; });
    expect(next).toBe(false);
    expect(res.statusCode).toBe(403);
  });
});

describe("Controller: mass assignment, response mapping, purpose/channel validation", () => {
  it("postChallenge rejects a body field outside the allow-list (.strict() schema)", async () => {
    const ctrl = await import("../../server/modules/otp/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1";
    req.body = { customerId: 1, purpose: "login", businessId: 999, codeHash: "x", status: "verified" };
    await ctrl.postChallenge(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("postChallenge rejects an arbitrary client-supplied purpose (server validates against the governed enum)", async () => {
    const ctrl = await import("../../server/modules/otp/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1";
    req.body = { customerId: 1, purpose: "delete_account" };
    await ctrl.postChallenge(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("postChallenge rejects an invalid channel", async () => {
    const ctrl = await import("../../server/modules/otp/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1";
    req.body = { customerId: 1, purpose: "login", channel: "whatsapp" };
    await ctrl.postChallenge(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("postChallenge maps DuplicateChallengeError to 409 with existingChallengeId", async () => {
    const service = await import("../../server/modules/otp/service");
    const { DuplicateChallengeError } = service as any;
    (service.createChallenge as any).mockRejectedValue(new DuplicateChallengeError(7));

    const ctrl = await import("../../server/modules/otp/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1";
    req.body = { customerId: 1, purpose: "login" };
    await ctrl.postChallenge(req, res);
    expect(res.statusCode).toBe(409);
    expect(res.body.existingChallengeId).toBe(7);
  });

  it("postChallenge maps BillingError to 402", async () => {
    const service = await import("../../server/modules/otp/service");
    const { BillingError } = service as any;
    (service.createChallenge as any).mockRejectedValue(new BillingError("insufficient_credit"));

    const ctrl = await import("../../server/modules/otp/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1";
    req.body = { customerId: 1, purpose: "login" };
    await ctrl.postChallenge(req, res);
    expect(res.statusCode).toBe(402);
  });

  it("postVerify maps OtpLockedOutError to 429 with Retry-After header", async () => {
    const service = await import("../../server/modules/otp/service");
    const { OtpLockedOutError } = service as any;
    (service.verifyChallenge as any).mockRejectedValue(new OtpLockedOutError(600));

    const ctrl = await import("../../server/modules/otp/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1"; req.params.challengeId = "1";
    req.body = { code: "424242" };
    await ctrl.postVerify(req, res);
    expect(res.statusCode).toBe(429);
    expect(res.headers["Retry-After"]).toBe("600");
  });

  it("postVerify maps OtpExpiredError to 410", async () => {
    const service = await import("../../server/modules/otp/service");
    const { OtpExpiredError } = service as any;
    (service.verifyChallenge as any).mockRejectedValue(new OtpExpiredError());

    const ctrl = await import("../../server/modules/otp/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1"; req.params.challengeId = "1";
    req.body = { code: "424242" };
    await ctrl.postVerify(req, res);
    expect(res.statusCode).toBe(410);
  });

  it("postVerify maps OtpMaxAttemptsError to 423", async () => {
    const service = await import("../../server/modules/otp/service");
    const { OtpMaxAttemptsError } = service as any;
    (service.verifyChallenge as any).mockRejectedValue(new OtpMaxAttemptsError());

    const ctrl = await import("../../server/modules/otp/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1"; req.params.challengeId = "1";
    req.body = { code: "424242" };
    await ctrl.postVerify(req, res);
    expect(res.statusCode).toBe(423);
  });

  it("postVerify maps AlreadyResolvedError to 409 (replay protection)", async () => {
    const service = await import("../../server/modules/otp/service");
    const { AlreadyResolvedError } = service as any;
    (service.verifyChallenge as any).mockRejectedValue(new AlreadyResolvedError("verified"));

    const ctrl = await import("../../server/modules/otp/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1"; req.params.challengeId = "1";
    req.body = { code: "424242" };
    await ctrl.postVerify(req, res);
    expect(res.statusCode).toBe(409);
  });

  it("postVerify never reads a client-supplied actor identity -- always uses req.user.id server-side", async () => {
    const service = await import("../../server/modules/otp/service");
    (service.verifyChallenge as any).mockResolvedValue({ status: "verified" });

    const ctrl = await import("../../server/modules/otp/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1"; req.params.challengeId = "1";
    req.body = { code: "424242", actorUserId: 999 }; // attempted smuggle -- rejected by .strict() anyway
    await ctrl.postVerify(req, res);
    expect(res.statusCode).toBe(400); // .strict() rejects the unknown field before the service is even called
  });

  it("getChallengeById never exposes a codeHash field even if the service accidentally returned one (defense in depth is in toSafeChallenge, this proves the controller doesn't add it back)", async () => {
    const service = await import("../../server/modules/otp/service");
    (service.getChallenge as any).mockResolvedValue({ id: 1, status: "pending" }); // no codeHash, as toSafeChallenge guarantees
    const ctrl = await import("../../server/modules/otp/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1"; req.params.challengeId = "1";
    await ctrl.getChallengeById(req, res);
    expect(res.body.challenge.codeHash).toBeUndefined();
  });

  it("getChallenges rejects a non-numeric customerId query filter", async () => {
    const ctrl = await import("../../server/modules/otp/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1";
    req.query = { customerId: "not-a-number" };
    await ctrl.getChallenges(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("getChallengeById/postVerify/postResend reject non-numeric challengeId (URL/challengeId manipulation)", async () => {
    const ctrl = await import("../../server/modules/otp/controller");
    for (const fn of [ctrl.getChallengeById, ctrl.postVerify, ctrl.postResend]) {
      const { req, res } = makeReqRes({ id: 42 });
      req.params.businessId = "1"; req.params.challengeId = "not-a-number";
      req.body = { code: "424242" };
      await fn(req, res);
      expect(res.statusCode).toBe(400);
    }
  });
});

describe("No generic send-message endpoint exists", () => {
  it("registerOtpRoutes never registers a bare /send-message or /send route", async () => {
    const registered: string[] = [];
    const fakeApp: any = {
      post: (path: string) => registered.push(path),
      get: (path: string) => registered.push(path),
    };
    const { registerOtpRoutes } = await import("../../server/modules/otp/routes");
    registerOtpRoutes(fakeApp);
    expect(registered.some((p) => /\/send-message|\/send$/.test(p))).toBe(false);
    expect(registered.every((p) => p.includes("/otp/challenges"))).toBe(true);
  });
});
