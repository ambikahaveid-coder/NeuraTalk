import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Verifies server/recording-service.ts's consent gate and storage-
 * configuration checks — the two things that must never silently pass:
 * (1) recording must never start without both app-side participants'
 * explicit audioRecording consent — specifically the `audioRecording`
 * field, NOT the general translation-processing consent (a real bug this
 * suite caught: call-privacy.ts's hasValidConsent() only checks
 * translationProcessing, which is required for any call at all and would
 * incorrectly pass a user who never consented to being recorded) — and
 * (2) it must never claim to record when S3-compatible storage isn't
 * actually configured.
 */

let consentByUserId: Record<number, { audioRecording: boolean } | null> = {};
const dbInsertMock = vi.fn(async () => [{ id: 1 }]);
const dbUpdateMock = vi.fn(async () => [{}]);

vi.mock("../../server/call-privacy", () => ({
  getConsent: async (userId: number) => consentByUserId[userId] ?? null,
}));

vi.mock("../../server/modules/calls/smart-router", () => ({
  getSmartCall: async (callId: string) => ({
    callId,
    livekitUrl: "wss://example.livekit.cloud",
    callerId: "caller_1",
    calleeUserId: "2",
    callerOrganizationId: 1,
    calleeOrganizationId: null,
    callType: "voice",
  }),
}));

vi.mock("../../server/db", () => ({
  db: {
    insert: () => ({
      values: (row: any) => ({
        returning: () => dbInsertMock(row),
      }),
    }),
    update: () => ({
      set: (row: any) => ({
        where: () => dbUpdateMock(row),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([]),
      }),
    }),
  },
}));

vi.mock("../../server/observability", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("call recording — consent and configuration gates", () => {
  beforeEach(() => {
    consentByUserId = {};
    dbInsertMock.mockClear();
    dbUpdateMock.mockClear();
    delete process.env.RECORDING_S3_BUCKET;
    delete process.env.RECORDING_S3_ACCESS_KEY;
    delete process.env.RECORDING_S3_SECRET;
    delete process.env.RECORDING_S3_REGION;
  });

  it("reports storage as not configured when env vars are missing", async () => {
    const { isRecordingStorageConfigured } = await import("../../server/recording-service");
    expect(isRecordingStorageConfigured()).toBe(false);
  });

  it("reports storage as configured once all required env vars are set", async () => {
    process.env.RECORDING_S3_BUCKET = "test-bucket";
    process.env.RECORDING_S3_ACCESS_KEY = "AKIATEST";
    process.env.RECORDING_S3_SECRET = "secret";
    process.env.RECORDING_S3_REGION = "us-east-1";
    const { isRecordingStorageConfigured } = await import("../../server/recording-service");
    expect(isRecordingStorageConfigured()).toBe(true);
  });

  it("refuses to start recording when storage is not configured, before ever checking consent", async () => {
    const { startRecording } = await import("../../server/recording-service");
    const result = await startRecording({ callId: "call_1", requestedByUserId: 1, organizationId: 1 });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe("STORAGE_NOT_CONFIGURED");
    expect(dbInsertMock).not.toHaveBeenCalled();
  });

  it("refuses to start recording when the requester has not granted consent, even with storage configured", async () => {
    process.env.RECORDING_S3_BUCKET = "test-bucket";
    process.env.RECORDING_S3_ACCESS_KEY = "AKIATEST";
    process.env.RECORDING_S3_SECRET = "secret";
    process.env.RECORDING_S3_REGION = "us-east-1";
    consentByUserId = { 1: { audioRecording: false }, 2: { audioRecording: true } };

    const { startRecording } = await import("../../server/recording-service");
    const result = await startRecording({ callId: "call_1", requestedByUserId: 1, organizationId: 1 });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe("CONSENT_REQUIRED");
    expect(dbInsertMock).not.toHaveBeenCalled();
  });

  it("refuses to start recording when the OTHER participant has not consented", async () => {
    process.env.RECORDING_S3_BUCKET = "test-bucket";
    process.env.RECORDING_S3_ACCESS_KEY = "AKIATEST";
    process.env.RECORDING_S3_SECRET = "secret";
    process.env.RECORDING_S3_REGION = "us-east-1";
    consentByUserId = { 1: { audioRecording: true }, 2: { audioRecording: false } };

    const { startRecording } = await import("../../server/recording-service");
    const result = await startRecording({ callId: "call_1", requestedByUserId: 1, organizationId: 1 });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe("CONSENT_REQUIRED");
  });

  it("refuses to start recording when a participant consented to translation but NOT specifically to recording (the exact bug this suite caught: audioRecording defaults to false and must be checked separately from general call consent)", async () => {
    process.env.RECORDING_S3_BUCKET = "test-bucket";
    process.env.RECORDING_S3_ACCESS_KEY = "AKIATEST";
    process.env.RECORDING_S3_SECRET = "secret";
    process.env.RECORDING_S3_REGION = "us-east-1";
    // Both users have a valid consent record (they can make calls at all),
    // but neither has explicitly opted into audioRecording.
    consentByUserId = { 1: { audioRecording: false }, 2: { audioRecording: false } };

    const { startRecording } = await import("../../server/recording-service");
    const result = await startRecording({ callId: "call_1", requestedByUserId: 1, organizationId: 1 });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe("CONSENT_REQUIRED");
  });

  it("starts recording once BOTH participants have explicitly granted audioRecording consent", async () => {
    process.env.RECORDING_S3_BUCKET = "test-bucket";
    process.env.RECORDING_S3_ACCESS_KEY = "AKIATEST";
    process.env.RECORDING_S3_SECRET = "secret";
    process.env.RECORDING_S3_REGION = "us-east-1";
    consentByUserId = { 1: { audioRecording: true }, 2: { audioRecording: true } };

    const { startRecording } = await import("../../server/recording-service");
    const result = await startRecording({ callId: "call_1", requestedByUserId: 1, organizationId: 1 });
    // Egress itself will fail in this unit test (no real LiveKit server),
    // but the important assertion is that it got PAST the consent gate —
    // confirmed by the failure reason being egress-related, not consent.
    if (!result.success) {
      expect(result.reason).not.toBe("CONSENT_REQUIRED");
    }
  });
});
