import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, Copy, Download, Loader2, Wallet, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { BrandMark } from "@/components/BrandMark";
import { getAuthToken, useAuth } from "@/hooks/use-auth";

/**
 * Message credits: balance, this business's prices, packs, and buying credit
 * (pay by UPI / bank, send the UTR, NeuraTalk confirms and adds the credit).
 */

interface Pack { id: number; name: string; pricePaise: number; creditPaise: number; bonusPaise: number }
interface RechargeRequest { id: number; kind?: string; planName?: string | null; pricePaise: number; creditPaise: number; method: string; paymentReference: string; status: string; decisionNote: string | null; createdAt: string; decidedAt: string | null }
interface Plan { id: number; name: string; description: string | null; pricePaise: number; durationDays: number; includedMinutes: number }
interface CurrentPlan { name: string | null; status: string; endsAt: string | null; daysLeft: number | null; minutesRemaining: number; inGrace: boolean; graceEndsAt: string | null; suspended: boolean; endingSoon: boolean }
interface Overview {
  balancePaise: number; lowBalancePaise: number; isLow: boolean; daysLeft: number | null;
  rates: { marketingPaise: number; utilityPaise: number; otpPaise: number; special: boolean };
  packs: Pack[];
  plan: CurrentPlan | null;
  plans: Plan[];
  managedBy?: { brandName: string; logoUrl: string | null; primaryColor: string | null; supportEmail: string | null; supportPhone: string | null } | null;
  payment: { ready: boolean; upiId: string; payeeName: string; bankName: string; accountNumber: string; ifsc: string; note: string };
  customAmount: { minPaise: number };
  requests: RechargeRequest[];
  usage: Array<{ day: string; category: string; messages: number; amountPaise: number }>;
  spent30dPaise: number;
}

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

const rs = (p: number, digits = 2) => `₹${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: 2 })}`;
const CATEGORY: Record<string, string> = { marketing: "Offers", utility: "Order & account updates", authentication: "Verification codes" };
const METHOD: Record<string, string> = { upi: "UPI", bank_transfer: "Bank transfer (NEFT/IMPS/RTGS)", cheque: "Cheque", cash_deposit: "Cash deposit at bank" };
const STATUS: Record<string, { label: string; icon: React.ReactNode; variant: "secondary" | "outline" | "destructive" | "default" }> = {
  pending: { label: "Waiting for confirmation", icon: <Clock className="h-3 w-3" />, variant: "outline" },
  approved: { label: "Credit added", icon: <CheckCircle2 className="h-3 w-3" />, variant: "secondary" },
  rejected: { label: "Not confirmed", icon: <XCircle className="h-3 w-3" />, variant: "destructive" },
  cancelled: { label: "Cancelled", icon: <XCircle className="h-3 w-3" />, variant: "outline" },
};

function CopyRow({ label, value }: { label: string; value: string }) {
  const { toast } = useToast();
  if (!value) return null;
  return (
    <div className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2 font-medium">
        {value}
        <button type="button" aria-label={`Copy ${label}`} onClick={() => { navigator.clipboard?.writeText(value); toast({ title: `${label} copied` }); }}>
          <Copy className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </span>
    </div>
  );
}

