import { describe, it, expect, vi } from "vitest";
import type { CallTranslation } from "../../shared/schema";

// service.ts imports server/db.ts at module scope for its query functions,
// which triggers a real Postgres connection + a startup env-conflict guard
// (server/load-env.ts). These tests only exercise the pure export functions
// (exportTranscriptAsTxt/Pdf/Docx), which touch no database — db is mocked
// out entirely rather than weakening that guard.
vi.mock("../../server/db", () => ({ db: {} }));

function makeSegment(overrides: Partial<CallTranslation> = {}): CallTranslation {
  return {
    id: 1,
    callId: 42,
    smartCallId: null,
    direction: "caller_to_receiver",
    speakerIdentity: "user-7",
    targetIdentity: "user-9",
    originalText: "Hello, how are you?",
    originalLanguage: "en",
    translatedText: "Hola, ¿cómo estás?",
    translatedLanguage: "es",
    emotionDetected: null,
    emotionIntensity: null,
    latencyMs: 320,
    timestamp: new Date("2026-01-01T10:00:00Z"),
    ...overrides,
  } as CallTranslation;
}

describe("Transcript export — TXT", () => {
  it("includes speaker identity, both languages, and both texts", async () => {
    const { exportTranscriptAsTxt } = await import("../../server/modules/transcripts/service");
    const txt = exportTranscriptAsTxt([makeSegment()]);
    expect(txt).toContain("user-7");
    expect(txt).toContain("Hello, how are you?");
    expect(txt).toContain("Hola, ¿cómo estás?");
    expect(txt).toContain("(en)");
    expect(txt).toContain("(es)");
  }, 20_000); // first import in this file pays a one-time cold-transform cost

  it("falls back to a direction-based label when no speaker identity is set (legacy segments)", async () => {
    const { exportTranscriptAsTxt } = await import("../../server/modules/transcripts/service");
    const txt = exportTranscriptAsTxt([makeSegment({ speakerIdentity: null, direction: "receiver_to_caller" })]);
    expect(txt).toContain("Receiver");
  });

  it("renders multiple segments in order, separated", async () => {
    const { exportTranscriptAsTxt } = await import("../../server/modules/transcripts/service");
    const txt = exportTranscriptAsTxt([
      makeSegment({ id: 1, originalText: "First" }),
      makeSegment({ id: 2, originalText: "Second" }),
    ]);
    expect(txt.indexOf("First")).toBeLessThan(txt.indexOf("Second"));
  });
});

describe("Transcript export — PDF", () => {
  it("produces a real, non-empty PDF buffer with the correct file signature", async () => {
    const { exportTranscriptAsPdf } = await import("../../server/modules/transcripts/service");
    const buffer = await exportTranscriptAsPdf([makeSegment()], "Test Call Transcript");
    expect(buffer.length).toBeGreaterThan(100);
    // Real PDF files start with the "%PDF-" magic bytes — proves this is an
    // actual PDF, not a placeholder/mock buffer.
    expect(buffer.subarray(0, 5).toString("utf8")).toBe("%PDF-");
  }, 15_000);
});

describe("Transcript export — DOCX", () => {
  it("produces a real, non-empty DOCX buffer with the correct ZIP signature", async () => {
    const { exportTranscriptAsDocx } = await import("../../server/modules/transcripts/service");
    const buffer = await exportTranscriptAsDocx([makeSegment()], "Test Call Transcript");
    expect(buffer.length).toBeGreaterThan(100);
    // DOCX files are ZIP archives — real ZIP magic bytes "PK\x03\x04".
    expect(buffer.subarray(0, 2).toString("utf8")).toBe("PK");
  }, 15_000);
});
