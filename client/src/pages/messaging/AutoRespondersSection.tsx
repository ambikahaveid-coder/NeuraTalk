import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Loader2, MessageSquareReply, Pencil, Phone, Plus, Trash2, Link as LinkIcon, X, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { getAuthToken } from "@/hooks/use-auth";

/**
 * Bot auto-replies: keywords (or a tapped button) get an instant answer from
 * the business, with up to 3 buttons or a form. Buttons can lead to other
 * auto-replies, so a business can build a simple menu.
 */

type ButtonDef = { type: "quick_reply" | "url" | "call"; id?: string; title: string; url?: string; phone?: string };
interface Responder {
  id: number; name: string; triggerType: "keyword" | "button"; matchType: "exact" | "contains" | "starts_with";
  keywords: string[]; replyText: string; buttons: ButtonDef[]; formId: number | null; productIds: number[]; priority: number;
  cooldownSeconds: number; isActive: boolean; hits?: number; lastHitAt?: string | null;
}
interface Run { id: number; responderName: string; matched: string; customerName: string | null; createdAt: string }
interface FormLite { id: number; name: string; title: string }
interface Product { id: number; name: string; pricePaise: number | null; imageUrl: string | null; isAvailable: boolean }
const price = (p: number | null) => (p == null ? "Price on request" : `₹${(p / 100).toLocaleString("en-IN")}`);

const MATCH_LABEL: Record<string, string> = {
  contains: "Message contains the word",
  exact: "Message is exactly the word",
  starts_with: "Message starts with the word",
};

async function call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${getAuthToken()}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof json?.error === "string" ? json.error : `Request failed (${res.status})`);
  return json as T;
}

const blank = (): Omit<Responder, "id"> => ({
  name: "", triggerType: "keyword", matchType: "contains", keywords: [], replyText: "", buttons: [],
  formId: null, productIds: [], priority: 100, cooldownSeconds: 60, isActive: true,
});

// Button ids are unique per business so a tap starts exactly the auto-reply chosen for it.
const slug = (s: string) => `${s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30) || "btn"}_${Math.random().toString(36).slice(2, 7)}`;

/** The reply as the customer will see it: a chat bubble with buttons under it. */
function ReplyPreview({ text, buttons, formTitle, products = [] }: { text: string; buttons: ButtonDef[]; formTitle?: string; products?: Product[] }) {
  const shown = text.replace(/\{\{\s*first_name\s*\}\}/gi, "Ravi").replace(/\{\{\s*name\s*\}\}/gi, "Ravi Kumar");
  return (
    <div className="rounded-lg bg-[#efeae2] dark:bg-[#0b141a] p-3">
      <div className="max-w-[85%] rounded-lg rounded-tl-none bg-white dark:bg-[#202c33] px-3 py-2 shadow-sm">
        <p className="whitespace-pre-wrap text-sm text-[#111b21] dark:text-[#e9edef]">{shown || "Your reply appears here"}</p>
        <p className="mt-1 text-right text-[10px] text-[#667781] dark:text-[#8696a0]">auto-reply · now</p>
      </div>
      {buttons.map((b, i) => (
        <div key={i} className="mt-1 max-w-[85%] rounded-lg bg-white dark:bg-[#202c33] py-2 text-center text-sm font-medium text-[#027eb5] dark:text-[#53bdeb] shadow-sm">
          {b.type === "url" ? <LinkIcon className="mr-1 inline h-3.5 w-3.5" /> : b.type === "call" ? <Phone className="mr-1 inline h-3.5 w-3.5" /> : <MessageSquareReply className="mr-1 inline h-3.5 w-3.5" />}
          {b.title || "Button"}
        </div>
      ))}
      {products.length > 0 && (
        <div className="mt-1 flex max-w-[85%] gap-1.5 overflow-x-auto">
          {products.map((p) => (
            <div key={p.id} className="w-28 shrink-0 overflow-hidden rounded-lg bg-white shadow-sm dark:bg-[#202c33]">
              <div className="flex h-16 items-center justify-center bg-muted text-xl">{p.imageUrl ? <img src={p.imageUrl} alt="" className="h-16 w-full object-cover" /> : "🛍️"}</div>
              <p className="truncate px-2 pt-1 text-xs font-medium text-[#111b21] dark:text-[#e9edef]">{p.name}</p>
              <p className="px-2 pb-1 text-xs text-[#667781] dark:text-[#8696a0]">{price(p.pricePaise)}</p>
            </div>
          ))}
        </div>
      )}
      {formTitle && (
        <div className="mt-1 max-w-[85%] rounded-lg bg-white dark:bg-[#202c33] px-3 py-2 text-sm shadow-sm">📝 {formTitle} <span className="text-xs text-muted-foreground">· form</span></div>
      )}
    </div>
  );
}

