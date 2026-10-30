import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Building2, Clock, ExternalLink, FileText, Loader2, MapPin, MessagesSquare, Paperclip, Phone, Reply, Send, ShoppingBag, UserRound, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useUpload } from "@/hooks/use-upload";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatMessage } from "@/components/ChatMessage";
import { QueryErrorState } from "@/components/QueryErrorState";
import { useToast } from "@/hooks/use-toast";
import { useAuth, getAuthToken } from "@/hooks/use-auth";
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
 * P2 (2026-08-25): Redis-backed SSE real-time delivery with polling
 * correctness fallback -- see server/modules/messaging/realtime.ts and
 * BusinessChatPage.tsx's matching file comment for the full architecture
 * and its accepted crash-window gap. ONE stream
 * (GET /api/business/:businessId/conversations/stream) covers the whole
 * business: new/updated conversations, new messages in whichever
 * conversation is open, and assignment changes (claim/release/admin
 * (re)assign) -- not three separate connections. The 8s poll below is
 * NEVER removed, only toggled off while that stream is confirmed healthy.
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
  category?: string;
  /** How far a business-sent message got with the customer (ticks). */
  deliveryToCustomer?: string | null;
  messageType?: string;
  /** The customer's message in my language; the original stays in `content`. */
  translatedContent?: string | null;
  attachments?: Array<{ type: string; url: string; mimeType: string | null; sizeBytes: number | null }>;
  replyTo?: { id: number; content: string; messageType: string; senderParticipantId: number } | null;
  metadata?: {
    header?: string | null;
    footer?: string | null;
    buttons?: Array<{ type: "quick_reply" | "url" | "call"; id?: string; title: string; url?: string; phone?: string }>;
    location?: { latitude: number; longitude: number; name?: string; address?: string };
    buttonReply?: { messageId: number; buttonId: string; title?: string };
  } | null;
}

interface SendableTemplate {
  versionId: number;
  name: string;
  category: string;
  content: string;
  variables?: Array<{ name: string; required?: boolean }> | null;
}

/** Blanks the agent fills in -- {{name}} is filled with the customer's name by the server. */
function templateBlanks(t: SendableTemplate): string[] {
  return (t.variables ?? []).map((v) => v.name).filter((n) => n && n !== "name");
}

