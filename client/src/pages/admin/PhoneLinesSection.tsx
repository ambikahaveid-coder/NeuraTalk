import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { getAuthToken } from "@/hooks/use-auth";
import { CheckCircle2, Circle, Loader2, Phone, Trash2 } from "lucide-react";

type Status = {
  provider: string; usesLiveKit: boolean; sipReachable: boolean; error: string | null; outboundTrunkId: string | null;
  inbound: Array<{ id: string; name: string; numbers: string[]; secured: boolean }>; ruleCount: number;
  numbers: Array<{ id: number; phoneNumber: string; label: string | null; type: string; isActive: boolean; organizationId: number; organizationName: string | null }>;
  checklist: Array<{ key: string; label: string; ok: boolean }>; ready: boolean;
};

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken() ?? ""}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || data?.error || `Request failed (${res.status})`);
  return data as T;
}

const lines = (s: string) => s.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);

/** Super admin: connect the telephone provider (Exotel) through LiveKit SIP and give businesses numbers. */
export function PhoneLinesSection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const status = useQuery<Status>({ queryKey: ["/api/admin/telephony"], queryFn: () => call("GET", "/api/admin/telephony") });
  const companies = useQuery<{ companies: Array<{ id: number; name: string }> }>({ queryKey: ["/api/admin/companies"], queryFn: () => call("GET", "/api/admin/companies") });
  const refresh = () => qc.invalidateQueries({ queryKey: ["/api/admin/telephony"] });

  const [out, setOut] = useState({ address: "", numbers: "", username: "", password: "", transport: "tcp" });
  const [secure, setSecure] = useState({ ips: "", username: "", password: "" });
  const [num, setNum] = useState({ orgId: "", phoneNumber: "", label: "" });

  const connect = useMutation({
    mutationFn: () => call("POST", "/api/admin/telephony/outbound-trunk", {
      provider: "exotel", name: "Exotel", address: out.address.trim(), numbers: lines(out.numbers),
      username: out.username.trim() || undefined, password: out.password || undefined, transport: out.transport,
    }),
    onSuccess: () => { toast({ title: "Exotel line connected" }); setOut({ ...out, password: "" }); refresh(); },
    onError: (e: Error) => toast({ title: "Couldn't connect", description: e.message, variant: "destructive" }),
  });
  const disconnect = useMutation({
    mutationFn: () => call("DELETE", "/api/admin/telephony/outbound-trunk"),
    onSuccess: () => { toast({ title: "Line removed" }); refresh(); },
  });
  const sync = useMutation({
    mutationFn: () => call("POST", "/api/admin/telephony/inbound/sync", {
      allowedAddresses: lines(secure.ips).length ? lines(secure.ips) : undefined,
      authUsername: secure.username.trim() || undefined, authPassword: secure.password || undefined,
    }),
    onSuccess: () => { toast({ title: "Incoming line updated" }); setSecure({ ...secure, password: "" }); refresh(); },
    onError: (e: Error) => toast({ title: "Couldn't update", description: e.message, variant: "destructive" }),
  });
  const addNumber = useMutation({
    mutationFn: () => call("POST", `/api/admin/orgs/${num.orgId}/dids`, { phoneNumber: num.phoneNumber.trim(), label: num.label.trim() || undefined, type: "both", provider: "exotel" }),
    onSuccess: () => { toast({ title: "Number assigned" }); setNum({ orgId: num.orgId, phoneNumber: "", label: "" }); refresh(); },
    onError: (e: Error) => toast({ title: "Couldn't assign", description: e.message, variant: "destructive" }),
  });
  const removeNumber = useMutation({
    mutationFn: (n: { id: number; organizationId: number }) => call("DELETE", `/api/admin/orgs/${n.organizationId}/dids/${n.id}`),
    onSuccess: () => { toast({ title: "Number removed" }); refresh(); },
  });

  const s = status.data;
  if (status.isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (status.isError || !s) return <p className="text-sm text-destructive">Couldn't read the phone line status: {(status.error as Error)?.message}</p>;

  return (
    <div className="space-y-6" data-testid="phone-lines">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Phone className="h-5 w-5" /> Business phone lines</CardTitle>
          <CardDescription>
            Businesses call customers' phones and receive calls on their own numbers, with live translation. Calls go through Exotel's SIP line into LiveKit.
            You need an Exotel account (company KYC) and Indian numbers from them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2" data-testid="phone-lines-checklist">
            {s.checklist.map((c) => (
              <li key={c.key} className="flex items-center gap-2 text-sm">
                {c.ok ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <Circle className="h-4 w-4 text-muted-foreground" />}
                <span className={c.ok ? "" : "text-muted-foreground"}>{c.label}</span>
              </li>
            ))}
          </ul>
          {s.error && <p className="mt-3 text-sm text-destructive">LiveKit: {s.error}</p>}
          <p className="mt-4 text-sm">{s.ready ? <Badge className="bg-green-600">Ready for calls</Badge> : <Badge variant="outline">Not ready yet</Badge>}</p>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">1. Outgoing calls: connect the Exotel line</CardTitle>
            <CardDescription>From Exotel's SIP trunk settings. The password goes straight to LiveKit and is not stored by NeuraTalk.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {s.outboundTrunkId ? (
              <div className="flex items-center justify-between rounded-lg border bg-muted/40 p-3 text-sm">
                <span>Connected <span className="font-mono text-xs text-muted-foreground">{s.outboundTrunkId}</span></span>
                <Button size="sm" variant="outline" onClick={() => { if (confirm("Remove the outgoing line? Outgoing phone calls will stop.")) disconnect.mutate(); }}>Remove</Button>
              </div>
            ) : null}
            <div className="space-y-1.5"><Label>SIP host</Label><Input placeholder="e.g. your-account.voip.exotel.com" value={out.address} onChange={(e) => setOut({ ...out, address: e.target.value })} data-testid="input-sip-host" /></div>
            <div className="space-y-1.5"><Label>Caller numbers (one per line)</Label><Input placeholder="+918040001234" value={out.numbers} onChange={(e) => setOut({ ...out, numbers: e.target.value })} data-testid="input-sip-numbers" /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label>Username</Label><Input value={out.username} onChange={(e) => setOut({ ...out, username: e.target.value })} autoComplete="off" /></div>
              <div className="space-y-1.5"><Label>Password</Label><Input type="password" value={out.password} onChange={(e) => setOut({ ...out, password: e.target.value })} autoComplete="new-password" /></div>
            </div>
            <div className="space-y-1.5">
              <Label>Transport</Label>
              <Select value={out.transport} onValueChange={(v) => setOut({ ...out, transport: v })}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>{["auto", "udp", "tcp", "tls"].map((t) => <SelectItem key={t} value={t}>{t.toUpperCase()}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button onClick={() => connect.mutate()} disabled={connect.isPending || !out.address.trim() || !lines(out.numbers).length} data-testid="button-connect-trunk">
              {connect.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}{s.outboundTrunkId ? "Replace line" : "Connect line"}
            </Button>
            {!s.usesLiveKit && <p className="text-xs text-muted-foreground">After connecting, set PSTN_PROVIDER=exotel on the server so calls dial through this line.</p>}
            <div className="rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground" data-testid="exotel-setup-notes">
              <p className="font-medium text-foreground">Give Exotel these details</p>
              <p className="mt-1">Calls leave from LiveKit's India region. Ask Exotel to whitelist LiveKit's fixed IP ranges: <span className="font-mono">143.223.88.0/21, 161.115.160.0/19, 153.57.128.0/18</span> (check docs.livekit.io → Regions &amp; static IPs before sending).</p>
              <p className="mt-1">For incoming calls, Exotel's Connect applet should dial <span className="font-mono">&lt;your LiveKit SIP subdomain&gt;.india.sip.livekit.cloud</span> (LiveKit project settings → SIP URI), so calls stay in India.</p>
              <p className="mt-1">Exotel uses SIP over TCP or TLS with G.711 audio.</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Incoming calls: protect the line</CardTitle>
            <CardDescription>Accept calls only from Exotel's servers (their IP addresses), or with a username and password. Business numbers are added automatically.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {s.inbound.map((t) => (
              <div key={t.id} className="rounded-lg border p-3 text-sm">
                <p className="font-medium">{t.name}</p>
                <p className="text-muted-foreground">{t.numbers.join(", ") || "No numbers"}</p>
                <p className={t.secured ? "text-green-600" : "text-amber-600"}>{t.secured ? "Protected" : "Open: anyone who knows the address can send calls"}</p>
              </div>
            ))}
            <div className="space-y-1.5"><Label>Exotel IP addresses</Label><Input placeholder="e.g. 103.21.0.0/24, 52.66.1.10" value={secure.ips} onChange={(e) => setSecure({ ...secure, ips: e.target.value })} data-testid="input-allowed-ips" /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label>Username (optional)</Label><Input value={secure.username} onChange={(e) => setSecure({ ...secure, username: e.target.value })} autoComplete="off" /></div>
              <div className="space-y-1.5"><Label>Password (optional)</Label><Input type="password" value={secure.password} onChange={(e) => setSecure({ ...secure, password: e.target.value })} autoComplete="new-password" /></div>
            </div>
            <Button variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending} data-testid="button-sync-inbound">
              {sync.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Update incoming line
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">3. Business numbers</CardTitle>
          <CardDescription>Each number belongs to one business. Calls to it ring that business's team; their outgoing calls show it.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
            <div className="space-y-1.5">
              <Label>Business</Label>
              <Select value={num.orgId} onValueChange={(v) => setNum({ ...num, orgId: v })}>
                <SelectTrigger data-testid="select-number-business"><SelectValue placeholder="Choose a business" /></SelectTrigger>
                <SelectContent>{(companies.data?.companies ?? []).map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Number</Label><Input placeholder="+918040001234" value={num.phoneNumber} onChange={(e) => setNum({ ...num, phoneNumber: e.target.value })} data-testid="input-business-number" /></div>
            <div className="space-y-1.5"><Label>Label</Label><Input placeholder="Sales, Support…" value={num.label} onChange={(e) => setNum({ ...num, label: e.target.value })} /></div>
            <Button onClick={() => addNumber.mutate()} disabled={!num.orgId || !num.phoneNumber.trim() || addNumber.isPending} data-testid="button-assign-number">Assign</Button>
          </div>
          {s.numbers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No business numbers yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left text-muted-foreground"><th className="py-2 pr-4 font-medium">Number</th><th className="py-2 pr-4 font-medium">Business</th><th className="py-2 pr-4 font-medium">Label</th><th className="py-2 pr-4 font-medium">Status</th><th /></tr></thead>
                <tbody>
                  {s.numbers.map((n) => (
                    <tr key={n.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-mono">{n.phoneNumber}</td>
                      <td className="py-2 pr-4">{n.organizationName ?? `#${n.organizationId}`}</td>
                      <td className="py-2 pr-4">{n.label ?? "—"}</td>
                      <td className="py-2 pr-4">{n.isActive ? "On" : "Off"}</td>
                      <td className="py-2 text-right">
                        <Button size="icon" variant="ghost" aria-label={`Remove ${n.phoneNumber}`} onClick={() => { if (confirm(`Remove ${n.phoneNumber} from ${n.organizationName ?? "this business"}?`)) removeNumber.mutate(n); }}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
