import { useEffect, useRef, useState } from "react";
import { useRoute } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Building2, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatMessage } from "@/components/ChatMessage";
import { QueryErrorState } from "@/components/QueryErrorState";
import { useToast } from "@/hooks/use-toast";
import { getAuthToken } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";

/**
 * P1-3 / P1-3A / P1-4: smallest production-quality consumer UI for
 * messaging a NeuraTalk Business. Reuses existing conventions throughout --
 * apiRequest/queryClient, ChatMessage, the same header/ScrollArea/composer
 * structure ChatPage.tsx establishes for personal chat.
 *
 * P1-A fix (2026-08-25): sender attribution (role="user" vs "assistant",
 * and the sender name badge) is derived from the server-resolved
 * viewerParticipantId (see MessagesResponse below and
 * listUserInitiatedMessages in server/modules/messaging/service.ts) --
 * NEVER from the locally-authenticated user's own profile. The original
 * implementation rendered every message as role="user"/senderName=this
 * user's own username regardless of actual sender, which made a business's
 * reply indistinguishable from (and mislabeled as) the consumer's own
 * message.
 *
 * P2 (2026-08-25): Redis-backed SSE real-time delivery with polling
 * correctness fallback. NOT "guaranteed real-time delivery" -- see
 * server/modules/messaging/realtime.ts's file-level doc comment for the
 * exact narrow crash-window gap (Postgres COMMIT -> process crash -> Redis
 * PUBLISH) this design deliberately accepts rather than solving with a
 * durable outbox. Preference order: SSE (subscribes to
 * GET /api/messaging/business/:businessId/stream) -> on error, bounded
 * reconnect at 2s/4s/8s -> if still unavailable, the original 8-second
 * poll below becomes the active transport (it is NEVER removed, only
 * toggled off while SSE is healthy) -> a slow background retry keeps
 * attempting to re-establish SSE so a temporary outage self-heals without
 * a page reload.
 *
 * No optimistic pre-confirmation state: a message enters the UI only after
 * the server confirms it (201). After a successful send, the cache is
 * updated with the server-returned message AND the messages query is
 * invalidated to reconcile with server truth in the background -- the
 * invalidated refetch REPLACES the cache (react-query's normal behavior),
 * it does not append on top of the optimistic update, so the message can
 * never appear twice. The periodic poll below uses the exact same
 * full-list-replace mechanism, so duplication is structurally impossible
 * there too, not just handled by a best-effort ID merge.
 */

const MAX_MESSAGE_LENGTH = 8192; // the existing canonical-messaging limit (createMessageTx / sendUserMessageSchema), not a new one

// Conservative interim polling interval. The existing app has precedents
// ranging from 1500ms (ChatPage.tsx's own selected-thread poll) to 60000ms
// (billing contracts), so there's no single established "message polling"
// convention to inherit exactly -- deliberately NOT following the fastest
// precedent (1.5-4s, used for personal/group chat) here, per explicit
// instruction to stay conservative for this interim solution. 8s sits
// squarely in the instructed 5-10s range.
const POLL_INTERVAL_MS = 8000;

// How close to the bottom (in px) counts as "already near the bottom" for
// auto-scroll purposes -- a small, generous threshold, not a strict 0.
const NEAR_BOTTOM_THRESHOLD_PX = 120;

interface BusinessIdentity {
  id: number;
  name: string;
  logoUrl: string | null;
  description: string | null;
}

interface BusinessMessage {
  id: number;
  content: string;
  senderParticipantId: number;
  createdAt: string;
}

interface MessagesResponse {
  success: true;
  messages: BusinessMessage[];
  total: number;
  limit: number;
  offset: number;
  // P1-A fix (2026-08-25): the consumer's OWN messaging_participants.id in
  // this conversation, resolved server-side (see listUserInitiatedMessages
  // in server/modules/messaging/service.ts) -- never a client-supplied
  // value. This is the only signal used to tell "my message" from "the
  // business's reply"; no employee identity of any kind is exposed here.
  viewerParticipantId: number | null;
}

