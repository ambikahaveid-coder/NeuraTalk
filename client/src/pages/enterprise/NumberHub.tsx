import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Phone, Plus, Settings, Activity, Shield, CreditCard, Globe,
  CheckCircle2, Clock, AlertTriangle, Wifi, Zap, FileText, Trash2, Edit3, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Separator } from "@/components/ui/separator";

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(path, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts });
  const json = await res.json();
  if (!json.success) throw new Error(json.error ?? "Request failed");
  return json.data;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface EnterpriseNumber {
  id: number;
  phoneNumber: string;
  label: string | null;
  carrier: string;
  integrationType: string;
  verificationStatus: string;
  isActive: boolean;
  aiEnabled: boolean;
  countryCode: string;
}

interface HubOverview {
  totalNumbers: number;
  verifiedNumbers: number;
  pendingVerification: number;
  aiEnabledNumbers: number;
  sipTrunks: number;
  languageRules: number;
  byCarrier: Record<string, number>;
  byIntegrationType: Record<string, number>;
}

interface SipIntegration {
  id: number;
  label: string;
  sipServer: string;
  sipPort: number;
  transport: string;
  registrationStatus: string | null;
  isActive: boolean;
}

interface LanguageRule {
  id: number;
  callerLanguage: string;
  agentLanguage: string;
  autoTranslate: boolean;
  priority: number;
  routeToSkill: string | null;
}

interface AiConfiguration {
  translationEnabled: boolean;
  transcriptionEnabled: boolean;
  sentimentAnalysisEnabled: boolean;
  agentAssistEnabled: boolean;
  qualityMonitoringEnabled: boolean;
  callSummaryEnabled: boolean;
  piiRedactionEnabled: boolean;
  defaultSrcLanguage: string | null;
  defaultTgtLanguage: string | null;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  if (status === "verified") return <Badge className="bg-green-100 text-green-800 border-green-200"><CheckCircle2 className="h-3 w-3 mr-1" />Verified</Badge>;
  if (status === "pending") return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
  return <Badge className="bg-red-100 text-red-800 border-red-200"><AlertTriangle className="h-3 w-3 mr-1" />Failed</Badge>;
}

function CarrierBadge({ carrier }: { carrier: string }) {
  const colors: Record<string, string> = {
    airtel: "bg-red-50 text-red-700 border-red-200",
    jio: "bg-blue-50 text-blue-700 border-blue-200",
    vi: "bg-purple-50 text-purple-700 border-purple-200",
    bsnl: "bg-orange-50 text-orange-700 border-orange-200",
    sip: "bg-teal-50 text-teal-700 border-teal-200",
    did: "bg-indigo-50 text-indigo-700 border-indigo-200",
    tollfree: "bg-green-50 text-green-700 border-green-200",
  };
  return <Badge className={colors[carrier] ?? "bg-gray-100 text-gray-700"}>{carrier.toUpperCase()}</Badge>;
}

// ── Overview Tab ──────────────────────────────────────────────────────────────

