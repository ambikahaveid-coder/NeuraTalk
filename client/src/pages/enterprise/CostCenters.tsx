import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, PiggyBank, Plus, Pencil, Trash2, AlertTriangle } from "lucide-react";
import { Link } from "wouter";
import { getAuthToken } from "@/hooks/use-auth";

function apiFetch(path: string, opts?: RequestInit) {
  const token = getAuthToken();
  return fetch(path, {
    ...opts,
    credentials: "include",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(opts?.headers ?? {}) },
  }).then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "Error"); return j; });
}

interface CostCenter {
  id: number;
  organizationId: number;
  departmentId: number | null;
  name: string;
  code: string;
  monthlyBudgetPaise: number;
  currentMonthSpendPaise: number;
  alertThresholdPercent: number;
  alertEmailSent: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

const EMPTY_FORM = {
  name: "",
  code: "",
  monthlyBudgetPaise: 0,
  alertThresholdPercent: 80,
  isActive: true,
};

function rupees(paise: number) {
  return `₹${(paise / 100).toFixed(2)}`;
}

function spendPercent(cc: CostCenter): number {
  if (!cc.monthlyBudgetPaise) return 0;
  return Math.min(100, Math.round((cc.currentMonthSpendPaise / cc.monthlyBudgetPaise) * 100));
}

export default function CostCentersPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<CostCenter | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const { data: centers = [], isLoading } = useQuery<CostCenter[]>({
    queryKey: ["/api/enterprise/cost-centers"],
    queryFn: () => apiFetch("/api/enterprise/cost-centers"),
  });

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowDialog(true);
  };

  const openEdit = (cc: CostCenter) => {
    setEditing(cc);
    setForm({
      name: cc.name,
      code: cc.code,
      monthlyBudgetPaise: cc.monthlyBudgetPaise,
      alertThresholdPercent: cc.alertThresholdPercent,
      isActive: cc.isActive,
    });
    setShowDialog(true);
  };

  const save = useMutation({
    mutationFn: (data: typeof form) => {
      if (editing) {
        return apiFetch(`/api/enterprise/cost-centers/${editing.id}`, { method: "PATCH", body: JSON.stringify(data) });
      }
      return apiFetch("/api/enterprise/cost-centers", { method: "POST", body: JSON.stringify(data) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/enterprise/cost-centers"] });
      setShowDialog(false);
      toast({ title: editing ? "Cost center updated" : "Cost center created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/enterprise/cost-centers/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/enterprise/cost-centers"] });
      setDeletingId(null);
      toast({ title: "Cost center deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const totalBudget = centers.reduce((s, c) => s + (c.monthlyBudgetPaise || 0), 0);
  const totalSpend = centers.reduce((s, c) => s + (c.currentMonthSpendPaise || 0), 0);

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/company-dashboard">
              <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Dashboard</Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <PiggyBank className="h-6 w-6 text-primary" />Cost Centers
              </h1>
              <p className="text-muted-foreground text-sm">Track and control departmental communication spend</p>
            </div>
          </div>
          <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1.5" />New Cost Center</Button>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="py-4 text-center">
              <div className="text-2xl font-bold">{centers.length}</div>
              <div className="text-xs text-muted-foreground">Cost Centers</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4 text-center">
              <div className="text-2xl font-bold text-blue-600">{rupees(totalBudget)}</div>
              <div className="text-xs text-muted-foreground">Total Monthly Budget</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4 text-center">
              <div className={`text-2xl font-bold ${totalSpend > totalBudget ? "text-red-600" : "text-green-600"}`}>
                {rupees(totalSpend)}
              </div>
              <div className="text-xs text-muted-foreground">Current Month Spend</div>
            </CardContent>
          </Card>
        </div>

        {/* Cost center cards */}
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : centers.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <PiggyBank className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No cost centers yet</p>
              <p className="text-xs mt-1">Create cost centers to track spend by department or project.</p>
              <Button className="mt-4" onClick={openCreate}><Plus className="h-4 w-4 mr-1" />Create First Cost Center</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {centers.map(cc => {
              const pct = spendPercent(cc);
              const overBudget = pct >= 100;
              const nearLimit = pct >= cc.alertThresholdPercent && !overBudget;

              return (
                <Card key={cc.id} className={`border ${overBudget ? "border-red-300" : nearLimit ? "border-amber-300" : ""}`}>
                  <CardContent className="py-4 px-5">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{cc.name}</span>
                            <Badge variant="outline" className="text-xs font-mono">{cc.code}</Badge>
                            {!cc.isActive && <Badge variant="secondary" className="text-xs">Inactive</Badge>}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            Alert at {cc.alertThresholdPercent}% of budget
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {(overBudget || nearLimit) && (
                          <AlertTriangle className={`h-4 w-4 ${overBudget ? "text-red-500" : "text-amber-500"}`} />
                        )}
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(cc)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeletingId(cc.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{rupees(cc.currentMonthSpendPaise)} spent</span>
                        <span>{rupees(cc.monthlyBudgetPaise)} budget</span>
                      </div>
                      <Progress
                        value={pct}
                        className={`h-2 ${overBudget ? "[&>div]:bg-red-500" : nearLimit ? "[&>div]:bg-amber-500" : ""}`}
                      />
                      <div className="text-xs text-right font-medium">
                        {pct}% used
                        {overBudget && <span className="text-red-500 ml-1">(over budget!)</span>}
                        {nearLimit && <span className="text-amber-500 ml-1">(approaching limit)</span>}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Create / Edit dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Cost Center" : "New Cost Center"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Sales Team"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Code</Label>
                <Input
                  value={form.code}
                  onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                  placeholder="e.g. SALES01"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Monthly Budget (₹)</Label>
              <Input
                type="number"
                min={0}
                value={form.monthlyBudgetPaise / 100}
                onChange={e => setForm(f => ({ ...f, monthlyBudgetPaise: Math.round(parseFloat(e.target.value || "0") * 100) }))}
                placeholder="0.00"
              />
              <p className="text-xs text-muted-foreground">Set 0 for no budget limit</p>
            </div>
            <div className="space-y-1.5">
              <Label>Alert Threshold (%)</Label>
              <Input
                type="number"
                min={1}
                max={100}
                value={form.alertThresholdPercent}
                onChange={e => setForm(f => ({ ...f, alertThresholdPercent: parseInt(e.target.value) || 80 }))}
              />
              <p className="text-xs text-muted-foreground">Send alert when spend exceeds this % of budget</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button
              onClick={() => save.mutate(form)}
              disabled={save.isPending || !form.name.trim() || !form.code.trim()}
            >
              {save.isPending ? "Saving…" : editing ? "Save Changes" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={deletingId !== null} onOpenChange={open => { if (!open) setDeletingId(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Cost Center?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">This cannot be undone. Spend history associated with this cost center will be unlinked.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deletingId && remove.mutate(deletingId)}
              disabled={remove.isPending}
            >
              {remove.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
