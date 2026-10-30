import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { Switch } from "@/components/ui/switch";
import { useUpload } from "@/hooks/use-upload";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2, ClipboardCheck, Copy, FileText, ImagePlus, KeyRound, Link2, Loader2, Megaphone, Plus, Send, ShieldCheck, ShoppingBag, Trash2, UserPlus, Users, XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { getAuthToken, useAuth } from "@/hooks/use-auth";
import { QUALITY_LABEL, NOTICE_LABEL, rupees, type AccountHealth } from "@/lib/account-health";

/**
 * Business Messaging studio: everything a business needs to message its
 * customers inside NeuraTalk -- customers & consent, templates, approvals
 * (a second person approves), audiences, campaigns, and one-time codes.
 * Delivered/read numbers come from the real in-app delivery receipts.
 */

type Section = "profile" | "catalog" | "customers" | "templates" | "approvals" | "audiences" | "campaigns" | "codes";

interface Customer {
  id: number; name: string | null; phone: string | null; email: string | null;
  linkedUserId: number | null; status: string; createdAt: string;
}
interface Template { id: number; name: string; category: string; versionCount?: number; createdAt: string }
interface TemplateVersion { id: number; templateId: number; versionNumber: number; status: string; content: string; language: string }
interface ApprovalRequest { id: number; resourceType: string; resourceId: number; requestedBy: number; status: string; createdAt: string; reason: string | null }
interface Audience { id: number; name: string; memberCount?: number; status: string }
interface Campaign {
  id: number; name: string; category: string; status: string; templateVersionId: number | null; audienceId: number | null;
  createdAt: string; completedAt: string | null;
}
interface Consent { channel: string; status: string; source: string | null }

const CATEGORY_LABEL: Record<string, string> = {
  marketing: "Offers & promotions",
  utility: "Order & account updates",
  authentication: "Verification codes",
};

async function call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${getAuthToken()}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof json?.error === "string" ? json.error : json?.message || `Request failed (${res.status})`;
    const error = new Error(message) as Error & { status?: number };
    error.status = res.status;
    throw error;
  }
  return json as T;
}

function variablesFrom(content: string) {
  const names = Array.from(new Set(Array.from(content.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g)).map((m) => m[1])));
  // {{name}} is filled from the customer record; {{code}} is the one-time code.
  return names.map((name) => ({ name, type: "text", required: name !== "name" }));
}

function statusBadge(status: string) {
  const tone: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    approved: "default", completed: "default", verified: "default", granted: "default", active: "secondary",
    pending: "outline", pending_approval: "outline", draft: "outline", running: "secondary", scheduled: "secondary",
    rejected: "destructive", failed: "destructive", cancelled: "destructive", revoked: "destructive", archived: "outline",
  };
  return <Badge variant={tone[status] ?? "outline"} className="capitalize">{status.replace(/_/g, " ")}</Badge>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground py-6 text-center">{children}</p>;
}

