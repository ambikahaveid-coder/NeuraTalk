import { useEffect, useState } from "react";
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
  Share2, Link2, Globe, Headphones, Monitor, Wallet, Receipt, ShieldCheck, RefreshCw,
  Radio, PiggyBank
} from "lucide-react";

type Tab = "overview" | "agents" | "reports" | "api" | "settings";

interface CompanyCreditResponse {
  success: boolean;
  billing?: {
    walletBalancePaise?: number;
    availableWalletPaise?: number;
    lockedBalancePaise?: number;
    billingType?: string;
    includedSecondsRemaining?: number;
    canUsePaidServices?: boolean;
  };
  ledger?: Array<{
    id: number;
    entryType: string;
    direction: string;
    amountPaise: number;
    balanceAfterPaise?: number | null;
    createdAt: string;
  }>;
}

interface CompanyBillingDashboardResponse {
  success: boolean;
  data?: {
    strictAccount?: {
      billingType?: string;
      walletBalancePaise?: number;
      availableWalletPaise?: number;
      lockedBalancePaise?: number;
      includedSecondsRemaining?: number;
      canUsePaidServices?: boolean;
    };
    subscription?: {
      status?: string;
      billingModel?: string;
    } | null;
    recentInvoices?: Array<{
      id: number;
      invoiceNumber: string;
      totalAmountPaise: number;
      status: string;
      createdAt: string;
    }>;
    activeCallCount?: number;
    usageSummary?: {
      totalMinutes?: number;
      totalCost?: number;
    };
  };
}

interface AuditLogResponse {
  logs: Array<{
    id: number;
    user: string;
    action: string;
    resource: string;
    ip: string;
    timestamp: string;
    status: string;
  }>;
}

interface PaymentHistoryResponse {
  data: Array<{
    id: number;
    gatewayOrderId?: string | null;
    gatewayPaymentId?: string | null;
    amount: number;
    status: string;
    failureReason?: string | null;
    metadata?: {
      kind?: string;
      label?: string;
    } | null;
    createdAt: string;
  }>;
}

const legacyMeetingTransportEnabled = (import.meta.env.VITE_ENABLE_LEGACY_MEETING_TRANSPORT || "").toLowerCase() === "true";