function Editor({ initial, forms, products, buttonIds, onCancel, onSave, saving }: {
  initial: Omit<Responder, "id"> & { id?: number }; forms: FormLite[]; products: Product[]; buttonIds: { id: string; title: string }[];
  onCancel: () => void; onSave: (r: Omit<Responder, "id"> & { id?: number }) => void; saving: boolean;
}) {
  const [r, setR] = useState(initial);
  const [word, setWord] = useState("");
  const set = <K extends keyof typeof r>(k: K, v: (typeof r)[K]) => setR((x) => ({ ...x, [k]: v }));
  const addWord = (raw: string) => {
    const parts = raw.split(",").map((w) => w.trim()).filter(Boolean);
    if (parts.length) set("keywords", Array.from(new Set([...r.keywords, ...parts])).slice(0, 20));
    setWord("");
  };
  const setButton = (i: number, b: Partial<ButtonDef>) => set("buttons", r.buttons.map((x, j) => (j === i ? { ...x, ...b } : x)));
  const formTitle = forms.find((f) => f.id === r.formId)?.title;
  const chosen = (r.productIds ?? []).map((id) => products.find((p) => p.id === id)).filter((p): p is Product => Boolean(p));

  return (
    <Card data-testid="auto-responder-editor">
      <CardHeader>
        <CardTitle className="text-base">{initial.id ? "Edit auto-reply" : "New auto-reply"}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ar-name">Name (only you see this)</Label>
            <Input id="ar-name" value={r.name} maxLength={60} placeholder="Prices" onChange={(e) => set("name", e.target.value)} data-testid="input-ar-name" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Reply when</Label>
              <Select value={r.triggerType} onValueChange={(v) => setR((x) => ({ ...x, triggerType: v as Responder["triggerType"], keywords: [] }))}>
                <SelectTrigger data-testid="select-ar-trigger"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="keyword">The customer types a word</SelectItem>
                  <SelectItem value="button">The customer taps a button</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {r.triggerType === "keyword" && (
              <div className="space-y-1.5">
                <Label>How to match</Label>
                <Select value={r.matchType} onValueChange={(v) => set("matchType", v as Responder["matchType"])}>
                  <SelectTrigger data-testid="select-ar-match"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(MATCH_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ar-words">{r.triggerType === "keyword" ? "Words (any language; press Enter after each)" : "Button"}</Label>
            {r.triggerType === "keyword" ? (
              <Input id="ar-words" value={word} placeholder="price, rate, ధర, कीमत" onChange={(e) => setWord(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addWord(word); } }}
                onBlur={() => word && addWord(word)} data-testid="input-ar-keyword" />
            ) : buttonIds.length ? (
              <Select value="" onValueChange={(v) => set("keywords", Array.from(new Set([...r.keywords, v])))}>
                <SelectTrigger data-testid="select-ar-button"><SelectValue placeholder="Choose a button from another auto-reply" /></SelectTrigger>
                <SelectContent>
                  {buttonIds.map((b) => <SelectItem key={b.id} value={b.id}>{b.title}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm text-muted-foreground">First add a "Reply" button to another auto-reply. Then you can answer the tap here.</p>
            )}
            <div className="flex flex-wrap gap-1.5">
              {r.keywords.map((k) => (
                <Badge key={k} variant="secondary" className="gap-1">
                  {r.triggerType === "button" ? buttonIds.find((b) => b.id === k)?.title ?? k : k}
                  <button type="button" aria-label={`Remove ${k}`} onClick={() => set("keywords", r.keywords.filter((x) => x !== k))}><X className="h-3 w-3" /></button>
                </Badge>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ar-reply">Reply</Label>
            <Textarea id="ar-reply" rows={4} maxLength={1000} value={r.replyText} onChange={(e) => set("replyText", e.target.value)}
              placeholder={"Hi {{first_name}}! Kaju Barfi is ₹450 for 500 g."} data-testid="input-ar-reply" />
            <p className="text-xs text-muted-foreground">Use {"{{first_name}}"} or {"{{name}}"} for the customer's name. Customers read the reply in their own language.</p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Buttons (up to 3)</Label>
              <Button type="button" variant="outline" size="sm" disabled={r.buttons.length >= 3}
                onClick={() => set("buttons", [...r.buttons, { type: "quick_reply", title: "" }])} data-testid="button-ar-add-button">
                <Plus className="mr-1 h-3.5 w-3.5" /> Add button
              </Button>
            </div>
            {r.buttons.map((b, i) => (
              <div key={i} className="grid gap-2 rounded-md border p-2 sm:grid-cols-[130px_1fr_1fr_auto]">
                <Select value={b.type} onValueChange={(v) => setButton(i, { type: v as ButtonDef["type"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="quick_reply">Reply</SelectItem>
                    <SelectItem value="url">Open link</SelectItem>
                    <SelectItem value="call">Call number</SelectItem>
                  </SelectContent>
                </Select>
                <Input placeholder="Button text" maxLength={25} value={b.title} onChange={(e) => setButton(i, { title: e.target.value })} />
                {b.type === "url" ? <Input placeholder="https://…" value={b.url ?? ""} onChange={(e) => setButton(i, { url: e.target.value })} />
                  : b.type === "call" ? <Input placeholder="+91…" value={b.phone ?? ""} onChange={(e) => setButton(i, { phone: e.target.value })} />
                  : <p className="self-center text-xs text-muted-foreground">Can start another auto-reply</p>}
                <Button type="button" variant="ghost" size="icon" aria-label="Remove button" onClick={() => set("buttons", r.buttons.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>

          {products.length > 0 && (
            <div className="space-y-1.5">
              <Label>Also send products from your catalog (optional, up to 10)</Label>
              <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto rounded-md border p-2" data-testid="ar-products">
                {products.filter((p) => p.isAvailable).map((p) => {
                  const on = (r.productIds ?? []).includes(p.id);
                  return (
                    <button key={p.id} type="button" data-testid={`ar-product-${p.id}`}
                      onClick={() => set("productIds", on ? r.productIds.filter((x) => x !== p.id) : [...(r.productIds ?? []), p.id].slice(0, 10))}
                      className={`rounded-full border px-3 py-1 text-xs ${on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                      {p.name} · {price(p.pricePaise)}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">Customers see a card with photo and price and can add it to an order. Sold-out items are skipped automatically.</p>
            </div>
          )}

          {forms.length > 0 && (
            <div className="space-y-1.5">
              <Label>Also send a form (optional)</Label>
              <Select value={r.formId ? String(r.formId) : "none"} onValueChange={(v) => set("formId", v === "none" ? null : Number(v))}>
                <SelectTrigger data-testid="select-ar-form"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No form</SelectItem>
                  {forms.map((f) => <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ar-cooldown">Don't repeat to the same customer for</Label>
              <Select value={String(r.cooldownSeconds)} onValueChange={(v) => set("cooldownSeconds", Number(v))}>
                <SelectTrigger id="ar-cooldown"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Always reply</SelectItem>
                  <SelectItem value="60">1 minute</SelectItem>
                  <SelectItem value="600">10 minutes</SelectItem>
                  <SelectItem value="3600">1 hour</SelectItem>
                  <SelectItem value="86400">1 day</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ar-priority">If two auto-replies match, higher number wins</Label>
              <Input id="ar-priority" type="number" min={1} max={1000} value={r.priority} onChange={(e) => set("priority", Math.max(1, Math.min(1000, Number(e.target.value) || 100)))} />
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={() => onSave({ ...r, buttons: r.buttons.map((b) => (b.type === "quick_reply" ? { ...b, id: b.id || slug(b.title) } : b)) })}
              disabled={saving || !r.name.trim() || !r.keywords.length || !r.replyText.trim()} data-testid="button-ar-save">
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
            </Button>
            <Button variant="outline" onClick={onCancel}>Cancel</Button>
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">What the customer sees</p>
          <ReplyPreview text={r.replyText} buttons={r.buttons} formTitle={formTitle} products={chosen} />
        </div>
      </CardContent>
    </Card>
  );
}

export default function AutoRespondersSection({ base }: { base: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const key = [base, "auto-responders"];
  const list = useQuery<{ responders: Responder[]; pausedByNeuraTalk?: { reason: string | null } | null; limits: { maxResponders: number; maxRepliesPerWindow: number; windowMinutes: number } }>({
    queryKey: key, queryFn: () => call("GET", `${base}/auto-responders`), retry: false,
  });
  const runs = useQuery<{ runs: Run[] }>({ queryKey: [...key, "runs"], queryFn: () => call("GET", `${base}/auto-responders/runs?limit=20`), retry: false });
  const forms = useQuery<{ forms: FormLite[] }>({ queryKey: [base, "forms"], queryFn: () => call("GET", `${base}/forms`), retry: false });
  const catalog = useQuery<{ items: Product[] }>({ queryKey: [base, "catalog"], queryFn: () => call("GET", `${base}/catalog`), retry: false });
  const [editing, setEditing] = useState<(Omit<Responder, "id"> & { id?: number }) | null>(null);
  const [testText, setTestText] = useState("");
  const [testResult, setTestResult] = useState<{ text: string; match: { responder: Responder; matched: string; reply: string } | null } | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const fail = (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" });
  const save = useMutation({
    mutationFn: ({ id, hits: _h, lastHitAt: _l, ...body }: Omit<Responder, "id"> & { id?: number }) =>
      id ? call("PUT", `${base}/auto-responders/${id}`, body) : call("POST", `${base}/auto-responders`, body),
    onSuccess: () => { toast({ title: "Auto-reply saved" }); setEditing(null); refresh(); },
    onError: fail,
  });
  const toggle = useMutation({
    mutationFn: ({ id, hits: _h, lastHitAt: _l, ...r }: Responder) => call("PUT", `${base}/auto-responders/${id}`, { ...r, isActive: !r.isActive }),
    onSuccess: refresh, onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: number) => call("DELETE", `${base}/auto-responders/${id}`),
    onSuccess: () => { toast({ title: "Auto-reply deleted" }); refresh(); }, onError: fail,
  });
  const test = useMutation({
    mutationFn: (text: string) => call<{ match: { responder: Responder; matched: string; reply: string } | null }>("POST", `${base}/auto-responders/test`, { text }),
    onSuccess: (d, text) => setTestResult({ text, match: d.match }), onError: fail,
  });

  const responders = list.data?.responders ?? [];
  const buttonIds = responders.flatMap((r) => r.buttons.filter((b) => b.type === "quick_reply" && b.id).map((b) => ({ id: b.id!, title: `${b.title} (in "${r.name}")` })));
  const max = list.data?.limits.maxResponders ?? 50;

  if (editing) {
    return <Editor initial={{ ...editing, productIds: editing.productIds ?? [] }} forms={forms.data?.forms ?? []} products={catalog.data?.items ?? []} buttonIds={buttonIds} onCancel={() => setEditing(null)} onSave={(r) => save.mutate(r)} saving={save.isPending} />;
  }

  return (
    <div className="space-y-4" data-testid="auto-responders">
      {list.data?.pausedByNeuraTalk && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" data-testid="bots-paused-banner">
          <strong>NeuraTalk paused your auto-replies.</strong> Customers get no automatic answers until this is lifted.
          {list.data.pausedByNeuraTalk.reason ? ` Reason: ${list.data.pausedByNeuraTalk.reason}` : ""}
          {/support@/i.test(list.data.pausedByNeuraTalk.reason ?? "") ? "" : " Contact support@neuratalk.in."}
        </div>
      )}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base"><Bot className="h-4 w-4" /> Auto-reply bot</CardTitle>
            <CardDescription>
              When a customer types a word like "price" or taps a button, NeuraTalk answers at once as your business, day and night.
              It never answers your own messages, answers each message once, and sends at most {list.data?.limits.maxRepliesPerWindow ?? 5} automatic replies to a customer in {list.data?.limits.windowMinutes ?? 10} minutes.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setEditing(blank())} disabled={responders.length >= max} data-testid="button-ar-new">
            <Plus className="mr-1 h-4 w-4" /> New
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {list.isLoading ? <Loader2 className="mx-auto h-5 w-5 animate-spin" />
            : list.error ? <p className="text-sm text-destructive">{(list.error as Error).message}</p>
            : responders.length === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                No auto-replies yet. Start with the questions customers ask most: prices, timings, location, menu.
              </div>
            ) : responders.map((r) => (
              <div key={r.id} className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-start" data-testid={`ar-row-${r.id}`}>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.name}</span>
                    {!r.isActive && <Badge variant="outline">Off</Badge>}
                    <span className="text-xs text-muted-foreground">{r.hits ?? 0} replies sent{r.lastHitAt ? ` · last ${new Date(r.lastHitAt).toLocaleString()}` : ""}</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <span className="text-xs text-muted-foreground">{r.triggerType === "button" ? "Button:" : MATCH_LABEL[r.matchType] + ":"}</span>
                    {r.keywords.map((k) => <Badge key={k} variant="secondary">{r.triggerType === "button" ? buttonIds.find((b) => b.id === k)?.title.split(" (in")[0] ?? k : k}</Badge>)}
                  </div>
                  <p className="line-clamp-2 text-sm text-muted-foreground">{r.replyText}</p>
                  {r.buttons.length > 0 && <p className="text-xs text-muted-foreground">Buttons: {r.buttons.map((b) => b.title).join(" · ")}</p>}
                  {(r.productIds?.length ?? 0) > 0 && <p className="text-xs text-muted-foreground">Products: {r.productIds.map((id) => catalog.data?.items.find((p) => p.id === id)?.name ?? `#${id}`).join(" · ")}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={r.isActive} onCheckedChange={() => toggle.mutate(r)} aria-label={`Turn ${r.name} ${r.isActive ? "off" : "on"}`} />
                  <Button variant="ghost" size="icon" aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" aria-label={`Delete ${r.name}`} onClick={() => { if (confirm(`Delete "${r.name}"?`)) remove.mutate(r.id); }}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            ))}
        </CardContent>
      </Card>

      {responders.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Zap className="h-4 w-4" /> Try it</CardTitle>
            <CardDescription>Type what a customer might write. Nothing is sent.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (testText.trim()) test.mutate(testText); }}>
              <Input value={testText} onChange={(e) => setTestText(e.target.value)} placeholder="what is the price?" data-testid="input-ar-test" />
              <Button type="submit" variant="outline" disabled={test.isPending || !testText.trim()}>Test</Button>
            </form>
            {testResult && (testResult.match ? (
              <div className="space-y-2">
                <p className="text-sm">"<strong>{testResult.match.responder.name}</strong>" answers (matched "{testResult.match.matched}"):</p>
                <ReplyPreview text={testResult.match.reply} buttons={testResult.match.responder.buttons} />
              </div>
            ) : <p className="text-sm text-muted-foreground">No auto-reply answers "{testResult.text}". Your team sees it in the inbox as usual.</p>)}
          </CardContent>
        </Card>
      )}

      {(runs.data?.runs.length ?? 0) > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Recent automatic replies</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {runs.data!.runs.map((x) => (
              <p key={x.id} className="text-sm">
                <span className="text-muted-foreground">{new Date(x.createdAt).toLocaleString()}</span> · {x.customerName ?? "Customer"} wrote "{x.matched}" → {x.responderName}
              </p>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
