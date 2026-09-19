import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const audioSource = readFileSync(resolve(process.cwd(), "server/ai_integrations/audio/routes.ts"), "utf8");
const enterpriseAdminSource = readFileSync(resolve(process.cwd(), "server/modules/enterprise-admin/routes.ts"), "utf8");
const b2bAdminSource = readFileSync(resolve(process.cwd(), "server/modules/b2b-admin/routes.ts"), "utf8");
const enterpriseSource = readFileSync(resolve(process.cwd(), "server/enterprise-routes.ts"), "utf8");

function routeBlock(source: string, route: string, nextRoute: string): string {
  const start = source.indexOf(route);
  const end = source.indexOf(nextRoute, start + route.length);
  return source.slice(start, end === -1 ? undefined : end);
}

describe("security remediation regressions", () => {
  it("protects all audio conversation routes with auth and ownership checks", () => {
    for (const route of [
      'app.post("/api/conversations/:id/messages"',
      'app.post("/api/conversations/:id/voice-stream"',
      'app.get("/api/conversations/:id/emotion"',
    ]) {
      const block = routeBlock(audioSource, route, "  //");
      expect(block).toContain("loadUser");
      expect(block).toContain("requireAuth");
      expect(block).toContain("getConversation(conversationId, req.user!.id)");
    }
  });

  it("does not use request-body spreads for enterprise ownership updates", () => {
    for (const route of [
      'async function updateDepartment',
      'async function updateBranch',
      'async function updateTeam',
      'async function updateBusinessHours',
      'async function updateIvrMenu',
      'async function updateCallQueue',
      'async function updatePbxIntegration',
      'async function updateCostCenter',
    ]) {
      const start = enterpriseAdminSource.indexOf(route);
      const end = enterpriseAdminSource.indexOf("\n}\n", start);
      const block = enterpriseAdminSource.slice(start, end);
      expect(block).not.toContain("set({ ...req.body");
      expect(block).toContain("organizationId");
    }
  });

  it("guards team and IVR child resources through their tenant-owned parents", () => {
    expect(enterpriseAdminSource).toContain("referenceBelongsToOrganization(teams, teamId, orgId(req))");
    expect(enterpriseAdminSource).toContain("referenceBelongsToOrganization(ivrMenus, menuId, orgId(req))");
    expect(enterpriseAdminSource).toContain("option.menuId");
  });

  it("verifies the target user belongs to the organization before agent-skill upsert", () => {
    const start = b2bAdminSource.indexOf("async function upsertAgentSkill");
    const end = b2bAdminSource.indexOf("async function deleteAgentSkill", start);
    const block = b2bAdminSource.slice(start, end);
    expect(block).toContain("eq(users.organizationId, orgId)");
    expect(block).toContain("Agent not found");
  });

  it("does not expose global company analytics or usage aggregates", () => {
    expect(enterpriseSource).toContain("tenant-scoped analytics telemetry is not available");
    expect(enterpriseSource).toContain("tenant-scoped usage telemetry is not available");
  });
});
