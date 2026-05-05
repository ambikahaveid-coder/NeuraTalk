import { useState } from "react";
import { Link } from "wouter";
import { useAuth, getAuthToken } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sparkles, LogOut, Users, CreditCard, BarChart3, Phone,
  Settings, Building2, Activity, Shield, Clock, FileText,
  Download, Filter, Search, TrendingUp, TrendingDown, Globe,
  Lock, Bell, Palette, Database, CheckCircle, AlertCircle,
  Video, Mic, Languages, ChartLine, PieChart, Calendar,
  UserPlus, Mail, Smartphone, Eye, RefreshCw, History, ArrowDownUp
} from "lucide-react";

type Tab = "analytics" | "team" | "audit" | "settings" | "recordings" | "credits";

export default function EnterpriseDashboard() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("analytics");
  const { toast } = useToast();

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "analytics", label: "Analytics", icon: <BarChart3 className="w-4 h-4" /> },
    { id: "credits", label: "Credit Ledger", icon: <ArrowDownUp className="w-4 h-4" /> },
    { id: "team", label: "Team Management", icon: <Users className="w-4 h-4" /> },
    { id: "audit", label: "Audit Logs", icon: <History className="w-4 h-4" /> },
    { id: "recordings", label: "Recordings", icon: <Video className="w-4 h-4" /> },
    { id: "settings", label: "Enterprise Settings", icon: <Settings className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen mesh-bg text-foreground overflow-hidden flex flex-col font-sans">
      <header className="border-b border-white/10 bg-black/40 backdrop-blur-2xl sticky top-0 z-50">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/enterprise">
              <div className="flex items-center gap-2 cursor-pointer hover:opacity-80">
                <Sparkles className="w-5 h-5 text-primary" />
                <span className="font-bold">NeuraTalk</span>
              </div>
            </Link>
            <Badge className="text-xs hidden sm:flex bg-gradient-to-r from-amber-500 to-orange-500">
              <Building2 className="w-3 h-3 mr-1" />
              Enterprise
            </Badge>
            <nav className="hidden md:flex items-center gap-1">
              <Link href="/call">
                <Button variant="ghost" size="sm" className="gap-1" data-testid="link-call">
                  <Phone className="w-4 h-4" />
                  Call Center
                </Button>
              </Link>
              <Link href="/api-docs">
                <Button variant="ghost" size="sm" className="gap-1" data-testid="link-api-docs">
                  <FileText className="w-4 h-4" />
                  API
                </Button>
              </Link>
            </nav>
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

      <div className="container mx-auto px-4 py-6">
        <div className="flex gap-2 mb-8 overflow-x-auto pb-2 scrollbar-none">
          {tabs.map((tab) => (
            <Button
              key={tab.id}
              variant={activeTab === tab.id ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 font-bold transition-all px-4 ${
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

        {activeTab === "analytics" && <AnalyticsTab />}
        {activeTab === "credits" && <CreditLedgerTab />}
        {activeTab === "team" && <TeamManagementTab />}
        {activeTab === "audit" && <AuditLogsTab />}
        {activeTab === "recordings" && <RecordingsTab />}
        {activeTab === "settings" && <EnterpriseSettingsTab />}
      </div>
    </div>
  );
}

function AnalyticsTab() {
  const [dateRange, setDateRange] = useState("7d");
  
  const { data: analytics, isLoading } = useQuery({
    queryKey: ["/api/enterprise/analytics", dateRange],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch(`/api/enterprise/analytics?range=${dateRange}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        // Return honest empty state, not fake data
        return {
          totalCalls: 0,
          totalMinutes: 0,
          translationMinutes: 0,
          activeUsers: 0,
          callsToday: 0,
          avgCallDuration: 0,
          topLanguages: [{ language: "No data yet", calls: 0, percentage: 100 }],
          callsByDay: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => ({ day: d, calls: 0 })),
          emotionBreakdown: [
            { emotion: "No calls yet", percentage: 100 },
          ],
        };
      }
      return res.json();
    },
  });

  const stats = [
    { label: "Total Calls", value: analytics?.totalCalls?.toLocaleString() || "0", icon: Phone, trend: "+12%", up: true },
    { label: "Total Minutes", value: analytics?.totalMinutes?.toLocaleString() || "0", icon: Clock, trend: "+8%", up: true },
    { label: "Translation Minutes", value: analytics?.translationMinutes?.toLocaleString() || "0", icon: Languages, trend: "+23%", up: true },
    { label: "Active Users", value: analytics?.activeUsers?.toString() || "0", icon: Users, trend: "+5%", up: true },
    { label: "Calls Today", value: analytics?.callsToday?.toString() || "0", icon: TrendingUp, trend: "+15%", up: true },
    { label: "Avg Duration", value: `${analytics?.avgCallDuration || 0} min`, icon: Activity, trend: "-2%", up: false },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-display font-bold tracking-tight">Enterprise Intelligence</h2>
          <p className="text-sm text-primary/70 font-medium uppercase tracking-widest">Global Analytics & QoS Monitoring</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-32" data-testid="select-date-range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24h">Last 24h</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" data-testid="button-export" disabled title="Export is not wired on this screen yet">
            <Download className="w-4 h-4" />
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Export from this dashboard is disabled in the current environment. Use the supported admin reporting workflow when export is enabled.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.05 }}
          >
            <Card className="glass-card hover-elevate border-primary/10 overflow-hidden shine-effect" data-testid={`stat-${stat.label.toLowerCase().replace(/\s/g, '-')}`}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="p-1.5 rounded-md bg-primary/10">
                    <stat.icon className="w-4 h-4 text-primary" />
                  </div>
                  <Badge variant={stat.up ? "default" : "destructive"} className="text-[10px] h-5">
                    {stat.up ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                    {stat.trend}
                  </Badge>
                </div>
                <div className="text-2xl font-display font-bold tabular-nums">{stat.value}</div>
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{stat.label}</div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ChartLine className="w-5 h-5" />
              Calls by Day
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end justify-between h-40 gap-2">
              {analytics?.callsByDay?.map((day: { day: string; calls: number }, i: number) => (
                <div key={day.day} className="flex-1 flex flex-col items-center gap-1">
                  <div 
                    className="w-full bg-primary/20 rounded-t transition-all hover:bg-primary/40"
                    style={{ height: `${(day.calls / 250) * 100}%` }}
                  />
                  <span className="text-xs text-muted-foreground">{day.day}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="w-5 h-5" />
              Top Languages
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {analytics?.topLanguages?.map((lang: { language: string; calls: number; percentage: number }) => (
                <div key={lang.language} className="flex items-center gap-3">
                  <div className="w-20 text-sm">{lang.language}</div>
                  <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
                    <motion.div 
                      className="h-full bg-primary"
                      initial={{ width: 0 }}
                      animate={{ width: `${lang.percentage}%` }}
                      transition={{ duration: 0.5 }}
                    />
                  </div>
                  <div className="w-12 text-sm text-right text-muted-foreground">{lang.percentage}%</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PieChart className="w-5 h-5" />
              Emotion Analysis
            </CardTitle>
            <CardDescription>Caller emotional state distribution</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {analytics?.emotionBreakdown?.map((emotion: { emotion: string; percentage: number }) => (
                <div key={emotion.emotion} className="flex items-center gap-2 p-2 rounded-lg bg-secondary/50">
                  <div className="w-3 h-3 rounded-full bg-primary" />
                  <span className="text-sm">{emotion.emotion}</span>
                  <span className="ml-auto text-sm font-medium">{emotion.percentage}%</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5" />
              System Health
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SystemHealthPanel />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function TeamManagementTab() {
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");

  const { data: team, isLoading } = useQuery({
    queryKey: ["/api/enterprise/team"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/enterprise/team", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        return {
          members: [],
          stats: { total: 0, active: 0, admins: 0, managers: 0, agents: 0 },
        };
      }
      return res.json();
    },
  });

  const filteredMembers = team?.members?.filter((member: any) => {
    const matchesSearch = member.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         member.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole = roleFilter === "all" || member.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Team Management</h2>
          <p className="text-muted-foreground">Manage team members and their access</p>
        </div>
        <div className="text-right">
          <Button className="gap-2" data-testid="button-invite-member" disabled title="Team invitation is handled in company admin workflows">
            <UserPlus className="w-4 h-4" />
            Invite Member
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            Team invites are handled in the dedicated company admin workflow, not from this enterprise summary page.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: "Total Members", value: team?.stats?.total || 0, color: "text-foreground" },
          { label: "Active Now", value: team?.stats?.active || 0, color: "text-green-400" },
          { label: "Admins", value: team?.stats?.admins || 0, color: "text-primary" },
          { label: "Managers", value: team?.stats?.managers || 0, color: "text-secondary" },
          { label: "Agents", value: team?.stats?.agents || 0, color: "text-muted-foreground" },
        ].map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
          >
            <Card className="glass-card shadow-none" data-testid={`stat-${s.label.toLowerCase().replace(/\s/g, '-')}`}>
              <CardContent className="p-4 text-center">
                <div className={`text-3xl font-display font-bold ${s.color}`}>{s.value}</div>
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-1">{s.label}</div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <Card className="glass-card">
        <CardHeader className="border-b border-white/5">
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary" />
              <Input
                placeholder="Search command center..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-white/5 border-white/5"
                data-testid="input-search-members"
              />
            </div>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-40" data-testid="select-role-filter">
                <SelectValue placeholder="Filter by role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Roles</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="manager">Manager</SelectItem>
                <SelectItem value="agent">Agent</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {filteredMembers?.map((member: any, i: number) => (
              <motion.div
                key={member.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 + (i % 10) * 0.03 }}
                className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-all border border-transparent hover:border-white/5 group"
                data-testid={`member-${member.id}`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                    <span className="font-medium">{member.name.charAt(0)}</span>
                  </div>
                  <div>
                    <div className="font-medium">{member.name}</div>
                    <div className="text-sm text-muted-foreground">{member.email}</div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right hidden sm:block">
                    <div className="text-sm">{member.department}</div>
                    <div className="text-xs text-muted-foreground">{member.calls} calls</div>
                  </div>
                  <Badge variant={member.role === "admin" ? "destructive" : member.role === "manager" ? "default" : "secondary"}>
                    {member.role}
                  </Badge>
                  <div className="flex items-center gap-1">
                    <div className={`w-2 h-2 rounded-full ${member.status === "active" ? "bg-green-500" : "bg-gray-400"}`} />
                    <span className="text-xs text-muted-foreground hidden md:block">{member.lastActive}</span>
                  </div>
                  <Button variant="ghost" size="icon" data-testid={`button-edit-${member.id}`}>
                    <Settings className="w-4 h-4" />
                  </Button>
                </div>
              </motion.div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AuditLogsTab() {
  const [actionFilter, setActionFilter] = useState("all");

  const { data: logs, isLoading } = useQuery({
    queryKey: ["/api/enterprise/audit-logs"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/enterprise/audit-logs", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        return { logs: [] };
      }
      return res.json();
    },
  });

  const getActionIcon = (action: string) => {
    switch (action) {
      case "login": return <Eye className="w-4 h-4" />;
      case "settings_change": return <Settings className="w-4 h-4" />;
      case "create": return <UserPlus className="w-4 h-4" />;
      case "update": return <RefreshCw className="w-4 h-4" />;
      case "delete": return <AlertCircle className="w-4 h-4" />;
      case "credit_adjustment": return <CreditCard className="w-4 h-4" />;
      case "approve": return <CheckCircle className="w-4 h-4" />;
      default: return <Activity className="w-4 h-4" />;
    }
  };

  const filteredLogs = actionFilter === "all" 
    ? logs?.logs 
    : logs?.logs?.filter((log: any) => log.action === actionFilter);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {[
          { label: "Total Events", value: logs?.logs?.length || 0, icon: Activity },
          { label: "User Actions", value: logs?.logs?.filter((l: any) => l.user !== "System").length || 0, icon: Users },
          { label: "System Events", value: logs?.logs?.filter((l: any) => l.user === "System").length || 0, icon: Settings },
        ].map((s, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
             <Card className="glass-card">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <div className="text-2xl font-display font-bold">{s.value}</div>
                  <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{s.label}</div>
                </div>
                <s.icon className="w-5 h-5 text-primary/40" />
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <Card className="glass-card">
        <CardContent className="p-0">
          <div className="divide-y divide-white/5">
            {filteredLogs?.map((log: any, i: number) => (
              <motion.div
                key={log.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: (i % 10) * 0.03 }}
                className="flex items-center justify-between p-4 bg-white/0 hover:bg-white/5 transition-all group"
                data-testid={`log-${log.id}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${log.status === "success" ? "bg-green-500/10" : "bg-red-500/10"}`}>
                    {getActionIcon(log.action)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{log.user}</span>
                      <Badge variant="outline" className="text-xs">{log.action}</Badge>
                    </div>
                    <div className="text-sm text-muted-foreground">{log.resource}</div>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-right">
                  <div className="hidden sm:block">
                    <div className="text-xs text-muted-foreground">{log.ip}</div>
                    <div className="text-xs text-muted-foreground">{log.timestamp}</div>
                  </div>
                  <Badge variant={log.status === "success" ? "default" : "destructive"}>
                    {log.status}
                  </Badge>
                </div>
              </motion.div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RecordingsTab() {
  const { data: recordings, isLoading } = useQuery({
    queryKey: ["/api/enterprise/recordings"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/enterprise/recordings", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        return {
          recordings: [],
          stats: { total: 0, thisMonth: 0, storage: "0 GB" },
        };
      }
      return res.json();
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Call Recordings</h2>
          <p className="text-muted-foreground font-medium">Global recording vault with encryption</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-6">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.1 }}>
          <Card className="glass-card overflow-hidden shine-effect">
            <CardContent className="p-6 text-center">
              <div className="p-3 rounded-xl bg-primary/10 w-fit mx-auto mb-4">
                <Video className="w-6 h-6 text-primary" />
              </div>
              <div className="text-3xl font-display font-bold">{recordings?.stats?.total || 0}</div>
              <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-1">Total Vaulted</div>
            </CardContent>
          </Card>
        </motion.div>
        
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.2 }}>
          <Card className="glass-card overflow-hidden shine-effect">
            <CardContent className="p-6 text-center">
              <div className="p-3 rounded-xl bg-secondary/10 w-fit mx-auto mb-4">
                <Calendar className="w-6 h-6 text-secondary" />
              </div>
              <div className="text-3xl font-display font-bold">{recordings?.stats?.thisMonth || 0}</div>
              <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-1">Acquired This Month</div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.3 }}>
          <Card className="glass-card overflow-hidden shine-effect">
            <CardContent className="p-6 text-center">
              <div className="p-3 rounded-xl bg-primary/10 w-fit mx-auto mb-4">
                <Database className="w-6 h-6 text-primary" />
              </div>
              <div className="text-3xl font-display font-bold">{recordings?.stats?.storage || "0 GB"}</div>
              <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-1">Encrypted Storage</div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <Card className="glass-card">
        <CardHeader className="border-b border-white/5">
          <CardTitle className="font-display font-bold">Secure Recording Vault</CardTitle>
          <CardDescription className="text-xs">End-to-end encrypted call data with mandatory consent</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-white/5">
            {recordings?.recordings?.map((rec: any, i: number) => (
              <motion.div
                key={rec.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: (i % 10) * 0.03 }}
                className="flex items-center justify-between p-4 bg-white/0 hover:bg-white/5 transition-all group"
                data-testid={`recording-${rec.id}`}
              >
                <div className="flex items-center gap-4">
                  <div className="p-2.5 rounded-xl bg-white/5 group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                    <Mic className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-display font-bold text-sm tracking-tight">{rec.callId}</div>
                    <div className="text-xs text-muted-foreground font-medium">
                      {rec.caller} <span className="text-primary/40 mx-1">→</span> {rec.receiver}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right hidden sm:block">
                    <Badge variant="outline" className="text-xs">{rec.language}</Badge>
                    <div className="text-xs text-muted-foreground mt-1">{rec.duration}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">{rec.timestamp}</div>
                    {rec.hasConsent ? (
                      <Badge variant="default" className="text-xs mt-1">
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Consent
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="text-xs mt-1">
                        No Consent
                      </Badge>
                    )}
                  </div>
                  <Button variant="ghost" size="icon">
                    <Eye className="w-4 h-4" />
                  </Button>
                </div>
              </motion.div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function EnterpriseSettingsTab() {
  const [brandingOpen, setBrandingOpen] = useState(true);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="mb-8">
        <h2 className="text-3xl font-display font-bold">Control Center</h2>
        <p className="text-sm text-primary/70 font-medium uppercase tracking-widest">Organization & Security Configuration</p>
      </div>

      <Card className="border-yellow-500/20 bg-yellow-500/5">
        <CardContent className="p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-yellow-500 mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">Read-only operational view</div>
            <p className="text-sm text-muted-foreground">
              This page now shows configuration posture only. Editing and deployment are not wired here yet, so controls are intentionally disabled to avoid false saves.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card className="glass-card">
          <CardHeader className="cursor-pointer border-b border-white/5" onClick={() => setBrandingOpen(!brandingOpen)}>
            <CardTitle className="flex items-center gap-3 font-display font-bold">
              <div className="p-2 rounded-lg bg-primary/10 text-primary">
                <Palette className="w-5 h-5" />
              </div>
              Branding & Appearance
            </CardTitle>
          </CardHeader>
          {brandingOpen && (
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Company Name</Label>
                  <Input value="" placeholder="Managed outside this screen" disabled data-testid="input-company-name" />
                </div>
                <div className="space-y-2">
                  <Label>Primary Color</Label>
                  <div className="flex items-center gap-2">
                    <Input type="color" value="#9ca3af" className="w-16 h-10" disabled data-testid="input-primary-color" />
                    <Input value="" placeholder="Managed outside this screen" className="flex-1" disabled />
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Logo URL</Label>
                <Input placeholder="Managed outside this screen" disabled data-testid="input-logo-url" />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>Custom Domain</Label>
                  <p className="text-sm text-muted-foreground">Use your own domain for white-label experience</p>
                </div>
                <Switch disabled data-testid="switch-custom-domain" />
              </div>
            </CardContent>
          )}
        </Card>

        <Card className="glass-card">
          <CardHeader className="cursor-pointer border-b border-white/5" onClick={() => setSecurityOpen(!securityOpen)}>
            <CardTitle className="flex items-center gap-3 font-display font-bold">
              <div className="p-2 rounded-lg bg-primary/10 text-primary">
                <Shield className="w-5 h-5" />
              </div>
              Security & Compliance
            </CardTitle>
          </CardHeader>
          {securityOpen && (
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Two-Factor Authentication</Label>
                  <p className="text-sm text-muted-foreground">Require 2FA for all team members</p>
                </div>
                <Switch checked disabled data-testid="switch-2fa" />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>SSO / SAML</Label>
                  <p className="text-sm text-muted-foreground">Enable single sign-on integration</p>
                </div>
                <Switch disabled data-testid="switch-sso" />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>IP Whitelisting</Label>
                  <p className="text-sm text-muted-foreground">Restrict access to specific IP ranges</p>
                </div>
                <Switch disabled data-testid="switch-ip-whitelist" />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>Data Encryption</Label>
                  <p className="text-sm text-muted-foreground">End-to-end encryption for all calls</p>
                </div>
                <Switch checked disabled data-testid="switch-encryption" />
              </div>
              <div className="space-y-2">
                <Label>Session Timeout</Label>
                <Select value="24h" disabled>
                  <SelectTrigger data-testid="select-session-timeout">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1h">1 hour</SelectItem>
                    <SelectItem value="4h">4 hours</SelectItem>
                    <SelectItem value="8h">8 hours</SelectItem>
                    <SelectItem value="24h">24 hours</SelectItem>
                    <SelectItem value="7d">7 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          )}
        </Card>

        <Card className="glass-card">
          <CardHeader className="cursor-pointer border-b border-white/5" onClick={() => setNotificationsOpen(!notificationsOpen)}>
            <CardTitle className="flex items-center gap-3 font-display font-bold">
              <div className="p-2 rounded-lg bg-primary/10 text-primary">
                <Bell className="w-5 h-5" />
              </div>
              Notifications & Alerts
            </CardTitle>
          </CardHeader>
          {notificationsOpen && (
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-muted-foreground" />
                  <Label className="font-medium">Email Intelligence Reports</Label>
                </div>
                <Switch checked disabled />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-muted-foreground" />
                  <Label className="font-medium">SMS Critical Alerts</Label>
                </div>
                <Switch disabled />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-muted-foreground" />
                  <Label className="font-medium">Real-time Usage Thresholds</Label>
                </div>
                <Switch checked disabled />
              </div>
            </CardContent>
          )}
        </Card>

        <div className="flex justify-end gap-3 pt-6 pb-12">
          <Button variant="outline" className="px-8 border-white/10 hover:bg-white/5" onClick={() => window.history.back()}>Cancel</Button>
          <Button className="px-8 shadow-lg shadow-primary/20 bg-primary text-primary-foreground font-bold" disabled title="Configuration editing is not wired on this screen">
            Configuration Editing Not Wired
          </Button>
        </div>
        <p className="text-xs text-muted-foreground text-right">
          These controls are visible for posture review only. Any writable enterprise configuration should be done through the supported backend-admin workflow.
        </p>
      </div>
    </div>
  );
}

function SystemHealthPanel() {
  const { data: healthData } = useQuery({
    queryKey: ["/readyz"],
    queryFn: async () => {
      const res = await fetch("/readyz");
      const payload = await res.json().catch(() => null);
      const checks = payload?.checks && typeof payload.checks === "object" ? payload.checks : {};
      const entries = Object.entries(checks) as Array<
        [string, { status?: string; latencyMs?: number; error?: string }]
      >;
      const serviceNames: Record<string, string> = {
        database: "Database",
        redis: "Redis",
        providers: "Provider Config",
        msg91: "MSG91 Bridge",
      };

      return {
        services: entries.map(([key, value]) => ({
          name: serviceNames[key] || key,
          status: value?.status === "healthy" ? "healthy" : value?.status === "unhealthy" ? "down" : "unknown",
          detail: typeof value?.latencyMs === "number"
            ? `${value.latencyMs}ms`
            : value?.error || "No probe detail",
        })),
      };
    },
    refetchInterval: 30000,
  });

  const services = healthData?.services || [];

  return (
    <div className="space-y-3">
      {services.length === 0 ? (
        <p className="text-sm text-muted-foreground">No live readiness data yet.</p>
      ) : services.map((service) => (
        <div key={service.name} className="flex items-center justify-between p-2 rounded-lg bg-secondary/30">
          <div className="flex items-center gap-2">
            {service.status === "healthy" ? (
              <CheckCircle className="w-4 h-4 text-green-500" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-500" />
            )}
            <span className="text-sm">{service.name}</span>
          </div>
          <Badge variant="outline" className="text-xs">{service.detail}</Badge>
        </div>
      ))}
    </div>
  );
}

function CreditLedgerTab() {
  const { data: credits, isLoading } = useQuery({
    queryKey: ["/api/credits/ledger"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/credits/ledger", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { balance: 0, transactions: [] };
      return res.json();
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Credit Ledger</h2>
        <p className="text-muted-foreground">Track credit usage and transactions</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="text-sm text-muted-foreground">Current Balance</div>
            <div className="text-3xl font-bold mt-1">{credits?.balance?.toLocaleString() || 0}</div>
            <div className="text-xs text-muted-foreground mt-1">credits remaining</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="text-sm text-muted-foreground">This Month Usage</div>
            <div className="text-3xl font-bold mt-1">
              {credits?.transactions?.filter((t: any) => t.type === "debit").reduce((sum: number, t: any) => sum + Math.abs(t.amount), 0)?.toLocaleString() || 0}
            </div>
            <div className="text-xs text-muted-foreground mt-1">credits used</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="text-sm text-muted-foreground">Transactions</div>
            <div className="text-3xl font-bold mt-1">{credits?.transactions?.length || 0}</div>
            <div className="text-xs text-muted-foreground mt-1">total entries</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Transaction History</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : !credits?.transactions?.length ? (
            <div className="text-center py-8 text-muted-foreground">No transactions yet</div>
          ) : (
            <div className="space-y-2">
              {credits.transactions.map((tx: any, i: number) => (
                <div key={tx.id || i} className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
                  <div>
                    <div className="text-sm font-medium">{tx.description || tx.type}</div>
                    <div className="text-xs text-muted-foreground">{tx.createdAt ? new Date(tx.createdAt).toLocaleDateString() : ""}</div>
                  </div>
                  <div className={`font-bold ${tx.amount > 0 ? "text-green-500" : "text-red-400"}`}>
                    {tx.amount > 0 ? "+" : ""}{tx.amount}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
