import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Server, Plus, Trash2, Pencil, ArrowLeft, CheckCircle, XCircle, Loader2, AlertCircle, Wifi, WifiOff } from "lucide-react";
import { Link } from "wouter";
import { getAuthToken } from "@/hooks/use-auth";

function apiFetch(path: string, opts?: RequestInit) {
  const token = getAuthToken();
  return fetch(path, {
    ...opts, credentials: "include",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(opts?.headers ?? {}) },
  }).then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "Error"); return j; });
}

interface PbxIntegration {
  id: number; name: string; pbxType: string; host: string; port: number;
  username?: string; password?: string; apiUrl?: string; apiKey?: string;
  transport: string; context?: string; sipTrunkId?: string; extensionRange?: string;
  connectionStatus: string; lastCheckedAt?: string; isActive: boolean;
}

const PBX_TYPES = [
  { value: "asterisk", label: "Asterisk" },
  { value: "freepbx", label: "FreePBX" },
  { value: "cucm", label: "Cisco CUCM" },
  { value: "avaya", label: "Avaya Aura" },
  { value: "genesys", label: "Genesys Cloud" },
  { value: "3cx", label: "3CX" },
  { value: "yeastar", label: "Yeastar" },
  { value: "generic_sip", label: "Generic SIP" },
];

const STATUS_CONFIG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  connected: { icon: CheckCircle, color: "text-green-500", label: "Connected" },
  disconnected: { icon: XCircle, color: "text-red-500", label: "Disconnected" },
  error: { icon: AlertCircle, color: "text-red-500", label: "Error" },
  unknown: { icon: AlertCircle, color: "text-yellow-500", label: "Unknown" },
};

