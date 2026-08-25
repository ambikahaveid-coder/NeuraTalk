import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import BusinessInboxPanel from "./BusinessInboxPanel";

/**
 * P1-5: component-level tests for the Business Inbox panel. Mocks fetch and
 * useToast, matching conventions established in BusinessChatPage.test.tsx
 * and CompanyDashboard.test.tsx. Backend-level guarantees (tenant isolation
 * of listBusinessConversations, sender-identity resolution in
 * sendBusinessAgentMessage, RBAC gating of the underlying routes) are
 * proven in tests/unit/messaging-phase0.test.ts and
 * messaging-phase0-rbac.test.ts -- not re-proven here with a shallower
 * mock; this file proves the UI layer specifically.
 */

const mockFetch = vi.fn();
const toastSpy = vi.fn();

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

let mockAuthUser: { id: number; role?: string } = { id: 42 };
vi.mock("@/hooks/use-auth", () => ({
  getAuthToken: () => "test-token",
  useAuth: () => ({ user: mockAuthUser }),
}));

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

function renderPanel(businessId = 7) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <BusinessInboxPanel businessId={businessId} />
    </QueryClientProvider>,
  );
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body), json: async () => body } as unknown as Response;
}

const CONVERSATIONS_RESPONSE = {
  success: true,
  conversations: [
    { id: 1, conversationId: 10, customerId: 5, customerName: "Priya Sharma", status: "open", assignedToUserId: null, assignedToUsername: null, lastMessage: { content: "Is this in stock?", createdAt: "2026-08-25T00:05:00Z" }, createdAt: "2026-08-25T00:00:00Z" },
  ],
};

const CONVERSATION_DETAIL_RESPONSE = {
  success: true,
  conversation: {
    participants: [
      { id: 100, participantType: "business", participantId: 7, role: "business" },
      { id: 101, participantType: "user", participantId: 5, role: "customer" },
      { id: 102, participantType: "user", participantId: 42, role: "agent" },
    ],
  },
};

const MESSAGES_RESPONSE = {
  success: true,
  messages: [
    { id: 2, senderParticipantId: 101, content: "Is this in stock?", createdAt: "2026-08-25T00:05:00Z" },
    { id: 1, senderParticipantId: 102, content: "Welcome! How can I help?", createdAt: "2026-08-25T00:01:00Z" },
  ],
  total: 2,
};

const MEMBERS_RESPONSE = {
  success: true,
  members: [
    { id: 42, username: "me_admin" },
    { id: 200, username: "agent_bob" },
  ],
};

function defaultRouteFetch(overrides: { conversations?: any; detail?: any; messages?: any; reply?: any; claim?: any; unassign?: any; members?: any; assignment?: any } = {}) {
  return async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    if (method === "PATCH" && u.includes("/assignment")) {
      return overrides.assignment ?? jsonResponse({ success: true, conversation: { id: 1, assignedToUserId: 200, assignedToUsername: "agent_bob" } });
    }
    if (method === "POST" && u.includes("/claim")) {
      return overrides.claim ?? jsonResponse({ success: true, conversation: { id: 1, assignedToUserId: 42, assignedToUsername: "agent42" } });
    }
    if (method === "POST" && u.includes("/unassign")) {
      return overrides.unassign ?? jsonResponse({ success: true, conversation: { id: 1, assignedToUserId: null, assignedToUsername: null } });
    }
    if (method === "POST" && u.includes("/messages")) {
      return overrides.reply ?? jsonResponse({ success: true, message: { id: 3, senderParticipantId: 102, content: "sent", createdAt: "2026-08-25T00:10:00Z" } });
    }
    if (method === "GET" && u.includes("/messages")) return overrides.messages ?? jsonResponse(MESSAGES_RESPONSE);
    if (method === "GET" && /\/conversations\/\d+$/.test(u)) return overrides.detail ?? jsonResponse(CONVERSATION_DETAIL_RESPONSE);
    if (method === "GET" && u.includes("/members")) return overrides.members ?? jsonResponse(MEMBERS_RESPONSE);
    if (method === "GET" && u.includes("/conversations")) return overrides.conversations ?? jsonResponse(CONVERSATIONS_RESPONSE);
    return jsonResponse({ success: true });
  };
}

