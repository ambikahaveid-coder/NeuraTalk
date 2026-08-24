import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Business Customers RBAC and controller-validation tests (Phase 4).
 * Mirrors the pattern in templates-rbac.test.ts / approvals-rbac.test.ts.
 */

vi.mock("../../server/observability", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/modules/customers/service", () => ({
  createCustomer: vi.fn(),
  listCustomers: vi.fn(),
  getCustomer: vi.fn(),
  updateCustomer: vi.fn(),
  archiveCustomer: vi.fn(),
  NotFoundError: class NotFoundError extends Error {},
  ValidationError: class ValidationError extends Error {},
  DuplicateCustomerError: class DuplicateCustomerError extends Error {
    constructor(message: string, public existingCustomerId: number) { super(message); }
  },
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

describe("22. RBAC: CUSTOMERS_VIEW / CUSTOMERS_MANAGE", () => {
  it("unauthenticated request denied (401)", async () => {
    const { requirePermission } = await import("../../server/role-middleware");
    const { PERMISSIONS } = await import("../../shared/schema");
    const gate = requirePermission(PERMISSIONS.CUSTOMERS_MANAGE);
    const { req, res } = makeReqRes(undefined);
    let next = false;
    gate(req, res, () => { next = true; });
    expect(next).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it("agent role (neither permission by default) is denied CUSTOMERS_MANAGE", async () => {
    const { requirePermission } = await import("../../server/role-middleware");
    const { PERMISSIONS } = await import("../../shared/schema");
    const gate = requirePermission(PERMISSIONS.CUSTOMERS_MANAGE);
    const { req, res } = makeReqRes({ id: 1, role: "agent", permissions: [] });
    let next = false;
    gate(req, res, () => { next = true; });
    expect(next).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it("a user with only CUSTOMERS_VIEW cannot pass a CUSTOMERS_MANAGE gate", async () => {
    const { requirePermission } = await import("../../server/role-middleware");
    const { PERMISSIONS } = await import("../../shared/schema");
    const gate = requirePermission(PERMISSIONS.CUSTOMERS_MANAGE);
    const { req, res } = makeReqRes({ id: 1, role: "agent", permissions: [PERMISSIONS.CUSTOMERS_VIEW] });
    let next = false;
    gate(req, res, () => { next = true; });
    expect(next).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it("a user with CUSTOMERS_VIEW can pass the read-access requireAnyPermission gate", async () => {
    const { requireAnyPermission } = await import("../../server/role-middleware");
    const { PERMISSIONS } = await import("../../shared/schema");
    const gate = requireAnyPermission(PERMISSIONS.CUSTOMERS_MANAGE, PERMISSIONS.CUSTOMERS_VIEW);
    const { req, res } = makeReqRes({ id: 1, role: "agent", permissions: [PERMISSIONS.CUSTOMERS_VIEW] });
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

describe("Controller: mass assignment, duplicate mapping, validation", () => {
  it("postCustomer rejects a body field outside the allow-list (.strict() schema)", async () => {
    const ctrl = await import("../../server/modules/customers/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1";
    req.body = { name: "A", businessId: 999, status: "active" }; // attempted smuggle
    await ctrl.postCustomer(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("postCustomer maps DuplicateCustomerError to 409 with existingCustomerId in the body", async () => {
    const service = await import("../../server/modules/customers/service");
    const { DuplicateCustomerError } = service as any;
    (service.createCustomer as any).mockRejectedValue(new DuplicateCustomerError("dup", 7));

    const ctrl = await import("../../server/modules/customers/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1";
    req.body = { name: "A", phone: "9876543210" };
    await ctrl.postCustomer(req, res);
    expect(res.statusCode).toBe(409);
    expect(res.body.existingCustomerId).toBe(7);
  });

  it("putCustomer rejects status=archived (not in the update enum -- archiving is a separate action)", async () => {
    const ctrl = await import("../../server/modules/customers/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1"; req.params.customerId = "1";
    req.body = { status: "archived" };
    await ctrl.putCustomer(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("getCustomers rejects an invalid status filter (query ID/param manipulation)", async () => {
    const ctrl = await import("../../server/modules/customers/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1";
    req.query = { status: "not_a_real_status" };
    await ctrl.getCustomers(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("postCustomer rejects a malformed email", async () => {
    const ctrl = await import("../../server/modules/customers/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1";
    req.body = { name: "A", email: "not-an-email" };
    await ctrl.postCustomer(req, res);
    expect(res.statusCode).toBe(400);
  });
});
