import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  ArrowLeft, Check, CheckCheck, CircleDashed, Clock, CreditCard, Download, FileText, Globe2, LayoutDashboard, Loader2, LogOut,
  MapPin, MessageCircle, Moon, Paperclip, Phone, Radio, Search, Send, Settings, Sun, Users, UsersRound, Video,
} from "lucide-react";
import { getAuthToken, useAuth } from "@/hooks/use-auth";
import { useUpload } from "@/hooks/use-upload";
import { useToast } from "@/hooks/use-toast";
import { ChatExtrasWeb, isSpecialMessage, type WebContact, type WebPoll } from "@/components/ChatExtrasWeb";
import { cn } from "@/lib/utils";

/**
 * NeuraTalk Web — the WhatsApp-Web-style desktop app: an icon rail, the chat
 * list (people + groups), the open conversation, updates/channels and
 * communities. Uses the same endpoints as the phone app.
 */

// ---------------------------------------------------------------- helpers
async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken() ?? ""}`, ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || data?.message || `Request failed (${res.status})`);
  return data as T;
}

function useAuthBlob(path: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path || !path.startsWith("/objects/")) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    fetch(path, { headers: { Authorization: `Bearer ${getAuthToken() ?? ""}` } })
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then((b) => { if (!cancelled) { objectUrl = URL.createObjectURL(b); setUrl(objectUrl); } })
      .catch(() => undefined);
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [path]);
  return url;
}

const PALETTE = ["bg-blue-500", "bg-emerald-500", "bg-orange-500", "bg-violet-500", "bg-cyan-600", "bg-pink-500"];
function Avatar({ name, src, size = 44 }: { name: string; src?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
  const color = PALETTE[Math.abs(name.split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % PALETTE.length];
  return src && !failed ? (
    <img src={src} alt="" onError={() => setFailed(true)} className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} />
  ) : (
    <div className={cn("rounded-full text-white flex items-center justify-center font-semibold shrink-0", color)} style={{ width: size, height: size, fontSize: size * 0.38 }}>{initials}</div>
  );
}

function clock(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function listTime(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const days = Math.floor((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
  if (days === 0) return clock(iso);
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { day: "numeric", month: "numeric", year: "2-digit" });
}
function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
function lastSeen(iso: string) {
  const d = new Date(iso);
  const days = Math.floor((new Date(new Date().toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
  if (days === 0) return `last seen today at ${clock(iso)}`;
  if (days === 1) return `last seen yesterday at ${clock(iso)}`;
  return `last seen ${d.toLocaleDateString([], { day: "numeric", month: "short" })}`;
}
function dayLabel(iso: string) {
  const d = new Date(iso);
  const days = Math.floor((new Date(new Date().toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" });
}

type Section = "chats" | "updates" | "communities" | "settings";
type ChatRef = { kind: "personal" | "group"; id: number };

type Thread = {
  id: number; unreadCount?: number; lastMessagePreview?: string | null; lastMessageAt?: string | null; isPinned?: boolean; isArchived?: boolean;
  peer: { id: number; displayName: string; avatarUrl?: string | null; phone?: string | null };
};
type Group = { id: number; name: string; avatarUrl?: string | null; updatedAt?: string; members?: Array<{ userId: number; role: string }>; onlyAdminsSend?: boolean;
  lastMessage?: { preview: string; createdAt: string; isMine: boolean } | null };

type Msg = {
  id: number | string; isOwn: boolean; createdAt: string; messageType?: string; deliveryStatus?: string;
  text: string; original?: string | null; senderName?: string | null;
  attachmentUrl?: string | null; attachmentTitle?: string | null; attachmentMime?: string | null; attachmentSize?: number | null;
  poll?: WebPoll | null; contact?: WebContact | null; viewOnce?: boolean; viewOnceOpened?: boolean; isDeleted?: boolean;
};

// ---------------------------------------------------------------- page
export default function WebAppPage() {
  const { user, logout } = useAuth();
  const [section, setSection] = useState<Section>("chats");
  const [open, setOpen] = useState<ChatRef | null>(null);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    try { localStorage.setItem("theme", next ? "dark" : "light"); } catch { /* not saved */ }
    document.documentElement.classList.toggle("dark", next);
    window.dispatchEvent(new Event("neuratalk-theme-change"));
  };

  const rail: Array<{ id: Section; label: string; icon: ReactNode }> = [
    { id: "chats", label: "Chats", icon: <MessageCircle className="w-5 h-5" /> },
    { id: "updates", label: "Updates and channels", icon: <CircleDashed className="w-5 h-5" /> },
    { id: "communities", label: "Communities", icon: <UsersRound className="w-5 h-5" /> },
  ];

  return (
    <div className="h-[100dvh] w-full flex bg-muted/40 text-foreground overflow-hidden" data-testid="neuratalk-web">
      {/* Icon rail (hidden on phones; tabs at the top instead) */}
      <nav className="hidden md:flex w-16 flex-col items-center justify-between py-3 border-r bg-background" aria-label="Sections">
        <div className="flex flex-col items-center gap-1">
          {rail.map((r) => (
            <button key={r.id} type="button" title={r.label} aria-label={r.label} onClick={() => setSection(r.id)} data-testid={`rail-${r.id}`}
              className={cn("w-11 h-11 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted", section === r.id && "bg-muted text-foreground")}>
              {r.icon}
            </button>
          ))}
          <Link href="/calls/c2c" title="Calls" aria-label="Calls" className="w-11 h-11 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted"><Phone className="w-5 h-5" /></Link>
        </div>
        <div className="flex flex-col items-center gap-1">
          <button type="button" title={dark ? "Light mode" : "Dark mode"} aria-label="Switch theme" onClick={toggleTheme} className="w-11 h-11 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted">
            {dark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
          <button type="button" title="Settings" aria-label="Settings" onClick={() => setSection("settings")} data-testid="rail-settings"
            className={cn("w-11 h-11 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted", section === "settings" && "bg-muted text-foreground")}>
            <Settings className="w-5 h-5" />
          </button>
          <button type="button" onClick={() => setSection("settings")} aria-label="My profile">
            <Avatar name={user?.displayName || user?.username || "Me"} src={(user as any)?.avatarUrl} size={34} />
          </button>
        </div>
      </nav>

      {/* Left column */}
      <aside className={cn("w-full md:w-[380px] lg:w-[420px] flex-col border-r bg-background", open && section === "chats" ? "hidden md:flex" : "flex")}>
        <div className="md:hidden flex border-b">
          {[...rail, { id: "settings" as Section, label: "Settings", icon: <Settings className="w-5 h-5" /> }].map((r) => (
            <button key={r.id} type="button" onClick={() => setSection(r.id)} className={cn("flex-1 py-3 flex justify-center text-muted-foreground", section === r.id && "text-primary border-b-2 border-primary")} aria-label={r.label}>{r.icon}</button>
          ))}
        </div>
        {section === "chats" && <ChatList open={open} onOpen={setOpen} />}
        {section === "updates" && <UpdatesPane />}
        {section === "communities" && <CommunitiesPane onOpenGroup={(id) => { setSection("chats"); setOpen({ kind: "group", id }); }} />}
        {section === "settings" && <SettingsPane onLogout={logout} dark={dark} onToggleTheme={toggleTheme} />}
      </aside>

      {/* Conversation */}
      <main className={cn("flex-1 min-w-0 flex-col", open && section === "chats" ? "flex" : "hidden md:flex")}>
        {open && section === "chats" ? (
          <Conversation key={`${open.kind}-${open.id}`} chat={open} onBack={() => setOpen(null)} />
        ) : (
          <EmptyState />
        )}
      </main>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-8 bg-muted/30" data-testid="web-empty">
      <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-6"><Globe2 className="w-10 h-10 text-primary" /></div>
      <h1 className="text-3xl font-light mb-3">NeuraTalk Web</h1>
      <p className="text-muted-foreground max-w-md">
        Send and receive messages on your computer. Everyone reads in their own language.
        Your phone doesn't need to stay online.
      </p>
      <p className="text-xs text-muted-foreground mt-10 flex items-center gap-1">
        <Clock className="w-3.5 h-3.5" /> Sign this computer out any time from your phone: More → Linked devices.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- chat list
function ChatList({ open, onOpen }: { open: ChatRef | null; onOpen: (c: ChatRef) => void }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "unread" | "groups">("all");
  const threads = useQuery<{ threads: Thread[] }>({ queryKey: ["web", "threads"], queryFn: () => api("/api/personal-chats"), refetchInterval: 4000 });
  const groups = useQuery<Group[]>({ queryKey: ["web", "groups"], queryFn: () => api("/api/group-chats/my-groups"), refetchInterval: 10000 });

  const items = useMemo(() => {
    const people = (threads.data?.threads ?? []).filter((t) => !t.isArchived).map((t) => ({
      key: `p${t.id}`, ref: { kind: "personal" as const, id: t.id }, name: t.peer?.displayName || "NeuraTalk user", avatar: t.peer?.avatarUrl,
      preview: t.lastMessagePreview ?? "", time: t.lastMessageAt ?? null, unread: t.unreadCount ?? 0, pinned: Boolean(t.isPinned), isGroup: false,
    }));
    const gs = (Array.isArray(groups.data) ? groups.data : []).map((g) => ({
      key: `g${g.id}`, ref: { kind: "group" as const, id: g.id }, name: g.name, avatar: g.avatarUrl,
      preview: g.lastMessage ? `${g.lastMessage.isMine ? "You: " : ""}${g.lastMessage.preview}` : plural(g.members?.length ?? 0, "member"),
      time: g.lastMessage?.createdAt ?? g.updatedAt ?? null, unread: 0, pinned: false, isGroup: true,
    }));
    const all = [...people, ...gs]
      .filter((i) => filter === "all" || (filter === "unread" ? i.unread > 0 : i.isGroup))
      .filter((i) => !q.trim() || `${i.name} ${i.preview}`.toLowerCase().includes(q.trim().toLowerCase()));
    return all.sort((a, b) => (a.pinned === b.pinned ? new Date(b.time ?? 0).getTime() - new Date(a.time ?? 0).getTime() : a.pinned ? -1 : 1));
  }, [threads.data, groups.data, q, filter]);

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="px-4 pt-4 pb-2">
        <h2 className="text-xl font-bold mb-3">Chats</h2>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search or start a new chat" data-testid="web-search"
            className="w-full rounded-lg bg-muted pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40" />
        </div>
        <div className="flex gap-2 mt-3">
          {(["all", "unread", "groups"] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)} data-testid={`web-filter-${f}`}
              className={cn("px-3 py-1 rounded-full text-sm", filter === f ? "bg-primary/15 text-primary font-medium" : "bg-muted text-muted-foreground hover:bg-muted/70")}>
              {f === "all" ? "All" : f === "unread" ? "Unread" : "Groups"}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto" data-testid="web-chat-list">
        {threads.isLoading && <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}
        {!threads.isLoading && items.length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-10 px-6">{q ? `No chats match "${q}"` : filter === "unread" ? "No unread chats" : "No chats yet. Start one from the NeuraTalk app."}</p>
        )}
        {items.map((i) => {
          const active = open?.kind === i.ref.kind && open.id === i.ref.id;
          return (
            <button key={i.key} type="button" onClick={() => onOpen(i.ref)} data-testid={`web-chat-${i.key}`}
              className={cn("w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/60", active && "bg-muted")}>
              <Avatar name={i.name} src={i.avatar} size={48} />
              <div className="flex-1 min-w-0 border-b border-border/60 pb-2.5 -mb-2.5">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium truncate flex-1">{i.name}</span>
                  <span className={cn("text-xs shrink-0", i.unread ? "text-primary font-semibold" : "text-muted-foreground")}>{listTime(i.time)}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  {i.isGroup && <Users className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                  <span className="text-sm text-muted-foreground truncate flex-1">{i.preview || " "}</span>
                  {i.unread > 0 && <span className="min-w-5 h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold flex items-center justify-center">{i.unread}</span>}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- conversation
function Conversation({ chat, onBack }: { chat: ChatRef; onBack: () => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isGroup = chat.kind === "group";
  const base = isGroup ? `/api/group-chats/${chat.id}` : `/api/personal-chats/${chat.id}`;
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [showOriginal, setShowOriginal] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const { uploadFile, isUploading } = useUpload();

  const detail = useQuery<any>({
    queryKey: ["web", "conv", chat.kind, chat.id],
    queryFn: async () => (isGroup ? { group: await api(base), messages: await api(`${base}/messages?limit=200`) } : api(base)),
    refetchInterval: isGroup ? 3000 : 2000,
  });
  const presence = useQuery<any>({
    queryKey: ["web", "presence", chat.id],
    queryFn: () => api(`${base}/presence`),
    enabled: !isGroup,
    refetchInterval: 5000,
  });

  const title = isGroup ? detail.data?.group?.name ?? "Group" : detail.data?.thread?.peer?.displayName ?? "Chat";
  const avatar = isGroup ? detail.data?.group?.avatarUrl : detail.data?.thread?.peer?.avatarUrl;
  const members: Array<{ userId: number; role: string }> = detail.data?.group?.members ?? [];
  const myRole = members.find((m) => m.userId === user?.id)?.role;
  const readOnly = isGroup && detail.data?.group?.onlyAdminsSend === true && myRole !== "admin";

  const messages: Msg[] = useMemo(() => {
    if (!detail.data) return [];
    if (isGroup) {
      const rows = Array.isArray(detail.data.messages) ? detail.data.messages : [];
      return rows.map((m: any) => ({
        id: m.id, isOwn: m.senderId === user?.id, createdAt: m.createdAt, messageType: m.messageType,
        text: m.displayContent ?? m.originalContent ?? "", original: m.displayContent !== m.originalContent ? m.originalContent : null,
        senderName: m.sender?.username ?? null, attachmentUrl: m.attachmentUrl, attachmentTitle: m.attachmentTitle, attachmentMime: m.attachmentMime,
        attachmentSize: m.attachmentSize, poll: m.poll, contact: m.contact, viewOnce: m.viewOnce, viewOnceOpened: m.viewOnceOpened,
      }));
    }
    return (detail.data.messages ?? []).map((m: any) => ({
      id: m.id, isOwn: m.isOwn, createdAt: m.createdAt, messageType: m.messageType, deliveryStatus: m.deliveryStatus,
      text: m.displayContent ?? m.originalContent ?? "", original: m.showingTranslated ? m.originalContent : null,
      attachmentUrl: m.attachmentUrl, attachmentTitle: m.attachmentTitle, attachmentMime: m.attachmentMime, attachmentSize: m.attachmentSize,
      poll: m.poll, contact: m.contact, viewOnce: m.viewOnce, viewOnceOpened: m.viewOnceOpened, isDeleted: m.isDeleted,
    }));
  }, [detail.data, isGroup, user?.id]);

  // Read receipts for 1:1 chats.
  const lastIncoming = messages.filter((m) => !m.isOwn).at(-1)?.id;
  useEffect(() => {
    if (!isGroup && lastIncoming) api(`${base}/seen`, { method: "POST", body: "{}" }).then(() => qc.invalidateQueries({ queryKey: ["web", "threads"] })).catch(() => undefined);
  }, [lastIncoming, isGroup, base, qc]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages.length]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["web", "conv", chat.kind, chat.id] });

  const send = async (body: Record<string, unknown>) => {
    setSending(true);
    try {
      await api(`${base}/messages`, { method: "POST", body: JSON.stringify(isGroup ? body : { clientMessageId: `${Date.now()}`, ...body }) });
      refresh();
      qc.invalidateQueries({ queryKey: ["web", "threads"] });
      return true;
    } catch (e) {
      toast({ title: "Not sent", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
      return false;
    } finally {
      setSending(false);
    }
  };

  const sendText = async () => {
    const t = text.trim();
    if (!t || sending) return;
    if (await send({ content: t, messageType: "text" })) setText("");
  };

  const sendFile = async (file: File) => {
    const up = await uploadFile(file);
    if (!up) return toast({ title: "Upload failed", description: "Try again.", variant: "destructive" });
    const isImage = (file.type || "").startsWith("image/");
    await send({
      content: isImage ? "Photo" : file.name, messageType: isImage ? "attachment" : "file",
      attachmentUrl: up.objectPath, attachmentTitle: file.name.slice(0, 240), attachmentSize: file.size, attachmentMime: file.type || undefined,
    });
  };

  const status = isGroup
    ? plural(members.length, "member")
    : presence.data?.isTyping ? "typing…" : presence.data?.isRecentlyActive ? "online" : presence.data?.lastActiveAt ? lastSeen(presence.data.lastActiveAt) : "";

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="web-conversation">
      <header className="h-16 px-4 flex items-center gap-3 border-b bg-background">
        <button type="button" onClick={onBack} className="md:hidden" aria-label="Back"><ArrowLeft className="w-5 h-5" /></button>
        <Avatar name={title} src={avatar} size={40} />
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate" data-testid="web-conv-title">{title}</p>
          <p className={cn("text-xs truncate", status === "typing…" ? "text-primary" : "text-muted-foreground")}>{status}</p>
        </div>
        {!isGroup && detail.data?.thread?.peer && (
          <>
            <Link href={`/calls/c2c?identifier=${encodeURIComponent(detail.data.thread.peer.identifier ?? "")}&mode=video`} aria-label="Video call" className="p-2 rounded-full hover:bg-muted text-muted-foreground"><Video className="w-5 h-5" /></Link>
            <Link href={`/calls/c2c?identifier=${encodeURIComponent(detail.data.thread.peer.identifier ?? "")}&mode=voice`} aria-label="Voice call" className="p-2 rounded-full hover:bg-muted text-muted-foreground"><Phone className="w-5 h-5" /></Link>
          </>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-[4%] py-4 bg-[radial-gradient(hsl(var(--muted))_1px,transparent_1px)] [background-size:18px_18px]" data-testid="web-messages">
        {detail.isLoading && <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
          const showName = isGroup && !m.isOwn && (newDay || prev?.senderName !== m.senderName);
          const key = String(m.id);
          return (
            <div key={key}>
              {newDay && <div className="flex justify-center my-3"><span className="text-xs bg-background/90 shadow-sm rounded-md px-3 py-1 text-muted-foreground">{dayLabel(m.createdAt)}</span></div>}
              <div className={cn("flex mb-1", m.isOwn ? "justify-end" : "justify-start")}>
                {isSpecialMessage(m) ? (
                  <div className={cn("max-w-[75%] flex flex-col", m.messageType === "sticker" ? "" : "w-80", m.isOwn ? "items-end" : "items-start")}>
                    {showName && <p className="text-xs font-semibold text-primary mb-0.5">{m.senderName}</p>}
                    <ChatExtrasWeb message={m} apiBase={base} isOwn={m.isOwn} question={m.poll ? m.text : undefined} onChanged={refresh} />
                    <span className="text-[10.5px] text-muted-foreground mt-0.5 px-1">{clock(m.createdAt)}</span>
                  </div>
                ) : (
                  <div className={cn("max-w-[70%] rounded-lg px-2.5 pt-1.5 pb-1 shadow-sm text-sm", m.isOwn ? "bg-primary/15 dark:bg-primary/25 rounded-tr-none" : "bg-background rounded-tl-none")} data-testid={`web-msg-${key}`}>
                    {showName && <p className="text-xs font-semibold text-primary">{m.senderName}</p>}
                    <Body m={m} />
                    {m.original && !m.isDeleted && (
                      <button type="button" className="block text-[11px] text-primary mt-0.5" onClick={() => setShowOriginal((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; })}>
                        {showOriginal.has(key) ? m.original : "Translated · show original"}
                      </button>
                    )}
                    <span className="float-right ml-3 mt-1 text-[10.5px] text-muted-foreground flex items-center gap-0.5">
                      {clock(m.createdAt)}
                      {m.isOwn && !isGroup && (m.deliveryStatus === "seen" ? <CheckCheck className="w-3.5 h-3.5 text-sky-500" /> : m.deliveryStatus === "delivered" ? <CheckCheck className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />)}
                    </span>
                    <span className="clear-both block" />
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {readOnly ? (
        <div className="px-4 py-4 text-center text-sm text-muted-foreground border-t bg-background">Only admins can send messages</div>
      ) : (
        <form className="px-3 py-2 flex items-end gap-2 border-t bg-background" onSubmit={(e) => { e.preventDefault(); void sendText(); }}>
          <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void sendFile(f); }} />
          <button type="button" aria-label="Attach" onClick={() => fileRef.current?.click()} disabled={isUploading || sending} className="p-2.5 rounded-full hover:bg-muted text-muted-foreground disabled:opacity-50" data-testid="web-attach">
            {isUploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Paperclip className="w-5 h-5" />}
          </button>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} placeholder="Type a message" data-testid="web-composer"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendText(); } }}
            className="flex-1 resize-none max-h-40 rounded-lg bg-muted px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/40" />
          <button type="submit" aria-label="Send" disabled={!text.trim() || sending} className="p-2.5 rounded-full bg-primary text-primary-foreground disabled:opacity-40" data-testid="web-send">
            {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </button>
        </form>
      )}
    </div>
  );
}

function Body({ m }: { m: Msg }) {
  if (m.isDeleted) return <p className="italic text-muted-foreground">This message was deleted</p>;
  const type = m.messageType;
  if (type === "location" && m.attachmentUrl?.startsWith("geo:")) {
    const [lat, lng] = m.attachmentUrl.slice(4).split(",");
    return <a className="flex items-center gap-1 text-primary underline" href={`https://www.google.com/maps?q=${lat},${lng}`} target="_blank" rel="noreferrer"><MapPin className="w-4 h-4" />{m.attachmentTitle || "Location"}</a>;
  }
  if (m.attachmentUrl && (type === "attachment" || (m.attachmentMime ?? "").startsWith("image/"))) return <><ImageAtt path={m.attachmentUrl} />{m.text && !/^Photo$/i.test(m.text) && <p className="whitespace-pre-wrap break-words mt-1">{m.text}</p>}</>;
  if (m.attachmentUrl && type === "voice_note") return <><AudioAtt path={m.attachmentUrl} />{m.text && m.text !== "Voice note" && <p className="whitespace-pre-wrap break-words mt-1 text-muted-foreground">{m.text}</p>}</>;
  if (m.attachmentUrl && (m.attachmentMime ?? "").startsWith("video/")) return <VideoAtt path={m.attachmentUrl} />;
  if (m.attachmentUrl && type === "file") return <FileAtt path={m.attachmentUrl} name={m.attachmentTitle || "File"} size={m.attachmentSize} />;
  return <p className="whitespace-pre-wrap break-words">{m.text}</p>;
}

