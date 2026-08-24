import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Generic Approval Center RBAC and controller-validation tests (Phase 3).
 * Mirrors the pattern in templates-rbac.test.ts.
 */

vi.mock("../../server/observability", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/modules/approvals/service", () => ({
  createApprovalRequest: vi.fn(),
  listApprovalRequests: vi.fn(),
  getApprovalRequest: vi.fn(),
  approveRequest: vi.fn(),
  rejectRequest: vi.fn(),
  cancelRequest: vi.fn(),
  NotFoundError: class NotFoundError extends Error {},
  ValidationError: class ValidationError extends Error {},
  UnknownResourceTypeError: class UnknownResourceTypeError extends Error {},
  SelfApprovalError: class SelfApprovalError extends Error {},
  AlreadyDecidedError: class AlreadyDecidedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
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

describe("Dynamic permission resolution (no static permission known until resourceType is parsed)", () => {
  it("postCreateRequest rejects an unregistered resourceType before any permission check", async () => {
    const ctrl = await import("../../server/modules/approvals/controller");
    const { req, res } = makeReqRes({ id: 42, permissions: [] });
    req.params.businessId = "1";
    req.body = { resourceType: "refund", resourceId: 1 }; // not registered in this phase
    await ctrl.postCreateRequest(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("postCreateRequest denies a user lacking the policy's declared submitPermission (TEMPLATES_MANAGE)", async () => {
    const ctrl = await import("../../server/modules/approvals/controller");
    await import("../../server/modules/templates/approval-policy"); // registers template_version policy
    const { req, res } = makeReqRes({ id: 42, role: "agent", permissions: [] }); // agent has neither TEMPLATES_MANAGE nor TEMPLATES_APPROVE
    req.params.businessId = "1";
    req.body = { resourceType: "template_version", resourceId: 1 };
    await ctrl.postCreateRequest(req, res);
    expect(res.statusCode).toBe(403);
  });

  it("postCreateRequest allows a user WITH TEMPLATES_MANAGE", async () => {
    const service = await import("../../server/modules/approvals/service");
    (service.createApprovalRequest as any).mockResolvedValue({ id: 1, status: "pending" });

    const ctrl = await import("../../server/modules/approvals/controller");
    const { PERMISSIONS } = await import("../../shared/schema");
    await import("../../server/modules/templates/approval-policy");
    const { req, res } = makeReqRes({ id: 42, role: "manager", permissions: [PERMISSIONS.TEMPLATES_MANAGE] });
    req.params.businessId = "1";
    req.body = { resourceType: "template_version", resourceId: 1 };
    await ctrl.postCreateRequest(req, res);
    expect(res.statusCode).toBe(201);
  });

  it("postApprove/postReject deny a user lacking TEMPLATES_APPROVE, resolved from the EXISTING request's resourceType", async () => {
    const service = await import("../../server/modules/approvals/service");
    (service.getApprovalRequest as any).mockResolvedValue({ id: 1, resourceType: "template_version", requestedBy: 1 });

    const ctrl = await import("../../server/modules/approvals/controller");
    await import("../../server/modules/templates/approval-policy");
    const { req, res } = makeReqRes({ id: 42, role: "manager", permissions: [] }); // manager: MANAGE only, not APPROVE by default
    req.params.businessId = "1"; req.params.requestId = "1";
    await ctrl.postApprove(req, res);
    expect(res.statusCode).toBe(403);
  });
});

describe("Error mapping (moved here from templates-rbac.test.ts, Phase 3 -- these actions no longer live in the Template module)", () => {
  it("postApprove maps AlreadyDecidedError to 409 (not 500) -- illegal/conflicting transition", async () => {
    const service = await import("../../server/modules/approvals/service");
    const { AlreadyDecidedError } = service as any;
    (service.getApprovalRequest as any).mockResolvedValue({ id: 1, resourceType: "template_version", requestedBy: 1 });
    (service.approveRequest as any).mockRejectedValue(new AlreadyDecidedError());

    const ctrl = await import("../../server/modules/approvals/controller");
    const { PERMISSIONS } = await import("../../shared/schema");
    await import("../../server/modules/templates/approval-policy");
    const { req, res } = makeReqRes({ id: 42, role: "company_admin", permissions: [PERMISSIONS.TEMPLATES_APPROVE] });
    req.params.businessId = "1"; req.params.requestId = "1";
    await ctrl.postApprove(req, res);
    expect(res.statusCode).toBe(409);
  });

  it("postApprove maps SelfApprovalError to 403", async () => {
    const service = await import("../../server/modules/approvals/service");
    const { SelfApprovalError } = service as any;
    (service.getApprovalRequest as any).mockResolvedValue({ id: 1, resourceType: "template_version", requestedBy: 1 });
    (service.approveRequest as any).mockRejectedValue(new SelfApprovalError());

    const ctrl = await import("../../server/modules/approvals/controller");
    const { PERMISSIONS } = await import("../../shared/schema");
    await import("../../server/modules/templates/approval-policy");
    const { req, res } = makeReqRes({ id: 42, role: "company_admin", permissions: [PERMISSIONS.TEMPLATES_APPROVE] });
    req.params.businessId = "1"; req.params.requestId = "1";
    await ctrl.postApprove(req, res);
    expect(res.statusCode).toBe(403);
  });

  it("postApprove passes isSuperAdmin resolved from req.user.role, never from the request body", async () => {
    const service = await import("../../server/modules/approvals/service");
    (service.getApprovalRequest as any).mockResolvedValue({ id: 1, resourceType: "template_version", requestedBy: 1 });
    (service.approveRequest as any).mockResolvedValue({ status: "approved" });

    const ctrl = await import("../../server/modules/approvals/controller");
    const { PERMISSIONS } = await import("../../shared/schema");
    await import("../../server/modules/templates/approval-policy");
    const { req, res } = makeReqRes({ id: 42, role: "company_admin", permissions: [PERMISSIONS.TEMPLATES_APPROVE] }); // NOT super_admin
    req.params.businessId = "1"; req.params.requestId = "1";
    req.body = { isSuperAdmin: true }; // attempted smuggle -- controller doesn't read this field at all
    await ctrl.postApprove(req, res);

    const callArgs = (service.approveRequest as any).mock.calls[0];
    expect(callArgs[3]).toBe(false); // isSuperAdmin resolved from req.user.role
  });

  it("postReject requires a non-empty reason before even reaching the service", async () => {
    const ctrl = await import("../../server/modules/approvals/controller");
    const { req, res } = makeReqRes({ id: 42, role: "company_admin" });
    req.params.businessId = "1"; req.params.requestId = "1";
    req.body = { reason: "" };
    await ctrl.postReject(req, res);
    expect(res.statusCode).toBe(400);
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

  it("unauthenticated request denied (401)", async () => {
    const { requireAuth } = await import("../../server/role-middleware");
    const { req, res } = makeReqRes(undefined);
    let next = false;
    requireAuth(req, res, () => { next = true; });
    expect(next).toBe(false);
    expect(res.statusCode).toBe(401);
  });
});

describe("Mass assignment / payload validation", () => {
  it("postCreateRequest rejects a body field outside the allow-list (.strict() schema)", async () => {
    const ctrl = await import("../../server/modules/approvals/controller");
    const { req, res } = makeReqRes({ id: 42, permissions: [] });
    req.params.businessId = "1";
    req.body = { resourceType: "template_version", resourceId: 1, businessId: 999, status: "approved" }; // attempted smuggle
    await ctrl.postCreateRequest(req, res);
    expect(res.statusCode).toBe(400); // .strict() rejects unknown fields
  });

  it("getRequests rejects an invalid status filter", async () => {
    const ctrl = await import("../../server/modules/approvals/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1";
    req.query = { status: "not_a_real_status" };
    await ctrl.getRequests(req, res);
    expect(res.statusCode).toBe(400);
  });
});
