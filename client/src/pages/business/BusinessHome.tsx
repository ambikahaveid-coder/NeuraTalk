import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight, BadgeCheck, Building2, ChevronDown, Code2, CreditCard, FileText, Headphones, Inbox, Megaphone,
  MessagesSquare, Phone, PiggyBank, QrCode, Radio, Send, ShieldCheck, Store, Users, Wallet,
} from "lucide-react";
import { getAuthToken } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

type Tab = "overview" | "inbox" | "messaging" | "marketing" | "agents" | "reports" | "api" | "settings";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Authorization: `Bearer ${getAuthToken() ?? ""}` } });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

function rupees(paise?: number | null) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format((paise ?? 0) / 100);
}

function ago(iso?: string) {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" });
}

/** Turn an audit record ("cancel", "campaign 75") into a sentence a shop owner understands. */
export function describeActivity(action: string, resource: string): string {
  const [kind, id] = String(resource || "").split(/\s+/);
  const thing: Record<string, string> = {
    customer: "Customer", campaign: "Broadcast", template: "Template", member: "Team member", user: "Team member",
    conversation: "Chat", api_key: "API key", webhook: "Webhook", catalog_item: "Catalog item", order: "Order", form: "Form",
  };
  const verb: Record<string, string> = {
    create: "added", update: "updated", delete: "removed", cancel: "cancelled", approve: "approved", reject: "rejected",
    send: "sent", consent_action: "consent updated", schedule: "scheduled", assign: "assigned", revoke: "revoked", login: "signed in", access: "opened by NeuraTalk support",
  };
  const name = thing[kind?.toLowerCase()] ?? (kind ? kind.charAt(0).toUpperCase() + kind.slice(1).replace(/_/g, " ") : "Item");
  const did = verb[String(action).toLowerCase()] ?? String(action).replace(/_/g, " ");
  return `${name}${id ? ` #${id}` : ""} ${did}`;
}