export default function MessageCreditsSection({ base }: { base: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = ["company_admin", "super_admin"].includes(String((user as { role?: string } | null)?.role ?? ""));
  const key = [base, "credits"];
  const q = useQuery<Overview>({ queryKey: key, queryFn: () => call("GET", `${base}/credits`), retry: false });
  const [buying, setBuying] = useState<{ packId?: number; planId?: number; amountRupees?: string } | null>(null);
  const [method, setMethod] = useState("upi");
  const [reference, setReference] = useState("");

  const submit = useMutation({
    mutationFn: () => call("POST", `${base}/credits/requests`, {
      ...(buying?.packId ? { packId: buying.packId } : buying?.planId ? { planId: buying.planId } : { amountPaise: Math.round(Number(buying?.amountRupees ?? 0) * 100) }),
      method, paymentReference: reference.trim(),
    }),
    onSuccess: () => { toast({ title: "Payment sent for confirmation", description: `${q.data?.managedBy?.brandName ?? "NeuraTalk"} checks it with the bank, usually within a working day. Then the credit is added or the plan starts.` }); setBuying(null); setReference(""); qc.invalidateQueries({ queryKey: key }); },
    onError: (e: Error) => toast({ title: "Couldn't send", description: e.message, variant: "destructive" }),
  });
  const cancel = useMutation({
    mutationFn: (id: number) => call("POST", `${base}/credits/requests/${id}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  if (q.isLoading) return <Loader2 className="mx-auto h-5 w-5 animate-spin" />;
  if (q.error || !q.data) return <p className="text-sm text-destructive">{(q.error as Error)?.message ?? "Couldn't load credits."}</p>;
  const d = q.data;
  const selectedPack = d.packs.find((p) => p.id === buying?.packId);
  const selectedPlan = d.plans.find((p) => p.id === buying?.planId);
  const payRupees = selectedPack ? selectedPack.pricePaise / 100 : selectedPlan ? selectedPlan.pricePaise / 100 : Number(buying?.amountRupees ?? 0);
  const amountOk = selectedPack || selectedPlan || payRupees * 100 >= d.customAmount.minPaise;
  const plan = d.plan;
  const day = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");

  // Last 30 days by type
  const byCat = Object.entries(d.usage.reduce<Record<string, { m: number; a: number }>>((acc, u) => {
    acc[u.category] = { m: (acc[u.category]?.m ?? 0) + u.messages, a: (acc[u.category]?.a ?? 0) + u.amountPaise };
    return acc;
  }, {}));

  return (
    <div className="space-y-4" data-testid="message-credits">
      {plan && (plan.suspended || plan.inGrace || plan.endingSoon) && (
        <div role="alert" data-testid="plan-banner"
          className={`flex items-start gap-2 rounded-md border p-3 text-sm ${plan.suspended || plan.inGrace ? "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"}`}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {plan.suspended
              ? <><strong>Your business is paused because the plan ended.</strong> Buy a plan below; it starts as soon as NeuraTalk confirms the payment.</>
              : plan.inGrace
                ? <><strong>Your plan ended.</strong> Renew by {day(plan.graceEndsAt)} or your business account will be paused.</>
                : <><strong>Your plan ends on {day(plan.endsAt)}.</strong> Renew it below so calls keep working.</>}
          </span>
        </div>
      )}
      {d.isLow && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200" data-testid="low-balance-banner">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span><strong>Balance is low.</strong> When it runs out, offers, updates and codes stop sending. Replies to customers who wrote to you stay free.</span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-4">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Wallet className="h-3.5 w-3.5" /> Balance</p>
          <p className="mt-1 text-3xl font-semibold" data-testid="text-credit-balance">{rs(d.balancePaise)}</p>
          {d.daysLeft !== null && <p className="text-xs text-muted-foreground">About {d.daysLeft} days at your usual pace</p>}
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Spent in the last 30 days</p>
          <p className="mt-1 text-3xl font-semibold">{rs(d.spent30dPaise)}</p>
          <p className="text-xs text-muted-foreground">{(() => { const n = d.usage.reduce((s, u) => s + u.messages, 0); return `${n.toLocaleString("en-IN")} paid message${n === 1 ? "" : "s"}`; })()}</p>
        </CardContent></Card>
        <Card><CardContent className="space-y-1 p-4">
          <p className="text-xs text-muted-foreground">Your price per delivered message {d.rates.special && <Badge variant="secondary" className="ml-1">Special rate</Badge>}</p>
          <p className="text-sm">Offers <strong>{rs(d.rates.marketingPaise)}</strong></p>
          <p className="text-sm">Order & account updates <strong>{rs(d.rates.utilityPaise)}</strong></p>
          <p className="text-sm">Verification codes <strong>{rs(d.rates.otpPaise)}</strong></p>
          <p className="text-xs text-muted-foreground">Replies to a customer who wrote in the last 24 hours: free. Customers not on NeuraTalk: never charged.</p>
        </CardContent></Card>
      </div>

      {d.managedBy && (
        <Card data-testid="managed-by-card">
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <BrandMark name={d.managedBy.brandName} logoUrl={d.managedBy.logoUrl} color={d.managedBy.primaryColor} />
            <div className="min-w-0 flex-1">
              <p className="font-medium">Managed by {d.managedBy.brandName}</p>
              <p className="text-xs text-muted-foreground">You buy credit and plans from {d.managedBy.brandName}. For help: {[d.managedBy.supportEmail, d.managedBy.supportPhone].filter(Boolean).join(" · ") || "contact your partner"}.</p>
            </div>
          </CardContent>
        </Card>
      )}
      <Card data-testid="plan-card">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="text-xs text-muted-foreground">Your plan (AI translated calls)</p>
            <p className="mt-1 text-lg font-semibold">{plan?.name ?? "No plan"}</p>
            {plan && (
              <p className="text-sm text-muted-foreground">
                {plan.minutesRemaining.toLocaleString("en-IN")} AI minutes left
                {plan.endsAt && !plan.inGrace && !plan.suspended ? ` · ends ${day(plan.endsAt)}` : ""}
                {plan.inGrace ? " · ended, renew soon" : ""}{plan.suspended ? " · paused" : ""}
              </p>
            )}
          </div>
          <p className="max-w-md text-xs text-muted-foreground">
            The plan gives AI translation minutes for calls. When they run out, calls are paid from your balance. Messages are always paid from your balance. Plans don't renew on their own.
          </p>
        </CardContent>
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Buy credit or a plan</CardTitle>
            <CardDescription>Pay first, then send the payment reference. After {d.managedBy?.brandName ?? "NeuraTalk"} confirms the payment with the bank, the credit is added or the plan starts.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!d.payment.ready ? (
              <p className="text-sm text-muted-foreground">
                {d.managedBy
                  ? `${d.managedBy.brandName} hasn't added its payment details yet. Contact ${d.managedBy.supportEmail || d.managedBy.supportPhone || "them"} to buy credit.`
                  : "Payment details aren't set up yet. Write to support@mindwhile.com to buy credit."}
              </p>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {d.packs.map((p) => (
                    <button key={p.id} type="button" onClick={() => setBuying({ packId: p.id })} data-testid={`pack-${p.id}`}
                      className={`rounded-lg border p-4 text-left transition hover:border-primary ${buying?.packId === p.id ? "border-primary ring-2 ring-primary/30" : ""}`}>
                      <p className="text-sm font-medium">{p.name}</p>
                      <p className="mt-1 text-2xl font-semibold">{rs(p.pricePaise, 0)}</p>
                      <p className="text-xs text-muted-foreground">You get {rs(p.creditPaise, 0)} credit</p>
                      {p.bonusPaise > 0 && <Badge className="mt-2" variant="secondary">+{rs(p.bonusPaise, 0)} bonus</Badge>}
                    </button>
                  ))}
                  <button type="button" onClick={() => setBuying({ amountRupees: "" })} data-testid="pack-custom"
                    className={`rounded-lg border border-dashed p-4 text-left hover:border-primary ${buying && !buying.packId && !buying.planId ? "border-primary ring-2 ring-primary/30" : ""}`}>
                    <p className="text-sm font-medium">Other amount</p>
                    <p className="mt-1 text-sm text-muted-foreground">From {rs(d.customAmount.minPaise, 0)}</p>
                  </button>
                </div>
                {d.plans.length > 0 && (
                  <>
                    <p className="text-sm font-medium">Plans for AI translated calls</p>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {d.plans.map((p) => (
                        <button key={p.id} type="button" onClick={() => setBuying({ planId: p.id })} data-testid={`plan-${p.id}`}
                          className={`rounded-lg border p-4 text-left transition hover:border-primary ${buying?.planId === p.id ? "border-primary ring-2 ring-primary/30" : ""}`}>
                          <p className="text-sm font-medium">{p.name}</p>
                          <p className="mt-1 text-2xl font-semibold">{rs(p.pricePaise, 0)}</p>
                          <p className="text-xs text-muted-foreground">{p.includedMinutes.toLocaleString("en-IN")} AI minutes · {p.durationDays} days</p>
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {buying && (
                  <div className="grid gap-6 rounded-lg border p-4 lg:grid-cols-2">
                    <div className="space-y-2">
                      <p className="text-sm font-medium">1. Pay {payRupees > 0 ? rs(payRupees * 100) : "the amount"} to {d.managedBy?.brandName ?? "NeuraTalk"}</p>
                      {selectedPlan && <p className="text-xs text-muted-foreground">{selectedPlan.name}: {selectedPlan.includedMinutes.toLocaleString("en-IN")} AI minutes for {selectedPlan.durationDays} days, starting when NeuraTalk confirms the payment.</p>}
                      {!selectedPack && !selectedPlan && (
                        <Input type="number" min={d.customAmount.minPaise / 100} placeholder={`Amount in ₹ (min ${d.customAmount.minPaise / 100})`} value={buying.amountRupees ?? ""}
                          onChange={(e) => setBuying({ amountRupees: e.target.value })} data-testid="input-custom-amount" />
                      )}
                      <CopyRow label="UPI ID" value={d.payment.upiId} />
                      <CopyRow label="Name" value={d.payment.payeeName} />
                      <CopyRow label="Bank" value={d.payment.bankName} />
                      <CopyRow label="Account" value={d.payment.accountNumber} />
                      <CopyRow label="IFSC" value={d.payment.ifsc} />
                      {d.payment.note && <p className="text-xs text-muted-foreground">{d.payment.note}</p>}
                    </div>
                    <div className="space-y-3">
                      <p className="text-sm font-medium">2. Tell us how you paid</p>
                      <div className="space-y-1.5">
                        <Label>Paid by</Label>
                        <Select value={method} onValueChange={setMethod}>
                          <SelectTrigger data-testid="select-pay-method"><SelectValue /></SelectTrigger>
                          <SelectContent>{Object.entries(METHOD).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="pay-ref">UTR / transaction reference</Label>
                        <Input id="pay-ref" value={reference} maxLength={40} onChange={(e) => setReference(e.target.value)} placeholder="e.g. 431245678912" data-testid="input-pay-reference" />
                        <p className="text-xs text-muted-foreground">Find it in your UPI or bank app, under the payment details.</p>
                      </div>
                      <div className="flex gap-2">
                        <Button onClick={() => submit.mutate()} disabled={submit.isPending || reference.trim().length < 6 || !amountOk} data-testid="button-submit-payment">
                          {submit.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} I've paid — send for confirmation
                        </Button>
                        <Button variant="outline" onClick={() => setBuying(null)}>Cancel</Button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {d.requests.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Your payments</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {d.requests.map((r) => {
              const isPlan = r.kind === "plan";
              const base = STATUS[r.status] ?? STATUS.pending;
              const s = isPlan && r.status === "approved" ? { ...base, label: "Plan started" } : base;
              return (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm" data-testid={`payment-${r.id}`}>
                  <div>
                    <p className="font-medium">{isPlan ? `Plan: ${r.planName ?? "plan"} · paid ${rs(r.pricePaise)}` : `Paid ${rs(r.pricePaise)} → credit ${rs(r.creditPaise)}`}</p>
                    <p className="text-xs text-muted-foreground">{METHOD[r.method] ?? r.method} · {r.paymentReference} · {new Date(r.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</p>
                    {r.status === "rejected" && r.decisionNote && <p className="mt-1 text-xs text-destructive">{r.decisionNote}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={s.variant} className="gap-1">{s.icon}{s.label}</Badge>
                    {r.status === "pending" && isAdmin && <Button size="sm" variant="ghost" onClick={() => cancel.mutate(r.id)}>Cancel</Button>}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Where the money went (30 days)</CardTitle>
            <CardDescription>Only delivered paid messages are counted.</CardDescription>
          </div>
          {isAdmin && (
            <Button size="sm" variant="outline" onClick={async () => {
              const res = await fetch(`${base}/credits/statement.csv`, { headers: { Authorization: `Bearer ${getAuthToken()}` } });
              const url = URL.createObjectURL(await res.blob());
              const a = document.createElement("a"); a.href = url; a.download = "neuratalk-statement.csv"; a.click(); URL.revokeObjectURL(url);
            }} data-testid="button-statement"><Download className="mr-1 h-4 w-4" /> Statement (CSV)</Button>
          )}
        </CardHeader>
        <CardContent>
          {byCat.length === 0 ? <p className="text-sm text-muted-foreground">No paid messages yet.</p> : (
            <div className="space-y-2">
              {byCat.map(([cat, v]) => (
                <div key={cat} className="flex items-center justify-between text-sm">
                  <span>{CATEGORY[cat] ?? cat}</span>
                  <span className="text-muted-foreground">{v.m.toLocaleString("en-IN")} messages · <strong className="text-foreground">{rs(v.a)}</strong></span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
