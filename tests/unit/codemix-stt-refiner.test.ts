import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../server/sarvam-service", () => ({
  isSarvamAvailable: () => true,
  isSarvamLanguage: (l: string) => ["hi", "te", "ta", "kn", "ml", "mr", "bn", "gu", "pa", "en", "auto"].includes(l.split("-")[0]),
  sarvamSTT: vi.fn(),
}));

import { UtteranceAudioBuffer, refineCodemixTranscript, shouldRefineCodemix } from "../../server/translation/codemix-stt-refiner";

const frame = (ms: number, value = 1000) => new Int16Array((16_000 * ms) / 1000).fill(value);

describe("UtteranceAudioBuffer", () => {
  it("returns a valid 16 kHz mono PCM WAV and clears itself", () => {
    const buf = new UtteranceAudioBuffer();
    buf.push(frame(20));
    buf.push(frame(20));
    const wav = buf.takeWav()!;
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.readUInt32LE(24)).toBe(16_000);
    expect(wav.readUInt32LE(40)).toBe(640 * 2);
    expect(wav.length).toBe(44 + 640 * 2);
    expect(buf.takeWav()).toBeNull();
  });

  it("caps memory to the most recent audio", () => {
    const buf = new UtteranceAudioBuffer(100);
    for (let i = 0; i < 20; i++) buf.push(frame(20));
    expect(buf.durationMs).toBeLessThanOrEqual(120);
  });

  it("keepLast trims older audio, splitting a frame when needed", () => {
    const buf = new UtteranceAudioBuffer();
    buf.push(frame(1000, 1));
    buf.push(frame(200, 2));
    buf.keepLast(300);
    expect(buf.durationMs).toBe(300);
    const wav = buf.takeWav()!;
    expect(wav.readInt16LE(44)).toBe(1); // 100 ms of the older frame kept
    expect(wav.readInt16LE(wav.length - 2)).toBe(2);
  });
});

describe("shouldRefineCodemix", () => {
  beforeEach(() => { delete process.env.CODEMIX_STT_REFINE; });
  it("refines Indian languages but not English or auto", () => {
    expect(shouldRefineCodemix("te")).toBe(true);
    expect(shouldRefineCodemix("hi-IN")).toBe(true);
    expect(shouldRefineCodemix("en")).toBe(false);
    expect(shouldRefineCodemix("auto")).toBe(false);
    expect(shouldRefineCodemix("fr")).toBe(false);
  });
  it("can be switched off", () => {
    process.env.CODEMIX_STT_REFINE = "false";
    expect(shouldRefineCodemix("te")).toBe(false);
  });
});

describe("refineCodemixTranscript", () => {
  const wavOf = (ms: number) => { const b = new UtteranceAudioBuffer(); b.push(frame(ms)); return b.takeWav(); };

  it("uses Sarvam's transcript when it succeeds", async () => {
    const stt = vi.fn().mockResolvedValue("నేను meeting లో ఉన్నాను, 5 minutes లో call చేస్తా");
    const r = await refineCodemixTranscript(wavOf(1500), "te", "నేను మీటింగ్ లో ఉన్నాను 15 మినిట్స్ లో కాల్ చేస్తా", { stt });
    expect(r.refined).toBe(true);
    expect(r.text).toContain("5 minutes");
    expect(stt).toHaveBeenCalledWith(expect.any(Buffer), "te", "wav");
  });

  it("falls back to the streaming text on timeout", async () => {
    const stt = vi.fn(() => new Promise<string>((res) => setTimeout(() => res("late"), 200)));
    const r = await refineCodemixTranscript(wavOf(1500), "te", "streaming", { stt, timeoutMs: 20 });
    expect(r).toMatchObject({ text: "streaming", refined: false, reason: "timeout" });
  });

  it("falls back on error, empty or truncated results, and skips very short audio", async () => {
    expect((await refineCodemixTranscript(wavOf(1500), "te", "streaming", { stt: vi.fn().mockRejectedValue(new Error("500")) })).reason).toBe("error");
    expect((await refineCodemixTranscript(wavOf(1500), "te", "streaming", { stt: vi.fn().mockResolvedValue("  ") })).reason).toBe("empty");
    expect((await refineCodemixTranscript(wavOf(1500), "te", "a long streaming transcript here", { stt: vi.fn().mockResolvedValue("a lo") })).reason).toBe("implausibly_short");
    const stt = vi.fn();
    expect((await refineCodemixTranscript(wavOf(200), "te", "hi", { stt })).reason).toBe("too_short");
    expect(stt).not.toHaveBeenCalled();
    expect((await refineCodemixTranscript(null, "te", "hi", { stt })).reason).toBe("no_audio");
  });
});
