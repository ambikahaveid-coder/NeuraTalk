import { describe, it, expect, vi, beforeEach } from "vitest";

const enroll = vi.fn(async () => ({ voiceId: "learned123" }));
const remembered: Array<[string, string | null]> = [];
const writes: unknown[] = [];

vi.mock("../../server/voice-cloning-service", () => ({ enrollElevenLabsVoice: (...a: unknown[]) => enroll(...(a as [])) }));
vi.mock("../../server/cloned-voice", () => ({ rememberClonedVoice: (id: string, v: string | null) => remembered.push([id, v]) }));
vi.mock("../../server/observability", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../../server/db", () => {
  const chain = { from: () => chain, where: async () => [] as unknown[] };
  return {
    db: {
      select: () => chain,
      insert: () => ({ values: async (v: unknown) => { writes.push(v); } }),
      update: () => ({ set: () => ({ where: async () => {} }) }),
    },
  };
});

const voiced = new Int16Array(320).fill(8000);
const silent = new Int16Array(320);

describe("CallVoiceLearner", () => {
  beforeEach(() => { enroll.mockClear(); remembered.length = 0; writes.length = 0; });

  it("creates the voice once, after the target amount of clear speech, from speech only", async () => {
    const { CallVoiceLearner, VOICE_LEARNING_TARGET_MS } = await import("../../server/voice-learning");
    const ready = vi.fn();
    const learner = new CallVoiceLearner("7", 20, ready);
    for (let i = 0; i < 500; i++) learner.push(silent, false); // long silence before speaking: ignored
    const framesNeeded = VOICE_LEARNING_TARGET_MS / 20;
    for (let i = 0; i < framesNeeded - 1; i++) learner.push(voiced, true);
    expect(enroll).not.toHaveBeenCalled();
    learner.push(voiced, true);
    await vi.waitFor(() => expect(ready).toHaveBeenCalledWith("learned123"));
    expect(enroll).toHaveBeenCalledTimes(1);
    const wav = (enroll.mock.calls[0] as unknown as [Buffer[]])[0][0];
    // header + only the voiced audio (silence before speech is not sent)
    expect(wav.length).toBe(44 + framesNeeded * 320 * 2);
    expect(remembered).toEqual([["7", "learned123"]]);
    learner.push(voiced, true);
    expect(enroll).toHaveBeenCalledTimes(1);
  });

  it("a short call with too little speech creates nothing", async () => {
    const { CallVoiceLearner } = await import("../../server/voice-learning");
    const learner = new CallVoiceLearner("8", 20, vi.fn());
    for (let i = 0; i < 100; i++) learner.push(voiced, true); // 2 s
    await learner.flush();
    expect(enroll).not.toHaveBeenCalled();
  });
});
