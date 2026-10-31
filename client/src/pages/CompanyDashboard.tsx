import { ThemeToggle } from "@/components/theme-toggle";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useAuth, getAuthToken } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { QueryErrorState } from "@/components/QueryErrorState";
import { useUpload } from "@/hooks/use-upload";
import MarketingControlCenter from "@/pages/marketing/MarketingControlCenter";
import MessagingStudio from "@/pages/messaging/MessagingStudio";
import BusinessInboxPanel from "@/pages/inbox/BusinessInboxPanel";
import { BusinessHome } from "./business/BusinessHome";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sparkles, LogOut, Users, CreditCard, BarChart3, Phone, PhoneCall, Video,
  Settings, Plus, Clock, Check, X, Loader2, Copy, Eye, EyeOff,
  Building2, Key, Activity, ExternalLink, FileText, UserPlus, Languages,
  Share2, Link2, Globe, Headphones, Monitor, Wallet, Receipt, ShieldCheck, RefreshCw,
  Radio, PiggyBank, Lock, MessagesSquare, Send
} from "lucide-react";
import { LogoWithIcon } from "@/components/Logo";

// Human-readable labels for the P0-5 Business-platform permission grant --
// mirrors GRANTABLE_BUSINESS_PERMISSIONS in server/business-rbac-routes.ts
// exactly (14 entries). This is a display-only mapping; the actual
// allow-list enforcement lives server-side and is fetched live (see
// BusinessAccessDialog below), never hardcoded as a security boundary here.
const BUSINESS_PERMISSION_LABELS: Record<string, { label: string; group: string }> = {
  "customers:view": { label: "View customers", group: "Customers" },
  "customers:manage": { label: "Manage customers", group: "Customers" },
  "audiences:view": { label: "View audiences", group: "Audiences" },
  "audiences:manage": { label: "Manage audiences", group: "Audiences" },
  "templates:manage": { label: "Manage message templates", group: "Templates" },
  "templates:approve": { label: "Approve message templates", group: "Templates" },
  "campaigns:view": { label: "View campaigns", group: "Campaigns" },
  "campaigns:manage": { label: "Manage campaigns", group: "Campaigns" },
  "campaigns:execute": { label: "Launch campaigns", group: "Campaigns" },
  "otp:view": { label: "View OTP activity", group: "OTP" },
  "otp:manage": { label: "Manage OTP", group: "OTP" },
  "utility:view": { label: "View utility messaging", group: "Utility" },
  "messaging:view": { label: "View business messaging", group: "Messaging" },
  "messaging:send": { label: "Send business messages", group: "Messaging" },
};