function Stat({ label, value, sub, icon }: { label: string; value: ReactNode; sub?: string; icon: ReactNode }) {
  return (
    <div className="rounded-3xl border bg-background p-5">
      <div className="flex items-center justify-between text-muted-foreground"><span className="text-sm">{label}</span>{icon}</div>
      <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function BusinessHome({ businessId, businessName, verified, canManage, wallet, onOpen, auditLogs, clientConnect }: {
  businessId: number;
  businessName: string;
  verified: boolean;
  canManage: boolean;
  wallet?: { availableWalletPaise?: number; canUsePaidServices?: boolean } | null;
  onOpen: (tab: Tab) => void;
  auditLogs?: Array<{ id: string | number; timestamp: string; user: string; action: string; resource: string }>;
  clientConnect?: ReactNode;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const conversations = useQuery<{ conversations: Array<{ id: number; customerName?: string; status?: string; lastMessage?: { content?: string; createdAt?: string } | null }> }>({
    queryKey: ["biz-home", businessId, "conversations"],
    queryFn: () => get(`/api/business/${businessId}/conversations`),
    enabled: businessId > 0,
    refetchInterval: 20000,
  });
  const stats = useQuery<{ stats: { sent: number; delivered: number; read: number; received: number; chats: number } }>({
    queryKey: ["biz-home", businessId, "stats"],
    queryFn: () => get(`/api/business/${businessId}/messaging-stats`),
    enabled: businessId > 0,
  });
  const health = useQuery<{ health: { quality: string; tier: number; restriction: { reason?: string } | null } }>({
    queryKey: ["biz-home", businessId, "health"],
    queryFn: () => get(`/api/business/${businessId}/messaging/health`),
    enabled: businessId > 0 && canManage,
  });

  const convs = conversations.data?.conversations ?? [];
  const open = convs.filter((c) => (c.status ?? "open") === "open");
  const s = stats.data?.stats;
  const h = health.data?.health;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const quality = h?.restriction ? "Paused" : h?.quality === "high" ? "Good" : h?.quality === "low" ? "Needs care" : h?.quality === "medium" ? "OK" : "New";

  const actions: Array<{ icon: ReactNode; title: string; desc: string; onClick?: () => void; href?: string; show?: boolean }> = [
    { icon: <Inbox className="h-5 w-5" />, title: "Reply to customers", desc: "Open the team inbox", onClick: () => onOpen("inbox") },
    { icon: <Megaphone className="h-5 w-5" />, title: "Send a broadcast", desc: "Offers or updates to customers who opted in", onClick: () => onOpen("marketing") },
    { icon: <Send className="h-5 w-5" />, title: "Business tools", desc: "Templates, catalog, customers, chat link", onClick: () => onOpen("messaging") },
    { icon: <Users className="h-5 w-5" />, title: "Add a team member", desc: "Give your staff access to chats", onClick: () => onOpen("agents"), show: canManage },
    { icon: <Store className="h-5 w-5" />, title: "Business profile", desc: "Logo, hours, address, chat link and QR", onClick: () => onOpen("settings"), show: canManage },
    { icon: <Wallet className="h-5 w-5" />, title: "Add money to wallet", desc: "Pays for updates, codes and broadcasts", href: "/billing", show: canManage },
  ];
  const advanced: Array<{ icon: ReactNode; title: string; href: string }> = [
    { icon: <Headphones className="h-4 w-4" />, title: "Talk to a customer in person", href: "/calls/face-to-face" },
    { icon: <Phone className="h-4 w-4" />, title: "Business phone numbers", href: "/enterprise/hub" },
    { icon: <Radio className="h-4 w-4" />, title: "Call menus and queues", href: "/enterprise/telephony" },
    { icon: <Users className="h-4 w-4" />, title: "Who is available", href: "/enterprise/presence" },
    { icon: <ShieldCheck className="h-4 w-4" />, title: "Supervisor view", href: "/enterprise/supervisor" },
    { icon: <Building2 className="h-4 w-4" />, title: "Departments", href: "/enterprise/org-structure" },
    { icon: <PiggyBank className="h-4 w-4" />, title: "Cost centres", href: "/enterprise/cost-centers" },
    { icon: <CreditCard className="h-4 w-4" />, title: "Billing contract", href: "/enterprise/billing-contracts" },
    { icon: <FileText className="h-4 w-4" />, title: "Call text history", href: "/admin/transcripts" },
  ];

  return (
    <div className="space-y-8" data-testid="business-home">
      {/* Greeting */}
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm text-muted-foreground">{greeting}</p>
          <h1 className="mt-1 flex items-center gap-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            {businessName}
            {verified && <BadgeCheck className="h-7 w-7 text-primary" aria-label="Verified business" />}
          </h1>
          {!verified && canManage && (
            <button type="button" onClick={() => onOpen("settings")} className="mt-2 text-sm text-primary hover:underline">Get the verified tick →</button>
          )}
        </div>
        <button type="button" onClick={() => onOpen("inbox")} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-primary px-6 text-primary-foreground hover:bg-primary/90" data-testid="button-open-inbox">
          <MessagesSquare className="h-4 w-4" /> Open chats{open.length ? ` (${open.length})` : ""}
        </button>
      </div>

      {h?.restriction && (
        <div className="rounded-3xl border border-amber-300 bg-amber-50 p-5 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100" role="alert">
          <p className="font-semibold">Broadcasts are paused for your business</p>
          <p className="mt-1 text-sm">{h.restriction.reason || "NeuraTalk is reviewing your account."} Chats with customers still work.</p>
        </div>
      )}

      {/* Numbers */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Open chats" value={conversations.isLoading ? "…" : open.length} sub={`${convs.length} chats in total`} icon={<MessagesSquare className="h-5 w-5" />} />
        <Stat label="Messages received" value={s ? s.received : "…"} sub="Last 30 days" icon={<Inbox className="h-5 w-5" />} />
        <Stat label="Messages read" value={s ? `${s.read}` : "…"} sub={s ? `of ${s.delivered} delivered · ${s.sent} sent` : "Last 30 days"} icon={<Send className="h-5 w-5" />} />
        {canManage ? (
          <Stat label="Wallet" value={rupees(wallet?.availableWalletPaise)} sub={wallet?.canUsePaidServices === false ? "Add money to send updates" : `Account quality: ${quality}${h ? ` · up to ${h.tier} customers a day` : ""}`} icon={<Wallet className="h-5 w-5" />} />
        ) : (
          <Stat label="Chats this month" value={s ? s.chats : "…"} sub="Last 30 days" icon={<MessagesSquare className="h-5 w-5" />} />
        )}
      </div>

      <div className="grid gap-8 lg:grid-cols-[1.25fr_1fr]">
        {/* Recent chats */}
        <section className="rounded-3xl border bg-background">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <h2 className="font-semibold">Latest chats</h2>
            <button type="button" onClick={() => onOpen("inbox")} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">All chats <ArrowRight className="h-4 w-4" /></button>
          </div>
          {convs.length === 0 ? (
            <div className="p-8 text-center">
              <QrCode className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 font-medium">No chats yet</p>
              <p className="mt-1 text-sm text-muted-foreground">Share your chat link or QR code so customers can message you.</p>
              {canManage && <button type="button" onClick={() => onOpen("settings")} className="mt-4 text-sm font-medium text-primary hover:underline">Get your link and QR</button>}
            </div>
          ) : (
            <ul className="divide-y">
              {convs.slice(0, 6).map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => onOpen("inbox")} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-muted/50">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary">{(c.customerName || "?").charAt(0).toUpperCase()}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex justify-between gap-2"><span className="truncate font-medium">{c.customerName || "Customer"}</span><span className="shrink-0 text-xs text-muted-foreground">{ago(c.lastMessage?.createdAt)}</span></span>
                      <span className="block truncate text-sm text-muted-foreground">{c.lastMessage?.content || "No messages yet"}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Things to do */}
        <section>
          <h2 className="mb-3 font-semibold">Things to do</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {actions.filter((a) => a.show !== false).map((a) => {
              const inner = (
                <>
                  <span className="text-primary">{a.icon}</span>
                  <span className="mt-3 block font-medium">{a.title}</span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{a.desc}</span>
                </>
              );
              return a.href ? (
                <Link key={a.title} href={a.href} className="rounded-3xl border bg-background p-4 transition-colors hover:border-primary/50">{inner}</Link>
              ) : (
                <button key={a.title} type="button" onClick={a.onClick} className="rounded-3xl border bg-background p-4 text-left transition-colors hover:border-primary/50">{inner}</button>
              );
            })}
          </div>
        </section>
      </div>

      {canManage && (auditLogs?.length ?? 0) > 0 && (
        <section className="rounded-3xl border bg-background">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <h2 className="font-semibold">Recent activity</h2>
            <button type="button" onClick={() => onOpen("reports")} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">Reports <ArrowRight className="h-4 w-4" /></button>
          </div>
          <ul className="divide-y">
            {auditLogs!.slice(0, 5).map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                <span className="min-w-0"><span className="font-medium">{describeActivity(e.action, e.resource)}</span><span className="text-muted-foreground"> · by {e.user}</span></span>
                <span className="shrink-0 text-xs text-muted-foreground">{ago(e.timestamp) || e.timestamp}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canManage && (
        <section className="rounded-3xl border bg-background">
          <button type="button" onClick={() => setShowAdvanced((v) => !v)} className="flex w-full items-center justify-between px-5 py-4 text-left" aria-expanded={showAdvanced} data-testid="button-advanced-tools">
            <span><span className="font-semibold">More tools</span><span className="ml-2 text-sm text-muted-foreground">for larger teams and call centres</span></span>
            <ChevronDown className={cn("h-5 w-5 transition-transform", showAdvanced && "rotate-180")} />
          </button>
          {showAdvanced && (
            <div className="border-t p-5">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {advanced.map((a) => (
                  <Link key={a.href} href={a.href} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-muted">
                    <span className="text-primary">{a.icon}</span><span className="text-sm">{a.title}</span>
                  </Link>
                ))}
                <button type="button" onClick={() => onOpen("api")} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-muted">
                  <span className="text-primary"><Code2 className="h-4 w-4" /></span><span className="text-sm">Developers (API keys, webhooks)</span>
                </button>
              </div>
              {clientConnect && <div className="mt-6 max-w-md">{clientConnect}</div>}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
