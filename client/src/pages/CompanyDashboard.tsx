import { useState } from "react";
import { Link } from "wouter";
import { useAuth, getAuthToken } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sparkles, LogOut, Users, CreditCard, BarChart3, Phone, PhoneCall, Video,
  Settings, Plus, Clock, Check, X, Loader2, Copy, Eye, EyeOff,
  Building2, Key, Activity, ExternalLink, FileText, UserPlus, Languages,
  Share2, Link2, Globe, Headphones, Monitor
} from "lucide-react";

type Tab = "overview" | "agents" | "api" | "settings";

export default function CompanyDashboard() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: dashboard, isLoading: dashboardLoading } = useQuery({
    queryKey: ["/api/b2b/company/dashboard"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/b2b/company/dashboard", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load dashboard");
      return res.json();
    },
  });

  const { data: agents, isLoading: agentsLoading } = useQuery({
    queryKey: ["/api/company/agents"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/company/agents", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load agents");
      return res.json();
    },
    enabled: activeTab === "agents",
  });

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "overview", label: "Overview", icon: <BarChart3 className="w-4 h-4" /> },
    { id: "agents", label: "Team", icon: <Users className="w-4 h-4" /> },
    { id: "api", label: "API & SDK", icon: <Key className="w-4 h-4" /> },
    { id: "settings", label: "Settings", icon: <Settings className="w-4 h-4" /> },
  ];

  const isPending = user?.organization?.status === "pending";

  if (isPending) {
    return <PendingApprovalScreen user={user} logout={logout} />;
  }

  return (
    <div className="min-h-screen mesh-bg text-foreground overflow-hidden flex flex-col font-sans">
      <header className="border-b border-white/10 bg-black/20 backdrop-blur-xl sticky top-0 z-50">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/company">
              <div className="flex items-center gap-2 cursor-pointer hover:opacity-80 font-bold">
                <Sparkles className="w-5 h-5 text-primary" />
                <span>NeuraTalk</span>
              </div>
            </Link>
            <Badge variant="secondary" className="text-xs hidden sm:flex">
              {user?.organization?.name || "Company"}
            </Badge>
          </div>
          
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground hidden sm:block">
              {user?.email || user?.username}
            </span>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={logout}
              data-testid="button-logout"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="container mx-auto px-4 py-6">
          <div className="flex gap-2 mb-8 overflow-x-auto pb-2 scrollbar-none">
            {tabs.map((tab) => (
              <Button
                key={tab.id}
                variant={activeTab === tab.id ? "default" : "ghost"}
                size="sm"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 font-bold transition-all ${
                  activeTab === tab.id 
                    ? "shadow-lg shadow-primary/20 scale-105" 
                    : "hover:bg-white/5"
                }`}
                data-testid={`tab-${tab.id}`}
              >
                {tab.icon}
                {tab.label}
              </Button>
            ))}
          </div>

          {activeTab === "overview" && (
            <OverviewTab dashboard={dashboard} isLoading={dashboardLoading} />
          )}

          {activeTab === "agents" && (
            <AgentsTab agents={agents} isLoading={agentsLoading} />
          )}

          {activeTab === "api" && (
            <ApiTab />
          )}

          {activeTab === "settings" && (
            <SettingsTab organization={user?.organization} />
          )}
        </div>
      </div>
    </div>
  );
}

function PendingApprovalScreen({ user, logout }: { user: any; logout: () => void }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-md w-full"
      >
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-amber-500/20 flex items-center justify-center">
              <Clock className="w-8 h-8 text-amber-400" />
            </div>
            
            <h2 className="text-xl font-semibold mb-2">Pending Approval</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Your company <span className="font-medium text-foreground">{user?.organization?.name}</span> is awaiting admin approval.
            </p>
            
            <div className="p-4 rounded-lg bg-white/5 text-left mb-4">
              <p className="text-xs text-muted-foreground">
                You'll receive access to your dashboard, credits, and API once approved.
              </p>
            </div>

            <Button variant="outline" onClick={logout} data-testid="button-logout">
              <LogOut className="w-4 h-4 mr-2" /> Sign Out
            </Button>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

function OverviewTab({ dashboard, isLoading }: { dashboard: any; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  const stats = [
    { label: "Credit Balance", value: dashboard?.credits || 0, icon: <CreditCard className="w-5 h-5" /> },
    { label: "Active Agents", value: dashboard?.agentCount || 0, icon: <Users className="w-5 h-5" /> },
    { label: "Calls Today", value: dashboard?.callsToday || 0, icon: <Phone className="w-5 h-5" /> },
    { label: "Minutes Used", value: dashboard?.minutesUsed || 0, icon: <Activity className="w-5 h-5" /> },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
          >
            <Card className="glass-card overflow-hidden shine-effect">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-primary font-bold uppercase tracking-widest opacity-70">{stat.label}</p>
                    <p className="text-3xl font-display font-bold mt-1 tabular-nums">{stat.value}</p>
                  </div>
                  <div className="p-2 rounded-lg bg-primary/10 text-primary">{stat.icon}</div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <motion.div 
          className="space-y-6"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.4 }}
        >
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-sm font-display font-bold flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" />
                Quick Actions
              </CardTitle>
              <CardDescription className="text-xs">Direct translation tools</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Link href="/calls/video-translation">
                <Button className="w-full justify-start shine-effect" data-testid="button-video-call">
                  <Video className="mr-3 h-4 w-4" />
                  Video Translation Call
                </Button>
              </Link>
              <Link href="/calls/voice-translation">
                <Button variant="outline" className="w-full justify-start hover:bg-white/5" data-testid="button-voice-call">
                  <Phone className="mr-3 h-4 w-4" />
                  Voice Translation Call
                </Button>
              </Link>
              <Link href="/calls/b2b">
                <Button variant="outline" className="w-full justify-start bg-green-500/10 border-green-500/20 hover:bg-green-500/20 text-green-400" data-testid="button-sim-call">
                  <PhoneCall className="mr-3 h-4 w-4" />
                  Phone Bridge Call
                </Button>
              </Link>
            </CardContent>
          </Card>

          <ClientConnectCard />
        </motion.div>

        <motion.div 
          className="lg:col-span-2"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.5 }}
        >
          <Card className="glass-card h-full">
            <CardHeader>
              <CardTitle className="text-sm font-display font-bold flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary" />
                Recent Organization Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center justify-center py-20 opacity-50 space-y-4">
                <div className="w-12 h-12 rounded-full border border-dashed border-white/20 flex items-center justify-center">
                  <Activity className="w-5 h-5 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground font-medium">
                  Your call history and team audit logs will appear here.
                </p>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  );
}

const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "zh", name: "Chinese" },
  { code: "ja", name: "Japanese" },
  { code: "hi", name: "Hindi" },
  { code: "te", name: "Telugu" },
  { code: "ta", name: "Tamil" },
  { code: "kn", name: "Kannada" },
  { code: "ar", name: "Arabic" },
  { code: "pt", name: "Portuguese" },
  { code: "ru", name: "Russian" },
  { code: "ko", name: "Korean" },
  { code: "ml", name: "Malayalam" },
  { code: "mr", name: "Marathi" },
  { code: "gu", name: "Gujarati" },
  { code: "bn", name: "Bengali" },
  { code: "pa", name: "Punjabi" },
  { code: "it", name: "Italian" },
];

function ClientConnectCard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [callType, setCallType] = useState<"video" | "audio" | "f2f">("video");
  const [myLanguage, setMyLanguage] = useState("en");
  const [clientLanguage, setClientLanguage] = useState("te");
  const [isCreating, setIsCreating] = useState(false);
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const handleCreateSession = async () => {
    setIsCreating(true);
    try {
      const token = getAuthToken();
      const response = await fetch("/api/rooms/create", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          callType,
          hostLanguage: myLanguage,
          guestLanguage: clientLanguage,
          translationEnabled: true,
          voicePreservation: true,
          emotionPreservation: true,
          hostName: user?.username || user?.email || "Company Agent",
        }),
      });
      if (!response.ok) throw new Error("Failed to create session");
      const data = await response.json();
      setGeneratedLink(data.joinLink);
      toast({ title: "Session Created", description: "Share the link with your client" });
    } catch (err) {
      toast({ title: "Error", description: "Could not create session", variant: "destructive" });
    } finally {
      setIsCreating(false);
    }
  };

  const copyLink = () => {
    if (generatedLink) {
      navigator.clipboard.writeText(generatedLink);
      setLinkCopied(true);
      toast({ title: "Link Copied" });
      setTimeout(() => setLinkCopied(false), 2000);
    }
  };

  const resetSession = () => {
    setGeneratedLink(null);
    setLinkCopied(false);
  };

  const callTypeOptions = [
    { value: "video" as const, label: "Video Call", icon: <Video className="w-4 h-4" />, desc: "Face-to-face with camera" },
    { value: "audio" as const, label: "Voice Call", icon: <Headphones className="w-4 h-4" />, desc: "Audio only" },
    { value: "f2f" as const, label: "Face-to-Face", icon: <Monitor className="w-4 h-4" />, desc: "In-person meeting with translation" },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Link2 className="w-4 h-4 text-primary" />
          Client Connect
        </CardTitle>
        <CardDescription>Generate a secure link for clients to join from their browser</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!generatedLink ? (
          <>
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {callTypeOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setCallType(opt.value)}
                    className={`p-2 rounded-lg border text-center transition-all text-xs ${
                      callType === opt.value 
                        ? "border-primary bg-primary/10 text-primary" 
                        : "border-white/10 hover:border-white/20 text-muted-foreground"
                    }`}
                    data-testid={`calltype-${opt.value}`}
                  >
                    <div className="flex flex-col items-center gap-1">
                      {opt.icon}
                      <span className="font-medium">{opt.label}</span>
                    </div>
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Your Language</label>
                  <Select value={myLanguage} onValueChange={setMyLanguage}>
                    <SelectTrigger className="h-8 text-xs" data-testid="select-my-language">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LANGUAGES.map(l => (
                        <SelectItem key={l.code} value={l.code}>{l.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Client Language</label>
                  <Select value={clientLanguage} onValueChange={setClientLanguage}>
                    <SelectTrigger className="h-8 text-xs" data-testid="select-client-language">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LANGUAGES.map(l => (
                        <SelectItem key={l.code} value={l.code}>{l.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <Button 
              className="w-full" 
              onClick={handleCreateSession} 
              disabled={isCreating}
              data-testid="button-create-session"
            >
              {isCreating ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating...</>
              ) : (
                <><Plus className="w-4 h-4 mr-2" />Create Client Session</>
              )}
            </Button>
          </>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-3"
          >
            <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
              <div className="flex items-center gap-2 mb-2">
                <Check className="w-4 h-4 text-green-400" />
                <span className="text-sm font-medium text-green-400">Session Ready</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <Globe className="w-3 h-3" />
                {LANGUAGES.find(l => l.code === myLanguage)?.name} → {LANGUAGES.find(l => l.code === clientLanguage)?.name}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {callTypeOptions.find(o => o.value === callType)?.icon}
                <span>{callTypeOptions.find(o => o.value === callType)?.label}</span>
              </div>
            </div>

            <div className="flex gap-2">
              <Input 
                value={generatedLink} 
                readOnly 
                className="text-xs font-mono h-8 bg-muted/50" 
                data-testid="input-generated-link"
              />
              <Button 
                size="sm" 
                variant={linkCopied ? "default" : "secondary"} 
                onClick={copyLink}
                className="h-8 px-3 shrink-0"
                data-testid="button-copy-link"
              >
                {linkCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              </Button>
            </div>

            <div className="flex gap-2">
              <Link href={callType === "video" ? "/calls/video-translation" : callType === "audio" ? "/calls/voice-translation" : "/calls/video-translation"} className="flex-1">
                <Button className="w-full" size="sm" data-testid="button-open-call">
                  <ExternalLink className="w-3 h-3 mr-2" />
                  Open Call Page
                </Button>
              </Link>
              <Button variant="outline" size="sm" onClick={resetSession} data-testid="button-new-session">
                <Plus className="w-3 h-3 mr-1" />New
              </Button>
            </div>
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
}

function AgentsTab({ agents, isLoading }: { agents: any; isLoading: boolean }) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAgentEmail, setNewAgentEmail] = useState("");
  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentPhone, setNewAgentPhone] = useState("");
  const [newAgentRole, setNewAgentRole] = useState<"agent" | "company_admin">("agent");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const addAgentMutation = useMutation({
    mutationFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/company/agents", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ 
          email: newAgentEmail, 
          name: newAgentName,
          phone: newAgentPhone || undefined,
          role: newAgentRole 
        }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to add team member");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/agents"] });
      setShowAddForm(false);
      setNewAgentEmail("");
      setNewAgentName("");
      setNewAgentPhone("");
      setNewAgentRole("agent");
      toast({ title: "Team Member Added", description: "New team member has been created" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) return <div className="text-center py-10"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-bold">Team Members</h2>
        <Button size="sm" onClick={() => setShowAddForm(true)}><UserPlus className="w-4 h-4 mr-2" /> Add Member</Button>
      </div>

      {showAddForm && (
        <Card>
          <CardHeader><CardTitle className="text-base">Add New Member</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input placeholder="Name" value={newAgentName} onChange={e => setNewAgentName(e.target.value)} />
              <Input placeholder="Email" value={newAgentEmail} onChange={e => setNewAgentEmail(e.target.value)} />
              <Input placeholder="Phone (Optional)" value={newAgentPhone} onChange={e => setNewAgentPhone(e.target.value)} />
              <Select value={newAgentRole} onValueChange={(v: any) => setNewAgentRole(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="agent">Agent</SelectItem>
                  <SelectItem value="company_admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => addAgentMutation.mutate()} disabled={addAgentMutation.isPending}>Add Member</Button>
              <Button variant="ghost" onClick={() => setShowAddForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {agents?.agents?.map((agent: any) => (
            <div key={agent.id} className="p-4 border-b last:border-0 flex items-center justify-between">
              <div>
                <p className="font-bold">{agent.username || agent.email}</p>
                <p className="text-xs text-muted-foreground">{agent.email} • {agent.role}</p>
              </div>
              <Badge variant={agent.isActive ? "default" : "secondary"}>{agent.isActive ? "Active" : "Inactive"}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function ApiTab() {
  const [showKey, setShowKey] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: apiKeyData, isLoading: keyLoading } = useQuery({
    queryKey: ["/api/company/api-key"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/company/api-key", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { key: null };
      return res.json();
    },
  });

  const generateKeyMutation = useMutation({
    mutationFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/company/api-key/generate", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to generate key");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/api-key"] });
      toast({ title: "Success", description: "New API key generated" });
    },
  });

  const apiKey = apiKeyData?.key || "";
  const maskedKey = apiKey ? `ntk_live_••••••••${apiKey.slice(-8)}` : "No API key";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-sm">API Key</CardTitle></CardHeader>
        <CardContent className="flex items-center gap-2">
          <code className="bg-muted p-2 rounded flex-1 text-sm">{showKey ? apiKey : maskedKey}</code>
          <Button variant="ghost" size="icon" onClick={() => setShowKey(!showKey)}>{showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</Button>
          <Button variant="ghost" size="icon" onClick={() => { navigator.clipboard.writeText(apiKey); toast({ title: "Copied" }); }}><Copy className="w-4 h-4" /></Button>
        </CardContent>
      </Card>
    </div>
  );
}

function SettingsTab({ organization }: { organization: any }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Organization Settings</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="text-xs text-muted-foreground">Name</label>
          <p className="font-bold">{organization?.name}</p>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Status</label>
          <Badge>{organization?.status}</Badge>
        </div>
      </CardContent>
    </Card>
  );
}
