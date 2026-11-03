import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, Plus, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { getAuthToken } from "@/hooks/use-auth";

type Req = { id: number; businessId: number; businessName: string; pricePaise: number; creditPaise: number; method: string; paymentReference: string; note: string | null; status: string; requestedBy: string | number; decisionNote: string | null; createdAt: string; decidedAt: string | null };
type Pack = { id: number; name: string; pricePaise: number; creditPaise: number; bonusPaise: number; isActive: boolean; displayOrder: number };
type Payment = { upiId: string; payeeName: string; bankName: string; accountNumber: string; ifsc: string; note: string };
type Data = {
  pending: Req[]; recent: Req[]; packs: Pack[]; payment: Payment;
  standardPrices: { marketingPaise: number; utilityPaise: number; otpPaise: number };
  specialRates: Array<{ businessId: number; name: string; marketingPaise: number | null; utilityPaise: number | null; otpPaise: number | null; lowBalancePaise: number | null }>;
  last30d: { receivedPaise: number; creditedPaise: number; spentPaise: number };
  lowBalance: Array<{ businessId: number; name: string; balancePaise: number; levelPaise: number }>;
};

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken() ?? ""}` }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || data?.message || `Request failed (${res.status})`);
  return data as T;
}
const rs = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (s: string | null) => (s ? new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");
const METHOD: Record<string, string> = { upi: "UPI", bank_transfer: "Bank transfer", cheque: "Cheque", cash_deposit: "Cash deposit" };
const paiseOrNull = (v: string) => (v.trim() === "" ? null : Math.round(Number(v)));

/** Super admin: confirm business payments, credit packs, payment details and special rates. */
export function MessageCreditsAdminSection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const key = ["/api/admin/message-credits"];
  const q = useQuery<Data>({ queryKey: key, queryFn: () => call("GET", "/api/admin/message-credits") });
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const fail = (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" });
  const [rejecting, setRejecting] = useState<{ id: number; reason: string } | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [pack, setPack] = useState<{ id?: number; name: string; price: string; credit: string; isActive: boolean } | null>(null);
  const [rate, setRate] = useState({ orgId: "", marketing: "", utility: "", otp: "", low: "" });

  const approve = useMutation({ mutationFn: (id: number) => call("POST", `/api/admin/message-credits/requests/${id}/approve`, {}), onSuccess: () => { toast({ title: "Payment confirmed. Credit added." }); refresh(); }, onError: fail });
  const reject = useMutation({ mutationFn: () => call("POST", `/api/admin/message-credits/requests/${rejecting!.id}/reject`, { reason: rejecting!.reason }), onSuccess: () => { toast({ title: "Marked as not confirmed" }); setRejecting(null); refresh(); }, onError: fail });
  const savePayment = useMutation({ mutationFn: () => call("PUT", "/api/admin/message-credits/payment-details", payment), onSuccess: () => { toast({ title: "Payment details saved" }); setPayment(null); refresh(); }, onError: fail });
  const savePack = useMutation({
    mutationFn: () => {
      const body = { name: pack!.name, pricePaise: Math.round(Number(pack!.price) * 100), creditPaise: Math.round(Number(pack!.credit) * 100), isActive: pack!.isActive };
      return pack!.id ? call("PUT", `/api/admin/message-credits/packs/${pack!.id}`, body) : call("POST", "/api/admin/message-credits/packs", body);
    },
    onSuccess: () => { toast({ title: "Pack saved" }); setPack(null); refresh(); }, onError: fail,
  });
  const saveRate = useMutation({
    mutationFn: () => call("PUT", `/api/admin/message-credits/rates/${rate.orgId}`, {
      marketingPaise: paiseOrNull(rate.marketing), utilityPaise: paiseOrNull(rate.utility), otpPaise: paiseOrNull(rate.otp),
      lowBalancePaise: rate.low.trim() === "" ? null : Math.round(Number(rate.low) * 100),
    }),
    onSuccess: () => { toast({ title: "Rates saved" }); setRate({ orgId: "", marketing: "", utility: "", otp: "", low: "" }); refresh(); }, onError: fail,
  });

  if (q.isLoading) return <Loader2 className="mx-auto h-5 w-5 animate-spin" />;
  if (q.error || !q.data) return <p className="text-sm text-destructive">{(q.error as Error)?.message}</p>;
  const d = q.data;
  const p = payment ?? d.payment;

  return (
    <div className="space-y-4" data-testid="message-credits-admin">
      <div>
        <h2 className="text-xl font-semibold">Message credits</h2>
        <p className="text-sm text-muted-foreground">Businesses pay first. Check each payment in the bank statement before you confirm it. Confirming adds the credit and is recorded in the wallet ledger and Audit Logs.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {[["Waiting for you", String(d.pending.length)], ["Received (30 days)", rs(d.last30d.receivedPaise)], ["Credit given (30 days)", rs(d.last30d.creditedPaise)], ["Spent by businesses (30 days)", rs(d.last30d.spentPaise)]].map(([l, v]) => (
          <Card key={l}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{l}</p><p className="mt-1 text-2xl font-semibold">{v}</p></CardContent></Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Payments to confirm</CardTitle><CardDescription>Match the UTR and amount with your bank statement first.</CardDescription></CardHeader>
        <CardContent>
          {d.pending.length === 0 ? <p className="text-sm text-muted-foreground">Nothing waiting.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Business</TableHead><TableHead className="text-right">Paid</TableHead><TableHead className="text-right">Credit</TableHead><TableHead>Method · reference</TableHead><TableHead>Sent</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {d.pending.map((r) => (
                  <TableRow key={r.id} data-testid={`pending-${r.id}`}>
                    <TableCell className="font-medium">{r.businessName} <span className="text-xs text-muted-foreground">#{r.businessId}</span><p className="text-xs text-muted-foreground">by {String(r.requestedBy)}</p></TableCell>
                    <TableCell className="text-right font-semibold">{rs(r.pricePaise)}</TableCell>
                    <TableCell className="text-right">{rs(r.creditPaise)}</TableCell>
                    <TableCell className="text-xs">{METHOD[r.method] ?? r.method} · <span className="font-mono">{r.paymentReference}</span></TableCell>
                    <TableCell className="text-xs">{when(r.createdAt)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <Button size="sm" onClick={() => { if (confirm(`Confirm ${rs(r.pricePaise)} received from ${r.businessName} (ref ${r.paymentReference})? ${rs(r.creditPaise)} credit will be added.`)) approve.mutate(r.id); }} disabled={approve.isPending} data-testid={`approve-${r.id}`}>
                        <CheckCircle2 className="mr-1 h-4 w-4" /> Confirm
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setRejecting({ id: r.id, reason: "" })} data-testid={`reject-${r.id}`}><XCircle className="mr-1 h-4 w-4" /> Not received</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {rejecting && (
            <div className="mt-3 space-y-2 rounded-md border p-3">
              <Label>Why isn't it confirmed? (the business sees this)</Label>
              <Textarea rows={2} value={rejecting.reason} onChange={(e) => setRejecting({ ...rejecting, reason: e.target.value })} placeholder="No payment with this UTR reached our account. Check the reference and send it again." />
              <div className="flex gap-2"><Button size="sm" variant="destructive" disabled={rejecting.reason.trim().length < 5 || reject.isPending} onClick={() => reject.mutate()}>Mark not received</Button><Button size="sm" variant="outline" onClick={() => setRejecting(null)}>Cancel</Button></div>
            </div>
          )}
        </CardContent>
      </Card>

      {d.lowBalance.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-amber-500" /> Active businesses with low balance</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {d.lowBalance.map((l) => <p key={l.businessId} className="text-sm">{l.name} #{l.businessId}: <strong>{rs(l.balancePaise)}</strong> <span className="text-muted-foreground">(warning below {rs(l.levelPaise)})</span></p>)}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div><CardTitle className="text-base">Credit packs</CardTitle><CardDescription>What businesses can buy. Bonus = credit above the price.</CardDescription></div>
            <Button size="sm" onClick={() => setPack({ name: "", price: "", credit: "", isActive: true })} data-testid="button-new-pack"><Plus className="mr-1 h-4 w-4" /> Pack</Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {d.packs.length === 0 && <p className="text-sm text-muted-foreground">No packs yet. Businesses can still pay any amount from ₹500.</p>}
            {d.packs.map((k) => (
              <button key={k.id} type="button" className="flex w-full items-center justify-between rounded-md border p-3 text-left text-sm hover:bg-muted/50"
                onClick={() => setPack({ id: k.id, name: k.name, price: String(k.pricePaise / 100), credit: String(k.creditPaise / 100), isActive: k.isActive })}>
                <span><strong>{k.name}</strong> · pay {rs(k.pricePaise)} → {rs(k.creditPaise)}{k.bonusPaise > 0 ? ` (+${rs(k.bonusPaise)})` : ""}</span>
                {k.isActive ? <Badge variant="secondary">On sale</Badge> : <Badge variant="outline">Hidden</Badge>}
              </button>
            ))}
            {pack && (
              <div className="space-y-2 rounded-md border p-3">
                <div className="grid gap-2 sm:grid-cols-3">
                  <div><Label>Name</Label><Input value={pack.name} onChange={(e) => setPack({ ...pack, name: e.target.value })} placeholder="Growth" data-testid="input-pack-name" /></div>
                  <div><Label>Price ₹</Label><Input type="number" value={pack.price} onChange={(e) => setPack({ ...pack, price: e.target.value })} placeholder="1000" data-testid="input-pack-price" /></div>
                  <div><Label>Credit ₹</Label><Input type="number" value={pack.credit} onChange={(e) => setPack({ ...pack, credit: e.target.value })} placeholder="1050" data-testid="input-pack-credit" /></div>
                </div>
                <label className="flex items-center gap-2 text-sm"><Switch checked={pack.isActive} onCheckedChange={(v) => setPack({ ...pack, isActive: v })} /> On sale</label>
                <div className="flex gap-2"><Button size="sm" onClick={() => savePack.mutate()} disabled={savePack.isPending} data-testid="button-save-pack">Save pack</Button><Button size="sm" variant="outline" onClick={() => setPack(null)}>Cancel</Button></div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Where businesses pay</CardTitle><CardDescription>Shown to businesses on their credits page. Use NeuraTalk's (Mindwhile IT Solutions) business account only.</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            {(["upiId", "payeeName", "bankName", "accountNumber", "ifsc"] as const).map((f) => (
              <div key={f} className="grid grid-cols-[120px_1fr] items-center gap-2">
                <Label className="text-xs">{({ upiId: "UPI ID", payeeName: "Name", bankName: "Bank", accountNumber: "Account no.", ifsc: "IFSC" })[f]}</Label>
                <Input value={p[f]} onChange={(e) => setPayment({ ...p, [f]: e.target.value })} data-testid={`input-pay-${f}`} />
              </div>
            ))}
            <Textarea rows={2} value={p.note} onChange={(e) => setPayment({ ...p, note: e.target.value })} placeholder="e.g. Prices include 18% GST. A GST invoice is emailed after confirmation." />
            <Button size="sm" disabled={!payment || savePayment.isPending} onClick={() => savePayment.mutate()} data-testid="button-save-payment">Save payment details</Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Special rates for one business</CardTitle>
          <CardDescription>
            Standard price per delivered message: offers {rs(d.standardPrices.marketingPaise)}, updates {rs(d.standardPrices.utilityPaise)}, codes {rs(d.standardPrices.otpPaise)} (change them in Companies → message prices). Leave a box empty to use the standard price. Rates are in paise.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-5">
            <Input placeholder="Company id" value={rate.orgId} onChange={(e) => setRate({ ...rate, orgId: e.target.value })} data-testid="input-rate-org" />
            <Input placeholder="Offers (paise)" value={rate.marketing} onChange={(e) => setRate({ ...rate, marketing: e.target.value })} data-testid="input-rate-marketing" />
            <Input placeholder="Updates (paise)" value={rate.utility} onChange={(e) => setRate({ ...rate, utility: e.target.value })} />
            <Input placeholder="Codes (paise)" value={rate.otp} onChange={(e) => setRate({ ...rate, otp: e.target.value })} />
            <Input placeholder="Low balance warning ₹" value={rate.low} onChange={(e) => setRate({ ...rate, low: e.target.value })} />
          </div>
          <Button size="sm" disabled={!/^\d+$/.test(rate.orgId) || saveRate.isPending} onClick={() => saveRate.mutate()} data-testid="button-save-rate">Save rates</Button>
          {d.specialRates.length > 0 && (
            <Table>
              <TableHeader><TableRow><TableHead>Business</TableHead><TableHead className="text-right">Offers</TableHead><TableHead className="text-right">Updates</TableHead><TableHead className="text-right">Codes</TableHead><TableHead className="text-right">Low balance at</TableHead></TableRow></TableHeader>
              <TableBody>
                {d.specialRates.map((r) => (
                  <TableRow key={r.businessId} className="cursor-pointer" onClick={() => setRate({ orgId: String(r.businessId), marketing: r.marketingPaise?.toString() ?? "", utility: r.utilityPaise?.toString() ?? "", otp: r.otpPaise?.toString() ?? "", low: r.lowBalancePaise != null ? String(r.lowBalancePaise / 100) : "" })}>
                    <TableCell>{r.name} #{r.businessId}</TableCell>
                    <TableCell className="text-right">{r.marketingPaise != null ? rs(r.marketingPaise) : "standard"}</TableCell>
                    <TableCell className="text-right">{r.utilityPaise != null ? rs(r.utilityPaise) : "standard"}</TableCell>
                    <TableCell className="text-right">{r.otpPaise != null ? rs(r.otpPaise) : "standard"}</TableCell>
                    <TableCell className="text-right">{r.lowBalancePaise != null ? rs(r.lowBalancePaise) : "₹100.00"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {d.recent.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Recent decisions</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {d.recent.map((r) => (
              <p key={r.id} className="text-sm">
                <span className="text-muted-foreground">{when(r.decidedAt)}</span> · {r.businessName} · {rs(r.pricePaise)} · <span className="font-mono text-xs">{r.paymentReference}</span> ·{" "}
                {r.status === "approved" ? <Badge variant="secondary">Confirmed</Badge> : r.status === "rejected" ? <Badge variant="destructive">Not received</Badge> : <Badge variant="outline">{r.status}</Badge>}
              </p>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
