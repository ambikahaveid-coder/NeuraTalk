import { describe, it, expect, vi, beforeEach } from "vitest";
import { users, orgMembers } from "@shared/schema";

/**
 * P0-5: no role -- not even company_admin -- had default access to any
 * Business-platform permission (customers/audiences/templates/approvals/
 * campaigns/OTP/utility/business messaging). server/business-rbac-routes.ts
 * adds a narrow, explicit grant path instead of broadening any default
 * permission set. These tests drive the REAL middleware chain
 * (requireAuth, requireCompanyAccess, requireRole from role-middleware.ts,
 * unmocked) exactly as registerBusinessRbacRoutes wires it, against a fake
 * db capturing the actual query shapes the route handler issues.
 */

let targetUserRow: { id: number; organizationId: number | null } | null = null;
let existingMembershipRow: { id: number; permissions: unknown } | null = null;
const updateCalls: Array<{ values: any }> = [];
const insertCalls: Array<{ values: any }> = [];

vi.mock("../../server/db", () => ({
  db: {
    select: (_cols?: any) => ({
      from: (table: any) => ({
        where: async () => {
          if (table === users) return targetUserRow ? [targetUserRow] : [];
          if (table === orgMembers) return existingMembershipRow ? [existingMembershipRow] : [];
          return [];
        },
      }),
    }),
    update: (table: any) => ({
      set: (values: any) => ({
        where: async () => { updateCalls.push({ values }); },
      }),
    }),
    insert: (table: any) => ({
      values: async (values: any) => { insertCalls.push({ values }); },
    }),
  },
}));

