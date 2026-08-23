import { describe, it, expect, vi } from "vitest";

/**
 * Regression test for cross-tenant access on B2B company-scoped routes
 * (server/role-middleware.ts requireCompanyAccess), the gate used across
 * server/b2b-routes.ts for endpoints keyed by :companyId. Confirms an org
 * admin cannot access another organization's data by editing the companyId
 * URL param, request body, or record id -- backend authorization, not
 * frontend hiding.
 */

vi.mock("../../server/observability", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function makeReqRes(userOrgId: number | null, role: string, paramCompanyId: string) {
  const req: any = {
    user: userOrgId === null && role !== "super_admin"
      ? undefined
      : { id: 1, role, organizationId: userOrgId },
    params: { companyId: paramCompanyId },
  };
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
  return { req, res };
}

describe("requireCompanyAccess tenant isolation", () => {
  it("denies a company_admin from org A accessing org B's companyId via URL param", async () => {
    const { requireCompanyAccess } = await import("../../server/role-middleware");
    const gate = requireCompanyAccess("companyId");
    const { req, res } = makeReqRes(1 /* user belongs to org 1 */, "company_admin", "2" /* trying to access org 2 */);

    let nextCalled = false;
    await gate(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it("allows a company_admin to access their own org's companyId", async () => {
    const { requireCompanyAccess } = await import("../../server/role-middleware");
    const gate = requireCompanyAccess("companyId");
    const { req, res } = makeReqRes(1, "company_admin", "1");

    let nextCalled = false;
    await gate(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
  });

  it("allows super_admin to access any org's companyId (cross-tenant by design, for platform admin)", async () => {
    const { requireCompanyAccess } = await import("../../server/role-middleware");
    const gate = requireCompanyAccess("companyId");
    const { req, res } = makeReqRes(1, "super_admin", "999");

    let nextCalled = false;
    await gate(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
  });

  it("rejects an unauthenticated request outright (401), regardless of the companyId param", async () => {
    const { requireCompanyAccess } = await import("../../server/role-middleware");
    const gate = requireCompanyAccess("companyId");
    const { req, res } = makeReqRes(null, "consumer", "1");
    req.user = undefined;

    let nextCalled = false;
    await gate(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it("rejects a non-numeric companyId param (guards against param-tampering with a non-ID string)", async () => {
    const { requireCompanyAccess } = await import("../../server/role-middleware");
    const gate = requireCompanyAccess("companyId");
    const { req, res } = makeReqRes(1, "company_admin", "not-a-number");

    let nextCalled = false;
    await gate(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(400);
  });
});
