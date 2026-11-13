import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, Loader2, PauseCircle, PlayCircle, Plus, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { getAuthToken } from "@/hooks/use-auth";

type Partner = {
  id: number; name: string; brandName: string; slug: string; status: string; pauseReason: string | null; bonusPercent: number;
  rates: { marketingPaise: number | null; utilityPaise: number | null; otpPaise: number | null };
  walletPaise: number; businesses: number; spent30Paise: number; supportEmail: string | null; createdAt: string;
};
type Topup = { id: number; partnerId: number; brandName: string; amountPaise: number; creditPaise: number; method: string; paymentReference: string; createdAt: string };

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken() ?? ""}` }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || data?.message || `Request failed (${res.status})`);
  return data as T;
}
const rs = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (s: string) => new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
const paise = (v: string) => (v.trim() === "" ? null : Math.round(Number(v)));

/** Super admin: partners (resellers) who sell NeuraTalk Business under their own brand. */
export function PartnersAdminSection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const key = ["/api/admin/partners"];
  const q = useQuery<{ partners: Partner[]; pendingTopups: Topup[] }>({ queryKey: key, queryFn: () => call("GET", "/api/admin/partners") });
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const fail = (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" });
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", brandName: "", slug: "", ownerPhone: "", bonusPercent: "0", marketing: "", utility: "", otp: "" });
  const [edit, setEdit] = useState<{ p: Partner; bonus: string; marketing: string; utility: string; otp: string; reason: string; attach: string } | null>(null);
  const [rejecting, setRejecting] = useState<{ id: number; reason: string } | null>(null);

  const create = useMutation({
    mutationFn: () => call("POST", "/api/admin/partners", {
      name: form.name, brandName: form.brandName, slug: form.slug, ownerPhone: form.ownerPhone, bonusPercent: Number(form.bonusPercent) || 0,
      marketingPaise: paise(form.marketing), utilityPaise: paise(form.utility), otpPaise: paise(form.otp),
    }),
    onSuccess: () => { toast({ title: "Partner created", description: "The owner opens /partner after signing in." }); setCreating(false); refresh(); },
    onError: fail,
  });
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => call("PATCH", `/api/admin/partners/${edit!.p.id}`, body),
    onSuccess: () => { toast({ title: "Saved" }); setEdit(null); refresh(); }, onError: fail,
  });
  const attach = useMutation({
    mutationFn: () => call("POST", `/api/admin/partners/${edit!.p.id}/businesses`, { businessId: Number(edit!.attach) }),
    onSuccess: () => { toast({ title: "Business moved under the partner" }); refresh(); }, onError: fail,
  });
  const approve = useMutation({ mutationFn: (id: number) => call("POST", `/api/admin/partners/topups/${id}/approve`, {}), onSuccess: () => { toast({ title: "Credit added to the partner" }); refresh(); }, onError: fail });
  const reject = useMutation({ mutationFn: () => call("POST", `/api/admin/partners/topups/${rejecting!.id}/reject`, { reason: rejecting!.reason }), onSuccess: () => { setRejecting(null); refresh(); }, onError: fail });

  if (q.isLoading) return <Loader2 className="mx-auto h-5 w-5 animate-spin" />;
  if (q.error || !q.data) return <p className="text-sm text-destructive">{(q.error as Error)?.message}</p>;
  const d = q.data;

  return (
    <div className="space-y-4" data-testid="partners-admin">
      <div>
        <h2 className="text-xl font-semibold">Partners</h2>
        <p className="text-sm text-muted-foreground">
          Resellers who sell NeuraTalk Business under their own brand. A partner pays NeuraTalk for wholesale credit (you confirm it here),
          then gives credit and plans to its own businesses. Partners only ever see their own businesses.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Partner payments to confirm</CardTitle><CardDescription>Match the UTR and amount with your bank statement first.</CardDescription></CardHeader>
        <CardContent className="space-y-2">
          {d.pendingTopups.length === 0 ? <p className="text-sm text-muted-foreground">Nothing waiting.</p> : d.pendingTopups.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm" data-testid={`topup-${t.id}`}>
              <span><strong>{t.brandName}</strong> paid {rs(t.amountPaise)} → credit {rs(t.creditPaise)} · {t.method} · <span className="font-mono">{t.paymentReference}</span> · {when(t.createdAt)}</span>
              <span className="flex gap-2">
                <Button size="sm" onClick={() => { if (confirm(`Confirm ${rs(t.amountPaise)} received from ${t.brandName} (ref ${t.paymentReference})?`)) approve.mutate(t.id); }} data-testid={`approve-topup-${t.id}`}><CheckCircle2 className="mr-1 h-4 w-4" />Confirm</Button>
                <Button size="sm" variant="ghost" onClick={() => setRejecting({ id: t.id, reason: "" })}><XCircle className="mr-1 h-4 w-4" />Not received</Button>
              </span>
            </div>
          ))}
          {rejecting && (
            <div className="space-y-2 rounded-md border p-3">
              <Textarea rows={2} placeholder="Reason (the partner sees it)" value={rejecting.reason} onChange={(e) => setRejecting({ ...rejecting, reason: e.target.value })} />
              <div className="flex gap-2"><Button size="sm" variant="destructive" disabled={rejecting.reason.trim().length < 5} onClick={() => reject.mutate()}>Mark not received</Button><Button size="sm" variant="outline" onClick={() => setRejecting(null)}>Cancel</Button></div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div><CardTitle className="text-base">All partners ({d.partners.length})</CardTitle><CardDescription>Rates are wholesale prices per delivered message (paise). Empty = standard price.</CardDescription></div>
          <Button size="sm" onClick={() => setCreating(true)} data-testid="button-new-partner"><Plus className="mr-1 h-4 w-4" />Partner</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {creating && (
            <div className="space-y-3 rounded-md border p-3" data-testid="new-partner-form">
              <div className="grid gap-2 sm:grid-cols-4">
                <div><Label>Company name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Andhra Digital Pvt Ltd" /></div>
                <div><Label>Brand shown</Label><Input value={form.brandName} onChange={(e) => setForm({ ...form, brandName: e.target.value })} placeholder="AndhraConnect" /></div>
                <div><Label>Link name (/p/…)</Label><Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} placeholder="andhraconnect" /></div>
                <div><Label>Owner's mobile</Label><Input value={form.ownerPhone} onChange={(e) => setForm({ ...form, ownerPhone: e.target.value })} placeholder="98765 43210" /></div>
                <div><Label>Bonus % on top-ups</Label><Input type="number" value={form.bonusPercent} onChange={(e) => setForm({ ...form, bonusPercent: e.target.value })} /></div>
                <div><Label>Offers (paise)</Label><Input value={form.marketing} onChange={(e) => setForm({ ...form, marketing: e.target.value })} placeholder="standard" /></div>
                <div><Label>Updates (paise)</Label><Input value={form.utility} onChange={(e) => setForm({ ...form, utility: e.target.value })} placeholder="standard" /></div>
                <div><Label>Codes (paise)</Label><Input value={form.otp} onChange={(e) => setForm({ ...form, otp: e.target.value })} placeholder="standard" /></div>
              </div>
              <p className="text-xs text-muted-foreground">The owner must have signed in to NeuraTalk once with this number, and it must not run a business.</p>
              <div className="flex gap-2"><Button size="sm" disabled={create.isPending} onClick={() => create.mutate()}>Create partner</Button><Button size="sm" variant="outline" onClick={() => setCreating(false)}>Cancel</Button></div>
            </div>
          )}
          {d.partners.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No partners yet.</p> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Partner</TableHead><TableHead className="text-right">Businesses</TableHead><TableHead className="text-right">Wallet</TableHead><TableHead className="text-right">Spent 30d</TableHead><TableHead>Deal</TableHead><TableHead>State</TableHead><TableHead /></TableRow></TableHeader>
                <TableBody>
                  {d.partners.map((p) => (
                    <TableRow key={p.id} data-testid={`partner-row-${p.id}`}>
                      <TableCell><p className="font-medium">{p.brandName}</p><a className="inline-flex items-center gap-1 text-xs text-primary" href={`/p/${p.slug}`} target="_blank" rel="noreferrer">/p/{p.slug}<ExternalLink className="h-3 w-3" /></a></TableCell>
                      <TableCell className="text-right">{p.businesses}</TableCell>
                      <TableCell className="text-right">{rs(p.walletPaise)}</TableCell>
                      <TableCell className="text-right">{rs(p.spent30Paise)}</TableCell>
                      <TableCell className="text-xs">{p.bonusPercent}% bonus · offers {p.rates.marketingPaise != null ? `${p.rates.marketingPaise}p` : "standard"}</TableCell>
                      <TableCell>{p.status === "active" ? <Badge variant="secondary">Active</Badge> : <Badge variant="destructive">Paused</Badge>}</TableCell>
                      <TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => setEdit({ p, bonus: String(p.bonusPercent), marketing: p.rates.marketingPaise?.toString() ?? "", utility: p.rates.utilityPaise?.toString() ?? "", otp: p.rates.otpPaise?.toString() ?? "", reason: "", attach: "" })}>Manage</Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {edit && (
            <div className="grid gap-4 rounded-md border p-3 md:grid-cols-3" data-testid="edit-partner">
              <div className="space-y-2">
                <p className="text-sm font-medium">{edit.p.brandName}: deal</p>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label className="text-xs">Bonus %</Label><Input type="number" value={edit.bonus} onChange={(e) => setEdit({ ...edit, bonus: e.target.value })} /></div>
                  <div><Label className="text-xs">Offers (p)</Label><Input value={edit.marketing} onChange={(e) => setEdit({ ...edit, marketing: e.target.value })} placeholder="standard" /></div>
                  <div><Label className="text-xs">Updates (p)</Label><Input value={edit.utility} onChange={(e) => setEdit({ ...edit, utility: e.target.value })} placeholder="standard" /></div>
                  <div><Label className="text-xs">Codes (p)</Label><Input value={edit.otp} onChange={(e) => setEdit({ ...edit, otp: e.target.value })} placeholder="standard" /></div>
                </div>
                <Button size="sm" onClick={() => save.mutate({ bonusPercent: Number(edit.bonus) || 0, marketingPaise: paise(edit.marketing), utilityPaise: paise(edit.utility), otpPaise: paise(edit.otp) })}>Save deal</Button>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">{edit.p.status === "active" ? "Pause partner" : "Paused"}</p>
                {edit.p.status === "active" ? <>
                  <Input placeholder="Reason (the partner sees it)" value={edit.reason} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} />
                  <Button size="sm" variant="destructive" disabled={edit.reason.trim().length < 5} onClick={() => save.mutate({ status: "paused", pauseReason: edit.reason })}><PauseCircle className="mr-1 h-4 w-4" />Pause</Button>
                  <p className="text-xs text-muted-foreground">A paused partner can't move money or add businesses. Its businesses keep working with their own credit.</p>
                </> : <>
                  <p className="text-xs text-muted-foreground">{edit.p.pauseReason}</p>
                  <Button size="sm" onClick={() => save.mutate({ status: "active" })}><PlayCircle className="mr-1 h-4 w-4" />Resume</Button>
                </>}
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">Move an existing business under this partner</p>
                <Input placeholder="Company id" value={edit.attach} onChange={(e) => setEdit({ ...edit, attach: e.target.value })} />
                <Button size="sm" variant="outline" disabled={!/^\d+$/.test(edit.attach)} onClick={() => attach.mutate()}>Move business</Button>
                <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Close</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
