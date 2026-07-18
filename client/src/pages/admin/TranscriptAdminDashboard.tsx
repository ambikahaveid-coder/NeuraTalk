import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { format } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth, getAuthToken } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ArrowLeft, Search, FileText, ShieldCheck, Activity, RefreshCw } from "lucide-react";

interface TranscriptSearchResult {
  id: number;
  callId: number | null;
  originalText: string;
  translatedText: string;
  timestamp?: string;
}

interface TranscriptSearchResponse {
  results: TranscriptSearchResult[];
  total: number;
  limit: number;
  offset: number;
}

interface RetentionMember {
  userId: number;
  username: string;
  email: string;
  retention: string;
}

interface RetentionSettings {
  orgDefault: string;
  members: RetentionMember[];
}

interface AuditLogEntry {
  id: number;
  userId: number | null;
  action: string;
  entityType: string;
  createdAt: string;
  details?: unknown;
}

interface TranscriptMetrics {
  counters: Record<string, number>;
  lastRetentionSweep: { purgedCalls: number; purgedSegments: number; at: string } | null;
  lastRetentionFailure: { error: string; at: string } | null;
}

const RETENTION_OPTIONS = [
  { value: "none", label: "None (platform default: 30 days)" },
  { value: "session", label: "Session only (purged after call)" },
  { value: "7days", label: "7 days" },
  { value: "30days", label: "30 days" },
];

const PAGE_SIZE = 20;

