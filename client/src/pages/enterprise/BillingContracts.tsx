import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, FileText, Plus, Trash2, AlertCircle, CheckCircle, Clock } from "lucide-react";
import { Link } from "wouter";
import { getAuthToken } from "@/hooks/use-auth";
import { useAuth } from "@/hooks/use-auth";

function apiFetch(path: string, opts?: RequestInit) {
  const token = getAuthToken();
  return fetch(path, {
    ...opts,
    credentials: "include",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(opts?.headers ?? {}) },
  }).then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "Error"); return j; });
}

interface VolumeTier {
  minMinutes: number;
  ratePerMinutePaise: number;
}

interface Contract {
  discountPercent: number;
  contractedRatePerMinutePaise: number | null;
  volumeTiers: VolumeTier[];
  contractStartDate: string | null;
  contractEndDate: string | null;
  contractNotes: string;
  slaUptimePercent: number | null;
}

interface GraceStatus {
  inGrace: boolean;
  graceEndsAt: string | null;
  isSuspended: boolean;
  daysRemaining: number | null;
}

// ── Company admin view: read-only contract + grace status ────────────────────

function CompanyContractView() {
  const { toast } = useToast();

  const { data: contract } = useQuery<Contract>({
    queryKey: ["/api/billing/contract"],
    queryFn: () => apiFetch("/api/billing/contract"),
  });

  const { data: graceStatus } = useQuery<GraceStatus>({
    queryKey: ["/api/billing/grace-status"],
    queryFn: () => apiFetch("/api/billing/grace-status"),
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-6">
      {/* Grace / Suspension Status */}
      {graceStatus && (graceStatus.inGrace || graceStatus.isSuspended) && (
        <Card className={`border-2 ${graceStatus.isSuspended ? "border-red-500 bg-red-50 dark:bg-red-950" : "border-amber-400 bg-amber-50 dark:bg-amber-950"}`}>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <AlertCircle className={`h-5 w-5 ${graceStatus.isSuspended ? "text-red-500" : "text-amber-500"}`} />
              <div>
                {graceStatus.isSuspended ? (
                  <>
                    <p className="font-semibold text-red-700 dark:text-red-300">Account Suspended</p>
                    <p className="text-sm text-red-600 dark:text-red-400">Outgoing calls are blocked. Please renew your subscription or contact support.</p>
                  </>
                ) : (
                  <>
                    <p className="font-semibold text-amber-700 dark:text-amber-300">
                      Grace Period — {graceStatus.daysRemaining} day{graceStatus.daysRemaining !== 1 ? "s" : ""} remaining
                    </p>
                    <p className="text-sm text-amber-600 dark:text-amber-400">
                      Your subscription has expired. Renew before {graceStatus.graceEndsAt ? new Date(graceStatus.graceEndsAt).toLocaleDateString() : "the deadline"} to avoid suspension.
                    </p>
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {graceStatus && !graceStatus.inGrace && !graceStatus.isSuspended && (
        <Card className="border-green-200 bg-green-50 dark:bg-green-950">
          <CardContent className="py-3 flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-green-500" />
            <span className="text-sm font-medium text-green-700 dark:text-green-300">Subscription active — no billing issues</span>
          </CardContent>
        </Card>
      )}

      {/* Contract terms */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your Contract Terms</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {contract ? (
            <>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Discount</span>
                  <p className="font-semibold text-lg">{contract.discountPercent}%</p>
                </div>
                {contract.contractedRatePerMinutePaise && (
                  <div>
                    <span className="text-muted-foreground">Contracted Rate</span>
                    <p className="font-semibold text-lg">₹{(contract.contractedRatePerMinutePaise / 100).toFixed(2)}/min</p>
                  </div>
                )}
                {contract.slaUptimePercent && (
                  <div>
                    <span className="text-muted-foreground">SLA Uptime</span>
                    <p className="font-semibold text-lg">{contract.slaUptimePercent}%</p>
                  </div>
                )}
                {contract.contractEndDate && (
                  <div>
                    <span className="text-muted-foreground">Contract Valid Until</span>
                    <p className="font-semibold">{new Date(contract.contractEndDate).toLocaleDateString()}</p>
                  </div>
                )}
              </div>

              {contract.volumeTiers.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-2">Volume Tiers</p>
                  <div className="space-y-1">
                    {contract.volumeTiers.map((tier, i) => (
                      <div key={i} className="flex justify-between text-sm bg-muted rounded px-3 py-1.5">
                        <span>Above {tier.minMinutes.toLocaleString()} min/month</span>
                        <span className="font-medium">₹{(tier.ratePerMinutePaise / 100).toFixed(2)}/min</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {contract.contractNotes && (
                <div>
                  <p className="text-sm font-medium mb-1">Notes</p>
                  <p className="text-sm text-muted-foreground bg-muted rounded p-2">{contract.contractNotes}</p>
                </div>
              )}

              {!contract.discountPercent && !contract.contractedRatePerMinutePaise && !contract.volumeTiers.length && (
                <p className="text-sm text-muted-foreground">No special contract terms. Standard plan pricing applies.</p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Loading contract…</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Super admin view: org selector + edit ────────────────────────────────────

interface OrgBilling {
  organizationId: number;
  organizationName: string;
  status: string;
  billingType: string;
  walletBalancePaise: number;
}

function SuperAdminContractManager() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [selectedOrgId, setSelectedOrgId] = useState<number | null>(null);
  const [tiers, setTiers] = useState<VolumeTier[]>([]);
  const [form, setForm] = useState({
    discountPercent: 0,
    contractedRatePerMinutePaise: "",
    contractStartDate: "",
    contractEndDate: "",
    contractNotes: "",
    slaUptimePercent: "",
  });

  const { data: companies = [] } = useQuery<OrgBilling[]>({
    queryKey: ["/api/admin/billing/companies"],
    queryFn: () => apiFetch("/api/admin/billing/companies"),
  });

  const { data: contract, isLoading: contractLoading } = useQuery<Contract>({
    queryKey: ["/api/admin/billing/companies", selectedOrgId, "contract"],
    queryFn: () => apiFetch(`/api/admin/billing/companies/${selectedOrgId}/contract`),
    enabled: !!selectedOrgId,
    select: (data) => {
      setForm({
        discountPercent: data.discountPercent ?? 0,
        contractedRatePerMinutePaise: data.contractedRatePerMinutePaise ? String(data.contractedRatePerMinutePaise / 100) : "",
        contractStartDate: data.contractStartDate?.split("T")[0] ?? "",
        contractEndDate: data.contractEndDate?.split("T")[0] ?? "",
        contractNotes: data.contractNotes ?? "",
        slaUptimePercent: data.slaUptimePercent ? String(data.slaUptimePercent) : "",
      });
      setTiers(data.volumeTiers ?? []);
      return data;
    },
  });

  const resume = useMutation({
    mutationFn: (orgId: number) => apiFetch(`/api/admin/billing/companies/${orgId}/resume`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/billing/companies"] });
      toast({ title: "Organization resumed successfully" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const saveContract = useMutation({
    mutationFn: () => apiFetch(`/api/admin/billing/companies/${selectedOrgId}/contract`, {
      method: "PUT",
      body: JSON.stringify({
        discountPercent: Number(form.discountPercent) || 0,
        contractedRatePerMinutePaise: form.contractedRatePerMinutePaise
          ? Math.round(parseFloat(form.contractedRatePerMinutePaise) * 100) : null,
        volumeTiers: tiers,
        contractStartDate: form.contractStartDate || null,
        contractEndDate: form.contractEndDate || null,
        contractNotes: form.contractNotes,
        slaUptimePercent: form.slaUptimePercent ? parseFloat(form.slaUptimePercent) : null,
      }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/billing/companies", selectedOrgId, "contract"] });
      toast({ title: "Contract saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addTier = () => setTiers(t => [...t, { minMinutes: 0, ratePerMinutePaise: 0 }]);
  const removeTier = (i: number) => setTiers(t => t.filter((_, idx) => idx !== i));
  const updateTier = (i: number, field: keyof VolumeTier, val: string) => {
    setTiers(t => t.map((tier, idx) => idx === i ? { ...tier, [field]: field === "ratePerMinutePaise" ? Math.round(parseFloat(val || "0") * 100) : parseInt(val || "0") } : tier));
  };

  const suspended = companies.filter(c => c.status === "suspended");

  return (
    <div className="space-y-6">
      {/* Suspended org alerts */}
      {suspended.length > 0 && (
        <Card className="border-red-300">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-red-600 flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />{suspended.length} Suspended Organization{suspended.length > 1 ? "s" : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {suspended.map(org => (
              <div key={org.organizationId} className="flex items-center justify-between p-2 rounded border bg-red-50 dark:bg-red-950">
                <span className="text-sm font-medium">{org.organizationName}</span>
                <Button size="sm" variant="outline" onClick={() => resume.mutate(org.organizationId)} disabled={resume.isPending}>
                  Resume
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Org selector */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Select Organization</CardTitle>
        </CardHeader>
        <CardContent>
          <select
            className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            value={selectedOrgId ?? ""}
            onChange={e => setSelectedOrgId(e.target.value ? parseInt(e.target.value) : null)}
          >
            <option value="">— Select a company —</option>
            {companies.map(c => (
              <option key={c.organizationId} value={c.organizationId}>
                {c.organizationName} ({c.status})
              </option>
            ))}
          </select>
        </CardContent>
      </Card>

      {selectedOrgId && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Contract Terms</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {contractLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Discount (%)</Label>
                    <Input
                      type="number" min={0} max={100}
                      value={form.discountPercent}
                      onChange={e => setForm(f => ({ ...f, discountPercent: parseFloat(e.target.value) || 0 }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Contracted Rate (₹/min)</Label>
                    <Input
                      type="number" min={0} step={0.01}
                      value={form.contractedRatePerMinutePaise}
                      onChange={e => setForm(f => ({ ...f, contractedRatePerMinutePaise: e.target.value }))}
                      placeholder="Blank = use plan rate"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Contract Start</Label>
                    <Input type="date" value={form.contractStartDate} onChange={e => setForm(f => ({ ...f, contractStartDate: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Contract End</Label>
                    <Input type="date" value={form.contractEndDate} onChange={e => setForm(f => ({ ...f, contractEndDate: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>SLA Uptime (%)</Label>
                    <Input
                      type="number" min={0} max={100} step={0.01}
                      value={form.slaUptimePercent}
                      onChange={e => setForm(f => ({ ...f, slaUptimePercent: e.target.value }))}
                      placeholder="e.g. 99.9"
                    />
                  </div>
                </div>

                {/* Volume tiers */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label>Volume Tiers</Label>
                    <Button variant="outline" size="sm" onClick={addTier}><Plus className="h-3.5 w-3.5 mr-1" />Add Tier</Button>
                  </div>
                  {tiers.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No volume tiers. Standard plan rate applies.</p>
                  ) : (
                    <div className="space-y-2">
                      {tiers.map((tier, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <div className="flex-1 space-y-0">
                            <Input
                              type="number" min={0}
                              value={tier.minMinutes}
                              onChange={e => updateTier(i, "minMinutes", e.target.value)}
                              placeholder="Min minutes"
                              className="h-8 text-xs"
                            />
                          </div>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">min → ₹</span>
                          <div className="flex-1">
                            <Input
                              type="number" min={0} step={0.01}
                              value={(tier.ratePerMinutePaise / 100).toFixed(2)}
                              onChange={e => updateTier(i, "ratePerMinutePaise", e.target.value)}
                              placeholder="Rate/min"
                              className="h-8 text-xs"
                            />
                          </div>
                          <span className="text-xs text-muted-foreground">/min</span>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeTier(i)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label>Notes</Label>
                  <Textarea
                    value={form.contractNotes}
                    onChange={e => setForm(f => ({ ...f, contractNotes: e.target.value }))}
                    placeholder="Internal notes about this contract…"
                    rows={3}
                  />
                </div>

                <Button onClick={() => saveContract.mutate()} disabled={saveContract.isPending} className="w-full">
                  {saveContract.isPending ? "Saving…" : "Save Contract"}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function BillingContractsPage() {
  const { user } = useAuth();
  const role = (user as { role?: string })?.role;
  const isSuperAdmin = role === "super_admin";

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Link href={isSuperAdmin ? "/super-admin" : "/company-dashboard"}>
            <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <FileText className="h-6 w-6 text-primary" />
              {isSuperAdmin ? "Enterprise Contracts & Volume Discounts" : "Billing Contract"}
            </h1>
            <p className="text-muted-foreground text-sm">
              {isSuperAdmin
                ? "Manage per-organization contracts, volume discounts, and grace periods"
                : "Your organization's contracted billing terms"}
            </p>
          </div>
        </div>

        {isSuperAdmin ? <SuperAdminContractManager /> : <CompanyContractView />}
      </div>
    </div>
  );
}
