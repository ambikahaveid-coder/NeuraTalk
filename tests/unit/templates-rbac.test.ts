import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Template Engine RBAC and controller-validation tests (Phase 2).
 * Mirrors the pattern in messaging-phase0-rbac.test.ts / business-profile-rbac.test.ts.
 */

vi.mock("../../server/observability", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/modules/templates/service", () => ({
  createTemplate: vi.fn(),
  listTemplates: vi.fn(),
  getTemplate: vi.fn(),
  createOrEditDraftVersion: vi.fn(),
  listVersions: vi.fn(),
  submitVersion: vi.fn(),
  approveVersion: vi.fn(),
  rejectVersion: vi.fn(),
  returnToDraft: vi.fn(),
  archiveVersion: vi.fn(),
  previewVersion: vi.fn(),
  NotFoundError: class NotFoundError extends Error {},
  ValidationError: class ValidationError extends Error {},
  SelfApprovalError: class SelfApprovalError extends Error {},
  IllegalTemplateTransitionError: class IllegalTemplateTransitionError extends Error {},
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

describe("12. RBAC: TEMPLATES_MANAGE / TEMPLATES_APPROVE (2 permissions, not 6)", () => {
  it("unauthenticated request denied (401)", async () => {
    const { requirePermission } = await import("../../server/role-middleware");
    const { PERMISSIONS } = await import("../../shared/schema");
    const gate = requirePermission(PERMISSIONS.TEMPLATES_MANAGE);
    const { req, res } = makeReqRes(undefined);
    let next = false;
    gate(req, res, () => { next = true; });
    expect(next).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it("agent role (neither TEMPLATES_MANAGE nor TEMPLATES_APPROVE by default) is denied", async () => {
    const { requirePermission } = await import("../../server/role-middleware");
    const { PERMISSIONS } = await import("../../shared/schema");
    const gate = requirePermission(PERMISSIONS.TEMPLATES_MANAGE);
    const { req, res } = makeReqRes({ id: 1, role: "agent", permissions: [] });
    let next = false;
    gate(req, res, () => { next = true; });
    expect(next).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it("manager has TEMPLATES_MANAGE but NOT TEMPLATES_APPROVE by default (content-author role, not reviewer)", async () => {
    const { requirePermission } = await import("../../server/role-middleware");
    const { PERMISSIONS } = await import("../../shared/schema");
    const manageGate = requirePermission(PERMISSIONS.TEMPLATES_MANAGE);
    const approveGate = requirePermission(PERMISSIONS.TEMPLATES_APPROVE);

    const { req: r1, res: s1 } = makeReqRes({ id: 1, role: "manager", permissions: [PERMISSIONS.TEMPLATES_MANAGE] });
    let n1 = false;
    manageGate(r1, s1, () => { n1 = true; });
    expect(n1).toBe(true);

    const { req: r2, res: s2 } = makeReqRes({ id: 1, role: "manager", permissions: [PERMISSIONS.TEMPLATES_MANAGE] });
    let n2 = false;
    approveGate(r2, s2, () => { n2 = true; });
    expect(n2).toBe(false);
    expect(s2.statusCode).toBe(403);
  });

  it("company_admin has both by default", async () => {
    const { requirePermission } = await import("../../server/role-middleware");
    const { PERMISSIONS } = await import("../../shared/schema");
    const approveGate = requirePermission(PERMISSIONS.TEMPLATES_APPROVE);
    const { req, res } = makeReqRes({ id: 1, role: "company_admin", permissions: [PERMISSIONS.TEMPLATES_APPROVE] });
    let next = false;
    approveGate(req, res, () => { next = true; });
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

describe("Controller: mass assignment, sender-identity absence, illegal-transition -> 409", () => {
  it("postTemplate rejects a body field outside the allow-list (.strict() schema)", async () => {
    const ctrl = await import("../../server/modules/templates/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1";
    req.body = { name: "a", category: "utility", status: "approved" }; // status not accepted
    await ctrl.postTemplate(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("postTemplate rejects a fake/client-invented category", async () => {
    const ctrl = await import("../../server/modules/templates/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1";
    req.body = { name: "a", category: "system_admin" };
    await ctrl.postTemplate(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("putDraftVersion schema has NO senderParticipantId or generationSource field -- structurally impossible to submit either (doc 25 compliance)", async () => {
    const ctrl = await import("../../server/modules/templates/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1";
    req.params.templateId = "1";
    req.body = {
      content: "Hi {{name}}", variables: [{ name: "name", type: "text", required: true }],
      senderParticipantId: 999, generationSource: { type: "campaign", id: 1 }, // attempted smuggle
    };
    await ctrl.putDraftVersion(req, res);
    // .strict() rejects the unknown fields outright
    expect(res.statusCode).toBe(400);
  });

  // postApproveVersion/postRejectVersion no longer exist as controller
  // functions (Phase 3, doc 28 section 8) -- submit/approve/reject moved
  // entirely to the Approval Center's generic routes. See
  // tests/unit/approvals-rbac.test.ts for the equivalent coverage there
  // (IllegalTemplateTransitionError/SelfApprovalError mapping,
  // isSuperAdmin resolved from req.user.role not the body, reason
  // validation on reject).
});
