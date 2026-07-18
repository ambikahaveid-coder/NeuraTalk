import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

const getTranscriptMock = vi.fn(async () => [] as any[]);
const getCallOwnerUserIdsMock = vi.fn(async () => [] as number[]);
const searchTranscriptsMock = vi.fn(async () => ({ results: [] as any[], total: 0, limit: 50, offset: 0 }));
const deleteTranscriptMock = vi.fn(async () => 0);
const exportTxtMock = vi.fn(() => "plain text transcript");
const exportPdfMock = vi.fn(async () => Buffer.from("%PDF-fake"));
const exportDocxMock = vi.fn(async () => Buffer.from("PKfake"));

vi.mock("../../server/modules/transcripts/service", () => ({
  getTranscript: (...args: any[]) => getTranscriptMock(...args),
  getCallOwnerUserIds: (...args: any[]) => getCallOwnerUserIdsMock(...args),
  searchTranscripts: (...args: any[]) => searchTranscriptsMock(...args),
  deleteTranscript: (...args: any[]) => deleteTranscriptMock(...args),
  exportTranscriptAsTxt: (...args: any[]) => exportTxtMock(...args),
  exportTranscriptAsPdf: (...args: any[]) => exportPdfMock(...args),
  exportTranscriptAsDocx: (...args: any[]) => exportDocxMock(...args),
}));

vi.mock("../../server/modules/transcripts/metrics", () => ({
  recordTranscriptCounter: vi.fn(),
  getTranscriptMetricsSnapshot: vi.fn(() => ({ counters: {}, lastRetentionSweep: null, lastRetentionFailure: null })),
}));

vi.mock("../../server/audit", () => ({
  AuditHelpers: {
    logCreate: vi.fn(async () => {}),
    logDelete: vi.fn(async () => {}),
    logSettingsChange: vi.fn(async () => {}),
  },
  getAuditLogs: vi.fn(async () => ({ logs: [], total: 0, limit: 50, offset: 0 })),
}));

// controller.ts's admin endpoints (adminSearch, getRetentionSettings, etc.)
// query the DB directly rather than through service.ts — mocked here so
// this file continues to test route wiring/RBAC without a real Postgres
// connection, consistent with how service.ts itself is mocked above.
// dbQueryMock backs BOTH `.from(x)` awaited directly (e.g. `db.select().from(callConsents)`,
// no `.where()`) and `.from(x).where(...)` chains — controller.ts uses both shapes.
const dbQueryMock = vi.fn(async () => [] as any[]);
const dbUpdateMock = vi.fn(async () => undefined);
function dbChain() {
  return {
    then: (resolve: any, reject: any) => dbQueryMock().then(resolve, reject),
    where: (...args: any[]) => dbQueryMock(...args),
  };
}
vi.mock("../../server/db", () => ({
  db: {
    select: () => ({ from: () => dbChain() }),
    update: () => ({ set: () => ({ where: (...args: any[]) => dbUpdateMock(...args) }) }),
  },
}));
vi.mock("@shared/schema", () => ({
  users: { id: "id", organizationId: "organizationId" },
  callConsents: { userId: "userId" },
  organizations: { id: "id", settings: "settings" },
}));
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, eq: (col: any, value: any) => ({ col, value }) };
});

let currentUser: { id: number; role: string; organizationId?: number | null } = { id: 1, role: "consumer" };
vi.mock("../../server/role-middleware", () => ({
  loadUser: (req: any, _res: any, next: any) => { req.user = currentUser; next(); },
  requireAuth: (_req: any, _res: any, next: any) => next(),
}));

async function buildApp(): Promise<Express> {
  const { registerTranscriptRoutes } = await import("../../server/modules/transcripts/routes");
  const app = express();
  app.use(express.json());
  registerTranscriptRoutes(app);
  return app;
}

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) — clearAllMocks does not drain queued
  // .mockResolvedValueOnce() implementations, which was leaking return
  // values between unrelated tests further down this file.
  vi.resetAllMocks();
  currentUser = { id: 1, role: "consumer" };
  getTranscriptMock.mockResolvedValue([{ id: 1, originalText: "hi", translatedText: "hola" }]);
  getCallOwnerUserIdsMock.mockResolvedValue([]);
  searchTranscriptsMock.mockResolvedValue({ results: [], total: 0, limit: 50, offset: 0 });
  exportTxtMock.mockReturnValue("plain text transcript");
  exportPdfMock.mockResolvedValue(Buffer.from("%PDF-fake"));
  exportDocxMock.mockResolvedValue(Buffer.from("PKfake"));
  dbQueryMock.mockResolvedValue([]);
  dbUpdateMock.mockResolvedValue(undefined);
});

