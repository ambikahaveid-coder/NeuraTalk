import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { serverMessage } from "@/lib/server-message";
import { rupeesText } from "@/components/BusinessMessageExtras";

type Plan = { kind: string; pricePaise: number; trialDays: number; voiceMinutes: number; trialVoiceMinutes: number; extraMinutePaise: number };
type Sub = { kind: string; ownerId: number; name: string | null; status: string; trialEndsAt: string | null; periodEnd: string | null; voiceSecondsUsed: number; paused: boolean; note: string | null; sessions30d: number };
type Pay = { id: number; ownerId: number; name: string | null; amountPaise: number; reference: string; createdAt: string };
type Data = { plans: Plan[]; subscriptions: Sub[]; pendingPayments: Pay[]; last30Days: Array<{ kind: string; sessions: number; voiceSeconds: number; calls: number; handoffs: number }>; model: string };

const day = (s: string | null) => (s ? new Date(s).toLocaleDateString() : "—");

/** Super admin: AI assistant plans, who has it, payments to confirm, pause/resume/extend. */
export function AssistantAdminSection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const key = ["/api/admin/assistant"];
  const q = useQuery<Data>({ queryKey: key, queryFn: async () => (await apiRequest("GET", "/api/admin/assistant")).json() });
  const [edit, setEdit] = useState<Record<string, Plan>>({});

  async function act(path: string, body: Record<string, unknown> = {}, done = "Saved") {
    try {
      await apiRequest("POST", path, body);
      toast({ title: done });
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast({ title: "Couldn't do that", description: serverMessage(e, "Try again."), variant: "destructive" });
    }
  }
  async function savePlan(p: Plan) {
    try {
      await apiRequest("PUT", `/api/admin/assistant/plans/${p.kind}`, p);
      toast({ title: "Plan saved" });
      setEdit((e) => { const n = { ...e }; delete n[p.kind]; return n; });
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast({ title: "Couldn't save", description: serverMessage(e, "Check the numbers."), variant: "destructive" });
    }
  }

  if (q.isLoading) return <Loader2 className="w-5 h-5 animate-spin" />;
  if (!q.data) return <p className="text-sm text-destructive">Could not load.</p>;
  const d = q.data;
  const num = (kind: string, field: keyof Plan, v: string) => setEdit((e) => ({ ...e, [kind]: { ...(e[kind] ?? d.plans.find((p) => p.kind === kind)!), [field]: Number(v) || 0 } }));

  return (
    <div className="space-y-4" data-testid="assistant-admin">
      <div>
        <h2 className="text-xl font-semibold">AI Assistant</h2>
        <p className="text-sm text-muted-foreground">Personal assistants and business AI receptionists: plans, who uses them, payments to confirm. AI model: {d.model}.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Plans</CardTitle><CardDescription>Price is per 30 days. Call minutes cost NeuraTalk about ₹3–5 each in AI; keep them covered.</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Plan</TableHead><TableHead>Price (paise)</TableHead><TableHead>Trial days</TableHead><TableHead>Call min / month</TableHead><TableHead>Trial call min</TableHead><TableHead>Extra min (paise)</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {d.plans.map((p0) => {
                const p = edit[p0.kind] ?? p0;
                return (
                  <TableRow key={p.kind} data-testid={`plan-${p.kind}`}>
                    <TableCell className="font-medium capitalize">{p.kind} <span className="text-xs text-muted-foreground">({rupeesText(p.pricePaise)})</span></TableCell>
                    {(["pricePaise", "trialDays", "voiceMinutes", "trialVoiceMinutes", "extraMinutePaise"] as const).map((f) => (
                      <TableCell key={f}><Input className="w-24" inputMode="numeric" value={String(p[f])} onChange={(e) => num(p.kind, f, e.target.value)} aria-label={`${p.kind} ${f}`} /></TableCell>
                    ))}
                    <TableCell>{edit[p.kind] && <Button size="sm" onClick={() => savePlan(p)}>Save</Button>}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <p className="mt-2 text-xs text-muted-foreground">
            Last 30 days: {d.last30Days.map((t) => `${t.kind}: ${t.sessions} conversations, ${t.calls} calls, ${Math.round(t.voiceSeconds / 60)} call min, ${t.handoffs} handovers`).join(" · ") || "no use yet"}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Payments to confirm ({d.pendingPayments.length})</CardTitle><CardDescription>People paid NeuraTalk by UPI for their personal assistant. Check the UTR in the bank account, then approve.</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto">
          {!d.pendingPayments.length ? <p className="text-sm text-muted-foreground">None waiting.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Person</TableHead><TableHead>Amount</TableHead><TableHead>UTR</TableHead><TableHead>When</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {d.pendingPayments.map((p) => (
                  <TableRow key={p.id} data-testid={`assistant-pay-${p.id}`}>
                    <TableCell>{p.name ?? `User ${p.ownerId}`}</TableCell><TableCell>{rupeesText(p.amountPaise)}</TableCell>
                    <TableCell className="font-mono text-xs">{p.reference}</TableCell><TableCell>{new Date(p.createdAt).toLocaleString()}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Button size="sm" onClick={() => act(`/api/admin/assistant/payments/${p.id}/approve`, {}, "Approved: 30 days added")}>Approve</Button>
                      <Button size="sm" variant="ghost" onClick={() => act(`/api/admin/assistant/payments/${p.id}/reject`, { note: "Payment not found" }, "Rejected")}>Reject</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Who has it</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {!d.subscriptions.length ? <p className="text-sm text-muted-foreground">No one yet.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Until</TableHead><TableHead>Call min used</TableHead><TableHead>Conversations (30d)</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {d.subscriptions.map((s) => (
                  <TableRow key={`${s.kind}-${s.ownerId}`}>
                    <TableCell>{s.name ?? `#${s.ownerId}`}</TableCell>
                    <TableCell className="capitalize">{s.kind}</TableCell>
                    <TableCell><Badge variant={s.paused ? "destructive" : s.status === "active" ? "default" : "secondary"}>{s.paused ? "paused" : s.status}</Badge></TableCell>
                    <TableCell>{day(s.status === "trial" ? s.trialEndsAt : s.periodEnd)}</TableCell>
                    <TableCell>{Math.round(s.voiceSecondsUsed / 60)}</TableCell>
                    <TableCell>{s.sessions30d}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {s.paused
                        ? <Button size="sm" variant="outline" onClick={() => act(`/api/admin/assistant/${s.kind}/${s.ownerId}`, { action: "resume" }, "Resumed")}>Resume</Button>
                        : <Button size="sm" variant="outline" onClick={() => act(`/api/admin/assistant/${s.kind}/${s.ownerId}`, { action: "pause", note: "Paused by NeuraTalk" }, "Paused")}>Pause</Button>}
                      <Button size="sm" variant="ghost" onClick={() => act(`/api/admin/assistant/${s.kind}/${s.ownerId}`, { action: "extend", days: 30 }, "30 days added")}>+30 days</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
