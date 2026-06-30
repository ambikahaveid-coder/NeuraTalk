import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, GitBranch, Users, Plus, Trash2, Pencil, ArrowLeft, MapPin } from "lucide-react";
import { Link } from "wouter";
import { getAuthToken } from "@/hooks/use-auth";

function apiFetch(path: string, opts?: RequestInit) {
  const token = getAuthToken();
  return fetch(path, {
    ...opts,
    credentials: "include",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(opts?.headers ?? {}) },
  }).then(async r => {
    const json = await r.json();
    if (!r.ok) throw new Error(json.error ?? "Request failed");
    return json;
  });
}

interface Department { id: number; name: string; description?: string; costCenter?: string; isActive: boolean; headUserId?: number; }
interface Branch { id: number; name: string; city?: string; state?: string; phone?: string; timezone: string; isHeadquarters: boolean; isActive: boolean; }
interface Team { id: number; name: string; description?: string; departmentId?: number; branchId?: number; isActive: boolean; skills?: string[]; }
interface TeamMember { id: number; userId: number; role?: string; userName: string; userEmail?: string; }

// ── Departments Tab ─────────────────────────────────────────────────────────

function DepartmentsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<Department | null>(null);
  const [form, setForm] = useState({ name: "", description: "", costCenter: "" });

  const { data: items = [], isLoading } = useQuery<Department[]>({
    queryKey: ["/api/enterprise/departments"],
    queryFn: () => apiFetch("/api/enterprise/departments"),
    staleTime: 30_000,
  });

  const save = useMutation({
    mutationFn: (data: typeof form) => editItem
      ? apiFetch(`/api/enterprise/departments/${editItem.id}`, { method: "PATCH", body: JSON.stringify(data) })
      : apiFetch("/api/enterprise/departments", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/enterprise/departments"] });
      toast({ title: editItem ? "Department updated" : "Department created" });
      setOpen(false); setEditItem(null); setForm({ name: "", description: "", costCenter: "" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/enterprise/departments/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/enterprise/departments"] }); toast({ title: "Deleted" }); },
  });

  function openEdit(d: Department) { setEditItem(d); setForm({ name: d.name, description: d.description ?? "", costCenter: d.costCenter ?? "" }); setOpen(true); }
  function openNew() { setEditItem(null); setForm({ name: "", description: "", costCenter: "" }); setOpen(true); }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">Organize your company into departments. Each department can have a cost center code for billing allocation.</p>
        <Button size="sm" onClick={openNew}><Plus className="h-4 w-4 mr-1" />Add Department</Button>
      </div>

      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
        <div className="grid gap-3">
          {items.length === 0 && <Card><CardContent className="py-8 text-center text-muted-foreground">No departments yet. Add your first department above.</CardContent></Card>}
          {items.map(d => (
            <Card key={d.id}>
              <CardContent className="py-3 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-primary" />
                    <span className="font-medium">{d.name}</span>
                    {d.costCenter && <Badge variant="outline" className="text-xs">{d.costCenter}</Badge>}
                    {!d.isActive && <Badge variant="secondary">Inactive</Badge>}
                  </div>
                  {d.description && <p className="text-xs text-muted-foreground mt-0.5 ml-6">{d.description}</p>}
                </div>
                <div className="flex gap-2">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(d)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => remove.mutate(d.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editItem ? "Edit Department" : "New Department"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Department Name *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Sales, Support, Engineering" /></div>
            <div><Label>Cost Center Code</Label><Input value={form.costCenter} onChange={e => setForm(f => ({ ...f, costCenter: e.target.value }))} placeholder="e.g. CC-001" /></div>
            <div><Label>Description</Label><Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => save.mutate(form)} disabled={!form.name || save.isPending}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Branches Tab ─────────────────────────────────────────────────────────────

function BranchesTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<Branch | null>(null);
  const [form, setForm] = useState({ name: "", city: "", state: "", phone: "", timezone: "Asia/Kolkata", isHeadquarters: false });

  const { data: items = [], isLoading } = useQuery<Branch[]>({
    queryKey: ["/api/enterprise/branches"],
    queryFn: () => apiFetch("/api/enterprise/branches"),
    staleTime: 30_000,
  });

  const save = useMutation({
    mutationFn: (data: typeof form) => editItem
      ? apiFetch(`/api/enterprise/branches/${editItem.id}`, { method: "PATCH", body: JSON.stringify(data) })
      : apiFetch("/api/enterprise/branches", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/enterprise/branches"] });
      toast({ title: editItem ? "Branch updated" : "Branch created" });
      setOpen(false); setEditItem(null);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/enterprise/branches/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/enterprise/branches"] }); toast({ title: "Deleted" }); },
  });

  function openEdit(b: Branch) { setEditItem(b); setForm({ name: b.name, city: b.city ?? "", state: b.state ?? "", phone: b.phone ?? "", timezone: b.timezone, isHeadquarters: b.isHeadquarters }); setOpen(true); }
  function openNew() { setEditItem(null); setForm({ name: "", city: "", state: "", phone: "", timezone: "Asia/Kolkata", isHeadquarters: false }); setOpen(true); }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">Physical office locations and branches. Used for timezone-aware call routing.</p>
        <Button size="sm" onClick={openNew}><Plus className="h-4 w-4 mr-1" />Add Branch</Button>
      </div>

      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
        <div className="grid gap-3">
          {items.length === 0 && <Card><CardContent className="py-8 text-center text-muted-foreground">No branches yet.</CardContent></Card>}
          {items.map(b => (
            <Card key={b.id}>
              <CardContent className="py-3 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-primary" />
                    <span className="font-medium">{b.name}</span>
                    {b.isHeadquarters && <Badge className="text-xs">HQ</Badge>}
                    {!b.isActive && <Badge variant="secondary">Inactive</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 ml-6">
                    {[b.city, b.state].filter(Boolean).join(", ")} · {b.timezone}
                    {b.phone && ` · ${b.phone}`}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(b)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => remove.mutate(b.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editItem ? "Edit Branch" : "New Branch"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Branch Name *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Mumbai HQ, Hyderabad Office" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>City</Label><Input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} /></div>
              <div><Label>State</Label><Input value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value }))} /></div>
            </div>
            <div><Label>Phone</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+91-40-XXXXXXXX" /></div>
            <div>
              <Label>Timezone</Label>
              <Select value={form.timezone} onValueChange={v => setForm(f => ({ ...f, timezone: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Asia/Kolkata">Asia/Kolkata (IST)</SelectItem>
                  <SelectItem value="Asia/Dubai">Asia/Dubai (GST)</SelectItem>
                  <SelectItem value="America/New_York">America/New_York (EST)</SelectItem>
                  <SelectItem value="Europe/London">Europe/London (GMT)</SelectItem>
                  <SelectItem value="Asia/Singapore">Asia/Singapore (SGT)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="hq" checked={form.isHeadquarters} onChange={e => setForm(f => ({ ...f, isHeadquarters: e.target.checked }))} />
              <Label htmlFor="hq">This is the headquarters</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => save.mutate(form)} disabled={!form.name || save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Teams Tab ─────────────────────────────────────────────────────────────────

function TeamsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<Team | null>(null);
  const [form, setForm] = useState({ name: "", description: "", departmentId: "", branchId: "" });

  const { data: items = [], isLoading } = useQuery<Team[]>({ queryKey: ["/api/enterprise/teams"], queryFn: () => apiFetch("/api/enterprise/teams"), staleTime: 30_000 });
  const { data: depts = [] } = useQuery<Department[]>({ queryKey: ["/api/enterprise/departments"], queryFn: () => apiFetch("/api/enterprise/departments"), staleTime: 60_000 });
  const { data: brnches = [] } = useQuery<Branch[]>({ queryKey: ["/api/enterprise/branches"], queryFn: () => apiFetch("/api/enterprise/branches"), staleTime: 60_000 });

  const save = useMutation({
    mutationFn: (data: Record<string, unknown>) => editItem
      ? apiFetch(`/api/enterprise/teams/${editItem.id}`, { method: "PATCH", body: JSON.stringify(data) })
      : apiFetch("/api/enterprise/teams", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/enterprise/teams"] }); toast({ title: editItem ? "Team updated" : "Team created" }); setOpen(false); setEditItem(null); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/enterprise/teams/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/enterprise/teams"] }); toast({ title: "Deleted" }); },
  });

  function openEdit(t: Team) { setEditItem(t); setForm({ name: t.name, description: t.description ?? "", departmentId: t.departmentId?.toString() ?? "", branchId: t.branchId?.toString() ?? "" }); setOpen(true); }
  function openNew() { setEditItem(null); setForm({ name: "", description: "", departmentId: "", branchId: "" }); setOpen(true); }

  function submit() {
    const payload: Record<string, unknown> = { ...form };
    if (form.departmentId) payload.departmentId = parseInt(form.departmentId); else delete payload.departmentId;
    if (form.branchId) payload.branchId = parseInt(form.branchId); else delete payload.branchId;
    save.mutate(payload);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">Teams handle specific call queues or skills. Assign agents to teams for routing.</p>
        <Button size="sm" onClick={openNew}><Plus className="h-4 w-4 mr-1" />Add Team</Button>
      </div>

      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
        <div className="grid gap-3">
          {items.length === 0 && <Card><CardContent className="py-8 text-center text-muted-foreground">No teams yet.</CardContent></Card>}
          {items.map(t => {
            const dept = depts.find(d => d.id === t.departmentId);
            const branch = brnches.find(b => b.id === t.branchId);
            return (
              <Card key={t.id}>
                <CardContent className="py-3 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-primary" />
                      <span className="font-medium">{t.name}</span>
                      {dept && <Badge variant="outline" className="text-xs">{dept.name}</Badge>}
                      {branch && <Badge variant="outline" className="text-xs">{branch.name}</Badge>}
                    </div>
                    {t.description && <p className="text-xs text-muted-foreground mt-0.5 ml-6">{t.description}</p>}
                  </div>
                  <div className="flex gap-2">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(t)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => remove.mutate(t.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editItem ? "Edit Team" : "New Team"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Team Name *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Hindi Support, Outbound Sales" /></div>
            <div>
              <Label>Department</Label>
              <Select value={form.departmentId || "none"} onValueChange={v => setForm(f => ({ ...f, departmentId: v === "none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {depts.map(d => <SelectItem key={d.id} value={d.id.toString()}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Branch</Label>
              <Select value={form.branchId || "none"} onValueChange={v => setForm(f => ({ ...f, branchId: v === "none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {brnches.map(b => <SelectItem key={b.id} value={b.id.toString()}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Description</Label><Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={!form.name || save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function OrgStructurePage() {
  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/company-dashboard">
            <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Dashboard</Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Building2 className="h-6 w-6 text-primary" />Organization Structure</h1>
            <p className="text-muted-foreground text-sm">Departments, Branches, and Teams</p>
          </div>
        </div>

        <Tabs defaultValue="departments">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="departments"><Building2 className="h-4 w-4 mr-1" />Departments</TabsTrigger>
            <TabsTrigger value="branches"><GitBranch className="h-4 w-4 mr-1" />Branches</TabsTrigger>
            <TabsTrigger value="teams"><Users className="h-4 w-4 mr-1" />Teams</TabsTrigger>
          </TabsList>
          <TabsContent value="departments" className="mt-4"><DepartmentsTab /></TabsContent>
          <TabsContent value="branches" className="mt-4"><BranchesTab /></TabsContent>
          <TabsContent value="teams" className="mt-4"><TeamsTab /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