function ImageAtt({ path }: { path: string }) {
  const url = useAuthBlob(path);
  return url ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="Photo" className="rounded-md max-h-80 max-w-full object-cover" /></a> : <div className="w-60 h-44 rounded-md bg-muted animate-pulse" />;
}
function AudioAtt({ path }: { path: string }) {
  const url = useAuthBlob(path);
  return url ? <audio controls src={url} className="max-w-[260px]" /> : <div className="w-56 h-10 rounded bg-muted animate-pulse" />;
}
function VideoAtt({ path }: { path: string }) {
  const url = useAuthBlob(path);
  return url ? <video controls src={url} className="rounded-md max-h-80 max-w-full" /> : <div className="w-60 h-40 rounded-md bg-muted animate-pulse" />;
}
function FileAtt({ path, name, size }: { path: string; name: string; size?: number | null }) {
  const url = useAuthBlob(path);
  return (
    <a href={url ?? undefined} download={name} className={cn("flex items-center gap-2 rounded-md bg-muted/70 px-3 py-2", !url && "pointer-events-none opacity-60")}>
      <FileText className="w-6 h-6 text-primary shrink-0" />
      <span className="truncate flex-1">{name}</span>
      {size ? <span className="text-xs text-muted-foreground">{size > 1048576 ? `${(size / 1048576).toFixed(1)} MB` : `${Math.ceil(size / 1024)} KB`}</span> : null}
      <Download className="w-4 h-4 text-muted-foreground" />
    </a>
  );
}

