import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Building2, Loader2, MessagesSquare, Send, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatMessage } from "@/components/ChatMessage";
import { QueryErrorState } from "@/components/QueryErrorState";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

/**
 * P1-7: company_admin/super_admin-only conversation reassignment. Gated
 * client-side purely for UI presentation (whether to show the picker at
 * all) -- the actual authorization is the backend's
 * requireRole("company_admin", "super_admin") on
 * PATCH .../conversations/:id/assignment (see server/modules/messaging/
 * routes.ts), which this component adds no bypass around. An agent who
 * somehow triggers the picker's onChange still gets a real 403 from the
 * server, same as any other unauthorized request.
 */

/**
 * P1-5: NeuraTalk Business Inbox -- the business-side counterpart to the
 * consumer BusinessChatPage (P1-3/P1-3A/P1-4). Reuses the existing
 * canonical messaging backend end to end:
 *   - GET /api/business/:businessId/conversations       (new this phase --
 *     see server/modules/messaging/service.ts's listBusinessConversations
 *     doc comment for why it didn't already exist)
 *   - GET /api/business/:businessId/conversations/:id           (Phase 0,
 *     unmodified -- reused here for its `participants` array, the only way
 *     to tell a customer's message from an agent's: both are
 *     participantType="user" rows now, see below)
 *   - GET /api/business/:businessId/conversations/:id/messages  (Phase 0,
 *     unmodified)
 *   - POST /api/business/:businessId/conversations/:id/messages (Phase 0
 *     route, P1-5 changed its controller to call sendBusinessAgentMessage
 *     instead of createMessage -- see that function's doc comment)
 * All four already require requireAuth + requireCompanyAccess("businessId")
 * + requirePermission(MESSAGING_VIEW/SEND) -- this component adds no
 * authorization logic of its own; the backend remains authoritative.
 *
 * Sender distinction: both a customer (via sendUserInitiatedMessage) and an
 * agent (via sendBusinessAgentMessage) get a participantType="user" row --
 * the only thing that differs is that row's `role` field ("customer" vs
 * "agent"). A message's senderParticipantId is looked up against the
 * conversation's participants (from GET .../conversations/:id) to decide
 * which side of the chat it renders on.
 *
 * No real-time push in this phase (matches P1-4's decision) -- the
 * conversation list and open conversation's messages refetch on the same
 * conservative 8s interval, paused when the tab isn't focused, stopped on
 * unmount (TanStack Query defaults). Real push delivery remains a later
 * optimization (see the P1-5 implementation report's P1-6 recommendation).
 */

const POLL_INTERVAL_MS = 8000;

type AssignmentFilter = "all" | "mine" | "unassigned";

const ASSIGNMENT_FILTERS: { value: AssignmentFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "mine", label: "Assigned to me" },
  { value: "unassigned", label: "Unassigned" },
];

interface ConversationSummary {
  id: number;
  conversationId: number;
  customerId: number | null;
  customerName: string | null;
  status: string;
  assignedToUserId: number | null;
  assignedToUsername: string | null;
  lastMessage: { content: string; createdAt: string } | null;
  createdAt: string;
}

interface ConversationParticipant {
  id: number;
  participantType: string;
  participantId: number;
  role: string | null;
}

interface MessageRow {
  id: number;
  senderParticipantId: number;
  content: string;
  createdAt: string;
}

interface EligibleMember {
  id: number;
  username: string;
}

function formatPreviewTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function BusinessInboxPanel({ businessId }: { businessId: number }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "company_admin" || user?.role === "super_admin";
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [messageInput, setMessageInput] = useState("");
  const [assignmentFilter, setAssignmentFilter] = useState<AssignmentFilter>("all");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  const conversationsQueryKey = ["/api/business", businessId, "conversations", assignmentFilter];
  const conversationsQuery = useQuery<{ success: true; conversations: ConversationSummary[] }>({
    queryKey: conversationsQueryKey,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/business/${businessId}/conversations?assignment=${assignmentFilter}`);
      return res.json();
    },
    enabled: businessId > 0,
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  const conversationDetailQuery = useQuery<{ success: true; conversation: { participants: ConversationParticipant[] } }>({
    queryKey: ["/api/business", businessId, "conversations", selectedId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/business/${businessId}/conversations/${selectedId}`);
      return res.json();
    },
    enabled: businessId > 0 && selectedId !== null,
  });

  const messagesQueryKey = ["/api/business", businessId, "conversations", selectedId, "messages"];
  const messagesQuery = useQuery<{ success: true; messages: MessageRow[]; total: number }>({
    queryKey: messagesQueryKey,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/business/${businessId}/conversations/${selectedId}/messages`);
      return res.json();
    },
    enabled: businessId > 0 && selectedId !== null,
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  // participantId -> role ("agent" | "customer" | ...), the only reliable
  // signal for which side of the chat a message belongs on -- see file
  // comment above.
  const roleByParticipantId = new Map<number, string | null>(
    (conversationDetailQuery.data?.conversation?.participants ?? []).map((p) => [p.id, p.role]),
  );

  const chronologicalMessages = messagesQuery.data
    ? [...messagesQuery.data.messages].reverse()
    : [];

  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector<HTMLDivElement>("[data-radix-scroll-area-viewport]");
    if (!viewport) return;
    const handleScroll = () => {
      const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      isNearBottomRef.current = distanceFromBottom < 120;
    };
    handleScroll();
    viewport.addEventListener("scroll", handleScroll);
    return () => viewport.removeEventListener("scroll", handleScroll);
  }, [selectedId]);

  useEffect(() => {
    if (isNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [chronologicalMessages.length]);

  const sendReplyMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await apiRequest("POST", `/api/business/${businessId}/conversations/${selectedId}/messages`, { content });
      return res.json() as Promise<{ success: true; message: MessageRow }>;
    },
    onSuccess: (data) => {
      if (data?.message) {
        queryClient.setQueryData<{ success: true; messages: MessageRow[]; total: number }>(messagesQueryKey, (current) => {
          if (!current) return current;
          return { ...current, messages: [data.message, ...current.messages], total: current.total + 1 };
        });
      }
      queryClient.invalidateQueries({ queryKey: messagesQueryKey });
      queryClient.invalidateQueries({ queryKey: ["/api/business", businessId, "conversations"] });
      setMessageInput("");
    },
    onError: () => {
      toast({ title: "Reply failed", description: "Could not send this reply. Try again.", variant: "destructive" });
    },
  });

  const handleSend = () => {
    const trimmed = messageInput.trim();
    if (!trimmed || sendReplyMutation.isPending || selectedId === null) return;
    sendReplyMutation.mutate(trimmed);
  };

  const claimMutation = useMutation({
    mutationFn: async (conversationId: number) => {
      const res = await apiRequest("POST", `/api/business/${businessId}/conversations/${conversationId}/claim`, {});
      return res.json() as Promise<{ success: true; conversation: ConversationSummary }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/business", businessId, "conversations"] });
    },
    onError: (error: any) => {
      const isConflict = typeof error?.message === "string" && error.message.startsWith("409:");
      const description = isConflict
        ? "Someone else just claimed this conversation."
        : "Could not claim this conversation. Try again.";
      toast({ title: "Claim failed", description, variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: ["/api/business", businessId, "conversations"] });
    },
  });

  const unassignMutation = useMutation({
    mutationFn: async (conversationId: number) => {
      const res = await apiRequest("POST", `/api/business/${businessId}/conversations/${conversationId}/unassign`, {});
      return res.json() as Promise<{ success: true; conversation: ConversationSummary }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/business", businessId, "conversations"] });
    },
    onError: () => {
      toast({ title: "Could not release conversation", description: "Try again.", variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: ["/api/business", businessId, "conversations"] });
    },
  });

  // P1-7: admin-only roster for the reassignment picker below. Backend-gated
  // (see file comment) -- fetching it client-side when !isAdmin would just
  // get a 403, so it's not even requested in that case.
  const membersQuery = useQuery<{ success: true; members: EligibleMember[] }>({
    queryKey: ["/api/business", businessId, "members"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/business/${businessId}/members`);
      return res.json();
    },
    enabled: isAdmin && businessId > 0,
  });

  const assignMutation = useMutation({
    mutationFn: async ({ conversationId, assigneeUserId }: { conversationId: number; assigneeUserId: number | null }) => {
      const res = await apiRequest("PATCH", `/api/business/${businessId}/conversations/${conversationId}/assignment`, { assigneeUserId });
      return res.json() as Promise<{ success: true; conversation: ConversationSummary }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/business", businessId, "conversations"] });
    },
    onError: (error: any) => {
      const isForbiddenTarget = typeof error?.message === "string" && error.message.startsWith("403:");
      const description = isForbiddenTarget
        ? "That member is not eligible for assignment in this business."
        : "Could not update the assignment. Try again.";
      toast({ title: "Assignment failed", description, variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: ["/api/business", businessId, "conversations"] });
    },
  });

  const conversations = conversationsQuery.data?.conversations ?? [];
  const selectedConversation = conversations.find((c) => c.id === selectedId) ?? null;
  const isAssignedToMe = selectedConversation?.assignedToUserId != null && selectedConversation.assignedToUserId === user?.id;
  const isUnassigned = selectedConversation?.assignedToUserId == null;

  return (
    <div className="flex h-[calc(100vh-220px)] min-h-[480px] rounded-xl border border-white/10 overflow-hidden">
      {/* Conversation list -- hidden on mobile once a conversation is open */}
      <div className={cn(selectedId !== null ? "hidden md:flex" : "flex", "w-full md:w-80 flex-col border-r border-white/10 bg-background/40")}>
        <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
          <MessagesSquare className="w-4 h-4 text-muted-foreground" />
          <h2 className="font-bold text-sm">Inbox</h2>
        </div>
        <div className="px-3 py-2 border-b border-white/10 flex gap-1.5 flex-wrap" data-testid="inbox-assignment-filters">
          {ASSIGNMENT_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => setAssignmentFilter(filter.value)}
              data-testid={`filter-${filter.value}`}
              className={cn(
                "text-xs px-2.5 py-1 rounded-full border transition-colors",
                assignmentFilter === filter.value
                  ? "bg-primary/15 border-primary/40 text-primary font-medium"
                  : "border-white/10 text-muted-foreground hover:bg-white/5",
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <ScrollArea className="flex-1">
          {conversationsQuery.isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : conversationsQuery.isError ? (
            <div className="p-4">
              <QueryErrorState error={conversationsQuery.error} onRetry={() => conversationsQuery.refetch()} label="conversations" />
            </div>
          ) : conversations.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              <UserRound className="w-8 h-8 mx-auto mb-2 opacity-50" />
              No customer conversations yet.
            </div>
          ) : (
            conversations.map((conv) => (
              <button
                key={conv.id}
                type="button"
                onClick={() => setSelectedId(conv.id)}
                data-testid={`inbox-conversation-${conv.id}`}
                className={cn(
                  "w-full text-left px-4 py-3 border-b border-white/5 hover:bg-white/5 transition-colors",
                  selectedId === conv.id && "bg-primary/10",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sm truncate">{conv.customerName || "Unknown customer"}</span>
                  {conv.lastMessage ? (
                    <span className="text-[10px] text-muted-foreground shrink-0">{formatPreviewTime(conv.lastMessage.createdAt)}</span>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {conv.lastMessage?.content || "No messages yet"}
                </p>
                <span
                  className={cn(
                    "inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded-full",
                    conv.assignedToUserId != null
                      ? "bg-white/10 text-muted-foreground"
                      : "bg-primary/10 text-primary",
                  )}
                  data-testid={`inbox-assignee-${conv.id}`}
                >
                  {conv.assignedToUserId != null ? conv.assignedToUsername || "Assigned" : "Unassigned"}
                </span>
              </button>
            ))
          )}
        </ScrollArea>
      </div>

      {/* Conversation panel -- hidden on mobile until a conversation is selected */}
      <div className={cn(selectedId === null ? "hidden md:flex" : "flex", "flex-1 flex-col")}>
        {selectedId === null ? (
          <div className="flex-1 flex items-center justify-center p-6">
            <Card className="w-full max-w-md">
              <CardContent className="py-10 text-center text-muted-foreground">
                <Building2 className="w-8 h-8 mx-auto mb-3 opacity-50" />
                Select a conversation to view messages.
              </CardContent>
            </Card>
          </div>
        ) : (
          <>
            <div className="border-b border-white/10 px-4 py-3 flex items-center gap-3">
              <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setSelectedId(null)} data-testid="button-inbox-back">
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm truncate" data-testid="text-inbox-customer-name">
                  {selectedConversation?.customerName || "Unknown customer"}
                </div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {isUnassigned
                    ? "Unassigned"
                    : isAssignedToMe
                      ? "Assigned to you"
                      : `Assigned to ${selectedConversation?.assignedToUsername || "another agent"}`}
                </div>
              </div>
              {isAdmin ? (
                <div className="flex items-center gap-1.5 shrink-0">
                  {assignMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" /> : null}
                  <select
                    aria-label="Assign conversation"
                    data-testid="select-inbox-assignee"
                    className="text-xs bg-background border border-white/10 rounded-md px-2 py-1.5 max-w-[9rem] disabled:opacity-50"
                    disabled={assignMutation.isPending || selectedId === null}
                    value={selectedConversation?.assignedToUserId ?? ""}
                    onChange={(event) => {
                      if (selectedId === null) return;
                      const raw = event.target.value;
                      assignMutation.mutate({ conversationId: selectedId, assigneeUserId: raw === "" ? null : Number(raw) });
                    }}
                  >
                    <option value="">Unassigned</option>
                    {(membersQuery.data?.members ?? []).map((member) => (
                      <option key={member.id} value={member.id}>{member.username}</option>
                    ))}
                  </select>
                </div>
              ) : isUnassigned ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={claimMutation.isPending || selectedId === null}
                  onClick={() => selectedId !== null && claimMutation.mutate(selectedId)}
                  data-testid="button-inbox-claim"
                >
                  {claimMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Claim"}
                </Button>
              ) : isAssignedToMe ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={unassignMutation.isPending || selectedId === null}
                  onClick={() => selectedId !== null && unassignMutation.mutate(selectedId)}
                  data-testid="button-inbox-unassign"
                >
                  {unassignMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Release"}
                </Button>
              ) : null}
            </div>

            <ScrollArea className="flex-1 p-4" ref={scrollAreaRef}>
              <div className="max-w-2xl mx-auto space-y-4">
                {messagesQuery.isLoading ? (
                  <div className="flex justify-center py-8" data-testid="loading-inbox-messages">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : messagesQuery.isError ? (
                  <QueryErrorState error={messagesQuery.error} onRetry={() => messagesQuery.refetch()} label="this conversation" />
                ) : chronologicalMessages.length === 0 ? (
                  <Card>
                    <CardContent className="py-12 text-center text-muted-foreground">
                      <MessagesSquare className="w-10 h-10 mx-auto mb-3 opacity-50" />
                      <p>No messages yet in this conversation.</p>
                    </CardContent>
                  </Card>
                ) : (
                  chronologicalMessages.map((message) => {
                    const role = roleByParticipantId.get(message.senderParticipantId);
                    const isMine = role === "agent";
                    return (
                      <ChatMessage
                        key={message.id}
                        role={isMine ? "user" : "assistant"}
                        content={message.content}
                        timestamp={new Date(message.createdAt)}
                      />
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            <div className="border-t border-white/10 p-4">
              <div className="max-w-2xl mx-auto flex gap-2">
                <Input
                  value={messageInput}
                  onChange={(event) => setMessageInput(event.target.value)}
                  placeholder="Reply to customer..."
                  maxLength={8192}
                  disabled={sendReplyMutation.isPending}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      handleSend();
                    }
                  }}
                  data-testid="input-inbox-reply"
                />
                <Button
                  onClick={handleSend}
                  disabled={!messageInput.trim() || sendReplyMutation.isPending}
                  data-testid="button-inbox-send"
                >
                  {sendReplyMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
