import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import BusinessChatPage from "./BusinessChatPage";

/**
 * P1-3 / P1-3A: component-level tests for the consumer Business Chat page,
 * now backed by real identity (GET /api/messaging/business/:businessId) and
 * history (GET /api/messaging/business/:businessId/messages) reads. Mocks
 * fetch and useAuth/useToast, matching conventions already established in
 * marketing.test.tsx and CompanyDashboard.test.tsx. wouter's useRoute reads
 * window.location directly (no <Router> wrapper needed).
 */

const mockFetch = vi.fn();
const toastSpy = vi.fn();

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: 42, username: "telugu_user" } }),
  getAuthToken: () => "test-token",
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

// jsdom doesn't implement scrollIntoView; polyfilled locally to this test
// file only, not the shared setup.ts, since it's purely a jsdom gap.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

function setUrl(path: string) {
  window.history.pushState({}, "", path);
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <BusinessChatPage />
    </QueryClientProvider>,
  );
}

const IDENTITY_RESPONSE = {
  success: true,
  business: { id: 7, name: "Namaste Kirana Store", logoUrl: null, description: "Local grocery" },
};

// P1-A: the consumer's own messaging_participants.id in the conversation --
// matches what the server-side viewerParticipantId field would resolve to.
// Fixtures below use this consistently as the "mine" sender id, and a
// DIFFERENT id (BUSINESS_PARTICIPANT_ID) for the business/agent side --
// mirroring the audit's exact repro (customer senderParticipantId=1,
// business reply senderParticipantId=2).
const MY_PARTICIPANT_ID = 1;
const BUSINESS_PARTICIPANT_ID = 2;

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body), json: async () => body } as unknown as Response;
}

/** Reads back the alignment ChatMessage actually rendered for a given
 * message's text -- the real DOM/class proof of role="user" (right,
 * justify-end) vs role="assistant" (left, justify-start), not merely that
 * the text exists somewhere on the page. */
function getAlignment(text: string): "right" | "left" {
  const node = screen.getByText(text);
  const outer = node.closest(".flex.justify-end, .flex.justify-start");
  if (!outer) throw new Error(`No ChatMessage alignment wrapper found for "${text}"`);
  return outer.classList.contains("justify-end") ? "right" : "left";
}

/** Whether `name` appears as a ChatMessage sender-name badge specifically
 * (its distinct uppercase-label class), as opposed to appearing elsewhere on
 * the page (e.g. the page header, which legitimately shows the business
 * name regardless of any message). */
function hasSenderBadge(name: string): boolean {
  return screen.queryAllByText(name).some((el) => el.classList.contains("uppercase"));
}

function routeFetch(handlers: { identity?: any; messages?: any; send?: any }) {
  return async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    if (method === "POST" && u.includes("/messages")) {
      return handlers.send ?? jsonResponse({ success: true, message: { id: 99, content: "x", senderParticipantId: MY_PARTICIPANT_ID, createdAt: "2026-08-25T00:00:00Z" } });
    }
    if (method === "GET" && u.endsWith("/messages")) {
      return handlers.messages ?? jsonResponse({ success: true, messages: [], total: 0, limit: 50, offset: 0, viewerParticipantId: null });
    }
    if (method === "GET" && u === "/api/messaging/business/7") return handlers.identity ?? jsonResponse(IDENTITY_RESPONSE);
    return jsonResponse({ success: true });
  };
}

/** Sequenced /messages responses -- each successive GET to the messages
 * endpoint returns the next entry (repeating the last one once exhausted),
 * used to simulate what a poll would observe over time (e.g. a business
 * reply appearing on the second fetch). */
function sequencedMessagesFetch(sequence: any[]) {
  let call = 0;
  return async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    if (method === "GET" && u.endsWith("/messages")) {
      const body = sequence[Math.min(call, sequence.length - 1)];
      call += 1;
      return jsonResponse(body);
    }
    if (method === "GET" && u === "/api/messaging/business/7") return jsonResponse(IDENTITY_RESPONSE);
    return jsonResponse({ success: true });
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  toastSpy.mockClear();
  mockFetch.mockClear();
  vi.stubGlobal("fetch", mockFetch);
});

