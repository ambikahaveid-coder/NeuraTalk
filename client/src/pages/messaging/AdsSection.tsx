import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Megaphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { serverMessage } from "@/lib/server-message";
import { rupeesText } from "@/components/BusinessMessageExtras";

type Ad = {
  id: number; headline: string; body: string; button: string; status: string; reviewNote: string | null; dailyBudgetPaise: number;
  views: number; chats: number; spentPaise: number; spentTodayPaise: number;
};
const STATUS: Record<string, string> = { pending: "Waiting for review", approved: "Running", paused: "Paused", rejected: "Not approved", ended: "Ended" };

/** Click-to-chat ads inside NeuraTalk (server/modules/messaging/business-ads.ts). */
export default function AdsSection({ base }: { base: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const key = [base, "ads"];
  const q = useQuery<{ ads: Ad[]; pricePerChatPaise: number }>({ queryKey: key, queryFn: async () => (await apiRequest("GET", `${base}/ads`)).json() });
  const [form, setForm] = useState({ headline: "", body: "", button: "Chat now", budget: "100" });
  const [busy, setBusy] = useState(false);
  const price = q.data?.pricePerChatPaise ?? 200;

  async function create() {
    setBusy(true);
    try {
      await apiRequest("POST", `${base}/ads`, { headline: form.headline, body: form.body, button: form.button || "Chat now", dailyBudgetPaise: Math.round(Number(form.budget) * 100) });
      setForm({ headline: "", body: "", button: "Chat now", budget: "100" });
      toast({ title: "Sent for NeuraTalk review" });
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast({ title: "Couldn't create the ad", description: serverMessage(e, "Try again."), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }
  async function act(id: number, action: "pause" | "resume" | "end") {
    try {
      await apiRequest("PATCH", `${base}/ads/${id}`, { action });
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast({ title: "Couldn't update", description: serverMessage(e, "Try again."), variant: "destructive" });
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] [&>*]:min-w-0" data-testid="ads-section">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Megaphone className="w-4 h-4" />New ad</CardTitle>
          <CardDescription>
            Shows as "Sponsored" to NeuraTalk users in Business messages; tapping it starts a chat with you. You pay {rupeesText(price)} per new chat
            (once per person a day), never more than your daily budget. Showing it is free. NeuraTalk reviews every ad.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1"><Label htmlFor="ad-h">Headline</Label><Input id="ad-h" maxLength={60} value={form.headline} onChange={(e) => setForm({ ...form, headline: e.target.value })} placeholder="Fresh idli, 30-minute delivery" data-testid="input-ad-headline" /></div>
          <div className="space-y-1"><Label htmlFor="ad-b">One line about it</Label><Input id="ad-b" maxLength={140} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} data-testid="input-ad-body" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1"><Label htmlFor="ad-btn">Button</Label><Input id="ad-btn" maxLength={20} value={form.button} onChange={(e) => setForm({ ...form, button: e.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="ad-budget">Daily budget (₹)</Label><Input id="ad-budget" inputMode="numeric" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} /></div>
          </div>
          <Button onClick={create} disabled={busy} data-testid="button-create-ad">{busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Send for review</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Your ads</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {q.isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : !(q.data?.ads.length) ? <p className="text-sm text-muted-foreground">No ads yet.</p> : q.data.ads.map((a) => (
            <div key={a.id} className="rounded-lg border p-3 space-y-1" data-testid={`ad-${a.id}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold min-w-0">{a.headline}</p>
                <Badge variant={a.status === "approved" ? "default" : a.status === "rejected" ? "destructive" : "secondary"}>{STATUS[a.status] ?? a.status}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">{a.body}</p>
              {a.status === "rejected" && a.reviewNote && <p className="text-sm text-destructive">NeuraTalk: {a.reviewNote}</p>}
              <p className="text-xs text-muted-foreground">{a.views} saw it · {a.chats} chats · {rupeesText(a.spentPaise)} spent · today {rupeesText(a.spentTodayPaise)} of {rupeesText(a.dailyBudgetPaise)}</p>
              {["approved", "paused", "pending"].includes(a.status) && (
                <div className="flex gap-2">
                  {a.status === "approved" && <Button size="sm" variant="outline" onClick={() => act(a.id, "pause")}>Pause</Button>}
                  {a.status === "paused" && <Button size="sm" variant="outline" onClick={() => act(a.id, "resume")}>Resume</Button>}
                  <Button size="sm" variant="ghost" onClick={() => act(a.id, "end")}>End</Button>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
