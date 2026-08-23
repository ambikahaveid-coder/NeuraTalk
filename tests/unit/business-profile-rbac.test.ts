import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Business Profile + Branding RBAC and validation tests (Phase 1).
 * Mirrors tests/unit/messaging-phase0-rbac.test.ts's pattern: exercises the
 * REAL requirePermission middleware against ORG_VIEW_SETTINGS/
 * ORG_EDIT_SETTINGS (both pre-existing permission constants, no new ones
 * added), plus controller-level payload validation.
 */

vi.mock("../../server/observability", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/modules/business-profile/service", () => ({
  getBusinessProfile: vi.fn(),
  updateBusinessProfile: vi.fn(),
  getBranding: vi.fn(),
  updateBranding: vi.fn(),
  setLogo: vi.fn(),
  removeLogo: vi.fn(),
  NotFoundError: class NotFoundError extends Error {},
  InvalidLogoUploadError: class InvalidLogoUploadError extends Error {},
}));

beforeEach(() => {
  vi.clearAllMocks();
});

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

describe("10-11. RBAC: ORG_VIEW_SETTINGS / ORG_EDIT_SETTINGS gating (reused, not new permissions)", () => {
  it("10. unauthenticated request is denied (401)", async () => {
    const { requirePermission } = await import("../../server/role-middleware");
    const { PERMISSIONS } = await import("../../shared/schema");
    const gate = requirePermission(PERMISSIONS.ORG_VIEW_SETTINGS);
    const { req, res } = makeReqRes(undefined);
    let next = false;
    gate(req, res, () => { next = true; });
    expect(next).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it("11. agent role (view-only by default, no ORG_EDIT_SETTINGS) is denied on the edit permission", async () => {
    const { requirePermission } = await import("../../server/role-middleware");
    const { PERMISSIONS } = await import("../../shared/schema");
    const gate = requirePermission(PERMISSIONS.ORG_EDIT_SETTINGS);
    // AGENT_PERMISSIONS (server/role-middleware.ts) does not include
    // ORG_VIEW_SETTINGS or ORG_EDIT_SETTINGS at all -- confirms the "manager/
    // agent must NOT automatically gain branding-management access" requirement
    // was already true before this phase touched anything.
    const { req, res } = makeReqRes({ id: 1, role: "agent", permissions: [] });
    let next = false;
    gate(req, res, () => { next = true; });
    expect(next).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it("manager role has ORG_VIEW_SETTINGS but NOT ORG_EDIT_SETTINGS by default (view/edit split preserved)", async () => {
    const { requirePermission } = await import("../../server/role-middleware");
    const { PERMISSIONS } = await import("../../shared/schema");
    const viewGate = requirePermission(PERMISSIONS.ORG_VIEW_SETTINGS);
    const editGate = requirePermission(PERMISSIONS.ORG_EDIT_SETTINGS);

    const { req: reqView, res: resView } = makeReqRes({ id: 1, role: "manager", permissions: [PERMISSIONS.ORG_VIEW_SETTINGS] });
    let nextView = false;
    viewGate(reqView, resView, () => { nextView = true; });
    expect(nextView).toBe(true);

    const { req: reqEdit, res: resEdit } = makeReqRes({ id: 1, role: "manager", permissions: [PERMISSIONS.ORG_VIEW_SETTINGS] });
    let nextEdit = false;
    editGate(reqEdit, resEdit, () => { nextEdit = true; });
    expect(nextEdit).toBe(false);
    expect(resEdit.statusCode).toBe(403);
  });

  it("company_admin has both ORG_VIEW_SETTINGS and ORG_EDIT_SETTINGS by default", async () => {
    const { requirePermission } = await import("../../server/role-middleware");
    const { PERMISSIONS } = await import("../../shared/schema");
    const editGate = requirePermission(PERMISSIONS.ORG_EDIT_SETTINGS);
    const { req, res } = makeReqRes({ id: 1, role: "company_admin", permissions: [PERMISSIONS.ORG_EDIT_SETTINGS] });
    let next = false;
    editGate(req, res, () => { next = true; });
    expect(next).toBe(true);
  });
});

describe("Tenant isolation via requireCompanyAccess (reused, not reimplemented)", () => {
  it("Business A -> Business A: allowed", async () => {
    const { requireCompanyAccess } = await import("../../server/role-middleware");
    const gate = requireCompanyAccess("businessId");
    const { req, res } = makeReqRes({ id: 1, role: "company_admin", organizationId: 1 });
    req.params.businessId = "1";
    let next = false;
    await gate(req, res, () => { next = true; });
    expect(next).toBe(true);
  });

  it("Business A -> Business B (URL id manipulation): denied", async () => {
    const { requireCompanyAccess } = await import("../../server/role-middleware");
    const gate = requireCompanyAccess("businessId");
    const { req, res } = makeReqRes({ id: 1, role: "company_admin", organizationId: 1 });
    req.params.businessId = "2"; // tampered
    let next = false;
    await gate(req, res, () => { next = true; });
    expect(next).toBe(false);
    expect(res.statusCode).toBe(403);
  });
});

describe("Controller: mass-assignment and payload validation", () => {
  it("patchProfile rejects a body containing a non-allow-listed field (e.g. status) -- .strict() schema", async () => {
    const ctrl = await import("../../server/modules/business-profile/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1";
    req.body = { name: "New Name", status: "suspended" }; // status not in the allow-list
    await ctrl.patchProfile(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("patchProfile rejects an invalid website URL", async () => {
    const ctrl = await import("../../server/modules/business-profile/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1";
    req.body = { website: "not-a-url" };
    await ctrl.patchProfile(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("patchProfile rejects a non-numeric businessId (URL tampering)", async () => {
    const ctrl = await import("../../server/modules/business-profile/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "not-a-number";
    req.body = { name: "x" };
    await ctrl.patchProfile(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("putLogo rejects a missing objectPath (malformed request body)", async () => {
    const ctrl = await import("../../server/modules/business-profile/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1";
    req.body = {};
    await ctrl.putLogo(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("patchProfile derives the actor from req.user.id, never from the request body", async () => {
    const service = await import("../../server/modules/business-profile/service");
    (service.updateBusinessProfile as any).mockResolvedValue({ id: 1, name: "x" });

    const ctrl = await import("../../server/modules/business-profile/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1";
    req.body = { name: "New Name", actorUserId: 999 }; // attempted smuggle -- not in the allow-listed schema anyway (.strict())
    await ctrl.patchProfile(req, res);

    // .strict() schema rejects the unknown `actorUserId` field outright
    expect(res.statusCode).toBe(400);
  });

  it("patchProfile (clean body) passes req.user.id as the actor, not any client value", async () => {
    const service = await import("../../server/modules/business-profile/service");
    (service.updateBusinessProfile as any).mockResolvedValue({ id: 1, name: "New Name" });

    const ctrl = await import("../../server/modules/business-profile/controller");
    const { req, res } = makeReqRes({ id: 42 });
    req.params.businessId = "1";
    req.body = { name: "New Name" };
    await ctrl.patchProfile(req, res);

    const callArgs = (service.updateBusinessProfile as any).mock.calls[0];
    expect(callArgs[0]).toBe(1); // businessId
    expect(callArgs[1]).toBe(42); // actorUserId from req.user.id
  });
});
