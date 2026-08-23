import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Business Profile + Branding tests (Phase 1).
 * See docs/neura-ecosystem/26_BUSINESS_PROFILE_BRANDING_IMPLEMENTATION.md.
 * Uses the same in-memory fake-db style established in
 * tests/unit/messaging-phase0.test.ts (real filter/update semantics, not a
 * canned response queue).
 */

type Row = Record<string, any>;
let orgs: Row[] = [];

function resetFakeDb() {
  orgs = [
    {
      id: 1, name: "Acme Corp", legalBusinessName: null, description: null,
      industry: null, website: null, email: "old@acme.test", phone: null,
      address: null, addressCity: null, addressState: null, addressCountry: null, addressPostalCode: null,
      logoUrl: null, status: "approved", settings: {}, isActive: true,
    },
    {
      id: 2, name: "Other Business", legalBusinessName: null, description: null,
      industry: null, website: null, email: null, phone: null,
      address: null, addressCity: null, addressState: null, addressCountry: null, addressPostalCode: null,
      logoUrl: null, status: "approved", settings: {}, isActive: true,
    },
  ];
}

function fieldNameOf(colDescriptor: string): string {
  return colDescriptor.split(".").pop()!;
}
function evalCond(row: Row, cond: any): boolean {
  if (!cond) return true;
  if (cond.__and) return cond.conds.every((c: any) => evalCond(row, c));
  if (cond.__eq) return row[cond.field] === cond.value;
  throw new Error("Unknown condition: " + JSON.stringify(cond));
}

const auditCalls: Array<{ actorUserId: number; key: string; oldValue: any; newValue: any }> = [];

const fakeDb = {
  select() {
    return {
      from: (_table: Row) => {
        let cond: any = null;
        const chain = {
          where(c: any) { cond = c; return chain; },
          then(res: any) { return Promise.resolve(orgs.filter((r) => evalCond(r, cond))).then(res); },
        };
        return chain;
      },
    };
  },
  update(_table: Row) {
    return {
      set(patch: Row) {
        let cond: any = null;
        const chain: any = {
          where(c: any) {
            cond = c;
            const affected = orgs.filter((r) => evalCond(r, cond));
            for (const row of affected) Object.assign(row, patch);
            chain._affected = affected;
            return chain;
          },
          returning() { return Promise.resolve(chain._affected ?? []); },
          then(res: any) { return Promise.resolve(chain._affected ?? []).then(res); },
        };
        return chain;
      },
    };
  },
};

vi.mock("../../server/db", () => ({ db: fakeDb }));
vi.mock("../../server/observability", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/audit", () => ({
  AuditHelpers: {
    logSettingsChange: vi.fn(async (actorUserId: number, key: string, oldValue: any, newValue: any) => {
      auditCalls.push({ actorUserId, key, oldValue, newValue });
    }),
  },
}));
// Simulates real stored object metadata, keyed by objectPath, so tests can
// control what getMetadata() reports independent of the path string itself
// (proving the fix validates real metadata, not path/extension heuristics).
const objectMetadata = new Map<string, { contentType: string; size: number }>();

vi.mock("../../server/ai_integrations/object_storage/objectStorage", () => ({
  ObjectStorageService: class {
    async getObjectEntityFile(objectPath: string) {
      if (objectPath.includes("missing")) {
        const err: any = new Error("not found");
        err.name = "ObjectNotFoundError";
        throw err;
      }
      return {
        path: objectPath,
        async getMetadata() {
          return [objectMetadata.get(objectPath) ?? { contentType: "image/png", size: 1024 }];
        },
      };
    }
  },
}));
vi.mock("../../server/ai_integrations/object_storage/objectAcl", () => ({
  setObjectAclPolicy: vi.fn(async () => {}),
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    eq: (column: string, value: unknown) => ({ __eq: true, field: fieldNameOf(column), value }),
    and: (...conds: any[]) => ({ __and: true, conds }),
  };
});

vi.mock("@shared/schema", async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  const col = (table: string, field: string) => `${table}.${field}`;
  const mkTable = (table: string, fields: string[]) => Object.fromEntries(fields.map((f) => [f, col(table, f)]));
  return {
    ...actual,
    organizations: mkTable("organizations", [
      "id", "name", "legalBusinessName", "description", "industry", "website", "email", "phone",
      "address", "addressCity", "addressState", "addressCountry", "addressPostalCode", "logoUrl", "status", "settings", "isActive",
    ]),
  };
});