type Tab = "overview" | "inbox" | "messaging" | "marketing" | "agents" | "reports" | "api" | "settings";

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

  const {
    data: dashboard,
    isLoading: dashboardLoading,
    isError: dashboardIsError,
    error: dashboardError,
    refetch: refetchDashboard,
  } = useQuery({
    queryKey: ["/api/company/dashboard"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/company/dashboard", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load dashboard");
      return res.json();
    },
  });

  const {
    data: agents,
    isLoading: agentsLoading,
    isError: agentsIsError,
    error: agentsError,
    refetch: refetchAgents,
  } = useQuery({
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
    { id: "overview", label: "Home", icon: <BarChart3 className="w-4 h-4" /> },
    { id: "inbox", label: "Chats", icon: <MessagesSquare className="w-4 h-4" /> },
    { id: "messaging", label: "Business tools", icon: <Send className="w-4 h-4" /> },
    { id: "marketing", label: "Broadcasts", icon: <Sparkles className="w-4 h-4" /> },
    { id: "agents", label: "Team", icon: <Users className="w-4 h-4" /> },
    { id: "reports", label: "Reports", icon: <FileText className="w-4 h-4" /> },
    { id: "api", label: "Developers", icon: <Key className="w-4 h-4" /> },
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

  const businessId = user?.organization?.id ?? 0;
  const businessName = dashboard?.company?.name || user?.organization?.name || "Your business";
  const verified = Boolean(dashboard?.company?.verifiedAt);
  const wallet = creditsData?.billing || billingData?.data?.strictAccount;
  const current = visibleTabs.find((t) => t.id === activeTab);

  return (
    <div className="flex h-[100dvh] flex-col bg-[#F5F2EC] text-foreground dark:bg-background md:flex-row">
      {/* One menu: a sidebar on a computer, a top bar with scrolling sections on a phone. */}
      <aside className="flex w-full shrink-0 flex-col border-b bg-background md:w-64 md:border-b-0 md:border-r">
        <div className="flex items-center gap-3 px-4 py-3 md:px-5 md:py-5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground md:h-10 md:w-10 md:text-lg">{businessName.charAt(0).toUpperCase()}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold leading-tight" data-testid="text-business-name">{businessName}</p>
            <p className="hidden text-xs text-muted-foreground md:block">NeuraTalk Business</p>
          </div>
          <div className="flex items-center md:hidden">
            <ThemeToggle />
            <Button variant="ghost" size="icon" onClick={logout} aria-label="Log out"><LogOut className="h-4 w-4" /></Button>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2 scrollbar-none md:flex-1 md:flex-col md:overflow-y-auto md:pb-0" aria-label="Business">
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-sm transition-colors md:w-full md:gap-3 md:px-4 md:py-2.5 md:text-left ${activeTab === tab.id ? "bg-primary text-primary-foreground md:bg-primary/10 md:font-semibold md:text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
              data-testid={`tab-${tab.id}`}
              aria-current={activeTab === tab.id ? "page" : undefined}
            >
              {tab.icon}{tab.label}
            </button>
          ))}
        </nav>
        <div className="hidden space-y-1 border-t p-3 md:block">
          <Link href="/web" className="flex items-center gap-3 rounded-full px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
            <MessagesSquare className="h-4 w-4" />My personal chats
          </Link>
          <div className="flex items-center justify-between px-2 pt-1">
            <span className="truncate px-2 text-xs text-muted-foreground">{user?.displayName || user?.email || user?.username}</span>
            <div className="flex items-center">
              <ThemeToggle />
              <Button variant="ghost" size="icon" onClick={logout} aria-label="Log out" data-testid="button-logout"><LogOut className="h-4 w-4" /></Button>
            </div>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className={`mx-auto px-4 py-6 md:px-8 md:py-8 ${activeTab === "inbox" ? "max-w-[1400px]" : "max-w-6xl"}`}>
          {activeTab !== "overview" && current && (
            <h1 className="mb-6 hidden text-2xl font-semibold tracking-tight md:block">{current.label}</h1>
          )}

          {activeTab === "overview" && (
            dashboardIsError ? (
              <div className="mx-auto max-w-md py-8"><QueryErrorState error={dashboardError} onRetry={() => refetchDashboard()} label="your business home" /></div>
            ) : dashboardLoading ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : (
              <BusinessHome
                businessId={businessId}
                businessName={businessName}
                verified={verified}
                canManage={canManageCompany}
                wallet={wallet}
                onOpen={setActiveTab}
                auditLogs={auditData?.logs}
                clientConnect={<ClientConnectCard />}
              />
            )
          )}

          {activeTab === "inbox" && <BusinessInboxPanel businessId={businessId} />}
          {activeTab === "messaging" && <MessagingStudio businessId={businessId} />}
          {activeTab === "marketing" && <MarketingControlCenter businessId={businessId} />}
          {activeTab === "agents" && (
            <AgentsTab agents={agents} isLoading={agentsLoading} isError={agentsIsError} error={agentsError} onRetry={refetchAgents} canManageCompany={canManageCompany} businessId={businessId} />
          )}
          {activeTab === "reports" && (
            <ReportsTab billingData={billingData} creditsData={creditsData} auditData={auditData} paymentHistory={paymentHistory} />
          )}
          {activeTab === "api" && <ApiTab billingData={billingData} />}
          {activeTab === "settings" && <SettingsTab organization={user?.organization} user={user} canManageCompany={canManageCompany} />}
        </div>
      </main>
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
              <Clock className="w-8 h-8 text-amber-600 dark:text-amber-400" />
            </div>
            
            <h2 className="text-xl font-semibold mb-2">Pending Approval</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Your company <span className="font-medium text-foreground">{user?.organization?.name}</span> is awaiting admin approval.
            </p>
            
            <div className="p-4 rounded-lg bg-muted/50 text-left mb-4">
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
                        : "border-border hover:border-border text-muted-foreground"
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
                <Check className="w-4 h-4 text-green-600 dark:text-green-400" />
                <span className="text-sm font-medium text-green-600 dark:text-green-400">Session Ready</span>
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

export function AgentsTab({ agents, isLoading, isError, error, onRetry, canManageCompany, businessId }: { agents: any; isLoading: boolean; isError?: boolean; error?: unknown; onRetry?: () => void; canManageCompany: boolean; businessId: number }) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [businessAccessAgent, setBusinessAccessAgent] = useState<any | null>(null);
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
  if (isError) return <div className="max-w-md mx-auto py-8"><QueryErrorState error={error} onRetry={() => onRetry?.()} label="your team members" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-bold">Team Members</h2>
        {/* These actions all require company_admin server-side (requireCompanyAdminOrAbove) --
            previously shown to every viewer of this tab, including plain "agent" role users,
            who would see a working-looking button that 403s on click. Gated client-side now,
            though the backend check remains the real, authoritative boundary. */}
        {canManageCompany && (
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
        )}
      </div>

      {showAddForm && canManageCompany && (
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
          {(agents?.agents?.length ?? 0) === 0 && (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No team members yet.
            </div>
          )}
          {agents?.agents?.map((agent: any) => (
            <div key={agent.id} className="p-4 border-b last:border-0 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="font-bold truncate">{agent.username || agent.email}</p>
                <p className="text-xs text-muted-foreground truncate">{agent.email} • {agent.role}</p>
                {(agent.permissions?.length ?? 0) > 0 && (
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    <Lock className="w-3 h-3" /> {agent.permissions.length} business permission{agent.permissions.length === 1 ? "" : "s"} granted
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant={agent.isActive ? "default" : "secondary"}>{agent.isActive ? "Active" : "Inactive"}</Badge>
                {canManageCompany && (
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid={`button-business-access-${agent.id}`}
                    onClick={() => setBusinessAccessAgent(agent)}
                  >
                    <ShieldCheck className="w-4 h-4 mr-1" /> Business Access
                  </Button>
                )}
                {canManageCompany && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={updateAgentStatusMutation.isPending}
                    onClick={() => updateAgentStatusMutation.mutate({ agentId: agent.id, isActive: !agent.isActive })}
                  >
                    {agent.isActive ? "Deactivate" : "Activate"}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {businessAccessAgent && (
        <BusinessAccessDialog
          agent={businessAccessAgent}
          businessId={businessId}
          onClose={() => setBusinessAccessAgent(null)}
        />
      )}
    </div>
  );
}

interface GrantablePermissionsResponse {
  permissions: string[];
}

/**
 * P0-5 UI: grants Business-platform permissions (customers/audiences/
 * templates/campaigns/OTP/utility/messaging) to a team member, via the
 * narrowly-scoped backend endpoint added in server/business-rbac-routes.ts.
 *
 * Security notes (see Phase 2 review):
 * - businessId always comes from the caller's own organization (passed down
 *   from CompanyDashboard's useAuth() user, never editable here).
 * - The checkbox list is fetched live from GET .../rbac/grantable-permissions
 *   rather than hardcoded, so it can never drift from the backend allow-list.
 * - This dialog only ADDS permissions (matches the backend's merge-not-
 *   overwrite behavior) -- there is no revoke action, because the backend
 *   has no revoke endpoint; not faking one here.
 * - A confirmation step (AlertDialog) sits between "Save" and the actual
 *   mutation, since this is a security-sensitive action.
 * - Any 401/403 from the backend surfaces via the existing toast pattern,
 *   not swallowed.
 */
export function BusinessAccessDialog({ agent, businessId, onClose }: { agent: any; businessId: number; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const currentPermissions: string[] = agent.permissions ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set(currentPermissions));
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data: grantable, isLoading: grantableLoading, isError: grantableIsError, error: grantableError, refetch: refetchGrantable } = useQuery<GrantablePermissionsResponse>({
    queryKey: ["/api/business/rbac/grantable-permissions", businessId],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch(`/api/business/${businessId}/rbac/grantable-permissions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load grantable permissions");
      return res.json();
    },
    enabled: businessId > 0,
  });

  const grantMutation = useMutation({
    mutationFn: async () => {
      const token = getAuthToken();
      const res = await fetch(`/api/business/${businessId}/rbac/grant-business-access`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userId: agent.id, permissions: newlySelected }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to update business access");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/agents"] });
      toast({ title: "Business access updated", description: `Permissions saved for ${agent.username || agent.email}.` });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Couldn't update business access", description: err.message, variant: "destructive" });
    },
  });

  const groups = new Map<string, { key: string; label: string }[]>();
  for (const key of grantable?.permissions ?? []) {
    const meta = BUSINESS_PERMISSION_LABELS[key] ?? { label: key, group: "Other" };
    if (!groups.has(meta.group)) groups.set(meta.group, []);
    groups.get(meta.group)!.push({ key, label: meta.label });
  }

  // Already-granted permissions are locked ON, not just pre-checked: the
  // backend grant endpoint only merges/adds (server/business-rbac-routes.ts
  // has no revoke path), so unchecking one here would submit successfully
  // but silently have no effect -- that's a worse, misleading interaction
  // than not offering it at all. Only NEW selections count as a change.
  const newlySelected = Array.from(selected).filter((p) => !currentPermissions.includes(p));
  const hasChanges = newlySelected.length > 0;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg" data-testid="dialog-business-access">
        <DialogHeader>
          <DialogTitle>Business Access — {agent.username || agent.email}</DialogTitle>
          <DialogDescription>
            Grant access to Business-platform features (customers, audiences, templates, campaigns, OTP, utility, business messaging). Existing permissions are preserved; this only adds new ones.
          </DialogDescription>
        </DialogHeader>

        {grantableLoading && (
          <div className="py-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></div>
        )}
        {grantableIsError && (
          <div className="py-4"><QueryErrorState error={grantableError} onRetry={() => refetchGrantable()} label="grantable permissions" /></div>
        )}
        {!grantableLoading && !grantableIsError && groups.size === 0 && (
          <p className="text-sm text-muted-foreground py-4">No grantable permissions are configured.</p>
        )}

        {!grantableLoading && !grantableIsError && groups.size > 0 && (
          <div className="space-y-4 max-h-80 overflow-y-auto pr-1">
            {Array.from(groups.entries()).map(([group, perms]) => (
              <div key={group}>
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">{group}</p>
                <div className="space-y-2">
                  {perms.map(({ key, label }) => {
                    const alreadyGranted = currentPermissions.includes(key);
                    return (
                      <label
                        key={key}
                        className={`flex items-center gap-2 text-sm ${alreadyGranted ? "text-muted-foreground" : "cursor-pointer"}`}
                        data-testid={`checkbox-permission-${key}`}
                      >
                        <Checkbox
                          checked={selected.has(key)}
                          disabled={alreadyGranted}
                          onCheckedChange={(checked) => {
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (checked) next.add(key); else next.delete(key);
                              return next;
                            });
                          }}
                        />
                        {label}
                        {alreadyGranted && <span className="text-xs">(already granted)</span>}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={grantMutation.isPending}>Cancel</Button>
          <Button
            onClick={() => setConfirmOpen(true)}
            disabled={!hasChanges || grantMutation.isPending || grantableLoading}
            data-testid="button-save-business-access"
          >
            {grantMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm business access change</AlertDialogTitle>
            <AlertDialogDescription>
              This will grant {agent.username || agent.email} access to {newlySelected.length} new Business-platform permission{newlySelected.length === 1 ? "" : "s"}. Existing permissions are unaffected. This action is logged in the business audit trail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmOpen(false); grantMutation.mutate(); }}>
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
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
              <div key={payment.id} className="rounded-xl border border-border bg-muted/50 p-3">
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
                  <p className="mt-2 text-xs text-red-600 dark:text-red-400">{payment.failureReason}</p>
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

  // Keys are stored hashed: the full key is shown once, right after creating it.
  const { data: apiKeyData, isLoading: keyLoading } = useQuery<{ keys: Array<{ id: number; keyPrefix: string; name: string; status: string; lastUsedAt: string | null; createdAt: string }> }>({
    queryKey: ["/api/company/api-key"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/company/api-key", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { keys: [] };
      return res.json();
    },
  });
  const [newKey, setNewKey] = useState<string | null>(null);

  const generateKeyMutation = useMutation({
    mutationFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/company/api-key/generate", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("Failed to create key");
      return res.json();
    },
    onSuccess: (data: { key: string }) => {
      setNewKey(data.key);
      setShowKey(true);
      queryClient.invalidateQueries({ queryKey: ["/api/company/api-key"] });
      toast({ title: "API key created", description: "Copy it now. NeuraTalk activates it after a quick check." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const apiKey = newKey || "";
  const billing = billingData?.data;
  const keys = apiKeyData?.keys ?? [];
  const maskedKey = apiKey ? `${apiKey.slice(0, 12)}••••••••${apiKey.slice(-6)}` : keys.length ? "Full key shown only once — create a new one if you lost it" : "No API key yet";

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
              Create API key
            </Button>
            <Link href="/api-docs">
              <Button size="sm" variant="outline">
                <ExternalLink className="w-4 h-4 mr-2" />
                Open API Docs
              </Button>
            </Link>
          </div>
          {keys.length > 0 && (
            <div className="space-y-1 text-sm" data-testid="list-api-keys">
              {keys.map((k) => (
                <div key={k.id} className="flex flex-wrap items-center gap-2">
                  <code className="text-xs">{k.keyPrefix}…</code>
                  <span>{k.name}</span>
                  <Badge variant={k.status === "active" ? "default" : "outline"} className="capitalize">
                    {k.status === "pending" ? "Waiting for NeuraTalk" : k.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    created {new Date(k.createdAt).toLocaleDateString()}{k.lastUsedAt ? ` · last used ${new Date(k.lastUsedAt).toLocaleDateString()}` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <MessageWebhooksCard />

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

const MESSAGE_WEBHOOK_EVENTS: Array<{ id: string; label: string }> = [
  { id: "message.received", label: "A customer wrote to you" },
  { id: "message.sent", label: "Your message was sent" },
  { id: "message.delivered", label: "Delivered to the customer's phone" },
  { id: "message.read", label: "The customer read it" },
  { id: "message.failed", label: "Could not be delivered" },
];

/** Your server gets told about message events (signed with a secret). */
function MessageWebhooksCard() {
  const { user } = useAuth();
  const orgId = (user as { organizationId?: number } | null)?.organizationId;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(MESSAGE_WEBHOOK_EVENTS.map((e) => e.id));
  const [secret, setSecret] = useState<string | null>(null);
  const key = ["/api/admin/orgs", orgId, "webhooks"];

  const { data } = useQuery<{ webhooks?: Array<{ id: number; url: string; subscribedEvents: string[]; isActive: boolean }> }>({
    queryKey: key,
    enabled: !!orgId,
    queryFn: async () => {
      const res = await fetch(`/api/admin/orgs/${orgId}/webhooks`, { headers: { Authorization: `Bearer ${getAuthToken()}` } });
      return res.ok ? res.json() : { webhooks: [] };
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/orgs/${orgId}/webhooks`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken()}` },
        body: JSON.stringify({ url, subscribedEvents: events }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Could not add the webhook. Use an https:// address.");
      return body;
    },
    onSuccess: (body) => {
      setSecret(body.webhook?.signingSecret || body.webhook?.secret || null);
      setUrl("");
      queryClient.invalidateQueries({ queryKey: key });
      toast({ title: "Webhook added", description: "Copy the signing secret now — it is shown once." });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/admin/orgs/${orgId}/webhooks/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${getAuthToken()}` } });
      if (!res.ok) throw new Error("Could not remove it");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  const hooks = data?.webhooks ?? [];
  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="text-sm font-display font-bold flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          Message webhooks
        </CardTitle>
        <CardDescription>
          NeuraTalk calls your server when a customer writes to you or a message is delivered or read. Each call is signed
          (X-NeuraTalk-Signature, HMAC-SHA256 with your secret). See the API docs for an example.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input placeholder="https://your-server.com/neuratalk/webhook" value={url} onChange={(e) => setUrl(e.target.value)} data-testid="input-webhook-url" />
          <Button size="sm" disabled={!url.startsWith("https://") || events.length === 0 || create.isPending} onClick={() => create.mutate()}>
            Add webhook
          </Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {MESSAGE_WEBHOOK_EVENTS.map((e) => (
            <label key={e.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={events.includes(e.id)}
                onChange={(ev) => setEvents((cur) => (ev.target.checked ? [...cur, e.id] : cur.filter((x) => x !== e.id)))}
              />
              {e.label} <code className="text-xs text-muted-foreground">{e.id}</code>
            </label>
          ))}
        </div>
        {secret && (
          <div className="rounded border border-primary/40 bg-primary/5 p-3 text-sm">
            Signing secret (shown once): <code className="break-all">{secret}</code>
          </div>
        )}
        {hooks.length > 0 && (
          <div className="space-y-2">
            {hooks.map((h) => (
              <div key={h.id} className="flex flex-wrap items-center gap-2 rounded border p-2 text-sm">
                <code className="break-all">{h.url}</code>
                <Badge variant={h.isActive ? "default" : "outline"}>{h.isActive ? "On" : "Off"}</Badge>
                <span className="text-xs text-muted-foreground">{(h.subscribedEvents ?? []).length} events</span>
                <Button size="sm" variant="ghost" className="ml-auto text-destructive" onClick={() => remove.mutate(h.id)}>Remove</Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface BusinessProfileData {
  id: number;
  name: string;
  legalBusinessName: string | null;
  description: string | null;
  industry: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressCountry: string | null;
  addressPostalCode: string | null;
  logoUrl: string | null;
  status: string | null;
}
interface BusinessBrandingData {
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
}

function SettingsTab({ organization, user, canManageCompany }: { organization: any; user: any; canManageCompany: boolean }) {
  const businessId = organization?.id;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { uploadFile, isUploading } = useUpload();

  const { data: profileData, isLoading: profileLoading, error: profileError } = useQuery<{ success: boolean; profile: BusinessProfileData }>({
    queryKey: ["/api/business", businessId, "profile"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch(`/api/business/${businessId}/profile`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed to load business profile");
      return res.json();
    },
    enabled: !!businessId,
  });

  const { data: brandingData } = useQuery<{ success: boolean; branding: BusinessBrandingData }>({
    queryKey: ["/api/business", businessId, "branding"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch(`/api/business/${businessId}/branding`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed to load branding");
      return res.json();
    },
    enabled: !!businessId,
  });

  const [form, setForm] = useState<Partial<BusinessProfileData>>({});
  const [brandingForm, setBrandingForm] = useState<BusinessBrandingData>({});

  useEffect(() => {
    if (profileData?.profile) setForm(profileData.profile);
  }, [profileData]);
  useEffect(() => {
    if (brandingData?.branding) setBrandingForm(brandingData.branding);
  }, [brandingData]);

  const profileMutation = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const token = getAuthToken();
      const res = await fetch(`/api/business/${businessId}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed to save profile");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/business", businessId, "profile"] });
      toast({ title: "Profile saved" });
    },
    onError: (err: any) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const brandingMutation = useMutation({
    mutationFn: async (patch: BusinessBrandingData) => {
      const token = getAuthToken();
      const res = await fetch(`/api/business/${businessId}/branding`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed to save branding");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/business", businessId, "branding"] });
      toast({ title: "Branding saved" });
    },
    onError: (err: any) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const setLogoMutation = useMutation({
    mutationFn: async (objectPath: string) => {
      const token = getAuthToken();
      const res = await fetch(`/api/business/${businessId}/branding/logo`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ objectPath }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed to set logo");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/business", businessId, "profile"] });
      toast({ title: "Logo updated" });
    },
    onError: (err: any) => toast({ title: "Logo upload failed", description: err.message, variant: "destructive" }),
  });

  const removeLogoMutation = useMutation({
    mutationFn: async () => {
      const token = getAuthToken();
      const res = await fetch(`/api/business/${businessId}/branding/logo`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed to remove logo");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/business", businessId, "profile"] });
      toast({ title: "Logo removed" });
    },
    onError: (err: any) => toast({ title: "Failed to remove logo", description: err.message, variant: "destructive" }),
  });

  const handleLogoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
      toast({ title: "Unsupported file type", description: "Logo must be a JPEG, PNG, WebP, or GIF image.", variant: "destructive" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "File too large", description: "Logo must be under 5MB.", variant: "destructive" });
      return;
    }
    const result = await uploadFile(file);
    if (result) setLogoMutation.mutate(result.objectPath);
    e.target.value = "";
  };

  if (!canManageCompany) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm">Organization Settings</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div><label className="text-xs text-muted-foreground">Name</label><p className="font-bold">{organization?.name}</p></div>
          <div><label className="text-xs text-muted-foreground">Status</label><Badge>{organization?.status}</Badge></div>
          <div><label className="text-xs text-muted-foreground">Your Role</label><p className="font-bold">{user?.role || "unknown"}</p></div>
          <div>
            <label className="text-xs text-muted-foreground">Access Scope</label>
            <p className="text-sm text-muted-foreground">Operational access only. Business Profile and Branding are restricted to company admins.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (profileLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }
  if (profileError) {
    return <QueryErrorState error={profileError} label="business profile" onRetry={() => queryClient.invalidateQueries({ queryKey: ["/api/business", businessId, "profile"] })} />;
  }

  const field = (key: keyof BusinessProfileData, label: string, placeholder?: string) => (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <Input
        value={(form[key] as string) ?? ""}
        placeholder={placeholder}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        data-testid={`input-profile-${key}`}
      />
    </div>
  );

  const colorField = (key: keyof BusinessBrandingData, label: string) => (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={brandingForm[key] || "#000000"}
          onChange={(e) => setBrandingForm((b) => ({ ...b, [key]: e.target.value }))}
          className="h-9 w-12 rounded border border-border bg-transparent"
          data-testid={`input-branding-${key}`}
        />
        <Input
          value={brandingForm[key] ?? ""}
          placeholder="#1a2b3c"
          onChange={(e) => setBrandingForm((b) => ({ ...b, [key]: e.target.value }))}
          className="w-32"
        />
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Business Profile</CardTitle>
          <CardDescription>Who is this business? Shown to your team and used across billing, invoices, and support.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {field("name", "Display / Business Name")}
            {field("legalBusinessName", "Legal Business Name")}
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Description</label>
            <textarea
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              rows={3}
              value={form.description ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              data-testid="input-profile-description"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {field("industry", "Business Category / Industry")}
            {field("website", "Website", "https://")}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {field("email", "Support / Contact Email")}
            {field("phone", "Support / Contact Phone")}
          </div>
          <div>{field("address", "Address")}</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {field("addressCity", "City")}
            {field("addressState", "State")}
            {field("addressCountry", "Country")}
            {field("addressPostalCode", "Postal Code")}
          </div>
          <div className="flex items-center gap-2 pt-2">
            <Button
              size="sm"
              disabled={profileMutation.isPending}
              onClick={() => profileMutation.mutate(form)}
              data-testid="button-save-profile"
            >
              {profileMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              Save Profile
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setForm(profileData?.profile ?? {})}>Cancel</Button>
            <Badge variant="outline">{organization?.status}</Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Branding</CardTitle>
          <CardDescription>How does this business appear? Logo and brand colors used in your admin UI.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-xs text-muted-foreground">Logo</label>
            <div className="flex items-center gap-3 mt-1">
              {form.logoUrl ? (
                <img src={form.logoUrl} alt="Business logo" className="w-14 h-14 rounded object-cover border border-border" />
              ) : (
                <div className="w-14 h-14 rounded border border-dashed border-border flex items-center justify-center text-muted-foreground">
                  <Building2 className="w-6 h-6" />
                </div>
              )}
              <div className="flex gap-2">
                <label className={isUploading || setLogoMutation.isPending ? "pointer-events-none opacity-60" : undefined}>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    onChange={handleLogoFile}
                    disabled={isUploading || setLogoMutation.isPending}
                    data-testid="input-logo-file"
                  />
                  <span className="inline-flex items-center h-9 px-3 rounded-md border border-border text-sm cursor-pointer hover:bg-muted">
                    {isUploading || setLogoMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                    {form.logoUrl ? "Replace" : "Upload"} Logo
                  </span>
                </label>
                {form.logoUrl && (
                  <Button size="sm" variant="ghost" disabled={removeLogoMutation.isPending} onClick={() => removeLogoMutation.mutate()} data-testid="button-remove-logo">
                    Remove
                  </Button>
                )}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {colorField("primaryColor", "Primary Color")}
            {colorField("secondaryColor", "Secondary Color")}
            {colorField("accentColor", "Accent Color")}
          </div>
          <div className="flex items-center gap-2 pt-2">
            <Button
              size="sm"
              disabled={brandingMutation.isPending}
              onClick={() => brandingMutation.mutate(brandingForm)}
              data-testid="button-save-branding"
            >
              {brandingMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              Save Branding
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setBrandingForm(brandingData?.branding ?? {})}>Cancel</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Access</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div><label className="text-xs text-muted-foreground">Your Role</label><p className="font-bold">{user?.role || "unknown"}</p></div>
          <p className="text-sm text-muted-foreground">Full company admin access for billing, API keys, team management, and audit review.</p>
        </CardContent>
      </Card>
    </div>
  );
}
