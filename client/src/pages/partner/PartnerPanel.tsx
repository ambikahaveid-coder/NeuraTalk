import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Building2, CheckCircle2, Copy, Loader2, LogOut, PauseCircle, PlayCircle, Plus, Search, Settings, Wallet, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { BrandMark } from "@/components/BrandMark";
import { getAuthToken, useAuth } from "@/hooks/use-auth";

/**
 * Partner (reseller) panel: the partner's own brand at the top; its
 * businesses, wallet (wholesale credit from NeuraTalk), payments from its
 * businesses to confirm, and settings (brand, where businesses pay, staff).
 */

type Brand = { id: number; brandName: string; slug: string; logoUrl: string | null; primaryColor: string | null; supportEmail: string | null; supportPhone: string | null };
type Biz = { id: number; name: string; status: string; phone: string | null; balancePaise: number; pausedByPartner: boolean; blocked: boolean; spent30Paise: number; messages30: number; planName: string | null; planEndsAt: string | null };
type Panel = {
  partner: Brand & { name: string; status: string; pauseReason: string | null; bonusPercent: number; walletPaise: number; paymentDetails: Record<string, string> };
  role: string;
  wholesaleRates: { marketingPaise: number; utilityPaise: number; otpPaise: number };
  plans: Array<{ id: number; name: string; pricePaise: number; includedMinutes: number; durationDays: number }>;
  neuratalkPayment: { ready: boolean; upiId: string; payeeName: string; bankName: string; accountNumber: string; ifsc: string; note: string };
  minTopupPaise: number;
  businesses: Biz[];
  pendingPayments: Array<{ id: number; businessId: number; businessName: string; kind: string; planName: string | null; pricePaise: number; creditPaise: number; method: string; paymentReference: string; createdAt: string }>;
  ledger: Array<{ id: number; kind: string; amountPaise: number; balanceAfterPaise: number; businessName: string | null; reference: string | null; note: string | null; createdAt: string }>;
  topups: Array<{ id: number; amountPaise: number; creditPaise: number; method: string; paymentReference: string; status: string; decisionNote: string | null; createdAt: string }>;
  members: Array<{ userId: number; role: string; phone: string | null; name: string | null }>;
};

async function call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${getAuthToken()}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof json?.error === "string" ? json.error : `Request failed (${res.status})`);
  return json as T;
}

const rs = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (s: string | null) => (s ? new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");
const day = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—");
const METHOD: Record<string, string> = { upi: "UPI", bank_transfer: "Bank transfer", cheque: "Cheque", cash_deposit: "Cash deposit" };
const LEDGER: Record<string, string> = { topup: "Top-up from NeuraTalk", to_business: "Credit given to", from_business: "Credit taken back from", business_payment: "Business payment confirmed:", plan_for_business: "Plan for", refund: "Refund:" };

function Copyable({ label, value }: { label: string; value: string }) {
  const { toast } = useToast();
  if (!value) return null;
  return (
    <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2 font-medium">{value}
        <button type="button" aria-label={`Copy ${label}`} onClick={() => { navigator.clipboard?.writeText(value); toast({ title: `${label} copied` }); }}><Copy className="h-3.5 w-3.5 text-muted-foreground" /></button>
      </span>
    </div>
  );
}

export default function PartnerPanel() {
  const { user, logout } = useAuth() as ReturnType<typeof useAuth> & { logout?: () => void };
  const mine = useQuery<{ partners: Array<Brand & { role: string }> }>({ queryKey: ["/api/partner/mine"], queryFn: () => call("GET", "/api/partner/mine") });
  const wanted = Number(new URLSearchParams(window.location.search).get("id")) || null;
  const partnerId = wanted ?? mine.data?.partners[0]?.id ?? null;

  if (mine.isLoading) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!partnerId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <Card className="max-w-md"><CardContent className="space-y-3 p-6 text-center">
          <Building2 className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="font-medium">This number isn't part of a NeuraTalk partner.</p>
          <p className="text-sm text-muted-foreground">Want to sell NeuraTalk Business under your brand? Write to support@mindwhile.com.</p>
          <Button variant="outline" onClick={() => { window.location.href = "/"; }}>Back</Button>
        </CardContent></Card>
      </div>
    );
  }
  return <PartnerWorkspace partnerId={partnerId} userName={(user as { displayName?: string } | null)?.displayName ?? null} onLogout={logout} />;
}