beforeEach(() => {
  resetFakeDb();
  auditCalls.length = 0;
  objectMetadata.clear();
  vi.clearAllMocks();
});

describe("1. Business profile read", () => {
  it("returns the profile for an existing business", async () => {
    const { getBusinessProfile } = await import("../../server/modules/business-profile/service");
    const profile = await getBusinessProfile(1);
    expect(profile).not.toBeNull();
    expect(profile!.name).toBe("Acme Corp");
  });

  it("returns null for a non-existent business", async () => {
    const { getBusinessProfile } = await import("../../server/modules/business-profile/service");
    expect(await getBusinessProfile(999)).toBeNull();
  });
});

describe("2. Business profile update", () => {
  it("updates only the fields supplied, persists them, and writes an audit record", async () => {
    const { updateBusinessProfile } = await import("../../server/modules/business-profile/service");
    const result = await updateBusinessProfile(1, 42, { description: "We fix things.", legalBusinessName: "Acme Corp Pvt Ltd" });
    expect(result.description).toBe("We fix things.");
    expect(result.legalBusinessName).toBe("Acme Corp Pvt Ltd");
    expect(result.name).toBe("Acme Corp"); // untouched field preserved

    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0].actorUserId).toBe(42);
    expect(auditCalls[0].newValue.description).toBe("We fix things.");
  });

  it("14. persists after reload -- a second read reflects the update", async () => {
    const { updateBusinessProfile, getBusinessProfile } = await import("../../server/modules/business-profile/service");
    await updateBusinessProfile(1, 42, { website: "https://acme.test" });
    const reloaded = await getBusinessProfile(1);
    expect(reloaded!.website).toBe("https://acme.test");
  });

  it("rejects updating a non-existent business", async () => {
    const { updateBusinessProfile, NotFoundError } = await import("../../server/modules/business-profile/service");
    await expect(updateBusinessProfile(999, 42, { description: "x" })).rejects.toThrow(NotFoundError);
  });

  it("mass-assignment guard: fields outside the writable allow-list (e.g. status, isActive) cannot be changed through this path", async () => {
    const { updateBusinessProfile } = await import("../../server/modules/business-profile/service");
    // TypeScript's BusinessProfileUpdate type already excludes these at compile
    // time; this test proves the runtime guarantee too, by casting past the
    // type the way a compromised/older client build might.
    await updateBusinessProfile(1, 42, { status: "suspended", isActive: false } as any);
    expect(orgs[0].status).toBe("approved"); // unchanged
    expect(orgs[0].isActive).toBe(true); // unchanged
  });
});

describe("3-4. Branding read/update", () => {
  it("returns empty branding when none has been set", async () => {
    const { getBranding } = await import("../../server/modules/business-profile/service");
    expect(await getBranding(1)).toEqual({});
  });

  it("updates branding, persists in settings.branding, writes audit", async () => {
    const { updateBranding, getBranding } = await import("../../server/modules/business-profile/service");
    const result = await updateBranding(1, 42, { primaryColor: "#112233" });
    expect(result.primaryColor).toBe("#112233");
    expect(orgs[0].settings.branding.primaryColor).toBe("#112233");

    const reloaded = await getBranding(1);
    expect(reloaded.primaryColor).toBe("#112233");
    expect(auditCalls.some((c) => c.key === "business_branding:1")).toBe(true);
  });

  it("12. rejects an invalid hex color (validation error)", async () => {
    const { updateBranding } = await import("../../server/modules/business-profile/service");
    await expect(updateBranding(1, 42, { primaryColor: "not-a-color" } as any)).rejects.toThrow();
  });

  it("rejects an unknown branding field (schema is .strict())", async () => {
    const { updateBranding } = await import("../../server/modules/business-profile/service");
    await expect(updateBranding(1, 42, { customDomain: "evil.example.com" } as any)).rejects.toThrow();
  });

  it("partial branding updates preserve previously-set fields", async () => {
    const { updateBranding } = await import("../../server/modules/business-profile/service");
    await updateBranding(1, 42, { primaryColor: "#111111" });
    const result = await updateBranding(1, 42, { secondaryColor: "#222222" });
    expect(result.primaryColor).toBe("#111111");
    expect(result.secondaryColor).toBe("#222222");
  });
});

