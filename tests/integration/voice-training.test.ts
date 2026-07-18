import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

process.env.SESSION_SECRET = "test-only-session-secret-not-a-real-secret-32chars";

// In-memory fake tables — this is an integration test of route wiring,
// RBAC, and state transitions, not of Postgres itself (which the broader
// engagement's security audit already covers for the auth layer this
// mocks out below).
type Row = Record<string, any>;
let voiceProfilesTable: Row[] = [];
let voiceSamplesTable: Row[] = [];
let nextProfileId = 1;
let nextSampleId = 1;

function matches(row: Row, conditions: any[]): boolean {
  return conditions.every((c) => {
    if (!c || typeof c !== "object") return true;
    if ("__and" in c) return matches(row, c.__and);
    return row[c.column] === c.value;
  });
}

vi.mock("../../server/db", () => {
  // Route to the right backing array by identity of the mocked schema
  // object passed to .from(table) — mirrors real drizzle's per-table typing.
  const tableFor = (table: any): Row[] =>
    table && "trainingStatus" in table ? voiceProfilesTable : voiceSamplesTable;

  const makeQuery = () => ({
    from: (table: any) => ({
      where: (cond: any) => {
        const result = tableFor(table).filter((r) => matches(r, cond?.__and ?? [cond]));
        return Promise.resolve(result);
      },
    }),
  });
  return {
    db: {
      select: () => makeQuery(),
      insert: (table: any) => ({
        values: (vals: Row) => ({
          returning: async () => {
            const isProfile = "trainingStatus" in vals || "voiceId" in vals;
            const row = { id: isProfile ? nextProfileId++ : nextSampleId++, ...vals };
            (isProfile ? voiceProfilesTable : voiceSamplesTable).push(row);
            return [row];
          },
        }),
      }),
      update: () => ({
        set: (updates: Row) => ({
          where: (cond: any) => {
            // Perform the mutation eagerly here, not inside .returning() —
            // real call sites in voice-training.ts sometimes await
            // .where(...) directly without chaining .returning().
            const conditions = cond?.__and ?? [cond];
            const updated: Row[] = [];
            for (const t of [voiceProfilesTable, voiceSamplesTable]) {
              for (const row of t) {
                if (matches(row, conditions)) {
                  Object.assign(row, updates);
                  updated.push(row);
                }
              }
            }
            return Object.assign(Promise.resolve(updated), { returning: async () => updated });
          },
        }),
      }),
      delete: () => ({
        where: (cond: any) => {
          const conditions = cond?.__and ?? [cond];
          voiceSamplesTable = voiceSamplesTable.filter((r) => !matches(r, conditions));
          return Promise.resolve();
        },
      }),
    },
  };
});

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (col: any, value: any) => ({ column: typeof col === "string" ? col : col.name, value }),
    and: (...conds: any[]) => ({ __and: conds }),
  };
});

vi.mock("@shared/schema", () => ({
  voiceSamples: { userId: "userId", voiceProfileId: "voiceProfileId", id: "id", consentGiven: "consentGiven" },
  voiceProfiles: { userId: "userId", isCustom: "isCustom", id: "id", trainingStatus: "trainingStatus", moderationStatus: "moderationStatus" },
}));

vi.mock("../../server/ai_integrations/object_storage", () => ({
  ObjectStorageService: class {
    async getObjectEntityUploadURL() { return "https://fake-storage.example/upload?sig=test"; }
    normalizeObjectEntityPath(url: string) { return `/objects/${url.split("?")[0].split("/").pop()}`; }
    async getObjectEntityFile() { return { delete: async () => {}, download: async () => [Buffer.from("fake-audio")] }; }
  },
}));

vi.mock("../../server/audit", () => ({
  AuditHelpers: { logUpdate: vi.fn(async () => {}) },
}));

// Guarantees zero real network calls to ElevenLabs from this test run,
// regardless of what's in the environment's ELEVEN_LABS_API_KEY.
const deleteElevenLabsVoiceMock = vi.fn(async () => {});
vi.mock("../../server/voice-cloning-service", () => ({
  deleteElevenLabsVoice: deleteElevenLabsVoiceMock,
  enrollElevenLabsVoice: vi.fn(async () => ({ voiceId: "test-voice-id" })),
}));

