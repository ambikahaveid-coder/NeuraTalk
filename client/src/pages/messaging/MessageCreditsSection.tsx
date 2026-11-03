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
import { getAuthToken, useAuth } from "@/hooks/use-auth";

/**
 * Message credits: balance, this business's prices, packs, and buying credit
 * (pay by UPI / bank, send the UTR, NeuraTalk confirms and adds the credit).
 */

interface Pack { id: number; name: string; pricePaise: number; creditPaise: number; bonusPaise: number }
interface RechargeRequest { id: number; pricePaise: number; creditPaise: number; method: string; paymentReference: string; status: string; decisionNote: string | null; createdAt: string; decidedAt: string | null }
interface Overview {
  balancePaise: number; lowBalancePaise: number; isLow: boolean; daysLeft: number | null;
  rates: { marketingPaise: number; utilityPaise: number; otpPaise: number; special: boolean };
  packs: Pack[];
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
  pending: { label: "Waiting for NeuraTalk", icon: <Clock className="h-3 w-3" />, variant: "outline" },
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
  const [buying, setBuying] = useState<{ packId?: number; amountRupees?: string } | null>(null);
  const [method, setMethod] = useState("upi");
  const [reference, setReference] = useState("");

  const submit = useMutation({
    mutationFn: () => call("POST", `${base}/credits/requests`, {
      ...(buying?.packId ? { packId: buying.packId } : { amountPaise: Math.round(Number(buying?.amountRupees ?? 0) * 100) }),
      method, paymentReference: reference.trim(),
    }),
    onSuccess: () => { toast({ title: "Payment sent for confirmation", description: "NeuraTalk checks it with the bank and adds the credit, usually within a working day." }); setBuying(null); setReference(""); qc.invalidateQueries({ queryKey: key }); },
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
  const payRupees = selectedPack ? selectedPack.pricePaise / 100 : Number(buying?.amountRupees ?? 0);
  const amountOk = selectedPack || payRupees * 100 >= d.customAmount.minPaise;

  // Last 30 days by type
  const byCat = Object.entries(d.usage.reduce<Record<string, { m: number; a: number }>>((acc, u) => {
    acc[u.category] = { m: (acc[u.category]?.m ?? 0) + u.messages, a: (acc[u.category]?.a ?? 0) + u.amountPaise };
    return acc;
  }, {}));

  return (
    <div className="space-y-4" data-testid="message-credits">
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

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Buy message credit</CardTitle>
            <CardDescription>Pay first, then send us the payment reference. Credit is added after NeuraTalk confirms the payment with the bank.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!d.payment.ready ? (
              <p className="text-sm text-muted-foreground">Payment details aren't set up yet. Write to support@neuratalk.in to buy credit.</p>
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
                    className={`rounded-lg border border-dashed p-4 text-left hover:border-primary ${buying && !buying.packId ? "border-primary ring-2 ring-primary/30" : ""}`}>
                    <p className="text-sm font-medium">Other amount</p>
                    <p className="mt-1 text-sm text-muted-foreground">From {rs(d.customAmount.minPaise, 0)}</p>
                  </button>
                </div>

                {buying && (
                  <div className="grid gap-6 rounded-lg border p-4 lg:grid-cols-2">
                    <div className="space-y-2">
                      <p className="text-sm font-medium">1. Pay {payRupees > 0 ? rs(payRupees * 100) : "the amount"} to NeuraTalk</p>
                      {!selectedPack && (
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
              const s = STATUS[r.status] ?? STATUS.pending;
              return (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm" data-testid={`payment-${r.id}`}>
                  <div>
                    <p className="font-medium">Paid {rs(r.pricePaise)} → credit {rs(r.creditPaise)}</p>
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
