import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BarChart3, CalendarRange, CheckCircle2, CircleDashed, CreditCard, FileText, Loader2, ShieldAlert, Sparkles, TrendingUp, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/marketing/StatusBadge";
import { MetricCard } from "@/components/marketing/MetricCard";
import { NotAvailableMetric } from "@/components/marketing/NotAvailableMetric";
import { getAuthToken } from "@/hooks/use-auth";

const BASE_PATH = "/api/v1/business";

type MarketingSection = "overview" | "campaigns" | "reports" | "frequency";
type CampaignView = "list" | "detail" | "preflight";

interface MarketingReportResponse {
  success: boolean;
  report?: {
    businessId: number;
    campaignCount: number;
    campaignsByStatus?: Record<string, number>;
    totals?: {
      targeted?: number;
      sent?: number;
      skipped?: number;
      skippedByReason?: Record<string, number>;
      cost?: { totalChargedPaise?: number; availability?: string };
    };
    delivery?: {
      sent?: { availability?: string; count?: number };
      accepted?: { availability?: string; reason?: string };
      delivered?: { availability?: string; reason?: string };
      read?: { availability?: string; reason?: string };
    };
  };
}

interface CampaignListResponse {
  success: boolean;
  campaigns?: Array<{
    id: number;
    businessId: number;
    name: string;
    description?: string | null;
    category?: string;
    status?: string;
    templateVersionId?: number | null;
    audienceId?: number | null;
    createdAt?: string;
    scheduledAt?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    approvedAt?: string | null;
  }>;
}

interface MarketingFrequencyResponse {
  success: boolean;
  frequency?: {
    business?: {
      cap?: number;
      used?: number;
      remaining?: number;
      windowGranularity?: string;
    };
    customer?: {
      cap?: number;
      used?: number;
      remaining?: number;
      customerId?: number;
      windowGranularity?: string;
    } | null;
  };
}

interface CampaignReportResponse {
  success: boolean;
  report?: {
    targeted: number;
    pending: number;
    sent: number;
    skipped: number;
    skippedByReason: Record<string, number>;
    cost: { totalChargedPaise: number; availability: string };
    delivery: {
      sent: { availability: string; count?: number };
      accepted: { availability: string; reason?: string };
      delivered: { availability: string; reason?: string };
      read: { availability: string; reason?: string };
    };
  };
}

interface CampaignPreflightResponse {
  success: boolean;
  preflight?: {
    campaign: { id: number; businessId: number; status: string; category: string };
    audience: { audienceId: number | null; size: number; resolvable: boolean };
    eligibility: {
      active: number;
      blocked: number;
      archived: number;
      consentGranted: number;
      consentRevoked: number;
      consentMissing: number;
      frequencyCapped: number;
      eligibleCount: number;
    };
    suppressionBreakdown: Record<string, number>;
    frequency: {
      applicable: boolean;
      customer: { cap: number; windowGranularity: string; note: string };
      business: { cap: number; used: number; remaining: number; windowGranularity: string } | null;
    };
    billing: {
      costLabel: string;
      estimatedCostPaise: number;
      billingConfigured: boolean;
      availableBalancePaise: number;
      affordableRecipientCount: number;
      sufficientCreditForAllEligible: boolean;
    };
    readiness: { ready: boolean; reasons: string[] };
  };
}

function formatPaise(value?: number): string {
  const safeValue = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(safeValue / 100);
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

async function fetchMarketingJson(path: string) {
  const token = getAuthToken();
  const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new Error(errBody?.error || errBody?.message || "Failed to load marketing data");
  }
  return res.json();
}

function renderMetricValue(value: number | string | null | undefined, fallback: string = "—") {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) return value;
  return fallback;
}