/** P2: see BusinessChatPage.test.tsx's identical fake for the exact
 * rationale -- jsdom has no native EventSource, installed only for the
 * dedicated P2 describe block below. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  close() { this.closed = true; }
  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
  triggerError() {
    this.onerror?.();
  }
}

beforeEach(() => {
  vi.restoreAllMocks();
  toastSpy.mockClear();
  mockFetch.mockClear();
  vi.stubGlobal("fetch", mockFetch);
  mockAuthUser = { id: 42 }; // default: plain agent, no role -- isAdmin resolves false
});

describe("BusinessInboxPanel", () => {
  it("1 & 5 & 6. business user can open the inbox; customer list and latest-message preview render", async () => {
    mockFetch.mockImplementation(defaultRouteFetch());
    renderPanel();

    await waitFor(() => expect(screen.getByText("Priya Sharma")).toBeInTheDocument());
    expect(screen.getByText("Is this in stock?")).toBeInTheDocument();
  });

  it("7. empty inbox state renders when there are no conversations", async () => {
    mockFetch.mockImplementation(defaultRouteFetch({ conversations: jsonResponse({ success: true, conversations: [] }) }));
    renderPanel();

    await waitFor(() => expect(screen.getByText("No customer conversations yet.")).toBeInTheDocument());
  });

  it("8 & 9. selecting a conversation loads and renders its message history", async () => {
    mockFetch.mockImplementation(defaultRouteFetch());
    renderPanel();

    await waitFor(() => expect(screen.getByText("Priya Sharma")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("inbox-conversation-1"));

    await waitFor(() => expect(screen.getByText("Welcome! How can I help?")).toBeInTheDocument());
    // "Is this in stock?" legitimately appears twice in the DOM: once as the
    // list-pane preview snippet, once as the full message bubble -- both
    // panes stay mounted simultaneously (the mobile/desktop split is a CSS
    // `hidden md:flex` class, invisible to jsdom's text queries, not
    // conditional rendering), so this is expected, not a duplicate-message bug.
    expect(screen.getAllByText("Is this in stock?").length).toBeGreaterThanOrEqual(1);
    // chronological order: agent's welcome (created first) before customer's
    // question, WITHIN the message pane. "Is this in stock?" also appears
    // earlier in the DOM as the list-pane preview snippet (see note above),
    // so the message-pane occurrence is its LAST occurrence, not its first.
    const bodyText = document.body.textContent || "";
    expect(bodyText.indexOf("Welcome! How can I help?")).toBeLessThan(bodyText.lastIndexOf("Is this in stock?"));
  });

  it("10 & 11. a reply sends through the existing business-side endpoint with only {content} in the body -- no sender id field, matching the composer's own inputs", async () => {
    mockFetch.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (method === "POST") {
        expect(u).toBe("/api/business/7/conversations/1/messages");
        const body = JSON.parse(String(init?.body));
        expect(body).toEqual({ content: "Yes, we have stock!" });
        return jsonResponse({ success: true, message: { id: 3, senderParticipantId: 102, content: "Yes, we have stock!", createdAt: "2026-08-25T00:10:00Z" } });
      }
      return defaultRouteFetch()(url, init);
    });
    renderPanel();

    await waitFor(() => expect(screen.getByText("Priya Sharma")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("inbox-conversation-1"));
    await waitFor(() => expect(screen.getByTestId("input-inbox-reply")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("input-inbox-reply"), { target: { value: "Yes, we have stock!" } });
    fireEvent.click(screen.getByTestId("button-inbox-send"));

    await waitFor(() => expect(screen.getByText("Yes, we have stock!")).toBeInTheDocument());
    expect((screen.getByTestId("input-inbox-reply") as HTMLInputElement).value).toBe("");
  });

  it("12. send button is disabled for empty/whitespace-only input", async () => {
    mockFetch.mockImplementation(defaultRouteFetch());
    renderPanel();
    await waitFor(() => expect(screen.getByText("Priya Sharma")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("inbox-conversation-1"));
    await waitFor(() => expect(screen.getByTestId("button-inbox-send")).toBeInTheDocument());

    expect(screen.getByTestId("button-inbox-send")).toBeDisabled();
    fireEvent.change(screen.getByTestId("input-inbox-reply"), { target: { value: "   " } });
    expect(screen.getByTestId("button-inbox-send")).toBeDisabled();
  });

  it("13 & 14. a failed reply shows a generic toast without leaking internal error details, and does not add a fake message", async () => {
    mockFetch.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "POST") {
        return jsonResponse({ success: false, error: "relation messaging_messages does not exist at pg-pool DATABASE_URL=secret" }, false, 500);
      }
      return defaultRouteFetch()(url, init);
    });
    renderPanel();
    await waitFor(() => expect(screen.getByText("Priya Sharma")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("inbox-conversation-1"));
    await waitFor(() => expect(screen.getByTestId("input-inbox-reply")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("input-inbox-reply"), { target: { value: "test reply" } });
    fireEvent.click(screen.getByTestId("button-inbox-send"));

    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    expect(toastSpy.mock.calls[0][0].title).toBe("Reply failed");
    const bodyText = document.body.textContent || "";
    expect(bodyText).not.toContain("DATABASE_URL");
    expect(bodyText).not.toContain("pg-pool");
    expect(screen.queryByText("test reply")).not.toBeInTheDocument();
  });

  it("15. mobile navigation works structurally: selecting a conversation hides the list pane and shows the detail pane; back returns to the list", async () => {
    mockFetch.mockImplementation(defaultRouteFetch());
    renderPanel();
    await waitFor(() => expect(screen.getByText("Priya Sharma")).toBeInTheDocument());

    // before selection: list visible, detail's back button not present
    expect(screen.queryByTestId("button-inbox-back")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("inbox-conversation-1"));
    await waitFor(() => expect(screen.getByTestId("button-inbox-back")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("button-inbox-back"));
    await waitFor(() => expect(screen.queryByTestId("button-inbox-back")).not.toBeInTheDocument());
  });

  it("16. no duplicate messages after the send-confirmation cache update + background invalidate/refetch resolve", async () => {
    let messagesState = { success: true, messages: [...MESSAGES_RESPONSE.messages], total: 2 };
    mockFetch.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (method === "POST") {
        const sent = { id: 3, senderParticipantId: 102, content: "no duplicates please", createdAt: "2026-08-25T00:10:00Z" };
        messagesState = { ...messagesState, messages: [sent, ...messagesState.messages], total: messagesState.total + 1 };
        return jsonResponse({ success: true, message: sent });
      }
      if (u.includes("/messages")) return jsonResponse(messagesState);
      if (/\/conversations\/\d+$/.test(u)) return jsonResponse(CONVERSATION_DETAIL_RESPONSE);
      if (u.includes("/conversations")) return jsonResponse(CONVERSATIONS_RESPONSE);
      return jsonResponse({ success: true });
    });
    renderPanel();

    await waitFor(() => expect(screen.getByText("Priya Sharma")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("inbox-conversation-1"));
    await waitFor(() => expect(screen.getByTestId("input-inbox-reply")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("input-inbox-reply"), { target: { value: "no duplicates please" } });
    fireEvent.click(screen.getByTestId("button-inbox-send"));

    await waitFor(() => expect(screen.getAllByText("no duplicates please")).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 50)); // let the background invalidate/refetch settle
    expect(screen.getAllByText("no duplicates please")).toHaveLength(1);
  });

  it("17. no console errors during a normal open + select + reply flow", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetch.mockImplementation(defaultRouteFetch());

    await act(async () => { renderPanel(); });
    await waitFor(() => expect(screen.getByText("Priya Sharma")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("inbox-conversation-1"));
    await waitFor(() => expect(screen.getByTestId("input-inbox-reply")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("input-inbox-reply"), { target: { value: "hello" } });
    fireEvent.click(screen.getByTestId("button-inbox-send"));
    await waitFor(() => expect((screen.getByTestId("input-inbox-reply") as HTMLInputElement).value).toBe(""));

    const genuineErrors = consoleErrorSpy.mock.calls.filter(
      (call) => !String(call[0]).includes("not wrapped in act("),
    );
    expect(genuineErrors).toEqual([]);
    consoleErrorSpy.mockRestore();
  });

  it("P1-6: unassigned conversation shows an 'Unassigned' badge and a Claim button; clicking Claim calls the claim endpoint and refreshes the list", async () => {
    let claimedCalled = false;
    mockFetch.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (method === "POST" && u.includes("/claim")) {
        claimedCalled = true;
        expect(u).toBe("/api/business/7/conversations/1/claim");
        return jsonResponse({ success: true, conversation: { id: 1, assignedToUserId: 42, assignedToUsername: "agent42" } });
      }
      return defaultRouteFetch()(url, init);
    });
    renderPanel();

    await waitFor(() => expect(screen.getByText("Priya Sharma")).toBeInTheDocument());
    expect(screen.getByTestId("inbox-assignee-1")).toHaveTextContent("Unassigned");
    fireEvent.click(screen.getByTestId("inbox-conversation-1"));

    await waitFor(() => expect(screen.getByTestId("button-inbox-claim")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("button-inbox-claim"));

    await waitFor(() => expect(claimedCalled).toBe(true));
  });

  it("P1-6: claim conflict (409, already claimed by someone else) shows a generic toast, not a crash", async () => {
    mockFetch.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (method === "POST" && u.includes("/claim")) {
        return jsonResponse({ error: "This conversation was already claimed" }, false, 409);
      }
      return defaultRouteFetch()(url, init);
    });
    renderPanel();

    await waitFor(() => expect(screen.getByText("Priya Sharma")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("inbox-conversation-1"));
    await waitFor(() => expect(screen.getByTestId("button-inbox-claim")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("button-inbox-claim"));

    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    expect(toastSpy.mock.calls[0][0].title).toBe("Claim failed");
  });

  it("P1-6: a conversation assigned to the current agent shows a Release control that calls unassign", async () => {
    const assignedToMe = {
      success: true,
      conversations: [
        { id: 1, conversationId: 10, customerId: 5, customerName: "Priya Sharma", status: "open", assignedToUserId: 42, assignedToUsername: "agent42", lastMessage: { content: "Is this in stock?", createdAt: "2026-08-25T00:05:00Z" }, createdAt: "2026-08-25T00:00:00Z" },
      ],
    };
    let unassignCalled = false;
    mockFetch.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (method === "POST" && u.includes("/unassign")) {
        unassignCalled = true;
        expect(u).toBe("/api/business/7/conversations/1/unassign");
        return jsonResponse({ success: true, conversation: { id: 1, assignedToUserId: null, assignedToUsername: null } });
      }
      return defaultRouteFetch({ conversations: jsonResponse(assignedToMe) })(url, init);
    });
    renderPanel();

    await waitFor(() => expect(screen.getByText("Priya Sharma")).toBeInTheDocument());
    expect(screen.getByTestId("inbox-assignee-1")).toHaveTextContent("agent42");
    fireEvent.click(screen.getByTestId("inbox-conversation-1"));

    await waitFor(() => expect(screen.getByTestId("button-inbox-unassign")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("button-inbox-unassign"));

    await waitFor(() => expect(unassignCalled).toBe(true));
  });

  it("P1-6: a conversation assigned to another agent shows neither Claim nor Release", async () => {
    const assignedToOther = {
      success: true,
      conversations: [
        { id: 1, conversationId: 10, customerId: 5, customerName: "Priya Sharma", status: "open", assignedToUserId: 999, assignedToUsername: "other_agent", lastMessage: { content: "Is this in stock?", createdAt: "2026-08-25T00:05:00Z" }, createdAt: "2026-08-25T00:00:00Z" },
      ],
    };
    mockFetch.mockImplementation(defaultRouteFetch({ conversations: jsonResponse(assignedToOther) }));
    renderPanel();

    await waitFor(() => expect(screen.getByText("Priya Sharma")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("inbox-conversation-1"));

    await waitFor(() => expect(screen.getByText("Assigned to other_agent")).toBeInTheDocument());
    expect(screen.queryByTestId("button-inbox-claim")).not.toBeInTheDocument();
    expect(screen.queryByTestId("button-inbox-unassign")).not.toBeInTheDocument();
  });

  it("P1-6: clicking an assignment filter re-fetches the conversation list with the ?assignment= query param", async () => {
    const fetchedUrls: string[] = [];
    mockFetch.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if ((init?.method ?? "GET") === "GET" && u.includes("/conversations") && !/\/conversations\/\d+/.test(u)) {
        fetchedUrls.push(u);
      }
      return defaultRouteFetch()(url, init);
    });
    renderPanel();

    await waitFor(() => expect(screen.getByText("Priya Sharma")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("filter-mine"));

    await waitFor(() => expect(fetchedUrls.some((u) => u.includes("assignment=mine"))).toBe(true));
  });

  it("P1-7: a plain agent (no admin role) sees Claim/Release, never the admin assignment picker", async () => {
    mockAuthUser = { id: 42, role: "agent" };
    mockFetch.mockImplementation(defaultRouteFetch());
    renderPanel();

    await waitFor(() => expect(screen.getByText("Priya Sharma")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("inbox-conversation-1"));

    await waitFor(() => expect(screen.getByTestId("button-inbox-claim")).toBeInTheDocument());
    expect(screen.queryByTestId("select-inbox-assignee")).not.toBeInTheDocument();
  });

  it("P1-7: a company_admin sees the assignment picker instead of Claim/Release, populated from the members roster", async () => {
    mockAuthUser = { id: 9, role: "company_admin" };
    mockFetch.mockImplementation(defaultRouteFetch());
    renderPanel();

    await waitFor(() => expect(screen.getByText("Priya Sharma")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("inbox-conversation-1"));

    await waitFor(() => expect(screen.getByTestId("select-inbox-assignee")).toBeInTheDocument());
    expect(screen.queryByTestId("button-inbox-claim")).not.toBeInTheDocument();
    expect(screen.queryByTestId("button-inbox-unassign")).not.toBeInTheDocument();
    expect(screen.getByText("agent_bob")).toBeInTheDocument();
  });

  it("P1-7: super_admin also sees the assignment picker (same admin gate as company_admin)", async () => {
    mockAuthUser = { id: 1, role: "super_admin" };
    mockFetch.mockImplementation(defaultRouteFetch());
    renderPanel();

    await waitFor(() => expect(screen.getByText("Priya Sharma")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("inbox-conversation-1"));

    await waitFor(() => expect(screen.getByTestId("select-inbox-assignee")).toBeInTheDocument());
  });

  it("P1-7: selecting a member from the picker calls PATCH .../assignment with the chosen assigneeUserId and refreshes the list", async () => {
    mockAuthUser = { id: 9, role: "company_admin" };
    let assignmentCallBody: any = null;
    mockFetch.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (method === "PATCH" && u.includes("/assignment")) {
        assignmentCallBody = JSON.parse(String(init?.body));
        expect(u).toBe("/api/business/7/conversations/1/assignment");
        return jsonResponse({ success: true, conversation: { id: 1, assignedToUserId: 200, assignedToUsername: "agent_bob" } });
      }
      return defaultRouteFetch()(url, init);
    });
    renderPanel();

    await waitFor(() => expect(screen.getByText("Priya Sharma")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("inbox-conversation-1"));
    await waitFor(() => expect(screen.getByTestId("select-inbox-assignee")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("select-inbox-assignee"), { target: { value: "200" } });

    await waitFor(() => expect(assignmentCallBody).toEqual({ assigneeUserId: 200 }));
  });

  it("P1-7: choosing 'Unassigned' in the picker sends assigneeUserId: null (unassign via the admin path)", async () => {
    mockAuthUser = { id: 9, role: "company_admin" };
    const assignedConversations = {
      success: true,
      conversations: [
        { id: 1, conversationId: 10, customerId: 5, customerName: "Priya Sharma", status: "open", assignedToUserId: 200, assignedToUsername: "agent_bob", lastMessage: { content: "Is this in stock?", createdAt: "2026-08-25T00:05:00Z" }, createdAt: "2026-08-25T00:00:00Z" },
      ],
    };
    let assignmentCallBody: any = null;
    mockFetch.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (method === "PATCH" && u.includes("/assignment")) {
        assignmentCallBody = JSON.parse(String(init?.body));
        return jsonResponse({ success: true, conversation: { id: 1, assignedToUserId: null, assignedToUsername: null } });
      }
      return defaultRouteFetch({ conversations: jsonResponse(assignedConversations) })(url, init);
    });
    renderPanel();

    await waitFor(() => expect(screen.getByText("Priya Sharma")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("inbox-conversation-1"));
    await waitFor(() => expect(screen.getByTestId("select-inbox-assignee")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("select-inbox-assignee"), { target: { value: "" } });

    await waitFor(() => expect(assignmentCallBody).toEqual({ assigneeUserId: null }));
  });

  it("P1-7: a 403 (ineligible target) from the assignment endpoint shows a generic toast, not a raw error", async () => {
    mockAuthUser = { id: 9, role: "company_admin" };
    mockFetch.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (method === "PATCH" && u.includes("/assignment")) {
        return jsonResponse({ error: "Target user is not an eligible member of this business" }, false, 403);
      }
      return defaultRouteFetch()(url, init);
    });
    renderPanel();

    await waitFor(() => expect(screen.getByText("Priya Sharma")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("inbox-conversation-1"));
    await waitFor(() => expect(screen.getByTestId("select-inbox-assignee")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("select-inbox-assignee"), { target: { value: "200" } });

    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    expect(toastSpy.mock.calls[0][0].title).toBe("Assignment failed");
  });

  it("a failed conversation-list fetch shows a safe error state, not a crash or a raw error leak", async () => {
    mockFetch.mockImplementation(defaultRouteFetch({
      conversations: jsonResponse({ error: "Internal failure at pg-pool DATABASE_URL=secret" }, false, 500),
    }));
    renderPanel();

    await waitFor(() => expect(screen.queryByText("No customer conversations yet.")).not.toBeInTheDocument());
    const bodyText = document.body.textContent || "";
    expect(bodyText).not.toContain("DATABASE_URL");
    expect(bodyText).not.toContain("pg-pool");
  });
});

describe("P2: SSE-preferred real-time transport for the Business Inbox", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("connects to the authenticated Business Inbox stream URL for this businessId", async () => {
    mockFetch.mockImplementation(defaultRouteFetch());
    renderPanel();

    await vi.waitFor(() => expect(FakeEventSource.instances.length).toBe(1));
    expect(FakeEventSource.instances[0].url).toBe("/api/business/7/conversations/stream?auth=test-token");
  });

  it("a message.created event for the currently OPEN conversation triggers a refetch that shows the new message, without waiting for the next poll tick", async () => {
    let messagesState = { ...MESSAGES_RESPONSE };
    mockFetch.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (method === "GET" && u.includes("/messages")) return jsonResponse(messagesState);
      return defaultRouteFetch()(url, init);
    });
    renderPanel();
    await waitFor(() => expect(screen.getByText("Priya Sharma")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("inbox-conversation-1"));
    await waitFor(() => expect(screen.getByText("Welcome! How can I help?")).toBeInTheDocument());
    await vi.waitFor(() => expect(FakeEventSource.instances.length).toBe(1));

    // Server now genuinely has the new message (as it would after a real
    // send elsewhere) -- the live event just tells the client to go get it.
    messagesState = {
      ...messagesState,
      messages: [{ id: 3, senderParticipantId: 101, content: "live customer message", createdAt: "2026-08-25T00:06:00Z" }, ...messagesState.messages],
    };
    act(() => { FakeEventSource.instances[0].emit({ type: "ready" }); });
    act(() => { FakeEventSource.instances[0].emit({ type: "message.created", conversationId: 1 }); });

    await vi.waitFor(() => expect(screen.getByText("live customer message")).toBeInTheDocument());
  });

  it("a message.created event for a DIFFERENT (not-open) conversation still leaves the open conversation's own messages intact and correct", async () => {
    let conversationsState = { ...CONVERSATIONS_RESPONSE };
    mockFetch.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (method === "GET" && u.includes("/conversations") && !/\/conversations\/\d+/.test(u)) return jsonResponse(conversationsState);
      return defaultRouteFetch()(url, init);
    });
    renderPanel();
    await waitFor(() => expect(screen.getByText("Priya Sharma")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("inbox-conversation-1"));
    await waitFor(() => expect(screen.getByText("Welcome! How can I help?")).toBeInTheDocument());
    await vi.waitFor(() => expect(FakeEventSource.instances.length).toBe(1));

    act(() => { FakeEventSource.instances[0].emit({ type: "ready" }); });
    act(() => { FakeEventSource.instances[0].emit({ type: "message.created", conversationId: 999 }); }); // NOT the open conversation (id 1)

    // the unrelated conversation's event triggers only the (harmless,
    // idempotent) list refresh -- the open conversation's own history is
    // untouched/uncorrupted by an event that isn't about it
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screen.getByText("Welcome! How can I help?")).toBeInTheDocument();
    // "Is this in stock?" legitimately appears twice (list-pane preview +
    // message bubble), same as the non-SSE tests above in this file.
    expect(screen.getAllByText("Is this in stock?").length).toBeGreaterThanOrEqual(1);
  });

  it("an assignment.changed event (claim/release/admin reassign from another agent) refreshes the conversation list so the assignee badge updates live", async () => {
    // Explicit type: CONVERSATIONS_RESPONSE's own literal type infers
    // assignedToUserId/assignedToUsername/success as exactly `null`/`false`-
    // incompatible literal types (its fixture values), which would reject
    // the later reassignment below to a real id/username -- widen to the
    // real response shape instead of relying on inference from the
    // fixture's initial values.
    interface ConversationsStateFixture {
      success: true;
      conversations: Array<{
        id: number; conversationId: number; customerId: number | null; customerName: string | null;
        status: string; assignedToUserId: number | null; assignedToUsername: string | null;
        lastMessage: { content: string; createdAt: string } | null; createdAt: string;
      }>;
    }
    let conversationsState: ConversationsStateFixture = { ...CONVERSATIONS_RESPONSE } as ConversationsStateFixture;
    mockFetch.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (method === "GET" && u.includes("/conversations") && !/\/conversations\/\d+/.test(u)) return jsonResponse(conversationsState);
      return defaultRouteFetch()(url, init);
    });
    renderPanel();
    await waitFor(() => expect(screen.getByText("Priya Sharma")).toBeInTheDocument());
    expect(screen.getByTestId("inbox-assignee-1")).toHaveTextContent("Unassigned");
    await vi.waitFor(() => expect(FakeEventSource.instances.length).toBe(1));

    conversationsState = {
      success: true,
      conversations: [{ ...CONVERSATIONS_RESPONSE.conversations[0], assignedToUserId: 200, assignedToUsername: "agent_bob" }],
    };
    act(() => { FakeEventSource.instances[0].emit({ type: "ready" }); });
    act(() => { FakeEventSource.instances[0].emit({ type: "assignment.changed", conversationId: 1, assignedToUserId: 200, assignedToUsername: "agent_bob", operation: "claim" }); });

    await vi.waitFor(() => expect(screen.getByTestId("inbox-assignee-1")).toHaveTextContent("agent_bob"));
  });

  it("bounded reconnect: an SSE error schedules a new connection attempt rather than permanently giving up", async () => {
    mockFetch.mockImplementation(defaultRouteFetch());
    renderPanel();
    await vi.waitFor(() => expect(FakeEventSource.instances.length).toBe(1));

    act(() => { FakeEventSource.instances[0].triggerError(); });
    expect(FakeEventSource.instances[0].closed).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    await vi.waitFor(() => expect(FakeEventSource.instances.length).toBe(2));
  });

  it("the 8s poll remains active until the stream's ready frame is received (correctness backstop never disabled prematurely)", async () => {
    mockFetch.mockImplementation(defaultRouteFetch());
    renderPanel();
    await waitFor(() => expect(screen.getByText("Priya Sharma")).toBeInTheDocument());
    await vi.waitFor(() => expect(FakeEventSource.instances.length).toBe(1));

    const callsBefore = mockFetch.mock.calls.filter((c: any[]) => String(c[0]).includes("/conversations") && !String(c[0]).includes("/messages")).length;
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    const callsAfter = mockFetch.mock.calls.filter((c: any[]) => String(c[0]).includes("/conversations") && !String(c[0]).includes("/messages")).length;

    expect(callsAfter).toBeGreaterThan(callsBefore);
  });

  it("EventSource is closed on unmount (no leaked connection/listener)", async () => {
    mockFetch.mockImplementation(defaultRouteFetch());
    const { unmount } = renderPanel();
    await vi.waitFor(() => expect(FakeEventSource.instances.length).toBe(1));

    unmount();
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });
});
