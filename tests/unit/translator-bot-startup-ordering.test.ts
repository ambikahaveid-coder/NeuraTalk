import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Regression coverage for the P1 fix: translator bot startup used to
 * `await` a cache pre-warm step (preWarmPair x4) BEFORE calling
 * room.connect() -- meaning a slow/degraded translation provider could
 * delay call establishment by many seconds (each underlying provider call
 * is individually timeout-bounded at 3-8s, but several sequential batches
 * could still add up). The fix makes pre-warming fire-and-forget so
 * room.connect() is reached immediately regardless of how long pre-warm
 * takes.
 *
 * translator-bot.ts pulls in ~18 modules (LiveKit's native rtc-node
 * binding, Azure/Sarvam services via ultra-pipeline, transcript
 * persistence, metrics, conversation-engine, etc.) -- all mocked here as
 * inert stubs except the two things this test actually needs to control:
 * preWarmCacheForCall (deferred, to prove ordering) and Room.connect
 * (to record when it's called, relative to pre-warm settling).
 */

const events: string[] = [];
let releasePreWarm: (() => void) | null = null;
let preWarmCallCount = 0;

vi.mock("@livekit/rtc-node", () => {
  class FakeRoom {
    on = vi.fn(() => this);
    connect = vi.fn(async () => {
      events.push("room.connect() called");
    });
    disconnect = vi.fn(async () => {});
    localParticipant = { publishTrack: vi.fn(async () => {}) };
  }
  return {
    Room: FakeRoom,
    RoomEvent: new Proxy({}, { get: (_t, p) => String(p) }),
    AudioSource: vi.fn(),
    AudioStream: vi.fn(),
    LocalAudioTrack: { createAudioTrack: vi.fn() },
    RemoteAudioTrack: class {},
    TrackPublishOptions: vi.fn(),
    TrackSource: { SOURCE_MICROPHONE: 1 },
    dispose: vi.fn(async () => {}),
  };
});

vi.mock("../../server/ultra-pipeline", () => ({
  getCachedTranslation: vi.fn(() => null),
  getCachedTTS: vi.fn(() => null),
  setCachedTranslation: vi.fn(),
  setCachedTTS: vi.fn(),
  ultraTranslate: vi.fn(async (text: string) => text),
  ultraTTS: vi.fn(async () => Buffer.alloc(0)),
  preWarmCacheForCall: vi.fn(() => {
    preWarmCallCount += 1;
    events.push("preWarmCacheForCall() started");
    // Deferred: does not resolve until the test explicitly releases it,
    // simulating a slow/degraded provider -- this is what proves
    // room.connect() no longer waits on it.
    return new Promise((resolve) => {
      releasePreWarm = () => {
        events.push("preWarmCacheForCall() resolved");
        resolve({ translationsCached: 0, ttsCached: 0, totalLatencyMs: 0, errors: 0 });
      };
    });
  }),
}));

vi.mock("../../server/azure-service", () => ({ azureTranslate: vi.fn(async (t: string) => t) }));
vi.mock("../../server/modules/transcripts/service", () => ({ persistTranslationSegment: vi.fn(async () => {}) }));
vi.mock("../../server/emotion-engine", () => ({ detectEmotionFast: vi.fn(() => "neutral") }));
vi.mock("../../server/request-context", () => ({
  runWithTrace: vi.fn((_ns: string, _id: string, fn: () => unknown) => fn()),
}));
vi.mock("../../server/livekit-service", () => ({
  getClientConfig: vi.fn(() => ({ url: "wss://fake.livekit.test", apiKey: "k", apiSecret: "s" })),
}));
vi.mock("../../server/latency-audit", () => ({ createLatencyTrace: vi.fn(() => ({ mark: vi.fn(), finish: vi.fn() })) }));
vi.mock("../../server/modules/calls/metrics", () => ({
  recordStageLatency: vi.fn(),
  recordTranscriptObservation: vi.fn(),
  recordVoiceCounter: vi.fn(),
  recordVoiceLatency: vi.fn(),
}));
vi.mock("../../server/modules/calls/smart-router", () => ({ recordSmartCallMediaActivity: vi.fn() }));
vi.mock("../../server/observability", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/translation/stt-service", () => ({ buildTranscriptSignalEvent: vi.fn() }));
vi.mock("../../server/translation/translation-service", () => ({
  buildTranslationFailedEvent: vi.fn(),
  buildTranslationReadyEvent: vi.fn(),
  resolveListenerTranslationMode: vi.fn(() => "off"),
  shouldDeliverVoiceTranslation: vi.fn(() => false),
  shouldTranslateForListener: vi.fn(() => false),
}));
vi.mock("../../server/translation/tts-service", () => ({ buildTtsFailedEvent: vi.fn(), buildTtsReadyEvent: vi.fn() }));
vi.mock("../../server/universal-language-runtime", () => ({
  registerParticipantTranscript: vi.fn(),
  resolveDirectionalLanguages: vi.fn(() => ({ from: "en", to: "en" })),
  setParticipantLanguagePreference: vi.fn(),
}));
vi.mock("../../server/realtime-translation-core", () => ({
  PCM_CHANNELS: 1,
  PCM_SAMPLE_RATE: 16000,
  FRAME_DURATION_MS: 20,
  applySpokenCorrections: vi.fn((t: string) => t),
  computeRms: vi.fn(() => 0),
  normalizeLanguage: vi.fn((l: string) => l),
  normalizePcmFrame: vi.fn((f: unknown) => f),
  normalizeSpaces: vi.fn((t: string) => t),
  normalizeTranscript: vi.fn((t: string) => t),
  streamAzureTtsFrames: vi.fn(),
  wordCount: vi.fn(() => 0),
}));
vi.mock("../../server/conversation-engine", () => ({
  appendFinalTranscriptSegment: vi.fn(),
  clearFinalizedTranscriptSegments: vi.fn(),
  isDuplicateFinalTranslation: vi.fn(() => false),
  isStaleFinalTranscript: vi.fn(() => false),
  isTranscriptRegression: vi.fn(() => false),
  isTurnOrderMismatch: vi.fn(() => false),
  markStartedTranslation: vi.fn(),
  recordDeliveredFinalTranslation: vi.fn(),
  recordRenderedTranslation: vi.fn(),
  resetTranscriptMemory: vi.fn(),
  shouldStartTranslationFromTranscript: vi.fn(() => false),
}));
vi.mock("../../server/providers/stt-provider-registry", () => ({
  createManagedStreamingSttSession: vi.fn(),
  getDefaultSttProviderName: vi.fn(() => "azure"),
}));
vi.mock("../../server/token-streaming-translation", () => ({
  shouldEmitStreamingPartial: vi.fn(() => false),
  streamTranslationTokens: vi.fn(),
}));

describe("translator-bot startup: pre-warm no longer blocks room.connect()", () => {
  beforeEach(() => {
    events.length = 0;
    preWarmCallCount = 0;
    releasePreWarm = null;
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls room.connect() before the pre-warm promise resolves (proves ordering, not just that both ran)", async () => {
    const { startBotWorker, stopBotWorker } = await import("../../server/translator-bot");

    const callId = `test-call-${Date.now()}`;
    // A fake JWT-shaped token so decodeIdentityFromToken doesn't throw --
    // header.payload.signature, payload = base64url({"identity":"bot"}).
    const payload = Buffer.from(JSON.stringify({ identity: "neuratalk-translator" })).toString("base64url");
    const fakeToken = `header.${payload}.sig`;

    const startPromise = startBotWorker(callId, fakeToken);

    // Give the microtask queue a chance to run everything that does NOT
    // depend on the still-pending pre-warm promise -- if the bug were
    // present (awaited pre-warm), room.connect() would NOT have been
    // called yet at this point.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(preWarmCallCount).toBeGreaterThan(0);
    expect(events).toContain("room.connect() called");
    // The critical ordering assertion: connect happened while pre-warm was
    // still pending, not after it resolved.
    expect(events.indexOf("room.connect() called")).toBeLessThan(
      events.indexOf("preWarmCacheForCall() resolved") === -1 ? Infinity : events.indexOf("preWarmCacheForCall() resolved"),
    );
    expect(events).not.toContain("preWarmCacheForCall() resolved");

    // Now let pre-warm finish and let startup settle, then clean up.
    releasePreWarm?.();
    await startPromise;
    await stopBotWorker(callId);
  });

  it("a rejected background pre-warm does not fail bot startup (no unhandled rejection, no thrown error)", async () => {
    vi.doMock("../../server/ultra-pipeline", () => ({
      getCachedTranslation: vi.fn(() => null),
      getCachedTTS: vi.fn(() => null),
      setCachedTranslation: vi.fn(),
      setCachedTTS: vi.fn(),
      ultraTranslate: vi.fn(async (text: string) => text),
      ultraTTS: vi.fn(async () => Buffer.alloc(0)),
      preWarmCacheForCall: vi.fn(async () => {
        throw new Error("simulated provider outage during pre-warm");
      }),
    }));

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);

    try {
      const { startBotWorker, stopBotWorker } = await import("../../server/translator-bot");
      const callId = `test-call-reject-${Date.now()}`;
      const payload = Buffer.from(JSON.stringify({ identity: "neuratalk-translator" })).toString("base64url");
      const fakeToken = `header.${payload}.sig`;

      await expect(startBotWorker(callId, fakeToken)).resolves.toBeUndefined();

      // Let the rejected background pre-warm's microtask (and its .catch)
      // actually run before asserting nothing leaked as unhandled.
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(unhandled).toHaveLength(0);

      await stopBotWorker(callId);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("room.connect() failure still propagates and fails bot startup (existing failure behavior intact)", async () => {
    vi.doMock("@livekit/rtc-node", () => {
      class FailingRoom {
        on = vi.fn(() => this);
        connect = vi.fn(async () => {
          throw new Error("simulated LiveKit connect failure");
        });
        disconnect = vi.fn(async () => {});
      }
      return {
        Room: FailingRoom,
        RoomEvent: new Proxy({}, { get: (_t, p) => String(p) }),
        AudioSource: vi.fn(),
        AudioStream: vi.fn(),
        LocalAudioTrack: { createAudioTrack: vi.fn() },
        RemoteAudioTrack: class {},
        TrackPublishOptions: vi.fn(),
        TrackSource: { SOURCE_MICROPHONE: 1 },
        dispose: vi.fn(async () => {}),
      };
    });

    const { startBotWorker } = await import("../../server/translator-bot");
    const callId = `test-call-fail-${Date.now()}`;
    const payload = Buffer.from(JSON.stringify({ identity: "neuratalk-translator" })).toString("base64url");
    const fakeToken = `header.${payload}.sig`;

    await expect(startBotWorker(callId, fakeToken)).rejects.toThrow("simulated LiveKit connect failure");
  });
});
