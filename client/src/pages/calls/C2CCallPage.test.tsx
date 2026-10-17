import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import C2CCallPage from "./C2CCallPage";

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  call: {
    status: "idle",
    callId: null,
    participants: [],
    isMuted: false,
    isOnHold: false,
    isVideoOn: true,
    connectionQuality: "good",
    hasRemoteVideoTrack: false,
    hasRemoteAudioTrack: false,
    incomingCall: null,
    pricingPreview: null,
    session: null,
    error: null,
    localVideoRef: { current: null },
    remoteVideoRef: { current: null },
    remoteAudioRef: { current: null },
    startCall: vi.fn(),
    acceptIncomingCall: vi.fn(),
    rejectIncomingCall: vi.fn(),
    endCall: vi.fn(),
    toggleMute: vi.fn(),
    toggleHold: vi.fn(),
    toggleVideo: vi.fn(),
    sendDataMessage: vi.fn(),
    updateLanguage: vi.fn(),
    updateTranslationMode: vi.fn(),
  },
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: 1 } }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/hooks/use-contacts", () => ({
  useContacts: () => ({
    contacts: [],
    isLoading: false,
    toggleFavorite: vi.fn(),
    recordCall: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-livekit-call", () => ({
  useLiveKitCall: () => mocks.call,
}));

vi.mock("@/components/AppNavigation", () => ({ default: () => null }));
vi.mock("@/components/IncomingCallRing", () => ({ default: () => null }));

function renderCallPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <C2CCallPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.toast.mockReset();
  Object.assign(mocks.call, {
    status: "idle",
    isMuted: false,
    isOnHold: false,
    isVideoOn: true,
    error: null,
    updateLanguage: vi.fn().mockResolvedValue(undefined),
    updateTranslationMode: vi.fn().mockResolvedValue(undefined),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ pstnAvailable: true, simAvailable: false }),
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("C2CCallPage call states", () => {
  it("reports a failed mid-call language update", async () => {
    Object.assign(mocks.call, {
      status: "active",
      updateLanguage: vi.fn().mockRejectedValue(new Error("send failed")),
    });

    renderCallPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not update your language for the other participant.",
    );
  });

  it("reports a failed mid-call translation-mode update", async () => {
    Object.assign(mocks.call, {
      status: "active",
      updateTranslationMode: vi
        .fn()
        .mockRejectedValue(new Error("send failed")),
    });

    renderCallPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not update translation mode for this call.",
    );
  });

  it("keeps both setting errors visible when language and translation updates fail together", async () => {
    Object.assign(mocks.call, {
      status: "active",
      updateLanguage: vi
        .fn()
        .mockRejectedValue(new Error("language send failed")),
      updateTranslationMode: vi
        .fn()
        .mockRejectedValue(new Error("translation send failed")),
    });

    renderCallPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Could not update your language for the other participant.",
    );
    expect(alert).toHaveTextContent(
      "Could not update translation mode for this call.",
    );
  });

  it("shows microphone and camera permission guidance after call setup fails", () => {
    Object.assign(mocks.call, {
      status: "error",
      error: "Camera/microphone permission denied",
    });

    renderCallPage();

    expect(
      screen.getByText("Camera or microphone permission is blocked"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Allow camera and microphone access in browser settings/,
      ),
    ).toBeInTheDocument();
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Call failed",
        description: "Camera/microphone permission denied",
        variant: "destructive",
      }),
    );
  });

  it("exposes accessible toggle states and prevents controls changing before a call is active", () => {
    renderCallPage();

    expect(
      screen.getByRole("button", { name: "Mute microphone" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Turn camera off" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Hold call" })).toBeDisabled();
  });

  it("disables the other participant language selector during an active call", () => {
    Object.assign(mocks.call, { status: "active" });

    renderCallPage();

    expect(screen.getByTestId("select-their-language")).toHaveAttribute(
      "data-disabled",
    );
  });
});
