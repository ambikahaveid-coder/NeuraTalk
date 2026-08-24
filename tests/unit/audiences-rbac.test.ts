import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Business Audiences RBAC and controller-validation tests (Phase 4).
 * Mirrors the pattern in templates-rbac.test.ts / approvals-rbac.test.ts.
 */

vi.mock("../../server/observability", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/modules/audiences/service", () => ({
  createAudience: vi.fn(),
  listAudiences: vi.fn(),
  getAudience: vi.fn(),
  updateAudience: vi.fn(),
  archiveAudience: vi.fn(),
  addMember: vi.fn(),
  removeMember: vi.fn(),
  listMembers: vi.fn(),
  NotFoundError: class NotFoundError extends Error {},
  ValidationError: class ValidationError extends Error {},
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

describe("22. RBAC: AUDIENCES_VIEW / AUDIENCES_MANAGE", () => {
  it("unauthenticated request denied (401)", async () => {
    const { requirePermission } = await import("../../server/role-middleware");
    const { PERMISSIONS } = await import("../../shared/schema");
    const gate = requirePermission(PERMISSIONS.AUDIENCES_MANAGE);
    const { req, res } = makeReqRes(undefined);
    let next = false;
    gate(req, res, () => { next = true; });
    expect(next).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it("agent role (neither permission by default) is denied AUDIENCES_MANAGE", async () => {
    const { requirePermission } = await import("../../server/role-middleware");
    const { PERMISSIONS } = await import("../../shared/schema");
    const gate = requirePermission(PERMISSIONS.AUDIENCES_MANAGE);
    const { req, res } = makeReqRes({ id: 1, role: "agent", permissions: [] });
    let next = false;
    gate(req, res, () => { next = true; });
    expect(next).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it("a user with only AUDIENCES_VIEW cannot pass an AUDIENCES_MANAGE gate", async () => {
    const { requirePermission } = await import("../../server/role-middleware");
    const { PERMISSIONS } = await import("../../shared/schema");
    const gate = requirePermission(PERMISSIONS.AUDIENCES_MANAGE);
    const { req, res } = makeReqRes({ id: 1, role: "agent", permissions: [PERMISSIONS.AUDIENCES_VIEW] });
    let next = false;
    gate(req, res, () => { next = true; });
    expect(next).toBe(false);
    expect(res.statusCode).toBe(403);
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

describe("Controller: mass assignment, validation, body ID manipulation", () => {
  it("postAudience rejects a body field outside the allow-list (.strict() schema)", async () => {
    const ctrl = await import("../../server/modules/audiences/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1";
    req.body = { name: "VIP", businessId: 999, status: "active" }; // attempted smuggle
    await ctrl.postAudience(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("postAudience rejects type=dynamic at the controller boundary is allowed through to the service, which rejects it (defense happens in service, schema only constrains the enum)", async () => {
    const service = await import("../../server/modules/audiences/service");
    (service.createAudience as any).mockRejectedValue(new (service as any).ValidationError("Dynamic audiences are not implemented yet"));
    const ctrl = await import("../../server/modules/audiences/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1";
    req.body = { name: "Dyn", type: "dynamic" };
    await ctrl.postAudience(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("postAddMember rejects a non-numeric customerId (body ID manipulation)", async () => {
    const ctrl = await import("../../server/modules/audiences/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1"; req.params.audienceId = "1";
    req.body = { customerId: "'; DROP TABLE customers; --" };
    await ctrl.postAddMember(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("deleteMember rejects a non-numeric customerId in the URL (URL ID manipulation)", async () => {
    const ctrl = await import("../../server/modules/audiences/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1"; req.params.audienceId = "1"; req.params.customerId = "not-a-number";
    await ctrl.deleteMember(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("getAudiences rejects an invalid status filter (query manipulation)", async () => {
    const ctrl = await import("../../server/modules/audiences/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1";
    req.query = { status: "not_a_real_status" };
    await ctrl.getAudiences(req, res);
    expect(res.statusCode).toBe(400);
  });
});
