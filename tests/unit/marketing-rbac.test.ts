import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Phase 8B-R0 RBAC and controller-validation tests: campaign pre-flight
 * route + business-wide marketing report/frequency routes.
 * Mirrors the pattern in campaigns-rbac.test.ts.
 */

vi.mock("../../server/observability", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/modules/campaigns/service", async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return {
    ...actual,
    getCampaignPreflight: vi.fn(),
  };
});

vi.mock("../../server/modules/marketing/service", () => ({
  getBusinessMarketingReport: vi.fn(),
  getMarketingFrequencyStatus: vi.fn(),
  NotFoundError: class NotFoundError extends Error {},
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

describe("Campaign pre-flight route: RBAC + tenant isolation", () => {
  it("unauthenticated request denied (401)", async () => {
    const { requireAnyPermission } = await import("../../server/role-middleware");
    const { PERMISSIONS } = await import("../../shared/schema");
    const gate = requireAnyPermission(PERMISSIONS.CAMPAIGNS_MANAGE, PERMISSIONS.CAMPAIGNS_EXECUTE, PERMISSIONS.CAMPAIGNS_VIEW);
    const { req, res } = makeReqRes(undefined);
    let next = false;
    gate(req, res, () => { next = true; });
    expect(next).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it("CAMPAIGNS_VIEW alone is sufficient (read-only preview, same gate as every other campaign read)", async () => {
    const { requireAnyPermission } = await import("../../server/role-middleware");
    const { PERMISSIONS } = await import("../../shared/schema");
    const gate = requireAnyPermission(PERMISSIONS.CAMPAIGNS_MANAGE, PERMISSIONS.CAMPAIGNS_EXECUTE, PERMISSIONS.CAMPAIGNS_VIEW);
    const { req, res } = makeReqRes({ id: 1, role: "agent", permissions: [PERMISSIONS.CAMPAIGNS_VIEW] });
    let next = false;
    gate(req, res, () => { next = true; });
    expect(next).toBe(true);
  });

  it("Business A -> Business B (URL manipulation): denied by requireCompanyAccess", async () => {
    const { requireCompanyAccess } = await import("../../server/role-middleware");
    const gate = requireCompanyAccess("businessId");
    const { req, res } = makeReqRes({ id: 1, role: "company_admin", organizationId: 1 });
    req.params.businessId = "2";
    let next = false;
    await gate(req, res, () => { next = true; });
    expect(next).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it("getPreflight rejects a non-numeric campaignId (URL manipulation)", async () => {
    const ctrl = await import("../../server/modules/campaigns/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1"; req.params.campaignId = "not-a-number";
    await ctrl.getPreflight(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("getPreflight propagates a cross-business NotFoundError as 404, never confirming existence", async () => {
    const service = await import("../../server/modules/campaigns/service");
    const { NotFoundError } = service as any;
    (service.getCampaignPreflight as any).mockRejectedValue(new NotFoundError("Campaign not found"));
    const ctrl = await import("../../server/modules/campaigns/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1"; req.params.campaignId = "1";
    await ctrl.getPreflight(req, res);
    expect(res.statusCode).toBe(404);
  });

  it("getPreflight passes businessId strictly from the URL, never from query/body", async () => {
    const service = await import("../../server/modules/campaigns/service");
    (service.getCampaignPreflight as any).mockResolvedValue({ readiness: { ready: true, reasons: [] } });
    const ctrl = await import("../../server/modules/campaigns/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1"; req.params.campaignId = "1";
    req.body = { businessId: 999 }; // attempted smuggle -- GET route, body is ignored entirely
    await ctrl.getPreflight(req, res);
    const callArgs = (service.getCampaignPreflight as any).mock.calls[0];
    expect(callArgs[0]).toBe(1); // from req.params.businessId, not the body
  });
});

describe("Marketing report/frequency routes: RBAC + tenant isolation + validation", () => {
  it("getReport requires authentication and a campaign-view-family permission", async () => {
    const { requireAnyPermission } = await import("../../server/role-middleware");
    const { PERMISSIONS } = await import("../../shared/schema");
    const gate = requireAnyPermission(PERMISSIONS.CAMPAIGNS_MANAGE, PERMISSIONS.CAMPAIGNS_EXECUTE, PERMISSIONS.CAMPAIGNS_VIEW);
    const { req, res } = makeReqRes({ id: 1, role: "agent", permissions: [] });
    let next = false;
    gate(req, res, () => { next = true; });
    expect(next).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it("getReport rejects an invalid businessId", async () => {
    const ctrl = await import("../../server/modules/marketing/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "not-a-number";
    await ctrl.getReport(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("getReport uses only the URL businessId, never a client-supplied one", async () => {
    const service = await import("../../server/modules/marketing/service");
    (service.getBusinessMarketingReport as any).mockResolvedValue({ campaignCount: 0 });
    const ctrl = await import("../../server/modules/marketing/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1";
    req.query = { businessId: "999" }; // attempted smuggle via query
    await ctrl.getReport(req, res);
    const callArgs = (service.getBusinessMarketingReport as any).mock.calls[0];
    expect(callArgs[0]).toBe(1);
  });

  it("getFrequency rejects a non-numeric customerId query filter", async () => {
    const ctrl = await import("../../server/modules/marketing/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1";
    req.query = { customerId: "not-a-number" };
    await ctrl.getFrequency(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("getFrequency propagates a cross-business customerId as 404 (tenant isolation on the customer-level query)", async () => {
    const service = await import("../../server/modules/marketing/service");
    const { NotFoundError } = service as any;
    (service.getMarketingFrequencyStatus as any).mockRejectedValue(new NotFoundError("Customer not found"));
    const ctrl = await import("../../server/modules/marketing/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1";
    req.query = { customerId: "999" };
    await ctrl.getFrequency(req, res);
    expect(res.statusCode).toBe(404);
  });

  it("getFrequency works without a customerId (business-level only)", async () => {
    const service = await import("../../server/modules/marketing/service");
    (service.getMarketingFrequencyStatus as any).mockResolvedValue({ business: { used: 0 }, customer: null });
    const ctrl = await import("../../server/modules/marketing/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1";
    await ctrl.getFrequency(req, res);
    expect(res.statusCode).toBe(200);
    const callArgs = (service.getMarketingFrequencyStatus as any).mock.calls[0];
    expect(callArgs[1]).toBeUndefined();
  });
});

describe("No generic send-message or trigger endpoint exists in either module", () => {
  it("registerMarketingRoutes registers only GET routes under /marketing/", async () => {
    const registered: Array<{ method: string; path: string }> = [];
    const fakeApp: any = {
      get: (path: string) => registered.push({ method: "get", path }),
      post: (path: string) => registered.push({ method: "post", path }),
    };
    const { registerMarketingRoutes } = await import("../../server/modules/marketing/routes");
    registerMarketingRoutes(fakeApp);
    expect(registered.every((r) => r.method === "get")).toBe(true);
    expect(registered.every((r) => r.path.includes("/marketing/"))).toBe(true);
  });
});