export default function BusinessChatPage() {
  const [, params] = useRoute("/business-chat/:businessId");
  const businessId = Number(params?.businessId);
  const isValidBusinessId = Number.isFinite(businessId) && businessId > 0;

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [messageInput, setMessageInput] = useState("");
  // P2: true only while a live SSE connection is open and has received at
  // least its "ready" frame. While true, the poll below is disabled
  // (refetchInterval: false) since SSE is the active transport; false
  // means either "still connecting" or "degraded", in both of which the
  // poll stays on as the correctness backstop -- never both, never neither.
  const [sseHealthy, setSseHealthy] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  // Tracked via a real scroll listener (updated on every scroll, no
  // re-render) rather than computed reactively -- by the time a data
  // update triggers a re-render, the DOM has already changed, so "was the
  // user near the bottom" has to be captured continuously, not derived
  // after the fact. Starts true so the initial load lands at the bottom.
  const isNearBottomRef = useRef(true);

  const messagesQueryKey = ["/api/messaging/business", businessId, "messages"];

  const identityQuery = useQuery<{ success: true; business: BusinessIdentity }>({
    queryKey: ["/api/messaging/business", businessId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/messaging/business/${businessId}`);
      return res.json();
    },
    enabled: isValidBusinessId,
  });

  const messagesQuery = useQuery<MessagesResponse>({
    queryKey: messagesQueryKey,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/messaging/business/${businessId}/messages`);
      return res.json();
    },
    enabled: isValidBusinessId,
    // P2: the poll is the fallback transport, active whenever SSE isn't
    // confirmed healthy (see sseHealthy above) -- `false` here means
    // "SSE has the ready frame, stop polling", not "polling was removed".
    // refetchIntervalInBackground defaults to false in this project's
    // TanStack Query version -- set explicitly here so the "does not poll
    // while the tab isn't focused" behavior is a documented decision, not
    // an implicit default a future reader has to go verify. react-query
    // itself already stops the interval entirely once this component (and
    // therefore this query observer) unmounts -- no manual cleanup needed
    // for that part.
    refetchInterval: sseHealthy ? false : POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  // listMessages (reused server-side, unmodified) returns newest-first for
  // pagination purposes -- reversed here only for chronological display.
  const chronologicalMessages = messagesQuery.data
    ? [...messagesQuery.data.messages].reverse()
    : [];

  // P1-A fix: a message is "mine" iff its senderParticipantId matches the
  // server-resolved viewerParticipantId -- never inferred from anything
  // client-supplied. null/undefined viewerParticipantId (e.g. before the
  // very first message in a brand-new conversation resolves) means no
  // message can be classified as mine yet, which is correct since none
  // exist to misattribute.
  const viewerParticipantId = messagesQuery.data?.viewerParticipantId ?? null;
  const businessName = identityQuery.data?.business?.name || undefined;

  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector<HTMLDivElement>("[data-radix-scroll-area-viewport]");
    if (!viewport) return;
    const handleScroll = () => {
      const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      isNearBottomRef.current = distanceFromBottom < NEAR_BOTTOM_THRESHOLD_PX;
    };
    handleScroll();
    viewport.addEventListener("scroll", handleScroll);
    return () => viewport.removeEventListener("scroll", handleScroll);
  }, [isValidBusinessId]);

  useEffect(() => {
    // Only auto-scroll if the user was already near the bottom -- someone
    // reading older messages when a poll lands (or their own send resolves)
    // should not be yanked back down.
    if (isNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [chronologicalMessages.length]);

  // P2: SSE connection lifecycle -- bounded reconnect (2s/4s/8s), then a
  // slow background retry (30s) while the 8s poll above carries the load.
  // Deliberately does NOT copy ChatPage.tsx's personal-chat pattern of
  // permanently giving up on SSE after the first error; this reconnects.
  useEffect(() => {
    if (!isValidBusinessId) return;
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
        eventSource = new EventSource(`/api/messaging/business/${businessId}/stream?auth=${encodeURIComponent(token!)}`);

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

            if (payload.type === "message.created" && payload.message) {
              const incoming = payload.message as BusinessMessage;
              queryClient.setQueryData<MessagesResponse>(messagesQueryKey, (current) => {
                if (!current) return current;
                // Dedupe against both an in-flight/just-completed
                // invalidate-refetch and a possible duplicate live event --
                // the message id is the only identity that matters here.
                if (current.messages.some((m) => m.id === incoming.id)) return current;
                return {
                  ...current,
                  messages: [incoming, ...current.messages],
                  total: current.total + 1,
                };
              });
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
    // messagesQueryKey is derived from businessId every render (new array
    // identity each time) -- intentionally omitted from deps to avoid
    // tearing down/reconnecting the SSE connection every render; businessId
    // itself is the real dependency and is included below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, isValidBusinessId, queryClient]);

  const sendMessageMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await apiRequest("POST", `/api/messaging/business/${businessId}/messages`, { content });
      return res.json() as Promise<{ success: true; message: BusinessMessage }>;
    },
    onSuccess: (data) => {
      if (data?.message) {
        queryClient.setQueryData<MessagesResponse>(messagesQueryKey, (current) => {
          if (!current) return current;
          // Newest-first, matching the server's own order -- prepend, not append.
          return {
            ...current,
            messages: [data.message, ...current.messages],
            total: current.total + 1,
            // P1-A fix: a successful send is always OUR OWN message, so its
            // senderParticipantId IS the viewer's participant id -- backfill
            // it here (only if not already known) so a brand-new
            // conversation's very first message renders as "mine"
            // immediately, instead of a one-tick flash as "assistant"
            // before the background invalidate/refetch below resolves.
            viewerParticipantId: current.viewerParticipantId ?? data.message.senderParticipantId,
          };
        });
      }
      // Reconciles with server truth in the background; REPLACES the cache
      // on completion (react-query's normal invalidate behavior), so this
      // can never double the message the setQueryData call above already added.
      queryClient.invalidateQueries({ queryKey: messagesQueryKey });
      setMessageInput("");
    },
    onError: () => {
      toast({
        title: "Message failed",
        description: "Could not send this message. Try again.",
        variant: "destructive",
      });
    },
  });

  const handleSend = () => {
    const trimmed = messageInput.trim();
    if (!trimmed || sendMessageMutation.isPending) return;
    sendMessageMutation.mutate(trimmed);
  };

  const headerName = identityQuery.data?.business?.name || "Business Chat";

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex flex-col">
      <div className="border-b px-4 py-3 bg-background/70 backdrop-blur-sm flex items-center gap-3">
        <a href="/dashboard">
          <Button variant="ghost" size="icon" data-testid="button-business-chat-back">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </a>
        <div className="min-w-0 flex items-center gap-2">
          {identityQuery.data?.business?.logoUrl ? (
            <img
              src={identityQuery.data.business.logoUrl}
              alt=""
              className="w-6 h-6 rounded-full object-cover shrink-0"
            />
          ) : (
            <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
          )}
          <div className="font-semibold truncate" data-testid="text-business-chat-name">
            {identityQuery.isLoading ? "Loading..." : headerName}
          </div>
        </div>
      </div>

      <main className="flex-1 flex flex-col">
        {!isValidBusinessId ? (
          <div className="flex-1 flex items-center justify-center p-6">
            <Card className="w-full max-w-md">
              <CardContent className="py-10 text-center text-muted-foreground">
                <p>This business chat link isn't valid.</p>
              </CardContent>
            </Card>
          </div>
        ) : (
          <>
            <ScrollArea className="flex-1 p-4" ref={scrollAreaRef}>
              <div className="max-w-2xl mx-auto space-y-4">
                {messagesQuery.isLoading ? (
                  <div className="flex justify-center py-8" data-testid="loading-business-chat-messages">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : messagesQuery.isError ? (
                  <QueryErrorState error={messagesQuery.error} onRetry={() => messagesQuery.refetch()} label="this conversation" />
                ) : chronologicalMessages.length === 0 ? (
                  <Card>
                    <CardContent className="py-12 text-center text-muted-foreground">
                      <Building2 className="w-10 h-10 mx-auto mb-3 opacity-50" />
                      <p>No messages sent yet. Say hello to get started.</p>
                    </CardContent>
                  </Card>
                ) : (
                  chronologicalMessages.map((message) => {
                    // P1-A fix: role is derived ONLY from the server-resolved
                    // viewerParticipantId, never assumed. A message whose
                    // sender isn't the viewer is the business's reply.
                    const isMine = viewerParticipantId != null && message.senderParticipantId === viewerParticipantId;
                    return (
                      // Future translation home: ChatMessage's existing
                      // secondaryContent prop is exactly where a translated
                      // rendering would go once business translation ships --
                      // no rewrite needed, just pass a value here.
                      <ChatMessage
                        key={message.id}
                        role={isMine ? "user" : "assistant"}
                        content={message.content}
                        timestamp={new Date(message.createdAt)}
                        // Never the consumer's own username on a business
                        // reply. Only a consumer-safe business identity
                        // (already fetched from GET /api/messaging/business/
                        // :businessId, which projects nothing but
                        // id/name/logoUrl/description) is ever shown here --
                        // no employee name/id/email/phone is available to
                        // this component at all. Omitted entirely (not a
                        // fallback label) when unavailable, and omitted for
                        // the consumer's own messages, matching the
                        // no-name-badge-for-"me" convention this component
                        // already had no counter-example against.
                        senderName={isMine ? undefined : businessName}
                      />
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            <div className="border-t bg-background/80 backdrop-blur-md p-4">
              <div className="max-w-2xl mx-auto flex gap-2">
                <Input
                  value={messageInput}
                  onChange={(event) => setMessageInput(event.target.value)}
                  placeholder="Type your message..."
                  maxLength={MAX_MESSAGE_LENGTH}
                  disabled={sendMessageMutation.isPending}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      handleSend();
                    }
                  }}
                  data-testid="input-business-chat-message"
                />
                <Button
                  onClick={handleSend}
                  disabled={!messageInput.trim() || sendMessageMutation.isPending}
                  data-testid="button-send-business-chat"
                >
                  {sendMessageMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </Button>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
