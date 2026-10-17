import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ChatPage from "./ChatPage";

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: 1, preferredLanguage: "en" } }),
  getAuthToken: () => "test-token",
}));

vi.mock("@/hooks/use-contacts", () => ({
  useContacts: () => ({ contacts: [], isLoading: false }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/hooks/use-upload", () => ({
  useUpload: () => ({ uploadFile: vi.fn(), isUploading: false, progress: 0 }),
}));

vi.mock("@/ai_integrations/audio/useVoiceRecorder", () => ({
  useVoiceRecorder: () => ({
    state: "idle",
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
  }),
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: mocks.apiRequest,
  queryClient: new QueryClient(),
}));

vi.mock("@/components/AppNavigation", () => ({ default: () => null }));
vi.mock("@/components/ChatMessage", () => ({ ChatMessage: () => null }));
vi.mock("@/components/TypingIndicator", () => ({
  TypingIndicator: () => null,
}));

const thread = {
  id: 7,
  viewerLanguage: "en",
  peerLanguage: "te",
  unreadCount: 0,
  peer: { id: 2, displayName: "Asha", identifier: "asha@example.com" },
};

beforeEach(() => {
  mocks.apiRequest.mockReset();
  mocks.apiRequest.mockResolvedValue({ json: async () => ({}) });
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  if (!Element.prototype.scrollIntoView)
    Element.prototype.scrollIntoView = vi.fn();
});

describe("ChatPage mobile navigation", () => {
  it("shows one mobile pane at a time and returns to the chat list", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Infinity,
          queryFn: ({ queryKey }) =>
            queryKey[0] === "/api/personal-chats" && queryKey.length === 1
              ? { threads: [thread] }
              : { thread, messages: [] },
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ChatPage />
      </QueryClientProvider>,
    );

    const sidebar = screen.getByTestId("personal-chat-sidebar");
    const main = screen.getByTestId("personal-chat-main");
    expect(sidebar.classList.contains("hidden")).toBe(false);
    expect(main.classList.contains("hidden")).toBe(true);

    fireEvent.click(await screen.findByTestId("thread-7"));
    expect(sidebar.classList.contains("hidden")).toBe(true);
    expect(main.classList.contains("hidden")).toBe(false);
    expect(
      screen.getByRole("button", { name: "Attach file" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Record voice note" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Send message" }),
    ).toBeInTheDocument();

    fireEvent.click(await screen.findByTestId("button-mobile-back-to-chats"));
    expect(sidebar.classList.contains("hidden")).toBe(false);
    expect(main.classList.contains("hidden")).toBe(true);
  });

  it("shows a loading state while the chat list is loading", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          queryFn: () => new Promise(() => {}),
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ChatPage />
      </QueryClientProvider>,
    );

    expect(
      screen.getByRole("status", { name: "Loading chats" }),
    ).toBeInTheDocument();
  });

  it("shows an empty state when there are no chats", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          queryFn: () => ({ threads: [] }),
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ChatPage />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByText(
        "No personal chats yet. Start with a contact below.",
      ),
    ).toBeInTheDocument();
  });

  it("offers retry after the chat list request fails", async () => {
    let attempts = 0;
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          queryFn: () => {
            attempts += 1;
            if (attempts === 1) throw new Error("offline");
            return { threads: [] };
          },
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ChatPage />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(
      await screen.findByText(
        "No personal chats yet. Start with a contact below.",
      ),
    ).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it("reports offline and restored connectivity", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          queryFn: () => ({ threads: [] }),
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ChatPage />
      </QueryClientProvider>,
    );

    fireEvent(window, new Event("offline"));
    expect(
      screen.getByText(
        /You.re offline\. Reconnect to send messages and load updates\./,
      ),
    ).toBeInTheDocument();
    fireEvent(window, new Event("online"));
    expect(screen.queryByText(/You.re offline/)).not.toBeInTheDocument();
  });
});