export default function CompanyDashboard() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canManageCompany = user?.role === "company_admin" || user?.role === "super_admin";

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

  const { data: creditsData } = useQuery<CompanyCreditResponse>({
    queryKey: ["/api/company/credits"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/company/credits", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load credits");
      return res.json();
    },
    enabled: activeTab === "overview" || activeTab === "api" || activeTab === "reports",
  });

  const { data: billingData } = useQuery<CompanyBillingDashboardResponse>({
    queryKey: ["/api/billing/dashboard"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/billing/dashboard", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load billing dashboard");
      return res.json();
    },
    enabled: canManageCompany && (activeTab === "overview" || activeTab === "api" || activeTab === "reports"),
  });

  const { data: auditData } = useQuery<AuditLogResponse>({
    queryKey: ["/api/enterprise/audit-logs"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/enterprise/audit-logs", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load audit logs");
      return res.json();
    },
    enabled: canManageCompany && (activeTab === "overview" || activeTab === "reports"),
  });

  const { data: paymentHistory } = useQuery<PaymentHistoryResponse>({
    queryKey: ["/api/payments/history"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/payments/history", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load payment history");
      return res.json();
    },
    enabled: canManageCompany && activeTab === "reports",
  });

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "overview", label: "Overview", icon: <BarChart3 className="w-4 h-4" /> },
    { id: "agents", label: "Team", icon: <Users className="w-4 h-4" /> },
    { id: "reports", label: "Reports", icon: <FileText className="w-4 h-4" /> },
    { id: "api", label: "API & SDK", icon: <Key className="w-4 h-4" /> },
    { id: "settings", label: "Settings", icon: <Settings className="w-4 h-4" /> },
  ];
  const visibleTabs = tabs.filter((tab) => {
    if ((tab.id === "api" || tab.id === "settings" || tab.id === "reports") && !canManageCompany) {
      return false;
    }
    return true;
  });

  const isPending = user?.organization?.status === "pending";

  useEffect(() => {
    if (!visibleTabs.some((tab) => tab.id === activeTab)) {
      setActiveTab("overview");
    }
  }, [activeTab, visibleTabs]);

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
            {visibleTabs.map((tab) => (
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
            <OverviewTab dashboard={dashboard} billingData={billingData} creditsData={creditsData} auditData={auditData} isLoading={dashboardLoading} canManageCompany={canManageCompany} />
          )}

          {activeTab === "agents" && (
            <AgentsTab agents={agents} isLoading={agentsLoading} />
          )}

          {activeTab === "reports" && (
            <ReportsTab billingData={billingData} creditsData={creditsData} auditData={auditData} paymentHistory={paymentHistory} />
          )}

          {activeTab === "api" && (
            <ApiTab billingData={billingData} />
          )}

          {activeTab === "settings" && (
            <SettingsTab organization={user?.organization} user={user} canManageCompany={canManageCompany} />
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

function formatPaise(paise?: number | null) {
  const value = typeof paise === "number" ? paise : 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value / 100);
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows
    .map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function OverviewTab({ dashboard, billingData, creditsData, auditData, isLoading, canManageCompany }: { dashboard: any; billingData?: CompanyBillingDashboardResponse; creditsData?: CompanyCreditResponse; auditData?: AuditLogResponse; isLoading: boolean; canManageCompany: boolean }) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  const wallet = creditsData?.billing || billingData?.data?.strictAccount;
  const recentActivity = auditData?.logs || [];
  const recentInvoices = billingData?.data?.recentInvoices || [];
  const recentLedger = creditsData?.ledger || [];
  const exportAuditCsv = () => {
    downloadCsv("company_audit_activity.csv", [
      ["Timestamp", "User", "Action", "Resource", "Status", "IP"],
      ...recentActivity.map((entry) => [entry.timestamp, entry.user, entry.action, entry.resource, entry.status, entry.ip]),
    ]);
  };
  const exportInvoicesCsv = () => {
    downloadCsv("company_invoices.csv", [
      ["Invoice Number", "Created At", "Status", "Amount"],
      ...recentInvoices.map((invoice) => [invoice.invoiceNumber, invoice.createdAt, invoice.status, formatPaise(invoice.totalAmountPaise)]),
    ]);
  };
  const exportLedgerCsv = () => {
    downloadCsv("company_wallet_ledger.csv", [
      ["Created At", "Entry Type", "Direction", "Amount", "Balance After"],
      ...recentLedger.map((entry) => [entry.createdAt, entry.entryType, entry.direction, formatPaise(entry.amountPaise), formatPaise(entry.balanceAfterPaise ?? 0)]),
    ]);
  };

  const stats = [
    { label: "Available Wallet", value: formatPaise(wallet?.availableWalletPaise), icon: <Wallet className="w-5 h-5" /> },
    { label: "Active Agents", value: dashboard?.agents?.length || 0, icon: <Users className="w-5 h-5" /> },
    { label: "Active Calls", value: billingData?.data?.activeCallCount || 0, icon: <Phone className="w-5 h-5" /> },
    { label: "30d Usage", value: `${billingData?.data?.usageSummary?.totalMinutes || 0} min`, icon: <Activity className="w-5 h-5" /> },
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
              <CardDescription className="text-xs">Primary-safe calling first, legacy meeting links only when explicitly enabled</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Link href="/calls/video-translation">
                <Button className="w-full justify-start shine-effect" data-testid="button-video-call">
                  <Video className="mr-3 h-4 w-4" />
                  Video Translation Call {legacyMeetingTransportEnabled ? "" : "(legacy route)"}
                </Button>
              </Link>
              <Link href="/calls/voice-translation">
                <Button variant="outline" className="w-full justify-start hover:bg-white/5" data-testid="button-voice-call">
                  <Phone className="mr-3 h-4 w-4" />
                  Voice Translation Call {legacyMeetingTransportEnabled ? "" : "(legacy route)"}
                </Button>
              </Link>
              <Link href="/calls/b2b">
                <Button variant="outline" className="w-full justify-start bg-green-500/10 border-green-500/20 hover:bg-green-500/20 text-green-400" data-testid="button-sim-call">
                  <PhoneCall className="mr-3 h-4 w-4" />
                  Phone Bridge Call
                </Button>
              </Link>
              <Link href="/enterprise/hub">
                <Button variant="outline" className="w-full justify-start bg-purple-500/10 border-purple-500/20 hover:bg-purple-500/20 text-purple-400">
                  <Phone className="mr-3 h-4 w-4" />
                  Number Integration Hub
                </Button>
              </Link>
              <Link href="/enterprise/org-structure">
                <Button variant="outline" className="w-full justify-start bg-blue-500/10 border-blue-500/20 hover:bg-blue-500/20 text-blue-400">
                  <Building2 className="mr-3 h-4 w-4" />
                  Org Structure
                </Button>
              </Link>
              <Link href="/enterprise/telephony">
                <Button variant="outline" className="w-full justify-start bg-cyan-500/10 border-cyan-500/20 hover:bg-cyan-500/20 text-cyan-400">
                  <Phone className="mr-3 h-4 w-4" />
                  IVR &amp; Call Queues
                </Button>
              </Link>
              <Link href="/enterprise/pbx">
                <Button variant="outline" className="w-full justify-start bg-orange-500/10 border-orange-500/20 hover:bg-orange-500/20 text-orange-400">
                  <Monitor className="mr-3 h-4 w-4" />
                  PBX Integration
                </Button>
              </Link>
              <Link href="/enterprise/presence">
                <Button variant="outline" className="w-full justify-start bg-green-500/10 border-green-500/20 hover:bg-green-500/20 text-green-400">
                  <Activity className="mr-3 h-4 w-4" />
                  Agent Presence
                </Button>
              </Link>
              <Link href="/enterprise/supervisor">
                <Button variant="outline" className="w-full justify-start bg-red-500/10 border-red-500/20 hover:bg-red-500/20 text-red-400">
                  <Radio className="mr-3 h-4 w-4" />
                  Supervisor Monitor
                </Button>
              </Link>
              <Link href="/enterprise/cost-centers">
                <Button variant="outline" className="w-full justify-start bg-yellow-500/10 border-yellow-500/20 hover:bg-yellow-500/20 text-yellow-400">
                  <PiggyBank className="mr-3 h-4 w-4" />
                  Cost Centers
                </Button>
              </Link>
              <Link href="/enterprise/billing-contracts">
                <Button variant="outline" className="w-full justify-start bg-violet-500/10 border-violet-500/20 hover:bg-violet-500/20 text-violet-400">
                  <FileText className="mr-3 h-4 w-4" />
                  Billing Contract
                </Button>
              </Link>
              <p className="text-[11px] text-muted-foreground">
                PSTN caller identity is best-effort. Final number display depends on provider verification and telecom rules.
              </p>
            </CardContent>
          </Card>

          <ClientConnectCard />

          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-sm font-display font-bold flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-primary" />
                Billing Snapshot
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Billing Type</span>
                <Badge variant="outline">{wallet?.billingType || "prepaid"}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Wallet Balance</span>
                <span className="font-semibold">{formatPaise(wallet?.walletBalancePaise)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Locked Balance</span>
                <span className="font-semibold">{formatPaise(wallet?.lockedBalancePaise)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Included Seconds</span>
                <span className="font-semibold">{wallet?.includedSecondsRemaining ?? 0}s</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Service Status</span>
                <Badge className={wallet?.canUsePaidServices === false ? "bg-red-600" : "bg-green-600"}>
                  {wallet?.canUsePaidServices === false ? "Restricted" : "Active"}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div 
          className="lg:col-span-2"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.5 }}
        >
          <Card className="glass-card h-full">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-sm font-display font-bold flex items-center gap-2">
                  <Clock className="w-4 h-4 text-primary" />
                  Recent Organization Activity
                </CardTitle>
                {canManageCompany && recentActivity.length > 0 ? (
                  <Button size="sm" variant="outline" onClick={exportAuditCsv}>
                    <FileText className="w-4 h-4 mr-2" />
                    Export CSV
                  </Button>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {!canManageCompany ? (
                <div className="flex flex-col items-center justify-center py-16 opacity-70 space-y-4">
                  <div className="w-12 h-12 rounded-full border border-dashed border-white/20 flex items-center justify-center">
                    <ShieldCheck className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground font-medium text-center max-w-md">
                    Audit logs, invoices, and billing controls are restricted to company admins and super admins.
                  </p>
                </div>
              ) : recentActivity.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 opacity-50 space-y-4">
                  <div className="w-12 h-12 rounded-full border border-dashed border-white/20 flex items-center justify-center">
                    <Activity className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground font-medium">
                    No recent audit activity yet.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {recentActivity.slice(0, 6).map((entry) => (
                    <div key={entry.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold">{entry.action}</p>
                          <p className="text-xs text-muted-foreground">{entry.resource} by {entry.user}</p>
                        </div>
                        <Badge variant="outline">{entry.status}</Badge>
                      </div>
                      <p className="mt-2 text-[11px] text-muted-foreground">{entry.timestamp} • {entry.ip}</p>
                    </div>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2">
                      <Receipt className="w-4 h-4 text-primary" />
                      <p className="text-sm font-semibold">Recent Invoices</p>
                    </div>
                    {recentInvoices.length > 0 ? (
                      <Button size="sm" variant="ghost" onClick={exportInvoicesCsv}>
                        <FileText className="w-4 h-4 mr-2" />
                        Export
                      </Button>
                    ) : null}
                  </div>
                  {recentInvoices.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No invoices generated yet.</p>
                  ) : (
                    <div className="space-y-2">
                       {recentInvoices.slice(0, 3).map((invoice) => (
                          <div key={invoice.id} className="flex items-center justify-between text-xs">
                            <div>
                              <p className="font-medium">{invoice.invoiceNumber}</p>
                              <p className="text-muted-foreground">{new Date(invoice.createdAt).toLocaleDateString()}</p>
                            </div>
                            <div className="text-right">
                              <p className="font-semibold">{formatPaise(invoice.totalAmountPaise)}</p>
                              <p className="text-muted-foreground">{invoice.status}</p>
                              <button
                                type="button"
                                className="mt-1 text-primary hover:underline"
                                onClick={() => window.open(`/api/billing/invoices/${invoice.id}/html`, "_blank")}
                              >
                                Open
                              </button>
                            </div>
                          </div>
                        ))}
                     </div>
                  )}
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <ShieldCheck className="w-4 h-4 text-primary" />
                    <p className="text-sm font-semibold">Subscription Health</p>
                  </div>
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Plan Status</span>
                      <Badge variant="outline">{billingData?.data?.subscription?.status || "inactive"}</Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Billing Model</span>
                      <span>{billingData?.data?.subscription?.billingModel || wallet?.billingType || "prepaid"}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">30d Cost</span>
                      <span>{formatPaise(billingData?.data?.usageSummary?.totalCost)}</span>
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2">
                      <Wallet className="w-4 h-4 text-primary" />
                      <p className="text-sm font-semibold">Recent Ledger</p>
                    </div>
                    {recentLedger.length > 0 ? (
                      <Button size="sm" variant="ghost" onClick={exportLedgerCsv}>
                        <FileText className="w-4 h-4 mr-2" />
                        Export
                      </Button>
                    ) : null}
                  </div>
                  {recentLedger.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No wallet activity recorded yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {recentLedger.slice(0, 3).map((entry) => (
                        <div key={entry.id} className="flex items-center justify-between text-xs">
                          <div>
                            <p className="font-medium">{entry.entryType.replace(/_/g, " ")}</p>
                            <p className="text-muted-foreground">{new Date(entry.createdAt).toLocaleDateString()}</p>
                          </div>
                          <div className="text-right">
                            <p className="font-semibold">{formatPaise(entry.amountPaise)}</p>
                            <p className="text-muted-foreground">{entry.direction}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
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
  const [callType, setCallType] = useState<"video" | "audio" | "f2f">(legacyMeetingTransportEnabled ? "video" : "f2f");
  const [myLanguage, setMyLanguage] = useState("en");
  const [clientLanguage, setClientLanguage] = useState("te");
  const [isCreating, setIsCreating] = useState(false);
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const selectedSessionRequiresLegacyTransport = callType !== "f2f";

  const handleCreateSession = async () => {
    if (selectedSessionRequiresLegacyTransport && !legacyMeetingTransportEnabled) {
      toast({
        title: "Legacy Meeting Transport Disabled",
        description: "Video and voice client sessions are disabled outside controlled legacy support. Use Face-to-Face for the primary path.",
        variant: "destructive",
      });
      return;
    }

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
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Failed to create session");
      }
      setGeneratedLink(data.joinLink);
      toast({ title: "Session Created", description: "Share the link with your client" });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Could not create session",
        variant: "destructive",
      });
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
        {!legacyMeetingTransportEnabled && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            Legacy video/voice meeting transport is disabled by default. Face-to-face client sessions remain available on the primary path.
          </div>
        )}
        {!generatedLink ? (
          <>
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {callTypeOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => (opt.value === "f2f" || legacyMeetingTransportEnabled) && setCallType(opt.value)}
                    className={`p-2 rounded-lg border text-center transition-all text-xs ${
                      callType === opt.value 
                        ? "border-primary bg-primary/10 text-primary" 
                        : "border-white/10 hover:border-white/20 text-muted-foreground"
                    } ${(opt.value !== "f2f" && !legacyMeetingTransportEnabled) ? "opacity-50 cursor-not-allowed" : ""}`}
                    disabled={opt.value !== "f2f" && !legacyMeetingTransportEnabled}
                    data-testid={`calltype-${opt.value}`}
                  >
                    <div className="flex flex-col items-center gap-1">
                      {opt.icon}
                      <span className="font-medium">{opt.label}{opt.value !== "f2f" && !legacyMeetingTransportEnabled ? " (disabled)" : ""}</span>
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
              disabled={isCreating || (selectedSessionRequiresLegacyTransport && !legacyMeetingTransportEnabled)}
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

  const updateAgentStatusMutation = useMutation({
    mutationFn: async ({ agentId, isActive }: { agentId: number; isActive: boolean }) => {
      const token = getAuthToken();
      const res = await fetch(`/api/company/agents/${agentId}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ isActive }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to update team member status");
      }
      return res.json();
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/agents"] });
      toast({
        title: variables.isActive ? "Team Member Activated" : "Team Member Deactivated",
        description: variables.isActive ? "Access restored successfully" : "Access disabled successfully",
      });
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
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={async () => {
            const token = getAuthToken();
            const res = await fetch("/api/organization/import/template", { headers: { Authorization: `Bearer ${token}` } });
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a"); a.href = url; a.download = "user_import_template.csv"; a.click();
          }}>CSV Template</Button>
          <Button size="sm" variant="outline" onClick={() => { const input = document.createElement("input"); input.type = "file"; input.accept = ".csv"; input.onchange = async (e) => { const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return; const token = getAuthToken(); const fd = new FormData(); fd.append("file", file); const res = await fetch("/api/organization/import/validate", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd }); const data = await res.json(); if (data.valid) { if (confirm(`Import ${data.summary?.validRows} users? (${data.summary?.invalidRows} invalid rows will be skipped)`)) { const exRes = await fetch("/api/organization/import/execute", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ users: data.validUsers }) }); const exData = await exRes.json(); toast({ title: exData.success ? "Import Complete" : "Import Failed", description: exData.message }); queryClient.invalidateQueries({ queryKey: ["/api/company/agents"] }); } } else { toast({ title: "CSV Validation Failed", description: data.errors?.join(", ") ?? "Invalid file", variant: "destructive" }); } }; input.click(); }}><FileText className="w-4 h-4 mr-1" />Bulk Import</Button>
          <Button size="sm" onClick={() => setShowAddForm(true)}><UserPlus className="w-4 h-4 mr-2" /> Add Member</Button>
        </div>
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
              <div className="flex items-center gap-2">
                <Badge variant={agent.isActive ? "default" : "secondary"}>{agent.isActive ? "Active" : "Inactive"}</Badge>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={updateAgentStatusMutation.isPending}
                  onClick={() => updateAgentStatusMutation.mutate({ agentId: agent.id, isActive: !agent.isActive })}
                >
                  {agent.isActive ? "Deactivate" : "Activate"}
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function ReportsTab({
  billingData,
  creditsData,
  auditData,
  paymentHistory,
}: {
  billingData?: CompanyBillingDashboardResponse;
  creditsData?: CompanyCreditResponse;
  auditData?: AuditLogResponse;
  paymentHistory?: PaymentHistoryResponse;
}) {
  const [windowDays, setWindowDays] = useState<"7" | "30" | "all">("30");
  const usageMinutes = billingData?.data?.usageSummary?.totalMinutes || 0;
  const usageCost = billingData?.data?.usageSummary?.totalCost || 0;
  const activeCalls = billingData?.data?.activeCallCount || 0;
  const invoiceCount = billingData?.data?.recentInvoices?.length || 0;
  const paymentRows = paymentHistory?.data || [];
  const ledgerRows = creditsData?.ledger || [];
  const auditRows = auditData?.logs || [];
  const settledPayments = paymentRows.filter((payment) => ["paid", "captured", "completed"].includes((payment.status || "").toLowerCase()));
  const failedPayments = paymentRows.filter((payment) => ["failed", "cancelled"].includes((payment.status || "").toLowerCase()));
  const now = Date.now();
  const windowMs = windowDays === "all" ? Number.POSITIVE_INFINITY : Number(windowDays) * 86_400_000;
  const filteredPayments = paymentRows.filter((payment) => now - new Date(payment.createdAt).getTime() <= windowMs);
  const filteredAudit = auditRows.filter((entry) => now - new Date(entry.timestamp).getTime() <= windowMs);
  const filteredLedger = ledgerRows.filter((entry) => now - new Date(entry.createdAt).getTime() <= windowMs);
  const filteredSettledPayments = filteredPayments.filter((payment) => ["paid", "captured", "completed"].includes((payment.status || "").toLowerCase()));
  const filteredFailedPayments = filteredPayments.filter((payment) => ["failed", "cancelled"].includes((payment.status || "").toLowerCase()));
  const exportPaymentsCsv = () => {
    downloadCsv("company_payments.csv", [
      ["Created At", "Label", "Status", "Amount", "Gateway Payment ID", "Failure Reason"],
      ...paymentRows.map((payment) => [
        payment.createdAt,
        payment.metadata?.label || payment.metadata?.kind || "payment",
        payment.status,
        formatPaise(payment.amount),
        payment.gatewayPaymentId || payment.gatewayOrderId || "-",
        payment.failureReason || "-",
      ]),
    ]);
  };
  const exportCombinedReportCsv = () => {
    downloadCsv("company_reports_summary.csv", [
      ["Metric", "Value"],
      ["30d Usage Minutes", String(usageMinutes)],
      ["30d Usage Cost", formatPaise(usageCost)],
      ["Active Calls", String(activeCalls)],
      ["Wallet Ready", formatPaise(creditsData?.billing?.availableWalletPaise)],
      ["Recent Invoice Count", String(invoiceCount)],
      ["Recent Audit Count", String(auditRows.length)],
      ["Recent Ledger Count", String(ledgerRows.length)],
      ["Settled Payments", String(settledPayments.length)],
      ["Failed Payments", String(failedPayments.length)],
      [`Payments Last ${windowDays === "all" ? "All" : `${windowDays}d`}`, String(filteredPayments.length)],
      [`Audit Events Last ${windowDays === "all" ? "All" : `${windowDays}d`}`, String(filteredAudit.length)],
      [`Ledger Entries Last ${windowDays === "all" ? "All" : `${windowDays}d`}`, String(filteredLedger.length)],
    ]);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Company Reports</h2>
          <p className="text-sm text-muted-foreground">Finance, wallet, and operational signals in one place.</p>
        </div>
        <div className="w-36">
          <Select value={windowDays} onValueChange={(value: "7" | "30" | "all") => setWindowDays(value)}>
            <SelectTrigger>
              <SelectValue placeholder="Window" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="all">All data</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-sm font-display font-bold flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              30d Usage
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{usageMinutes} min</p>
            <p className="text-xs text-muted-foreground mt-1">Current rolling multilingual usage</p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-sm font-display font-bold flex items-center gap-2">
              <Receipt className="w-4 h-4 text-primary" />
              30d Billing
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatPaise(usageCost)}</p>
            <p className="text-xs text-muted-foreground mt-1">Recent invoiceable usage cost</p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-sm font-display font-bold flex items-center gap-2">
              <Phone className="w-4 h-4 text-primary" />
              Active Calls
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{activeCalls}</p>
            <p className="text-xs text-muted-foreground mt-1">Calls currently consuming company capacity</p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-sm font-display font-bold flex items-center gap-2">
              <Wallet className="w-4 h-4 text-primary" />
              Wallet Ready
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatPaise(creditsData?.billing?.availableWalletPaise)}</p>
            <p className="text-xs text-muted-foreground mt-1">Spendable balance for calls and top-ups</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-sm font-display font-bold flex items-center gap-2">
              <Receipt className="w-4 h-4 text-primary" />
              Invoice Snapshot
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Recent Invoices</span>
              <span className="font-semibold">{invoiceCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Wallet Entries</span>
              <span className="font-semibold">{ledgerRows.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Audit Events</span>
              <span className="font-semibold">{auditRows.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Audit Events In Window</span>
              <span className="font-semibold">{filteredAudit.length}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-sm font-display font-bold flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-primary" />
              Payment Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Settled</span>
              <span className="font-semibold">{filteredSettledPayments.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Failed/Cancelled</span>
              <span className="font-semibold">{filteredFailedPayments.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Total Payment Records</span>
              <span className="font-semibold">{paymentRows.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Payments In Window</span>
              <span className="font-semibold">{filteredPayments.length}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-sm font-display font-bold flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" />
              Export Pack
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Download payment evidence for finance, support, and reconciliation.
            </p>
            <Button size="sm" variant="outline" className="w-full" onClick={exportPaymentsCsv}>
              <FileText className="w-4 h-4 mr-2" />
              Export Payments CSV
            </Button>
            <Button size="sm" variant="outline" className="w-full" onClick={exportCombinedReportCsv}>
              <BarChart3 className="w-4 h-4 mr-2" />
              Export Summary CSV
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-sm font-display font-bold flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-primary" />
            Recent Payment Activity
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {paymentRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payment activity recorded yet.</p>
          ) : (
            filteredPayments.slice(0, 8).map((payment) => (
              <div key={payment.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{payment.metadata?.label || payment.metadata?.kind || "Payment"}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(payment.createdAt).toLocaleString()} · {payment.gatewayPaymentId || payment.gatewayOrderId || "Awaiting gateway reference"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{formatPaise(payment.amount)}</p>
                    <Badge variant={["paid", "captured", "completed"].includes((payment.status || "").toLowerCase()) ? "default" : "secondary"}>
                      {payment.status}
                    </Badge>
                  </div>
                </div>
                {payment.failureReason ? (
                  <p className="mt-2 text-xs text-red-400">{payment.failureReason}</p>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ApiTab({ billingData }: { billingData?: CompanyBillingDashboardResponse }) {
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
  const billing = billingData?.data;
  const maskedKey = apiKey ? `ntk_live_••••••••${apiKey.slice(-8)}` : "No API key";

  return (
    <div className="space-y-6">
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-sm font-display font-bold flex items-center gap-2">
            <Key className="w-4 h-4 text-primary" />
            API Key
          </CardTitle>
          <CardDescription>
            Manage your company integration credential and rotate it when you need a clean cutover.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <code className="bg-muted p-2 rounded flex-1 text-sm">{showKey ? apiKey : maskedKey}</code>
            <Button variant="ghost" size="icon" onClick={() => setShowKey(!showKey)} disabled={keyLoading}>
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={!apiKey}
              onClick={() => {
                navigator.clipboard.writeText(apiKey);
                toast({ title: "Copied" });
              }}
            >
              <Copy className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => generateKeyMutation.mutate()} disabled={generateKeyMutation.isPending}>
              {generateKeyMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Rotate Key
            </Button>
            <Link href="/api-docs">
              <Button size="sm" variant="outline">
                <ExternalLink className="w-4 h-4 mr-2" />
                Open API Docs
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-sm font-display font-bold flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" />
            Integration Readiness
          </CardTitle>
          <CardDescription>
            Live billing and usage context for external integrations and supervised enterprise rollout.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border bg-card/60 p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <Wallet className="w-3.5 h-3.5" />
              Billing Model
            </div>
            <p className="mt-2 text-lg font-semibold">
              {billing?.subscription?.billingModel || billing?.strictAccount?.billingType || "prepaid"}
            </p>
          </div>
          <div className="rounded-lg border bg-card/60 p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <Activity className="w-3.5 h-3.5" />
              Active Calls
            </div>
            <p className="mt-2 text-lg font-semibold">{billing?.activeCallCount ?? 0}</p>
          </div>
          <div className="rounded-lg border bg-card/60 p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <Receipt className="w-3.5 h-3.5" />
              30d Usage
            </div>
            <p className="mt-2 text-lg font-semibold">{billing?.usageSummary?.totalMinutes ?? 0} min</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SettingsTab({ organization, user, canManageCompany }: { organization: any; user: any; canManageCompany: boolean }) {
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
        <div>
          <label className="text-xs text-muted-foreground">Your Role</label>
          <p className="font-bold">{user?.role || "unknown"}</p>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Access Scope</label>
          <p className="text-sm text-muted-foreground">
            {canManageCompany
              ? "Full company admin access for billing, API keys, team management, and audit review."
              : "Operational access only. Billing, API credentials, and audit controls stay restricted to company admins."}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
