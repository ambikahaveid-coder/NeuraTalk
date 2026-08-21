import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useAuth, getAuthToken } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { QueryErrorState } from "@/components/QueryErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Sparkles, LogOut, Building2, Settings, Check, X, Loader2,
  Users, CreditCard, BarChart3, Shield, Clock, Plus, Minus,
  Phone, Receipt, LayoutDashboard, Bell, Database, Cog,
  TrendingUp, DollarSign, Activity, UserCheck, Search, Edit,
  Trash2, Eye, FileText, Download, Radio, Key, AlertTriangle,
  CheckCircle, XCircle, RefreshCw, History, Globe, Scale,
  HeartPulse, Flag, Headphones, Server, Zap, Lock, PhoneCall,
  Languages, BookOpen, HelpCircle, ToggleLeft, Gauge, MonitorCheck, Video
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CallLogsSection, LanguagesSection, FeatureFlagsSection, LegalSection, SupportSection, SystemHealthSection, SlaDashboardSection, AbuseReportsSection, PaymentGatewaysSection, ComplianceSection, PlatformSettingsSection, WebhooksSection, TenantsSection, DiagnosticsSection, CommunicationApiSection, LocationsSection } from "./AdminSections";

type Section = "overview" | "companies" | "users" | "billing" | "analytics" | "calls" | "languages" | "integrations" | "feature-flags" | "legal" | "support" | "health" | "sla" | "abuse" | "payments" | "audit" | "settings" | "compliance" | "platform-settings" | "webhooks" | "tenants" | "diagnostics" | "communication-api" | "locations";

const menuItems: { id: Section; label: string; icon: React.ReactNode; group?: string }[] = [
  { id: "overview", label: "Overview", icon: <LayoutDashboard className="w-4 h-4" />, group: "Dashboard" },
  { id: "companies", label: "Companies", icon: <Building2 className="w-4 h-4" />, group: "Management" },
  { id: "tenants", label: "Tenants", icon: <Building2 className="w-4 h-4" />, group: "Management" },
  { id: "users", label: "Users & Roles", icon: <Users className="w-4 h-4" />, group: "Management" },
  { id: "calls", label: "Call Logs", icon: <PhoneCall className="w-4 h-4" />, group: "Management" },
  { id: "billing", label: "Billing & Plans", icon: <CreditCard className="w-4 h-4" />, group: "Revenue" },
  { id: "payments", label: "Payment Gateways", icon: <CreditCard className="w-4 h-4" />, group: "Revenue" },
  { id: "analytics", label: "Analytics", icon: <BarChart3 className="w-4 h-4" />, group: "Revenue" },
  { id: "languages", label: "Languages", icon: <Globe className="w-4 h-4" />, group: "Platform" },
  { id: "integrations", label: "API & Keys", icon: <Key className="w-4 h-4" />, group: "Platform" },
  { id: "webhooks", label: "Webhooks", icon: <Key className="w-4 h-4" />, group: "Platform" },
  { id: "communication-api", label: "Communication API", icon: <Key className="w-4 h-4" />, group: "Platform" },
  { id: "locations", label: "Locations", icon: <Globe className="w-4 h-4" />, group: "Platform" },
  { id: "feature-flags", label: "Feature Flags", icon: <ToggleLeft className="w-4 h-4" />, group: "Platform" },
  { id: "platform-settings", label: "Platform Settings", icon: <Settings className="w-4 h-4" />, group: "Platform" },
  { id: "legal", label: "Legal & Content", icon: <Scale className="w-4 h-4" />, group: "Content" },
  { id: "support", label: "Support", icon: <Headphones className="w-4 h-4" />, group: "Content" },
  { id: "health", label: "System Health", icon: <HeartPulse className="w-4 h-4" />, group: "System" },
  { id: "sla", label: "SLA Dashboard", icon: <HeartPulse className="w-4 h-4" />, group: "System" },
  { id: "diagnostics", label: "Diagnostics", icon: <HeartPulse className="w-4 h-4" />, group: "System" },
  { id: "compliance", label: "Compliance", icon: <Shield className="w-4 h-4" />, group: "System" },
  { id: "abuse", label: "Abuse Reports", icon: <Shield className="w-4 h-4" />, group: "System" },
  { id: "audit", label: "Audit Logs", icon: <History className="w-4 h-4" />, group: "System" },
  { id: "settings", label: "Settings", icon: <Settings className="w-4 h-4" />, group: "System" },
];

