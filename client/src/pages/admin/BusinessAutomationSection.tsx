import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Loader2, PauseCircle, PlayCircle, Search, Send } from "lucide-react";
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

type CompanyRow = {
  id: number; name: string; bots: number; botsActive: number; botReplies7d: number;
  apiCalls7d: number; apiFailed7d: number; apiPaise7d: number; apiLastUsed: string | null;
  botsPaused: boolean; apiPaused: boolean; reason: string | null;
};
type Detail = {
  controls: { botsPaused: boolean; apiPaused: boolean; reason: string | null; updatedAt: string | null };
  bots: Array<{ id: number; name: string; triggerType: string; keywords: string[]; replyText: string; isActive: boolean; hits: number; productCount?: number; buttons: Array<{ title: string }> }>;
  apiCalls: Array<{ id: number; apiKeyId: number | null; endpoint: string; kind: string | null; httpStatus: number; code: string | null; chargedPaise: number; createdAt: string }>;
  apiErrors7d: Array<{ code: string; count: number }>;
};

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken() ?? ""}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || data?.message || `Request failed (${res.status})`);
  return data as T;
}

const rupees = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (s: string | null) => (s ? new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");

function CompanyDetail({ company, onClose }: { company: CompanyRow; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const key = ["/api/admin/business-automation", company.id];
  const detail = useQuery<Detail>({ queryKey: key, queryFn: () => call("GET", `/api/admin/business-automation/${company.id}`) });
  const [form, setForm] = useState<{ botsPaused: boolean; apiPaused: boolean; reason: string } | null>(null);
  const c = form ?? (detail.data ? { botsPaused: detail.data.controls.botsPaused, apiPaused: detail.data.controls.apiPaused, reason: detail.data.controls.reason ?? "" } : null);
  const save = useMutation({
    mutationFn: () => call("PUT", `/api/admin/business-automation/${company.id}/controls`, c),
    onSuccess: () => {
      toast({ title: c!.botsPaused || c!.apiPaused ? "Paused. The company sees your reason." : "Running again" });
      setForm(null);
      qc.invalidateQueries({ queryKey: ["/api/admin/business-automation"] });
    },
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });
  const pausing = c ? c.botsPaused || c.apiPaused : false;

  return (
    <Card data-testid="automation-detail">
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base">{company.name}</CardTitle>
          <CardDescription>Company #{company.id} · bots and API</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={onClose}>Back to list</Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {detail.isLoading || !c ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : (
          <>
            <div className="space-y-3 rounded-md border p-4">
              <p className="text-sm font-medium">NeuraTalk controls</p>
              <div className="flex flex-wrap gap-6">
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={c.botsPaused} onCheckedChange={(v) => setForm({ ...c, botsPaused: v })} data-testid="switch-pause-bots" />
                  Pause auto-reply bots
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={c.apiPaused} onCheckedChange={(v) => setForm({ ...c, apiPaused: v })} data-testid="switch-pause-api" />
                  Pause API sending
                </label>
              </div>
              {pausing && (
                <div className="space-y-1.5">
                  <Label htmlFor="pause-reason">Reason (the company sees this)</Label>
                  <Textarea id="pause-reason" rows={2} maxLength={300} value={c.reason} onChange={(e) => setForm({ ...c, reason: e.target.value })}
                    placeholder="Customers reported repeated messages. Contact support@neuratalk.in." data-testid="input-pause-reason" />
                </div>
              )}
              <div className="flex items-center gap-3">
                <Button size="sm" onClick={() => save.mutate()} disabled={!form || save.isPending || (pausing && c.reason.trim().length < 5)} data-testid="button-save-controls">
                  {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
                </Button>
                <p className="text-xs text-muted-foreground">Recorded in Audit Logs. Last change: {when(detail.data!.controls.updatedAt)}</p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Auto-reply bots ({detail.data!.bots.length})</p>
              {detail.data!.bots.length === 0 ? <p className="text-sm text-muted-foreground">No bots.</p> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Trigger</TableHead><TableHead>Reply</TableHead><TableHead className="text-right">Replies sent</TableHead><TableHead>State</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {detail.data!.bots.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell className="font-medium">{b.name}</TableCell>
                        <TableCell className="max-w-[180px] truncate text-xs">{b.triggerType === "button" ? "Button tap" : b.keywords.join(", ")}</TableCell>
                        <TableCell className="max-w-[320px] truncate text-xs text-muted-foreground" title={b.replyText}>{b.replyText}{b.productCount ? ` · ${b.productCount} product card${b.productCount === 1 ? "" : "s"}` : ""}</TableCell>
                        <TableCell className="text-right">{b.hits}</TableCell>
                        <TableCell>{b.isActive ? <Badge variant="secondary">On</Badge> : <Badge variant="outline">Off</Badge>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">API: last 50 calls</p>
              {detail.data!.apiErrors7d.length > 0 && (
                <p className="text-xs text-muted-foreground">Errors in 7 days: {detail.data!.apiErrors7d.map((e) => `${e.code} × ${e.count}`).join(" · ")}</p>
              )}
              {detail.data!.apiCalls.length === 0 ? <p className="text-sm text-muted-foreground">No API calls yet.</p> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Endpoint</TableHead><TableHead>Kind</TableHead><TableHead>Result</TableHead><TableHead className="text-right">Charge</TableHead><TableHead>Key</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {detail.data!.apiCalls.map((x) => (
                      <TableRow key={x.id}>
                        <TableCell className="whitespace-nowrap text-xs">{when(x.createdAt)}</TableCell>
                        <TableCell className="text-xs">{x.endpoint}</TableCell>
                        <TableCell className="text-xs">{x.kind ?? "—"}</TableCell>
                        <TableCell>{x.httpStatus < 300 ? <Badge variant="secondary">Sent</Badge> : <Badge variant="destructive">{x.code ?? x.httpStatus}</Badge>}</TableCell>
                        <TableCell className="text-right text-xs">{rupees(x.chargedPaise)}</TableCell>
                        <TableCell className="text-xs">#{x.apiKeyId ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <p className="text-xs text-muted-foreground">Message text and phone numbers are not stored in this log.</p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Super admin: every company's auto-reply bots and API sending, with pause switches. */
export function BusinessAutomationSection() {
  const list = useQuery<{ companies: CompanyRow[] }>({ queryKey: ["/api/admin/business-automation"], queryFn: () => call("GET", "/api/admin/business-automation") });
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<CompanyRow | null>(null);
  const [onlyActive, setOnlyActive] = useState(true);

  if (open) return <CompanyDetail company={open} onClose={() => setOpen(null)} />;

  const all = list.data?.companies ?? [];
  const shown = all
    .filter((c) => !onlyActive || c.bots > 0 || c.apiCalls7d > 0 || c.botsPaused || c.apiPaused)
    .filter((c) => !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase()) || String(c.id) === q.trim());
  const totals = all.reduce((t, c) => ({ replies: t.replies + c.botReplies7d, calls: t.calls + c.apiCalls7d, failed: t.failed + c.apiFailed7d, paise: t.paise + c.apiPaise7d }), { replies: 0, calls: 0, failed: 0, paise: 0 });

  return (
    <div className="space-y-4" data-testid="business-automation">
      <div>
        <h2 className="text-xl font-semibold">Bots & API</h2>
        <p className="text-sm text-muted-foreground">Every company's auto-reply bots and API sending. Pause a company if its bots or API messages hurt customers.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: "Bot replies (7 days)", value: totals.replies.toLocaleString("en-IN"), icon: <Bot className="h-4 w-4" /> },
          { label: "API calls (7 days)", value: totals.calls.toLocaleString("en-IN"), icon: <Send className="h-4 w-4" /> },
          { label: "API failures (7 days)", value: totals.failed.toLocaleString("en-IN"), icon: <PauseCircle className="h-4 w-4" /> },
          { label: "API charges (7 days)", value: rupees(totals.paise), icon: <PlayCircle className="h-4 w-4" /> },
        ].map((s) => (
          <Card key={s.label}><CardContent className="p-4">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">{s.icon}{s.label}</p>
            <p className="mt-1 text-2xl font-semibold">{s.value}</p>
          </CardContent></Card>
        ))}
      </div>
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Company name or id" value={q} onChange={(e) => setQ(e.target.value)} data-testid="input-automation-search" />
            </div>
            <label className="flex items-center gap-2 text-sm"><Switch checked={onlyActive} onCheckedChange={setOnlyActive} /> Only companies using bots or API</label>
          </div>
          {list.isLoading ? <Loader2 className="mx-auto h-5 w-5 animate-spin" />
            : list.error ? <p className="text-sm text-destructive">{(list.error as Error).message}</p>
            : shown.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No company uses bots or the API yet.</p>
            : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Company</TableHead>
                    <TableHead className="text-right">Bots (on)</TableHead>
                    <TableHead className="text-right">Bot replies 7d</TableHead>
                    <TableHead className="text-right">API calls 7d</TableHead>
                    <TableHead className="text-right">Failed</TableHead>
                    <TableHead className="text-right">Charges 7d</TableHead>
                    <TableHead>API last used</TableHead>
                    <TableHead>State</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((c) => (
                    <TableRow key={c.id} className="cursor-pointer" onClick={() => setOpen(c)} data-testid={`automation-row-${c.id}`}>
                      <TableCell className="font-medium">{c.name} <span className="text-xs text-muted-foreground">#{c.id}</span></TableCell>
                      <TableCell className="text-right">{c.bots} ({c.botsActive})</TableCell>
                      <TableCell className="text-right">{c.botReplies7d}</TableCell>
                      <TableCell className="text-right">{c.apiCalls7d}</TableCell>
                      <TableCell className={`text-right ${c.apiFailed7d > 0 ? "text-destructive" : ""}`}>{c.apiFailed7d}</TableCell>
                      <TableCell className="text-right">{rupees(c.apiPaise7d)}</TableCell>
                      <TableCell className="text-xs">{when(c.apiLastUsed)}</TableCell>
                      <TableCell className="space-x-1">
                        {c.botsPaused && <Badge variant="destructive">Bots paused</Badge>}
                        {c.apiPaused && <Badge variant="destructive">API paused</Badge>}
                        {!c.botsPaused && !c.apiPaused && <Badge variant="secondary">Running</Badge>}
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