// ---------------------------------------------------------------- updates + channels
function UpdatesPane() {
  const feed = useQuery<any>({ queryKey: ["web", "status"], queryFn: () => api("/api/status/feed"), refetchInterval: 30000 });
  const channels = useQuery<any>({ queryKey: ["web", "channels"], queryFn: () => api("/api/channels/mine"), refetchInterval: 30000 });
  const [viewing, setViewing] = useState<{ name: string; updates: any[] } | null>(null);
  const [channelId, setChannelId] = useState<number | null>(null);
  if (channelId) return <ChannelView id={channelId} onBack={() => { setChannelId(null); channels.refetch(); }} />;
  const people: any[] = feed.data?.people ?? [];
  const businesses: any[] = feed.data?.businesses ?? [];
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 pt-4"><h2 className="text-xl font-bold">Updates</h2></div>
      <p className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</p>
      {people.length === 0 && businesses.length === 0 && <p className="px-4 py-2 text-sm text-muted-foreground">No status updates right now. Post one from the NeuraTalk app.</p>}
      {[...people.map((p) => ({ name: p.user?.name ?? "NeuraTalk user", avatar: p.user?.avatarUrl, updates: p.updates ?? [] })), ...businesses.map((b) => ({ name: b.business?.name ?? "Business", avatar: b.business?.logoUrl, updates: b.updates ?? [] }))].map((s, i) => (
        <button key={i} type="button" onClick={() => setViewing(s)} className="w-full flex items-center gap-3 px-4 py-2 hover:bg-muted/60 text-left">
          <div className="p-0.5 rounded-full ring-2 ring-primary"><Avatar name={s.name} src={s.avatar} size={42} /></div>
          <div className="min-w-0"><p className="font-medium truncate">{s.name}</p><p className="text-xs text-muted-foreground">{s.updates.length} update{s.updates.length === 1 ? "" : "s"} · {listTime(s.updates.at(-1)?.createdAt)}</p></div>
        </button>
      ))}
      <p className="px-4 pt-5 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1"><Radio className="w-3.5 h-3.5" /> Channels</p>
      {(channels.data?.channels ?? []).length === 0 && <p className="px-4 py-2 text-sm text-muted-foreground">Follow or create channels in the NeuraTalk app; they show here too.</p>}
      {(channels.data?.channels ?? []).map((c: any) => (
        <button key={c.id} type="button" onClick={() => setChannelId(c.id)} className="w-full flex items-center gap-3 px-4 py-2 hover:bg-muted/60 text-left" data-testid={`web-channel-${c.id}`}>
          <Avatar name={c.name} src={c.avatarUrl} size={44} />
          <div className="flex-1 min-w-0"><p className="font-medium truncate">{c.name}</p><p className="text-xs text-muted-foreground truncate">{c.lastUpdate?.text ?? `${c.followers} followers`}</p></div>
          {c.unread > 0 && <span className="min-w-5 h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold flex items-center justify-center">{c.unread}</span>}
        </button>
      ))}
      {viewing && <StatusViewer data={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function StatusViewer({ data, onClose }: { data: { name: string; updates: any[] }; onClose: () => void }) {
  const [i, setI] = useState(0);
  const u = data.updates[i];
  useEffect(() => {
    if (u?.id) api(`/api/status/${u.id}/view`, { method: "POST", body: "{}" }).catch(() => undefined);
    const t = setTimeout(() => (i + 1 < data.updates.length ? setI(i + 1) : onClose()), 5000);
    return () => clearTimeout(t);
  }, [i, u?.id, data.updates.length, onClose]);
  const img = useAuthBlob(u?.mediaUrl);
  if (!u) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col" onClick={() => (i + 1 < data.updates.length ? setI(i + 1) : onClose())} role="dialog" aria-label={`${data.name}'s status`}>
      <div className="flex gap-1 p-3">{data.updates.map((_, k) => <div key={k} className={cn("h-1 flex-1 rounded", k <= i ? "bg-white" : "bg-white/30")} />)}</div>
      <p className="text-white px-4 font-medium">{data.name} · {clock(u.createdAt)}</p>
      <div className="flex-1 flex items-center justify-center p-6" style={u.kind === "text" ? { background: u.background || "#1E66F5" } : undefined}>
        {u.kind === "photo" ? (img ? <img src={img} alt="" className="max-h-full max-w-full object-contain" /> : <Loader2 className="w-8 h-8 animate-spin text-white" />) : <p className="text-white text-3xl text-center max-w-2xl whitespace-pre-wrap">{u.text ?? u.textContent}</p>}
      </div>
      {u.kind === "photo" && (u.text || u.textContent) && <p className="text-white text-center pb-6">{u.text ?? u.textContent}</p>}
    </div>
  );
}

function ChannelView({ id, onBack }: { id: number; onBack: () => void }) {
  const c = useQuery<any>({ queryKey: ["web", "channel", id], queryFn: () => api(`/api/channels/${id}`) });
  const u = useQuery<any>({ queryKey: ["web", "channel-updates", id], queryFn: () => api(`/api/channels/${id}/updates`), refetchInterval: 20000 });
  const ch = c.data?.channel;
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="h-16 px-4 flex items-center gap-3 border-b">
        <button type="button" onClick={onBack} aria-label="Back"><ArrowLeft className="w-5 h-5" /></button>
        <Avatar name={ch?.name ?? "Channel"} src={ch?.avatarUrl} size={38} />
        <div className="min-w-0"><p className="font-medium truncate">{ch?.name}</p><p className="text-xs text-muted-foreground">{ch?.followers ?? 0} followers</p></div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-muted/30">
        {(u.data?.updates ?? []).slice().reverse().map((x: any) => (
          <div key={x.id} className="rounded-lg bg-background shadow-sm p-3 text-sm">
            {x.mediaUrl && !(x.mediaMime ?? "").startsWith("video") && <ImageAtt path={x.mediaUrl} />}
            {x.mediaUrl && (x.mediaMime ?? "").startsWith("video") && <VideoAtt path={x.mediaUrl} />}
            {x.text && <p className="whitespace-pre-wrap mt-1">{x.text}</p>}
            <p className="text-[11px] text-muted-foreground mt-1 flex justify-between"><span>{listTime(x.createdAt)} {clock(x.createdAt)}</span><span>{Object.entries(x.reactions ?? {}).map(([e, n]) => `${e} ${n}`).join("  ")}</span></p>
          </div>
        ))}
        {(u.data?.updates ?? []).length === 0 && <p className="text-center text-sm text-muted-foreground py-8">No updates in the last 30 days.</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- communities
function CommunitiesPane({ onOpenGroup }: { onOpenGroup: (groupId: number) => void }) {
  const list = useQuery<any>({ queryKey: ["web", "communities"], queryFn: () => api("/api/communities") });
  const [open, setOpenId] = useState<number | null>(null);
  const detail = useQuery<any>({ queryKey: ["web", "community", open], queryFn: () => api(`/api/communities/${open}`), enabled: open !== null });
  if (open && detail.data) {
    const c = detail.data.community;
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="h-16 px-4 flex items-center gap-3 border-b">
          <button type="button" onClick={() => setOpenId(null)} aria-label="Back"><ArrowLeft className="w-5 h-5" /></button>
          <div className="min-w-0"><p className="font-medium truncate">{c.name}</p><p className="text-xs text-muted-foreground">{c.members} members</p></div>
        </div>
        {c.announcementGroupId && (
          <button type="button" onClick={() => onOpenGroup(c.announcementGroupId)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/60 text-left">
            <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center"><Radio className="w-5 h-5 text-primary" /></div>
            <div><p className="font-medium">Announcements</p><p className="text-xs text-muted-foreground">Only admins post here</p></div>
          </button>
        )}
        <p className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Groups</p>
        {(detail.data.groups ?? []).map((g: any) => (
          <div key={g.id} className="flex items-center gap-3 px-4 py-2">
            <Avatar name={g.name} size={42} />
            <div className="flex-1 min-w-0"><p className="font-medium truncate">{g.name}</p><p className="text-xs text-muted-foreground">{g.members} members</p></div>
            {g.joined
              ? <button type="button" className="text-sm text-primary" onClick={() => onOpenGroup(g.id)}>Open</button>
              : <button type="button" className="text-sm rounded-full bg-primary text-primary-foreground px-3 py-1" onClick={async () => { await api(`/api/communities/${c.id}/groups/${g.id}/join`, { method: "POST", body: "{}" }).catch(() => undefined); onOpenGroup(g.id); }}>Join</button>}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 pt-4 pb-2"><h2 className="text-xl font-bold">Communities</h2></div>
      {(list.data?.communities ?? []).length === 0 && <p className="px-4 py-2 text-sm text-muted-foreground">Create or join communities in the NeuraTalk app (Chats → menu → Communities); they show here too.</p>}
      {(list.data?.communities ?? []).map((c: any) => (
        <button key={c.id} type="button" onClick={() => setOpenId(c.id)} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/60 text-left">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center"><UsersRound className="w-6 h-6 text-primary" /></div>
          <div className="min-w-0"><p className="font-medium truncate">{c.name}</p><p className="text-xs text-muted-foreground">{c.members} members{c.role === "admin" ? " · admin" : ""}</p></div>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- settings
function SettingsPane({ onLogout, dark, onToggleTheme }: { onLogout: () => void; dark: boolean; onToggleTheme: () => void }) {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const row = (icon: ReactNode, label: string, sub: string, onClick: () => void, danger = false) => (
    <button type="button" onClick={onClick} className="w-full flex items-center gap-4 px-4 py-3 hover:bg-muted/60 text-left">
      <span className={cn("text-muted-foreground", danger && "text-destructive")}>{icon}</span>
      <span className="min-w-0"><span className={cn("block font-medium", danger && "text-destructive")}>{label}</span><span className="block text-xs text-muted-foreground truncate">{sub}</span></span>
    </button>
  );
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 pt-4 pb-2"><h2 className="text-xl font-bold">Settings</h2></div>
      <div className="flex items-center gap-3 px-4 py-4 border-b">
        <Avatar name={user?.displayName || user?.username || "Me"} src={(user as any)?.avatarUrl} size={56} />
        <div className="min-w-0"><p className="font-semibold truncate">{user?.displayName || user?.username}</p><p className="text-sm text-muted-foreground truncate">{user?.phone || user?.email}</p></div>
      </div>
      {row(<LayoutDashboard className="w-5 h-5" />, "Calls and dashboard", "Translated calls, minutes, contacts", () => setLocation("/dashboard"))}
      {row(<CreditCard className="w-5 h-5" />, "Plans and billing", "Minutes, wallet and invoices", () => setLocation("/billing"))}
      {row(dark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />, "Theme", dark ? "Dark" : "Light", onToggleTheme)}
      {row(<FileText className="w-5 h-5" />, "Privacy and terms", "How we handle your data", () => setLocation("/privacy"))}
      {row(<LogOut className="w-5 h-5" />, "Log out of this computer", "You stay signed in on your phone", onLogout, true)}
    </div>
  );
}
