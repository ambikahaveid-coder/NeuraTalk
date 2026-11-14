import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageSquareText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { serverMessage } from "@/lib/server-message";
import { rupeesText } from "@/components/BusinessMessageExtras";

type Settings = {
  settings: { enabled: boolean; categories: string[] };
  available: boolean; testMode: boolean; pricePaise: number;
  last30Days: Record<string, { count: number; amountPaise: number } | number>;
};
type Sms = { id: number; status: string; costPaise: number; createdAt: string; openedAt: string | null; phone: string; customerName: string | null };

const KINDS: Array<[string, string, string]> = [
  ["utility", "Order and account updates", "Delivery, booking, payment updates"],
  ["authentication", "Login codes", "One-time codes (OTP)"],
  ["marketing", "Offers", "Only to customers who agreed to offers"],
];

/** SMS for customers who don't have NeuraTalk (server/modules/messaging/sms-fallback.ts). */
export default function SmsSection({ base }: { base: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const key = [base, "sms-settings"];
  const s = useQuery<Settings>({ queryKey: key, queryFn: async () => (await apiRequest("GET", `${base}/sms-settings`)).json() });
  const log = useQuery<{ messages: Sms[] }>({ queryKey: [base, "sms-messages"], queryFn: async () => (await apiRequest("GET", `${base}/sms-messages`)).json() });

  async function save(enabled: boolean, categories: string[]) {
    try {
      await apiRequest("PUT", `${base}/sms-settings`, { enabled, categories });
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast({ title: "Couldn't save", description: serverMessage(e, "Try again."), variant: "destructive" });
    }
  }

  if (s.isLoading) return <Loader2 className="w-5 h-5 animate-spin" />;
  if (!s.data) return <p className="text-sm text-destructive">Could not load SMS settings.</p>;
  const { settings, available, testMode, pricePaise } = s.data;
  const sentCount = ["sent", "test"].reduce((n, k) => n + (((s.data!.last30Days[k] as { count?: number }) ?? {}).count ?? 0), 0);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0" data-testid="sms-section">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><MessageSquareText className="w-4 h-4" />SMS for customers without NeuraTalk</CardTitle>
          <CardDescription>
            Your message goes as one SMS: "&lt;Your business&gt; sent you a message on NeuraTalk. Read it: neuratalk.in/m/…". The link shows your full message,
            and the customer can reply by installing NeuraTalk. Each SMS costs {rupeesText(pricePaise)} from your wallet; if it can't be sent, you get it back.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!available && (
            <p className="rounded-md bg-orange-500/10 p-3 text-sm" role="status">
              NeuraTalk is still getting SMS approved by the telecom regulator (DLT). You can choose your settings now; SMS starts once it is approved.
            </p>
          )}
          {testMode && <p className="text-xs text-orange-600">Test mode: SMS are recorded but not really sent.</p>}
          <label className="flex items-center justify-between gap-3">
            <span className="font-medium">Send SMS when the customer isn't on NeuraTalk</span>
            <Switch checked={settings.enabled} onCheckedChange={(v) => save(v, settings.categories.length ? settings.categories : ["utility", "authentication"])} data-testid="switch-sms-enabled" />
          </label>
          <div className="space-y-2">
            {KINDS.map(([id, title, sub]) => (
              <div key={id} className="flex items-start gap-2">
                <Checkbox
                  id={`sms-${id}`}
                  checked={settings.categories.includes(id)}
                  disabled={!settings.enabled}
                  onCheckedChange={(v) => save(settings.enabled, v ? [...settings.categories, id] : settings.categories.filter((c) => c !== id))}
                />
                <Label htmlFor={`sms-${id}`} className="leading-tight">
                  {title}<span className="block text-xs text-muted-foreground font-normal">{sub}</span>
                </Label>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Last 30 days</CardTitle>
          <CardDescription>{sentCount} sent · {Number(s.data.last30Days.opened ?? 0)} opened</CardDescription>
        </CardHeader>
        <CardContent>
          {!(log.data?.messages.length) ? <p className="text-sm text-muted-foreground">No SMS yet.</p> : (
            <ul className="divide-y text-sm">
              {log.data.messages.slice(0, 30).map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="min-w-0 truncate">{m.customerName ?? "Customer"} · {m.phone}</span>
                  <Badge variant={m.status === "failed" || m.status === "no_credit" ? "destructive" : "secondary"}>
                    {m.status === "no_credit" ? "Wallet empty" : m.status === "failed" ? "Not sent (refunded)" : m.openedAt ? "Opened" : "Sent"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