describe("5-7. Logo upload / replace / remove", () => {
  it("5. sets the logo from an uploaded object path, writes audit", async () => {
    const { setLogo } = await import("../../server/modules/business-profile/service");
    const url = await setLogo(1, 42, "/objects/uploads/logo1.png");
    expect(url).toBe("/objects/uploads/logo1.png");
    expect(orgs[0].logoUrl).toBe("/objects/uploads/logo1.png");
    expect(auditCalls.some((c) => c.key === "business_logo:1")).toBe(true);
  });

  it("6. replaces an existing logo", async () => {
    const { setLogo } = await import("../../server/modules/business-profile/service");
    await setLogo(1, 42, "/objects/uploads/logo1.png");
    await setLogo(1, 42, "/objects/uploads/logo2.png");
    expect(orgs[0].logoUrl).toBe("/objects/uploads/logo2.png");
  });

  it("7. removes the logo", async () => {
    const { setLogo, removeLogo } = await import("../../server/modules/business-profile/service");
    await setLogo(1, 42, "/objects/uploads/logo1.png");
    await removeLogo(1, 42);
    expect(orgs[0].logoUrl).toBeNull();
    expect(auditCalls.filter((c) => c.key === "business_logo:1")).toHaveLength(2); // set + remove
  });

  it("rejects an object whose REAL stored content-type is not an image, even with an innocuous-looking path", async () => {
    const { setLogo, InvalidLogoUploadError } = await import("../../server/modules/business-profile/service");
    objectMetadata.set("/objects/uploads/x", { contentType: "application/zip", size: 1024 });
    await expect(setLogo(1, 42, "/objects/uploads/x")).rejects.toThrow(InvalidLogoUploadError);
  });

  it("rejects an extensionless object path whose real content-type is a video -- proves the fix doesn't trust path/extension heuristics (the original gap)", async () => {
    const { setLogo, InvalidLogoUploadError } = await import("../../server/modules/business-profile/service");
    // No file extension at all -- the kind of path real object storage often
    // generates (UUID-keyed). Before the metadata-based fix, this shape was
    // waved through by an "extensionless = assume OK" heuristic.
    objectMetadata.set("/objects/uploads/9f3b2a1c-uuid", { contentType: "video/mp4", size: 50 * 1024 * 1024 });
    await expect(setLogo(1, 42, "/objects/uploads/9f3b2a1c-uuid")).rejects.toThrow(InvalidLogoUploadError);
  });

  it("rejects an image that exceeds the 5MB logo size cap, even though it's within the general 100MB upload cap", async () => {
    const { setLogo, InvalidLogoUploadError } = await import("../../server/modules/business-profile/service");
    objectMetadata.set("/objects/uploads/big.png", { contentType: "image/png", size: 10 * 1024 * 1024 });
    await expect(setLogo(1, 42, "/objects/uploads/big.png")).rejects.toThrow(InvalidLogoUploadError);
  });

  it("rejects a path outside the object-storage namespace (path traversal / arbitrary URL guard)", async () => {
    const { setLogo, InvalidLogoUploadError } = await import("../../server/modules/business-profile/service");
    await expect(setLogo(1, 42, "https://evil.example.com/x.png")).rejects.toThrow(InvalidLogoUploadError);
    await expect(setLogo(1, 42, "/objects/../../etc/passwd.png")).rejects.toThrow(InvalidLogoUploadError);
  });

  it("rejects setting a logo for a non-existent business", async () => {
    const { setLogo, NotFoundError } = await import("../../server/modules/business-profile/service");
    await expect(setLogo(999, 42, "/objects/uploads/logo1.png")).rejects.toThrow(NotFoundError);
  });
});

describe("8-9. Tenant isolation", () => {
  it("8. Business A's data is never touched when acting on Business B (service is correctly id-scoped)", async () => {
    const { updateBusinessProfile } = await import("../../server/modules/business-profile/service");
    await updateBusinessProfile(2, 42, { description: "B's description" });
    expect(orgs[0].description).toBeNull(); // business 1 untouched
    expect(orgs[1].description).toBe("B's description");
  });

  it("9. reading business 2's profile never returns business 1's data and vice versa", async () => {
    const { getBusinessProfile } = await import("../../server/modules/business-profile/service");
    const p1 = await getBusinessProfile(1);
    const p2 = await getBusinessProfile(2);
    expect(p1!.name).toBe("Acme Corp");
    expect(p2!.name).toBe("Other Business");
    expect(p1!.id).not.toBe(p2!.id);
  });
});
