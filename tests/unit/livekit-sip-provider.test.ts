import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * PSTN through LiveKit SIP: dials the phone number straight into the call's room
 * through the connected outbound trunk; refuses to dial with no trunk.
 */
const createSipParticipant = vi.fn();
const listSipOutboundTrunk = vi.fn();
const removeParticipant = vi.fn();
const transferSipParticipant = vi.fn();

vi.mock("livekit-server-sdk", () => ({
  SipClient: class { createSipParticipant = createSipParticipant; listSipOutboundTrunk = listSipOutboundTrunk; transferSipParticipant = transferSipParticipant; },
  RoomServiceClient: class { removeParticipant = removeParticipant; },
}));
vi.mock("../../server/observability", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

describe("LiveKit SIP provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LIVEKIT_URL = "wss://example.livekit.cloud";
    process.env.LIVEKIT_API_KEY = "k";
    process.env.LIVEKIT_API_SECRET = "s";
  });

  it("refuses to dial when no outbound trunk is connected", async () => {
    const mod = await import("../../server/pstn/livekit-sip");
    mod.setLiveKitOutboundTrunkId(null);
    const p = new mod.LiveKitSipProvider();
    await expect(p.initiateCall({ to: "+919876543210", from: "", callbackUrl: "", internalCallId: "call-1" })).rejects.toThrow("PSTN_NOT_CONFIGURED");
    expect(createSipParticipant).not.toHaveBeenCalled();
  });

  it("dials the number into the call's own room through the trunk", async () => {
    const mod = await import("../../server/pstn/livekit-sip");
    mod.setLiveKitOutboundTrunkId("ST_out");
    createSipParticipant.mockResolvedValue({ sipCallId: "SCL_1" });
    const r = await new mod.LiveKitSipProvider().initiateCall({ to: "+919876543210", from: "+918000000001", callbackUrl: "", internalCallId: "call-2" });
    expect(createSipParticipant).toHaveBeenCalledWith("ST_out", "+919876543210", "call-2", expect.objectContaining({
      participantIdentity: "pstn:+919876543210", fromNumber: "+918000000001",
    }));
    expect(r).toMatchObject({ providerCallId: "call-2|pstn:+919876543210", status: "initiated", provider: "livekit_sip" });
  });

  it("hangs up by removing the phone participant from its room", async () => {
    const mod = await import("../../server/pstn/livekit-sip");
    await new mod.LiveKitSipProvider().hangup("call-3|pstn:+919876543210");
    expect(removeParticipant).toHaveBeenCalledWith("call-3", "pstn:+919876543210");
  });

  it("is healthy only when the connected trunk exists in LiveKit", async () => {
    const mod = await import("../../server/pstn/livekit-sip");
    mod.setLiveKitOutboundTrunkId("ST_out");
    listSipOutboundTrunk.mockResolvedValue([{ sipTrunkId: "ST_other" }]);
    expect((await new mod.LiveKitSipProvider().healthCheck()).healthy).toBe(false);
    listSipOutboundTrunk.mockResolvedValue([{ sipTrunkId: "ST_out" }]);
    expect((await new mod.LiveKitSipProvider().healthCheck()).healthy).toBe(true);
  });

  it("the registry treats livekit_sip as available only with a trunk", async () => {
    process.env.PSTN_PROVIDER = "livekit_sip";
    const reg = await import("../../server/pstn/registry");
    const mod = await import("../../server/pstn/livekit-sip");
    mod.setLiveKitOutboundTrunkId(null);
    expect(reg.isPSTNAvailable()).toBe(false);
    mod.setLiveKitOutboundTrunkId("ST_out");
    expect(reg.isPSTNAvailable()).toBe(true);
    delete process.env.PSTN_PROVIDER;
  });
});
