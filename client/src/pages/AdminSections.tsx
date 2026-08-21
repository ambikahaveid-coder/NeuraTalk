/**
 * Additional Super Admin Dashboard Sections
 * Call Logs, Languages, Feature Flags, Legal, Support, System Health
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAuthToken } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Link } from "wouter";
import {
  Loader2, Phone, Building2, Users, PhoneCall, Zap, Search,
  Globe, Flag, ToggleLeft, Scale, Edit, Plus, Trash2,
  HeartPulse, Headphones, FileText, RefreshCw, Download,
  CheckCircle, XCircle
} from "lucide-react";

// ============================================================================
// CALL LOGS SECTION
// ============================================================================
export function CallLogsSection() {
  const [dateRange, setDateRange] = useState("7d");
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: metricsData, isLoading } = useQuery({
    queryKey: ["/api/admin/call-metrics"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/admin/call-metrics", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const { data: callsData } = useQuery({
    queryKey: ["/api/admin/analytics", "calls", dateRange],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch(`/api/admin/analytics?days=${dateRange === "7d" ? 7 : dateRange === "30d" ? 30 : 90}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      return res.json();
    },
  });

  // Active-call count has no dedicated admin endpoint -- the billing
  // overview already computes it for the Billing section, so reuse it
  // rather than showing a permanently-zero placeholder.
  const { data: billingOverview } = useQuery({
    queryKey: ["/api/admin/billing/overview"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/admin/billing/overview", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const metrics = metricsData?.data || metricsData || {};

  if (isLoading) return <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {["7d", "30d", "90d"].map(r => (
            <Button key={r} size="sm" variant={dateRange === r ? "default" : "outline"} onClick={() => setDateRange(r)}>{r === "7d" ? "7 Days" : r === "30d" ? "30 Days" : "90 Days"}</Button>
          ))}
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Calls</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card><CardContent className="pt-6 text-center">
          <p className="text-3xl font-bold text-primary">{callsData?.data?.totalCalls ?? 0}</p>
          <p className="text-sm text-muted-foreground">Total Calls</p>
        </CardContent></Card>
        <Card><CardContent className="pt-6 text-center">
          <p className="text-3xl font-bold text-green-500">{billingOverview?.activeCalls ?? 0}</p>
          <p className="text-sm text-muted-foreground">Active Now</p>
        </CardContent></Card>
        <Card><CardContent className="pt-6 text-center">
          <p className="text-3xl font-bold text-blue-500">{callsData?.data?.avgCallDuration ?? 0}m</p>
          <p className="text-sm text-muted-foreground">Avg Duration</p>
        </CardContent></Card>
        <Card><CardContent className="pt-6 text-center">
          <p className="text-3xl font-bold text-purple-500">{callsData?.data?.successRate ?? 0}%</p>
          <p className="text-sm text-muted-foreground">Success Rate</p>
        </CardContent></Card>
        <Card><CardContent className="pt-6 text-center">
          <p className="text-3xl font-bold text-amber-500">{metrics.total?.p50 ?? 0}ms</p>
          <p className="text-sm text-muted-foreground">Avg Latency (p50)</p>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><PhoneCall className="w-4 h-4" />Call Pipeline Metrics</CardTitle>
          <CardDescription>p50/p95 latency per stage, from the last {metrics.windowSize ?? 0} samples</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Speech-to-Text", stage: metrics.stt },
              { label: "Translation", stage: metrics.translation },
              { label: "Text-to-Speech", stage: metrics.tts },
              { label: "End-to-End Total", stage: metrics.total },
            ].map(pipe => {
              const hasSamples = (pipe.stage?.count ?? 0) > 0;
              return (
                <div key={pipe.label} className="p-4 rounded-lg border">
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`w-2 h-2 rounded-full ${hasSamples ? "bg-green-500" : "bg-muted-foreground/40"}`} />
                    <span className="text-sm font-medium">{pipe.label}</span>
                  </div>
                  <p className="text-lg font-bold">{hasSamples ? `${pipe.stage.p50}ms` : "N/A"}</p>
                  <p className="text-xs text-muted-foreground">{hasSamples ? `p95: ${pipe.stage.p95}ms · ${pipe.stage.count} samples` : "no samples yet"}</p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><HeartPulse className="w-4 h-4" />Conversation Stability Signals</CardTitle>
          <CardDescription>Realtime collapse-prevention metrics from the shared conversation engine</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              {
                label: "Duplicate Turn Rate",
                value: `${(((metrics.voice?.rates?.duplicateTurnRate ?? metrics.voice?.duplicateTurnRate ?? 0) as number) * 100).toFixed(2)}%`,
              },
              {
                label: "Stale Transcript Rate",
                value: `${(((metrics.voice?.rates?.staleTranscriptRate ?? metrics.voice?.staleTranscriptRate ?? 0) as number) * 100).toFixed(2)}%`,
              },
              {
                label: "Transcript Regression Rate",
                value: `${(((metrics.voice?.rates?.transcriptRegressionRate ?? 0) as number) * 100).toFixed(2)}%`,
              },
              {
                label: "Confidence Coverage",
                value: `${(((metrics.voice?.rates?.confidenceCoverageRate ?? metrics.voice?.confidenceCoverageRate ?? 0) as number) * 100).toFixed(2)}%`,
              },
            ].map((signal) => (
              <div key={signal.label} className="p-4 rounded-lg border">
                <p className="text-xs text-muted-foreground mb-1">{signal.label}</p>
                <p className="text-xl font-bold">{signal.value}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
            {[
              {
                label: "Translation Fallbacks",
                value: metrics.voice?.counters?.translation_fallbacks ?? 0,
              },
              {
                label: "Stale TTS Segments",
                value: metrics.voice?.counters?.stale_tts_segments ?? 0,
              },
              {
                label: "Audio Backlog Events",
                value: metrics.voice?.counters?.audio_backlog_events ?? 0,
              },
              {
                label: "Ghost Audio Drops",
                value: metrics.voice?.counters?.ghost_audio_drops ?? 0,
              },
            ].map((signal) => (
              <div key={signal.label} className="p-4 rounded-lg border bg-muted/20">
                <p className="text-xs text-muted-foreground mb-1">{signal.label}</p>
                <p className="text-xl font-bold">{signal.value}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-1 gap-4 mt-4">
            <div className="p-4 rounded-lg border bg-muted/20">
              <p className="text-xs text-muted-foreground mb-1">Turn Order Mismatches</p>
              <p className="text-xl font-bold">{metrics.voice?.counters?.turn_order_mismatches ?? 0}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Call Types</CardTitle>
            <Link href="/admin/transcripts">
              <Button variant="outline" size="sm">
                <Download className="w-4 h-4 mr-2" />Export in Transcripts
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { type: "C2C (App-to-App)", icon: <Phone className="w-4 h-4" />, color: "text-blue-500", href: "/calls/c2c", status: "live" as const },
              { type: "B2B (Enterprise)", icon: <Building2 className="w-4 h-4" />, color: "text-purple-500", href: "/calls/b2b", status: "live" as const },
              { type: "PSTN (Phone)", icon: <PhoneCall className="w-4 h-4" />, color: "text-green-500", href: "/calls/c2c", status: "live" as const },
              { type: "Face-to-Face", icon: <Users className="w-4 h-4" />, color: "text-amber-500", href: "/calls/face-to-face", status: "live" as const },
              { type: "SIM Calls", icon: <Zap className="w-4 h-4" />, color: "text-cyan-500", href: "/calls/sim", status: "carrier" as const },
            ].map(ct => (
              <Link key={ct.type} href={ct.href}>
                <div className="p-3 rounded-lg border text-center cursor-pointer hover:bg-muted/50 transition-colors">
                  <div className={`mx-auto w-8 h-8 rounded-full bg-muted flex items-center justify-center mb-2 ${ct.color}`}>{ct.icon}</div>
                  <p className="text-xs font-medium">{ct.type}</p>
                  {ct.status === "carrier" && (
                    <p className="text-[10px] text-amber-500 mt-0.5">Carrier required</p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// LANGUAGES SECTION
// ============================================================================
export function LanguagesSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");

  const { data: langData, isLoading } = useQuery({
    queryKey: ["/api/admin/languages"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/admin/languages", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return { data: [] };
      return res.json();
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isEnabled }: { id: number; isEnabled: boolean }) => {
      const token = getAuthToken();
      const res = await fetch(`/api/admin/languages/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ isEnabled }),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/languages"] });
      toast({ title: "Language updated" });
    },
  });

  const languages = langData?.data || [];
  const filtered = search ? languages.filter((l: any) => l.name?.toLowerCase().includes(search.toLowerCase()) || l.code?.toLowerCase().includes(search.toLowerCase())) : languages;
  const enabledCount = languages.filter((l: any) => l.isEnabled).length;

  if (isLoading) return <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <Card><CardContent className="pt-6 text-center">
          <p className="text-3xl font-bold text-primary">{languages.length}</p>
          <p className="text-sm text-muted-foreground">Total Languages</p>
        </CardContent></Card>
        <Card><CardContent className="pt-6 text-center">
          <p className="text-3xl font-bold text-green-500">{enabledCount}</p>
          <p className="text-sm text-muted-foreground">Enabled</p>
        </CardContent></Card>
        <Card><CardContent className="pt-6 text-center">
          <p className="text-3xl font-bold text-muted-foreground">{languages.length - enabledCount}</p>
          <p className="text-sm text-muted-foreground">Disabled</p>
        </CardContent></Card>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search languages..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((lang: any) => (
              <div key={lang.id} className="flex items-center justify-between p-3 rounded-lg border">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${lang.isEnabled ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>
                    {lang.code?.toUpperCase()?.slice(0, 2)}
                  </div>
                  <div>
                    <p className="font-medium text-sm">{lang.name || lang.code}</p>
                    <p className="text-xs text-muted-foreground">{lang.code}{lang.isDefault ? " · Default" : ""}</p>
                  </div>
                </div>
                <Switch checked={lang.isEnabled} onCheckedChange={(checked) => toggleMutation.mutate({ id: lang.id, isEnabled: checked })} />
              </div>
            ))}
          </div>
          {filtered.length === 0 && <div className="text-center py-8 text-muted-foreground"><Globe className="w-10 h-10 mx-auto mb-3 opacity-50" /><p>No languages found</p></div>}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// FEATURE FLAGS SECTION
// ============================================================================
export function FeatureFlagsSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: flagsData, isLoading } = useQuery({
    queryKey: ["/api/admin/feature-flags"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/admin/feature-flags", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return { data: [] };
      return res.json();
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ name, enabled, killSwitch }: { name: string; enabled?: boolean; killSwitch?: boolean }) => {
      const token = getAuthToken();
      const body: any = {};
      if (typeof enabled === "boolean") body.enabled = enabled;
      if (typeof killSwitch === "boolean") body.killSwitch = killSwitch;
      const res = await fetch(`/api/admin/feature-flags/${name}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to update flag");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/feature-flags"] });
      toast({ title: "Feature flag updated" });
    },
  });

  const flags = Array.isArray(flagsData?.data) ? flagsData.data : Object.entries(flagsData?.data || {}).map(([name, val]: [string, any]) => ({ name, ...val }));

  if (isLoading) return <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <Card><CardContent className="pt-6 text-center">
          <p className="text-3xl font-bold text-primary">{flags.length}</p>
          <p className="text-sm text-muted-foreground">Total Flags</p>
        </CardContent></Card>
        <Card><CardContent className="pt-6 text-center">
          <p className="text-3xl font-bold text-green-500">{flags.filter((f: any) => f.enabled).length}</p>
          <p className="text-sm text-muted-foreground">Enabled</p>
        </CardContent></Card>
        <Card><CardContent className="pt-6 text-center">
          <p className="text-3xl font-bold text-red-500">{flags.filter((f: any) => f.killSwitch).length}</p>
          <p className="text-sm text-muted-foreground">Kill-Switched</p>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Flag className="w-4 h-4" />Feature Flags</CardTitle>
          <CardDescription>Control feature rollout. Kill switch overrides all settings.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {flags.map((flag: any) => (
              <div key={flag.name} className={`p-4 rounded-lg border ${flag.killSwitch ? "border-red-500/30 bg-red-500/5" : flag.enabled ? "border-green-500/20" : ""}`}>
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium text-sm">{flag.name?.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}</h4>
                      {flag.killSwitch && <Badge variant="destructive" className="text-xs">KILLED</Badge>}
                      {flag.rolloutPercentage != null && flag.rolloutPercentage < 100 && <Badge variant="outline" className="text-xs">{flag.rolloutPercentage}% rollout</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{flag.description || `Controls ${flag.name} feature`}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right"><p className="text-[10px] text-muted-foreground">Kill Switch</p>
                      <Switch checked={flag.killSwitch || false} onCheckedChange={(checked) => toggleMutation.mutate({ name: flag.name, killSwitch: checked })} />
                    </div>
                    <div className="text-right"><p className="text-[10px] text-muted-foreground">Enabled</p>
                      <Switch checked={flag.enabled} onCheckedChange={(checked) => toggleMutation.mutate({ name: flag.name, enabled: checked })} disabled={flag.killSwitch} />
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {flags.length === 0 && <div className="text-center py-8 text-muted-foreground"><ToggleLeft className="w-10 h-10 mx-auto mb-3 opacity-50" /><p>No feature flags configured</p></div>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// LEGAL CONTENT SECTION
// ============================================================================
export function LegalSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editingContent, setEditingContent] = useState<string | null>(null);
  const [formData, setFormData] = useState({ key: "", title: "", content: "", languageCode: "en" });

  const { data: legalData, isLoading } = useQuery({
    queryKey: ["/api/admin/legal-content"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/admin/legal-content", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return { data: [] };
      return res.json();
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const token = getAuthToken();
      const res = await fetch("/api/admin/legal-content", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/legal-content"] });
      setEditingContent(null);
      toast({ title: "Legal content saved" });
    },
  });

  const legalItems = legalData?.data || [];
  const legalKeys = ["privacy_policy", "terms_of_service", "data_processing_agreement", "cookie_policy", "acceptable_use", "refund_policy", "copyright"];

  if (isLoading) return <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div><h2 className="text-lg font-semibold">Legal Documents</h2><p className="text-sm text-muted-foreground">Changes are versioned and audited</p></div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {legalKeys.map(key => {
          const existing = legalItems.find((i: any) => i.key === key && i.languageCode === "en");
          return (
            <Card key={key} className={existing ? "border-green-500/20" : "border-dashed"}>
              <CardContent className="pt-6">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h4 className="font-medium text-sm">{key.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}</h4>
                    {existing && <p className="text-xs text-muted-foreground">v{existing.version || 1}</p>}
                  </div>
                  <Badge className={existing ? "bg-green-500/20 text-green-500 text-xs" : "text-xs"} variant={existing ? "default" : "outline"}>
                    {existing ? "Published" : "Draft"}
                  </Badge>
                </div>
                <Button size="sm" variant="outline" className="w-full" onClick={() => {
                  setFormData({ key, title: existing?.title || key.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()), content: existing?.content || "", languageCode: "en" });
                  setEditingContent(key);
                }}><Edit className="w-3 h-3 mr-2" />{existing ? "Edit" : "Create"}</Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={!!editingContent} onOpenChange={(o) => !o && setEditingContent(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit: {formData.key.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Title</Label><Input value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} /></div>
            <div className="space-y-2"><Label>Content (HTML/Markdown)</Label><Textarea value={formData.content} onChange={e => setFormData({ ...formData, content: e.target.value })} rows={15} className="font-mono text-sm" /></div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingContent(null)}>Cancel</Button>
              <Button onClick={() => saveMutation.mutate(formData)} disabled={saveMutation.isPending}>
                {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Save & Publish
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================================
// SUPPORT CONTACTS SECTION
// ============================================================================
export function SupportSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newContact, setNewContact] = useState({ type: "email", label: "", value: "", languageCode: "en", isEnabled: true, displayOrder: 1 });

  const { data: contactsData, isLoading } = useQuery({
    queryKey: ["/api/admin/support-contacts"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/admin/support-contacts", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return { data: [] };
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof newContact) => {
      const token = getAuthToken();
      const res = await fetch("/api/admin/support-contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/support-contacts"] });
      setShowCreate(false);
      setNewContact({ type: "email", label: "", value: "", languageCode: "en", isEnabled: true, displayOrder: 1 });
      toast({ title: "Support contact added" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const token = getAuthToken();
      const res = await fetch(`/api/admin/support-contacts/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed to delete");
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/support-contacts"] }); toast({ title: "Contact removed" }); },
  });

  const contacts = contactsData?.data || [];
  if (isLoading) return <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-semibold">Support Contacts</h2><p className="text-sm text-muted-foreground">Help desk contacts shown to users</p></div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />Add Contact</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Support Contact</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2"><Label>Type</Label>
                <Select value={newContact.type} onValueChange={v => setNewContact({ ...newContact, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="phone">Phone</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="chat">Live Chat</SelectItem>
                    <SelectItem value="url">Website/URL</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Label</Label><Input value={newContact.label} onChange={e => setNewContact({ ...newContact, label: e.target.value })} placeholder="e.g. General Support" /></div>
              <div className="space-y-2"><Label>Value</Label><Input value={newContact.value} onChange={e => setNewContact({ ...newContact, value: e.target.value })} placeholder="e.g. support@neuratalk.in" /></div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button onClick={() => createMutation.mutate(newContact)} disabled={!newContact.label || !newContact.value || createMutation.isPending}>
                  {createMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Add
                </Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {contacts.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {contacts.map((c: any) => (
            <Card key={c.id}><CardContent className="pt-6">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    {c.type === "email" ? <FileText className="w-5 h-5 text-primary" /> : c.type === "phone" ? <Phone className="w-5 h-5 text-primary" /> : <Headphones className="w-5 h-5 text-primary" />}
                  </div>
                  <div><p className="font-medium">{c.label}</p><p className="text-sm text-muted-foreground">{c.value}</p><p className="text-xs text-muted-foreground capitalize">{c.type}</p></div>
                </div>
                <Button variant="ghost" size="sm" className="text-red-400" onClick={() => deleteMutation.mutate(c.id)}><Trash2 className="w-4 h-4" /></Button>
              </div>
            </CardContent></Card>
          ))}
        </div>
      ) : (
        <Card><CardContent className="py-12 text-center text-muted-foreground"><Headphones className="w-10 h-10 mx-auto mb-3 opacity-50" /><p>No support contacts configured</p></CardContent></Card>
      )}
    </div>
  );
}

// ============================================================================
// SYSTEM HEALTH SECTION
// ============================================================================
export function SystemHealthSection() {
  const { data: healthData, isLoading, refetch } = useQuery({
    queryKey: ["/api/health", "system"],
    queryFn: async () => { const res = await fetch("/api/health"); if (!res.ok) return null; return res.json(); },
    refetchInterval: 10000,
  });

  const { data: configStatus } = useQuery({
    queryKey: ["/api/admin/config/status"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/admin/config/status", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const { data: keysStatus } = useQuery({
    queryKey: ["/api/health/keys"],
    queryFn: async () => { const res = await fetch("/api/health/keys"); if (!res.ok) return null; return res.json(); },
  });

  const uptime = healthData?.uptime ? Math.floor(healthData.uptime / 3600) : 0;
  const uptimeMin = healthData?.uptime ? Math.floor((healthData.uptime % 3600) / 60) : 0;
  const configKeyMap = new Map<string, boolean>((configStatus?.configs || []).map((config: any) => [config.key, config.isSet]));
  const configSummary = configStatus?.summary || {};
  const openAiConfigured = Boolean(configKeyMap.get("OPENAI_API_KEY") || configKeyMap.get("AI_INTEGRATIONS_OPENAI_API_KEY"));
  const azureSpeechConfigured = Boolean(configKeyMap.get("AZURE_SPEECH_KEY") && configKeyMap.get("AZURE_SPEECH_REGION"));
  const azureTranslatorConfigured = Boolean(
    (configKeyMap.get("AZURE_TRANSLATOR_KEY") && configKeyMap.get("AZURE_TRANSLATOR_REGION")) || azureSpeechConfigured,
  );
  const livekitConfigured = Boolean(
    configKeyMap.get("LIVEKIT_URL") && configKeyMap.get("LIVEKIT_API_KEY") && configKeyMap.get("LIVEKIT_API_SECRET"),
  );
  const firebaseConfigured = Boolean(configSummary.firebase?.configured);
  const razorpayConfigured = Boolean(configSummary.razorpay?.configured);
  const msg91Configured = Boolean(configSummary.msg91?.configured);

  const services = [
    { name: "API Server", status: healthData?.status === "ok" ? "online" : "offline", detail: `Uptime: ${uptime}h ${uptimeMin}m` },
    { name: "Database (Neon)", status: healthData?.status === "ok" ? "online" : "offline", detail: "PostgreSQL Serverless" },
    { name: "WebSocket Signaling", status: healthData?.status === "ok" ? "online" : "offline", detail: "Real-time events" },
    { name: "Redis Cache", status: keysStatus?.redis ? "online" : "degraded", detail: keysStatus?.redis ? "REDIS_URL configured" : "Not configured — in-memory fallback" },
    { name: "LiveKit (WebRTC)", status: livekitConfigured ? "online" : "offline", detail: livekitConfigured ? "Primary media transport configured" : "LIVEKIT_URL/API keys missing" },
    { name: "Azure STT (Primary)", status: azureSpeechConfigured ? "online" : "offline", detail: azureSpeechConfigured ? "Azure Speech streaming configured" : "AZURE_SPEECH_KEY/REGION missing" },
    { name: "OpenAI Orchestration", status: openAiConfigured ? "online" : "offline", detail: openAiConfigured ? "Realtime orchestration configured" : "OPENAI API key missing" },
    { name: "Azure TTS (Primary)", status: azureSpeechConfigured ? "online" : "offline", detail: azureSpeechConfigured ? "Azure voice output configured" : "AZURE_SPEECH_KEY/REGION missing" },
    { name: "Azure Translator", status: azureTranslatorConfigured ? "online" : "degraded", detail: azureTranslatorConfigured ? "Translator path available" : "Falling back to orchestration-only translation" },
    { name: "Firebase Auth", status: firebaseConfigured ? "online" : "offline", detail: firebaseConfigured ? "Configured" : "Firebase server/web keys missing" },
    { name: "Razorpay Payments", status: razorpayConfigured ? "online" : "offline", detail: razorpayConfigured ? "Configured" : "Razorpay keys missing" },
    { name: "MSG91 Callbacks", status: msg91Configured ? "online" : "degraded", detail: msg91Configured ? "PSTN/OTP callback base configured" : "MSG91 or APP_BASE_URL incomplete" },
  ];

  const statusColor = (s: string) => s === "online" ? "bg-green-500" : s === "degraded" ? "bg-amber-500" : "bg-red-500";
  const statusText = (s: string) => s === "online" ? "text-green-500" : s === "degraded" ? "text-amber-500" : "text-red-500";

  if (isLoading) return <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-semibold flex items-center gap-2"><HeartPulse className="w-5 h-5" />System Health</h2><p className="text-sm text-muted-foreground">Auto-refreshes every 10s</p></div>
        <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-6 text-center"><p className="text-3xl font-bold text-green-500">{services.filter(s => s.status === "online").length}</p><p className="text-sm text-muted-foreground">Online</p></CardContent></Card>
        <Card><CardContent className="pt-6 text-center"><p className="text-3xl font-bold text-amber-500">{services.filter(s => s.status === "degraded").length}</p><p className="text-sm text-muted-foreground">Degraded</p></CardContent></Card>
        <Card><CardContent className="pt-6 text-center"><p className="text-3xl font-bold text-red-500">{services.filter(s => s.status === "offline").length}</p><p className="text-sm text-muted-foreground">Offline</p></CardContent></Card>
        <Card><CardContent className="pt-6 text-center"><p className="text-3xl font-bold text-primary">{uptime}h {uptimeMin}m</p><p className="text-sm text-muted-foreground">Uptime</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Service Status</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-3">
            {services.map(svc => (
              <div key={svc.name} className="flex items-center justify-between p-3 rounded-lg border">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${statusColor(svc.status)}`} />
                  <div><p className="font-medium text-sm">{svc.name}</p><p className="text-xs text-muted-foreground">{svc.detail}</p></div>
                </div>
                <Badge variant="outline" className={`${statusText(svc.status)} capitalize text-xs`}>{svc.status}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Environment Keys</CardTitle><CardDescription>Required API keys and configuration</CardDescription></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              { key: "DATABASE_URL", label: "Database (Neon)", required: true },
              { key: "OPENAI_API_KEY", label: "OpenAI (Orchestration)", required: true },
              { key: "AZURE_SPEECH_KEY", label: "Azure Speech Key", required: true },
              { key: "AZURE_SPEECH_REGION", label: "Azure Speech Region", required: true },
              { key: "MSG91_AUTH_KEY", label: "MSG91 Auth", required: false },
              { key: "APP_BASE_URL", label: "Public Callback Base URL", required: false },
              { key: "MSG91_OTP_TEMPLATE_ID", label: "MSG91 OTP Template", required: false },
              { key: "LIVEKIT_URL", label: "LiveKit URL", required: true },
              { key: "LIVEKIT_API_KEY", label: "LiveKit API Key", required: true },
              { key: "LIVEKIT_API_SECRET", label: "LiveKit API Secret", required: true },
              { key: "RAZORPAY_KEY_ID", label: "Razorpay (Payments)", required: false },
              { key: "FIREBASE_SERVICE_ACCOUNT_JSON", label: "Firebase", required: false },
              { key: "ELEVEN_LABS_API_KEY", label: "ElevenLabs (TTS)", required: false },
              { key: "LOCAL_WHISPER_URL", label: "Whisper GPU (STT)", required: false },
            ].map(env => {
              const isSet = configKeyMap.get(env.key) || (env.key === "DATABASE_URL" && healthData?.status === "ok");
              return (
                <div key={env.key} className="flex items-center justify-between p-3 rounded-lg border">
                  <div><p className="text-sm font-medium">{env.label}</p><p className="text-[10px] text-muted-foreground font-mono">{env.key}</p></div>
                  <div className="flex items-center gap-2">
                    {env.required && <Badge variant="outline" className="text-[10px]">Required</Badge>}
                    {isSet ? <CheckCircle className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-red-400" />}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
