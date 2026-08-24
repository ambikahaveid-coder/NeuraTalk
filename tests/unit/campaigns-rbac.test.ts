import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Business Campaign Engine RBAC and controller-validation tests (Phase 5).
 * Mirrors the pattern in templates-rbac.test.ts / approvals-rbac.test.ts.
 */

vi.mock("../../server/observability", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/modules/campaigns/service", () => ({
  createCampaign: vi.fn(),
  listCampaigns: vi.fn(),
  getCampaign: vi.fn(),
  updateCampaign: vi.fn(),
  scheduleCampaign: vi.fn(),
  cancelCampaign: vi.fn(),
  executeCampaign: vi.fn(),
  NotFoundError: class NotFoundError extends Error {},
  ValidationError: class ValidationError extends Error {},
  IllegalCampaignTransitionError: class IllegalCampaignTransitionError extends Error {},
}));

beforeEach(() => { vi.clearAllMocks(); });

function makeReqRes(user: any) {
  const req: any = { user, params: {}, body: {}, query: {} };
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
  return { req, res };
}

describe("13. RBAC: CAMPAIGNS_VIEW / CAMPAIGNS_MANAGE / CAMPAIGNS_EXECUTE", () => {
  it("unauthenticated request denied (401)", async () => {
    const { requirePermission } = await import("../../server/role-middleware");
    const { PERMISSIONS } = await import("../../shared/schema");
    const gate = requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE);
    const { req, res } = makeReqRes(undefined);
    let next = false;
    gate(req, res, () => { next = true; });
    expect(next).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it("a user with only CAMPAIGNS_MANAGE cannot pass a CAMPAIGNS_EXECUTE gate -- editing a campaign never implies the authority to run it", async () => {
    const { requirePermission } = await import("../../server/role-middleware");
    const { PERMISSIONS } = await import("../../shared/schema");
    const gate = requirePermission(PERMISSIONS.CAMPAIGNS_EXECUTE);
    const { req, res } = makeReqRes({ id: 1, role: "manager", permissions: [PERMISSIONS.CAMPAIGNS_MANAGE] });
    let next = false;
    gate(req, res, () => { next = true; });
    expect(next).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it("a user with CAMPAIGNS_EXECUTE alone cannot pass a CAMPAIGNS_MANAGE gate (edit != execute, both directions)", async () => {
    const { requirePermission } = await import("../../server/role-middleware");
    const { PERMISSIONS } = await import("../../shared/schema");
    const gate = requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE);
    const { req, res } = makeReqRes({ id: 1, role: "manager", permissions: [PERMISSIONS.CAMPAIGNS_EXECUTE] });
    let next = false;
    gate(req, res, () => { next = true; });
    expect(next).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it("CAMPAIGNS_VIEW alone is sufficient to pass the read-access requireAnyPermission gate", async () => {
    const { requireAnyPermission } = await import("../../server/role-middleware");
    const { PERMISSIONS } = await import("../../shared/schema");
    const gate = requireAnyPermission(PERMISSIONS.CAMPAIGNS_MANAGE, PERMISSIONS.CAMPAIGNS_EXECUTE, PERMISSIONS.CAMPAIGNS_VIEW);
    const { req, res } = makeReqRes({ id: 1, role: "agent", permissions: [PERMISSIONS.CAMPAIGNS_VIEW] });
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

describe("14/16/17. Controller: mass assignment, businessId/actor-identity injection, transition mapping", () => {
  it("postCampaign rejects a body field outside the allow-list (.strict() schema)", async () => {
    const ctrl = await import("../../server/modules/campaigns/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1";
    req.body = { name: "X", category: "marketing", businessId: 999, status: "running", createdBy: 5 };
    await ctrl.postCampaign(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("postCampaign rejects an out-of-scope category (authentication/utility-only-not-marketing edge is fine, but arbitrary strings are not)", async () => {
    const ctrl = await import("../../server/modules/campaigns/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1";
    req.body = { name: "X", category: "conversational" };
    await ctrl.postCampaign(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("patchCampaign schema has NO senderParticipantId, generationSource, or actor-identity field -- structurally impossible to inject (doc 25/30 section 17 compliance)", async () => {
    const ctrl = await import("../../server/modules/campaigns/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1"; req.params.campaignId = "1";
    req.body = { name: "X", senderParticipantId: 999, generationSource: { type: "campaign", id: 1 }, actorUserId: 999 };
    await ctrl.patchCampaign(req, res);
    expect(res.statusCode).toBe(400); // .strict() rejects the unknown fields outright
  });

  it("postExecute never reads a client-supplied actor identity -- always uses req.user.id server-side", async () => {
    const service = await import("../../server/modules/campaigns/service");
    (service.executeCampaign as any).mockResolvedValue({ campaignStatus: "completed", processed: 1, sent: 1, skipped: 0 });

    const ctrl = await import("../../server/modules/campaigns/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1"; req.params.campaignId = "1";
    req.body = { actorUserId: 999, userId: 999 }; // attempted smuggle -- controller doesn't read this
    await ctrl.postExecute(req, res);

    const callArgs = (service.executeCampaign as any).mock.calls[0];
    expect(callArgs[1]).toBe(42); // req.user.id, not anything from the body
  });

  it("postSchedule maps IllegalCampaignTransitionError to 409", async () => {
    const service = await import("../../server/modules/campaigns/service");
    const { IllegalCampaignTransitionError } = service as any;
    (service.scheduleCampaign as any).mockRejectedValue(new IllegalCampaignTransitionError());

    const ctrl = await import("../../server/modules/campaigns/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1"; req.params.campaignId = "1";
    req.body = { scheduledAt: new Date(Date.now() + 3600_000).toISOString() };
    await ctrl.postSchedule(req, res);
    expect(res.statusCode).toBe(409);
  });

  it("postSchedule rejects a malformed scheduledAt before reaching the service", async () => {
    const ctrl = await import("../../server/modules/campaigns/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1"; req.params.campaignId = "1";
    req.body = { scheduledAt: "not-a-date" };
    await ctrl.postSchedule(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("getCampaigns rejects an invalid status filter (query manipulation)", async () => {
    const ctrl = await import("../../server/modules/campaigns/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1";
    req.query = { status: "not_a_real_status" };
    await ctrl.getCampaigns(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("getCampaignById/patchCampaign/postSchedule/postCancel/postExecute all reject non-numeric campaignId (URL/campaignId manipulation)", async () => {
    const ctrl = await import("../../server/modules/campaigns/controller");
    for (const fn of [ctrl.getCampaignById, ctrl.patchCampaign, ctrl.postSchedule, ctrl.postCancel, ctrl.postExecute]) {
      const { req, res } = makeReqRes({ id: 42 });
      req.params.businessId = "1"; req.params.campaignId = "not-a-number";
      req.body = { scheduledAt: new Date(Date.now() + 3600_000).toISOString() };
      await fn(req, res);
      expect(res.statusCode).toBe(400);
    }
  });
});

describe("No generic send-message endpoint exists", () => {
  it("registerCampaignRoutes never registers a bare /send-message or /send route", async () => {
    const registered: string[] = [];
    const fakeApp: any = {
      post: (path: string) => registered.push(path),
      get: (path: string) => registered.push(path),
      patch: (path: string) => registered.push(path),
      delete: (path: string) => registered.push(path),
    };
    const { registerCampaignRoutes } = await import("../../server/modules/campaigns/routes");
    registerCampaignRoutes(fakeApp);
    expect(registered.some((p) => /\/send-message|\/send$/.test(p))).toBe(false);
    expect(registered.every((p) => p.includes("/campaigns"))).toBe(true);
  });
});
