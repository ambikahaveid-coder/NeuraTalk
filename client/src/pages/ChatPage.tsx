import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Menu, MessageCircleMore, Languages, Send, CheckCheck, Check, Search, UserRound, Phone, Video, Paperclip, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { ChatMessage } from "@/components/ChatMessage";
import { TypingIndicator } from "@/components/TypingIndicator";
import { useToast } from "@/hooks/use-toast";
import { useContacts } from "@/hooks/use-contacts";
import { getAuthToken, useAuth } from "@/hooks/use-auth";
import { useUpload } from "@/hooks/use-upload";
import { useVoiceRecorder } from "@/ai_integrations/audio/useVoiceRecorder";
import { apiRequest, queryClient } from "@/lib/queryClient";

type PeerSummary = {
  id?: number;
  username?: string | null;
  email?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  displayName: string;
  contactLanguage?: string | null;
  identifier?: string;
  isFavorite?: boolean;
};

type PersonalThreadSummary = {
  id: number;
  viewerLanguage: string;
  peerLanguage: string;
  unreadCount: number;
  lastMessagePreview?: string | null;
  lastMessageAt?: string | null;
  peer: PeerSummary;
};

type PersonalThreadMessage = {
  id: number;
  senderUserId: number;
  messageType?: "text" | "voice_note" | "attachment";
  originalContent: string;
  originalLanguage: string;
  translatedContent?: string | null;
  displayContent: string;
  displayLanguage: string;
  showingTranslated: boolean;
  isOwn: boolean;
  deliveryStatus: string;
  attachmentUrl?: string | null;
  attachmentTitle?: string | null;
  deliveredAt?: string | null;
  seenAt?: string | null;
  createdAt: string;
};

type PendingPersonalThreadMessage = PersonalThreadMessage & {
  clientMessageId?: string;
  isPending?: boolean;
};

type PersonalThreadDetail = {
  thread: PersonalThreadSummary;
  messages: PersonalThreadMessage[];
};

type DiscoveryUser = {
  id: number;
  displayName: string;
  username?: string | null;
  email?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  identifier: string;
};

type PresenceState = {
  peerUserId: number;
  isTyping: boolean;
  lastActiveAt?: string | null;
  isRecentlyActive: boolean;
};

type PersonalChatRealtimeEvent = {
  type?: "ready" | "heartbeat" | "thread_created" | "thread_updated" | "message_created" | "messages_delivered" | "messages_seen" | "typing";
  threadId?: number;
  deliveredIds?: number[];
  seenCount?: number;
  senderUserId?: number;
  messageId?: number;
  messageType?: string;
  lastMessagePreview?: string;
  messageCreatedAt?: string;
  isTyping?: boolean;
};

function normalizeLanguageLabel(language?: string | null) {
  const code = String(language || "en").toLowerCase();
  const labels: Record<string, string> = {
    en: "English",
    te: "Telugu",
    hi: "Hindi",
    ta: "Tamil",
    kn: "Kannada",
    ml: "Malayalam",
    bn: "Bengali",
    mr: "Marathi",
    gu: "Gujarati",
  };
  return labels[code] || code.toUpperCase();
}

function formatDeliveryStatus(status?: string | null) {
  switch (status) {
    case "seen":
      return "Seen";
    case "delivered":
      return "Delivered";
    case "sent":
      return "Sent";
    default:
      return "";
  }
}