let currentUser: { id: number; role: string } = { id: 1, role: "consumer" };
vi.mock("../../server/role-middleware", () => ({
  loadUser: (req: any, _res: any, next: any) => { req.user = currentUser; next(); },
  requireAuth: (_req: any, _res: any, next: any) => next(),
  requireSuperAdmin: (req: any, res: any, next: any) =>
    req.user?.role === "super_admin" ? next() : res.status(403).json({ error: "Forbidden" }),
}));

async function buildApp(): Promise<Express> {
  const { registerVoiceTrainingRoutes } = await import("../../server/voice-training");
  const app = express();
  app.use(express.json());
  registerVoiceTrainingRoutes(app);
  return app;
}

beforeEach(() => {
  voiceProfilesTable = [];
  voiceSamplesTable = [];
  nextProfileId = 1;
  nextSampleId = 1;
  currentUser = { id: 1, role: "consumer" };
  vi.clearAllMocks();
});

describe("Voice Training API — consent workflow", () => {
  it("rejects sample creation without consent", async () => {
    const app = await buildApp();
    const res = await request(app)
      .post("/api/voice-training/samples")
      .send({ objectPath: "/objects/x", consent: false });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/consent/i);
  });

  it("accepts and records a sample with consent", async () => {
    const app = await buildApp();
    const res = await request(app)
      .post("/api/voice-training/samples")
      .send({ objectPath: "/objects/x", consent: true });
    expect(res.status).toBe(201);
    expect(voiceSamplesTable).toHaveLength(1);
    expect(voiceSamplesTable[0].consentGiven).toBe(true);
    expect(voiceSamplesTable[0].consentTimestamp).toBeInstanceOf(Date);
  });

  it("rejects the upload-URL request without consent", async () => {
    const app = await buildApp();
    const res = await request(app).post("/api/voice-training/request-upload").send({ consent: false });
    expect(res.status).toBe(400);
  });

  it("issues an encrypted, signed upload URL with consent", async () => {
    const app = await buildApp();
    const res = await request(app).post("/api/voice-training/request-upload").send({ consent: true });
    expect(res.status).toBe(200);
    expect(res.body.uploadURL).toMatch(/^https:\/\//);
    // objectPath in the response must be encrypted, not the raw storage path
    expect(res.body.objectPath).not.toContain("/objects/");
    expect(res.body.objectPath.split(":")).toHaveLength(3); // iv:authTag:ciphertext
  });
});

describe("Voice Training API — sample listing and deletion", () => {
  it("lists only the requesting user's own samples", async () => {
    currentUser = { id: 7, role: "consumer" };
    voiceSamplesTable.push({ id: 1, userId: 7, duration: 12, transcript: "hello", status: "pending", createdAt: new Date() });
    voiceSamplesTable.push({ id: 2, userId: 99, duration: 8, transcript: "other user", status: "pending", createdAt: new Date() });

    const app = await buildApp();
    const res = await request(app).get("/api/voice-training/samples/7");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(1);
  });

  it("denies listing another user's samples", async () => {
    currentUser = { id: 1, role: "consumer" };
    const app = await buildApp();
    const res = await request(app).get("/api/voice-training/samples/999");
    expect(res.status).toBe(403);
  });

  it("deletes a single owned sample", async () => {
    currentUser = { id: 7, role: "consumer" };
    voiceSamplesTable.push({ id: 1, userId: 7, objectPath: "not-real-ciphertext" });
    const app = await buildApp();
    const res = await request(app).delete("/api/voice-training/samples/1");
    expect(res.status).toBe(200);
    expect(voiceSamplesTable).toHaveLength(0);
  });

  it("404s deleting a sample that belongs to someone else", async () => {
    currentUser = { id: 7, role: "consumer" };
    voiceSamplesTable.push({ id: 1, userId: 999, objectPath: "not-real-ciphertext" });
    const app = await buildApp();
    const res = await request(app).delete("/api/voice-training/samples/1");
    expect(res.status).toBe(404);
    expect(voiceSamplesTable).toHaveLength(1); // untouched
  });
});