export default function TranscriptAdminDashboard() {
  const { toast } = useToast();
  const { isSuperAdmin } = useAuth();

  const [query, setQuery] = useState("");
  const [userIdFilter, setUserIdFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [results, setResults] = useState<TranscriptSearchResult[] | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [searching, setSearching] = useState(false);
  const [exportingId, setExportingId] = useState<number | null>(null);
  const [savingRetention, setSavingRetention] = useState(false);

  const { data: retention, isLoading: retentionLoading } = useQuery<RetentionSettings>({
    queryKey: ["/api/admin/transcripts/retention"],
  });

  const { data: auditLog, isLoading: auditLoading } = useQuery<{ logs: AuditLogEntry[] }>({
    queryKey: ["/api/admin/transcripts/audit-log"],
  });

  const { data: metrics, refetch: refetchMetrics } = useQuery<TranscriptMetrics>({
    queryKey: ["/api/admin/transcripts/metrics"],
    enabled: isSuperAdmin,
  });

  async function runSearch(reset: boolean) {
    if (query.trim().length < 2) return;
    setSearching(true);
    try {
      const params = new URLSearchParams({ q: query.trim(), limit: String(PAGE_SIZE), offset: String(reset ? 0 : offset) });
      if (userIdFilter.trim()) params.set("userId", userIdFilter.trim());
      if (dateFrom) params.set("dateFrom", new Date(dateFrom).toISOString());
      if (dateTo) params.set("dateTo", new Date(dateTo).toISOString());

      const token = getAuthToken();
      const res = await fetch(`/api/admin/transcripts/search?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Search failed");
      const data: TranscriptSearchResponse = await res.json();
      setResults(reset ? data.results : [...(results ?? []), ...data.results]);
      setTotal(data.total);
      setOffset(data.offset + data.results.length);
    } catch {
      toast({ title: "Search failed", variant: "destructive" });
    } finally {
      setSearching(false);
    }
  }

  async function exportResult(result: TranscriptSearchResult, exportFormat: "txt" | "pdf" | "docx") {
    if (!result.callId) return;
    setExportingId(result.id);
    try {
      const token = getAuthToken();
      const res = await fetch(`/api/admin/transcripts/${result.callId}/export/${exportFormat}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `transcript-${result.callId}.${exportFormat}`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    } finally {
      setExportingId(null);
    }
  }

  async function updateRetentionDefault(value: string) {
    setSavingRetention(true);
    try {
      await apiRequest("PATCH", "/api/admin/transcripts/retention", { dataRetention: value });
      toast({ title: "Retention default updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/transcripts/retention"] });
    } catch (error) {
      toast({ title: "Error", description: error instanceof Error ? error.message : "Failed to update retention", variant: "destructive" });
    } finally {
      setSavingRetention(false);
    }
  }

  const hasMore = results !== null && offset < total;

  return (
    <div className="container mx-auto p-6 max-w-5xl space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/admin">
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="w-6 h-6" />
            Transcript Administration
          </h1>
          <p className="text-muted-foreground">Search, export, and manage transcripts across your organization</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Search className="w-5 h-5" />
            Organization Transcript Search
          </CardTitle>
          <CardDescription>Search across all calls belonging to members of your organization</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <input
              type="search"
              placeholder="Search transcripts…"
              className="flex-1 min-w-[200px] h-9 rounded-md border border-input bg-background px-3 text-sm"
              data-testid="input-admin-transcript-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch(true)}
            />
            <input
              type="number"
              placeholder="User ID (optional)"
              className="w-40 h-9 rounded-md border border-input bg-background px-3 text-sm"
              data-testid="input-admin-filter-userid"
              value={userIdFilter}
              onChange={(e) => setUserIdFilter(e.target.value)}
            />
            <input
              type="date"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              data-testid="input-admin-filter-datefrom"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
            <input
              type="date"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              data-testid="input-admin-filter-dateto"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
            <Button
              size="sm"
              onClick={() => runSearch(true)}
              disabled={query.trim().length < 2 || searching}
              data-testid="button-admin-search-transcripts"
            >
              {searching ? "Searching…" : "Search"}
            </Button>
          </div>

          {results !== null && (
            <div className="space-y-2">
              {results.length === 0 ? (
                <p className="text-sm text-muted-foreground">No matching transcript segments found.</p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">{total} result{total === 1 ? "" : "s"}</p>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {results.map((r) => (
                      <div key={r.id} className="p-3 bg-secondary rounded text-sm" data-testid={`admin-search-result-${r.id}`}>
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-xs text-muted-foreground">
                            {r.timestamp ? format(new Date(r.timestamp), "MMM d, h:mm a") : ""}
                            {r.callId ? ` · Call #${r.callId}` : ""}
                          </p>
                          <div className="flex gap-1">
                            {(["txt", "pdf", "docx"] as const).map((f) => (
                              <Button
                                key={f}
                                size="sm"
                                variant="outline"
                                className="h-6 px-2 text-xs uppercase"
                                data-testid={`button-admin-export-${f}-${r.id}`}
                                disabled={exportingId === r.id || !r.callId}
                                onClick={() => exportResult(r, f)}
                              >
                                {f}
                              </Button>
                            ))}
                          </div>
                        </div>
                        <p>{r.originalText}</p>
                        <p className="text-muted-foreground">→ {r.translatedText}</p>
                      </div>
                    ))}
                  </div>
                  {hasMore && (
                    <Button variant="outline" size="sm" onClick={() => runSearch(false)} disabled={searching} data-testid="button-admin-load-more">
                      {searching ? "Loading…" : "Load more"}
                    </Button>
                  )}
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <ShieldCheck className="w-5 h-5" />
            Retention Controls
          </CardTitle>
          <CardDescription>Set the default transcript retention window for organization members without an explicit preference</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {retentionLoading ? (
            <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
          ) : (
            <>
              <div className="flex items-center gap-3">
                <Label className="text-sm">Organization default:</Label>
                <Select
                  value={retention?.orgDefault?.startsWith("none") ? "none" : retention?.orgDefault}
                  onValueChange={updateRetentionDefault}
                  disabled={savingRetention}
                >
                  <SelectTrigger className="w-64" data-testid="select-org-retention-default">
                    <SelectValue placeholder="Select retention" />
                  </SelectTrigger>
                  <SelectContent>
                    {RETENTION_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-sm">Member preferences</Label>
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {(retention?.members ?? []).map((m) => (
                    <div key={m.userId} className="flex items-center justify-between p-2 bg-secondary rounded text-sm" data-testid={`retention-member-${m.userId}`}>
                      <span>{m.username || m.email || `User #${m.userId}`}</span>
                      <Badge variant="outline">{m.retention}</Badge>
                    </div>
                  ))}
                  {(retention?.members ?? []).length === 0 && (
                    <p className="text-sm text-muted-foreground">No organization members found.</p>
                  )}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Audit Log</CardTitle>
          <CardDescription>Recent transcript access, export, deletion, and retention changes by your organization</CardDescription>
        </CardHeader>
        <CardContent>
          {auditLoading ? (
            <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
          ) : (auditLog?.logs ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No audit entries yet.</p>
          ) : (
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {(auditLog?.logs ?? []).map((log) => (
                <div key={log.id} className="flex items-center justify-between p-2 bg-secondary rounded text-sm" data-testid={`audit-log-entry-${log.id}`}>
                  <span>
                    <Badge variant="outline" className="mr-2">{log.action}</Badge>
                    {log.entityType} {log.userId ? `by user #${log.userId}` : ""}
                  </span>
                  <span className="text-xs text-muted-foreground">{format(new Date(log.createdAt), "MMM d, h:mm a")}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {isSuperAdmin && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Activity className="w-5 h-5" />
                  Monitoring
                </CardTitle>
                <CardDescription>Transcript system metrics (platform-wide)</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => refetchMetrics()} data-testid="button-refresh-metrics">
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Object.entries(metrics?.counters ?? {}).map(([key, value]) => (
                <div key={key} className="p-3 bg-secondary rounded" data-testid={`metric-${key}`}>
                  <p className="text-xs text-muted-foreground">{key.replace(/_/g, " ")}</p>
                  <p className="text-xl font-semibold">{value}</p>
                </div>
              ))}
            </div>
            {metrics?.lastRetentionSweep && (
              <p className="text-xs text-muted-foreground">
                Last retention sweep: purged {metrics.lastRetentionSweep.purgedCalls} calls, {metrics.lastRetentionSweep.purgedSegments} segments
                {" "}({format(new Date(metrics.lastRetentionSweep.at), "MMM d, h:mm a")})
              </p>
            )}
            {metrics?.lastRetentionFailure && (
              <p className="text-xs text-destructive">
                Last retention failure: {metrics.lastRetentionFailure.error}
                {" "}({format(new Date(metrics.lastRetentionFailure.at), "MMM d, h:mm a")})
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