function createClientMessageId() {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildOptimisticThreadPreview(
  messageType: "text" | "voice_note" | "attachment" | undefined,
  content: string,
  attachmentTitle?: string | null,
) {
  if (messageType === "voice_note") {
    return attachmentTitle?.trim() || "Voice note";
  }
  if (messageType === "attachment") {
    return attachmentTitle?.trim() || content.trim() || "Attachment";
  }
  return content.trim().slice(0, 180);
}

function reorderThreadsWithPatch(
  threads: PersonalThreadSummary[],
  threadId: number,
  patch: Partial<PersonalThreadSummary>,
) {
  const existing = threads.find((thread) => thread.id === threadId);
  if (!existing) return threads;

  const nextThread = { ...existing, ...patch };
  return [
    nextThread,
    ...threads.filter((thread) => thread.id !== threadId),
  ];
}

export default function ChatPage() {
  const { toast } = useToast();
  const { contacts, isLoading: contactsLoading } = useContacts();
  const { user } = useAuth();
  const [selectedThreadId, setSelectedThreadId] = useState<number | null>(null);
  const [messageInput, setMessageInput] = useState("");
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [originalVisibleIds, setOriginalVisibleIds] = useState<number[]>([]);
  const [optimisticMessages, setOptimisticMessages] = useState<Record<number, PendingPersonalThreadMessage[]>>({});
  const [uploadIntent, setUploadIntent] = useState<"attachment" | "voice_note" | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const lastSeenMarkRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  const myLanguage = "en";
  const { state: recorderState, startRecording, stopRecording } = useVoiceRecorder();

  const { uploadFile, isUploading: isUploadingAttachment, progress: uploadProgress } = useUpload({
    onError: () => {
      setUploadIntent(null);
      toast({
        title: "Upload failed",
        description: "Could not upload this file right now. Try again.",
        variant: "destructive",
      });
    },
  });

  const { data: threadListData, isLoading: loadingThreads } = useQuery<{ threads: PersonalThreadSummary[] }>({
    queryKey: ["/api/personal-chats"],
    refetchInterval: 4000,
  });

  const threads = threadListData?.threads || [];

  const selectedThread = useQuery<PersonalThreadDetail>({
    queryKey: ["/api/personal-chats", selectedThreadId],
    enabled: !!selectedThreadId,
    refetchInterval: 1500,
  });

  const presenceQuery = useQuery<PresenceState>({
    queryKey: ["/api/personal-chats", selectedThreadId, "presence"],
    enabled: !!selectedThreadId,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/personal-chats/${selectedThreadId}/presence`);
      return res.json();
    },
    refetchInterval: 2000,
  });

  const discoverQuery = useQuery<{ results: DiscoveryUser[] }>({
    queryKey: ["/api/personal-chats/discover", search],
    enabled: search.trim().length >= 2,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/personal-chats/discover?q=${encodeURIComponent(search.trim())}`);
      return res.json();
    },
  });

  useEffect(() => {
    if (!selectedThreadId && threads.length > 0) {
      setSelectedThreadId(threads[0].id);
    }
  }, [selectedThreadId, threads]);

  useEffect(() => {
    if (!selectedThreadId) return;
    const incomingMessages = (selectedThread.data?.messages || []).filter((message) => !message.isOwn);
    const newestIncoming = incomingMessages.at(-1);
    if (!newestIncoming) return;

    const seenMarker = `${selectedThreadId}:${newestIncoming.id}:${newestIncoming.seenAt || ""}`;
    if (newestIncoming.seenAt || lastSeenMarkRef.current === seenMarker) {
      return;
    }

    lastSeenMarkRef.current = seenMarker;
    apiRequest("POST", `/api/personal-chats/${selectedThreadId}/seen`, {}).catch(() => undefined);
    queryClient.invalidateQueries({ queryKey: ["/api/personal-chats"] });
  }, [selectedThread.data?.messages, selectedThreadId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [selectedThread.data?.messages, optimisticMessages, selectedThreadId]);

  useEffect(() => () => {
    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    if (!selectedThreadId) return;

    const refreshActiveThread = () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/personal-chats", selectedThreadId] });
      void queryClient.invalidateQueries({ queryKey: ["/api/personal-chats"] });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshActiveThread();
      }
    };

    window.addEventListener("focus", refreshActiveThread);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", refreshActiveThread);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [selectedThreadId]);

  useEffect(() => {
    const token = getAuthToken();
    if (!token) return;

    let closed = false;
    let eventSource: EventSource | null = null;
    let fallbackPoll: number | null = null;

    const refreshThreadList = () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/personal-chats"] });
    };

    const refreshActiveThread = (threadId?: number | null) => {
      if (threadId) {
        void queryClient.invalidateQueries({ queryKey: ["/api/personal-chats", threadId] });
        void queryClient.invalidateQueries({ queryKey: ["/api/personal-chats", threadId, "presence"] });
      }
    };

    const startFallbackPolling = () => {
      if (fallbackPoll) return;
      fallbackPoll = window.setInterval(() => {
        refreshThreadList();
        if (selectedThreadId) {
          refreshActiveThread(selectedThreadId);
        }
      }, 4000);
    };

    try {
      eventSource = new EventSource(`/api/personal-chats/stream?auth=${encodeURIComponent(token)}`);
      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as PersonalChatRealtimeEvent;
          if (!payload?.type || payload.type === "heartbeat" || payload.type === "ready") {
            return;
          }

          if (payload.threadId) {
            const threadId = payload.threadId;
            queryClient.setQueryData<{ threads: PersonalThreadSummary[] }>(["/api/personal-chats"], (current) => {
              if (!current) return current;

              if (payload.type === "message_created") {
                const existingThread = current.threads.find((thread) => thread.id === threadId);
                return {
                  threads: reorderThreadsWithPatch(current.threads, threadId, {
                    unreadCount: payload.senderUserId && user?.id && payload.senderUserId !== Number(user.id)
                      ? (existingThread?.unreadCount || 0) + 1
                      : existingThread?.unreadCount || 0,
                    lastMessageAt: payload.messageCreatedAt || new Date().toISOString(),
                    lastMessagePreview: payload.lastMessagePreview || existingThread?.lastMessagePreview || "New message",
                  }),
                };
              }

              if (payload.type === "messages_seen") {
                return {
                  threads: current.threads.map((thread) =>
                    thread.id === payload.threadId
                      ? { ...thread, unreadCount: 0 }
                      : thread,
                  ),
                };
              }

              return current;
            });

            queryClient.setQueryData<PersonalThreadDetail>(["/api/personal-chats", payload.threadId], (current) => {
              if (!current) return current;

              if (payload.type === "messages_delivered" && payload.deliveredIds?.length) {
                return {
                  ...current,
                  messages: current.messages.map((message) =>
                    payload.deliveredIds!.includes(message.id) && message.deliveryStatus !== "seen"
                      ? {
                          ...message,
                          deliveryStatus: "delivered",
                          deliveredAt: message.deliveredAt || new Date().toISOString(),
                        }
                      : message,
                  ),
                };
              }

              if (payload.type === "messages_seen" && typeof payload.seenCount === "number" && payload.seenCount > 0) {
                let remainingToMark = payload.seenCount;
                const nextMessages = [...current.messages];
                for (let index = nextMessages.length - 1; index >= 0; index -= 1) {
                  const message = nextMessages[index];
                  if (!message.isOwn || remainingToMark <= 0) {
                    continue;
                  }
                  if (message.deliveryStatus === "seen") {
                    continue;
                  }
                  nextMessages[index] = {
                    ...message,
                    deliveryStatus: "seen",
                    deliveredAt: message.deliveredAt || new Date().toISOString(),
                    seenAt: new Date().toISOString(),
                  };
                  remainingToMark -= 1;
                }
                return {
                  ...current,
                  messages: nextMessages,
                };
              }

              return current;
            });
          }

          refreshThreadList();
          if (payload.threadId && (!selectedThreadId || payload.threadId === selectedThreadId)) {
            refreshActiveThread(payload.threadId);
          } else if (selectedThreadId) {
            refreshActiveThread(selectedThreadId);
          }
        } catch {
          // Ignore malformed realtime chat payloads
        }
      };
      eventSource.onerror = () => {
        if (!closed) {
          eventSource?.close();
          eventSource = null;
          startFallbackPolling();
        }
      };
    } catch {
      startFallbackPolling();
    }

    return () => {
      closed = true;
      eventSource?.close();
      if (fallbackPoll) {
        window.clearInterval(fallbackPoll);
      }
    };
  }, [selectedThreadId, user?.id]);

  const createThreadMutation = useMutation({
    mutationFn: async (payload: { identifier: string; targetLanguage?: string | null }) => {
      const res = await apiRequest("POST", "/api/personal-chats", {
        identifier: payload.identifier,
        sourceLanguage: myLanguage,
        targetLanguage: payload.targetLanguage || "en",
      });
      return res.json() as Promise<{ thread: PersonalThreadSummary }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/personal-chats"] });
      setSelectedThreadId(data.thread.id);
    },
    onError: () => {
      toast({
        title: "Chat unavailable",
        description: "This contact is not yet available on Neura Talk for personal chat.",
        variant: "destructive",
      });
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: async ({
      threadId,
      content,
      messageType,
      attachmentUrl,
      attachmentTitle,
    }: {
      threadId: number;
      content: string;
      messageType?: "text" | "voice_note" | "attachment";
      attachmentUrl?: string | null;
      attachmentTitle?: string | null;
    }) => {
      const clientMessageId = createClientMessageId();
      const res = await apiRequest("POST", `/api/personal-chats/${threadId}/messages`, {
        content,
        originalLanguage: myLanguage,
        clientMessageId,
        messageType: messageType || "text",
        attachmentUrl,
        attachmentTitle,
      });
      const data = await res.json() as { message: PersonalThreadMessage };
      return {
        ...data,
        clientMessageId,
        threadId,
      };
    },
    onMutate: async ({ threadId, content, messageType, attachmentUrl, attachmentTitle }) => {
      const lastMessagePreview = buildOptimisticThreadPreview(messageType, content, attachmentTitle);
      const optimisticMessage: PendingPersonalThreadMessage = {
        id: -Date.now(),
        senderUserId: Number(user?.id || 0),
        messageType: messageType || "text",
        originalContent: content,
        originalLanguage: myLanguage,
        translatedContent: null,
        displayContent: content,
        displayLanguage: myLanguage,
        showingTranslated: false,
        isOwn: true,
        deliveryStatus: "sending",
        attachmentUrl: attachmentUrl || null,
        attachmentTitle: attachmentTitle || null,
        deliveredAt: null,
        seenAt: null,
        createdAt: new Date().toISOString(),
        isPending: true,
      };

      setOptimisticMessages((current) => ({
        ...current,
        [threadId]: [...(current[threadId] || []), optimisticMessage],
      }));

      queryClient.setQueryData<{ threads: PersonalThreadSummary[] }>(["/api/personal-chats"], (current) => {
        if (!current) return current;
        return {
          threads: reorderThreadsWithPatch(current.threads, threadId, {
            lastMessagePreview,
            lastMessageAt: optimisticMessage.createdAt,
          }),
        };
      });

      return { threadId, optimisticMessageId: optimisticMessage.id };
    },
    onSuccess: async (data, _variables, context) => {
      setMessageInput("");
      if (context?.threadId) {
        setOptimisticMessages((current) => ({
          ...current,
          [context.threadId]: (current[context.threadId] || []).filter((message) => message.id !== context.optimisticMessageId),
        }));
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/personal-chats"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/personal-chats", selectedThreadId] }),
      ]);
    },
    onError: (_error, variables, context) => {
      if (context?.threadId) {
        setOptimisticMessages((current) => ({
          ...current,
          [context.threadId]: (current[context.threadId] || []).filter((message) => message.id !== context.optimisticMessageId),
        }));
      }
      toast({
        title: "Message failed",
        description: "Could not send this personal message. Try again.",
        variant: "destructive",
      });
    },
  });

  const filteredContacts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return contacts;
    return contacts.filter((contact) =>
      contact.name.toLowerCase().includes(query)
      || contact.identifier.toLowerCase().includes(query)
      || (contact.language || "").toLowerCase().includes(query),
    );
  }, [contacts, search]);

  const discoveryResults = discoverQuery.data?.results || [];

  const activeThread = selectedThread.data?.thread || null;
  const serverMessages = selectedThread.data?.messages || [];
  const activeMessages = selectedThreadId
    ? [...serverMessages, ...(optimisticMessages[selectedThreadId] || [])]
    : serverMessages;

  const toggleOriginal = (messageId: number) => {
    setOriginalVisibleIds((current) =>
      current.includes(messageId)
        ? current.filter((id) => id !== messageId)
        : [...current, messageId],
    );
  };

  const handleSendMessage = async () => {
    if (!selectedThreadId || !messageInput.trim() || sendMessageMutation.isPending) {
      return;
    }
    await sendMessageMutation.mutateAsync({
      threadId: selectedThreadId,
      content: messageInput.trim(),
    });
    await apiRequest("POST", `/api/personal-chats/${selectedThreadId}/typing`, { isTyping: false }).catch(() => undefined);
  };

  const handleAttachmentPick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!selectedThreadId || !file) return;

    setUploadIntent("attachment");
    const upload = await uploadFile(file);
    if (!upload) {
      setUploadIntent(null);
      return;
    }

    await sendMessageMutation.mutateAsync({
      threadId: selectedThreadId,
      content: file.name,
      messageType: "attachment",
      attachmentTitle: file.name,
      attachmentUrl: upload.objectPath,
    });
    setUploadIntent(null);
  };

  const handleVoiceNote = async () => {
    if (!selectedThreadId) return;

    if (recorderState !== "recording") {
      try {
        await startRecording();
      } catch {
        toast({
          title: "Microphone unavailable",
          description: "Allow microphone access to record a voice note.",
          variant: "destructive",
        });
      }
      return;
    }

    const blob = await stopRecording();
    if (!blob || blob.size === 0) {
      toast({
        title: "Voice note empty",
        description: "Nothing was recorded. Try again.",
        variant: "destructive",
      });
      return;
    }

    const file = new File([blob], `voice-note-${Date.now()}.webm`, { type: blob.type || "audio/webm" });
    setUploadIntent("voice_note");
    const upload = await uploadFile(file);
    if (!upload) {
      setUploadIntent(null);
      return;
    }

    await sendMessageMutation.mutateAsync({
      threadId: selectedThreadId,
      content: "Voice note",
      messageType: "voice_note",
      attachmentTitle: file.name,
      attachmentUrl: upload.objectPath,
    });
    setUploadIntent(null);
  };

  const handleOpenContact = async (identifier: string, targetLanguage?: string | null) => {
    const existing = threads.find((thread) => thread.peer.identifier === identifier);
    if (existing) {
      setSelectedThreadId(existing.id);
      return;
    }
    await createThreadMutation.mutateAsync({ identifier, targetLanguage });
  };

  const handleTypingChange = async (value: string) => {
    setMessageInput(value);
    if (!selectedThreadId) return;

    await apiRequest("POST", `/api/personal-chats/${selectedThreadId}/typing`, { isTyping: value.trim().length > 0 }).catch(() => undefined);

    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = window.setTimeout(() => {
      void apiRequest("POST", `/api/personal-chats/${selectedThreadId}/typing`, { isTyping: false }).catch(() => undefined);
    }, 2500);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-md">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href="/dashboard">
              <Button variant="ghost" size="icon" data-testid="button-back">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setSidebarOpen((open) => !open)}
              data-testid="button-toggle-sidebar"
            >
              <Menu className="w-5 h-5" />
            </Button>
            <div className="flex items-center gap-2">
              <MessageCircleMore className="w-5 h-5 text-primary" />
              <div>
                <h1 className="text-lg font-semibold">Personal Chat</h1>
                <p className="text-xs text-muted-foreground">App-to-app multilingual messaging</p>
              </div>
            </div>
          </div>
          <Badge variant="secondary" className="gap-1">
            <Languages className="w-3.5 h-3.5" />
            Auto-translate both ways
          </Badge>
        </div>
      </header>

      <div className="flex h-[calc(100vh-57px)]">
        {sidebarOpen ? (
          <aside className="w-[320px] max-w-full border-r bg-muted/20 flex flex-col">
            <div className="p-4 border-b space-y-3">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search contacts..."
                  className="pl-9"
                  data-testid="input-search-chat-contacts"
                />
              </div>
              <div className="text-xs text-muted-foreground">
                Messages are stored with original text plus translated copies for the receiver language.
              </div>
            </div>

            <ScrollArea className="flex-1">
              <div className="p-3 space-y-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground mb-2 px-2">
                    Recent Chats
                  </p>
                  {loadingThreads ? (
                    <div className="flex justify-center py-6">
                      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : threads.length === 0 ? (
                    <Card>
                      <CardContent className="py-6 text-center text-sm text-muted-foreground">
                        No personal chats yet. Start with a contact below.
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="space-y-2">
                      {threads.map((thread) => (
                        <button
                          key={thread.id}
                          onClick={() => setSelectedThreadId(thread.id)}
                          className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                            selectedThreadId === thread.id ? "border-primary/40 bg-primary/10" : "border-white/5 bg-background/60 hover:bg-white/5"
                          }`}
                          data-testid={`thread-${thread.id}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-medium truncate">{thread.peer.displayName}</div>
                            {thread.unreadCount > 0 ? (
                              <Badge className="h-5 px-2">{thread.unreadCount}</Badge>
                            ) : null}
                          </div>
                          <div className="text-xs text-muted-foreground truncate mt-1">
                            {thread.lastMessagePreview || "No messages yet"}
                          </div>
                          <div className="text-[10px] text-muted-foreground/70 mt-2 flex items-center gap-2">
                            <span>{normalizeLanguageLabel(thread.viewerLanguage)}</span>
                            <span>to</span>
                            <span>{normalizeLanguageLabel(thread.peerLanguage)}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground mb-2 px-2">
                    Contacts
                  </p>
                  {contactsLoading ? (
                    <div className="flex justify-center py-6">
                      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : filteredContacts.length === 0 ? (
                    <Card>
                      <CardContent className="py-6 text-center text-sm text-muted-foreground">
                        No contacts available for chat.
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="space-y-2">
                      {filteredContacts.map((contact) => (
                        <button
                          key={contact.id}
                          onClick={() => {
                            if (contact.hasApp === false) {
                              toast({
                                title: "Chat needs Neura Talk on both sides",
                                description: "This contact looks like a phone/PSTN contact. Personal chat is available only for app users.",
                                variant: "destructive",
                              });
                              return;
                            }
                            void handleOpenContact(contact.appPreferredIdentifier || contact.identifier, contact.language);
                          }}
                          className="w-full rounded-xl border border-white/5 bg-background/60 hover:bg-white/5 px-3 py-3 text-left transition"
                          data-testid={`contact-chat-${contact.id}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-medium truncate">{contact.name}</div>
                            <div className="flex items-center gap-2">
                              <Badge variant={contact.hasApp === false ? "outline" : "secondary"}>
                                {contact.hasApp === false ? "PSTN" : "App"}
                              </Badge>
                              {contact.isFavorite ? <Badge variant="secondary">Fav</Badge> : null}
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground truncate mt-1">
                            {contact.identifier}
                          </div>
                          <div className="text-[10px] text-muted-foreground/70 mt-2">
                            Receiver language: {normalizeLanguageLabel(contact.language)}
                          </div>
                          <div className="text-[10px] text-muted-foreground/70 mt-1">
                            {contact.hasApp === false ? "Messaging unavailable until they use Neura Talk." : "Ready for app-to-app multilingual chat."}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {search.trim().length >= 2 ? (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground mb-2 px-2">
                      Discover Neura Talk Users
                    </p>
                    {discoverQuery.isLoading ? (
                      <div className="flex justify-center py-4">
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                      </div>
                    ) : discoveryResults.length === 0 ? (
                      <Card>
                        <CardContent className="py-4 text-center text-sm text-muted-foreground">
                          No direct app users found for this search yet.
                        </CardContent>
                      </Card>
                    ) : (
                      <div className="space-y-2">
                        {discoveryResults.map((result) => (
                          <button
                            key={result.id}
                            onClick={() => handleOpenContact(result.identifier, "en")}
                            className="w-full rounded-xl border border-white/5 bg-background/60 hover:bg-white/5 px-3 py-3 text-left transition"
                            data-testid={`discover-user-${result.id}`}
                          >
                            <div className="font-medium truncate">{result.displayName}</div>
                            <div className="text-xs text-muted-foreground truncate mt-1">
                              {result.identifier}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </ScrollArea>
          </aside>
        ) : null}

        <main className="flex-1 flex flex-col">
          {!activeThread ? (
            <div className="flex-1 flex items-center justify-center p-6">
              <Card className="w-full max-w-xl">
                <CardHeader>
                  <CardTitle>Start a real multilingual chat</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  <p>Choose a contact and Neura Talk will store the original message plus a translated copy for the other side.</p>
                  <p>Incoming messages default to your language, and you can still reveal the original wording when needed.</p>
                </CardContent>
              </Card>
            </div>
          ) : (
            <>
              <div className="border-b px-4 py-3 bg-background/70 backdrop-blur-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{activeThread.peer.displayName}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2 mt-1">
                      <span>{activeThread.peer.identifier || activeThread.peer.phone || activeThread.peer.email || activeThread.peer.username}</span>
                      <span>•</span>
                      <span>{normalizeLanguageLabel(activeThread.viewerLanguage)} to {normalizeLanguageLabel(activeThread.peerLanguage)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {activeThread.peer.identifier ? (
                      <>
                        <a
                          href={`/calls/c2c?identifier=${encodeURIComponent(activeThread.peer.identifier)}&theirLanguage=${encodeURIComponent(activeThread.peer.contactLanguage || activeThread.peerLanguage || "en")}&mode=voice`}
                        >
                          <Button variant="outline" size="sm" className="gap-2" data-testid="button-chat-voice-call">
                            <Phone className="w-4 h-4" />
                            Voice
                          </Button>
                        </a>
                        <a
                          href={`/calls/c2c?identifier=${encodeURIComponent(activeThread.peer.identifier)}&theirLanguage=${encodeURIComponent(activeThread.peer.contactLanguage || activeThread.peerLanguage || "en")}&mode=video`}
                        >
                          <Button variant="outline" size="sm" className="gap-2" data-testid="button-chat-video-call">
                            <Video className="w-4 h-4" />
                            Video
                          </Button>
                        </a>
                      </>
                    ) : null}
                    <Badge variant="outline" className="gap-1">
                      <Languages className="w-3 h-3" />
                      Incoming auto-translated
                    </Badge>
                    {presenceQuery.data?.isRecentlyActive ? (
                      <Badge variant="secondary">
                        {presenceQuery.data.isTyping ? "Typing..." : "Active"}
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </div>

              <ScrollArea className="flex-1 p-4">
                <div className="max-w-3xl mx-auto space-y-4">
                  {selectedThread.isLoading ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : activeMessages.length === 0 ? (
                    <Card>
                      <CardContent className="py-12 text-center text-muted-foreground">
                        <UserRound className="w-10 h-10 mx-auto mb-3 opacity-50" />
                        <p>No messages yet. Start the conversation naturally.</p>
                      </CardContent>
                    </Card>
                  ) : (
                    activeMessages.map((message) => {
                      const showingOriginal = originalVisibleIds.includes(message.id);
                      const showToggle = !message.isOwn && Boolean(message.translatedContent);
                      const primaryContent = showingOriginal ? message.originalContent : message.displayContent;
                      const secondaryContent = showToggle
                        ? (showingOriginal ? message.translatedContent : message.originalContent)
                        : null;

                      return (
                        <div key={message.id} className={message.isOwn ? "flex flex-col items-end" : "flex flex-col items-start"}>
                          <ChatMessage
                            role={message.isOwn ? "user" : "assistant"}
                            content={primaryContent}
                            secondaryContent={secondaryContent}
                            timestamp={new Date(message.createdAt)}
                            status={message.isOwn ? formatDeliveryStatus(message.deliveryStatus) : null}
                            attachmentTitle={message.attachmentTitle}
                            attachmentUrl={message.attachmentUrl}
                            messageType={message.messageType}
                          />
                          {showToggle ? (
                            <button
                              type="button"
                              className="text-[11px] text-primary hover:underline mt-1 px-2"
                              onClick={() => toggleOriginal(message.id)}
                              data-testid={`button-toggle-original-${message.id}`}
                            >
                              {showingOriginal ? "Show my-language translation" : `Show original (${normalizeLanguageLabel(message.originalLanguage)})`}
                            </button>
                          ) : null}
                          {message.isOwn ? (
                            <div className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1 px-2">
                              {message.deliveryStatus === "seen" ? <CheckCheck className="w-3 h-3" /> : <Check className="w-3 h-3" />}
                              <span>{formatDeliveryStatus(message.deliveryStatus)}</span>
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                  {presenceQuery.data?.isTyping ? <TypingIndicator /> : null}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>

              <div className="border-t bg-background/80 backdrop-blur-md p-4">
                <div className="max-w-3xl mx-auto flex gap-2">
                  <input
                    ref={attachmentInputRef}
                    type="file"
                    className="hidden"
                    onChange={(event) => void handleAttachmentPick(event)}
                    data-testid="input-personal-chat-attachment"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => attachmentInputRef.current?.click()}
                    disabled={!selectedThreadId || isUploadingAttachment || sendMessageMutation.isPending}
                    data-testid="button-attach-personal-chat"
                  >
                    {isUploadingAttachment ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
                  </Button>
                  <Button
                    type="button"
                    variant={recorderState === "recording" ? "destructive" : "outline"}
                    onClick={() => void handleVoiceNote()}
                    disabled={!selectedThreadId || isUploadingAttachment || sendMessageMutation.isPending}
                    data-testid="button-record-personal-chat"
                  >
                    <Mic className="w-4 h-4" />
                  </Button>
                  <Input
                    value={messageInput}
                    onChange={(event) => void handleTypingChange(event.target.value)}
                    placeholder="Type your message with emojis, slang, or mixed language..."
                    disabled={sendMessageMutation.isPending || isUploadingAttachment}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void handleSendMessage();
                      }
                    }}
                    data-testid="input-personal-chat-message"
                  />
                  <Button
                    onClick={() => void handleSendMessage()}
                    disabled={!messageInput.trim() || sendMessageMutation.isPending || isUploadingAttachment}
                    data-testid="button-send-personal-chat"
                  >
                    {sendMessageMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </Button>
                </div>
                {recorderState === "recording" ? (
                  <div className="max-w-3xl mx-auto mt-2 text-xs text-muted-foreground">
                    Recording voice note... tap the mic again to send.
                  </div>
                ) : null}
                {isUploadingAttachment ? (
                  <div className="max-w-3xl mx-auto mt-2 text-xs text-muted-foreground">
                    {uploadIntent === "voice_note" ? "Uploading voice note" : "Uploading attachment"}... {uploadProgress}%
                  </div>
                ) : null}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
