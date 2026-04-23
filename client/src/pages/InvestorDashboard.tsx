import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Users, 
  Building2, 
  TrendingUp, 
  Activity,
  LogOut,
  ArrowLeft,
  Sparkles,
  Globe,
  RefreshCw,
  CheckCircle,
  Clock,
  BarChart3,
  PieChart,
  Zap
} from "lucide-react";

interface PlatformMetrics {
  users: {
    total: number;
    consumers: number;
    companies: number;
    agents: number;
    recentSignups: number;
  };
  organizations: {
    total: number;
    active: number;
    pending: number;
    recentSignups: number;
  };
  growth: {
    userGrowthRate: number;
    orgGrowthRate: number;
  };
  platformHealth: {
    status: string;
    uptime: string;
    avgResponseTime: string;
  };
}

export default function InvestorDashboard() {
  const { user, token, logout } = useAuth();
  const [, setLocation] = useLocation();

  const { data: metricsData, isLoading, refetch } = useQuery<{ success: boolean; metrics: PlatformMetrics }>({
    queryKey: ["/api/investor/metrics"],
    queryFn: async () => {
      const res = await fetch("/api/investor/metrics", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch metrics");
      return res.json();
    },
    staleTime: 0,
    enabled: !!token,
  });

  useEffect(() => {
    if (user && user.role !== "investor" && user.role !== "super_admin") {
      setLocation("/");
    }
  }, [user, setLocation]);

  const handleLogout = async () => {
    await logout();
    setLocation("/investor/login");
  };

  const handleRefresh = () => {
    refetch();
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <Skeleton className="h-8 w-48 mx-auto" />
          <Skeleton className="h-4 w-64 mx-auto" />
        </div>
      </div>
    );
  }

  const metrics = metricsData?.metrics;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-white/10 bg-white/5 backdrop-blur-md sticky top-0 z-50">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/website">
              <Button variant="ghost" size="sm" className="gap-1" data-testid="link-website">
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Website</span>
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              <span className="font-bold hidden sm:block">Investor Portal</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1">
              <BarChart3 className="w-3 h-3" />
              {user.email}
            </Badge>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={handleLogout}
              data-testid="button-logout"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold" data-testid="text-page-title">
              Platform Analytics
            </h1>
            <p className="text-muted-foreground mt-1">
              Real-time insights into NeuraTalk's growth and performance
            </p>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleRefresh}
            className="gap-2"
            data-testid="button-refresh"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
        </div>

        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i}>
                <CardHeader className="pb-2">
                  <Skeleton className="h-4 w-24" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="h-3 w-32 mt-2" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : metrics ? (
          <div className="space-y-8">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card data-testid="card-total-users">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                  <CardTitle className="text-sm font-medium">Total Users</CardTitle>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{metrics.users.total}</div>
                  <p className="text-xs text-muted-foreground">
                    +{metrics.users.recentSignups} in last 30 days
                  </p>
                </CardContent>
              </Card>

              <Card data-testid="card-organizations">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                  <CardTitle className="text-sm font-medium">Organizations</CardTitle>
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{metrics.organizations.total}</div>
                  <p className="text-xs text-muted-foreground">
                    {metrics.organizations.active} active, {metrics.organizations.pending} pending
                  </p>
                </CardContent>
              </Card>

              <Card data-testid="card-user-growth">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                  <CardTitle className="text-sm font-medium">User Growth</CardTitle>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{metrics.growth.userGrowthRate}%</div>
                  <p className="text-xs text-muted-foreground">
                    30-day growth rate
                  </p>
                </CardContent>
              </Card>

              <Card data-testid="card-platform-health">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                  <CardTitle className="text-sm font-medium">Platform Status</CardTitle>
                  <Activity className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-green-500" />
                    <span className="text-lg font-semibold capitalize">
                      {metrics.platformHealth.status}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {metrics.platformHealth.uptime} uptime
                  </p>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <PieChart className="w-5 h-5" />
                    User Distribution
                  </CardTitle>
                  <CardDescription>Breakdown by user type</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-primary" />
                        <span>Consumers (B2C)</span>
                      </div>
                      <span className="font-semibold">{metrics.users.consumers}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-secondary" />
                        <span>Company Admins</span>
                      </div>
                      <span className="font-semibold">{metrics.users.companies}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-cyan-500" />
                        <span>Agents</span>
                      </div>
                      <span className="font-semibold">{metrics.users.agents}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Zap className="w-5 h-5" />
                    Platform Performance
                  </CardTitle>
                  <CardDescription>Key performance indicators</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Average Response Time</span>
                      <Badge variant="secondary">{metrics.platformHealth.avgResponseTime}</Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">System Uptime</span>
                      <Badge variant="secondary">{metrics.platformHealth.uptime}</Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Org Growth Rate</span>
                      <Badge variant="secondary">{metrics.growth.orgGrowthRate}%</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Globe className="w-5 h-5" />
                  Platform Highlights
                </CardTitle>
                <CardDescription>Key features and capabilities</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                    <h3 className="font-semibold mb-2">Real-time Translation</h3>
                    <p className="text-sm text-muted-foreground">
                      50+ languages with sub-200ms latency for voice calls
                    </p>
                  </div>
                  <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                    <h3 className="font-semibold mb-2">Self-Hosted Infrastructure</h3>
                    <p className="text-sm text-muted-foreground">
                      Zero third-party telecom dependencies, full data control
                    </p>
                  </div>
                  <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                    <h3 className="font-semibold mb-2">B2B + B2C Model</h3>
                    <p className="text-sm text-muted-foreground">
                      Enterprise-ready with individual consumer support
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Unable to load metrics. Please try again.</p>
            <Button variant="outline" className="mt-4" onClick={handleRefresh}>
              Retry
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