vi.mock("../../server/audit", () => ({ createAuditLog: vi.fn(async () => {}) }));
vi.mock("../../server/observability", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

beforeEach(() => {
  targetUserRow = null;
  existingMembershipRow = null;
  updateCalls.length = 0;
  insertCalls.length = 0;
  vi.clearAllMocks();
});

function makeFakeApp() {
  const routes: Record<string, any[]> = {};
  return {
    app: {
      post(path: string, ...handlers: any[]) { routes[`POST ${path}`] = handlers; },
      get(path: string, ...handlers: any[]) { routes[`GET ${path}`] = handlers; },
    } as any,
    routes,
  };
}

function makeReqRes(user: any, params: Record<string, string>, body: any = {}) {
  const req: any = { user, params, body, query: {} };
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
  return { req, res };
}

// Correctly waits for the FULL chain, including middleware (like requireAuth)
// that calls next() synchronously without awaiting/returning it -- awaiting
// only handlers[0]'s own return value (as a naive version of this helper
// does) resolves as soon as the first sync middleware's function body
// finishes, which is BEFORE any downstream async middleware/handler has
// actually run. Each invoke() awaits its own handler, then (if it called
// next) awaits the promise for everything downstream of it.
async function runChain(handlers: any[], req: any, res: any): Promise<void> {
  async function invoke(i: number): Promise<void> {
    if (i >= handlers.length) return;
    let calledNext = false;
    let downstream: Promise<void> = Promise.resolve();
    const next = () => {
      calledNext = true;
      downstream = invoke(i + 1);
    };
    await handlers[i](req, res, next);
    if (calledNext) {
      await downstream;
    }
  }
  await invoke(0);
}

const BUSINESS_ID = 42;

describe("P0-5: POST /api/business/:businessId/rbac/grant-business-access", () => {
  it("1. an authorized company_admin of the SAME business succeeds and merges permissions", async () => {
    const { registerBusinessRbacRoutes } = await import("../../server/business-rbac-routes");
    const { app, routes } = makeFakeApp();
    registerBusinessRbacRoutes(app);
    const handlers = routes[`POST /api/business/:businessId/rbac/grant-business-access`];

    targetUserRow = { id: 7, organizationId: BUSINESS_ID };
    existingMembershipRow = { id: 501, permissions: ["messaging:view"] };

    const { req, res } = makeReqRes(
      { id: 7, role: "company_admin", organizationId: BUSINESS_ID },
      { businessId: String(BUSINESS_ID) },
      { permissions: ["customers:manage", "campaigns:view"] },
    );
    await runChain(handlers, req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(updateCalls).toHaveLength(1);
    const grantedSet = new Set(updateCalls[0].values.permissions);
    expect(grantedSet.has("customers:manage")).toBe(true);
    expect(grantedSet.has("campaigns:view")).toBe(true);
    // pre-existing permission was preserved, not wiped -- proves merge, not overwrite
    expect(grantedSet.has("messaging:view")).toBe(true);
  });

  it("2. a user without company_admin/super_admin role receives 403 (e.g. a plain 'agent')", async () => {
    const { registerBusinessRbacRoutes } = await import("../../server/business-rbac-routes");
    const { app, routes } = makeFakeApp();
    registerBusinessRbacRoutes(app);
    const handlers = routes[`POST /api/business/:businessId/rbac/grant-business-access`];

    const { req, res } = makeReqRes(
      { id: 9, role: "agent", organizationId: BUSINESS_ID },
      { businessId: String(BUSINESS_ID) },
      { permissions: ["customers:manage"] },
    );
    await runChain(handlers, req, res);

    expect(res.statusCode).toBe(403);
    expect(updateCalls).toHaveLength(0);
    expect(insertCalls).toHaveLength(0);
  });

  it("3. a company_admin from a DIFFERENT organization cannot grant access in this business (requireCompanyAccess denies first)", async () => {
    const { registerBusinessRbacRoutes } = await import("../../server/business-rbac-routes");
    const { app, routes } = makeFakeApp();
    registerBusinessRbacRoutes(app);
    const handlers = routes[`POST /api/business/:businessId/rbac/grant-business-access`];

    const { req, res } = makeReqRes(
      { id: 9, role: "company_admin", organizationId: 999 }, // different org than BUSINESS_ID
      { businessId: String(BUSINESS_ID) },
      { permissions: ["customers:manage"] },
    );
    await runChain(handlers, req, res);

    expect(res.statusCode).toBe(403);
    expect(updateCalls).toHaveLength(0);
  });

  it("3b. even a company_admin of the RIGHT business cannot grant to a targetUserId belonging to a different organization", async () => {
    const { registerBusinessRbacRoutes } = await import("../../server/business-rbac-routes");
    const { app, routes } = makeFakeApp();
    registerBusinessRbacRoutes(app);
    const handlers = routes[`POST /api/business/:businessId/rbac/grant-business-access`];

    targetUserRow = { id: 55, organizationId: 999 }; // target belongs to a DIFFERENT org
    const { req, res } = makeReqRes(
      { id: 7, role: "company_admin", organizationId: BUSINESS_ID },
      { businessId: String(BUSINESS_ID) },
      { userId: 55, permissions: ["customers:manage"] },
    );
    await runChain(handlers, req, res);

    expect(res.statusCode).toBe(403);
    expect(updateCalls).toHaveLength(0);
  });

  it("4. super_admin behavior is unchanged -- bypasses the company-access check regardless of organizationId", async () => {
    const { registerBusinessRbacRoutes } = await import("../../server/business-rbac-routes");
    const { app, routes } = makeFakeApp();
    registerBusinessRbacRoutes(app);
    const handlers = routes[`POST /api/business/:businessId/rbac/grant-business-access`];

    targetUserRow = { id: 7, organizationId: BUSINESS_ID };
    existingMembershipRow = null;

    const { req, res } = makeReqRes(
      { id: 1, role: "super_admin", organizationId: null },
      { businessId: String(BUSINESS_ID) },
      { userId: 7, permissions: ["otp:manage"] },
    );
    await runChain(handlers, req, res);

    expect(res.statusCode).toBe(200);
    expect(insertCalls).toHaveLength(1); // no existing membership -> insert path
  });

  it("5. an attempt to grant a permission outside the Business-platform allow-list is rejected (e.g. users:assign_roles)", async () => {
    const { registerBusinessRbacRoutes } = await import("../../server/business-rbac-routes");
    const { app, routes } = makeFakeApp();
    registerBusinessRbacRoutes(app);
    const handlers = routes[`POST /api/business/:businessId/rbac/grant-business-access`];

    targetUserRow = { id: 7, organizationId: BUSINESS_ID };
    const { req, res } = makeReqRes(
      { id: 7, role: "company_admin", organizationId: BUSINESS_ID },
      { businessId: String(BUSINESS_ID) },
      { permissions: ["users:assign_roles"] },
    );
    await runChain(handlers, req, res);

    expect(res.statusCode).toBe(400);
    expect(updateCalls).toHaveLength(0);
    expect(insertCalls).toHaveLength(0);
  });

  it("this endpoint does not change what an ungranted 'agent' can do -- agent permissions remain restricted unless explicitly granted via this endpoint", async () => {
    // No grant call made for this agent -- proves the endpoint is additive/opt-in,
    // not a default-permission change. requirePermission for a Business-platform
    // permission (imported straight from role-middleware, unmocked) still denies
    // an agent with an empty permissions array.
    const { requirePermission } = await import("../../server/role-middleware");
    const { PERMISSIONS } = await import("@shared/schema");
    const gate = requirePermission(PERMISSIONS.CUSTOMERS_MANAGE);
    const { req, res } = makeReqRes({ id: 9, role: "agent", permissions: [] }, {});
    let nextCalled = false;
    gate(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });
});