describe("Voice Training API — training kickoff", () => {
  it("refuses to start training with fewer than 3 consented samples", async () => {
    currentUser = { id: 7, role: "consumer" };
    voiceSamplesTable.push({ id: 1, userId: 7, consentGiven: true });
    voiceSamplesTable.push({ id: 2, userId: 7, consentGiven: true });
    const app = await buildApp();
    const res = await request(app).post("/api/voice-training/train/7");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/insufficient/i);
  });

  it("starts training and creates a new profile with 3+ consented samples, then completes async training", async () => {
    currentUser = { id: 7, role: "consumer" };
    // Use the real encrypt() so the async download step's decrypt() call
    // succeeds and the (mocked) ElevenLabs enrollment actually runs.
    const { encrypt } = await import("../../server/voice-training");
    voiceSamplesTable.push({ id: 1, userId: 7, consentGiven: true, objectPath: encrypt("/objects/1") });
    voiceSamplesTable.push({ id: 2, userId: 7, consentGiven: true, objectPath: encrypt("/objects/2") });
    voiceSamplesTable.push({ id: 3, userId: 7, consentGiven: true, objectPath: encrypt("/objects/3") });
    const app = await buildApp();
    const res = await request(app).post("/api/voice-training/train/7");
    expect(res.status).toBe(200);
    expect(res.body.profileId).toBeDefined();

    // The response returns before the background training job finishes;
    // give the fire-and-forget IIFE a tick to complete against our mocks.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const profile = voiceProfilesTable.find((p) => p.id === res.body.profileId);
    expect(profile.trainingStatus).toBe("ready");
    expect(profile.voiceId).toBe("eleven_test-voice-id");
    // New profiles must stay disabled until moderation approves them, even
    // after training completes successfully.
    expect(profile.isEnabled).toBe(false);
  });

  it("denies starting training for another user's profile", async () => {
    currentUser = { id: 1, role: "consumer" };
    const app = await buildApp();
    const res = await request(app).post("/api/voice-training/train/999");
    expect(res.status).toBe(403);
  });
});

describe("Voice Training API — RBAC", () => {
  it("denies a user from viewing another user's profile", async () => {
    currentUser = { id: 1, role: "consumer" };
    const app = await buildApp();
    const res = await request(app).get("/api/voice-training/profile/999");
    expect(res.status).toBe(403);
  });

  it("allows a user to view their own profile", async () => {
    currentUser = { id: 42, role: "consumer" };
    const app = await buildApp();
    const res = await request(app).get("/api/voice-training/profile/42");
    expect(res.status).toBe(200);
  });

  it("allows super_admin to view any profile", async () => {
    currentUser = { id: 1, role: "super_admin" };
    const app = await buildApp();
    const res = await request(app).get("/api/voice-training/profile/999");
    expect(res.status).toBe(200);
  });

  it("denies a non-admin from the moderation queue", async () => {
    currentUser = { id: 1, role: "consumer" };
    const app = await buildApp();
    const res = await request(app).get("/api/voice-training/admin/pending-review");
    expect(res.status).toBe(403);
  });

  it("allows super_admin to reach the moderation queue", async () => {
    currentUser = { id: 1, role: "super_admin" };
    const app = await buildApp();
    const res = await request(app).get("/api/voice-training/admin/pending-review");
    expect(res.status).toBe(200);
  });
});