function OverviewTab({ overview }: { overview: HubOverview }) {
  const stats = [
    { label: "Total Numbers", value: overview.totalNumbers, icon: Phone, color: "text-blue-600" },
    { label: "Verified", value: overview.verifiedNumbers, icon: CheckCircle2, color: "text-green-600" },
    { label: "Pending Verification", value: overview.pendingVerification, icon: Clock, color: "text-yellow-600" },
    { label: "AI Enabled", value: overview.aiEnabledNumbers, icon: Zap, color: "text-purple-600" },
    { label: "SIP Trunks", value: overview.sipTrunks, icon: Wifi, color: "text-teal-600" },
    { label: "Language Rules", value: overview.languageRules, icon: Globe, color: "text-indigo-600" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {stats.map((s) => (
          <Card key={s.label} className="text-center">
            <CardContent className="pt-4 pb-4">
              <s.icon className={`h-6 w-6 mx-auto mb-2 ${s.color}`} />
              <p className="text-2xl font-bold">{s.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-sm">By Carrier</CardTitle></CardHeader>
          <CardContent>
            {Object.entries(overview.byCarrier).length === 0 ? (
              <p className="text-sm text-muted-foreground">No numbers registered yet</p>
            ) : (
              <div className="space-y-2">
                {Object.entries(overview.byCarrier).map(([carrier, count]) => (
                  <div key={carrier} className="flex items-center justify-between">
                    <CarrierBadge carrier={carrier} />
                    <span className="font-medium">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">By Integration Type</CardTitle></CardHeader>
          <CardContent>
            {Object.entries(overview.byIntegrationType).length === 0 ? (
              <p className="text-sm text-muted-foreground">No numbers registered yet</p>
            ) : (
              <div className="space-y-2">
                {Object.entries(overview.byIntegrationType).map(([type, count]) => (
                  <div key={type} className="flex items-center justify-between">
                    <span className="text-sm capitalize">{type.replace(/_/g, " ")}</span>
                    <Badge variant="secondary">{count}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── Numbers Tab ───────────────────────────────────────────────────────────────

function NumbersTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [verifyDialogOpen, setVerifyDialogOpen] = useState(false);
  const [verifyTarget, setVerifyTarget] = useState<EnterpriseNumber | null>(null);
  const [verifyStep, setVerifyStep] = useState<"method" | "otp">("method");
  const [verifyMethod, setVerifyMethod] = useState("otp_sms");
  const [verificationId, setVerificationId] = useState<number | null>(null);
  const [otp, setOtp] = useState("");

  const { data: numbers = [], isLoading } = useQuery<EnterpriseNumber[]>({
    queryKey: ["/api/enterprise-hub/numbers"],
    queryFn: () => apiFetch("/api/enterprise-hub/numbers"),
    staleTime: 30_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/enterprise-hub/numbers/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/enterprise-hub/numbers"] });
      qc.invalidateQueries({ queryKey: ["/api/enterprise-hub/overview"] });
      toast({ title: "Number removed" });
    },
  });

  const initVerifyMutation = useMutation({
    mutationFn: ({ id, method }: { id: number; method: string }) =>
      apiFetch(`/api/enterprise-hub/numbers/${id}/verify`, { method: "POST", body: JSON.stringify({ method }) }),
    onSuccess: (data: any) => {
      setVerificationId(data.verificationId);
      setVerifyStep("otp");
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const confirmVerifyMutation = useMutation({
    mutationFn: ({ verificationId, otp }: { verificationId: number; otp: string }) =>
      apiFetch("/api/enterprise-hub/numbers/verify/confirm", { method: "POST", body: JSON.stringify({ verificationId, otp }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/enterprise-hub/numbers"] });
      qc.invalidateQueries({ queryKey: ["/api/enterprise-hub/overview"] });
      setVerifyDialogOpen(false);
      setVerifyStep("method");
      setOtp("");
      toast({ title: "Number verified successfully!", description: "Your number is now active." });
    },
    onError: (e: any) => toast({ title: "Verification failed", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="text-center py-12 text-muted-foreground">Loading numbers...</div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{numbers.length} number{numbers.length !== 1 ? "s" : ""} registered</p>
        <Link href="/enterprise/hub/register">
          <Button size="sm"><Plus className="h-4 w-4 mr-2" />Register Number</Button>
        </Link>
      </div>

      {numbers.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <Phone className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-semibold mb-2">No numbers registered</h3>
            <p className="text-sm text-muted-foreground mb-4">Connect your existing Airtel, Jio, Vi, BSNL or SIP numbers</p>
            <Link href="/enterprise/hub/register">
              <Button><Plus className="h-4 w-4 mr-2" />Register Your First Number</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {numbers.map((n) => (
            <Card key={n.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <Phone className="h-5 w-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="font-semibold">{n.phoneNumber}</p>
                      {n.label && <p className="text-sm text-muted-foreground">{n.label}</p>}
                      <div className="flex flex-wrap gap-2 mt-2">
                        <CarrierBadge carrier={n.carrier} />
                        <Badge variant="outline" className="text-xs capitalize">{n.integrationType.replace(/_/g, " ")}</Badge>
                        <StatusBadge status={n.verificationStatus} />
                        {n.aiEnabled && <Badge className="bg-purple-100 text-purple-800 border-purple-200"><Zap className="h-3 w-3 mr-1" />AI</Badge>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {n.verificationStatus !== "verified" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => { setVerifyTarget(n); setVerifyStep("method"); setVerifyDialogOpen(true); }}
                      >
                        Verify
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => deleteMutation.mutate(n.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Verification Dialog */}
      <Dialog open={verifyDialogOpen} onOpenChange={(v) => { setVerifyDialogOpen(v); if (!v) { setVerifyStep("method"); setOtp(""); }}}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Verify Number Ownership</DialogTitle>
          </DialogHeader>
          {verifyStep === "method" ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Choose how to verify ownership of <strong>{verifyTarget?.phoneNumber}</strong></p>
              <div className="space-y-2">
                {[
                  { value: "otp_sms", label: "OTP via SMS" },
                  { value: "otp_call", label: "OTP via Voice Call" },
                  { value: "callback", label: "Missed Call Verification" },
                  { value: "manual_review", label: "Manual Review (1-2 days)" },
                ].map((m) => (
                  <label key={m.value} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${verifyMethod === m.value ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}>
                    <input type="radio" name="method" value={m.value} checked={verifyMethod === m.value} onChange={() => setVerifyMethod(m.value)} className="sr-only" />
                    <div className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${verifyMethod === m.value ? "border-primary" : "border-muted-foreground"}`}>
                      {verifyMethod === m.value && <div className="h-2 w-2 rounded-full bg-primary" />}
                    </div>
                    <span className="text-sm">{m.label}</span>
                  </label>
                ))}
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setVerifyDialogOpen(false)}>Cancel</Button>
                <Button
                  onClick={() => verifyTarget && initVerifyMutation.mutate({ id: verifyTarget.id, method: verifyMethod })}
                  disabled={initVerifyMutation.isPending}
                >
                  {initVerifyMutation.isPending ? "Sending..." : "Send Verification"}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Enter the 6-digit code sent to <strong>{verifyTarget?.phoneNumber}</strong></p>
              <Input
                placeholder="Enter OTP"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                maxLength={6}
                className="text-center text-2xl tracking-widest"
              />
              <DialogFooter>
                <Button variant="ghost" onClick={() => setVerifyStep("method")}>Back</Button>
                <Button
                  onClick={() => verificationId && confirmVerifyMutation.mutate({ verificationId, otp })}
                  disabled={otp.length !== 6 || confirmVerifyMutation.isPending}
                >
                  {confirmVerifyMutation.isPending ? "Verifying..." : "Confirm"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── AI Control Tab ────────────────────────────────────────────────────────────

function AiControlTab() {
  const { data: numbers = [] } = useQuery<EnterpriseNumber[]>({
    queryKey: ["/api/enterprise-hub/numbers"],
    queryFn: () => apiFetch("/api/enterprise-hub/numbers"),
    staleTime: 30_000,
  });

  const [selectedNumberId, setSelectedNumberId] = useState<number | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: aiConfig } = useQuery<AiConfiguration | null>({
    queryKey: ["/api/enterprise-hub/ai-config", selectedNumberId],
    queryFn: () => selectedNumberId ? apiFetch(`/api/enterprise-hub/ai-config/${selectedNumberId}`) : null,
    enabled: !!selectedNumberId,
    staleTime: 30_000,
  });

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiFetch("/api/enterprise-hub/ai-config", { method: "POST", body: JSON.stringify({ ...data, enterpriseNumberId: selectedNumberId }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/enterprise-hub/ai-config", selectedNumberId] });
      qc.invalidateQueries({ queryKey: ["/api/enterprise-hub/overview"] });
      toast({ title: "AI configuration saved" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const defaultConfig: AiConfiguration = {
    translationEnabled: false, transcriptionEnabled: false, sentimentAnalysisEnabled: false,
    agentAssistEnabled: false, qualityMonitoringEnabled: false, callSummaryEnabled: false,
    piiRedactionEnabled: false, defaultSrcLanguage: "auto", defaultTgtLanguage: "en-US",
  };

  const cfg = aiConfig ?? defaultConfig;

  const toggles = [
    { key: "translationEnabled", label: "Real-time Translation", description: "Translate calls between caller and agent languages" },
    { key: "transcriptionEnabled", label: "Call Transcription", description: "Auto-transcribe every call to text" },
    { key: "sentimentAnalysisEnabled", label: "Sentiment Analysis", description: "Detect caller sentiment in real-time" },
    { key: "agentAssistEnabled", label: "Agent Assist", description: "Live suggestions and knowledge cards for agents" },
    { key: "qualityMonitoringEnabled", label: "Quality Monitoring", description: "AI-based call quality scoring" },
    { key: "callSummaryEnabled", label: "Call Summary", description: "Auto-generate post-call summaries" },
    { key: "piiRedactionEnabled", label: "PII Redaction", description: "Automatically redact Aadhaar, PAN, phone numbers from transcripts" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <Label>Select Number to Configure</Label>
        <Select value={selectedNumberId?.toString() ?? ""} onValueChange={(v) => setSelectedNumberId(Number(v))}>
          <SelectTrigger className="mt-1.5">
            <SelectValue placeholder="Choose a number..." />
          </SelectTrigger>
          <SelectContent>
            {numbers.map((n) => (
              <SelectItem key={n.id} value={n.id.toString()}>
                {n.phoneNumber}{n.label ? ` — ${n.label}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!selectedNumberId ? (
        <Card className="text-center py-8">
          <CardContent><p className="text-muted-foreground text-sm">Select a number above to configure AI services</p></CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {toggles.map((t) => (
            <div key={t.key} className="flex items-center justify-between p-4 rounded-lg border">
              <div>
                <p className="font-medium text-sm">{t.label}</p>
                <p className="text-xs text-muted-foreground">{t.description}</p>
              </div>
              <Switch
                checked={(cfg as any)[t.key] as boolean}
                onCheckedChange={(checked) => saveMutation.mutate({ ...cfg, [t.key]: checked })}
              />
            </div>
          ))}

          <Card>
            <CardHeader><CardTitle className="text-sm">Default Languages</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Caller Language</Label>
                <Select value={cfg.defaultSrcLanguage ?? "auto"} onValueChange={(v) => saveMutation.mutate({ ...cfg, defaultSrcLanguage: v })}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto Detect</SelectItem>
                    <SelectItem value="hi-IN">Hindi (India)</SelectItem>
                    <SelectItem value="te-IN">Telugu (India)</SelectItem>
                    <SelectItem value="ta-IN">Tamil (India)</SelectItem>
                    <SelectItem value="kn-IN">Kannada (India)</SelectItem>
                    <SelectItem value="ml-IN">Malayalam (India)</SelectItem>
                    <SelectItem value="mr-IN">Marathi (India)</SelectItem>
                    <SelectItem value="bn-IN">Bengali (India)</SelectItem>
                    <SelectItem value="en-IN">English (India)</SelectItem>
                    <SelectItem value="en-US">English (US)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Agent Language</Label>
                <Select value={cfg.defaultTgtLanguage ?? "en-US"} onValueChange={(v) => saveMutation.mutate({ ...cfg, defaultTgtLanguage: v })}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en-US">English (US)</SelectItem>
                    <SelectItem value="en-IN">English (India)</SelectItem>
                    <SelectItem value="hi-IN">Hindi</SelectItem>
                    <SelectItem value="te-IN">Telugu</SelectItem>
                    <SelectItem value="ta-IN">Tamil</SelectItem>
                    <SelectItem value="kn-IN">Kannada</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// ── Compliance Tab ────────────────────────────────────────────────────────────

function ComplianceTab() {
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["/api/enterprise-hub/audit-logs"],
    queryFn: () => apiFetch("/api/enterprise-hub/audit-logs"),
    staleTime: 60_000,
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2"><Shield className="h-4 w-4" />Integration Audit Trail</CardTitle>
          <CardDescription>Every action on your numbers is logged for compliance</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading logs...</p>
          ) : (logs as any[]).length === 0 ? (
            <p className="text-sm text-muted-foreground">No audit logs yet</p>
          ) : (
            <div className="space-y-2">
              {(logs as any[]).slice(0, 50).map((log: any) => (
                <div key={log.id} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 text-sm">
                  <FileText className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="font-medium capitalize">{log.action.replace(/_/g, " ")}</span>
                    {log.details && Object.keys(log.details).length > 0 && (
                      <span className="text-muted-foreground"> — {JSON.stringify(log.details).slice(0, 80)}</span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground flex-shrink-0">
                    {new Date(log.createdAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── SIP Tab ───────────────────────────────────────────────────────────────────

function SipTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ label: "", sipServer: "", sipPort: 5060, sipUsername: "", sipPassword: "", transport: "udp" });

  const { data: sips = [], isLoading } = useQuery<SipIntegration[]>({
    queryKey: ["/api/enterprise-hub/sip"],
    queryFn: () => apiFetch("/api/enterprise-hub/sip"),
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof form) => apiFetch("/api/enterprise-hub/sip", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/enterprise-hub/sip"] });
      qc.invalidateQueries({ queryKey: ["/api/enterprise-hub/overview"] });
      setOpen(false);
      setForm({ label: "", sipServer: "", sipPort: 5060, sipUsername: "", sipPassword: "", transport: "udp" });
      toast({ title: "SIP trunk added" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/enterprise-hub/sip/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/enterprise-hub/sip"] }); toast({ title: "SIP trunk removed" }); },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{sips.length} SIP trunk{sips.length !== 1 ? "s" : ""} configured</p>
        <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-2" />Add SIP Trunk</Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : sips.length === 0 ? (
        <Card className="text-center py-10">
          <CardContent>
            <Wifi className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="font-medium mb-1">No SIP trunks configured</p>
            <p className="text-sm text-muted-foreground">Add SIP trunk credentials to connect your PBX or cloud phone system</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {sips.map((s) => (
            <Card key={s.id}>
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium">{s.label}</p>
                  <p className="text-sm text-muted-foreground">{s.sipServer}:{s.sipPort} ({s.transport.toUpperCase()})</p>
                  <Badge className="mt-1" variant={s.registrationStatus === "registered" ? "default" : "secondary"}>
                    {s.registrationStatus ?? "unknown"}
                  </Badge>
                </div>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => deleteMutation.mutate(s.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add SIP Trunk</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Label</Label><Input className="mt-1" placeholder="e.g. Office PBX" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></div>
            <div><Label>SIP Server</Label><Input className="mt-1" placeholder="sip.yourprovider.com" value={form.sipServer} onChange={(e) => setForm({ ...form, sipServer: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Port</Label><Input className="mt-1" type="number" value={form.sipPort} onChange={(e) => setForm({ ...form, sipPort: Number(e.target.value) })} /></div>
              <div>
                <Label>Transport</Label>
                <Select value={form.transport} onValueChange={(v) => setForm({ ...form, transport: v })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="udp">UDP</SelectItem>
                    <SelectItem value="tcp">TCP</SelectItem>
                    <SelectItem value="tls">TLS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>SIP Username (optional)</Label><Input className="mt-1" value={form.sipUsername} onChange={(e) => setForm({ ...form, sipUsername: e.target.value })} /></div>
            <div><Label>SIP Password (optional)</Label><Input className="mt-1" type="password" value={form.sipPassword} onChange={(e) => setForm({ ...form, sipPassword: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate(form)} disabled={!form.label || !form.sipServer || createMutation.isPending}>
              {createMutation.isPending ? "Saving..." : "Add Trunk"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function NumberHub() {
  const { data: overview, isLoading } = useQuery<HubOverview>({
    queryKey: ["/api/enterprise-hub/overview"],
    queryFn: () => apiFetch("/api/enterprise-hub/overview"),
    staleTime: 60_000,
  });

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Phone className="h-6 w-6 text-primary" />
            Existing Number Integration Hub
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Connect your Airtel / Jio / Vi / BSNL / SIP numbers — NeuraTalk becomes your AI layer, no number migration needed
          </p>
        </div>
        <Link href="/enterprise/hub/register">
          <Button><Plus className="h-4 w-4 mr-2" />Register Number</Button>
        </Link>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="mb-6">
          <TabsTrigger value="overview" className="flex items-center gap-2"><Activity className="h-4 w-4" />Overview</TabsTrigger>
          <TabsTrigger value="numbers" className="flex items-center gap-2"><Phone className="h-4 w-4" />Numbers</TabsTrigger>
          <TabsTrigger value="sip" className="flex items-center gap-2"><Wifi className="h-4 w-4" />SIP Trunks</TabsTrigger>
          <TabsTrigger value="ai" className="flex items-center gap-2"><Zap className="h-4 w-4" />AI Control</TabsTrigger>
          <TabsTrigger value="compliance" className="flex items-center gap-2"><Shield className="h-4 w-4" />Compliance</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          {isLoading ? (
            <div className="text-center py-12 text-muted-foreground">Loading overview...</div>
          ) : overview ? (
            <OverviewTab overview={overview} />
          ) : null}
        </TabsContent>

        <TabsContent value="numbers">
          <NumbersTab />
        </TabsContent>

        <TabsContent value="sip">
          <SipTab />
        </TabsContent>

        <TabsContent value="ai">
          <AiControlTab />
        </TabsContent>

        <TabsContent value="compliance">
          <ComplianceTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
