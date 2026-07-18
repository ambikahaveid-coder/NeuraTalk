import { describe, it, expect, beforeEach, afterEach } from "vitest";

const ORIGINAL_ENV = { ...process.env };

describe("PSTN SIP bridge status", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("reports not configured when LIVEKIT_SIP_DOMAIN is unset", async () => {
    delete process.env.LIVEKIT_SIP_DOMAIN;
    const { getSIPBridgeStatus } = await import("../../server/pstn/registry");
    const status = getSIPBridgeStatus();
    expect(status.configured).toBe(false);
    expect(status.domain).toBeNull();
    expect(status.warning).toMatch(/not set/i);
  }, 20_000); // first import in this file pays a one-time cold-transform cost

  it("reports not configured when LIVEKIT_SIP_DOMAIN is still the placeholder", async () => {
    process.env.LIVEKIT_SIP_DOMAIN = "sip.livekit.local";
    const { getSIPBridgeStatus } = await import("../../server/pstn/registry");
    const status = getSIPBridgeStatus();
    expect(status.configured).toBe(false);
    expect(status.warning).toMatch(/placeholder/i);
  });

  it("reports configured for a real-looking domain", async () => {
    process.env.LIVEKIT_SIP_DOMAIN = "sip.livekit.neuratalk.in";
    const { getSIPBridgeStatus } = await import("../../server/pstn/registry");
    const status = getSIPBridgeStatus();
    expect(status.configured).toBe(true);
    expect(status.domain).toBe("sip.livekit.neuratalk.in");
    // Even "configured" must still carry a caveat — env var presence isn't
    // proof a real SIP trunk/dispatch rule exists in LiveKit Cloud.
    expect(status.warning).toMatch(/does not confirm/i);
  });

  it("getPSTNStatus.callsWillActuallyWork requires BOTH provider config and SIP bridge", async () => {
    process.env.MSG91_AUTH_KEY = "test-key";
    process.env.PSTN_PROVIDER = "msg91";

    delete process.env.LIVEKIT_SIP_DOMAIN;
    let { getPSTNStatus } = await import("../../server/pstn/registry");
    expect(getPSTNStatus().callsWillActuallyWork).toBe(false);

    process.env.LIVEKIT_SIP_DOMAIN = "sip.livekit.neuratalk.in";
    ({ getPSTNStatus } = await import("../../server/pstn/registry"));
    expect(getPSTNStatus().callsWillActuallyWork).toBe(true);
  });
});