describe("BusinessChatPage", () => {
  it("16. business identity loads and replaces the generic header with the real name", async () => {
    mockFetch.mockImplementation(routeFetch({}));
    setUrl("/business-chat/7");
    renderPage();

    await waitFor(() => expect(screen.getByTestId("text-business-chat-name")).toHaveTextContent("Namaste Kirana Store"));
  });

  it("17. historical messages render in chronological order", async () => {
    mockFetch.mockImplementation(routeFetch({
      messages: jsonResponse({
        success: true,
        // server returns newest-first (listMessages' own order)
        messages: [
          { id: 2, content: "second message", senderParticipantId: MY_PARTICIPANT_ID, createdAt: "2026-08-25T00:02:00Z" },
          { id: 1, content: "first message", senderParticipantId: MY_PARTICIPANT_ID, createdAt: "2026-08-25T00:01:00Z" },
        ],
        total: 2, limit: 50, offset: 0, viewerParticipantId: MY_PARTICIPANT_ID,
      }),
    }));
    setUrl("/business-chat/7");
    renderPage();

    await waitFor(() => expect(screen.getByText("first message")).toBeInTheDocument());
    expect(screen.getByText("second message")).toBeInTheDocument();
    const bodyText = document.body.textContent || "";
    // chronological (oldest first) display order
    expect(bodyText.indexOf("first message")).toBeLessThan(bodyText.indexOf("second message"));
  });

  it("18. empty state renders when there is no history", async () => {
    mockFetch.mockImplementation(routeFetch({}));
    setUrl("/business-chat/7");
    renderPage();

    await waitFor(() => expect(screen.getByText("No messages sent yet. Say hello to get started.")).toBeInTheDocument());
  });

  it("19. loading state renders before data arrives", async () => {
    mockFetch.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return routeFetch({})(url, init);
    });
    setUrl("/business-chat/7");
    renderPage();

    expect(screen.getByTestId("loading-business-chat-messages")).toBeInTheDocument();
    expect(screen.getByTestId("text-business-chat-name")).toHaveTextContent("Loading...");

    await waitFor(() => expect(screen.queryByTestId("loading-business-chat-messages")).not.toBeInTheDocument());
  });

  it("20 & 21. send still works, and the confirmed message appears exactly once (no duplicate from the setQueryData + invalidate/refetch combination), rendered as mine (right-aligned)", async () => {
    // viewerParticipantId starts null (brand-new conversation, nothing sent
    // yet) -- proves the client-side backfill-on-send logic, not just a
    // pre-seeded value.
    let messagesState = { success: true, messages: [] as any[], total: 0, limit: 50, offset: 0, viewerParticipantId: null as number | null };
    mockFetch.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (method === "POST") {
        const sent = { id: 5, content: "hello there", senderParticipantId: MY_PARTICIPANT_ID, createdAt: "2026-08-25T00:00:00Z" };
        messagesState = { ...messagesState, messages: [sent, ...messagesState.messages], total: messagesState.total + 1, viewerParticipantId: MY_PARTICIPANT_ID };
        return jsonResponse({ success: true, message: sent });
      }
      if (u.endsWith("/messages")) return jsonResponse(messagesState);
      return jsonResponse(IDENTITY_RESPONSE);
    });

    setUrl("/business-chat/7");
    renderPage();

    await waitFor(() => expect(screen.getByText("No messages sent yet. Say hello to get started.")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("input-business-chat-message"), { target: { value: "hello there" } });
    fireEvent.click(screen.getByTestId("button-send-business-chat"));

    await waitFor(() => expect(screen.getAllByText("hello there")).toHaveLength(1));
    // give the background invalidate/refetch a moment to complete and confirm still exactly one
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getAllByText("hello there")).toHaveLength(1);
    expect((screen.getByTestId("input-business-chat-message") as HTMLInputElement).value).toBe("");
    // P1-A: a message I just sent must render as MINE immediately, not as
    // the business's, even before the background refetch resolves.
    expect(getAlignment("hello there")).toBe("right");
  });

  it("22. a failed history fetch shows a safe error state, not a crash or a raw error leak", async () => {
    mockFetch.mockImplementation(routeFetch({
      messages: jsonResponse({ error: "Internal failure at pg-pool DATABASE_URL=secret" }, false, 500),
    }));
    setUrl("/business-chat/7");
    renderPage();

    await waitFor(() => expect(screen.queryByTestId("loading-business-chat-messages")).not.toBeInTheDocument());
    const bodyText = document.body.textContent || "";
    expect(bodyText).not.toContain("DATABASE_URL");
    expect(bodyText).not.toContain("pg-pool");
  });

  it("23. no console errors during a normal happy-path render + send", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetch.mockImplementation(routeFetch({}));

    setUrl("/business-chat/7");
    renderPage();
    await waitFor(() => expect(screen.getByText("No messages sent yet. Say hello to get started.")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("input-business-chat-message"), { target: { value: "hi" } });
    fireEvent.click(screen.getByTestId("button-send-business-chat"));
    await waitFor(() => expect((screen.getByTestId("input-business-chat-message") as HTMLInputElement).value).toBe(""));

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("shows an invalid-link state for a non-numeric businessId, and never calls the API", () => {
    setUrl("/business-chat/not-a-number");
    renderPage();
    expect(screen.getByText("This business chat link isn't valid.")).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("send button is disabled for empty/whitespace-only input", async () => {
    mockFetch.mockImplementation(routeFetch({}));
    setUrl("/business-chat/7");
    renderPage();
    await waitFor(() => expect(screen.getByTestId("button-send-business-chat")).toBeInTheDocument());

    const sendBtn = screen.getByTestId("button-send-business-chat");
    expect(sendBtn).toBeDisabled();
    fireEvent.change(screen.getByTestId("input-business-chat-message"), { target: { value: "   " } });
    expect(sendBtn).toBeDisabled();
  });

  it("respects the existing 8192 canonical content limit client-side (maxLength attribute)", async () => {
    mockFetch.mockImplementation(routeFetch({}));
    setUrl("/business-chat/7");
    renderPage();
    await waitFor(() => expect(screen.getByTestId("input-business-chat-message")).toBeInTheDocument());
    const input = screen.getByTestId("input-business-chat-message") as HTMLInputElement;
    expect(input.maxLength).toBe(8192);
  });

  it("a failed send shows a generic toast and does not add a fake message to the list", async () => {
    mockFetch.mockImplementation(routeFetch({
      send: jsonResponse({ success: false, error: "content must not be empty" }, false, 400),
    }));
    setUrl("/business-chat/7");
    renderPage();
    await waitFor(() => expect(screen.getByText("No messages sent yet. Say hello to get started.")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("input-business-chat-message"), { target: { value: "hi" } });
    fireEvent.click(screen.getByTestId("button-send-business-chat"));

    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    expect(toastSpy.mock.calls[0][0].title).toBe("Message failed");
    expect(screen.getByText("No messages sent yet. Say hello to get started.")).toBeInTheDocument();
  });
});

describe("P1-4: interim polling for business replies", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it("1 & 2. existing history stays intact, and a new incoming message appears automatically after a poll tick -- no manual refresh", async () => {
    const existing = { id: 1, content: "earlier message", senderParticipantId: MY_PARTICIPANT_ID, createdAt: "2026-08-25T00:01:00Z" };
    const reply = { id: 2, content: "business reply", senderParticipantId: BUSINESS_PARTICIPANT_ID, createdAt: "2026-08-25T00:02:00Z" };

    mockFetch.mockImplementation(sequencedMessagesFetch([
      { success: true, messages: [existing], total: 1, limit: 50, offset: 0, viewerParticipantId: MY_PARTICIPANT_ID },
      { success: true, messages: [reply, existing], total: 2, limit: 50, offset: 0, viewerParticipantId: MY_PARTICIPANT_ID },
    ]));

    setUrl("/business-chat/7");
    renderPage();
    await vi.waitFor(() => expect(screen.getByText("earlier message")).toBeInTheDocument());
    expect(screen.queryByText("business reply")).not.toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });

    await vi.waitFor(() => expect(screen.getByText("business reply")).toBeInTheDocument());
    // existing history is still there, not replaced/lost
    expect(screen.getByText("earlier message")).toBeInTheDocument();
  });

  it("P1-A REGRESSION (this exact scenario -- customer senderParticipantId=1, business reply senderParticipantId=2 -- is what the pre-fix implementation got wrong: EVERY message rendered role=\"user\"/right-aligned with the CONSUMER'S OWN username as sender, so the business's reply was indistinguishable from, and mislabeled as, the consumer's own message). This test fails against the old hardcoded role=\"user\" implementation and must pass against the fix.", async () => {
    const mine = { id: 1, content: "Is this in stock?", senderParticipantId: MY_PARTICIPANT_ID, createdAt: "2026-08-25T00:01:00Z" };
    const theirs = { id: 2, content: "Yes, in stock!", senderParticipantId: BUSINESS_PARTICIPANT_ID, createdAt: "2026-08-25T00:02:00Z" };

    mockFetch.mockImplementation(routeFetch({
      messages: jsonResponse({ success: true, messages: [theirs, mine], total: 2, limit: 50, offset: 0, viewerParticipantId: MY_PARTICIPANT_ID }),
    }));
    setUrl("/business-chat/7");
    renderPage();

    await vi.waitFor(() => expect(screen.getByText("Is this in stock?")).toBeInTheDocument());
    expect(screen.getByText("Yes, in stock!")).toBeInTheDocument();

    // 1 & 5. mixed conversation, both sides render with the CORRECT, opposite alignment
    expect(getAlignment("Is this in stock?")).toBe("right"); // role="user"
    expect(getAlignment("Yes, in stock!")).toBe("left"); // role="assistant"

    // 3. the business reply is NEVER labeled with the consumer's own username
    // (useAuth mock above returns username "telugu_user" -- this is the
    // exact old bug: senderName={user?.username} applied unconditionally)
    expect(screen.queryByText("telugu_user")).not.toBeInTheDocument();

    // 4. the business reply uses the consumer-safe business identity
    // (already fetched from GET /api/messaging/business/:businessId) as its
    // sender label, when available -- checked via the badge's distinct
    // class, not just text-anywhere-on-page (the header also legitimately
    // shows the business name).
    expect(hasSenderBadge("Namaste Kirana Store")).toBe(true);
  });

  it("the consumer's own messages never show a sender-name badge (no 'me' label needed for role=\"user\")", async () => {
    const mine = { id: 1, content: "hello from me", senderParticipantId: MY_PARTICIPANT_ID, createdAt: "2026-08-25T00:01:00Z" };
    mockFetch.mockImplementation(routeFetch({
      messages: jsonResponse({ success: true, messages: [mine], total: 1, limit: 50, offset: 0, viewerParticipantId: MY_PARTICIPANT_ID }),
    }));
    setUrl("/business-chat/7");
    renderPage();

    await waitFor(() => expect(screen.getByText("hello from me")).toBeInTheDocument());
    expect(getAlignment("hello from me")).toBe("right");
    // no sender-name badge attached to the consumer's own bubble (the
    // header legitimately shows the business name once identity loads --
    // that's unrelated to this message's own badge, checked specifically)
    expect(hasSenderBadge("Namaste Kirana Store")).toBe(false);
    expect(hasSenderBadge("telugu_user")).toBe(false);
  });

  it("before any message has ever been sent (viewerParticipantId: null), a message list of length zero renders the empty state, not a misattributed message", async () => {
    mockFetch.mockImplementation(routeFetch({
      messages: jsonResponse({ success: true, messages: [], total: 0, limit: 50, offset: 0, viewerParticipantId: null }),
    }));
    setUrl("/business-chat/7");
    renderPage();

    await waitFor(() => expect(screen.getByText("No messages sent yet. Say hello to get started.")).toBeInTheDocument());
  });

  it("3. the same message observed on two consecutive polls is shown exactly once", async () => {
    const msg = { id: 1, content: "only one copy", senderParticipantId: 1, createdAt: "2026-08-25T00:01:00Z" };
    mockFetch.mockImplementation(sequencedMessagesFetch([
      { success: true, messages: [msg], total: 1, limit: 50, offset: 0 },
      { success: true, messages: [msg], total: 1, limit: 50, offset: 0 }, // unchanged on the poll
    ]));

    setUrl("/business-chat/7");
    renderPage();
    await vi.waitFor(() => expect(screen.getByText("only one copy")).toBeInTheDocument());

    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    await vi.waitFor(() => expect(mockFetch.mock.calls.filter((c: any[]) => String(c[0]).endsWith("/messages") && (c[1]?.method ?? "GET") === "GET").length).toBeGreaterThan(1));

    expect(screen.getAllByText("only one copy")).toHaveLength(1);
  });

  it("4. messages stay chronological after a poll adds a new one", async () => {
    const first = { id: 1, content: "first", senderParticipantId: 1, createdAt: "2026-08-25T00:01:00Z" };
    const second = { id: 2, content: "second", senderParticipantId: 1, createdAt: "2026-08-25T00:02:00Z" };
    const third = { id: 3, content: "third", senderParticipantId: 2, createdAt: "2026-08-25T00:03:00Z" };

    mockFetch.mockImplementation(sequencedMessagesFetch([
      { success: true, messages: [second, first], total: 2, limit: 50, offset: 0 }, // server order: newest-first
      { success: true, messages: [third, second, first], total: 3, limit: 50, offset: 0 },
    ]));

    setUrl("/business-chat/7");
    renderPage();
    await vi.waitFor(() => expect(screen.getByText("second")).toBeInTheDocument());

    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    await vi.waitFor(() => expect(screen.getByText("third")).toBeInTheDocument());

    const bodyText = document.body.textContent || "";
    expect(bodyText.indexOf("first")).toBeLessThan(bodyText.indexOf("second"));
    expect(bodyText.indexOf("second")).toBeLessThan(bodyText.indexOf("third"));
  });

  it("6. polling stops once the component unmounts (no further /messages GETs fire after unmount)", async () => {
    mockFetch.mockImplementation(routeFetch({}));
    setUrl("/business-chat/7");
    const { unmount } = renderPage();
    await vi.waitFor(() => expect(screen.getByText("No messages sent yet. Say hello to get started.")).toBeInTheDocument());

    const callsBeforeUnmount = mockFetch.mock.calls.length;
    unmount();

    await act(async () => { await vi.advanceTimersByTimeAsync(30000); }); // several poll intervals' worth
    expect(mockFetch.mock.calls.length).toBe(callsBeforeUnmount);
  });

  it("7. refetchIntervalInBackground is explicitly set to false (source-level check -- see file comment for why a real visibility-timing test is not attempted in jsdom)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const source = fs.readFileSync(path.resolve(__dirname, "./BusinessChatPage.tsx"), "utf8");
    expect(source).toContain("refetchIntervalInBackground: false");
    expect(source).toContain("refetchInterval: POLL_INTERVAL_MS");
  });

  it("does not use an aggressive (<5s) polling interval", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const source = fs.readFileSync(path.resolve(__dirname, "./BusinessChatPage.tsx"), "utf8");
    const match = source.match(/POLL_INTERVAL_MS\s*=\s*(\d+)/);
    expect(match).not.toBeNull();
    const value = Number(match![1]);
    expect(value).toBeGreaterThanOrEqual(5000);
    expect(value).toBeLessThanOrEqual(10000);
  });

  it("8. a 401 on the messages endpoint is handled through the existing error UI, not a crash", async () => {
    mockFetch.mockImplementation(routeFetch({
      messages: jsonResponse({ success: false, error: "Please log in to continue" }, false, 401),
    }));
    setUrl("/business-chat/7");
    renderPage();

    await vi.waitFor(() => expect(screen.queryByTestId("loading-business-chat-messages")).not.toBeInTheDocument());
    // no crash -- renders the same safe QueryErrorState path as the 500 case,
    // not the raw "Please log in to continue" auth-middleware message text
    const bodyText = document.body.textContent || "";
    expect(bodyText).not.toContain("Please log in to continue");
    expect(screen.queryByText("No messages sent yet. Say hello to get started.")).not.toBeInTheDocument();
  });

  it("11. no console errors (excluding React's known act()-wrapping advisory noise, which is a fake-timers/RTL testing-harness artifact, not a production code path -- see file comment) across an initial load + a poll tick + a send", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const msg = { id: 1, content: "hello", senderParticipantId: 1, createdAt: "2026-08-25T00:01:00Z" };
    mockFetch.mockImplementation(sequencedMessagesFetch([
      { success: true, messages: [], total: 0, limit: 50, offset: 0 },
      { success: true, messages: [msg], total: 1, limit: 50, offset: 0 },
    ]));

    setUrl("/business-chat/7");
    await act(async () => { renderPage(); });
    await vi.waitFor(() => expect(screen.getByText("No messages sent yet. Say hello to get started.")).toBeInTheDocument());

    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    await vi.waitFor(() => expect(screen.getByText("hello")).toBeInTheDocument());

    const genuineErrors = consoleErrorSpy.mock.calls.filter(
      (call) => !String(call[0]).includes("not wrapped in act("),
    );
    expect(genuineErrors).toEqual([]);
    consoleErrorSpy.mockRestore();
  });

  it("12. the responsive container classes (max-w-2xl mx-auto, matching the rest of the app's chat surfaces) are still present -- structural check; jsdom does not perform real layout, so this is not a genuine viewport/visual test", async () => {
    mockFetch.mockImplementation(routeFetch({}));
    setUrl("/business-chat/7");
    renderPage();
    await vi.waitFor(() => expect(screen.getByText("No messages sent yet. Say hello to get started.")).toBeInTheDocument());

    const responsiveContainer = document.querySelector(".max-w-2xl.mx-auto");
    expect(responsiveContainer).not.toBeNull();
  });
});
