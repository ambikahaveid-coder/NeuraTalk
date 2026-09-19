import { describe, expect, it } from "vitest";
import { canAccessEnterpriseCall } from "../../server/enterprise-routes";
import { requireCompanyAdminOrAbove } from "../../server/role-middleware";

const activeCall = {
  callId: "call-1",
  tenantId: 7,
  agentId: 42,
  destination: "+15550000000",
  status: "active" as const,
  startTime: new Date(),
  sourceLanguage: "en",
  targetLanguage: "te",
  translationEnabled: true,
  emotionDetectionEnabled: true,
};

const user = (role: string, organizationId?: number) => ({
  id: 42,
  role,
  organizationId,
} as any);

describe("enterprise call control authorization", () => {
  it("allows an authorized company admin in the same tenant", () => {
    expect(canAccessEnterpriseCall(user("company_admin", 7), activeCall, undefined)).toBe(true);
  });

  it("denies an unauthorized role even in the same tenant", () => {
    const res = { status: (code: number) => ({ json: (body: unknown) => ({ code, body }) }) } as any;
    let nextCalled = false;
    requireCompanyAdminOrAbove(user("agent", 7) as any, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
  });

  it("denies a different tenant", () => {
    expect(canAccessEnterpriseCall(user("company_admin", 8), activeCall, undefined)).toBe(false);
  });

  it("denies an unknown call", () => {
    expect(canAccessEnterpriseCall(user("company_admin", 7), undefined, undefined)).toBe(false);
  });

  it("allows a super admin only when the call exists", () => {
    expect(canAccessEnterpriseCall(user("super_admin"), activeCall, undefined)).toBe(true);
    expect(canAccessEnterpriseCall(user("super_admin"), undefined, undefined)).toBe(false);
  });
});