export function MarketingOverviewPage({ businessId }: { businessId: number }) {
  const reportQuery = useQuery<MarketingReportResponse>({
    queryKey: ["marketing", "report", businessId],
    queryFn: () => fetchMarketingJson(`${BASE_PATH}/${businessId}/marketing/report`),
    enabled: !!businessId,
  });

  const campaignsQuery = useQuery<CampaignListResponse>({
    queryKey: ["marketing", "campaigns", businessId],
    queryFn: () => fetchMarketingJson(`${BASE_PATH}/${businessId}/campaigns`),
    enabled: !!businessId,
  });

  const report = reportQuery.data?.report;
  const campaigns = campaignsQuery.data?.campaigns ?? [];
  const activeCampaigns = campaigns.filter((c) => c.status === "running").length;
  const scheduledCampaigns = campaigns.filter((c) => c.status === "scheduled").length;
  const sent = report?.totals?.sent ?? 0;
  const skipped = report?.totals?.skipped ?? 0;
  const targeted = report?.totals?.targeted ?? 0;
  const totalCost = report?.totals?.cost?.totalChargedPaise ?? 0;

  if (reportQuery.isLoading || campaignsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (reportQuery.isError || campaignsQuery.isError) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          {reportQuery.error instanceof Error ? reportQuery.error.message : campaignsQuery.error instanceof Error ? campaignsQuery.error.message : "Failed to load marketing overview"}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Active campaigns" value={activeCampaigns} icon={BarChart3} tone="default" testId="metric-active-campaigns" />
        <MetricCard label="Scheduled campaigns" value={scheduledCampaigns} icon={CalendarRange} tone="default" testId="metric-scheduled-campaigns" />
        <MetricCard label="Sent" value={sent} icon={CheckCircle2} tone="positive" testId="metric-sent-overview" />
        <MetricCard label="Suppressed" value={skipped} icon={ShieldAlert} tone="warning" testId="metric-suppressed-overview" />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Eligible" value={renderMetricValue(Math.max(0, targeted - skipped), "NOT AVAILABLE")} icon={Users} tone="default" testId="metric-eligible-overview" />
        <MetricCard label="Actual spend" value={formatPaise(totalCost)} icon={CreditCard} tone="default" testId="metric-actual-spend" />
        <MetricCard label="Failed" value={renderMetricValue(Math.max(0, sent === 0 && targeted > 0 ? targeted - sent - skipped : 0), "NOT AVAILABLE")} icon={ShieldAlert} tone="negative" testId="metric-failed-overview" />
        <MetricCard label="Available credits" value={"NOT AVAILABLE"} icon={Sparkles} tone="default" testId="metric-available-credits" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Delivery status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <NotAvailableMetric label="Accepted" reason={report?.delivery?.accepted?.reason ?? "No delivery stage is exposed by the current R0 backend contract."} />
            <NotAvailableMetric label="Delivered" reason={report?.delivery?.delivered?.reason ?? "No delivery stage is exposed by the current R0 backend contract."} />
            <NotAvailableMetric label="Read" reason={report?.delivery?.read?.reason ?? "No delivery stage is exposed by the current R0 backend contract."} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Campaign summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Targeted</span><span className="font-semibold">{targeted}</span></div>
            <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Skipped</span><span className="font-semibold">{skipped}</span></div>
            <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Campaign count</span><span className="font-semibold">{report?.campaignCount ?? campaigns.length}</span></div>
            <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Status mix</span><span className="font-semibold">{Object.keys(report?.campaignsByStatus ?? {}).length ? Object.entries(report?.campaignsByStatus ?? {}).map(([k, v]) => `${k}:${v}`).join(", ") : "—"}</span></div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function CampaignDetailPage({
  businessId,
  campaignId,
  onBack,
}: {
  businessId: number;
  campaignId: number;
  onBack: () => void;
}) {
  const reportQuery = useQuery<CampaignReportResponse>({
    queryKey: ["campaigns", "report", campaignId],
    queryFn: () => fetchMarketingJson(`${BASE_PATH}/${businessId}/campaigns/${campaignId}`),
    enabled: !!campaignId,
  });

  const report = reportQuery.data?.report;

  if (reportQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (reportQuery.isError) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          {reportQuery.error instanceof Error ? reportQuery.error.message : "Failed to load campaign details"}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Button variant="outline" size="sm" onClick={onBack} className="gap-2">
        <ArrowLeft className="h-4 w-4" /> Back to campaigns
      </Button>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Targeted" value={report?.targeted ?? 0} icon={Users} tone="default" testId="campaign-detail-targeted" />
        <MetricCard label="Sent" value={report?.sent ?? 0} icon={CheckCircle2} tone="positive" testId="campaign-detail-sent" />
        <MetricCard label="Pending" value={report?.pending ?? 0} icon={CircleDashed} tone="default" testId="campaign-detail-pending" />
        <MetricCard label="Skipped" value={report?.skipped ?? 0} icon={ShieldAlert} tone="warning" testId="campaign-detail-skipped" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Cost</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Total charged</span>
              <span className="font-semibold">{formatPaise(report?.cost?.totalChargedPaise ?? 0)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Billing status</span>
              <Badge variant="outline">{report?.cost?.availability ?? "UNKNOWN"}</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Delivery</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Sent</span>
              <span className="font-semibold">{report?.delivery?.sent?.count ?? report?.sent ?? 0}</span>
            </div>
            <div className="text-xs text-muted-foreground italic">Accepted, delivered, and read metrics are not available in the current R0 contract.</div>
          </CardContent>
        </Card>
      </div>

      {Object.keys(report?.skippedByReason ?? {}).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Suppression breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {Object.entries(report?.skippedByReason ?? {}).map(([reason, count]) => (
              <div key={reason} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{reason}</span>
                <span className="font-semibold">{count}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function CampaignPreflightPage({
  businessId,
  campaignId,
  onBack,
}: {
  businessId: number;
  campaignId: number;
  onBack: () => void;
}) {
  const preflightQuery = useQuery<CampaignPreflightResponse>({
    queryKey: ["campaigns", "preflight", campaignId],
    queryFn: () => fetchMarketingJson(`${BASE_PATH}/${businessId}/campaigns/${campaignId}/preflight`),
    enabled: !!campaignId,
  });

  const preflight = preflightQuery.data?.preflight;

  if (preflightQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (preflightQuery.isError) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          {preflightQuery.error instanceof Error ? preflightQuery.error.message : "Failed to load preflight data"}
        </CardContent>
      </Card>
    );
  }

  const isReady = preflight?.readiness?.ready ?? false;

  return (
    <div className="space-y-6">
      <Button variant="outline" size="sm" onClick={onBack} className="gap-2">
        <ArrowLeft className="h-4 w-4" /> Back to campaigns
      </Button>

      <Card className={isReady ? "border-green-500/50 bg-green-500/5" : "border-amber-500/50 bg-amber-500/5"}>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-sm">Readiness</CardTitle>
            {isReady ? (
              <Badge className="bg-green-500">READY</Badge>
            ) : (
              <Badge className="bg-amber-500">NOT READY</Badge>
            )}
          </div>
        </CardHeader>
        {!isReady && preflight?.readiness?.reasons?.length ? (
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground mb-2">Issues preventing execution:</p>
            <ul className="space-y-1">
              {preflight.readiness.reasons.map((reason, idx) => (
                <li key={idx} className="text-sm text-amber-600">• {reason}</li>
              ))}
            </ul>
          </CardContent>
        ) : null}
      </Card>

      {preflight?.eligibility && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Active customers"
            value={preflight.eligibility.active}
            icon={Users}
            tone="default"
            testId="preflight-active"
          />
          <MetricCard
            label="Blocked"
            value={preflight.eligibility.blocked}
            icon={ShieldAlert}
            tone="warning"
            testId="preflight-blocked"
          />
          <MetricCard
            label="Archived"
            value={preflight.eligibility.archived}
            icon={ShieldAlert}
            tone="negative"
            testId="preflight-archived"
          />
          <MetricCard
            label="Eligible to send"
            value={preflight.eligibility.eligibleCount}
            icon={CheckCircle2}
            tone="positive"
            testId="preflight-eligible"
          />
        </div>
      )}

      {preflight?.eligibility && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Consent status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Granted</span>
                <span className="font-semibold">{preflight.eligibility.consentGranted}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Revoked</span>
                <span className="font-semibold">{preflight.eligibility.consentRevoked}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Missing</span>
                <span className="font-semibold">{preflight.eligibility.consentMissing}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Frequency status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {preflight.frequency?.applicable ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Customer cap</span>
                    <span className="font-semibold">{preflight.frequency.customer?.cap ?? "—"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Frequency capped</span>
                    <span className="font-semibold">{preflight.eligibility.frequencyCapped}</span>
                  </div>
                </>
              ) : (
                <div className="text-muted-foreground text-xs">Frequency capping does not apply to this campaign category.</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Billing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Estimated cost</span>
                <span className="font-semibold">{formatPaise(preflight.billing?.estimatedCostPaise ?? 0)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Cost type</span>
                <Badge variant="outline" className="text-xs">{preflight.billing?.costLabel ?? "UNKNOWN"}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Affordable count</span>
                <span className="font-semibold">{preflight.billing?.affordableRecipientCount ?? 0}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {preflight?.suppressionBreakdown && Object.keys(preflight.suppressionBreakdown).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Suppression breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {Object.entries(preflight.suppressionBreakdown).map(([reason, count]) => (
              <div key={reason} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{reason}</span>
                <span className="font-semibold">{count}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function CampaignsPage({
  businessId,
  onSelectCampaign,
}: {
  businessId: number;
  onSelectCampaign: (campaignId: number, view: CampaignView) => void;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const campaignsQuery = useQuery<CampaignListResponse>({
    queryKey: ["marketing", "campaigns", businessId],
    queryFn: () => fetchMarketingJson(`${BASE_PATH}/${businessId}/campaigns`),
    enabled: !!businessId,
  });

  const campaigns = (campaignsQuery.data?.campaigns ?? []).filter((campaign) => {
    const matchesStatus = statusFilter === "all" || campaign.status === statusFilter;
    const text = `${campaign.name} ${campaign.status ?? ""} ${campaign.category ?? ""}`.toLowerCase();
    const matchesSearch = text.includes(search.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  if (campaignsQuery.isLoading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  if (campaignsQuery.isError) {
    return <Card><CardContent className="p-6 text-sm text-muted-foreground">{campaignsQuery.error instanceof Error ? campaignsQuery.error.message : "Failed to load campaigns"}</CardContent></Card>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="max-w-sm w-full">
          <label htmlFor="campaign-search" className="sr-only">Search campaigns</label>
          <Input id="campaign-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search campaigns" />
        </div>
        <div>
          <label htmlFor="campaign-status-filter" className="sr-only">Filter campaigns by status</label>
          <select id="campaign-status-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-md border border-white/10 bg-background px-3 py-2 text-sm">
          <option value="all">All status</option>
          <option value="draft">Draft</option>
          <option value="scheduled">Scheduled</option>
          <option value="running">Running</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
          <option value="failed">Failed</option>
          </select>
        </div>
      </div>

      {campaigns.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No campaigns matched the current filter.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {campaigns.map((campaign) => (
            <Card key={campaign.id} className="cursor-pointer hover:bg-card-hover transition-colors" data-testid={`campaign-row-${campaign.id}`}>
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{campaign.name}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {campaign.category ?? "marketing"} • Created {formatDate(campaign.createdAt)}
                    </p>
                  </div>
                  <StatusBadge status={campaign.status ?? "draft"} />
                </div>

                <div className="flex gap-2 mt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onSelectCampaign(campaign.id, "detail")}
                    className="text-xs"
                    data-testid={`campaign-detail-btn-${campaign.id}`}
                  >
                    Detail
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onSelectCampaign(campaign.id, "preflight")}
                    className="text-xs"
                    data-testid={`campaign-preflight-btn-${campaign.id}`}
                  >
                    Preflight
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}


function MarketingReportsPage({ businessId }: { businessId: number }) {
  const reportQuery = useQuery<MarketingReportResponse>({
    queryKey: ["marketing", "report", businessId],
    queryFn: () => fetchMarketingJson(`${BASE_PATH}/${businessId}/marketing/report`),
    enabled: !!businessId,
  });

  const frequencyQuery = useQuery<MarketingFrequencyResponse>({
    queryKey: ["marketing", "frequency", businessId],
    queryFn: () => fetchMarketingJson(`${BASE_PATH}/${businessId}/marketing/frequency`),
    enabled: !!businessId,
  });

  const report = reportQuery.data?.report;
  const frequency = frequencyQuery.data?.frequency;

  if (reportQuery.isLoading || frequencyQuery.isLoading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  if (reportQuery.isError || frequencyQuery.isError) {
    return <Card><CardContent className="p-6 text-sm text-muted-foreground">{reportQuery.error instanceof Error ? reportQuery.error.message : frequencyQuery.error instanceof Error ? frequencyQuery.error.message : "Failed to load report data"}</CardContent></Card>;
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <MetricCard label="Sent" value={report?.totals?.sent ?? 0} icon={CheckCircle2} tone="positive" testId="metric-report-sent" />
        <MetricCard label="Suppressed" value={report?.totals?.skipped ?? 0} icon={ShieldAlert} tone="warning" testId="metric-report-suppressed" />
        <MetricCard label="Actual cost" value={formatPaise(report?.totals?.cost?.totalChargedPaise ?? 0)} icon={CreditCard} tone="default" testId="metric-report-cost" />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <NotAvailableMetric label="Accepted" reason={report?.delivery?.accepted?.reason ?? "No accepted metric is available from the current R0 contract."} />
        <NotAvailableMetric label="Delivered" reason={report?.delivery?.delivered?.reason ?? "No delivered metric is available from the current R0 contract."} />
        <NotAvailableMetric label="Read" reason={report?.delivery?.read?.reason ?? "No read metric is available from the current R0 contract."} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Frequency & limits</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Business cap</span><span className="font-semibold">{frequency?.business?.cap ?? "—"}</span></div>
          <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Business used</span><span className="font-semibold">{frequency?.business?.used ?? "—"}</span></div>
          <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Business remaining</span><span className="font-semibold">{frequency?.business?.remaining ?? "—"}</span></div>
          {frequency?.customer ? (
            <>
              <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Customer cap</span><span className="font-semibold">{frequency.customer.cap ?? "—"}</span></div>
              <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Customer used</span><span className="font-semibold">{frequency.customer.used ?? "—"}</span></div>
              <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Customer remaining</span><span className="font-semibold">{frequency.customer.remaining ?? "—"}</span></div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground">Customer-level usage is not available for the current authorization scope.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FrequencyPage({ businessId }: { businessId: number }) {
  const frequencyQuery = useQuery<MarketingFrequencyResponse>({
    queryKey: ["marketing", "frequency", businessId],
    queryFn: () => fetchMarketingJson(`${BASE_PATH}/${businessId}/marketing/frequency`),
    enabled: !!businessId,
  });

  if (frequencyQuery.isLoading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  if (frequencyQuery.isError) {
    return <Card><CardContent className="p-6 text-sm text-muted-foreground">{frequencyQuery.error instanceof Error ? frequencyQuery.error.message : "Failed to load frequency data"}</CardContent></Card>;
  }

  const frequency = frequencyQuery.data?.frequency;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <MetricCard label="Business throughput limit" value={frequency?.business?.cap ?? "—"} icon={TrendingUp} tone="default" testId="metric-biz-cap" />
        <MetricCard label="Current business usage" value={frequency?.business?.used ?? "—"} icon={CircleDashed} tone="default" testId="metric-biz-used" />
        <MetricCard label="Remaining business capacity" value={frequency?.business?.remaining ?? "—"} icon={CheckCircle2} tone="positive" testId="metric-biz-remaining" />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Customer usage</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {frequency?.customer ? (
            <>
              <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Customer frequency limit</span><span className="font-semibold">{frequency.customer.cap ?? "—"}</span></div>
              <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Current usage</span><span className="font-semibold">{frequency.customer.used ?? "—"}</span></div>
              <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Remaining allowance</span><span className="font-semibold">{frequency.customer.remaining ?? "—"}</span></div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground">Customer-level frequency data is not available in the current authorization context.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function MarketingControlCenter({ businessId }: { businessId: number }) {
  const [section, setSection] = useState<MarketingSection>("overview");
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null);
  const [campaignView, setCampaignView] = useState<CampaignView>("list");

  const sectionButtons: { id: MarketingSection; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "campaigns", label: "Campaigns" },
    { id: "reports", label: "Reports" },
    { id: "frequency", label: "Frequency & Limits" },
  ];

  const handleSelectCampaign = (campaignId: number, view: CampaignView = "detail") => {
    setSelectedCampaignId(campaignId);
    setCampaignView(view);
  };

  const handleBackToList = () => {
    setSelectedCampaignId(null);
    setCampaignView("list");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {sectionButtons.map((sectionButton) => (
          <Button
            key={sectionButton.id}
            variant={section === sectionButton.id ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setSection(sectionButton.id);
              handleBackToList();
            }}
          >
            {sectionButton.label}
          </Button>
        ))}
      </div>

      {section === "overview" && <MarketingOverviewPage businessId={businessId} />}

      {section === "campaigns" && !selectedCampaignId && (
        <CampaignsPage businessId={businessId} onSelectCampaign={handleSelectCampaign} />
      )}

      {section === "campaigns" && selectedCampaignId && campaignView === "detail" && (
        <CampaignDetailPage businessId={businessId} campaignId={selectedCampaignId} onBack={handleBackToList} />
      )}

      {section === "campaigns" && selectedCampaignId && campaignView === "preflight" && (
        <CampaignPreflightPage businessId={businessId} campaignId={selectedCampaignId} onBack={handleBackToList} />
      )}

      {section === "reports" && <MarketingReportsPage businessId={businessId} />}
      {section === "frequency" && <FrequencyPage businessId={businessId} />}
    </div>
  );
}

export default MarketingControlCenter;