export default function MessagingStudio({ businessId }: { businessId: number }) {
  const [section, setSection] = useState<Section>("profile");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const base = `/api/business/${businessId}`;
  const v1 = `/api/v1/business/${businessId}`;

  const customersQuery = useQuery<{ customers: Customer[] }>({ queryKey: [base, "customers"], queryFn: () => call("GET", `${base}/customers?limit=200`), enabled: businessId > 0, retry: false });
  const accessDenied = (customersQuery.error as { status?: number } | null)?.status === 403;

  const grantAccess = useMutation({
    mutationFn: async () => {
      const grantable = await call<{ permissions: string[] }>("GET", `${base}/rbac/grantable-permissions`);
      return call("POST", `${base}/rbac/grant-business-access`, { permissions: grantable.permissions });
    },
    onSuccess: () => { toast({ title: "Business messaging is on" }); queryClient.invalidateQueries(); },
    onError: (e: Error) => toast({ title: "Could not turn it on", description: e.message, variant: "destructive" }),
  });

  if (businessId <= 0) return null;

  if (accessDenied) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Turn on Business Messaging</CardTitle>
          <CardDescription>
            Send order updates, verification codes and offers to your customers inside NeuraTalk, and chat with them from the Inbox.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => grantAccess.mutate()} disabled={grantAccess.isPending} data-testid="button-enable-business-messaging">
            {grantAccess.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
            Turn on for my account
          </Button>
          <p className="text-xs text-muted-foreground mt-3">Only company admins can do this. You can give teammates access from the Team tab.</p>
        </CardContent>
      </Card>
    );
  }

  const sections: { id: Section; label: string; icon: React.ReactNode }[] = [
    { id: "profile", label: "Chat link & auto replies", icon: <Link2 className="w-4 h-4" /> },
    { id: "catalog", label: "Catalog", icon: <ShoppingBag className="w-4 h-4" /> },
    { id: "customers", label: "Customers", icon: <Users className="w-4 h-4" /> },
    { id: "templates", label: "Templates", icon: <FileText className="w-4 h-4" /> },
    { id: "approvals", label: "Approvals", icon: <ClipboardCheck className="w-4 h-4" /> },
    { id: "audiences", label: "Audiences", icon: <UserPlus className="w-4 h-4" /> },
    { id: "campaigns", label: "Campaigns", icon: <Megaphone className="w-4 h-4" /> },
    { id: "codes", label: "Verification codes", icon: <KeyRound className="w-4 h-4" /> },
  ];

  const props = { base, v1, toast, queryClient };
  return (
    <div className="space-y-4" data-testid="messaging-studio">
      <AccountHealthCard base={base} />
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Messaging sections">
        {sections.map((s) => (
          <Button
            key={s.id}
            role="tab"
            aria-selected={section === s.id}
            variant={section === s.id ? "default" : "outline"}
            size="sm"
            onClick={() => setSection(s.id)}
            data-testid={`studio-tab-${s.id}`}
          >
            {s.icon}<span className="ml-2">{s.label}</span>
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Messages are delivered inside the customer's NeuraTalk app with a notification. Customers who are not on NeuraTalk are skipped and never charged.
      </p>
      {section === "profile" && <ProfileSection {...props} businessId={businessId} />}
      {section === "catalog" && <CatalogSection {...props} />}
      {section === "customers" && <CustomersSection {...props} customers={customersQuery.data?.customers ?? []} loading={customersQuery.isLoading} />}
      {section === "templates" && <TemplatesSection {...props} />}
      {section === "approvals" && <ApprovalsSection {...props} />}
      {section === "audiences" && <AudiencesSection {...props} customers={customersQuery.data?.customers ?? []} />}
      {section === "campaigns" && <CampaignsSection {...props} />}
      {section === "codes" && <CodesSection {...props} customers={customersQuery.data?.customers ?? []} />}
    </div>
  );
}

/**
 * Quality rating and daily messaging limit -- how many customers a day this
 * business may start messaging, earned by keeping quality high.
 */
function AccountHealthCard({ base }: { base: string }) {
  const q = useQuery<{ health: AccountHealth }>({ queryKey: [base, "messaging", "health"], queryFn: () => call("GET", `${base}/messaging/health`), retry: false });
  const h = q.data?.health;
  if (q.isLoading) return null;
  if (!h) return null;
  const quality = QUALITY_LABEL[h.quality];
  const usedPct = Math.min(100, Math.round((h.usedLast24h / Math.max(1, h.effectiveLimit)) * 100));
  return (
    <Card data-testid="card-account-health">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="w-4 h-4" /> Account health
        </CardTitle>
        <CardDescription>Keep quality high to reach more customers each day.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Quality (last 7 days)</p>
            <span className={`inline-block mt-1 rounded-full px-3 py-1 text-sm font-semibold ${quality.className}`} data-testid="text-health-quality">{quality.text}</span>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Daily limit</p>
            <p className="mt-1 text-lg font-semibold" data-testid="text-health-limit">
              {h.effectiveLimit.toLocaleString("en-IN")} customers
              {h.pinned && <span className="ml-2 text-xs font-normal text-muted-foreground">set by NeuraTalk</span>}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Reached in the last 24 hours</p>
            <p className="mt-1 text-lg font-semibold">{h.usedLast24h.toLocaleString("en-IN")}</p>
            <div className="mt-1 h-1.5 w-full rounded bg-muted" aria-hidden="true">
              <div className={`h-1.5 rounded ${usedPct >= 90 ? "bg-red-500" : "bg-primary"}`} style={{ width: `${usedPct}%` }} />
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          This week: {h.reachedLast7d.toLocaleString("en-IN")} customers reached · {h.negative.blocks} blocked you · {h.negative.optOuts} turned off offers · {h.negative.reports} reported you
        </p>
        {h.restriction && (
          <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" role="alert">
            <strong>Campaigns paused by NeuraTalk.</strong> {h.restriction.reason}
          </div>
        )}
        <p className="text-sm" data-testid="text-health-advice">{h.advice}</p>
        {(h.notices?.length ?? 0) > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Messages from NeuraTalk</p>
            {h.notices!.slice(0, 5).map((n) => (
              <p key={n.id} className="text-xs">
                <span className="font-semibold">{NOTICE_LABEL[n.action]}</span> · {new Date(n.createdAt).toLocaleDateString()} — {n.reason}
              </p>
            ))}
          </div>
        )}
        {h.prices && (
          <p className="text-xs text-muted-foreground">
            Prices per delivered message: offers {rupees(h.prices.marketingPaise)} · order updates {rupees(h.prices.utilityPaise)} · codes {rupees(h.prices.otpPaise)}
          </p>
        )}
        <p className="text-xs text-muted-foreground">Replies to customers who message you first never count toward the limit.</p>
      </CardContent>
    </Card>
  );
}

type SectionProps = {
  base: string; v1: string;
  toast: ReturnType<typeof useToast>["toast"];
  queryClient: ReturnType<typeof useQueryClient>;
};

function useAction<TArgs>(props: SectionProps, fn: (args: TArgs) => Promise<unknown>, success: string, invalidate: unknown[][]) {
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      props.toast({ title: success });
      invalidate.forEach((key) => props.queryClient.invalidateQueries({ queryKey: key }));
    },
    onError: (e: Error) => props.toast({ title: "Something went wrong", description: e.message, variant: "destructive" }),
  });
}

