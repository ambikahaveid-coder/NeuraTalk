import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Business Utility Messaging RBAC and controller-validation tests (Phase 7).
 * Mirrors the pattern in otp-rbac.test.ts / campaigns-rbac.test.ts.
 */

vi.mock("../../server/observability", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/modules/utility/service", () => ({
  listUtilityEvents: vi.fn(),
  getUtilityEvent: vi.fn(),
  getUtilityReport: vi.fn(),
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

describe("18. RBAC: UTILITY_VIEW only -- no permission means 'can send any utility message'", () => {
  it("unauthenticated request denied (401)", async () => {
    const { requirePermission } = await import("../../server/role-middleware");
    const { PERMISSIONS } = await import("../../shared/schema");
    const gate = requirePermission(PERMISSIONS.UTILITY_VIEW);
    const { req, res } = makeReqRes(undefined);
    let next = false;
    gate(req, res, () => { next = true; });
    expect(next).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it("a user without UTILITY_VIEW is denied", async () => {
    const { requirePermission } = await import("../../server/role-middleware");
    const { PERMISSIONS } = await import("../../shared/schema");
    const gate = requirePermission(PERMISSIONS.UTILITY_VIEW);
    const { req, res } = makeReqRes({ id: 1, role: "agent", permissions: [] });
    let next = false;
    gate(req, res, () => { next = true; });
    expect(next).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it("a user WITH UTILITY_VIEW passes the gate", async () => {
    const { requirePermission } = await import("../../server/role-middleware");
    const { PERMISSIONS } = await import("../../shared/schema");
    const gate = requirePermission(PERMISSIONS.UTILITY_VIEW);
    const { req, res } = makeReqRes({ id: 1, role: "agent", permissions: [PERMISSIONS.UTILITY_VIEW] });
    let next = false;
    gate(req, res, () => { next = true; });
    expect(next).toBe(true);
  });

  it("no UTILITY_MANAGE or UTILITY_EXECUTE permission exists anywhere in PERMISSIONS -- there is structurally no 'can send any utility message' grant", async () => {
    const { PERMISSIONS } = await import("../../shared/schema");
    expect((PERMISSIONS as any).UTILITY_MANAGE).toBeUndefined();
    expect((PERMISSIONS as any).UTILITY_EXECUTE).toBeUndefined();
    expect((PERMISSIONS as any).UTILITY_SEND).toBeUndefined();
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

describe("Controller: query validation", () => {
  it("getEvents rejects a non-numeric customerId filter", async () => {
    const ctrl = await import("../../server/modules/utility/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1";
    req.query = { customerId: "not-a-number" };
    await ctrl.getEvents(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("getEvents rejects an invalid status filter", async () => {
    const ctrl = await import("../../server/modules/utility/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1";
    req.query = { status: "delivered_for_sure" };
    await ctrl.getEvents(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("getEventById rejects a non-numeric eventId (URL manipulation)", async () => {
    const ctrl = await import("../../server/modules/utility/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1"; req.params.eventId = "not-a-number";
    await ctrl.getEventById(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("getEventById returns 404 for a nonexistent/cross-business event without leaking existence details", async () => {
    const service = await import("../../server/modules/utility/service");
    (service.getUtilityEvent as any).mockResolvedValue(null);
    const ctrl = await import("../../server/modules/utility/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1"; req.params.eventId = "1";
    await ctrl.getEventById(req, res);
    expect(res.statusCode).toBe(404);
  });
});

describe("No generic send-message or trigger endpoint exists", () => {
  it("registerUtilityRoutes never registers a POST route at all -- view-only surface", async () => {
    const registered: Array<{ method: string; path: string }> = [];
    const fakeApp: any = {
      get: (path: string) => registered.push({ method: "get", path }),
      post: (path: string) => registered.push({ method: "post", path }),
    };
    const { registerUtilityRoutes } = await import("../../server/modules/utility/routes");
    registerUtilityRoutes(fakeApp);
    expect(registered.every((r) => r.method === "get")).toBe(true);
    expect(registered.every((r) => r.path.includes("/utility/"))).toBe(true);
    expect(registered.some((p) => /\/send-message|\/send$|\/trigger$/.test(p.path))).toBe(false);
  });
});