describe("Transcript API — RBAC", () => {
  it("denies a non-participant from viewing a transcript", async () => {
    getCallOwnerUserIdsMock.mockResolvedValueOnce([999]);
    const app = await buildApp();
    const res = await request(app).get("/api/transcripts/call_abc");
    expect(res.status).toBe(403);
  });

  it("allows a call participant to view the transcript", async () => {
    currentUser = { id: 7, role: "consumer" };
    getCallOwnerUserIdsMock.mockResolvedValueOnce([7, 9]);
    const app = await buildApp();
    const res = await request(app).get("/api/transcripts/call_abc");
    expect(res.status).toBe(200);
    expect(res.body.segments).toHaveLength(1);
  });

  it("allows super_admin to view any transcript without being a participant", async () => {
    currentUser = { id: 1, role: "super_admin" };
    getCallOwnerUserIdsMock.mockResolvedValueOnce([999]);
    const app = await buildApp();
    const res = await request(app).get("/api/transcripts/call_abc");
    expect(res.status).toBe(200);
    // Ownership lookup shouldn't even be needed for super_admin, but if it
    // is called, the route must still allow access regardless of its result.
  });

  it("denies deleting a transcript you don't own", async () => {
    getCallOwnerUserIdsMock.mockResolvedValueOnce([999]);
    const app = await buildApp();
    const res = await request(app).delete("/api/transcripts/call_abc");
    expect(res.status).toBe(403);
    expect(deleteTranscriptMock).not.toHaveBeenCalled();
  });

  it("denies exporting a transcript you don't own", async () => {
    getCallOwnerUserIdsMock.mockResolvedValueOnce([999]);
    const app = await buildApp();
    const res = await request(app).get("/api/transcripts/call_abc/export/txt");
    expect(res.status).toBe(403);
  });
});

describe("Transcript API — export", () => {
  beforeEach(() => {
    currentUser = { id: 7, role: "consumer" };
    getCallOwnerUserIdsMock.mockResolvedValue([7]);
  });

  it("rejects an unsupported export format", async () => {
    const app = await buildApp();
    const res = await request(app).get("/api/transcripts/call_abc/export/exe");
    expect(res.status).toBe(400);
  });

  it("returns 404 when there's nothing to export", async () => {
    getCallOwnerUserIdsMock.mockResolvedValueOnce([7]);
    getTranscriptMock.mockResolvedValueOnce([]);
    const app = await buildApp();
    const res = await request(app).get("/api/transcripts/call_abc/export/txt");
    expect(res.status).toBe(404);
  });

  it("exports TXT with the correct content-type and filename", async () => {
    getCallOwnerUserIdsMock.mockResolvedValueOnce([7]);
    const app = await buildApp();
    const res = await request(app).get("/api/transcripts/call_abc/export/txt");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/plain/);
    expect(res.headers["content-disposition"]).toContain("transcript-call_abc.txt");
  });

  it("exports PDF with the correct content-type", async () => {
    const app = await buildApp();
    const res = await request(app).get("/api/transcripts/call_abc/export/pdf");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(exportPdfMock).toHaveBeenCalled();
  });

  it("exports DOCX with the correct content-type", async () => {
    const app = await buildApp();
    const res = await request(app).get("/api/transcripts/call_abc/export/docx");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("wordprocessingml");
    expect(exportDocxMock).toHaveBeenCalled();
  });
});

describe("Transcript API — search", () => {
  it("rejects a too-short query", async () => {
    const app = await buildApp();
    const res = await request(app).get("/api/transcripts/search?q=a");
    expect(res.status).toBe(400);
  });

  it("scopes search to the requesting user by default (not org-wide)", async () => {
    currentUser = { id: 7, role: "consumer", organizationId: 42 };
    const app = await buildApp();
    await request(app).get("/api/transcripts/search?q=hello");
    expect(searchTranscriptsMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7, organizationId: undefined }),
    );
  });

  it("scopes search to the org only when explicitly requested and the user has one", async () => {
    currentUser = { id: 7, role: "consumer", organizationId: 42 };
    const app = await buildApp();
    await request(app).get("/api/transcripts/search?q=hello&scope=org");
    expect(searchTranscriptsMock).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 42, userId: undefined }),
    );
  });
});