// ---------------------------------------------------------------- customers
function CustomersSection(props: SectionProps & { customers: Customer[]; loading: boolean }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const add = useAction(props, () => call("POST", `${props.base}/customers`, {
    name: name || undefined, phone: phone || undefined, email: email || undefined,
  }), "Customer added", [[props.base, "customers"]]);

  return (
    <div className="grid lg:grid-cols-[320px_1fr] gap-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Add a customer</CardTitle>
          <CardDescription>If their number is on NeuraTalk, they are connected automatically.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <div><Label htmlFor="cust-name">Name</Label><Input id="cust-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label htmlFor="cust-phone">Mobile number</Label><Input id="cust-phone" inputMode="tel" placeholder="+91 98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          <div><Label htmlFor="cust-email">Email (optional)</Label><Input id="cust-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <Button
            className="w-full"
            disabled={add.isPending || (!name.trim() && !phone.trim() && !email.trim())}
            onClick={() => add.mutate(undefined as never, { onSuccess: () => { setName(""); setPhone(""); setEmail(""); } })}
            data-testid="button-add-customer"
          >
            {add.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}Add customer
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Customers ({props.customers.length})</CardTitle></CardHeader>
        <CardContent>
          {props.loading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : props.customers.length === 0 ? <Empty>No customers yet.</Empty> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Contact</TableHead><TableHead>On NeuraTalk</TableHead><TableHead /></TableRow></TableHeader>
                <TableBody>
                  {props.customers.map((c) => (
                    <TableRow key={c.id} data-state={selected === c.id ? "selected" : undefined}>
                      <TableCell className="font-medium">{c.name || "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{c.phone || c.email || "—"}</TableCell>
                      <TableCell>{c.linkedUserId ? <Badge>Connected</Badge> : <Badge variant="outline">Not on NeuraTalk</Badge>}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => setSelected(selected === c.id ? null : c.id)}>Permissions</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {selected !== null && <ConsentPanel {...props} customerId={selected} />}
        </CardContent>
      </Card>
    </div>
  );
}

function ConsentPanel(props: SectionProps & { customerId: number }) {
  const key = [props.base, "customers", props.customerId, "consent"];
  const consents = useQuery<{ consents: Consent[] }>({ queryKey: key, queryFn: () => call("GET", `${props.base}/customers/${props.customerId}/consent`) });
  const setConsent = useAction(props, (args: { channel: string; granted: boolean }) =>
    call("POST", `${props.base}/customers/${props.customerId}/consent`, { ...args, source: "dashboard" }), "Permission updated", [key]);
  return (
    <div className="mt-4 rounded-md border p-3 space-y-2" data-testid="consent-panel">
      <p className="text-sm font-medium">What this customer agreed to receive</p>
      {(["utility", "authentication", "marketing"] as const).map((channel) => {
        const row = consents.data?.consents.find((c) => c.channel === channel);
        const granted = row?.status === "granted";
        const lockedByCustomer = row?.status === "revoked" && row.source === "customer_app";
        return (
          <div key={channel} className="flex items-center justify-between gap-2 text-sm">
            <span>{CATEGORY_LABEL[channel]}</span>
            {lockedByCustomer ? (
              <span className="text-xs text-muted-foreground">Turned off by the customer</span>
            ) : (
              <Button size="sm" variant={granted ? "default" : "outline"} disabled={setConsent.isPending}
                onClick={() => setConsent.mutate({ channel, granted: !granted })}>
                {granted ? <><CheckCircle2 className="w-4 h-4 mr-1" />Allowed</> : "Not allowed — allow"}
              </Button>
            )}
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground">Only mark a permission as allowed if the customer agreed to it. Customers can turn offers off themselves in the app.</p>
    </div>
  );
}

// ---------------------------------------------------------------- templates
function TemplatesSection(props: SectionProps) {
  const listKey = [props.base, "templates"];
  const templates = useQuery<{ templates: Template[] }>({ queryKey: listKey, queryFn: () => call("GET", `${props.base}/templates`) });
  const [name, setName] = useState("");
  const [category, setCategory] = useState("utility");
  const [content, setContent] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);

  const create = useAction(props, async () => {
    const created = await call<any>("POST", `${props.base}/templates`, { name: name.trim(), category });
    const draft = await call<any>("PUT", `${props.base}/templates/${created.template?.id ?? created.id}/draft`, {
      language: "en", content, variables: variablesFrom(content),
    });
    await call("POST", `${props.base}/approvals`, { resourceType: "template_version", resourceId: draft.version?.id ?? draft.id });
  }, "Template sent for approval", [listKey, [props.base, "approvals"]]);

  const hint = category === "authentication" ? "Must include {{code}}, e.g. “Your login code is {{code}}.”"
    : "Use {{name}} for the customer's name. Other {{fields}} are filled in when you send (e.g. by your system through the API).";

  return (
    <div className="grid lg:grid-cols-[360px_1fr] gap-4">
      <Card>
        <CardHeader><CardTitle className="text-base">New template</CardTitle>
          <CardDescription>Every message is sent from an approved template. A different admin approves it.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <div><Label htmlFor="tpl-name">Name</Label><Input id="tpl-name" placeholder="order_shipped" value={name} onChange={(e) => setName(e.target.value.replace(/\s+/g, "_").toLowerCase())} /></div>
          <div>
            <Label>Type</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger aria-label="Template type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(CATEGORY_LABEL).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="tpl-content">Message</Label>
            <Textarea id="tpl-content" rows={4} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Hi {{name}}, your order {{order}} has shipped." />
            <p className="text-xs text-muted-foreground mt-1">{hint}</p>
          </div>
          <Button className="w-full" disabled={create.isPending || !name.trim() || !content.trim()} onClick={() => create.mutate(undefined as never, { onSuccess: () => { setName(""); setContent(""); } })} data-testid="button-create-template">
            {create.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}Save and send for approval
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Templates</CardTitle></CardHeader>
        <CardContent>
          {templates.isLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : (templates.data?.templates ?? []).length === 0 ? <Empty>No templates yet.</Empty> : (
            <ul className="divide-y">
              {templates.data!.templates.map((t) => (
                <li key={t.id} className="py-2">
                  <button className="w-full flex items-center justify-between gap-2 text-left" onClick={() => setOpenId(openId === t.id ? null : t.id)} aria-expanded={openId === t.id}>
                    <span className="font-medium">{t.name}</span>
                    <span className="text-xs text-muted-foreground">{CATEGORY_LABEL[t.category] ?? t.category}</span>
                  </button>
                  {openId === t.id && <TemplateVersions {...props} templateId={t.id} />}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TemplateVersions(props: SectionProps & { templateId: number }) {
  const versions = useQuery<{ versions: TemplateVersion[] }>({
    queryKey: [props.base, "templates", props.templateId, "versions"],
    queryFn: () => call("GET", `${props.base}/templates/${props.templateId}/versions`),
  });
  return (
    <div className="mt-2 space-y-2">
      {(versions.data?.versions ?? []).map((v) => (
        <div key={v.id} className="rounded-md bg-muted/40 p-2 text-sm">
          <div className="flex items-center justify-between mb-1"><span className="text-xs text-muted-foreground">Version {v.versionNumber} · ID {v.id}</span>{statusBadge(v.status)}</div>
          <p className="whitespace-pre-wrap">{v.content}</p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- approvals
function ApprovalsSection(props: SectionProps) {
  const { user } = useAuth();
  const key = [props.base, "approvals"];
  // Requests arrive from teammates: keep this list fresh.
  const approvals = useQuery<{ requests: ApprovalRequest[] }>({
    queryKey: key, queryFn: () => call("GET", `${props.base}/approvals`), refetchOnMount: "always", refetchInterval: 10000,
  });
  const decide = useAction(props, (args: { id: number; decision: "approve" | "reject" }) =>
    call("POST", `${props.base}/approvals/${args.id}/${args.decision}`, args.decision === "reject" ? { reason: "Rejected from dashboard" } : {}),
    "Decision saved", [key, [props.base, "templates"], [props.v1, "campaigns"]]);
  const pending = (approvals.data?.requests ?? []).filter((r) => r.status === "pending");
  const done = (approvals.data?.requests ?? []).filter((r) => r.status !== "pending").slice(0, 20);
  // Show what is being approved, not just an id.
  const campaigns = useQuery<{ campaigns: Campaign[] }>({ queryKey: [props.v1, "campaigns"], queryFn: () => call("GET", `${props.v1}/campaigns`), refetchOnMount: "always" });
  const templates = useQuery<{ templates: Template[] }>({ queryKey: [props.base, "templates"], queryFn: () => call("GET", `${props.base}/templates`), refetchOnMount: "always" });
  const versions = useQuery<Array<TemplateVersion & { templateName: string }>>({
    queryKey: [props.base, "all-versions", (templates.data?.templates ?? []).map((t) => t.id).join(",")],
    enabled: templates.isSuccess,
    refetchOnMount: "always",
    queryFn: async () => {
      const out: Array<TemplateVersion & { templateName: string }> = [];
      for (const t of templates.data?.templates ?? []) {
        const res = await call<{ versions: TemplateVersion[] }>("GET", `${props.base}/templates/${t.id}/versions`);
        res.versions.forEach((v) => out.push({ ...v, templateName: t.name }));
      }
      return out;
    },
  });
  const label = (r: ApprovalRequest) => {
    if (r.resourceType === "template_version") {
      const v = versions.data?.find((x) => x.id === r.resourceId);
      return v ? `Template “${v.templateName}”: ${v.content}` : `Template version ${r.resourceId}`;
    }
    const campaign = campaigns.data?.campaigns.find((x) => x.id === r.resourceId);
    return campaign ? `Campaign “${campaign.name}” (${CATEGORY_LABEL[campaign.category] ?? campaign.category})` : `Campaign ${r.resourceId}`;
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Waiting for approval ({pending.length})</CardTitle>
        <CardDescription>
          Templates (marketing, utility, codes) are checked by NeuraTalk before you can send them — like WhatsApp.
          Campaigns are approved by someone else on your team; with no teammates, you approve your own.
        </CardDescription></CardHeader>
      <CardContent className="space-y-4">
        {pending.length === 0 ? <Empty>Nothing waiting.</Empty> : pending.map((r) => {
          const own = r.requestedBy === user?.id;
          const platform = r.resourceType === "template_version";
          return (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3" data-testid={`approval-row-${r.id}`}>
              <div className="min-w-0"><p className="font-medium break-words">{label(r)}</p><p className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</p></div>
              {platform ? <span className="text-xs text-muted-foreground" data-testid={`platform-review-${r.id}`}>Waiting for NeuraTalk review</span> : (
                <div className="flex gap-2">
                  <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, decision: "approve" })} data-testid={`button-approve-${r.id}`}><CheckCircle2 className="w-4 h-4 mr-1" />Approve</Button>
                  <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, decision: "reject" })}><XCircle className="w-4 h-4 mr-1" />Reject</Button>
                </div>
              )}
            </div>
          );
        })}
        {done.length > 0 && (
          <div>
            <p className="text-sm font-medium mb-2">Recent decisions</p>
            <ul className="space-y-2 text-sm">{done.map((r) => (
              <li key={r.id} className="flex justify-between gap-2">
                <span className="min-w-0 break-words">{label(r)}{r.reason ? <span className="block text-xs text-muted-foreground">Reason: {r.reason}</span> : null}</span>
                {statusBadge(r.status)}
              </li>
            ))}</ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- audiences
function AudiencesSection(props: SectionProps & { customers: Customer[] }) {
  const key = [props.base, "audiences"];
  const audiences = useQuery<{ audiences: Audience[] }>({ queryKey: key, queryFn: () => call("GET", `${props.base}/audiences`) });
  const [name, setName] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const create = useAction(props, () => call("POST", `${props.base}/audiences`, { name: name.trim() }), "Audience created", [key]);
  return (
    <div className="grid lg:grid-cols-[320px_1fr] gap-4">
      <Card>
        <CardHeader><CardTitle className="text-base">New audience</CardTitle><CardDescription>A list of customers to send a campaign to.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <Input aria-label="Audience name" placeholder="e.g. Hyderabad customers" value={name} onChange={(e) => setName(e.target.value)} />
          <Button className="w-full" disabled={create.isPending || !name.trim()} onClick={() => create.mutate(undefined as never, { onSuccess: () => setName("") })}><Plus className="w-4 h-4 mr-2" />Create</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Audiences</CardTitle></CardHeader>
        <CardContent>
          {(audiences.data?.audiences ?? []).length === 0 ? <Empty>No audiences yet.</Empty> : (
            <ul className="divide-y">
              {audiences.data!.audiences.map((a) => (
                <li key={a.id} className="py-2">
                  <button className="w-full flex justify-between text-left" onClick={() => setOpenId(openId === a.id ? null : a.id)} aria-expanded={openId === a.id}>
                    <span className="font-medium">{a.name}</span><span className="text-sm text-muted-foreground">{a.memberCount ?? 0} customers</span>
                  </button>
                  {openId === a.id && <AudienceMembers {...props} audienceId={a.id} />}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AudienceMembers(props: SectionProps & { audienceId: number; customers: Customer[] }) {
  const key = [props.base, "audiences", props.audienceId, "members"];
  const members = useQuery<{ members: Array<{ customerId: number; name: string | null; phone: string | null }> }>({
    queryKey: key, queryFn: () => call("GET", `${props.base}/audiences/${props.audienceId}/members`),
  });
  const [pick, setPick] = useState<string>("");
  const memberIds = new Set((members.data?.members ?? []).map((m) => m.customerId));
  const add = useAction(props, (customerId: number) => call("POST", `${props.base}/audiences/${props.audienceId}/members`, { customerId }),
    "Added", [key, [props.base, "audiences"]]);
  const addAll = useAction(props, async () => {
    for (const c of props.customers) if (!memberIds.has(c.id) && c.status === "active") {
      await call("POST", `${props.base}/audiences/${props.audienceId}/members`, { customerId: c.id });
    }
  }, "All customers added", [key, [props.base, "audiences"]]);
  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-2">
        <Select value={pick} onValueChange={setPick}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Choose a customer" /></SelectTrigger>
          <SelectContent>
            {props.customers.filter((c) => !memberIds.has(c.id)).map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name || c.phone || `Customer ${c.id}`}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" disabled={!pick || add.isPending} onClick={() => add.mutate(Number(pick), { onSuccess: () => setPick("") })}>Add</Button>
        <Button size="sm" variant="outline" disabled={addAll.isPending} onClick={() => addAll.mutate(undefined as never)}>Add all customers</Button>
      </div>
      <ul className="text-sm text-muted-foreground">
        {(members.data?.members ?? []).map((m) => <li key={m.customerId}>{m.name || m.phone || `Customer ${m.customerId}`}</li>)}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- campaigns
function useApprovedVersions(props: SectionProps, category?: string) {
  const templates = useQuery<{ templates: Template[] }>({ queryKey: [props.base, "templates"], queryFn: () => call("GET", `${props.base}/templates`), refetchOnMount: "always" });
  const relevant = (templates.data?.templates ?? []).filter((t) => !category || t.category === category);
  const versions = useQuery<Array<TemplateVersion & { templateName: string; category: string }>>({
    queryKey: [props.base, "approved-versions", category, relevant.map((t) => t.id).join(",")],
    enabled: templates.isSuccess,
    refetchOnMount: "always",
    queryFn: async () => {
      const out: Array<TemplateVersion & { templateName: string; category: string }> = [];
      for (const t of relevant) {
        const res = await call<{ versions: TemplateVersion[] }>("GET", `${props.base}/templates/${t.id}/versions`);
        for (const v of res.versions) if (v.status === "approved") out.push({ ...v, templateName: t.name, category: t.category });
      }
      return out;
    },
  });
  return versions.data ?? [];
}

function CampaignsSection(props: SectionProps) {
  const key = [props.v1, "campaigns"];
  const campaigns = useQuery<{ campaigns: Campaign[] }>({
    queryKey: key, queryFn: () => call("GET", `${props.v1}/campaigns`), refetchOnMount: "always", refetchInterval: 15000,
  });
  const audiences = useQuery<{ audiences: Audience[] }>({ queryKey: [props.base, "audiences"], queryFn: () => call("GET", `${props.base}/audiences`) });
  const [name, setName] = useState("");
  const [category, setCategory] = useState("marketing");
  const [versionId, setVersionId] = useState("");
  const [audienceId, setAudienceId] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const versions = useApprovedVersions(props, category);

  const create = useAction(props, async () => {
    const created = await call<any>("POST", `${props.v1}/campaigns`, { name: name.trim(), category });
    const campaignId = created.campaign?.id ?? created.id;
    await call("PATCH", `${props.v1}/campaigns/${campaignId}`, { templateVersionId: Number(versionId), audienceId: Number(audienceId) });
    await call("POST", `${props.base}/approvals`, { resourceType: "campaign", resourceId: campaignId });
  }, "Campaign sent for approval", [key, [props.base, "approvals"]]);

  return (
    <div className="grid lg:grid-cols-[360px_1fr] gap-4">
      <Card>
        <CardHeader><CardTitle className="text-base">New campaign</CardTitle><CardDescription>Send one approved template to an audience.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <div><Label htmlFor="camp-name">Name</Label><Input id="camp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Diwali offer" /></div>
          <div><Label>Type</Label>
            <Select value={category} onValueChange={(v) => { setCategory(v); setVersionId(""); }}>
              <SelectTrigger aria-label="Campaign type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="marketing">{CATEGORY_LABEL.marketing}</SelectItem>
                <SelectItem value="utility">{CATEGORY_LABEL.utility}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Approved template</Label>
            <Select value={versionId} onValueChange={setVersionId}>
              <SelectTrigger aria-label="Approved template"><SelectValue placeholder={versions.length ? "Choose" : "No approved templates of this type"} /></SelectTrigger>
              <SelectContent>{versions.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.templateName} (v{v.versionNumber})</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Audience</Label>
            <Select value={audienceId} onValueChange={setAudienceId}>
              <SelectTrigger aria-label="Audience"><SelectValue placeholder="Choose" /></SelectTrigger>
              <SelectContent>{(audiences.data?.audiences ?? []).map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name} ({a.memberCount ?? 0})</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button className="w-full" disabled={create.isPending || !name.trim() || !versionId || !audienceId}
            onClick={() => create.mutate(undefined as never, { onSuccess: () => { setName(""); setVersionId(""); setAudienceId(""); } })} data-testid="button-create-campaign">
            {create.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}Save and send for approval
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Campaigns</CardTitle></CardHeader>
        <CardContent>
          {(campaigns.data?.campaigns ?? []).length === 0 ? <Empty>No campaigns yet.</Empty> : (
            <ul className="divide-y">
              {campaigns.data!.campaigns.map((c) => (
                <li key={c.id} className="py-2">
                  <button className="w-full flex items-center justify-between gap-2 text-left" onClick={() => setOpenId(openId === c.id ? null : c.id)} aria-expanded={openId === c.id}>
                    <span className="font-medium">{c.name}</span>{statusBadge(c.status)}
                  </button>
                  {openId === c.id && <CampaignDetail {...props} campaign={c} />}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CampaignDetail(props: SectionProps & { campaign: Campaign }) {
  const c = props.campaign;
  const detailKey = [props.v1, "campaigns", c.id];
  const detail = useQuery<any>({ queryKey: detailKey, queryFn: () => call("GET", `${props.v1}/campaigns/${c.id}`), refetchOnMount: "always", refetchInterval: 15000 });
  const preflight = useQuery<any>({
    queryKey: [...detailKey, "preflight"],
    queryFn: () => call("GET", `${props.v1}/campaigns/${c.id}/preflight`),
    enabled: c.status === "draft" || c.status === "scheduled",
    refetchOnMount: "always",
  });
  const run = useAction(props, () => call("POST", `${props.v1}/campaigns/${c.id}/execute`, {}), "Campaign sent", [[props.v1, "campaigns"], detailKey]);
  const report = detail.data?.report ?? detail.data?.campaign?.report;
  const pf = preflight.data?.preflight;
  const count = (m: any) => (typeof m?.count === "number" ? m.count : "—");

  return (
    <div className="mt-2 space-y-3 text-sm">
      {pf && (
        <div className="rounded-md border p-3 space-y-1">
          <p>Audience: {pf.audience.size} · will receive: <strong>{pf.eligibility.eligibleCount}</strong></p>
          <p className="text-muted-foreground">Cost about {(pf.billing.estimatedCostPaise / 100).toFixed(2)} ₹ · balance {(pf.billing.availableBalancePaise / 100).toFixed(2)} ₹</p>
          {!pf.readiness.ready && <p className="text-destructive">Not ready: {pf.readiness.reasons.join(", ")}</p>}
          <Button size="sm" disabled={!pf.readiness.ready || run.isPending} onClick={() => run.mutate(undefined as never)} data-testid={`button-run-campaign-${c.id}`}>
            {run.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Send className="w-4 h-4 mr-1" />}Send now
          </Button>
        </div>
      )}
      {report && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {[
            ["Sent", report.sent], ["Delivered", count(report.delivery?.delivered)], ["Read", count(report.delivery?.read)],
            ["Skipped", report.skipped], ["Cost ₹", ((report.cost?.totalChargedPaise ?? 0) / 100).toFixed(2)],
          ].map(([label, value]) => (
            <div key={label as string} className="rounded-md bg-muted/40 p-2 text-center">
              <div className="text-lg font-semibold">{value as React.ReactNode}</div><div className="text-xs text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>
      )}
      {report?.skippedByReason && Object.keys(report.skippedByReason).length > 0 && (
        <p className="text-xs text-muted-foreground">Skipped: {Object.entries(report.skippedByReason).map(([k, v]) => `${String(k).replace(/_/g, " ")} (${v})`).join(", ")}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- codes
function CodesSection(props: SectionProps & { customers: Customer[] }) {
  const key = [props.v1, "otp"];
  const challenges = useQuery<{ challenges: Array<{ id: number; customerId: number; channel: string; purpose: string; status: string; createdAt: string }> }>({
    queryKey: key, queryFn: () => call("GET", `${props.v1}/otp/challenges`),
  });
  const [customerId, setCustomerId] = useState("");
  const [verifyFor, setVerifyFor] = useState<number | null>(null);
  const [code, setCode] = useState("");
  const send = useAction(props, () => call("POST", `${props.v1}/otp/challenges`, { customerId: Number(customerId), purpose: "verify_phone" }), "Code sent to the customer's NeuraTalk app", [key]);
  const verify = useAction(props, () => call("POST", `${props.v1}/otp/challenges/${verifyFor}/verify`, { code: code.trim() }), "Code is correct", [key]);
  const nameOf = useMemo(() => new Map(props.customers.map((c) => [c.id, c.name || c.phone || `Customer ${c.id}`])), [props.customers]);
  const connected = props.customers.filter((c) => c.linkedUserId);

  return (
    <div className="grid lg:grid-cols-[360px_1fr] gap-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Send a verification code</CardTitle>
          <CardDescription>For your own website or app, use the API (API &amp; SDK tab). This is for testing or helping a customer at the counter.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <Select value={customerId} onValueChange={setCustomerId}>
            <SelectTrigger aria-label="Customer"><SelectValue placeholder={connected.length ? "Choose a customer" : "No customers on NeuraTalk yet"} /></SelectTrigger>
            <SelectContent>{connected.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name || c.phone}</SelectItem>)}</SelectContent>
          </Select>
          <Button className="w-full" disabled={!customerId || send.isPending} onClick={() => send.mutate(undefined as never)} data-testid="button-send-code">
            {send.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <KeyRound className="w-4 h-4 mr-2" />}Send code
          </Button>
          <p className="text-xs text-muted-foreground">You never see the code — only the customer does, in their app. Ask them to read it to you, then check it here.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Recent codes</CardTitle></CardHeader>
        <CardContent>
          {(challenges.data?.challenges ?? []).length === 0 ? <Empty>No codes sent yet.</Empty> : (
            <ul className="divide-y">
              {[...challenges.data!.challenges].reverse().slice(0, 20).map((ch) => (
                <li key={ch.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                  <span>{nameOf.get(ch.customerId) ?? `Customer ${ch.customerId}`} <span className="text-xs text-muted-foreground">· {new Date(ch.createdAt).toLocaleString()}</span></span>
                  <span className="flex items-center gap-2">
                    {statusBadge(ch.status)}
                    {ch.status === "pending" && (verifyFor === ch.id ? (
                      <>
                        <Input aria-label="Code" className="w-28 h-8" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} />
                        <Button size="sm" disabled={code.trim().length < 4 || verify.isPending} onClick={() => verify.mutate(undefined as never, { onSettled: () => setCode("") })}>Check</Button>
                      </>
                    ) : <Button size="sm" variant="outline" onClick={() => { setVerifyFor(ch.id); setCode(""); }}>Check code</Button>)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- profile & link
interface ChatSettings {
  listed: boolean;
  greeting: { enabled: boolean; text: string };
  away: { enabled: boolean; text: string; hours: Record<string, { open: string; close: string }>; timezone: string };
  quickReplies: Array<{ shortcut: string; text: string }>;
}
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function ProfileSection(props: SectionProps & { businessId: number }) {
  const key = [props.base, "messaging-settings"];
  const settingsQuery = useQuery<{ settings: ChatSettings }>({ queryKey: key, queryFn: () => call("GET", `${props.base}/messaging-settings`) });
  const profileQuery = useQuery<{ business: { slug: string; name: string } }>({
    queryKey: ["/api/messaging/business", props.businessId, "profile"],
    queryFn: () => call("GET", `/api/messaging/business/${props.businessId}/profile`),
    retry: false,
  });
  const [draft, setDraft] = useState<ChatSettings | null>(null);
  useEffect(() => { if (settingsQuery.data && !draft) setDraft(settingsQuery.data.settings); }, [settingsQuery.data, draft]);
  const save = useAction(props, (next: ChatSettings) => call("PUT", `${props.base}/messaging-settings`, next), "Saved", [key]);

  const slug = profileQuery.data?.business.slug;
  const link = slug ? `${window.location.origin}/b/${slug}` : null;
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    if (!link) return;
    QRCode.toDataURL(link, { width: 480, margin: 1 }).then(setQr).catch(() => setQr(null));
  }, [link]);
  const [shortcut, setShortcut] = useState("");
  const [replyText, setReplyText] = useState("");

  if (!draft) return <Loader2 className="w-5 h-5 animate-spin mx-auto" />;
  const update = (patch: Partial<ChatSettings>) => setDraft({ ...draft, ...patch });

  return (
    <div className="grid lg:grid-cols-[340px_1fr] gap-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Your chat link</CardTitle>
          <CardDescription>Customers open it (or scan the QR code at your counter) to chat with you in NeuraTalk.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {!profileQuery.data ? (
            <p className="text-sm text-muted-foreground">Your link becomes active once your company is approved.</p>
          ) : (
            <>
              {qr && <img src={qr} alt={`QR code for ${link}`} className="w-48 h-48 mx-auto rounded-md bg-white p-2" data-testid="img-chat-qr" />}
              <div className="flex gap-2">
                <Input readOnly value={link ?? ""} aria-label="Chat link" data-testid="input-chat-link" />
                <Button size="icon" variant="outline" aria-label="Copy link" onClick={() => { void navigator.clipboard?.writeText(link ?? ""); props.toast({ title: "Link copied" }); }}>
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
              {qr && <a href={qr} download={`${slug}-chat-qr.png`} className="text-sm text-primary underline">Download QR code</a>}
            </>
          )}
          <label className="flex items-center justify-between gap-2 pt-2 text-sm">
            <span>Show my business in NeuraTalk search</span>
            <Switch checked={draft.listed} onCheckedChange={(v) => update({ listed: v })} aria-label="Show in search" />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Automatic replies</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <label className="flex items-center justify-between gap-2 text-sm font-medium">
              Greeting — sent when a customer messages you for the first time
              <Switch checked={draft.greeting.enabled} onCheckedChange={(v) => update({ greeting: { ...draft.greeting, enabled: v } })} aria-label="Greeting message" />
            </label>
            <Textarea rows={2} value={draft.greeting.text} onChange={(e) => update({ greeting: { ...draft.greeting, text: e.target.value } })} placeholder="Welcome to our shop! How can we help you?" aria-label="Greeting text" />
          </div>

          <div className="space-y-2">
            <label className="flex items-center justify-between gap-2 text-sm font-medium">
              Away message — sent outside your opening hours
              <Switch checked={draft.away.enabled} onCheckedChange={(v) => update({ away: { ...draft.away, enabled: v } })} aria-label="Away message" />
            </label>
            <Textarea rows={2} value={draft.away.text} onChange={(e) => update({ away: { ...draft.away, text: e.target.value } })} placeholder="We are closed now. We will reply when we open at 9 AM." aria-label="Away text" />
            <div className="grid sm:grid-cols-2 gap-2">
              {DAYS.map((day, i) => {
                const hours = draft.away.hours[String(i)];
                return (
                  <div key={day} className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={!!hours}
                      aria-label={`Open on ${day}`}
                      onCheckedChange={(open) => {
                        const next = { ...draft.away.hours };
                        if (open) next[String(i)] = { open: "09:00", close: "18:00" }; else delete next[String(i)];
                        update({ away: { ...draft.away, hours: next } });
                      }}
                    />
                    <span className="w-9">{day}</span>
                    {hours ? (
                      <>
                        <Input type="time" className="h-8 w-[6.5rem]" value={hours.open} aria-label={`${day} opens`}
                          onChange={(e) => update({ away: { ...draft.away, hours: { ...draft.away.hours, [String(i)]: { ...hours, open: e.target.value } } } })} />
                        <span>–</span>
                        <Input type="time" className="h-8 w-[6.5rem]" value={hours.close} aria-label={`${day} closes`}
                          onChange={(e) => update({ away: { ...draft.away, hours: { ...draft.away.hours, [String(i)]: { ...hours, close: e.target.value } } } })} />
                      </>
                    ) : <span className="text-muted-foreground">Closed</span>}
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">No days set = always open. Times are India time.</p>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Quick replies — your team types "/" in the Inbox to use them</p>
            <ul className="space-y-1">
              {draft.quickReplies.map((q, i) => (
                <li key={`${q.shortcut}-${i}`} className="flex items-start justify-between gap-2 rounded-md bg-muted/40 p-2 text-sm">
                  <span><strong>/{q.shortcut}</strong> — {q.text}</span>
                  <Button size="icon" variant="ghost" className="h-6 w-6" aria-label={`Remove /${q.shortcut}`}
                    onClick={() => update({ quickReplies: draft.quickReplies.filter((_, j) => j !== i) })}><Trash2 className="w-3.5 h-3.5" /></Button>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Input className="w-32" placeholder="shortcut" value={shortcut} onChange={(e) => setShortcut(e.target.value.replace(/[^a-z0-9_-]/gi, "").toLowerCase())} aria-label="Quick reply shortcut" />
              <Input className="flex-1 min-w-[12rem]" placeholder="Reply text" value={replyText} onChange={(e) => setReplyText(e.target.value)} aria-label="Quick reply text" />
              <Button variant="outline" disabled={!shortcut || !replyText.trim()}
                onClick={() => { update({ quickReplies: [...draft.quickReplies, { shortcut, text: replyText.trim() }] }); setShortcut(""); setReplyText(""); }}>Add</Button>
            </div>
          </div>

          <Button onClick={() => save.mutate(draft)} disabled={save.isPending} data-testid="button-save-chat-settings">
            {save.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}Save
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- catalog
interface CatalogRow { id: number; name: string; description: string | null; pricePaise: number | null; imageUrl: string | null; isAvailable: boolean }

function CatalogSection(props: SectionProps) {
  const key = [props.base, "catalog"];
  const items = useQuery<{ items: CatalogRow[] }>({ queryKey: key, queryFn: () => call("GET", `${props.base}/catalog`) });
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");
  const [imagePath, setImagePath] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { uploadFile, isUploading } = useUpload();
  const add = useAction(props, () => call("POST", `${props.base}/catalog`, {
    name: name.trim(),
    description: description.trim() || null,
    pricePaise: price.trim() ? Math.round(Number(price) * 100) : null,
    imageUrl: imagePath,
  }), "Added to catalog", [key]);
  const toggle = useAction(props, (row: CatalogRow) => call("PATCH", `${props.base}/catalog/${row.id}`, { isAvailable: !row.isAvailable }), "Updated", [key]);
  const remove = useAction(props, (id: number) => call("DELETE", `${props.base}/catalog/${id}`), "Removed", [key]);
  const priceValid = !price.trim() || (Number.isFinite(Number(price)) && Number(price) >= 0);

  return (
    <div className="grid lg:grid-cols-[340px_1fr] gap-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Add a product or service</CardTitle>
          <CardDescription>Customers see your catalog in your chat and can ask about any item.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <div><Label htmlFor="cat-name">Name</Label><Input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label htmlFor="cat-price">Price (₹) — leave empty for "price on request"</Label><Input id="cat-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
          <div><Label htmlFor="cat-desc">Description</Label><Textarea id="cat-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              const upload = await uploadFile(file);
              if (upload) setImagePath(upload.objectPath);
            }} />
          <Button variant="outline" className="w-full" onClick={() => fileRef.current?.click()} disabled={isUploading}>
            {isUploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ImagePlus className="w-4 h-4 mr-2" />}{imagePath ? "Photo added — change" : "Add a photo"}
          </Button>
          <Button className="w-full" disabled={!name.trim() || !priceValid || add.isPending}
            onClick={() => add.mutate(undefined as never, { onSuccess: () => { setName(""); setPrice(""); setDescription(""); setImagePath(null); } })} data-testid="button-add-catalog-item">
            <Plus className="w-4 h-4 mr-2" />Add to catalog
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Catalog ({items.data?.items.length ?? 0})</CardTitle></CardHeader>
        <CardContent>
          {(items.data?.items ?? []).length === 0 ? <Empty>No items yet.</Empty> : (
            <ul className="divide-y">
              {items.data!.items.map((row) => (
                <li key={row.id} className="py-2 flex items-center gap-3">
                  {row.imageUrl ? <img src={row.imageUrl} alt="" className="w-12 h-12 rounded-md object-cover" /> : <div className="w-12 h-12 rounded-md bg-muted" />}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{row.name}</p>
                    <p className="text-sm text-muted-foreground">{row.pricePaise == null ? "Price on request" : `₹${(row.pricePaise / 100).toLocaleString("en-IN")}`}</p>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    {row.isAvailable ? "Shown" : "Hidden"}
                    <Switch checked={row.isAvailable} onCheckedChange={() => toggle.mutate(row)} aria-label={`Show ${row.name}`} />
                  </label>
                  <Button size="icon" variant="ghost" aria-label={`Remove ${row.name}`} onClick={() => remove.mutate(row.id)}><Trash2 className="w-4 h-4" /></Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}