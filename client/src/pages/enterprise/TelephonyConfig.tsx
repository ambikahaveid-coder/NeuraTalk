import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Phone, Clock, Calendar, Layers, Plus, Trash2, Pencil, ArrowLeft, ChevronRight } from "lucide-react";
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

interface IvrMenu { id: number; name: string; greetingText?: string; language: string; isActive: boolean; timeoutSeconds: number; }
interface IvrOption { id: number; menuId: number; digit: string; label: string; action: string; actionTarget?: string; }
interface CallQueue { id: number; name: string; strategy: string; maxQueueSize: number; maxWaitSeconds: number; wrapUpSeconds: number; isActive: boolean; }
interface BusinessHours { id: number; name: string; timezone: string; schedule: Record<string, { open: string; close: string; enabled: boolean }>; afterHoursAction: string; }
interface Holiday { id: number; name: string; date: string; recurring: boolean; }

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_LABELS = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };

// ── Business Hours Tab ───────────────────────────────────────────────────────

function BusinessHoursTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<BusinessHours | null>(null);
  const [form, setForm] = useState({
    name: "Default",
    timezone: "Asia/Kolkata",
    schedule: {
      mon: { open: "09:00", close: "18:00", enabled: true },
      tue: { open: "09:00", close: "18:00", enabled: true },
      wed: { open: "09:00", close: "18:00", enabled: true },
      thu: { open: "09:00", close: "18:00", enabled: true },
      fri: { open: "09:00", close: "18:00", enabled: true },
      sat: { open: "10:00", close: "14:00", enabled: false },
      sun: { open: "00:00", close: "00:00", enabled: false },
    } as Record<string, { open: string; close: string; enabled: boolean }>,
    afterHoursAction: "voicemail",
  });

  const { data: items = [], isLoading } = useQuery<BusinessHours[]>({ queryKey: ["/api/enterprise/business-hours"], queryFn: () => apiFetch("/api/enterprise/business-hours"), staleTime: 30_000 });

  const save = useMutation({
    mutationFn: (data: typeof form) => editItem
      ? apiFetch(`/api/enterprise/business-hours/${editItem.id}`, { method: "PATCH", body: JSON.stringify(data) })
      : apiFetch("/api/enterprise/business-hours", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/enterprise/business-hours"] }); toast({ title: "Saved" }); setOpen(false); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/enterprise/business-hours/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/enterprise/business-hours"] }); toast({ title: "Deleted" }); },
  });

  function openEdit(bh: BusinessHours) { setEditItem(bh); setForm({ name: bh.name, timezone: bh.timezone, schedule: bh.schedule as typeof form.schedule, afterHoursAction: bh.afterHoursAction }); setOpen(true); }
  function openNew() { setEditItem(null); setForm({ name: "Default", timezone: "Asia/Kolkata", schedule: { mon: { open: "09:00", close: "18:00", enabled: true }, tue: { open: "09:00", close: "18:00", enabled: true }, wed: { open: "09:00", close: "18:00", enabled: true }, thu: { open: "09:00", close: "18:00", enabled: true }, fri: { open: "09:00", close: "18:00", enabled: true }, sat: { open: "10:00", close: "14:00", enabled: false }, sun: { open: "00:00", close: "00:00", enabled: false } }, afterHoursAction: "voicemail" }); setOpen(true); }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">Define when your lines are open. Calls outside these hours are handled by the after-hours action.</p>
        <Button size="sm" onClick={openNew}><Plus className="h-4 w-4 mr-1" />Add Schedule</Button>
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
        <div className="grid gap-3">
          {items.length === 0 && <Card><CardContent className="py-8 text-center text-muted-foreground">No business hours configured yet.</CardContent></Card>}
          {items.map(bh => (
            <Card key={bh.id}>
              <CardContent className="py-3 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2"><Clock className="h-4 w-4 text-primary" /><span className="font-medium">{bh.name}</span><Badge variant="outline" className="text-xs">{bh.timezone}</Badge></div>
                  <p className="text-xs text-muted-foreground mt-0.5 ml-6">After hours: {bh.afterHoursAction}</p>
                </div>
                <div className="flex gap-2">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(bh)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => remove.mutate(bh.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editItem ? "Edit Business Hours" : "New Business Hours Schedule"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Schedule Name</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div>
                <Label>Timezone</Label>
                <Select value={form.timezone} onValueChange={v => setForm(f => ({ ...f, timezone: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Asia/Kolkata">Asia/Kolkata (IST)</SelectItem>
                    <SelectItem value="Asia/Dubai">Asia/Dubai (GST)</SelectItem>
                    <SelectItem value="America/New_York">America/New_York (EST)</SelectItem>
                    <SelectItem value="Europe/London">Europe/London (GMT)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              {DAYS.map(day => (
                <div key={day} className="flex items-center gap-3">
                  <div className="w-24 text-sm font-medium">{DAY_LABELS[day]}</div>
                  <Switch checked={form.schedule[day]?.enabled ?? false} onCheckedChange={v => setForm(f => ({ ...f, schedule: { ...f.schedule, [day]: { ...f.schedule[day], enabled: v } } }))} />
                  {form.schedule[day]?.enabled ? (
                    <>
                      <Input type="time" value={form.schedule[day].open} onChange={e => setForm(f => ({ ...f, schedule: { ...f.schedule, [day]: { ...f.schedule[day], open: e.target.value } } }))} className="w-28" />
                      <span className="text-muted-foreground text-sm">to</span>
                      <Input type="time" value={form.schedule[day].close} onChange={e => setForm(f => ({ ...f, schedule: { ...f.schedule, [day]: { ...f.schedule[day], close: e.target.value } } }))} className="w-28" />
                    </>
                  ) : <span className="text-sm text-muted-foreground">Closed</span>}
                </div>
              ))}
            </div>
            <div>
              <Label>After Hours Action</Label>
              <Select value={form.afterHoursAction} onValueChange={v => setForm(f => ({ ...f, afterHoursAction: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="voicemail">Send to Voicemail</SelectItem>
                  <SelectItem value="forward">Forward to Number</SelectItem>
                  <SelectItem value="ivr">Play IVR Menu</SelectItem>
                  <SelectItem value="busy">Play Busy Tone</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => save.mutate(form)} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Holiday Calendar Tab ─────────────────────────────────────────────────────

function HolidaysTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", date: "", recurring: false });

  const { data: items = [], isLoading } = useQuery<Holiday[]>({ queryKey: ["/api/enterprise/holidays"], queryFn: () => apiFetch("/api/enterprise/holidays"), staleTime: 30_000 });

  const create = useMutation({
    mutationFn: (data: typeof form) => apiFetch("/api/enterprise/holidays", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/enterprise/holidays"] }); toast({ title: "Holiday added" }); setOpen(false); setForm({ name: "", date: "", recurring: false }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/enterprise/holidays/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/enterprise/holidays"] }); toast({ title: "Removed" }); },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">Mark public holidays and custom closures. Calls on these days follow after-hours routing.</p>
        <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />Add Holiday</Button>
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
        <div className="grid gap-3">
          {items.length === 0 && <Card><CardContent className="py-8 text-center text-muted-foreground">No holidays configured.</CardContent></Card>}
          {items.map(h => (
            <Card key={h.id}>
              <CardContent className="py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Calendar className="h-4 w-4 text-primary" />
                  <div>
                    <span className="font-medium">{h.name}</span>
                    <span className="text-muted-foreground text-sm ml-2">{h.date}</span>
                    {h.recurring && <Badge variant="outline" className="ml-2 text-xs">Annual</Badge>}
                  </div>
                </div>
                <Button size="icon" variant="ghost" onClick={() => remove.mutate(h.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Holiday</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Holiday Name *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Diwali, Republic Day" /></div>
            <div><Label>Date *</Label><Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></div>
            <div className="flex items-center gap-2"><Switch checked={form.recurring} onCheckedChange={v => setForm(f => ({ ...f, recurring: v }))} /><Label>Repeat annually</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => create.mutate(form)} disabled={!form.name || !form.date || create.isPending}>{create.isPending ? "Saving…" : "Add"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── IVR Builder Tab ──────────────────────────────────────────────────────────

function IVRTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [optionOpen, setOptionOpen] = useState(false);
  const [selectedMenu, setSelectedMenu] = useState<IvrMenu | null>(null);
  const [editMenu, setEditMenu] = useState<IvrMenu | null>(null);
  const [menuForm, setMenuForm] = useState({ name: "", greetingText: "", language: "en-IN", timeoutSeconds: 5 });
  const [optForm, setOptForm] = useState({ digit: "", label: "", action: "queue", actionTarget: "" });

  const { data: menus = [], isLoading } = useQuery<IvrMenu[]>({ queryKey: ["/api/enterprise/ivr"], queryFn: () => apiFetch("/api/enterprise/ivr"), staleTime: 30_000 });
  const { data: options = [] } = useQuery<IvrOption[]>({
    queryKey: ["/api/enterprise/ivr", selectedMenu?.id, "options"],
    queryFn: () => selectedMenu ? apiFetch(`/api/enterprise/ivr/${selectedMenu.id}/options`) : [],
    enabled: !!selectedMenu,
    staleTime: 30_000,
  });

  const saveMenu = useMutation({
    mutationFn: (data: typeof menuForm) => editMenu
      ? apiFetch(`/api/enterprise/ivr/${editMenu.id}`, { method: "PATCH", body: JSON.stringify(data) })
      : apiFetch("/api/enterprise/ivr", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/enterprise/ivr"] }); toast({ title: "IVR menu saved" }); setMenuOpen(false); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMenu = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/enterprise/ivr/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/enterprise/ivr"] }); if (selectedMenu) setSelectedMenu(null); },
  });

  const addOption = useMutation({
    mutationFn: (data: typeof optForm) => apiFetch(`/api/enterprise/ivr/${selectedMenu!.id}/options`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/enterprise/ivr", selectedMenu?.id, "options"] }); toast({ title: "Option added" }); setOptionOpen(false); setOptForm({ digit: "", label: "", action: "queue", actionTarget: "" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteOption = useMutation({
    mutationFn: ({ menuId, optionId }: { menuId: number; optionId: number }) => apiFetch(`/api/enterprise/ivr/${menuId}/options/${optionId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/enterprise/ivr", selectedMenu?.id, "options"] }),
  });

  function openNewMenu() { setEditMenu(null); setMenuForm({ name: "", greetingText: "", language: "en-IN", timeoutSeconds: 5 }); setMenuOpen(true); }
  function openEditMenu(m: IvrMenu) { setEditMenu(m); setMenuForm({ name: m.name, greetingText: m.greetingText ?? "", language: m.language, timeoutSeconds: m.timeoutSeconds }); setMenuOpen(true); }

  return (
    <div className="grid grid-cols-5 gap-4">
      {/* Menu list */}
      <div className="col-span-2 space-y-3">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-semibold">IVR Menus</h3>
          <Button size="sm" variant="outline" onClick={openNewMenu}><Plus className="h-3.5 w-3.5" /></Button>
        </div>
        {isLoading ? <p className="text-xs text-muted-foreground">Loading…</p> : menus.length === 0
          ? <p className="text-xs text-muted-foreground">No IVR menus yet. Create one to get started.</p>
          : menus.map(m => (
            <Card key={m.id} className={`cursor-pointer transition-colors ${selectedMenu?.id === m.id ? "border-primary" : ""}`} onClick={() => setSelectedMenu(m)}>
              <CardContent className="py-2.5 px-3 flex items-center justify-between">
                <div>
                  <div className="font-medium text-sm">{m.name}</div>
                  <div className="text-xs text-muted-foreground">{m.language} · {m.timeoutSeconds}s timeout</div>
                </div>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={e => { e.stopPropagation(); openEditMenu(m); }}><Pencil className="h-3 w-3" /></Button>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={e => { e.stopPropagation(); deleteMenu.mutate(m.id); }}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                  <ChevronRight className="h-4 w-4 self-center text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          ))
        }
      </div>

      {/* Options panel */}
      <div className="col-span-3">
        {!selectedMenu ? (
          <Card className="h-full flex items-center justify-center">
            <CardContent className="text-center text-muted-foreground py-12">
              <Layers className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p>Select an IVR menu to view and edit its options</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="font-semibold">{selectedMenu.name}</h3>
                <p className="text-xs text-muted-foreground">{selectedMenu.greetingText || "No greeting set"}</p>
              </div>
              <Button size="sm" onClick={() => setOptionOpen(true)}><Plus className="h-4 w-4 mr-1" />Add Option</Button>
            </div>
            {options.length === 0 ? <Card><CardContent className="py-6 text-center text-muted-foreground text-sm">No options yet. Add keypad options (1-9, 0, *, #).</CardContent></Card> : (
              <div className="space-y-2">
                {options.map(opt => (
                  <Card key={opt.id}>
                    <CardContent className="py-2.5 px-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary text-sm">{opt.digit}</div>
                        <div>
                          <div className="text-sm font-medium">{opt.label}</div>
                          <div className="text-xs text-muted-foreground">{opt.action}{opt.actionTarget ? ` → ${opt.actionTarget}` : ""}</div>
                        </div>
                      </div>
                      <Button size="icon" variant="ghost" onClick={() => deleteOption.mutate({ menuId: selectedMenu.id, optionId: opt.id })}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* New menu dialog */}
      <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editMenu ? "Edit IVR Menu" : "New IVR Menu"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Menu Name *</Label><Input value={menuForm.name} onChange={e => setMenuForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Main Menu, Sales IVR" /></div>
            <div><Label>Greeting Text (Text-to-Speech)</Label><Input value={menuForm.greetingText} onChange={e => setMenuForm(f => ({ ...f, greetingText: e.target.value }))} placeholder="Welcome to Acme Corp. Press 1 for Sales..." /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Language</Label>
                <Select value={menuForm.language} onValueChange={v => setMenuForm(f => ({ ...f, language: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en-IN">English (India)</SelectItem>
                    <SelectItem value="hi-IN">Hindi</SelectItem>
                    <SelectItem value="te-IN">Telugu</SelectItem>
                    <SelectItem value="ta-IN">Tamil</SelectItem>
                    <SelectItem value="kn-IN">Kannada</SelectItem>
                    <SelectItem value="mr-IN">Marathi</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Timeout (seconds)</Label><Input type="number" value={menuForm.timeoutSeconds} onChange={e => setMenuForm(f => ({ ...f, timeoutSeconds: parseInt(e.target.value) || 5 }))} min={3} max={30} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMenuOpen(false)}>Cancel</Button>
            <Button onClick={() => saveMenu.mutate(menuForm)} disabled={!menuForm.name || saveMenu.isPending}>{saveMenu.isPending ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New option dialog */}
      <Dialog open={optionOpen} onOpenChange={setOptionOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add IVR Option</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Key *</Label>
                <Select value={optForm.digit} onValueChange={v => setOptForm(f => ({ ...f, digit: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select key" /></SelectTrigger>
                  <SelectContent>
                    {["1","2","3","4","5","6","7","8","9","0","*","#"].map(k => <SelectItem key={k} value={k}>Press {k}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Label *</Label><Input value={optForm.label} onChange={e => setOptForm(f => ({ ...f, label: e.target.value }))} placeholder="e.g. Sales" /></div>
            </div>
            <div>
              <Label>Action</Label>
              <Select value={optForm.action} onValueChange={v => setOptForm(f => ({ ...f, action: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="queue">Route to Call Queue</SelectItem>
                  <SelectItem value="team">Route to Team</SelectItem>
                  <SelectItem value="agent">Route to Agent</SelectItem>
                  <SelectItem value="submenu">Go to Sub-Menu</SelectItem>
                  <SelectItem value="forward">Forward to Number</SelectItem>
                  <SelectItem value="voicemail">Send to Voicemail</SelectItem>
                  <SelectItem value="hangup">Hang Up</SelectItem>
                  <SelectItem value="repeat">Repeat Menu</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {["queue","team","agent","submenu","forward"].includes(optForm.action) && (
              <div><Label>Target (ID or phone number)</Label><Input value={optForm.actionTarget} onChange={e => setOptForm(f => ({ ...f, actionTarget: e.target.value }))} placeholder="Queue ID, Team ID, or +91XXXXXXXXXX" /></div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOptionOpen(false)}>Cancel</Button>
            <Button onClick={() => addOption.mutate(optForm)} disabled={!optForm.digit || !optForm.label || addOption.isPending}>{addOption.isPending ? "Adding…" : "Add"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Call Queues Tab ──────────────────────────────────────────────────────────

function CallQueuesTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<CallQueue | null>(null);
  const [form, setForm] = useState({ name: "", strategy: "round_robin", maxQueueSize: 20, maxWaitSeconds: 300, wrapUpSeconds: 30, afterQueueAction: "voicemail" });

  const { data: items = [], isLoading } = useQuery<CallQueue[]>({ queryKey: ["/api/enterprise/call-queues"], queryFn: () => apiFetch("/api/enterprise/call-queues"), staleTime: 30_000 });

  const save = useMutation({
    mutationFn: (data: typeof form) => editItem
      ? apiFetch(`/api/enterprise/call-queues/${editItem.id}`, { method: "PATCH", body: JSON.stringify(data) })
      : apiFetch("/api/enterprise/call-queues", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/enterprise/call-queues"] }); toast({ title: "Saved" }); setOpen(false); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/enterprise/call-queues/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/enterprise/call-queues"] }); toast({ title: "Deleted" }); },
  });

  const STRATEGY_LABELS: Record<string, string> = { round_robin: "Round Robin", least_busy: "Least Busy Agent", priority: "Priority", skills_based: "Skills Based" };

  function openEdit(q: CallQueue) { setEditItem(q); setForm({ name: q.name, strategy: q.strategy, maxQueueSize: q.maxQueueSize, maxWaitSeconds: q.maxWaitSeconds, wrapUpSeconds: q.wrapUpSeconds, afterQueueAction: "voicemail" }); setOpen(true); }
  function openNew() { setEditItem(null); setForm({ name: "", strategy: "round_robin", maxQueueSize: 20, maxWaitSeconds: 300, wrapUpSeconds: 30, afterQueueAction: "voicemail" }); setOpen(true); }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">Configure ACD queues with routing strategies. Callers wait in queue until an agent is available.</p>
        <Button size="sm" onClick={openNew}><Plus className="h-4 w-4 mr-1" />Add Queue</Button>
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
        <div className="grid gap-3">
          {items.length === 0 && <Card><CardContent className="py-8 text-center text-muted-foreground">No call queues configured.</CardContent></Card>}
          {items.map(q => (
            <Card key={q.id}>
              <CardContent className="py-3 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-primary" />
                    <span className="font-medium">{q.name}</span>
                    <Badge variant="outline" className="text-xs">{STRATEGY_LABELS[q.strategy]}</Badge>
                    {!q.isActive && <Badge variant="secondary">Inactive</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 ml-6">Max {q.maxQueueSize} callers · {Math.floor(q.maxWaitSeconds / 60)}m wait · {q.wrapUpSeconds}s wrap-up</p>
                </div>
                <div className="flex gap-2">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(q)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => remove.mutate(q.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editItem ? "Edit Queue" : "New Call Queue"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Queue Name *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Sales Queue, Tech Support" /></div>
            <div>
              <Label>Routing Strategy</Label>
              <Select value={form.strategy} onValueChange={v => setForm(f => ({ ...f, strategy: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="round_robin">Round Robin</SelectItem>
                  <SelectItem value="least_busy">Least Busy Agent</SelectItem>
                  <SelectItem value="priority">Priority</SelectItem>
                  <SelectItem value="skills_based">Skills Based</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Max Queue Size</Label><Input type="number" value={form.maxQueueSize} onChange={e => setForm(f => ({ ...f, maxQueueSize: parseInt(e.target.value) || 20 }))} /></div>
              <div><Label>Max Wait (sec)</Label><Input type="number" value={form.maxWaitSeconds} onChange={e => setForm(f => ({ ...f, maxWaitSeconds: parseInt(e.target.value) || 300 }))} /></div>
              <div><Label>Wrap-up (sec)</Label><Input type="number" value={form.wrapUpSeconds} onChange={e => setForm(f => ({ ...f, wrapUpSeconds: parseInt(e.target.value) || 30 }))} /></div>
            </div>
            <div>
              <Label>When Queue Full / Timeout</Label>
              <Select value={form.afterQueueAction} onValueChange={v => setForm(f => ({ ...f, afterQueueAction: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="voicemail">Send to Voicemail</SelectItem>
                  <SelectItem value="forward">Forward to Number</SelectItem>
                  <SelectItem value="hangup">Hang Up</SelectItem>
                </SelectContent>
              </Select>
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

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function TelephonyConfigPage() {
  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/company-dashboard">
            <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Dashboard</Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Phone className="h-6 w-6 text-primary" />Telephony Configuration</h1>
            <p className="text-muted-foreground text-sm">IVR Menus, Call Queues, Business Hours, Holiday Calendar</p>
          </div>
        </div>

        <Tabs defaultValue="business-hours">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="business-hours"><Clock className="h-4 w-4 mr-1" />Business Hours</TabsTrigger>
            <TabsTrigger value="holidays"><Calendar className="h-4 w-4 mr-1" />Holidays</TabsTrigger>
            <TabsTrigger value="ivr"><Layers className="h-4 w-4 mr-1" />IVR Builder</TabsTrigger>
            <TabsTrigger value="queues"><Phone className="h-4 w-4 mr-1" />Call Queues</TabsTrigger>
          </TabsList>
          <TabsContent value="business-hours" className="mt-4"><BusinessHoursTab /></TabsContent>
          <TabsContent value="holidays" className="mt-4"><HolidaysTab /></TabsContent>
          <TabsContent value="ivr" className="mt-4"><IVRTab /></TabsContent>
          <TabsContent value="queues" className="mt-4"><CallQueuesTab /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