export default function SuperAdminDashboard() {
  const { user, logout } = useAuth();
  const [activeSection, setActiveSection] = useState<Section>("overview");

  return (
    <div className="min-h-screen bg-background flex">
      <aside className="w-64 border-r bg-card/50 flex flex-col">
        <div className="p-4 border-b">
          <Link href="/admin">
            <div className="flex items-center gap-2 cursor-pointer">
              <Sparkles className="w-6 h-6 text-primary" />
              <span className="font-bold text-lg">NeuraTalk</span>
            </div>
          </Link>
          <Badge variant="destructive" className="mt-2 text-xs">
            <Shield className="w-3 h-3 mr-1" />
            Super Admin
          </Badge>
        </div>

        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {(() => {
            let lastGroup = "";
            return menuItems.map((item) => {
              const showGroup = item.group && item.group !== lastGroup;
              lastGroup = item.group || "";
              return (
                <div key={item.id}>
                  {showGroup && (
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 px-3 pt-3 pb-1 font-semibold">
                      {item.group}
                    </p>
                  )}
                  <button
                    onClick={() => setActiveSection(item.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      activeSection === item.id
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                    data-testid={`menu-${item.id}`}
                  >
                    {item.icon}
                    {item.label}
                  </button>
                </div>
              );
            });
          })()}
        </nav>

        <div className="p-4 border-t">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
              <Shield className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.email || user?.phone}</p>
              <p className="text-xs text-muted-foreground">Administrator</p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="w-full" onClick={logout} data-testid="button-logout">
            <LogOut className="w-4 h-4 mr-2" />
            Logout
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <header className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold capitalize">{activeSection}</h1>
              <p className="text-sm text-muted-foreground">
                {{ overview: "Platform overview and quick actions", companies: "Manage B2B company accounts", tenants: "Per-tenant database isolation, security policy & health", users: "Manage platform users & role assignments", billing: "Revenue plans, subscriptions & invoices", payments: "Payment gateway configuration", analytics: "Platform metrics, charts & reports", calls: "View all call logs & quality metrics", languages: "Manage supported translation languages", integrations: "Enterprise API keys & third-party configs", webhooks: "Per-company webhook endpoints", "communication-api": "Communication API sessions & pricing", locations: "Countries, states, cities & pincodes", "feature-flags": "Toggle platform features & rollout control", "platform-settings": "Generic platform key/value configuration", legal: "Legal documents, privacy policy & terms", support: "Support contacts & help resources", health: "Real-time system health & service status", sla: "Availability, latency & throughput SLAs", diagnostics: "Active translator bots & live pipeline test", compliance: "Backup jobs & data residency policies", abuse: "Review and act on user-submitted reports", audit: "System activity and audit trail", settings: "Platform-wide configuration" }[activeSection]}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/admin/live">
                <Button size="sm" variant="destructive" data-testid="button-live-monitor">
                  <Radio className="w-4 h-4 mr-2 animate-pulse" />
                  Live Monitor
                </Button>
              </Link>
              <Link href="/admin/config">
                <Button variant="outline" size="sm" data-testid="button-config">
                  <Cog className="w-4 h-4 mr-2" />
                  Config
                </Button>
              </Link>
              <Link href="/admin/transcripts">
                <Button variant="outline" size="sm" data-testid="button-transcripts">
                  <FileText className="w-4 h-4 mr-2" />
                  Transcripts
                </Button>
              </Link>
              <Link href="/call">
                <Button variant="outline" size="sm" data-testid="button-call">
                  <Phone className="w-4 h-4 mr-2" />
                  Call
                </Button>
              </Link>
            </div>
          </div>
        </header>

        <div className="p-6">
          {activeSection === "overview" && <OverviewSection />}
          {activeSection === "companies" && <CompaniesSection />}
          {activeSection === "users" && <UsersSection />}
          {activeSection === "billing" && <BillingSection />}
          {activeSection === "analytics" && <AnalyticsSection />}
          {activeSection === "calls" && <CallLogsSection />}
          {activeSection === "languages" && <LanguagesSection />}
          {activeSection === "integrations" && <IntegrationsSection />}
          {activeSection === "feature-flags" && <FeatureFlagsSection />}
          {activeSection === "legal" && <LegalSection />}
          {activeSection === "support" && <SupportSection />}
          {activeSection === "health" && <SystemHealthSection />}
          {activeSection === "sla" && <SlaDashboardSection />}
          {activeSection === "diagnostics" && <DiagnosticsSection />}
          {activeSection === "compliance" && <ComplianceSection />}
          {activeSection === "abuse" && <AbuseReportsSection />}
          {activeSection === "payments" && <PaymentGatewaysSection />}
          {activeSection === "platform-settings" && <PlatformSettingsSection />}
          {activeSection === "webhooks" && <WebhooksSection />}
          {activeSection === "tenants" && <TenantsSection />}
          {activeSection === "communication-api" && <CommunicationApiSection />}
          {activeSection === "locations" && <LocationsSection />}
          {activeSection === "audit" && <AuditSection />}
          {activeSection === "settings" && <SettingsSection />}
        </div>
      </main>
    </div>
  );
}

function OverviewSection() {
  const { data: stats, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["/api/admin/stats"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/admin/stats", {
        headers: { Authorization: `Bearer ${token}` },
      });
      // Previously swallowed every failure into fake zero stats — the
      // first thing a super admin sees on login would silently read
      // "0 companies, 0 users, ₹0 revenue" during a real outage instead of
      // showing an actual error. Let it throw so isError reflects reality.
      if (!res.ok) throw new Error("Failed to load platform stats");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const { data: pendingCompanies } = useQuery({
    queryKey: ["/api/admin/companies"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/admin/companies", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { companies: [] };
      return res.json();
    },
  });

  const pendingCount = pendingCompanies?.companies?.filter((c: any) => c.status === "pending").length || 0;

  if (isError) {
    return (
      <div className="max-w-md mx-auto py-8">
        <QueryErrorState error={error} onRetry={() => refetch()} label="platform stats" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
        ) : (
        <>
        <StatCard
          title="Total Companies"
          value={stats?.companies || 0}
          icon={<Building2 className="w-5 h-5" />}
        />
        <StatCard
          title="Active Users"
          value={stats?.users || 0}
          icon={<Users className="w-5 h-5" />}
        />
        <StatCard
          title="Monthly Revenue"
          value={`₹${(stats?.revenue || 0).toLocaleString()}`}
          icon={<DollarSign className="w-5 h-5" />}
        />
        <StatCard
          title="Total Calls"
          value={stats?.calls || 0}
          icon={<Phone className="w-5 h-5" />}
        />
        </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Bell className="w-5 h-5 text-amber-500" />
              Pending Actions
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pendingCount > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
                      <Clock className="w-5 h-5 text-amber-500" />
                    </div>
                    <div>
                      <p className="font-medium">{pendingCount} Companies Pending</p>
                      <p className="text-sm text-muted-foreground">Awaiting approval</p>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-amber-500 border-amber-500">
                    Review
                  </Badge>
                </div>
              </div>
            ) : (
              <div className="text-center py-6 text-muted-foreground">
                <Check className="w-8 h-8 mx-auto mb-2 text-green-500" />
                <p>All caught up!</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" />
              Quick Actions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <Link href="/admin/config">
                <Button variant="outline" className="w-full h-auto py-4 flex-col gap-2">
                  <Database className="w-5 h-5" />
                  <span className="text-xs">Configure</span>
                </Button>
              </Link>
              <Link href="/call">
                <Button variant="outline" className="w-full h-auto py-4 flex-col gap-2">
                  <Phone className="w-5 h-5" />
                  <span className="text-xs">Test Call</span>
                </Button>
              </Link>
              <Link href="/admin?tab=analytics">
                <Button variant="outline" className="w-full h-auto py-4 flex-col gap-2">
                  <Receipt className="w-5 h-5" />
                  <span className="text-xs">View Reports</span>
                </Button>
              </Link>
              <Link href="/admin?tab=users">
                <Button variant="outline" className="w-full h-auto py-4 flex-col gap-2">
                  <UserCheck className="w-5 h-5" />
                  <span className="text-xs">Add User</span>
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-green-500" />
            Platform Health
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-sm font-medium">API Status</span>
              </div>
              <p className="text-2xl font-bold text-green-500">Online</p>
            </div>
            <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-sm font-medium">Database</span>
              </div>
              <p className="text-2xl font-bold text-green-500">Healthy</p>
            </div>
            <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-sm font-medium">WebSocket</span>
              </div>
              <p className="text-2xl font-bold text-green-500">Active</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ title, value, icon, trend }: { title: string; value: string | number; icon: React.ReactNode; trend?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
            {trend && (
              <p className="text-xs text-green-500 mt-1 flex items-center gap-1">
                <TrendingUp className="w-3 h-3" />
                {trend} this month
              </p>
            )}
          </div>
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CompaniesSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [rejectReason, setRejectReason] = useState("");
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [adjustingId, setAdjustingId] = useState<number | null>(null);
  const [walletAmountRupees, setWalletAmountRupees] = useState("");
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");
  const [showCreateCompany, setShowCreateCompany] = useState(false);
  const [newCompany, setNewCompany] = useState({
    companyName: "",
    industry: "",
    website: "",
    companyEmail: "",
    companyPhone: "",
    plan: "free" as "free" | "pro" | "enterprise",
    adminName: "",
    adminEmail: "",
    adminPhone: "",
    autoApprove: true,
    initialWalletRupees: 100,
  });

  const { data: companiesData, isLoading } = useQuery({
    queryKey: ["/api/admin/companies"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/admin/companies", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load companies");
      return res.json();
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (companyId: number) => {
      const token = getAuthToken();
      const res = await fetch(`/api/admin/companies/${companyId}/approve`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to approve");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/companies"] });
      toast({ title: "Company Approved", description: "Billing workspace activated" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ companyId, reason }: { companyId: number; reason: string }) => {
      const token = getAuthToken();
      const res = await fetch(`/api/admin/companies/${companyId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) throw new Error("Failed to reject");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/companies"] });
      setRejectingId(null);
      setRejectReason("");
      toast({ title: "Company Rejected" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const adjustWalletMutation = useMutation({
    mutationFn: async ({ companyId, amount, reason }: { companyId: number; amount: number; reason: string }) => {
      const token = getAuthToken();
      const res = await fetch(`/api/admin/companies/${companyId}/credits`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ amount, reason }),
      });
      if (!res.ok) throw new Error("Failed to adjust wallet balance");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/companies"] });
      setAdjustingId(null);
      setWalletAmountRupees("");
      toast({ title: "Wallet Updated" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const createCompanyMutation = useMutation({
    mutationFn: async () => {
      const token = getAuthToken();
      const payload: Record<string, any> = {
        companyName: newCompany.companyName,
        adminName: newCompany.adminName,
        plan: newCompany.plan,
        autoApprove: newCompany.autoApprove,
        initialWalletRupees: newCompany.initialWalletRupees,
      };
      if (newCompany.industry) payload.industry = newCompany.industry;
      if (newCompany.website) payload.website = newCompany.website;
      if (newCompany.companyEmail) payload.companyEmail = newCompany.companyEmail;
      if (newCompany.companyPhone) payload.companyPhone = newCompany.companyPhone;
      if (newCompany.adminEmail) payload.adminEmail = newCompany.adminEmail;
      if (newCompany.adminPhone) payload.adminPhone = newCompany.adminPhone;

      const res = await fetch("/api/admin/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to create company");
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setShowCreateCompany(false);
      setNewCompany({
        companyName: "", industry: "", website: "", companyEmail: "", companyPhone: "",
        plan: "free", adminName: "", adminEmail: "", adminPhone: "", autoApprove: true, initialWalletRupees: 100,
      });
      toast({ 
        title: "Company Created", 
        description: `${data.company?.name} created with admin account` 
      });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const companies = companiesData?.companies || [];
  const filteredCompanies = filter === "all" 
    ? companies 
    : companies.filter((c: any) => c.status === filter);

  const pendingCount = companies.filter((c: any) => c.status === "pending").length;
  const approvedCount = companies.filter((c: any) => c.status === "approved").length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="cursor-pointer hover:border-primary/50" onClick={() => setFilter("pending")}>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center">
                <Clock className="w-6 h-6 text-amber-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Pending</p>
                <p className="text-2xl font-bold">{pendingCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:border-primary/50" onClick={() => setFilter("approved")}>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
                <Check className="w-6 h-6 text-green-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Approved</p>
                <p className="text-2xl font-bold">{approvedCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:border-primary/50" onClick={() => setFilter("all")}>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
                <Building2 className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total</p>
                <p className="text-2xl font-bold">{companies.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex gap-2">
          {(["all", "pending", "approved", "rejected"] as const).map((f) => (
            <Button
              key={f}
              variant={filter === f ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(f)}
              data-testid={`filter-${f}`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
              {f === "pending" && pendingCount > 0 && (
                <Badge variant="secondary" className="ml-2">{pendingCount}</Badge>
              )}
            </Button>
          ))}
        </div>
        <Button onClick={() => setShowCreateCompany(true)} data-testid="button-create-company">
          <Plus className="w-4 h-4 mr-2" />
          Create Company
        </Button>
      </div>

      <Dialog open={showCreateCompany} onOpenChange={setShowCreateCompany}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Company</DialogTitle>
            <DialogDescription>
              Create an enterprise/B2B company account with admin user
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-6 py-4">
            <div className="space-y-4">
              <h4 className="font-medium text-sm text-muted-foreground">Company Details</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="text-sm font-medium">Company Name *</label>
                  <Input
                    value={newCompany.companyName}
                    onChange={(e) => setNewCompany({ ...newCompany, companyName: e.target.value })}
                    placeholder="Acme Corporation"
                    data-testid="input-company-name"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Industry</label>
                  <Input
                    value={newCompany.industry}
                    onChange={(e) => setNewCompany({ ...newCompany, industry: e.target.value })}
                    placeholder="Technology"
                    data-testid="input-company-industry"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Website</label>
                  <Input
                    value={newCompany.website}
                    onChange={(e) => setNewCompany({ ...newCompany, website: e.target.value })}
                    placeholder="https://acme.com"
                    data-testid="input-company-website"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Company Email</label>
                  <Input
                    value={newCompany.companyEmail}
                    onChange={(e) => setNewCompany({ ...newCompany, companyEmail: e.target.value })}
                    placeholder="contact@acme.com"
                    data-testid="input-company-email"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Company Phone</label>
                  <Input
                    value={newCompany.companyPhone}
                    onChange={(e) => setNewCompany({ ...newCompany, companyPhone: e.target.value })}
                    placeholder="+91 98765 43210"
                    data-testid="input-company-phone"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Plan</label>
                  <Select 
                    value={newCompany.plan} 
                    onValueChange={(v) => setNewCompany({ ...newCompany, plan: v as any })}
                  >
                    <SelectTrigger data-testid="select-company-plan">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="free">Free</SelectItem>
                      <SelectItem value="pro">Pro</SelectItem>
                      <SelectItem value="enterprise">Enterprise</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium">Initial Wallet (INR)</label>
                  <Input
                    type="number"
                    value={newCompany.initialWalletRupees}
                    onChange={(e) => setNewCompany({ ...newCompany, initialWalletRupees: parseFloat(e.target.value) || 0 })}
                    data-testid="input-initial-wallet"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="font-medium text-sm text-muted-foreground">Company Admin User</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="text-sm font-medium">Admin Name *</label>
                  <Input
                    value={newCompany.adminName}
                    onChange={(e) => setNewCompany({ ...newCompany, adminName: e.target.value })}
                    placeholder="John Doe"
                    data-testid="input-admin-name"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Admin Email</label>
                  <Input
                    value={newCompany.adminEmail}
                    onChange={(e) => setNewCompany({ ...newCompany, adminEmail: e.target.value })}
                    placeholder="john@acme.com"
                    data-testid="input-admin-email"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Admin Phone</label>
                  <Input
                    value={newCompany.adminPhone}
                    onChange={(e) => setNewCompany({ ...newCompany, adminPhone: e.target.value })}
                    placeholder="+91 98765 43210"
                    data-testid="input-admin-phone"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Either email or phone is required. The admin can login using OTP to this credential.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="autoApprove"
                checked={newCompany.autoApprove}
                onChange={(e) => setNewCompany({ ...newCompany, autoApprove: e.target.checked })}
                className="rounded"
              />
              <label htmlFor="autoApprove" className="text-sm">
                Auto-approve company and activate billing immediately
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateCompany(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createCompanyMutation.mutate()}
              disabled={!newCompany.companyName.trim() || !newCompany.adminName.trim() || (!newCompany.adminEmail.trim() && !newCompany.adminPhone.trim()) || createCompanyMutation.isPending}
              data-testid="button-confirm-create-company"
            >
              {createCompanyMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Building2 className="w-4 h-4 mr-2" />
              )}
              Create Company
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle>Companies</CardTitle>
          <CardDescription>
            {filter === "all" ? "All registered companies" : `${filter.charAt(0).toUpperCase() + filter.slice(1)} companies`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {filteredCompanies.length > 0 ? (
            <div className="space-y-3">
              {filteredCompanies.map((company: any) => (
                <div 
                  key={company.id}
                  className="p-4 rounded-lg border bg-card hover:bg-accent/5 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold truncate">{company.name}</h3>
                        <Badge variant={
                          company.status === "approved" ? "default" :
                          company.status === "pending" ? "secondary" : "destructive"
                        }>
                          {company.status}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{company.industry || "No industry"}</p>
                      <div className="flex flex-wrap gap-4 mt-2 text-xs text-muted-foreground">
                        <span>Email: {company.contactEmail || company.email || "Not provided"}</span>
                        {company.account?.walletBalancePaise !== undefined && (
                          <span className="font-medium">
                            Wallet: ₹{((company.account.walletBalancePaise || 0) / 100).toLocaleString()}
                          </span>
                        )}
                        {company.activeSubscription?.planName && <span>Plan: {company.activeSubscription.planName}</span>}
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2 shrink-0">
                      {company.status === "pending" && (
                        <>
                          {rejectingId === company.id ? (
                            <div className="flex items-center gap-2">
                              <Input
                                placeholder="Rejection reason"
                                value={rejectReason}
                                onChange={(e) => setRejectReason(e.target.value)}
                                className="w-40"
                                data-testid={`input-reject-reason-${company.id}`}
                              />
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => rejectMutation.mutate({ companyId: company.id, reason: rejectReason })}
                                disabled={!rejectReason || rejectMutation.isPending}
                              >
                                Confirm
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setRejectingId(null)}>
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                onClick={() => approveMutation.mutate(company.id)}
                                disabled={approveMutation.isPending}
                                data-testid={`button-approve-${company.id}`}
                              >
                                <Check className="w-4 h-4 mr-1" />
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setRejectingId(company.id)}
                                data-testid={`button-reject-${company.id}`}
                              >
                                <X className="w-4 h-4 mr-1" />
                                Reject
                              </Button>
                            </>
                          )}
                        </>
                      )}
                      
                      {company.status === "approved" && (
                        <>
                          {adjustingId === company.id ? (
                            <div className="flex items-center gap-2">
                              <Input
                                type="number"
                                placeholder="+/- wallet INR"
                                value={walletAmountRupees}
                                onChange={(e) => setWalletAmountRupees(e.target.value)}
                                className="w-24"
                              />
                              <Button
                                size="sm"
                                onClick={() => adjustWalletMutation.mutate({
                                  companyId: company.id,
                                  amount: parseFloat(walletAmountRupees),
                                  reason: "Admin wallet adjustment"
                                })}
                                disabled={!walletAmountRupees || adjustWalletMutation.isPending}
                              >
                                Save
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setAdjustingId(null)}>
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setAdjustingId(company.id)}
                            >
                              <CreditCard className="w-4 h-4 mr-1" />
                              Adjust Wallet
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Building2 className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No companies found</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function UsersSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [deletingUser, setDeletingUser] = useState<any>(null);
  const [newUser, setNewUser] = useState({ email: "", phone: "", role: "consumer", username: "" });

  const { data: usersData, isLoading } = useQuery({
    queryKey: ["/api/admin/users", search, roleFilter],
    queryFn: async () => {
      const token = getAuthToken();
      const params = new URLSearchParams();
      if (search) params.append("search", search);
      if (roleFilter !== "all") params.append("role", roleFilter);
      const res = await fetch(`/api/admin/users?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { data: [], pagination: { total: 0 } };
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const createUserMutation = useMutation({
    mutationFn: async (userData: typeof newUser) => {
      const token = getAuthToken();
      const cleanedData: Record<string, any> = { role: userData.role };
      if (userData.email?.trim()) cleanedData.email = userData.email.trim();
      if (userData.phone?.trim()) cleanedData.phone = userData.phone.trim();
      if (userData.username?.trim()) cleanedData.username = userData.username.trim();
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(cleanedData),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to create user");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setShowCreateUser(false);
      setNewUser({ email: "", phone: "", role: "consumer", username: "" });
      toast({ title: "User Created" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const token = getAuthToken();
      const cleanedData: Record<string, any> = {};
      if (data.email?.trim()) cleanedData.email = data.email.trim();
      if (data.phone?.trim()) cleanedData.phone = data.phone.trim();
      if (data.username?.trim()) cleanedData.username = data.username.trim();
      if (data.role) cleanedData.role = data.role;
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(cleanedData),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to update user");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setEditingUser(null);
      toast({ title: "User Updated" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (id: number) => {
      const token = getAuthToken();
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to delete user");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setDeletingUser(null);
      toast({ title: "User Deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const users = usersData?.data || [];
  const total = usersData?.pagination?.total || 0;

  const roleColors: Record<string, string> = {
    super_admin: "destructive",
    company_admin: "default",
    company_manager: "default",
    senior_agent: "default",
    investor: "secondary",
    agent: "outline",
    consumer: "secondary",
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4 justify-between">
        <div className="flex gap-2 flex-1">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search users..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
              data-testid="input-search-users"
            />
          </div>
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-40" data-testid="select-role-filter">
              <SelectValue placeholder="All roles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              <SelectItem value="super_admin">Super Admin</SelectItem>
              <SelectItem value="company_admin">Company Admin</SelectItem>
              <SelectItem value="company_manager">Company Manager</SelectItem>
              <SelectItem value="senior_agent">Senior Agent</SelectItem>
              <SelectItem value="agent">Agent</SelectItem>
              <SelectItem value="investor">Investor</SelectItem>
              <SelectItem value="consumer">Consumer</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Dialog open={showCreateUser} onOpenChange={setShowCreateUser}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-user">
              <Plus className="w-4 h-4 mr-2" />
              Add User
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New User</DialogTitle>
              <DialogDescription>Add a new user to the platform</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  placeholder="user@example.com"
                  data-testid="input-new-email"
                />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input
                  value={newUser.phone}
                  onChange={(e) => setNewUser({ ...newUser, phone: e.target.value })}
                  placeholder="+91XXXXXXXXXX"
                  data-testid="input-new-phone"
                />
              </div>
              <div className="space-y-2">
                <Label>Username</Label>
                <Input
                  value={newUser.username}
                  onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                  placeholder="username"
                  data-testid="input-new-username"
                />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={newUser.role} onValueChange={(v) => setNewUser({ ...newUser, role: v })}>
                  <SelectTrigger data-testid="select-new-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="consumer">Consumer</SelectItem>
                    <SelectItem value="agent">Agent</SelectItem>
                    <SelectItem value="senior_agent">Senior Agent</SelectItem>
                    <SelectItem value="company_manager">Company Manager</SelectItem>
                    <SelectItem value="company_admin">Company Admin</SelectItem>
                    <SelectItem value="investor">Investor</SelectItem>
                    <SelectItem value="super_admin">Super Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreateUser(false)}>Cancel</Button>
              <Button 
                onClick={() => createUserMutation.mutate(newUser)}
                disabled={(!newUser.email && !newUser.phone) || createUserMutation.isPending}
                data-testid="button-confirm-create"
              >
                {createUserMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                Create User
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>Platform Users</CardTitle>
            <CardDescription>{total} total users</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] })}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : users.length > 0 ? (
            <div className="space-y-2">
              {users.map((user: any) => (
                <div key={user.id} className="flex items-center justify-between p-4 rounded-lg border hover:bg-accent/5">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <Users className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">{user.email || user.phone || `User #${user.id}`}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{user.username || "No username"}</span>
                        <span>ID: {user.id}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={roleColors[user.role] as any || "secondary"}>
                      {user.role}
                    </Badge>
                    <div className="flex gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setEditingUser(user)}
                        data-testid={`button-edit-${user.id}`}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setDeletingUser(user)}
                        disabled={user.role === "super_admin"}
                        data-testid={`button-delete-${user.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No users found</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editingUser} onOpenChange={() => setEditingUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>Update user details and role</DialogDescription>
          </DialogHeader>
          {editingUser && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={editingUser.email || ""}
                  onChange={(e) => setEditingUser({ ...editingUser, email: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input
                  value={editingUser.phone || ""}
                  onChange={(e) => setEditingUser({ ...editingUser, phone: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Username</Label>
                <Input
                  value={editingUser.username || ""}
                  onChange={(e) => setEditingUser({ ...editingUser, username: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={editingUser.role} onValueChange={(v) => setEditingUser({ ...editingUser, role: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="consumer">Consumer</SelectItem>
                    <SelectItem value="agent">Agent</SelectItem>
                    <SelectItem value="senior_agent">Senior Agent</SelectItem>
                    <SelectItem value="company_manager">Company Manager</SelectItem>
                    <SelectItem value="company_admin">Company Admin</SelectItem>
                    <SelectItem value="investor">Investor</SelectItem>
                    <SelectItem value="super_admin">Super Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingUser(null)}>Cancel</Button>
            <Button 
              onClick={() => updateUserMutation.mutate({ 
                id: editingUser.id, 
                data: { 
                  email: editingUser.email, 
                  phone: editingUser.phone, 
                  username: editingUser.username, 
                  role: editingUser.role 
                } 
              })}
              disabled={updateUserMutation.isPending}
            >
              {updateUserMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deletingUser} onOpenChange={() => setDeletingUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete User</DialogTitle>
            <DialogDescription>Are you sure you want to delete this user? This action cannot be undone.</DialogDescription>
          </DialogHeader>
          {deletingUser && (
            <div className="py-4">
              <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20">
                <p className="font-medium">{deletingUser.email || deletingUser.phone}</p>
                <p className="text-sm text-muted-foreground">Role: {deletingUser.role}</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingUser(null)}>Cancel</Button>
            <Button 
              variant="destructive"
              onClick={() => deleteUserMutation.mutate(deletingUser.id)}
              disabled={deleteUserMutation.isPending}
            >
              {deleteUserMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Delete User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const EMPTY_PLAN = {
  name: "",
  planCode: "",
  description: "",
  planType: "b2c" as "b2b" | "b2c",
  billingModel: "prepaid" as "prepaid" | "postpaid" | "hybrid",
  duration: "monthly",
  durationDays: 30,
  includedMinutes: 100,
  priceInPaise: 9900,
  gstPercentage: 18,
  perSecondBilling: true,
  rates: {
    voicePerMinutePaise: 120,
    videoPerMinutePaise: 180,
    translationPerMinutePaise: 60,
    recordingPerMinutePaise: 30,
  },
  freeUnits: {
    minutes: 100,
    credits: 0,
  },
  limits: {
    maxConcurrentCalls: 5,
    dailyUsageLimit: 0,
  },
  featuresEnabled: ["voice", "video", "translation", "recording"],
  isDefault: false,
  isEnabled: true,
  isFeatured: false,
};

function BillingSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showGlobalDefaults, setShowGlobalDefaults] = useState(false);
  const [editingPlan, setEditingPlan] = useState<any>(null);
  const [viewingPlan, setViewingPlan] = useState<any>(null);
  const [deletingPlan, setDeletingPlan] = useState<any>(null);
  const [editingCompany, setEditingCompany] = useState<any>(null);
  const [adjustingCompany, setAdjustingCompany] = useState<any>(null);
  const [formData, setFormData] = useState({ ...EMPTY_PLAN });
  const [globalDefaults, setGlobalDefaults] = useState({
    billingType: "prepaid",
    perSecondBilling: true,
    rates: {
      voicePerMinutePaise: 120,
      videoPerMinutePaise: 180,
      translationPerMinutePaise: 60,
      recordingPerMinutePaise: 30,
    },
    freeUnits: {
      minutes: 0,
      credits: 0,
    },
    limits: {
      maxConcurrentCalls: 0,
      dailyUsageLimit: 0,
    },
    featuresEnabled: ["voice", "video", "translation", "recording"],
  });
  const [companyForm, setCompanyForm] = useState({
    assignedPlanId: "",
    billingType: "prepaid",
    creditLimitPaise: 0,
    maxConcurrentCalls: 0,
    dailyUsageLimitSeconds: 0,
  });
  const [adjustmentForm, setAdjustmentForm] = useState({
    amountPaise: 100000,
    type: "wallet_credit",
    description: "",
  });

  const { data: plans, isLoading } = useQuery({
    queryKey: ["/api/admin/billing/plans"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/admin/billing/plans", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      return (await res.json()).data || [];
    },
  });

  const { data: billingOverview } = useQuery({
    queryKey: ["/api/admin/billing/overview"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/admin/billing/overview", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      return (await res.json()).data;
    },
  });

  const { data: companyBillingData } = useQuery({
    queryKey: ["/api/admin/billing/companies"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/admin/billing/companies", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      return (await res.json()).data || [];
    },
  });

  useQuery({
    queryKey: ["/api/admin/billing/default-pricing"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/admin/billing/default-pricing", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      const data = (await res.json()).data;
      if (data) {
        setGlobalDefaults((prev) => ({
          ...prev,
          ...data,
          rates: { ...prev.rates, ...(data.rates || {}) },
          freeUnits: { ...prev.freeUnits, ...(data.freeUnits || {}) },
          limits: { ...prev.limits, ...(data.limits || {}) },
          featuresEnabled: Array.isArray(data.featuresEnabled) ? data.featuresEnabled : prev.featuresEnabled,
        }));
      }
      return data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (plan: typeof formData) => {
      const token = getAuthToken();
      const res = await fetch("/api/admin/billing/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(plan),
      });
      if (!res.ok) throw new Error("Failed to create plan");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/billing/plans"] });
      setShowCreate(false);
      setFormData({ ...EMPTY_PLAN });
      toast({ title: "✅ Plan created successfully" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const token = getAuthToken();
      const res = await fetch(`/api/admin/billing/plans/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update plan");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/billing/plans"] });
      setEditingPlan(null);
      toast({ title: "✅ Plan updated successfully" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const token = getAuthToken();
      const res = await fetch(`/api/admin/billing/plans/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to delete plan");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/billing/plans"] });
      setDeletingPlan(null);
      toast({ title: "🗑️ Plan deleted" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateDefaultsMutation = useMutation({
    mutationFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/admin/billing/default-pricing", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(globalDefaults),
      });
      if (!res.ok) throw new Error("Failed to save global defaults");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/billing/default-pricing"] });
      setShowGlobalDefaults(false);
      toast({ title: "Billing defaults updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateCompanyMutation = useMutation({
    mutationFn: async () => {
      const token = getAuthToken();
      const res = await fetch(`/api/admin/billing/companies/${editingCompany.id}/account`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          assignedPlanId: companyForm.assignedPlanId ? parseInt(companyForm.assignedPlanId) : null,
          billingType: companyForm.billingType,
          creditLimitPaise: companyForm.creditLimitPaise,
          maxConcurrentCalls: companyForm.maxConcurrentCalls,
          dailyUsageLimitSeconds: companyForm.dailyUsageLimitSeconds,
        }),
      });
      if (!res.ok) throw new Error("Failed to update company billing account");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/billing/companies"] });
      setEditingCompany(null);
      toast({ title: "Company billing updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const adjustmentMutation = useMutation({
    mutationFn: async () => {
      const token = getAuthToken();
      const res = await fetch(`/api/admin/billing/companies/${adjustingCompany.id}/adjustments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(adjustmentForm),
      });
      if (!res.ok) throw new Error("Failed to adjust company balance");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/billing/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/billing/overview"] });
      setAdjustingCompany(null);
      toast({ title: "Company balance adjusted" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const blockMutation = useMutation({
    mutationFn: async ({ company, blocked }: { company: any; blocked: boolean }) => {
      const token = getAuthToken();
      const res = await fetch(`/api/admin/billing/companies/${company.id}/block`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          blocked,
          reason: blocked ? "Blocked by super admin from billing panel" : undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed to update company block status");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/billing/companies"] });
      toast({ title: "Company billing status updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const PlanForm = ({ onSubmit, isPending }: { onSubmit: () => void; isPending: boolean }) => (
    <div className="space-y-4 py-2">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2 grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Plan Name *</Label>
            <Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="e.g., Monthly Pro" />
          </div>
          <div className="space-y-2">
            <Label>Plan Code</Label>
            <Input value={formData.planCode} onChange={(e) => setFormData({ ...formData, planCode: e.target.value })} placeholder="e.g., b2b_premium_2026" />
          </div>
        </div>
        <div className="col-span-2 space-y-2">
          <Label>Description</Label>
          <Textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} rows={2} />
        </div>
        <div className="space-y-2">
          <Label>Type</Label>
          <Select value={formData.planType} onValueChange={(v) => setFormData({ ...formData, planType: v as "b2b" | "b2c" })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="b2c">Consumer (B2C)</SelectItem>
              <SelectItem value="b2b">Business (B2B)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Billing Type</Label>
          <Select value={formData.billingModel} onValueChange={(v) => setFormData({ ...formData, billingModel: v as "prepaid" | "postpaid" | "hybrid" })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="prepaid">Prepaid</SelectItem>
              <SelectItem value="postpaid">Postpaid</SelectItem>
              <SelectItem value="hybrid">Hybrid</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Duration</Label>
          <Select value={formData.duration} onValueChange={(v) => setFormData({ ...formData, duration: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="quarterly">Quarterly</SelectItem>
              <SelectItem value="yearly">Yearly</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Price (₹)</Label>
          <Input type="number" value={formData.priceInPaise / 100} onChange={(e) => setFormData({ ...formData, priceInPaise: Math.round(parseFloat(e.target.value || "0") * 100) })} placeholder="0 for free" />
        </div>
        <div className="space-y-2">
          <Label>Included Minutes</Label>
          <Input type="number" value={formData.includedMinutes} onChange={(e) => setFormData({ ...formData, includedMinutes: parseInt(e.target.value || "0") })} />
        </div>
        <div className="space-y-2">
          <Label>Duration (days)</Label>
          <Input type="number" value={formData.durationDays} onChange={(e) => setFormData({ ...formData, durationDays: parseInt(e.target.value || "0") })} />
        </div>
        <div className="space-y-2">
          <Label>GST %</Label>
          <Input type="number" value={formData.gstPercentage} onChange={(e) => setFormData({ ...formData, gstPercentage: parseInt(e.target.value || "0") })} />
        </div>
        <div className="space-y-2">
          <Label>Voice / min (paise)</Label>
          <Input
            type="number"
            value={formData.rates.voicePerMinutePaise}
            onChange={(e) => setFormData({ ...formData, rates: { ...formData.rates, voicePerMinutePaise: parseInt(e.target.value || "0") } })}
          />
        </div>
        <div className="space-y-2">
          <Label>Video / min (paise)</Label>
          <Input
            type="number"
            value={formData.rates.videoPerMinutePaise}
            onChange={(e) => setFormData({ ...formData, rates: { ...formData.rates, videoPerMinutePaise: parseInt(e.target.value || "0") } })}
          />
        </div>
        <div className="space-y-2">
          <Label>Translation / min (paise)</Label>
          <Input
            type="number"
            value={formData.rates.translationPerMinutePaise}
            onChange={(e) => setFormData({ ...formData, rates: { ...formData.rates, translationPerMinutePaise: parseInt(e.target.value || "0") } })}
          />
        </div>
        <div className="space-y-2">
          <Label>Recording / min (paise)</Label>
          <Input
            type="number"
            value={formData.rates.recordingPerMinutePaise}
            onChange={(e) => setFormData({ ...formData, rates: { ...formData.rates, recordingPerMinutePaise: parseInt(e.target.value || "0") } })}
          />
        </div>
        <div className="space-y-2">
          <Label>Free Minutes</Label>
          <Input
            type="number"
            value={formData.freeUnits.minutes}
            onChange={(e) => setFormData({ ...formData, freeUnits: { ...formData.freeUnits, minutes: parseInt(e.target.value || "0") } })}
          />
        </div>
        <div className="space-y-2">
          <Label>Free Credits</Label>
          <Input
            type="number"
            value={formData.freeUnits.credits}
            onChange={(e) => setFormData({ ...formData, freeUnits: { ...formData.freeUnits, credits: parseInt(e.target.value || "0") } })}
          />
        </div>
        <div className="space-y-2">
          <Label>Max Concurrent Calls</Label>
          <Input
            type="number"
            value={formData.limits.maxConcurrentCalls}
            onChange={(e) => setFormData({ ...formData, limits: { ...formData.limits, maxConcurrentCalls: parseInt(e.target.value || "0") } })}
          />
        </div>
        <div className="space-y-2">
          <Label>Daily Usage Limit (sec)</Label>
          <Input
            type="number"
            value={formData.limits.dailyUsageLimit}
            onChange={(e) => setFormData({ ...formData, limits: { ...formData.limits, dailyUsageLimit: parseInt(e.target.value || "0") } })}
          />
        </div>
        <div className="col-span-2 space-y-2">
          <Label>Enabled Features</Label>
          <Input
            value={formData.featuresEnabled.join(", ")}
            onChange={(e) => setFormData({ ...formData, featuresEnabled: e.target.value.split(",").map((item) => item.trim()).filter(Boolean) })}
            placeholder="voice, video, translation, recording"
          />
        </div>
        <div className="flex items-center gap-3 pt-2">
          <Switch checked={formData.perSecondBilling} onCheckedChange={(v) => setFormData({ ...formData, perSecondBilling: v })} />
          <Label>Per-second billing</Label>
        </div>
        <div className="flex items-center gap-3 pt-2">
          <Switch checked={formData.isDefault} onCheckedChange={(v) => setFormData({ ...formData, isDefault: v })} />
          <Label>Global default plan</Label>
        </div>
        <div className="flex items-center gap-3 pt-2">
          <Switch checked={formData.isEnabled} onCheckedChange={(v) => setFormData({ ...formData, isEnabled: v })} />
          <Label>Active</Label>
        </div>
        <div className="flex items-center gap-3 pt-2">
          <Switch checked={formData.isFeatured} onCheckedChange={(v) => setFormData({ ...formData, isFeatured: v })} />
          <Label>Featured (Recommended)</Label>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => { setShowCreate(false); setEditingPlan(null); }}>Cancel</Button>
        <Button onClick={onSubmit} disabled={!formData.name || isPending}>
          {isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
          Save Plan
        </Button>
      </DialogFooter>
    </div>
  );

  if (isLoading) return <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  const b2cPlans = Array.isArray(plans) ? plans.filter((p: any) => p.planType === "b2c") : [];
  const b2bPlans = Array.isArray(plans) ? plans.filter((p: any) => p.planType === "b2b") : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Revenue Model</h2>
          <p className="text-sm text-muted-foreground">Strict per-second tenant billing with prepaid, postpaid, and hybrid controls</p>
          <p className="text-sm text-muted-foreground">Manage B2B & B2C subscription plans — 15 min free trial on registration</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={showGlobalDefaults} onOpenChange={setShowGlobalDefaults}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Cog className="w-4 h-4 mr-2" />
                Global Defaults
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>Global Billing Defaults</DialogTitle>
                <DialogDescription>Fallback defaults used when a plan does not define a stricter override.</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4 py-2">
                <div className="space-y-2">
                  <Label>Billing Type</Label>
                  <Select value={globalDefaults.billingType} onValueChange={(v) => setGlobalDefaults((prev) => ({ ...prev, billingType: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="prepaid">Prepaid</SelectItem>
                      <SelectItem value="postpaid">Postpaid</SelectItem>
                      <SelectItem value="hybrid">Hybrid</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-3 pt-8">
                  <Switch checked={globalDefaults.perSecondBilling} onCheckedChange={(v) => setGlobalDefaults((prev) => ({ ...prev, perSecondBilling: v }))} />
                  <Label>Per-second billing</Label>
                </div>
                <div className="space-y-2">
                  <Label>Voice / min (paise)</Label>
                  <Input type="number" value={globalDefaults.rates.voicePerMinutePaise} onChange={(e) => setGlobalDefaults((prev) => ({ ...prev, rates: { ...prev.rates, voicePerMinutePaise: parseInt(e.target.value || "0") } }))} />
                </div>
                <div className="space-y-2">
                  <Label>Video / min (paise)</Label>
                  <Input type="number" value={globalDefaults.rates.videoPerMinutePaise} onChange={(e) => setGlobalDefaults((prev) => ({ ...prev, rates: { ...prev.rates, videoPerMinutePaise: parseInt(e.target.value || "0") } }))} />
                </div>
                <div className="space-y-2">
                  <Label>Translation / min (paise)</Label>
                  <Input type="number" value={globalDefaults.rates.translationPerMinutePaise} onChange={(e) => setGlobalDefaults((prev) => ({ ...prev, rates: { ...prev.rates, translationPerMinutePaise: parseInt(e.target.value || "0") } }))} />
                </div>
                <div className="space-y-2">
                  <Label>Recording / min (paise)</Label>
                  <Input type="number" value={globalDefaults.rates.recordingPerMinutePaise} onChange={(e) => setGlobalDefaults((prev) => ({ ...prev, rates: { ...prev.rates, recordingPerMinutePaise: parseInt(e.target.value || "0") } }))} />
                </div>
                <div className="space-y-2">
                  <Label>Max Concurrent Calls</Label>
                  <Input type="number" value={globalDefaults.limits.maxConcurrentCalls} onChange={(e) => setGlobalDefaults((prev) => ({ ...prev, limits: { ...prev.limits, maxConcurrentCalls: parseInt(e.target.value || "0") } }))} />
                </div>
                <div className="space-y-2">
                  <Label>Daily Usage Limit (sec)</Label>
                  <Input type="number" value={globalDefaults.limits.dailyUsageLimit} onChange={(e) => setGlobalDefaults((prev) => ({ ...prev, limits: { ...prev.limits, dailyUsageLimit: parseInt(e.target.value || "0") } }))} />
                </div>
                <div className="col-span-2 space-y-2">
                  <Label>Enabled Features</Label>
                  <Input value={globalDefaults.featuresEnabled.join(", ")} onChange={(e) => setGlobalDefaults((prev) => ({ ...prev, featuresEnabled: e.target.value.split(",").map((item) => item.trim()).filter(Boolean) }))} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowGlobalDefaults(false)}>Cancel</Button>
                <Button onClick={() => updateDefaultsMutation.mutate()} disabled={updateDefaultsMutation.isPending}>
                  {updateDefaultsMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                  Save Defaults
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={showCreate} onOpenChange={(o) => { setShowCreate(o); if (!o) setFormData({ ...EMPTY_PLAN }); }}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-plan"><Plus className="w-4 h-4 mr-2" />New Plan</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Create Revenue Plan</DialogTitle></DialogHeader>
            <PlanForm onSubmit={() => createMutation.mutate(formData)} isPending={createMutation.isPending} />
          </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Revenue Model Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card className="glass-card border-primary/20">
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground">Free Trial</p>
            <p className="text-2xl font-bold text-primary">15 min</p>
            <p className="text-xs text-muted-foreground">Every new user</p>
          </CardContent>
        </Card>
        <Card className="glass-card border-secondary/20">
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground">B2C Plans</p>
            <p className="text-2xl font-bold text-secondary">{b2cPlans.length}</p>
            <p className="text-xs text-muted-foreground">Consumer plans</p>
          </CardContent>
        </Card>
        <Card className="glass-card border-primary/20">
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground">B2B Plans</p>
            <p className="text-2xl font-bold text-primary">{b2bPlans.length}</p>
            <p className="text-xs text-muted-foreground">Business plans</p>
          </CardContent>
        </Card>
        <Card className="glass-card border-secondary/20">
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground">Active Calls</p>
            <p className="text-2xl font-bold text-secondary">{billingOverview?.activeCalls || 0}</p>
            <p className="text-xs text-muted-foreground">Currently billing</p>
          </CardContent>
        </Card>
        <Card className="glass-card border-primary/20">
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground">Revenue</p>
            <p className="text-2xl font-bold text-primary">₹{((billingOverview?.totalRevenuePaise || 0) / 100).toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">Strict billed usage</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Building2 className="w-4 h-4" />Tenant Billing Accounts</CardTitle>
          <CardDescription>Assign plans, control wallets, set credit limits, and block companies without touching code.</CardDescription>
        </CardHeader>
        <CardContent>
          {Array.isArray(companyBillingData) && companyBillingData.length > 0 ? (
            <div className="space-y-3">
              {companyBillingData.map((company: any) => (
                <div key={company.id} className="rounded-lg border p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="font-semibold">{company.name}</p>
                      <p className="text-xs text-muted-foreground">{company.email || "No billing email"} • {company.assignedPlan?.name || "No plan assigned"}</p>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">Wallet</p>
                        <p className="font-medium">₹{((company.account?.walletBalancePaise || 0) / 100).toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Locked</p>
                        <p className="font-medium">₹{((company.account?.lockedBalancePaise || 0) / 100).toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Outstanding</p>
                        <p className="font-medium">₹{((company.account?.outstandingPostpaidPaise || 0) / 100).toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Calls</p>
                        <p className="font-medium">{company.activeCallCount || 0}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Mode</p>
                        <p className="font-medium capitalize">{company.account?.billingType || "prepaid"}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => {
                        setEditingCompany(company);
                        setCompanyForm({
                          assignedPlanId: company.account?.assignedPlanId ? String(company.account.assignedPlanId) : "",
                          billingType: company.account?.billingType || "prepaid",
                          creditLimitPaise: company.account?.creditLimitPaise || 0,
                          maxConcurrentCalls: company.account?.maxConcurrentCalls || 0,
                          dailyUsageLimitSeconds: company.account?.dailyUsageLimitSeconds || 0,
                        });
                      }}>Configure</Button>
                      <Button variant="outline" size="sm" onClick={() => {
                        setAdjustingCompany(company);
                        setAdjustmentForm({ amountPaise: 100000, type: "wallet_credit", description: `Manual wallet credit for ${company.name}` });
                      }}>Adjust</Button>
                      <Button size="sm" variant={company.account?.isBlocked ? "secondary" : "destructive"} onClick={() => blockMutation.mutate({ company, blocked: !company.account?.isBlocked })}>
                        {company.account?.isBlocked ? "Unblock" : "Block"}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No tenant billing accounts found yet.</p>
          )}
        </CardContent>
      </Card>

      {/* B2C Plans */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Users className="w-4 h-4" />Consumer Plans (B2C)</CardTitle>
          <CardDescription>Individual users — auto 15 min free trial on signup</CardDescription>
        </CardHeader>
        <CardContent>
          {b2cPlans.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {b2cPlans.map((plan: any) => (
                <PlanCard key={plan.id} plan={plan}
                  onEdit={() => { setFormData({ ...EMPTY_PLAN, ...plan, planCode: plan.planCode || "", rates: { ...EMPTY_PLAN.rates, ...(plan.rates || {}) }, freeUnits: { ...EMPTY_PLAN.freeUnits, ...(plan.freeUnits || {}) }, limits: { ...EMPTY_PLAN.limits, ...(plan.limits || {}) }, featuresEnabled: Array.isArray(plan.featuresEnabled) ? plan.featuresEnabled : EMPTY_PLAN.featuresEnabled }); setEditingPlan(plan); }}
                  onDelete={() => setDeletingPlan(plan)}
                  onView={() => setViewingPlan(plan)}
                  onToggle={() => updateMutation.mutate({ id: plan.id, data: { isEnabled: !plan.isEnabled } })}
                />
              ))}
            </div>
          ) : <p className="text-center py-6 text-muted-foreground">No B2C plans — create one above</p>}
        </CardContent>
      </Card>

      {/* B2B Plans */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Building2 className="w-4 h-4" />Business Plans (B2B)</CardTitle>
          <CardDescription>Companies & enterprises — per organization billing</CardDescription>
        </CardHeader>
        <CardContent>
          {b2bPlans.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {b2bPlans.map((plan: any) => (
                <PlanCard key={plan.id} plan={plan}
                  onEdit={() => { setFormData({ ...EMPTY_PLAN, ...plan, planCode: plan.planCode || "", rates: { ...EMPTY_PLAN.rates, ...(plan.rates || {}) }, freeUnits: { ...EMPTY_PLAN.freeUnits, ...(plan.freeUnits || {}) }, limits: { ...EMPTY_PLAN.limits, ...(plan.limits || {}) }, featuresEnabled: Array.isArray(plan.featuresEnabled) ? plan.featuresEnabled : EMPTY_PLAN.featuresEnabled }); setEditingPlan(plan); }}
                  onDelete={() => setDeletingPlan(plan)}
                  onView={() => setViewingPlan(plan)}
                  onToggle={() => updateMutation.mutate({ id: plan.id, data: { isEnabled: !plan.isEnabled } })}
                />
              ))}
            </div>
          ) : <p className="text-center py-6 text-muted-foreground">No B2B plans — create one above</p>}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={!!editingPlan} onOpenChange={(o) => !o && setEditingPlan(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Plan — {editingPlan?.name}</DialogTitle></DialogHeader>
          <PlanForm onSubmit={() => updateMutation.mutate({ id: editingPlan.id, data: formData })} isPending={updateMutation.isPending} />
        </DialogContent>
      </Dialog>

      {/* View Dialog */}
      <Dialog open={!!viewingPlan} onOpenChange={(o) => !o && setViewingPlan(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Plan Details — {viewingPlan?.name}</DialogTitle></DialogHeader>
          {viewingPlan && (
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  ["Type", viewingPlan.planType?.toUpperCase()],
                  ["Billing", viewingPlan.billingModel?.toUpperCase()],
                  ["Duration", `${viewingPlan.durationDays} days`],
                  ["Price", viewingPlan.priceInPaise === 0 ? "Free" : `₹${(viewingPlan.priceInPaise / 100).toFixed(0)}`],
                  ["Minutes", `${viewingPlan.includedMinutes} min`],
                  ["Voice Rate", `${viewingPlan.rates?.voicePerMinutePaise || 0} paise/min`],
                  ["Video Rate", `${viewingPlan.rates?.videoPerMinutePaise || 0} paise/min`],
                  ["Translation", `${viewingPlan.rates?.translationPerMinutePaise || 0} paise/min`],
                  ["GST", `${viewingPlan.gstPercentage}%`],
                  ["Status", viewingPlan.isEnabled ? "Active" : "Disabled"],
                  ["Featured", viewingPlan.isFeatured ? "Yes" : "No"],
                  ["Plan ID", `#${viewingPlan.id}`],
                ].map(([label, value]) => (
                  <div key={label} className="p-3 rounded-lg bg-muted/30">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="font-medium mt-0.5">{value}</p>
                  </div>
                ))}
              </div>
              {viewingPlan.description && (
                <div className="p-3 rounded-lg bg-muted/30">
                  <p className="text-xs text-muted-foreground">Description</p>
                  <p className="text-sm mt-0.5">{viewingPlan.description}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={!!deletingPlan} onOpenChange={(o) => !o && setDeletingPlan(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-400"><AlertTriangle className="w-5 h-5" />Delete Plan</DialogTitle>
            <DialogDescription>Are you sure you want to delete <strong>{deletingPlan?.name}</strong>? Active subscribers won't be affected but no new subscriptions will be possible.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingPlan(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteMutation.mutate(deletingPlan.id)} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Delete Plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingCompany} onOpenChange={(o) => !o && setEditingCompany(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Configure Tenant Billing</DialogTitle>
            <DialogDescription>{editingCompany?.name}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2 space-y-2">
              <Label>Assigned Plan</Label>
              <Select value={companyForm.assignedPlanId} onValueChange={(value) => setCompanyForm((prev) => ({ ...prev, assignedPlanId: value }))}>
                <SelectTrigger><SelectValue placeholder="Select plan" /></SelectTrigger>
                <SelectContent>
                  {Array.isArray(plans) && plans.map((plan: any) => (
                    <SelectItem key={plan.id} value={String(plan.id)}>{plan.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Billing Type</Label>
              <Select value={companyForm.billingType} onValueChange={(value) => setCompanyForm((prev) => ({ ...prev, billingType: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="prepaid">Prepaid</SelectItem>
                  <SelectItem value="postpaid">Postpaid</SelectItem>
                  <SelectItem value="hybrid">Hybrid</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Credit Limit (paise)</Label>
              <Input type="number" value={companyForm.creditLimitPaise} onChange={(e) => setCompanyForm((prev) => ({ ...prev, creditLimitPaise: parseInt(e.target.value || "0") }))} />
            </div>
            <div className="space-y-2">
              <Label>Max Concurrent Calls</Label>
              <Input type="number" value={companyForm.maxConcurrentCalls} onChange={(e) => setCompanyForm((prev) => ({ ...prev, maxConcurrentCalls: parseInt(e.target.value || "0") }))} />
            </div>
            <div className="space-y-2">
              <Label>Daily Usage Limit (sec)</Label>
              <Input type="number" value={companyForm.dailyUsageLimitSeconds} onChange={(e) => setCompanyForm((prev) => ({ ...prev, dailyUsageLimitSeconds: parseInt(e.target.value || "0") }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingCompany(null)}>Cancel</Button>
            <Button onClick={() => updateCompanyMutation.mutate()} disabled={updateCompanyMutation.isPending}>
              {updateCompanyMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Save Tenant
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!adjustingCompany} onOpenChange={(o) => !o && setAdjustingCompany(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Adjust Wallet Balance</DialogTitle>
            <DialogDescription>{adjustingCompany?.name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Adjustment Type</Label>
              <Select value={adjustmentForm.type} onValueChange={(value) => setAdjustmentForm((prev) => ({ ...prev, type: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="wallet_credit">Wallet Credit</SelectItem>
                  <SelectItem value="wallet_debit">Wallet Debit</SelectItem>
                  <SelectItem value="credit_limit_settlement">Postpaid Settlement</SelectItem>
                  <SelectItem value="manual_adjustment">Manual Adjustment</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Amount (paise)</Label>
              <Input type="number" value={adjustmentForm.amountPaise} onChange={(e) => setAdjustmentForm((prev) => ({ ...prev, amountPaise: parseInt(e.target.value || "0") }))} />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={adjustmentForm.description} onChange={(e) => setAdjustmentForm((prev) => ({ ...prev, description: e.target.value }))} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustingCompany(null)}>Cancel</Button>
            <Button onClick={() => adjustmentMutation.mutate()} disabled={adjustmentMutation.isPending}>
              {adjustmentMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Apply Adjustment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PlanCard({ plan, onEdit, onDelete, onView, onToggle }: { plan: any; onEdit: () => void; onDelete: () => void; onView: () => void; onToggle: () => void }) {
  const isFree = plan.priceInPaise === 0;
  return (
    <div className={`p-4 rounded-lg border bg-card relative ${plan.isFeatured ? "border-primary/50 ring-1 ring-primary/20" : ""}`}>
      {plan.isFeatured && <span className="absolute -top-2 left-3 text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full">Recommended</span>}
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-sm">{plan.name}</h3>
          <p className="text-xs text-muted-foreground capitalize">{plan.billingModel || "prepaid"}</p>
          <p className="text-xs text-muted-foreground capitalize">{plan.planType} · {plan.duration}</p>
        </div>
        <Badge variant={plan.isEnabled ? "default" : "secondary"} className="text-xs">
          {plan.isEnabled ? "Active" : "Off"}
        </Badge>
      </div>
      <div className="space-y-1.5 text-sm mb-4">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Price</span>
          <span className="font-semibold text-primary">{isFree ? "Free" : `₹${(plan.priceInPaise / 100).toFixed(0)}`}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Minutes</span>
          <span className="font-medium">{plan.includedMinutes >= 99999 ? "Unlimited" : `${plan.includedMinutes} min`}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Voice Rate</span>
          <span className="font-medium">{plan.rates?.voicePerMinutePaise || 0} paise/min</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Validity</span>
          <span className="font-medium">{plan.durationDays} days</span>
        </div>
        {plan.gstPercentage > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">GST</span>
            <span className="font-medium">{plan.gstPercentage}%</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 pt-2 border-t">
        <Button size="sm" variant="ghost" className="flex-1 h-7 text-xs" onClick={onView}><Eye className="w-3 h-3 mr-1" />View</Button>
        <Button size="sm" variant="ghost" className="flex-1 h-7 text-xs" onClick={onEdit}><Edit className="w-3 h-3 mr-1" />Edit</Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onToggle}>
          {plan.isEnabled ? <XCircle className="w-3 h-3 text-orange-400" /> : <CheckCircle className="w-3 h-3 text-green-400" />}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs text-red-400 hover:text-red-300" onClick={onDelete}><Trash2 className="w-3 h-3" /></Button>
      </div>
    </div>
  );
}

function AnalyticsSection() {
  const { toast } = useToast();
  const { data: analyticsData, isLoading } = useQuery({
    queryKey: ["/api/admin/analytics"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/admin/analytics?days=30", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const { data: languagesData } = useQuery({
    queryKey: ["/api/admin/languages"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/admin/languages", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const data = analyticsData?.data;
  const languageCount = languagesData?.data?.length ?? languagesData?.length ?? null;
  // Brand palette (cyan/purple family) instead of Recharts' default demo colors
  const COLORS = ['#00F0FF', '#BF33FF', '#00B8D9', '#9B5DE5', '#4DD9E8'];

  const usersByRoleData = data?.usersByRole?.map((item: any) => ({
    name: item.role.replace('_', ' ').toUpperCase(),
    value: Number(item.count),
  })) || [];

  const dailyData = data?.dailySignups || [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-3xl font-bold text-primary">₹{(data?.totalRevenue || 0).toLocaleString()}</p>
            <p className="text-sm text-muted-foreground">Total Revenue</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-3xl font-bold text-green-500">{data?.avgCallDuration || 0}m</p>
            <p className="text-sm text-muted-foreground">Avg Call Duration</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-3xl font-bold text-blue-500">{data?.successRate || 0}%</p>
            <p className="text-sm text-muted-foreground">Success Rate</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-3xl font-bold text-purple-500">{languageCount ?? '—'}</p>
            <p className="text-sm text-muted-foreground">Languages</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Daily Activity (Last 30 Days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailyData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis 
                    dataKey="date" 
                    tick={{ fontSize: 10 }} 
                    tickFormatter={(v) => v.slice(5)}
                    className="text-muted-foreground"
                  />
                  <YAxis tick={{ fontSize: 10 }} className="text-muted-foreground" />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))', 
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px'
                    }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="users" 
                    stroke="hsl(var(--primary))" 
                    fill="hsl(var(--primary))" 
                    fillOpacity={0.2}
                    name="New Users"
                  />
                  <Area 
                    type="monotone" 
                    dataKey="calls" 
                    stroke="hsl(142.1 76.2% 36.3%)" 
                    fill="hsl(142.1 76.2% 36.3%)" 
                    fillOpacity={0.2}
                    name="Calls"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="w-4 h-4" />
              Users by Role
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={usersByRoleData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {usersByRoleData.map((_: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="text-base">Export Reports</CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => {
              const csvData = `Report,Date\nUser Activity,${new Date().toISOString()}\nUsers,${analyticsData?.data?.usersByRole?.map((r: any) => r.role + ':' + r.count).join(';') || 'N/A'}\n`;
              const blob = new Blob([csvData], { type: 'text/csv' });
              const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `neuratalk_report_${new Date().toISOString().split('T')[0]}.csv`; a.click();
              toast({ title: "Report exported", description: "CSV file downloaded" });
            }}>
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => {
              window.print();
              toast({ title: "Print dialog opened", description: "Use Save as PDF to export" });
            }}>
              <FileText className="w-4 h-4 mr-2" />
              Export PDF
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">The buttons above export everything currently loaded on this page as one file. Included:</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-lg border">
              <h4 className="font-medium">User Activity</h4>
              <p className="text-sm text-muted-foreground">Signups, logins, engagement metrics</p>
            </div>
            <div className="p-4 rounded-lg border">
              <h4 className="font-medium">Revenue</h4>
              <p className="text-sm text-muted-foreground">Subscriptions, payments, GST</p>
            </div>
            <div className="p-4 rounded-lg border">
              <h4 className="font-medium">Call Analytics</h4>
              <p className="text-sm text-muted-foreground">Duration, quality, languages</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function IntegrationsSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreateKey, setShowCreateKey] = useState(false);
  const [createdKeyValue, setCreatedKeyValue] = useState<string | null>(null);
  const [confirmRevokeId, setConfirmRevokeId] = useState<number | null>(null);
  const [newKeyData, setNewKeyData] = useState({
    organizationId: "",
    name: "",
    dailyQuota: 1000,
    rateLimitPerMinute: 60,
    permissions: [
      "translate",
      "tts",
      "stt",
      "languages",
      "voice-chat",
      "calls:create",
      "calls:end",
      "calls:read",
      "usage:read",
      "billing:read",
      "ws:subscribe",
    ] as string[],
    expiresAt: "",
  });

  const { data: apiKeysData, isLoading: keysLoading } = useQuery({
    queryKey: ["/api/admin/api-keys"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/admin/api-keys", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { keys: [] };
      return res.json();
    },
  });

  const { data: companiesData } = useQuery({
    queryKey: ["/api/admin/companies"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/admin/companies", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { companies: [] };
      return res.json();
    },
  });

  const { data: integrationsData, isLoading: integrationsLoading, refetch } = useQuery({
    queryKey: ["/api/admin/integrations"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/admin/integrations", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { data: [] };
      return res.json();
    },
  });

  const createKeyMutation = useMutation({
    mutationFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/admin/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          organizationId: parseInt(newKeyData.organizationId),
          name: newKeyData.name,
          dailyQuota: newKeyData.dailyQuota,
          rateLimitPerMinute: newKeyData.rateLimitPerMinute,
          permissions: newKeyData.permissions,
          expiresAt: newKeyData.expiresAt || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create API key");
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/api-keys"] });
      setCreatedKeyValue(data.key);
      toast({ title: "API Key Created", description: "Save the key now - it will not be shown again." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const activateMutation = useMutation({
    mutationFn: async (id: number) => {
      const token = getAuthToken();
      const res = await fetch(`/api/admin/api-keys/${id}/activate`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to activate");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/api-keys"] });
      toast({ title: "API Key Activated" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const suspendMutation = useMutation({
    mutationFn: async (id: number) => {
      const token = getAuthToken();
      const res = await fetch(`/api/admin/api-keys/${id}/suspend`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reason: "Suspended by admin" }),
      });
      if (!res.ok) throw new Error("Failed to suspend");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/api-keys"] });
      toast({ title: "API Key Suspended" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: number) => {
      const token = getAuthToken();
      const res = await fetch(`/api/admin/api-keys/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to revoke");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/api-keys"] });
      setConfirmRevokeId(null);
      toast({ title: "API Key Revoked" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const apiKeys = apiKeysData?.keys || [];
  const companies = companiesData?.companies || [];
  const integrations = integrationsData?.data || [];

  const iconMap: Record<string, React.ReactNode> = {
    sparkles: <Sparkles className="w-5 h-5" />,
    "credit-card": <CreditCard className="w-5 h-5" />,
    shield: <Shield className="w-5 h-5" />,
    radio: <Radio className="w-5 h-5" />,
    database: <Database className="w-5 h-5" />,
    phone: <Phone className="w-5 h-5" />,
    languages: <Languages className="w-5 h-5" />,
    "monitor-check": <MonitorCheck className="w-5 h-5" />,
    headphones: <Headphones className="w-5 h-5" />,
    video: <Video className="w-5 h-5" />,
  };

  const allPermissions = [
    "translate",
    "tts",
    "stt",
    "languages",
    "voice-chat",
    "calls:create",
    "calls:end",
    "calls:read",
    "usage:read",
    "billing:read",
    "ws:subscribe",
    "masking:manage",
    "recording:control",
  ];

  const togglePermission = (perm: string) => {
    setNewKeyData((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(perm)
        ? prev.permissions.filter((p) => p !== perm)
        : [...prev.permissions, perm],
    }));
  };

  const resetCreateForm = () => {
    setNewKeyData({
      organizationId: "",
      name: "",
      dailyQuota: 1000,
      rateLimitPerMinute: 60,
      permissions: [
        "translate",
        "tts",
        "stt",
        "languages",
        "voice-chat",
        "calls:create",
        "calls:end",
        "calls:read",
        "usage:read",
        "billing:read",
        "ws:subscribe",
      ],
      expiresAt: "",
    });
    setCreatedKeyValue(null);
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge className="bg-green-500/20 text-green-500 border-green-500/30"><CheckCircle className="w-3 h-3 mr-1" />Active</Badge>;
      case "pending":
        return <Badge variant="outline" className="text-amber-500 border-amber-500/30"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
      case "suspended":
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Suspended</Badge>;
      case "revoked":
        return <Badge variant="secondary"><X className="w-3 h-3 mr-1" />Revoked</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const formatRelativeDate = (dateStr: string | null) => {
    if (!dateStr) return "Never";
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "Never";
    return new Date(dateStr).toLocaleDateString();
  };

  const integrationBadge = (status: string) => {
    switch (status) {
      case "configured":
        return (
          <Badge className="bg-green-500/20 text-green-500 border-green-500/30">
            <CheckCircle className="w-3 h-3 mr-1" />
            Configured
          </Badge>
        );
      case "partial":
        return (
          <Badge variant="outline" className="text-amber-500 border-amber-500/30">
            <AlertTriangle className="w-3 h-3 mr-1" />
            Partial
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="text-red-500 border-red-500/30">
            <XCircle className="w-3 h-3 mr-1" />
            Missing
          </Badge>
        );
    }
  };

  if (keysLoading || integrationsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Key className="w-5 h-5" />
              Enterprise API Keys
            </h2>
            <p className="text-sm text-muted-foreground">Manage API keys for enterprise SDK integrations</p>
          </div>
          <Dialog open={showCreateKey} onOpenChange={(open) => { setShowCreateKey(open); if (!open) resetCreateForm(); }}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-api-key">
                <Plus className="w-4 h-4 mr-2" />
                Create API Key
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{createdKeyValue ? "API Key Created" : "Create Enterprise API Key"}</DialogTitle>
                <DialogDescription>
                  {createdKeyValue
                    ? "Save this key now. It will not be shown again."
                    : "Generate a new API key for an organization."}
                </DialogDescription>
              </DialogHeader>
              {createdKeyValue ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>API Key</Label>
                    <div className="flex gap-2">
                      <Input
                        value={createdKeyValue}
                        readOnly
                        className="font-mono text-sm"
                        data-testid="input-created-key"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          navigator.clipboard.writeText(createdKeyValue);
                          toast({ title: "Copied", description: "API key copied to clipboard" });
                        }}
                        data-testid="button-copy-key"
                      >
                        Copy
                      </Button>
                    </div>
                    <p className="text-xs text-destructive font-medium">This is the only time this key will be displayed.</p>
                  </div>
                  <DialogFooter>
                    <Button onClick={() => { setShowCreateKey(false); resetCreateForm(); }} data-testid="button-done-key">
                      Done
                    </Button>
                  </DialogFooter>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Organization</Label>
                    <Select
                      value={newKeyData.organizationId}
                      onValueChange={(val) => setNewKeyData((p) => ({ ...p, organizationId: val }))}
                    >
                      <SelectTrigger data-testid="select-organization">
                        <SelectValue placeholder="Select organization" />
                      </SelectTrigger>
                      <SelectContent>
                        {companies.map((c: any) => (
                          <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Key Name</Label>
                    <Input
                      value={newKeyData.name}
                      onChange={(e) => setNewKeyData((p) => ({ ...p, name: e.target.value }))}
                      placeholder="e.g. Production Key"
                      data-testid="input-key-name"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Daily Quota</Label>
                      <Input
                        type="number"
                        value={newKeyData.dailyQuota}
                        onChange={(e) => setNewKeyData((p) => ({ ...p, dailyQuota: parseInt(e.target.value) || 0 }))}
                        data-testid="input-daily-quota"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Rate Limit (/min)</Label>
                      <Input
                        type="number"
                        value={newKeyData.rateLimitPerMinute}
                        onChange={(e) => setNewKeyData((p) => ({ ...p, rateLimitPerMinute: parseInt(e.target.value) || 0 }))}
                        data-testid="input-rate-limit"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Expiry Date</Label>
                    <Input
                      type="date"
                      value={newKeyData.expiresAt}
                      onChange={(e) => setNewKeyData((p) => ({ ...p, expiresAt: e.target.value }))}
                      data-testid="input-expiry-date"
                    />
                    <p className="text-xs text-muted-foreground">Leave blank to keep the key active until it is revoked.</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Permissions</Label>
                    <div className="space-y-3">
                      {allPermissions.map((perm) => (
                        <div key={perm} className="flex items-center justify-between">
                          <Label className="text-sm font-normal capitalize">{perm.replace(/[:\-]/g, " ")}</Label>
                          <Switch
                            checked={newKeyData.permissions.includes(perm)}
                            onCheckedChange={() => togglePermission(perm)}
                            data-testid={`switch-perm-${perm}`}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => { setShowCreateKey(false); resetCreateForm(); }}>
                      Cancel
                    </Button>
                    <Button
                      onClick={() => createKeyMutation.mutate()}
                      disabled={!newKeyData.organizationId || !newKeyData.name || createKeyMutation.isPending}
                      data-testid="button-submit-create-key"
                    >
                      {createKeyMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      Create Key
                    </Button>
                  </DialogFooter>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </div>

        {keysLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : apiKeys.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              <div className="text-center py-8 text-muted-foreground">
                <Key className="w-10 h-10 mx-auto mb-3 opacity-50" />
                <p className="font-medium">No API Keys</p>
                <p className="text-sm">Create an enterprise API key to get started.</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {apiKeys.map((key: any) => (
              <Card key={key.id} data-testid={`card-api-key-${key.id}`}>
                <CardContent className="pt-6">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex items-start gap-4 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Key className="w-5 h-5 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold" data-testid={`text-key-name-${key.id}`}>{key.name}</h3>
                          {statusBadge(key.status)}
                        </div>
                        <p className="text-sm text-muted-foreground" data-testid={`text-org-name-${key.id}`}>{key.organizationName}</p>
                        <p className="text-xs font-mono text-muted-foreground mt-1" data-testid={`text-key-prefix-${key.id}`}>
                          {key.keyPrefix}...
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-4 text-sm">
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground">Today</p>
                        <p className="font-medium" data-testid={`text-usage-today-${key.id}`}>
                          {key.usageToday ?? 0} / {key.dailyQuota ?? "---"}
                        </p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground">Total</p>
                        <p className="font-medium" data-testid={`text-usage-total-${key.id}`}>{key.usageCount ?? 0}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground">Last Used</p>
                        <p className="font-medium" data-testid={`text-last-used-${key.id}`}>
                          {formatRelativeDate(key.lastUsedAt)}
                        </p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground">Expires</p>
                        <p className="font-medium" data-testid={`text-expires-${key.id}`}>
                          {formatDate(key.expiresAt)}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {(key.permissions || []).map((permission: string) => (
                      <Badge key={permission} variant="secondary" className="capitalize">
                        {permission.replace("-", " ")}
                      </Badge>
                    ))}
                  </div>
                  <div className="mt-4 pt-4 border-t flex flex-wrap items-center gap-2">
                    {key.status === "pending" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-green-600 border-green-500/30"
                        onClick={() => activateMutation.mutate(key.id)}
                        disabled={activateMutation.isPending}
                        data-testid={`button-activate-${key.id}`}
                      >
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Activate
                      </Button>
                    )}
                    {key.status === "active" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-amber-600 border-amber-500/30"
                        onClick={() => suspendMutation.mutate(key.id)}
                        disabled={suspendMutation.isPending}
                        data-testid={`button-suspend-${key.id}`}
                      >
                        <AlertTriangle className="w-3 h-3 mr-1" />
                        Suspend
                      </Button>
                    )}
                    {key.status === "suspended" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-green-600 border-green-500/30"
                        onClick={() => activateMutation.mutate(key.id)}
                        disabled={activateMutation.isPending}
                        data-testid={`button-activate-${key.id}`}
                      >
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Activate
                      </Button>
                    )}
                    {key.status !== "revoked" && (
                      <>
                        {confirmRevokeId === key.id ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-destructive font-medium">Confirm revoke?</span>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => revokeMutation.mutate(key.id)}
                              disabled={revokeMutation.isPending}
                              data-testid={`button-confirm-revoke-${key.id}`}
                            >
                              {revokeMutation.isPending && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                              Yes, Revoke
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setConfirmRevokeId(null)}
                              data-testid={`button-cancel-revoke-${key.id}`}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive border-destructive/30"
                            onClick={() => setConfirmRevokeId(key.id)}
                            data-testid={`button-revoke-${key.id}`}
                          >
                            <XCircle className="w-3 h-3 mr-1" />
                            Revoke
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Third-Party Integrations</h2>
            <p className="text-sm text-muted-foreground">Manage API keys and external service connections</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh Status
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {integrations.map((integration: any) => (
            <Card
              key={integration.id}
              className={
                integration.status === "configured"
                  ? "border-green-500/30"
                  : integration.status === "partial"
                    ? "border-amber-500/30"
                    : "border-red-500/30"
              }
            >
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                      integration.status === "configured"
                        ? "bg-green-500/20 text-green-500"
                        : integration.status === "partial"
                          ? "bg-amber-500/20 text-amber-500"
                          : "bg-red-500/20 text-red-500"
                    }`}>
                      {iconMap[integration.icon] || <Key className="w-5 h-5" />}
                    </div>
                    <div>
                      <h3 className="font-semibold">{integration.name}</h3>
                      <p className="text-sm text-muted-foreground">{integration.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {integrationBadge(integration.status)}
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Configured Keys</span>
                    <span>{integration.configuredCount} / {integration.totalKeys}</span>
                  </div>
                  {integration.missingRequiredKeys?.length > 0 && (
                    <p className="text-xs text-red-500">
                      Missing required: {integration.missingRequiredKeys.join(", ")}
                    </p>
                  )}
                  {integration.missingKeys?.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Missing keys: {integration.missingKeys.join(", ")}
                    </p>
                  )}
                </div>
                <div className="mt-4 pt-4 border-t flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    {integration.status === "configured"
                      ? "All required keys are present."
                      : integration.status === "partial"
                        ? "Service is partially configured."
                        : "Service needs configuration before it can be used."}
                  </p>
                  <Link href="/admin/config">
                    <Button variant="outline" size="sm">
                      <Settings className="w-4 h-4 mr-2" />
                      Configure
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Integration Health</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {integrations.map((integration: any) => (
                <div key={integration.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${integration.status === "configured" ? "bg-green-500" : "bg-amber-500"}`} />
                    <span className="font-medium">{integration.name}</span>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {integration.status === "configured" ? "Connected" : "Disconnected"}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AuditSection() {
  const { toast } = useToast();
  const { data: auditData, isLoading } = useQuery({
    queryKey: ["/api/admin/audit-logs"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/admin/audit-logs", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { data: [] };
      return res.json();
    },
  });

  const { data: statsData } = useQuery({
    queryKey: ["/api/admin/audit-stats"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/admin/audit-stats?days=7", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return { data: [] };
      return res.json();
    },
  });
  const stats: { action: string; count: number }[] = statsData?.data || [];

  const logs = auditData?.logs || [];

  const actionIcons: Record<string, React.ReactNode> = {
    user_created: <UserCheck className="w-4 h-4 text-green-500" />,
    company_approved: <Check className="w-4 h-4 text-green-500" />,
    plan_updated: <Edit className="w-4 h-4 text-blue-500" />,
    user_deleted: <Trash2 className="w-4 h-4 text-red-500" />,
    login: <Users className="w-4 h-4 text-primary" />,
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Audit Logs</h2>
          <p className="text-sm text-muted-foreground">Track all admin actions and system events</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => {
            const logsText = auditData?.logs?.map((l: any) => `${l.createdAt},${l.action},${l.entityType},${l.userId},${l.ipAddress}`).join('\n') || '';
            const csv = `Timestamp,Action,Entity,UserId,IP\n${logsText}`;
            const blob = new Blob([csv], { type: 'text/csv' });
            const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `audit_logs_${new Date().toISOString().split('T')[0]}.csv`; a.click();
            toast({ title: "Logs exported", description: "CSV file downloaded" });
          }}>
            <Download className="w-4 h-4 mr-2" />
            Export Logs
          </Button>
        </div>
      </div>

      {stats.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Activity Breakdown (last 7 days)</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {stats.map((s) => (
              <Badge key={s.action} variant="outline" className="text-xs">
                {s.action.replace(/_/g, ' ')}: {s.count}
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="text-base">Recent Activity</CardTitle>
          <Select defaultValue="all">
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Filter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Actions</SelectItem>
              <SelectItem value="user">User Actions</SelectItem>
              <SelectItem value="company">Company Actions</SelectItem>
              <SelectItem value="billing">Billing Actions</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {logs.length > 0 ? (
            <div className="space-y-3">
              {logs.map((log: any) => (
                <div key={log.id} className="flex items-center gap-4 p-3 rounded-lg border">
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                    {actionIcons[log.action] || <Activity className="w-4 h-4" />}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-sm">{log.action.replace(/_/g, ' ').toUpperCase()}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{log.userName || log.userEmail || `User #${log.userId}`}</span>
                      <span>-</span>
                      <span>{log.entityType}{log.entityId ? ` #${log.entityId}` : ''}</span>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(log.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <History className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No audit logs yet</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SettingsSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [ipWhitelist, setIpWhitelist] = useState("");
  const [paymentReminders, setPaymentReminders] = useState(true);
  const [lowCreditAlerts, setLowCreditAlerts] = useState(true);
  const [newUserWelcome, setNewUserWelcome] = useState(true);
  const [callQualityAlerts, setCallQualityAlerts] = useState(true);

  const { data: gstData } = useQuery({
    queryKey: ["/api/admin/billing/gst-settings"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/admin/billing/gst-settings", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return null;
      return res.json();
    },
  });
  const gst = gstData?.data;

  // Load settings from backend
  const { data: settingsData } = useQuery({
    queryKey: ["/api/admin/settings"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/admin/settings", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      return res.json();
    },
  });

  // Apply loaded settings
  useEffect(() => {
    if (settingsData?.data) {
      const s = settingsData.data;
      setMaintenanceMode(s.maintenanceMode ?? false);
      setIpWhitelist(s.ipWhitelist ?? "");
      setPaymentReminders(s.paymentReminders ?? true);
      setLowCreditAlerts(s.lowCreditAlerts ?? true);
      setNewUserWelcome(s.newUserWelcome ?? true);
      setCallQualityAlerts(s.callQualityAlerts ?? true);
    }
  }, [settingsData]);

  const saveSettingsMutation = useMutation({
    mutationFn: async (settings: Record<string, any>) => {
      const token = getAuthToken();
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error("Failed to save settings");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/settings"] });
      toast({ title: "Settings Saved", description: "Platform settings updated successfully" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleMaintenanceToggle = (checked: boolean) => {
    setMaintenanceMode(checked);
    saveSettingsMutation.mutate({ maintenanceMode: checked });
  };

  const handleSaveNotifications = () => {
    saveSettingsMutation.mutate({
      paymentReminders,
      lowCreditAlerts,
      newUserWelcome,
      callQualityAlerts,
    });
  };

  const handleSaveIpWhitelist = () => {
    saveSettingsMutation.mutate({ ipWhitelist });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Cog className="w-4 h-4" />
            Platform Configuration
          </CardTitle>
          <CardDescription>Configure system-wide settings and security</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6 mb-6">
            <div className="flex items-center justify-between p-4 border rounded-lg bg-destructive/5 border-destructive/20">
              <div>
                <p className="font-bold text-destructive flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Global Maintenance Mode
                </p>
                <p className="text-sm text-muted-foreground">Redirect all users to a maintenance page</p>
              </div>
              <Switch
                checked={maintenanceMode}
                onCheckedChange={handleMaintenanceToggle}
                data-testid="switch-maintenance-mode"
              />
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-primary" />
                Admin IP Whitelisting
              </Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Enter IP addresses (comma separated)"
                  value={ipWhitelist}
                  onChange={(e) => setIpWhitelist(e.target.value)}
                  data-testid="input-ip-whitelist"
                />
                <Button variant="outline" onClick={handleSaveIpWhitelist}>
                  {saveSettingsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Update Whitelist"}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">Restrict Super Admin access to specific IP addresses for maximum security.</p>
            </div>
          </div>
          <Link href="/admin/config">
            <Button data-testid="button-open-config">
              <Settings className="w-4 h-4 mr-2" />
              Open Configuration Manager
            </Button>
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">GST & Tax Settings</CardTitle>
          <CardDescription>Tax configuration for India</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {gst ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-3 rounded-lg bg-muted/30">
                  <Label className="text-xs text-muted-foreground">Default GST Rate</Label>
                  <p className="font-bold text-lg">{gst.defaultGstRate ?? 18}%</p>
                </div>
                <div className="p-3 rounded-lg bg-muted/30">
                  <Label className="text-xs text-muted-foreground">GSTIN</Label>
                  <p className="font-bold text-lg">{gst.gstin || 'Not set'}</p>
                </div>
                <div className="p-3 rounded-lg bg-muted/30">
                  <Label className="text-xs text-muted-foreground">HSN/SAC Code</Label>
                  <p className="font-bold text-lg">{gst.hsnCode || '998314'}</p>
                </div>
                <div className="p-3 rounded-lg bg-muted/30">
                  <Label className="text-xs text-muted-foreground">Place of Supply</Label>
                  <p className="font-bold text-lg">{gst.placeOfSupply || gst.stateCode || 'India'}</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Platform GST settings haven't been configured yet.</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Notification Settings</CardTitle>
              <CardDescription>Configure email and SMS notifications</CardDescription>
            </div>
            <Button size="sm" onClick={handleSaveNotifications} disabled={saveSettingsMutation.isPending}>
              {saveSettingsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Save
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Payment Reminders</p>
                <p className="text-sm text-muted-foreground">Send reminders before plan expiry</p>
              </div>
              <Switch checked={paymentReminders} onCheckedChange={setPaymentReminders} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Low Credit Alerts</p>
                <p className="text-sm text-muted-foreground">Alert companies when wallet balance is running low</p>
              </div>
              <Switch checked={lowCreditAlerts} onCheckedChange={setLowCreditAlerts} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">New User Welcome</p>
                <p className="text-sm text-muted-foreground">Send welcome message on registration</p>
              </div>
              <Switch checked={newUserWelcome} onCheckedChange={setNewUserWelcome} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Call Quality Alerts</p>
                <p className="text-sm text-muted-foreground">Alert when call quality drops below threshold</p>
              </div>
              <Switch checked={callQualityAlerts} onCheckedChange={setCallQualityAlerts} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Employee Role Configuration</CardTitle>
          <CardDescription>Define permissions for each role in the hierarchy</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[
              {
                role: "Super Admin",
                badge: "destructive" as const,
                permissions: ["Full platform access", "Manage all companies", "Global settings", "User management", "Billing & revenue", "API key management", "Audit logs", "Live monitoring"],
              },
              {
                role: "Company Admin",
                badge: "default" as const,
                permissions: ["Manage company agents", "View company reports", "Adjust wallet balances", "Company billing", "Agent monitoring", "Block/unblock users"],
              },
              {
                role: "Company Manager",
                badge: "default" as const,
                permissions: ["View company reports", "Monitor agents", "View billing", "Export reports", "Transfer calls"],
              },
              {
                role: "Senior Agent",
                badge: "secondary" as const,
                permissions: ["Make calls", "Transfer calls", "View team usage", "Mentor agents", "Priority queue"],
              },
              {
                role: "Agent",
                badge: "secondary" as const,
                permissions: ["Make calls", "Transfer calls", "View own usage", "Access translation"],
              },
              {
                role: "Investor",
                badge: "outline" as const,
                permissions: ["View analytics", "View revenue reports", "Platform health", "Growth metrics"],
              },
              {
                role: "Consumer",
                badge: "outline" as const,
                permissions: ["Make calls", "View own history", "Manage profile", "Subscribe to plans"],
              },
            ].map((item) => (
              <div key={item.role} className="p-4 rounded-lg border">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium">{item.role}</h4>
                    <Badge variant={item.badge} className="text-xs">{item.permissions.length} permissions</Badge>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {item.permissions.map((perm) => (
                    <Badge key={perm} variant="secondary" className="text-xs">{perm}</Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Platform Limits</CardTitle>
          <CardDescription>Default limits and quotas</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-3 rounded-lg bg-muted/30">
              <Label className="text-xs text-muted-foreground">Free Trial</Label>
              <p className="font-bold text-lg">15 min</p>
              <p className="text-xs text-muted-foreground">Per new user</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/30">
              <Label className="text-xs text-muted-foreground">Max Call Duration</Label>
              <p className="font-bold text-lg">120 min</p>
              <p className="text-xs text-muted-foreground">Per session</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/30">
              <Label className="text-xs text-muted-foreground">API Rate Limit</Label>
              <p className="font-bold text-lg">60/min</p>
              <p className="text-xs text-muted-foreground">Default per key</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/30">
              <Label className="text-xs text-muted-foreground">Languages</Label>
              <p className="font-bold text-lg">100+</p>
              <p className="text-xs text-muted-foreground">Supported</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
