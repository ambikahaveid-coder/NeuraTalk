import { describe, it, expect, vi } from "vitest";

vi.mock("livekit-server-sdk", () => ({ SipClient: class {}, RoomServiceClient: class {} }));
vi.mock("../../server/observability", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

/** LiveKit room webhooks → phone call states (Exotel calls through LiveKit SIP). */
function deps(inboundAction: "bridge" | "reject" = "bridge") {
  return {
    handleInboundCall: vi.fn(async () => ({ status: 200, body: { action: inboundAction } })),
    processStatusEvent: vi.fn(async () => {}),
    removeParticipant: vi.fn(async () => {}),
  };
}
const phone = { identity: "sip_+919876543210", kind: 3, attributes: { "sip.phoneNumber": "+919876543210", "sip.trunkPhoneNumber": "+918040001234" } };

describe("phone line events", () => {
  it("a call to a business number rings the business through the normal inbound flow", async () => {
    const { handleLiveKitSipEvent } = await import("../../server/pstn/livekit-sip");
    const d = deps();
    const r = await handleLiveKitSipEvent({ event: "participant_joined", room: { name: "call_pstnin_ab12" }, participant: phone }, d);
    expect(r).toBe("inbound_ringing");
    expect(d.handleInboundCall).toHaveBeenCalledWith(null, {}, expect.objectContaining({
      callId: "call_pstnin_ab12",
      event: expect.objectContaining({ callerNumber: "+919876543210", calledNumber: "+918040001234", provider: "livekit_sip" }),
    }));
    expect(d.removeParticipant).not.toHaveBeenCalled();
  });

  it("hangs up when no business/agent can take the call", async () => {
    const { handleLiveKitSipEvent } = await import("../../server/pstn/livekit-sip");
    const d = deps("reject");
    expect(await handleLiveKitSipEvent({ event: "participant_joined", room: { name: "call_pstnin_x" }, participant: phone }, d)).toBe("inbound_rejected");
    expect(d.removeParticipant).toHaveBeenCalledWith("call_pstnin_x", phone.identity);
  });

  it("an outgoing call is answered when the phone joins its room", async () => {
    const { handleLiveKitSipEvent } = await import("../../server/pstn/livekit-sip");
    const d = deps();
    expect(await handleLiveKitSipEvent({ event: "participant_joined", room: { name: "call_123" }, participant: phone }, d)).toBe("outbound_answered");
    expect(d.processStatusEvent).toHaveBeenCalledWith(expect.objectContaining({ internalCallId: "call_123", status: "answered", direction: "outbound" }));
    expect(d.handleInboundCall).not.toHaveBeenCalled();
  });

  it("an incoming call is answered when the agent's app joins; the translator does not count", async () => {
    const { handleLiveKitSipEvent } = await import("../../server/pstn/livekit-sip");
    const d = deps();
    expect(await handleLiveKitSipEvent({ event: "participant_joined", room: { name: "call_pstnin_y" }, participant: { identity: "neuratalk-translator" } }, d)).toBe("ignored");
    expect(await handleLiveKitSipEvent({ event: "participant_joined", room: { name: "call_pstnin_y" }, participant: { identity: "42" } }, d)).toBe("inbound_answered");
    expect(d.processStatusEvent).toHaveBeenCalledTimes(1);
  });

  it("the call ends when the phone hangs up", async () => {
    const { handleLiveKitSipEvent } = await import("../../server/pstn/livekit-sip");
    const d = deps();
    expect(await handleLiveKitSipEvent({ event: "participant_left", room: { name: "call_9" }, participant: phone }, d)).toBe("ended");
    expect(d.processStatusEvent).toHaveBeenCalledWith(expect.objectContaining({ internalCallId: "call_9", status: "ended", disconnectReason: "phone_hung_up" }));
  });

  it("ordinary app-to-app participants are ignored", async () => {
    const { handleLiveKitSipEvent } = await import("../../server/pstn/livekit-sip");
    const d = deps();
    expect(await handleLiveKitSipEvent({ event: "participant_left", room: { name: "call_7" }, participant: { identity: "5" } }, d)).toBe("ignored");
    expect(d.processStatusEvent).not.toHaveBeenCalled();
  });
});

describe("phone line number sync", () => {
  it("never removes a number someone put on the line by hand", async () => {
    vi.doMock("../../server/db", () => ({ db: {} }));
    const { mergeInboundNumbers } = await import("../../server/telephony-admin");
    // +91…7378 was set up by hand; we add a business number.
    expect(mergeInboundNumbers(["+910000007378"], [], ["+918040001234"])).toEqual(["+910000007378", "+918040001234"]);
    // A business number we added is taken away again; the hand-made one stays.
    expect(mergeInboundNumbers(["+910000007378", "+918040001234"], ["+918040001234"], [])).toEqual(["+910000007378"]);
  });
});