function StatusIcon({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.unknown;
  const Icon = cfg.icon;
  return <Icon className={`h-4 w-4 ${cfg.color}`} />;
}

const DEFAULT_FORM = { name: "", pbxType: "asterisk", host: "", port: 5060, username: "", password: "", apiUrl: "", apiKey: "", transport: "udp", context: "from-internal", sipTrunkId: "", extensionRange: "", isActive: true };

export default function PBXIntegrationPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<PbxIntegration | null>(null);
  const [form, setForm] = useState({ ...DEFAULT_FORM });
  const [testing, setTesting] = useState<number | null>(null);

  const { data: items = [], isLoading } = useQuery<PbxIntegration[]>({
    queryKey: ["/api/enterprise/pbx"],
    queryFn: () => apiFetch("/api/enterprise/pbx"),
    staleTime: 30_000,
  });

  const save = useMutation({
    mutationFn: (data: typeof form) => editItem
      ? apiFetch(`/api/enterprise/pbx/${editItem.id}`, { method: "PATCH", body: JSON.stringify(data) })
      : apiFetch("/api/enterprise/pbx", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/enterprise/pbx"] });
      toast({ title: editItem ? "PBX updated" : "PBX added" });
      setOpen(false); setEditItem(null);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/enterprise/pbx/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/enterprise/pbx"] }); toast({ title: "Removed" }); },
  });

  async function testConnection(pbx: PbxIntegration) {
    setTesting(pbx.id);
    try {
      const result = await apiFetch(`/api/enterprise/pbx/${pbx.id}/test`, { method: "POST" });
      toast({ title: result.success ? "Connection Successful" : "Connection Failed", description: result.message, variant: result.success ? "default" : "destructive" });
      qc.invalidateQueries({ queryKey: ["/api/enterprise/pbx"] });
    } catch (e: unknown) {
      toast({ title: "Test Failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setTesting(null);
    }
  }

  function openEdit(p: PbxIntegration) {
    setEditItem(p);
    setForm({ name: p.name, pbxType: p.pbxType, host: p.host, port: p.port, username: p.username ?? "", password: "••••••••", apiUrl: p.apiUrl ?? "", apiKey: p.apiKey ?? "", transport: p.transport, context: p.context ?? "from-internal", sipTrunkId: p.sipTrunkId ?? "", extensionRange: p.extensionRange ?? "", isActive: p.isActive });
    setOpen(true);
  }
  function openNew() { setEditItem(null); setForm({ ...DEFAULT_FORM }); setOpen(true); }

  const pbxTypeLabel = (t: string) => PBX_TYPES.find(p => p.value === t)?.label ?? t;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/company-dashboard">
            <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Dashboard</Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Server className="h-6 w-6 text-primary" />PBX Integration</h1>
            <p className="text-muted-foreground text-sm">Connect your existing PBX system to NeuraTalk's AI layer</p>
          </div>
        </div>

        {/* Info banner */}
        <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/20">
          <CardContent className="py-4 flex gap-3 items-start">
            <Wifi className="h-5 w-5 text-blue-500 mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-blue-800 dark:text-blue-200">How it works</p>
              <p className="text-blue-700 dark:text-blue-300 mt-1">NeuraTalk connects to your existing PBX via SIP trunk. Your phone numbers, extensions, and agents stay on your PBX. NeuraTalk adds AI transcription, translation, and sentiment analysis on top — without touching your carrier or number.</p>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-between items-center">
          <p className="text-sm text-muted-foreground">{items.length} PBX system{items.length !== 1 ? "s" : ""} configured</p>
          <Button onClick={openNew}><Plus className="h-4 w-4 mr-1" />Add PBX System</Button>
        </div>

        {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
          <div className="space-y-4">
            {items.length === 0 && (
              <Card>
                <CardContent className="py-12 text-center">
                  <Server className="h-10 w-10 mx-auto text-muted-foreground opacity-30 mb-3" />
                  <p className="text-muted-foreground">No PBX systems connected yet.</p>
                  <p className="text-sm text-muted-foreground mt-1">Add your Asterisk, FreePBX, CUCM, or any SIP-compatible PBX.</p>
                  <Button className="mt-4" onClick={openNew}><Plus className="h-4 w-4 mr-1" />Add Your First PBX</Button>
                </CardContent>
              </Card>
            )}
            {items.map(pbx => (
              <Card key={pbx.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-base">{pbx.name}</CardTitle>
                        <Badge variant="outline">{pbxTypeLabel(pbx.pbxType)}</Badge>
                        {!pbx.isActive && <Badge variant="secondary">Inactive</Badge>}
                      </div>
                      <CardDescription className="mt-1">
                        {pbx.host}:{pbx.port} · {pbx.transport.toUpperCase()}
                        {pbx.extensionRange && ` · Ext. ${pbx.extensionRange}`}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-1">
                      <StatusIcon status={pbx.connectionStatus} />
                      <span className={`text-sm ${STATUS_CONFIG[pbx.connectionStatus]?.color ?? "text-muted-foreground"}`}>
                        {STATUS_CONFIG[pbx.connectionStatus]?.label ?? pbx.connectionStatus}
                      </span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => testConnection(pbx)} disabled={testing === pbx.id}>
                    {testing === pbx.id ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Testing…</> : <><Wifi className="h-4 w-4 mr-1" />Test Connection</>}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openEdit(pbx)}><Pencil className="h-4 w-4 mr-1" />Edit</Button>
                  <Button size="sm" variant="outline" onClick={() => remove.mutate(pbx.id)}><Trash2 className="h-4 w-4 mr-1 text-destructive" />Remove</Button>
                  {pbx.lastCheckedAt && <span className="text-xs text-muted-foreground self-center ml-auto">Last checked: {new Date(pbx.lastCheckedAt).toLocaleString()}</span>}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Add / Edit dialog */}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>{editItem ? "Edit PBX System" : "Add PBX System"}</DialogTitle></DialogHeader>
            <Tabs defaultValue="basic">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="basic">Basic</TabsTrigger>
                <TabsTrigger value="auth">Authentication</TabsTrigger>
                <TabsTrigger value="advanced">Advanced</TabsTrigger>
              </TabsList>
              <TabsContent value="basic" className="space-y-3 mt-4">
                <div><Label>Display Name *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Office Asterisk, Chennai Avaya" /></div>
                <div>
                  <Label>PBX Type *</Label>
                  <Select value={form.pbxType} onValueChange={v => setForm(f => ({ ...f, pbxType: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{PBX_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2"><Label>Host / IP *</Label><Input value={form.host} onChange={e => setForm(f => ({ ...f, host: e.target.value }))} placeholder="192.168.1.10 or pbx.company.com" /></div>
                  <div><Label>Port</Label><Input type="number" value={form.port} onChange={e => setForm(f => ({ ...f, port: parseInt(e.target.value) || 5060 }))} /></div>
                </div>
                <div>
                  <Label>Transport</Label>
                  <Select value={form.transport} onValueChange={v => setForm(f => ({ ...f, transport: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="udp">UDP (default)</SelectItem>
                      <SelectItem value="tcp">TCP</SelectItem>
                      <SelectItem value="tls">TLS (encrypted)</SelectItem>
                      <SelectItem value="ws">WebSocket</SelectItem>
                      <SelectItem value="wss">WebSocket Secure</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={form.isActive} onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))} />
                  <Label>Active</Label>
                </div>
              </TabsContent>
              <TabsContent value="auth" className="space-y-3 mt-4">
                <div><Label>SIP Username</Label><Input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder="trunk username" /></div>
                <div><Label>SIP Password</Label><Input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="•••••••••" /></div>
                <div><Label>REST API URL (optional)</Label><Input value={form.apiUrl} onChange={e => setForm(f => ({ ...f, apiUrl: e.target.value }))} placeholder="http://pbx.local:8080/api" /></div>
                <div><Label>REST API Key (optional)</Label><Input type="password" value={form.apiKey} onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))} placeholder="•••••••••" /></div>
              </TabsContent>
              <TabsContent value="advanced" className="space-y-3 mt-4">
                <div><Label>Dialplan Context (Asterisk)</Label><Input value={form.context} onChange={e => setForm(f => ({ ...f, context: e.target.value }))} placeholder="from-internal" /></div>
                <div><Label>SIP Trunk ID (on your PBX)</Label><Input value={form.sipTrunkId} onChange={e => setForm(f => ({ ...f, sipTrunkId: e.target.value }))} placeholder="Trunk identifier on your PBX" /></div>
                <div><Label>Extension Range</Label><Input value={form.extensionRange} onChange={e => setForm(f => ({ ...f, extensionRange: e.target.value }))} placeholder="1000-1999" /></div>
              </TabsContent>
            </Tabs>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => save.mutate(form)} disabled={!form.name || !form.host || save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
