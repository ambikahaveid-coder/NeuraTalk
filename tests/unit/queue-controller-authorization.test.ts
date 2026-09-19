import { beforeEach, describe, expect, it, vi } from "vitest";

const selectMock = vi.fn();
const initiateConferenceMock = vi.fn();
const enqueueCallMock = vi.fn();

vi.mock("../../server/db", () => ({
  db: {
    select: selectMock,
  },
}));
vi.mock("../../server/modules/calls/service", () => ({
  initiateConference: initiateConferenceMock,
  endCallById: vi.fn(),
}));
vi.mock("../../server/modules/calls/queue-service", () => ({
  enqueueCall: enqueueCallMock,
  getQueueStatus: vi.fn(),
  abandonQueuedCall: vi.fn(),
}));
vi.mock("../../server/modules/calls/smart-router", () => ({
  getSmartCall: vi.fn(),
}));
vi.mock("../../server/observability", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const { joinQueue } = await import("../../server/modules/calls/queue-controller");

function responseDouble() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

describe("queue join organization authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectMock.mockReturnValue({
      from: () => ({
        where: async () => [{ id: 11, organizationId: 7, isActive: true, name: "Support" }],
      }),
    });
  });

  it("rejects an authenticated user from another organization before creating a conference", async () => {
    const res = responseDouble();

    await joinQueue(
      {
        params: { queueId: "11" },
        body: {},
        user: { id: 42, role: "agent", organizationId: 8 },
      } as any,
      res as any,
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: "Queue does not belong to your organization",
    });
    expect(initiateConferenceMock).not.toHaveBeenCalled();
    expect(enqueueCallMock).not.toHaveBeenCalled();
  });

  it("allows a user from the queue organization to join", async () => {
    initiateConferenceMock.mockResolvedValue({
      callId: "call-org-a",
      livekitUrl: "wss://example.livekit.cloud",
      livekitToken: "token",
    });
    enqueueCallMock.mockResolvedValue({
      queued: true,
      position: 1,
      estimatedWaitSeconds: 180,
    });
    const res = responseDouble();

    await joinQueue(
      {
        params: { queueId: "11" },
        body: {},
        user: { id: 42, role: "agent", organizationId: 7 },
      } as any,
      res as any,
    );

    expect(res.status).toHaveBeenCalledWith(201);
    expect(enqueueCallMock).toHaveBeenCalledWith({
      queueId: 11,
      callId: "call-org-a",
      organizationId: 7,
      requiredSkills: [],
    });
  });
});
