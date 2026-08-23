import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { elapsedMs, logSetupLatency } from "../../server/modules/calls/smart-router";

/**
 * Covers the new stage-level timing instrumentation added for the P1 call
 * performance audit (T0-T9 breakdown of /api/calls/create, plus /connect).
 *
 * A full integration test of initiateCall() itself -- verifying FCM failure
 * doesn't block the caller's response, billing still gates call creation,
 * the removed Redis read-back doesn't change the emitted event payload, and
 * rapid-tap doesn't create duplicate calls -- would require mocking roughly
 * eight modules (db, redis, livekit-service, billing-engine, firebase-admin,
 * translator-bot, resolveCallee, storage) to exercise a single call to
 * initiateCallLocked(). That's a real integration-test investment beyond a
 * "focused" unit test and hasn't been done here -- flagging honestly rather
 * than writing a shallow test that mocks away everything and proves
 * nothing. What IS directly, cheaply testable is the instrumentation
 * mechanism itself, which every one of those stages depends on: does it
 * measure real elapsed time, and does it log the correct, complete shape.
 */
describe("call-setup latency instrumentation", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("elapsedMs measures real time, not a stub value", async () => {
    const start = process.hrtime.bigint();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const elapsed = elapsedMs(start);

    // Real wall-clock measurement, not hardcoded -- must reflect the ~20ms
    // delay above (loose bounds to tolerate CI/scheduler jitter, not to
    // launder a fake value through).
    expect(elapsed).toBeGreaterThanOrEqual(15);
    expect(elapsed).toBeLessThan(500);
  });

  it("logs the complete required shape: callId, stage, durationMs, provider, success, timestamp", () => {
    logSetupLatency("call_test123", "app_to_app", "test_stage", 42.5, { success: true, provider: "fcm" });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);

    expect(logged).toMatchObject({
      type: "call_setup_latency",
      callId: "call_test123",
      joinMethod: "app_to_app",
      stage: "test_stage",
      latencyMs: 42.5,
      success: true,
      provider: "fcm",
    });
    expect(typeof logged.ts).toBe("number");
  });

  it("defaults success=true and provider=null when not specified (existing call sites unaffected)", () => {
    logSetupLatency("call_test456", "app_to_app", "create_room", 1600);

    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(logged.success).toBe(true);
    expect(logged.provider).toBeNull();
  });

  it("never throws even if console.log fails, so a logging problem can never break call setup", () => {
    logSpy.mockImplementation(() => {
      throw new Error("stdout broken");
    });

    expect(() => logSetupLatency("call_test789", "app_to_app", "any_stage", 1)).not.toThrow();
  });
});