/** Template header, buttons, footer and shared location under a chat bubble. */
function MessageExtras({ message, alignEnd }: { message: MessageRow; alignEnd: boolean }) {
  const meta = message.metadata ?? null;
  if (!meta) return null;
  const { header, footer, buttons, location } = meta;
  if (!header && !footer && !buttons?.length && !location) return null;
  const mapUrl = location ? `https://www.google.com/maps?q=${location.latitude},${location.longitude}` : null;
  return (
    <div className={cn("flex flex-col gap-1 max-w-[80%] text-xs", alignEnd ? "items-end self-end" : "items-start self-start")} data-testid={`message-extras-${message.id}`}>
      {header ? <p className="font-semibold text-foreground">{header}</p> : null}
      {mapUrl ? (
        <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline">
          <MapPin className="w-3.5 h-3.5" /> Open location{location?.name ? ` — ${location.name}` : ""}
        </a>
      ) : null}
      {footer ? <p className="text-muted-foreground">{footer}</p> : null}
      {buttons?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {buttons.map((b, i) => (
            <span key={`${b.title}-${i}`} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-primary">
              {b.type === "url" ? <ExternalLink className="w-3 h-3" /> : b.type === "call" ? <Phone className="w-3 h-3" /> : <Reply className="w-3 h-3" />}
              {b.title}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const TICK_LABEL: Record<string, string> = { queued: "Sending", sent: "Sent", delivered: "Delivered", read: "Seen", failed: "Not delivered — customer is not on NeuraTalk" };

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
  // P2: see BusinessChatPage.tsx's identical flag for the exact semantics
  // -- true only once the stream's "ready" frame has been received.
  const [sseHealthy, setSseHealthy] = useState(false);
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
    refetchInterval: sseHealthy ? false : POLL_INTERVAL_MS,
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
  const messagesQuery = useQuery<{ success: true; messages: MessageRow[]; total: number; customerTyping?: boolean }>({
    queryKey: messagesQueryKey,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/business/${businessId}/conversations/${selectedId}/messages`);
      return res.json();
    },
    enabled: businessId > 0 && selectedId !== null,
    refetchInterval: sseHealthy ? false : POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  // 24-hour rule: after a day of customer silence only an approved template can go out.
  const windowQuery = useQuery<{ success: true; open: boolean; closesAt: string | null }>({
    queryKey: ["/api/business", businessId, "conversations", selectedId, "window"],
    queryFn: async () => (await apiRequest("GET", `/api/business/${businessId}/conversations/${selectedId}/window`)).json(),
    enabled: businessId > 0 && selectedId !== null,
    retry: false,
  });
  // Re-check whenever the messages change (a customer message re-opens it).
  const refetchWindow = windowQuery.refetch;
  useEffect(() => {
    if (selectedId !== null && messagesQuery.dataUpdatedAt) void refetchWindow();
  }, [messagesQuery.dataUpdatedAt, selectedId, refetchWindow]);
  const windowClosed = windowQuery.data?.open === false;
  const [replyTo, setReplyTo] = useState<MessageRow | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [chosenTemplate, setChosenTemplate] = useState<SendableTemplate | null>(null);
  const [templateValues, setTemplateValues] = useState<Record<string, string>>({});
  useEffect(() => { setReplyTo(null); }, [selectedId]);
  useEffect(() => { if (!templateOpen) { setChosenTemplate(null); setTemplateValues({}); } }, [templateOpen]);
  const templatesQuery = useQuery<{ success: true; templates: SendableTemplate[] }>({
    queryKey: ["/api/business", businessId, "sendable-templates"],
    queryFn: async () => (await apiRequest("GET", `/api/business/${businessId}/sendable-templates`)).json(),
    enabled: businessId > 0 && templateOpen,
    retry: false,
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

  // P2: mirrors isNearBottomRef's pattern -- read inside the SSE handler
  // below without making selectedId a dependency of that effect (which
  // would tear down and reopen the connection every time an agent clicks
  // a different conversation).
  const selectedIdRef = useRef<number | null>(null);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  // P2: single SSE connection for the whole business -- new conversations,
  // new messages (in whichever conversation is currently open), and
  // assignment changes all arrive on this one stream and all resolve to
  // the same action (invalidate the conversations list; additionally
  // invalidate the open conversation's messages for message.created).
  // Bounded reconnect (2s/4s/8s) then a slow 30s background retry, same
  // policy as BusinessChatPage.tsx -- see that file for why this
  // deliberately does not copy personal chat's permanent-give-up-on-error
  // behavior.
  useEffect(() => {
    if (!(businessId > 0)) return;
    const token = getAuthToken();
    if (!token) return;

    let closed = false;
    let eventSource: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let retryAttempt = 0;
    const RECONNECT_DELAYS_MS = [2000, 4000, 8000];
    const DEGRADED_RETRY_MS = 30000;

    const scheduleReconnect = () => {
      if (closed) return;
      const delay = retryAttempt < RECONNECT_DELAYS_MS.length
        ? RECONNECT_DELAYS_MS[retryAttempt++]
        : DEGRADED_RETRY_MS;
      reconnectTimer = window.setTimeout(connect, delay);
    };

    function connect() {
      if (closed) return;
      try {
        eventSource = new EventSource(`/api/business/${businessId}/conversations/stream?auth=${encodeURIComponent(token!)}`);

        eventSource.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data);
            if (!payload?.type) return;
            if (payload.type === "ready") {
              retryAttempt = 0;
              setSseHealthy(true);
              return;
            }
            if (payload.type === "heartbeat") return;

            if (payload.type === "delivery.updated" && selectedIdRef.current !== null && payload.conversationId === selectedIdRef.current) {
              queryClient.invalidateQueries({ queryKey: ["/api/business", businessId, "conversations", selectedIdRef.current, "messages"] });
            }
            if (payload.type === "message.created" || payload.type === "conversation.created" || payload.type === "assignment.changed") {
              // Invalidation, not direct cache mutation -- the conversation
              // list's shape depends on the active assignment filter and
              // on server-computed fields (lastMessage preview,
              // assignedToUsername) this event doesn't carry in full, so a
              // refetch is the correct source of truth here, not a patch.
              queryClient.invalidateQueries({ queryKey: ["/api/business", businessId, "conversations"] });
              if (payload.type === "message.created" && selectedIdRef.current !== null && payload.conversationId === selectedIdRef.current) {
                queryClient.invalidateQueries({ queryKey: ["/api/business", businessId, "conversations", selectedIdRef.current, "messages"] });
              }
            }
          } catch {
            // Ignore malformed real-time payloads -- the poll fallback (or
            // the next valid event) keeps the view eventually consistent.
          }
        };

        eventSource.onerror = () => {
          eventSource?.close();
          eventSource = null;
          setSseHealthy(false);
          scheduleReconnect();
        };
      } catch {
        setSseHealthy(false);
        scheduleReconnect();
      }
    }

    connect();

    return () => {
      closed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      eventSource?.close();
      setSseHealthy(false);
    };
  }, [businessId, queryClient]);

  const sendReplyMutation = useMutation({
    mutationFn: async (input: string | { content: string; attachment?: Record<string, unknown> }) => {
      const body: Record<string, unknown> = typeof input === "string" ? { content: input } : { ...input };
      if (replyTo) body.replyToMessageId = replyTo.id;
      const res = await apiRequest("POST", `/api/business/${businessId}/conversations/${selectedId}/messages`, body);
      return res.json() as Promise<{ success: true; message: MessageRow }>;
    },
    onSuccess: (data) => {
      if (data?.message) {
        // Show it on my side right away, with its quote, until the refetch lands.
        const sent: MessageRow = {
          ...data.message,
          deliveryToCustomer: data.message.deliveryToCustomer ?? "queued",
          replyTo: data.message.replyTo ?? (replyTo ? { id: replyTo.id, content: replyTo.content, messageType: replyTo.messageType ?? "text", senderParticipantId: replyTo.senderParticipantId } : null),
        };
        queryClient.setQueryData<{ success: true; messages: MessageRow[]; total: number }>(messagesQueryKey, (current) => {
          if (!current) return current;
          return { ...current, messages: [sent, ...current.messages], total: current.total + 1 };
        });
      }
      queryClient.invalidateQueries({ queryKey: messagesQueryKey });
      queryClient.invalidateQueries({ queryKey: ["/api/business", businessId, "conversations"] });
      setMessageInput("");
      setReplyTo(null);
    },
    onError: (error: any) => {
      const text = String(error?.message ?? "");
      if (text.includes("SERVICE_WINDOW_CLOSED")) {
        windowQuery.refetch();
        toast({ title: "24 hours have passed", description: "The customer hasn't written in 24 hours. Send an approved template instead.", variant: "destructive" });
        return;
      }
      toast({ title: "Reply failed", description: "Could not send this reply. Try again.", variant: "destructive" });
    },
  });

  const templateMutation = useMutation({
    mutationFn: async ({ versionId, variables }: { versionId: number; variables: Record<string, string> }) => {
      const res = await apiRequest("POST", `/api/business/${businessId}/conversations/${selectedId}/template`, { templateVersionId: versionId, variables });
      return res.json();
    },
    onSuccess: () => {
      setTemplateOpen(false);
      queryClient.invalidateQueries({ queryKey: messagesQueryKey });
      queryClient.invalidateQueries({ queryKey: ["/api/business", businessId, "conversations"] });
      toast({ title: "Template sent" });
    },
    onError: (error: any) => {
      const raw = String(error?.message ?? "");
      let description = "Could not send. Try again.";
      try { description = JSON.parse(raw.slice(raw.indexOf("{"))).error ?? description; } catch { /* keep default */ }
      toast({ title: "Not sent", description, variant: "destructive" });
    },
  });

  // Quick replies ("/shortcut") and catalog items, set up in Messaging.
  const settingsQuery = useQuery<{ settings: { quickReplies: Array<{ shortcut: string; text: string }> } }>({
    queryKey: ["/api/business", businessId, "messaging-settings"],
    queryFn: async () => (await apiRequest("GET", `/api/business/${businessId}/messaging-settings`)).json(),
    enabled: businessId > 0,
    retry: false,
  });
  const catalogQuery = useQuery<{ items: Array<{ id: number; name: string; description: string | null; pricePaise: number | null; isAvailable: boolean }> }>({
    queryKey: ["/api/business", businessId, "catalog"],
    queryFn: async () => (await apiRequest("GET", `/api/business/${businessId}/catalog`)).json(),
    enabled: businessId > 0,
    retry: false,
  });
  const quickMatches = messageInput.startsWith("/")
    ? (settingsQuery.data?.settings.quickReplies ?? []).filter((q) => q.shortcut.startsWith(messageInput.slice(1).toLowerCase()))
    : [];
  const [catalogOpen, setCatalogOpen] = useState(false);
  const { uploadFile, isUploading } = useUpload();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sendFile = async (file: File) => {
    const upload = await uploadFile(file);
    if (!upload) {
      toast({ title: "File not sent", description: "Upload failed. Try again.", variant: "destructive" });
      return;
    }
    sendReplyMutation.mutate({
      content: messageInput.trim(),
      attachment: { url: upload.objectPath, mimeType: file.type || undefined, sizeBytes: file.size || undefined, title: file.name.slice(0, 240) },
    });
  };

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
    <div className="flex h-[calc(100vh-220px)] min-h-[480px] rounded-xl border border-border overflow-hidden">
      {/* Conversation list -- hidden on mobile once a conversation is open */}
      <div className={cn(selectedId !== null ? "hidden md:flex" : "flex", "w-full md:w-80 flex-col border-r border-border bg-background/40")}>
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <MessagesSquare className="w-4 h-4 text-muted-foreground" />
          <h2 className="font-bold text-sm">Inbox</h2>
        </div>
        <div className="px-3 py-2 border-b border-border flex gap-1.5 flex-wrap" data-testid="inbox-assignment-filters">
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
                  : "border-border text-muted-foreground hover:bg-muted",
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
                  "w-full text-left px-4 py-3 border-b border-border hover:bg-muted transition-colors",
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
                      ? "bg-muted/50 text-muted-foreground"
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
            <div className="border-b border-border px-4 py-3 flex items-center gap-3">
              <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setSelectedId(null)} data-testid="button-inbox-back">
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm truncate" data-testid="text-inbox-customer-name">
                  {selectedConversation?.customerName || "Unknown customer"}
                </div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {messagesQuery.data?.customerTyping ? <span className="text-primary" data-testid="text-inbox-typing">typing… · </span> : null}
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
                    className="text-xs bg-background border border-border rounded-md px-2 py-1.5 max-w-[9rem] disabled:opacity-50"
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
                    // Business side = an agent, or the business itself
                    // (campaigns, order updates, codes); else the customer.
                    const isMine = role !== "customer" && message.deliveryToCustomer != null;
                    const quotedMine = message.replyTo ? roleByParticipantId.get(message.replyTo.senderParticipantId) !== "customer" : false;
                    return (
                      <div key={message.id} className="group flex flex-col gap-1" data-testid={`inbox-message-${message.id}`}>
                      {message.replyTo ? (
                        <div className={cn("max-w-[80%] rounded-md border-l-2 border-primary bg-muted/60 px-2.5 py-1 text-xs", isMine ? "self-end" : "self-start")} data-testid={`message-quote-${message.id}`}>
                          <p className="font-semibold text-primary">{quotedMine ? "You" : selectedConversation?.customerName || "Customer"}</p>
                          <p className="text-muted-foreground line-clamp-2">{message.replyTo.content || "Photo or file"}</p>
                        </div>
                      ) : null}
                      <ChatMessage
                        role={isMine ? "user" : "assistant"}
                        content={message.translatedContent || message.content}
                        secondaryContent={message.translatedContent ? message.content : null}
                        messageType={message.attachments?.length ? "attachment" : "text"}
                        attachmentUrl={message.attachments?.[0]?.url ?? null}
                        attachmentMime={message.attachments?.[0]?.mimeType ?? null}
                        attachmentSize={message.attachments?.[0]?.sizeBytes ?? null}
                        attachmentTitle={message.attachments?.length ? message.content : null}
                        timestamp={new Date(message.createdAt)}
                        status={isMine && message.deliveryToCustomer ? TICK_LABEL[message.deliveryToCustomer] ?? null : null}
                      />
                      <MessageExtras message={message} alignEnd={isMine} />
                      {!windowClosed ? (
                        <button
                          type="button"
                          onClick={() => setReplyTo(message)}
                          className={cn("text-[11px] text-muted-foreground hover:text-primary inline-flex items-center gap-1 opacity-70 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100", isMine ? "self-end" : "self-start")}
                          data-testid={`button-reply-${message.id}`}
                        >
                          <Reply className="w-3 h-3" /> Reply
                        </button>
                      ) : null}
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            <div className="border-t border-border p-4">
              {windowClosed ? (
                <div className="max-w-2xl mx-auto flex flex-col sm:flex-row sm:items-center gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm" data-testid="inbox-window-closed">
                  <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  <p className="flex-1 text-foreground">
                    The customer hasn't written in the last 24 hours. You can send an approved template; normal replies open again when they write back.
                  </p>
                  <Button size="sm" onClick={() => setTemplateOpen(true)} data-testid="button-inbox-send-template">
                    <FileText className="w-4 h-4 mr-1.5" /> Send a template
                  </Button>
                </div>
              ) : null}
              {replyTo && !windowClosed ? (
                <div className="max-w-2xl mx-auto mb-2 flex items-start gap-2 rounded-md border-l-2 border-primary bg-muted/60 px-3 py-2 text-xs" data-testid="inbox-reply-bar">
                  <Reply className="w-3.5 h-3.5 mt-0.5 text-primary shrink-0" />
                  <p className="flex-1 min-w-0 truncate text-muted-foreground">Replying to: {replyTo.translatedContent || replyTo.content || "Photo or file"}</p>
                  <button type="button" aria-label="Cancel reply" onClick={() => setReplyTo(null)} className="text-muted-foreground hover:text-foreground">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : null}
              {quickMatches.length > 0 && (
                <ul className="max-w-2xl mx-auto mb-2 rounded-md border bg-background/90 divide-y" role="listbox" aria-label="Quick replies" data-testid="list-quick-replies">
                  {quickMatches.slice(0, 6).map((q) => (
                    <li key={q.shortcut}>
                      <button type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50" onClick={() => setMessageInput(q.text)}>
                        <strong>/{q.shortcut}</strong> <span className="text-muted-foreground">— {q.text}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className={cn("max-w-2xl mx-auto flex gap-2", windowClosed && "hidden")}>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void sendFile(file);
                  }}
                />
                <Button variant="ghost" size="icon" aria-label="Attach a photo or file" disabled={isUploading || sendReplyMutation.isPending} onClick={() => fileInputRef.current?.click()} data-testid="button-inbox-attach">
                  {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
                </Button>
                {(catalogQuery.data?.items ?? []).some((i) => i.isAvailable) && (
                  <Button variant="ghost" size="icon" aria-label="Send a catalog item" onClick={() => setCatalogOpen(true)} data-testid="button-inbox-catalog">
                    <ShoppingBag className="w-4 h-4" />
                  </Button>
                )}
                <Input
                  value={messageInput}
                  onChange={(event) => setMessageInput(event.target.value)}
                  placeholder="Reply to customer... (type / for quick replies)"
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

      <Dialog open={templateOpen} onOpenChange={setTemplateOpen}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Send an approved template</DialogTitle></DialogHeader>
          {templatesQuery.isLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : chosenTemplate ? (
            <form
              className="space-y-3"
              data-testid="form-inbox-template"
              onSubmit={(event) => {
                event.preventDefault();
                templateMutation.mutate({ versionId: chosenTemplate.versionId, variables: templateValues });
              }}
            >
              <p className="text-sm font-medium">{chosenTemplate.name}</p>
              {templateBlanks(chosenTemplate).map((blank) => (
                <label key={blank} className="block text-sm">
                  <span className="text-muted-foreground">{blank.replace(/_/g, " ")}</span>
                  <Input
                    className="mt-1"
                    required={chosenTemplate.variables?.find((v) => v.name === blank)?.required !== false}
                    maxLength={200}
                    value={templateValues[blank] ?? ""}
                    onChange={(event) => setTemplateValues((cur) => ({ ...cur, [blank]: event.target.value }))}
                    data-testid={`input-template-${blank}`}
                  />
                </label>
              ))}
              <div className="rounded-md bg-muted/60 p-3 text-sm whitespace-pre-wrap" data-testid="text-template-preview">
                {chosenTemplate.content.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) =>
                  key === "name" ? selectedConversation?.customerName || "customer" : templateValues[key] || `[${key}]`)}
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setChosenTemplate(null)}>Back</Button>
                <Button type="submit" disabled={templateMutation.isPending} data-testid="button-template-send">
                  {templateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send"}
                </Button>
              </div>
            </form>
          ) : (templatesQuery.data?.templates ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No approved templates yet. Create one in Messaging → Templates; NeuraTalk reviews it, usually within a day.</p>
          ) : (
            <ul className="divide-y" data-testid="list-inbox-templates">
              {(templatesQuery.data?.templates ?? []).map((t) => (
                <li key={t.versionId}>
                  <button
                    type="button"
                    disabled={templateMutation.isPending}
                    className="w-full text-left py-2 px-2 rounded hover:bg-muted/50 disabled:opacity-50"
                    onClick={() => {
                      if (templateBlanks(t).length) setChosenTemplate(t);
                      else templateMutation.mutate({ versionId: t.versionId, variables: {} });
                    }}
                  >
                    <p className="font-medium">{t.name} <span className="text-xs text-muted-foreground">· {t.category === "marketing" ? "Offer" : "Update"}</span></p>
                    <p className="text-sm text-muted-foreground line-clamp-3">{t.content}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={catalogOpen} onOpenChange={setCatalogOpen}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Send a catalog item</DialogTitle></DialogHeader>
          <ul className="divide-y">
            {(catalogQuery.data?.items ?? []).filter((i) => i.isAvailable).map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="w-full text-left py-2 hover:bg-muted/50 px-2 rounded"
                  onClick={() => {
                    const price = item.pricePaise == null ? "Price on request" : `₹${(item.pricePaise / 100).toLocaleString("en-IN")}`;
                    setMessageInput(`${item.name} — ${price}${item.description ? `\n${item.description}` : ""}`);
                    setCatalogOpen(false);
                  }}
                >
                  <p className="font-medium">{item.name}</p>
                  <p className="text-sm text-muted-foreground">{item.pricePaise == null ? "Price on request" : `₹${(item.pricePaise / 100).toLocaleString("en-IN")}`}</p>
                </button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}