function PartnerWorkspace({ partnerId, userName, onLogout }: { partnerId: number; userName: string | null; onLogout?: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const key = ["/api/partner", partnerId];
  const q = useQuery<Panel>({ queryKey: key, queryFn: () => call("GET", `/api/partner/${partnerId}`), refetchInterval: 60_000 });
  const [tab, setTab] = useState<"businesses" | "payments" | "wallet" | "settings">("businesses");
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const fail = (e: Error) => toast({ title: "Couldn't do that", description: e.message, variant: "destructive" });

  if (q.isLoading) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (q.error || !q.data) return <div className="p-6 text-sm text-destructive">{(q.error as Error)?.message ?? "Couldn't load."}</div>;
  const d = q.data;
  const color = d.partner.primaryColor || "#0f766e";
  const isOwner = d.role === "owner";

  return (
    <div className="min-h-screen bg-muted/30" style={{ ["--partner" as string]: color }} data-testid="partner-panel">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <BrandMark name={d.partner.brandName} logoUrl={d.partner.logoUrl} color={color} className="h-9 w-9 rounded-lg" textClassName="text-sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold" data-testid="partner-brand">{d.partner.brandName}</p>
            <p className="text-xs text-muted-foreground">Partner panel · powered by NeuraTalk</p>
          </div>
          {userName && <span className="hidden text-sm text-muted-foreground sm:inline">{userName}</span>}
          {onLogout && <Button variant="ghost" size="icon" aria-label="Log out" onClick={onLogout}><LogOut className="h-4 w-4" /></Button>}
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4" role="tablist">
          {([
            ["businesses", "Businesses", <Building2 key="b" className="h-4 w-4" />],
            ["payments", `Payments to confirm${d.pendingPayments.length ? ` (${d.pendingPayments.length})` : ""}`, <CheckCircle2 key="p" className="h-4 w-4" />],
            ["wallet", "Wallet", <Wallet key="w" className="h-4 w-4" />],
            ["settings", "Settings", <Settings key="s" className="h-4 w-4" />],
          ] as const).map(([id, label, icon]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} data-testid={`partner-tab-${id}`}
              className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm ${tab === id ? "font-medium" : "border-transparent text-muted-foreground"}`}
              style={tab === id ? { borderColor: color, color } : undefined}>
              {icon}{label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 px-4 py-5">
        {d.partner.status !== "active" && (
          <div role="alert" className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span><strong>NeuraTalk paused this partner account.</strong> {d.partner.pauseReason} You can look, but not move money or add businesses. Contact support@mindwhile.com.</span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Partner wallet", rs(d.partner.walletPaise)],
            ["Businesses", String(d.businesses.length)],
            ["Paid messages (30 days)", d.businesses.reduce((s, b) => s + b.messages30, 0).toLocaleString("en-IN")],
            ["Waiting for you", String(d.pendingPayments.length)],
          ].map(([l, v]) => (
            <Card key={l}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{l}</p><p className="mt-1 text-2xl font-semibold">{v}</p></CardContent></Card>
          ))}
        </div>

        {tab === "businesses" && <BusinessesTab d={d} partnerId={partnerId} isOwner={isOwner} refresh={refresh} fail={fail} color={color} />}
        {tab === "payments" && <PaymentsTab d={d} partnerId={partnerId} isOwner={isOwner} refresh={refresh} fail={fail} />}
        {tab === "wallet" && <WalletTab d={d} partnerId={partnerId} isOwner={isOwner} refresh={refresh} fail={fail} />}
        {tab === "settings" && <SettingsTab d={d} partnerId={partnerId} isOwner={isOwner} refresh={refresh} fail={fail} />}
      </main>
    </div>
  );
}

type TabProps = { d: Panel; partnerId: number; isOwner: boolean; refresh: () => void; fail: (e: Error) => void; color?: string };

function BusinessesTab({ d, partnerId, isOwner, refresh, fail, color }: TabProps) {
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", category: "", city: "", ownerPhone: "", ownerName: "" });
  const [open, setOpen] = useState<Biz | null>(null);
  const create = useMutation({
    mutationFn: () => call("POST", `/api/partner/${partnerId}/businesses`, { ...form, category: form.category || undefined, city: form.city || undefined, ownerName: form.ownerName || undefined }),
    onSuccess: () => { toast({ title: "Business created", description: "The owner signs in to NeuraTalk Business with that number." }); setAdding(false); setForm({ name: "", category: "", city: "", ownerPhone: "", ownerName: "" }); refresh(); },
    onError: fail,
  });
  const shown = useMemo(() => d.businesses.filter((b) => !q.trim() || b.name.toLowerCase().includes(q.trim().toLowerCase()) || (b.phone ?? "").includes(q.trim())), [d.businesses, q]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <div><CardTitle className="text-base">Your businesses</CardTitle><CardDescription>Businesses you sell NeuraTalk Business to. They see "Managed by {d.partner.brandName}".</CardDescription></div>
          <Button size="sm" onClick={() => setAdding(true)} style={{ background: color }} data-testid="button-partner-new-business"><Plus className="mr-1 h-4 w-4" /> Business</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {adding && (
            <div className="space-y-3 rounded-md border p-3" data-testid="partner-new-business">
              <div className="grid gap-2 sm:grid-cols-3">
                <div><Label>Business name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Sri Sai Sweets" data-testid="input-pb-name" /></div>
                <div><Label>Category</Label><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Food" /></div>
                <div><Label>City</Label><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Guntur" /></div>
                <div><Label>Owner's mobile number</Label><Input value={form.ownerPhone} onChange={(e) => setForm({ ...form, ownerPhone: e.target.value })} placeholder="98765 43210" data-testid="input-pb-phone" /></div>
                <div><Label>Owner's name</Label><Input value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} placeholder="Sai" /></div>
              </div>
              <p className="text-xs text-muted-foreground">Use the business's own number. A number that is someone's personal NeuraTalk can't become a business.</p>
              <div className="flex gap-2">
                <Button size="sm" disabled={create.isPending || form.name.trim().length < 2 || form.ownerPhone.trim().length < 8} onClick={() => create.mutate()} data-testid="button-pb-create">{create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create</Button>
                <Button size="sm" variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
              </div>
            </div>
          )}
          <div className="relative"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-8" placeholder="Search by name or number" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {shown.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No businesses yet. Add your first one.</p> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Business</TableHead><TableHead className="text-right">Balance</TableHead><TableHead>Plan</TableHead><TableHead className="text-right">Spent 30d</TableHead><TableHead>State</TableHead><TableHead /></TableRow></TableHeader>
                <TableBody>
                  {shown.map((b) => (
                    <TableRow key={b.id} data-testid={`partner-biz-${b.id}`}>
                      <TableCell><p className="font-medium">{b.name}</p><p className="text-xs text-muted-foreground">#{b.id} · {b.phone}</p></TableCell>
                      <TableCell className="text-right font-medium">{rs(b.balancePaise)}</TableCell>
                      <TableCell className="text-xs">{b.planName ? <>{b.planName}<br /><span className="text-muted-foreground">ends {day(b.planEndsAt)}</span></> : <span className="text-muted-foreground">No plan</span>}</TableCell>
                      <TableCell className="text-right text-xs">{rs(b.spent30Paise)}<br /><span className="text-muted-foreground">{b.messages30} msgs</span></TableCell>
                      <TableCell>{b.pausedByPartner ? <Badge variant="destructive">Paused by you</Badge> : b.blocked ? <Badge variant="destructive">Paused by NeuraTalk</Badge> : <Badge variant="secondary">Active</Badge>}</TableCell>
                      <TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => setOpen(b)} data-testid={`button-manage-${b.id}`}>Manage</Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      {open && <ManageBusiness biz={open} d={d} partnerId={partnerId} isOwner={isOwner} refresh={refresh} fail={fail} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ManageBusiness({ biz, d, partnerId, isOwner, refresh, fail, onClose }: TabProps & { biz: Biz; onClose: () => void }) {
  const { toast } = useToast();
  const [amount, setAmount] = useState("");
  const [planId, setPlanId] = useState("");
  const [reason, setReason] = useState("");
  const live = d.businesses.find((b) => b.id === biz.id) ?? biz;
  const transfer = useMutation({
    mutationFn: (direction: "to_business" | "from_business") => call("POST", `/api/partner/${partnerId}/businesses/${biz.id}/transfer`, { amountPaise: Math.round(Number(amount) * 100), direction }),
    onSuccess: (_r, dir) => { toast({ title: dir === "to_business" ? "Credit given" : "Credit taken back" }); setAmount(""); refresh(); }, onError: fail,
  });
  const plan = useMutation({
    mutationFn: () => call("POST", `/api/partner/${partnerId}/businesses/${biz.id}/plan`, { planId: Number(planId) }),
    onSuccess: () => { toast({ title: "Plan started" }); setPlanId(""); refresh(); }, onError: fail,
  });
  const pause = useMutation({
    mutationFn: (paused: boolean) => call("POST", `/api/partner/${partnerId}/businesses/${biz.id}/pause`, { paused, reason }),
    onSuccess: (_r, p) => { toast({ title: p ? "Business paused" : "Business resumed" }); setReason(""); refresh(); }, onError: fail,
  });
  const amountOk = Number(amount) >= 1;
  return (
    <Card data-testid="partner-manage">
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div><CardTitle className="text-base">{live.name}</CardTitle><CardDescription>Balance {rs(live.balancePaise)} · {live.planName ? `${live.planName} until ${day(live.planEndsAt)}` : "no plan"} · your wallet {rs(d.partner.walletPaise)}</CardDescription></div>
        <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-3">
        {!isOwner && <p className="text-sm text-muted-foreground md:col-span-3">Only the partner owner can move money or pause a business.</p>}
        <div className="space-y-2">
          <Label>Give or take back credit (₹)</Label>
          <Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1000" disabled={!isOwner} data-testid="input-transfer-amount" />
          <div className="flex gap-2">
            <Button size="sm" disabled={!isOwner || !amountOk || transfer.isPending} onClick={() => transfer.mutate("to_business")} data-testid="button-give-credit"><ArrowUpRight className="mr-1 h-4 w-4" />Give</Button>
            <Button size="sm" variant="outline" disabled={!isOwner || !amountOk || transfer.isPending} onClick={() => transfer.mutate("from_business")}><ArrowDownLeft className="mr-1 h-4 w-4" />Take back</Button>
          </div>
          <p className="text-xs text-muted-foreground">Comes out of your partner wallet. Take back only unused credit.</p>
        </div>
        <div className="space-y-2">
          <Label>Start a plan (AI call minutes)</Label>
          <Select value={planId} onValueChange={setPlanId} disabled={!isOwner}>
            <SelectTrigger><SelectValue placeholder="Choose a plan" /></SelectTrigger>
            <SelectContent>{d.plans.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name} · {rs(p.pricePaise)} · {p.includedMinutes} min · {p.durationDays} days</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" disabled={!isOwner || !planId || plan.isPending} onClick={() => plan.mutate()}>Start plan</Button>
          <p className="text-xs text-muted-foreground">Paid from your wallet at NeuraTalk's plan price.</p>
        </div>
        <div className="space-y-2">
          <Label>{live.pausedByPartner ? "Paused by you" : "Pause this business"}</Label>
          {live.pausedByPartner
            ? <Button size="sm" variant="outline" disabled={!isOwner || pause.isPending} onClick={() => pause.mutate(false)}><PlayCircle className="mr-1 h-4 w-4" />Resume</Button>
            : <>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, e.g. monthly fee not paid" disabled={!isOwner} />
                <Button size="sm" variant="destructive" disabled={!isOwner || reason.trim().length < 3 || pause.isPending} onClick={() => pause.mutate(true)}><PauseCircle className="mr-1 h-4 w-4" />Pause</Button>
              </>}
          <p className="text-xs text-muted-foreground">While paused, paid messages and calls stop. Chats with customers stay.</p>
        </div>
      </CardContent>
    </Card>
  );
}

function PaymentsTab({ d, partnerId, isOwner, refresh, fail }: TabProps) {
  const { toast } = useToast();
  const [rejecting, setRejecting] = useState<{ id: number; reason: string } | null>(null);
  const approve = useMutation({ mutationFn: (id: number) => call("POST", `/api/partner/${partnerId}/payments/${id}/approve`, {}), onSuccess: () => { toast({ title: "Confirmed" }); refresh(); }, onError: fail });
  const reject = useMutation({ mutationFn: () => call("POST", `/api/partner/${partnerId}/payments/${rejecting!.id}/reject`, { reason: rejecting!.reason }), onSuccess: () => { toast({ title: "Marked not received" }); setRejecting(null); refresh(); }, onError: fail });
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Payments from your businesses</CardTitle><CardDescription>Your businesses pay you (your UPI / bank in Settings) and send the UTR. Check it in your bank first. Confirming takes the amount from your partner wallet and gives it to the business (or starts its plan).</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        {d.pendingPayments.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Nothing waiting.</p> : d.pendingPayments.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3" data-testid={`partner-pending-${p.id}`}>
            <div>
              <p className="font-medium">{p.businessName} · {p.kind === "plan" ? `Plan ${p.planName}` : `credit ${rs(p.creditPaise)}`} · paid {rs(p.pricePaise)}</p>
              <p className="text-xs text-muted-foreground">{METHOD[p.method] ?? p.method} · <span className="font-mono">{p.paymentReference}</span> · {when(p.createdAt)}</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" disabled={!isOwner || approve.isPending} onClick={() => { if (confirm(`Confirm ${rs(p.pricePaise)} from ${p.businessName} (ref ${p.paymentReference})?`)) approve.mutate(p.id); }} data-testid={`partner-approve-${p.id}`}><CheckCircle2 className="mr-1 h-4 w-4" />Confirm</Button>
              <Button size="sm" variant="ghost" disabled={!isOwner} onClick={() => setRejecting({ id: p.id, reason: "" })}><XCircle className="mr-1 h-4 w-4" />Not received</Button>
            </div>
          </div>
        ))}
        {rejecting && (
          <div className="space-y-2 rounded-md border p-3">
            <Label>Why? (the business sees this)</Label>
            <Textarea rows={2} value={rejecting.reason} onChange={(e) => setRejecting({ ...rejecting, reason: e.target.value })} />
            <div className="flex gap-2"><Button size="sm" variant="destructive" disabled={rejecting.reason.trim().length < 5 || reject.isPending} onClick={() => reject.mutate()}>Mark not received</Button><Button size="sm" variant="outline" onClick={() => setRejecting(null)}>Cancel</Button></div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WalletTab({ d, partnerId, isOwner, refresh, fail }: TabProps) {
  const { toast } = useToast();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("upi");
  const [ref, setRef] = useState("");
  const paise = Math.round(Number(amount) * 100);
  const credit = Math.floor(paise * (100 + d.partner.bonusPercent) / 100);
  const topup = useMutation({
    mutationFn: () => call("POST", `/api/partner/${partnerId}/topups`, { amountPaise: paise, method, paymentReference: ref.trim() }),
    onSuccess: () => { toast({ title: "Sent to NeuraTalk", description: "The credit is added after NeuraTalk confirms the payment." }); setAmount(""); setRef(""); refresh(); }, onError: fail,
  });
  const np = d.neuratalkPayment;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Buy wholesale credit from NeuraTalk</CardTitle>
          <CardDescription>
            Your rates: offers {rs(d.wholesaleRates.marketingPaise)}, updates {rs(d.wholesaleRates.utilityPaise)}, codes {rs(d.wholesaleRates.otpPaise)} per delivered message.
            {d.partner.bonusPercent > 0 && ` You get ${d.partner.bonusPercent}% extra credit on every top-up.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <p className="text-sm font-medium">1. Pay NeuraTalk</p>
            {np.ready ? <>
              <Copyable label="UPI ID" value={np.upiId} /><Copyable label="Name" value={np.payeeName} /><Copyable label="Bank" value={np.bankName} />
              <Copyable label="Account" value={np.accountNumber} /><Copyable label="IFSC" value={np.ifsc} />
              {np.note && <p className="text-xs text-muted-foreground">{np.note}</p>}
            </> : <p className="text-sm text-muted-foreground">Write to support@mindwhile.com for NeuraTalk's payment details.</p>}
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">2. Tell us how you paid</p>
            <Input type="number" placeholder={`Amount ₹ (min ${d.minTopupPaise / 100})`} value={amount} onChange={(e) => setAmount(e.target.value)} disabled={!isOwner} data-testid="input-topup-amount" />
            {paise > 0 && <p className="text-xs text-muted-foreground">You'll get {rs(credit)} credit.</p>}
            <Select value={method} onValueChange={setMethod} disabled={!isOwner}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(METHOD).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select>
            <Input placeholder="UTR / transaction reference" value={ref} maxLength={40} onChange={(e) => setRef(e.target.value)} disabled={!isOwner} data-testid="input-topup-ref" />
            <Button disabled={!isOwner || paise < d.minTopupPaise || ref.trim().length < 6 || topup.isPending} onClick={() => topup.mutate()} data-testid="button-topup">I've paid — send to NeuraTalk</Button>
          </div>
        </CardContent>
      </Card>
      {d.topups.length > 0 && (
        <Card><CardHeader><CardTitle className="text-base">Your top-ups</CardTitle></CardHeader><CardContent className="space-y-1">
          {d.topups.map((t) => (
            <p key={t.id} className="text-sm">{when(t.createdAt)} · paid {rs(t.amountPaise)} → {rs(t.creditPaise)} · <span className="font-mono text-xs">{t.paymentReference}</span> ·{" "}
              {t.status === "approved" ? <Badge variant="secondary">Added</Badge> : t.status === "rejected" ? <Badge variant="destructive">Not received{t.decisionNote ? `: ${t.decisionNote}` : ""}</Badge> : <Badge variant="outline">Waiting for NeuraTalk</Badge>}</p>
          ))}
        </CardContent></Card>
      )}
      <Card>
        <CardHeader><CardTitle className="text-base">Wallet history</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          {d.ledger.length === 0 ? <p className="text-sm text-muted-foreground">Nothing yet.</p> : d.ledger.map((l) => (
            <div key={l.id} className="flex flex-wrap justify-between gap-2 border-b py-1.5 text-sm last:border-0">
              <span>{LEDGER[l.kind] ?? l.kind} {l.businessName ?? ""} {l.note ? `· ${l.note}` : ""} <span className="text-xs text-muted-foreground">{when(l.createdAt)}</span></span>
              <span className={l.amountPaise >= 0 ? "text-emerald-600" : ""}>{l.amountPaise >= 0 ? "+" : "−"}{rs(Math.abs(l.amountPaise))} <span className="text-xs text-muted-foreground">= {rs(l.balanceAfterPaise)}</span></span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function SettingsTab({ d, partnerId, isOwner, refresh, fail }: TabProps) {
  const { toast } = useToast();
  const [brand, setBrand] = useState({ brandName: d.partner.brandName, logoUrl: d.partner.logoUrl ?? "", primaryColor: d.partner.primaryColor ?? "", supportEmail: d.partner.supportEmail ?? "", supportPhone: d.partner.supportPhone ?? "" });
  const [pay, setPay] = useState({ upiId: "", payeeName: "", bankName: "", accountNumber: "", ifsc: "", note: "", ...d.partner.paymentDetails });
  const [member, setMember] = useState("");
  const save = useMutation({ mutationFn: () => call("PATCH", `/api/partner/${partnerId}/settings`, { brand, paymentDetails: pay }), onSuccess: () => { toast({ title: "Saved" }); refresh(); }, onError: fail });
  const add = useMutation({ mutationFn: () => call("POST", `/api/partner/${partnerId}/members`, { phone: member, role: "staff" }), onSuccess: () => { toast({ title: "Staff added" }); setMember(""); refresh(); }, onError: fail });
  const remove = useMutation({ mutationFn: (userId: number) => call("DELETE", `/api/partner/${partnerId}/members/${userId}`), onSuccess: refresh, onError: fail });
  const link = `${window.location.origin}/p/${d.partner.slug}`;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Your brand</CardTitle><CardDescription>Shown on your panel and to your businesses ("Managed by …"). Your sign-in page: <a className="underline" href={link}>{link}</a></CardDescription></CardHeader>
        <CardContent className="space-y-2">
          {(["brandName", "logoUrl", "primaryColor", "supportEmail", "supportPhone"] as const).map((k) => (
            <div key={k} className="grid grid-cols-[130px_1fr] items-center gap-2">
              <Label className="text-xs">{({ brandName: "Brand name", logoUrl: "Logo link (https)", primaryColor: "Colour (#hex)", supportEmail: "Support email", supportPhone: "Support phone" })[k]}</Label>
              <Input value={brand[k]} onChange={(e) => setBrand({ ...brand, [k]: e.target.value })} disabled={!isOwner} data-testid={`input-brand-${k}`} />
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Where your businesses pay you</CardTitle><CardDescription>Your businesses see these when they buy credit or a plan.</CardDescription></CardHeader>
        <CardContent className="space-y-2">
          {(["upiId", "payeeName", "bankName", "accountNumber", "ifsc"] as const).map((k) => (
            <div key={k} className="grid grid-cols-[130px_1fr] items-center gap-2">
              <Label className="text-xs">{({ upiId: "UPI ID", payeeName: "Name", bankName: "Bank", accountNumber: "Account no.", ifsc: "IFSC" })[k]}</Label>
              <Input value={pay[k] ?? ""} onChange={(e) => setPay({ ...pay, [k]: e.target.value })} disabled={!isOwner} data-testid={`input-pay-${k}`} />
            </div>
          ))}
          <Textarea rows={2} value={pay.note ?? ""} onChange={(e) => setPay({ ...pay, note: e.target.value })} placeholder="Note for your businesses (GST, invoice…)" disabled={!isOwner} />
        </CardContent>
      </Card>
      <div className="lg:col-span-2"><Button disabled={!isOwner || save.isPending} onClick={() => save.mutate()} data-testid="button-partner-save">Save brand and payment details</Button></div>
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle className="text-base">Your team</CardTitle><CardDescription>Staff can see businesses and add new ones. Only owners move money.</CardDescription></CardHeader>
        <CardContent className="space-y-2">
          {d.members.map((m) => (
            <div key={m.userId} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
              <span>{m.name ?? m.phone} <span className="text-muted-foreground">{m.phone}</span></span>
              <span className="flex items-center gap-2"><Badge variant={m.role === "owner" ? "default" : "secondary"}>{m.role}</Badge>
                {isOwner && m.role !== "owner" && <Button size="sm" variant="ghost" onClick={() => remove.mutate(m.userId)}>Remove</Button>}</span>
            </div>
          ))}
          {isOwner && (
            <div className="flex gap-2"><Input placeholder="Staff mobile number" value={member} onChange={(e) => setMember(e.target.value)} /><Button size="sm" disabled={member.trim().length < 8 || add.isPending} onClick={() => add.mutate()}>Add staff</Button></div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