describe("Voice Training API — moderation gate", () => {
  it("a newly trained profile cannot be enabled by its owner before approval", async () => {
    currentUser = { id: 7, role: "consumer" };
    voiceProfilesTable.push({
      id: 1, userId: 7, isCustom: true, trainingStatus: "ready",
      moderationStatus: "pending", isEnabled: false, name: "Test Voice", voiceId: "eleven_abc",
    });
    const app = await buildApp();
    const res = await request(app).patch("/api/voice-training/profile/7/toggle").send({ enabled: true });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not been approved/i);
  });

  it("owner can enable a profile once approved", async () => {
    currentUser = { id: 7, role: "consumer" };
    voiceProfilesTable.push({
      id: 1, userId: 7, isCustom: true, trainingStatus: "ready",
      moderationStatus: "approved", isEnabled: false, name: "Test Voice", voiceId: "eleven_abc",
    });
    const app = await buildApp();
    const res = await request(app).patch("/api/voice-training/profile/7/toggle").send({ enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.isEnabled).toBe(true);
  });

  it("owner can always disable their own profile regardless of moderation status", async () => {
    currentUser = { id: 7, role: "consumer" };
    voiceProfilesTable.push({
      id: 1, userId: 7, isCustom: true, trainingStatus: "ready",
      moderationStatus: "pending", isEnabled: true, name: "Test Voice", voiceId: "eleven_abc",
    });
    const app = await buildApp();
    const res = await request(app).patch("/api/voice-training/profile/7/toggle").send({ enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.isEnabled).toBe(false);
  });

  it("admin approval sets moderationStatus and isEnabled together", async () => {
    currentUser = { id: 1, role: "super_admin" };
    voiceProfilesTable.push({
      id: 5, userId: 7, isCustom: true, trainingStatus: "ready",
      moderationStatus: "pending", isEnabled: false, name: "Test Voice", voiceId: "eleven_abc",
    });
    const app = await buildApp();
    const res = await request(app).post("/api/voice-training/admin/5/moderate").send({ approve: true, notes: "sounds fine" });
    expect(res.status).toBe(200);
    expect(res.body.profile.moderationStatus).toBe("approved");
    expect(res.body.profile.isEnabled).toBe(true);
  });

  it("admin rejection disables the profile", async () => {
    currentUser = { id: 1, role: "super_admin" };
    voiceProfilesTable.push({
      id: 5, userId: 7, isCustom: true, trainingStatus: "ready",
      moderationStatus: "pending", isEnabled: false, name: "Test Voice", voiceId: "eleven_abc",
    });
    const app = await buildApp();
    const res = await request(app).post("/api/voice-training/admin/5/moderate").send({ approve: false });
    expect(res.status).toBe(200);
    expect(res.body.profile.moderationStatus).toBe("rejected");
    expect(res.body.profile.isEnabled).toBe(false);
  });
});

describe("Voice Training API — delete-all", () => {
  it("requires explicit confirmDelete", async () => {
    currentUser = { id: 7, role: "consumer" };
    const app = await buildApp();
    const res = await request(app).delete("/api/voice-training/delete-all/7").send({});
    expect(res.status).toBe(400);
  });

  it("clears local samples, deletes the provider-side voice, and resets the profile", async () => {
    currentUser = { id: 7, role: "consumer" };
    voiceProfilesTable.push({ id: 1, userId: 7, isCustom: true, trainingStatus: "ready", voiceId: "eleven_xyz" });
    voiceSamplesTable.push({ id: 1, userId: 7, objectPath: "/objects/a" });
    voiceSamplesTable.push({ id: 2, userId: 7, objectPath: "/objects/b" });

    const app = await buildApp();
    const res = await request(app).delete("/api/voice-training/delete-all/7").send({ confirmDelete: true });

    expect(res.status).toBe(200);
    expect(res.body.deletedSamples).toBe(2);
    expect(voiceSamplesTable).toHaveLength(0);
    expect(voiceProfilesTable[0].trainingStatus).toBe("pending");
    expect(voiceProfilesTable[0].isCustom).toBe(false);
    // Item 8 of the certification checklist: provider-side deletion must
    // actually be called, with the un-prefixed real ElevenLabs voice id.
    expect(deleteElevenLabsVoiceMock).toHaveBeenCalledWith("xyz");
  });

  it("denies deleting another user's voice data", async () => {
    currentUser = { id: 1, role: "consumer" };
    const app = await buildApp();
    const res = await request(app).delete("/api/voice-training/delete-all/999").send({ confirmDelete: true });
    expect(res.status).toBe(403);
  });
});