describe("Transcript API — enterprise admin", () => {
  it("denies admin search to a plain consumer", async () => {
    currentUser = { id: 1, role: "consumer", organizationId: 42 };
    const app = await buildApp();
    const res = await request(app).get("/api/admin/transcripts/search?q=hello");
    expect(res.status).toBe(403);
    expect(searchTranscriptsMock).not.toHaveBeenCalled();
  });

  it("denies admin search to a user with no organization", async () => {
    currentUser = { id: 1, role: "company_admin", organizationId: null };
    const app = await buildApp();
    const res = await request(app).get("/api/admin/transcripts/search?q=hello");
    expect(res.status).toBe(403);
  });

  it("allows company_admin to search their org with filters", async () => {
    currentUser = { id: 1, role: "company_admin", organizationId: 42 };
    const app = await buildApp();
    const res = await request(app).get("/api/admin/transcripts/search?q=hello&userId=9&limit=10&offset=20");
    expect(res.status).toBe(200);
    expect(searchTranscriptsMock).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 42, filterUserId: 9, limit: 10, offset: 20 }),
    );
  });

  it("allows super_admin to reach admin search even without matching organizationId on the request", async () => {
    currentUser = { id: 1, role: "super_admin", organizationId: 42 };
    const app = await buildApp();
    const res = await request(app).get("/api/admin/transcripts/search?q=hello");
    expect(res.status).toBe(200);
  });

  it("company_admin can export a call belonging to their org member", async () => {
    currentUser = { id: 1, role: "company_admin", organizationId: 42 };
    getCallOwnerUserIdsMock.mockResolvedValueOnce([9]); // org member, not the admin themself
    dbQueryMock.mockResolvedValueOnce([{ id: 9 }]); // org members lookup used by canAccessCall
    const app = await buildApp();
    const res = await request(app).get("/api/admin/transcripts/call_abc/export/txt");
    expect(res.status).toBe(200);
  });

  it("denies admin retention view to non-admins", async () => {
    currentUser = { id: 1, role: "consumer", organizationId: 42 };
    const app = await buildApp();
    const res = await request(app).get("/api/admin/transcripts/retention");
    expect(res.status).toBe(403);
  });

  it("allows company_admin to view retention settings", async () => {
    currentUser = { id: 1, role: "company_admin", organizationId: 42 };
    const app = await buildApp();
    const res = await request(app).get("/api/admin/transcripts/retention");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("orgDefault");
    expect(res.body).toHaveProperty("members");
  });

  it("rejects an invalid retention tier", async () => {
    currentUser = { id: 1, role: "company_admin", organizationId: 42 };
    const app = await buildApp();
    const res = await request(app).patch("/api/admin/transcripts/retention").send({ dataRetention: "forever" });
    expect(res.status).toBe(400);
  });

  it("accepts a valid retention tier update", async () => {
    currentUser = { id: 1, role: "company_admin", organizationId: 42 };
    const app = await buildApp();
    const res = await request(app).patch("/api/admin/transcripts/retention").send({ dataRetention: "7days" });
    expect(res.status).toBe(200);
    expect(res.body.transcriptRetentionDefault).toBe("7days");
  });

  it("denies the audit log to non-admins", async () => {
    currentUser = { id: 1, role: "consumer", organizationId: 42 };
    const app = await buildApp();
    const res = await request(app).get("/api/admin/transcripts/audit-log");
    expect(res.status).toBe(403);
  });

  it("returns the audit log for company_admin", async () => {
    currentUser = { id: 1, role: "company_admin", organizationId: 42 };
    const app = await buildApp();
    const res = await request(app).get("/api/admin/transcripts/audit-log");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("logs");
  });
});

describe("Transcript API — monitoring", () => {
  it("denies metrics to non-super-admins", async () => {
    currentUser = { id: 1, role: "company_admin", organizationId: 42 };
    const app = await buildApp();
    const res = await request(app).get("/api/admin/transcripts/metrics");
    expect(res.status).toBe(403);
  });

  it("returns metrics for super_admin", async () => {
    currentUser = { id: 1, role: "super_admin" };
    const app = await buildApp();
    const res = await request(app).get("/api/admin/transcripts/metrics");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("counters");
  });
});
