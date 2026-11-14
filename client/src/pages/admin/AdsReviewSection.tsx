import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { serverMessage } from "@/lib/server-message";
import { rupeesText } from "@/components/BusinessMessageExtras";

type Ad = {
  id: number; businessId: number; businessName: string; headline: string; body: string; button: string; status: string;
  reviewNote: string | null; dailyBudgetPaise: number; views: number; chats: number; spentPaise: number; createdAt: string;
};
const TABS = [["pending", "To review"], ["approved", "Running"], ["paused", "Paused"], ["rejected", "Rejected"], ["ended", "Ended"]] as const;

/** NeuraTalk reviews every business ad before customers see it. */
export function AdsReviewSection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<string>("pending");
  const [notes, setNotes] = useState<Record<number, string>>({});
  const q = useQuery<{ ads: Ad[] }>({ queryKey: ["/api/admin/business-ads", tab], queryFn: async () => (await apiRequest("GET", `/api/admin/business-ads?status=${tab}`)).json() });

  async function decide(id: number, decision: "approve" | "reject" | "stop") {
    try {
      await apiRequest("POST", `/api/admin/business-ads/${id}/${decision}`, { note: notes[id] || undefined });
      toast({ title: decision === "approve" ? "Ad approved" : decision === "reject" ? "Ad rejected" : "Ad stopped" });
      await qc.invalidateQueries({ queryKey: ["/api/admin/business-ads"] });
    } catch (e) {
      toast({ title: "Couldn't update", description: serverMessage(e, "Try again."), variant: "destructive" });
    }
  }

  return (
    <div className="space-y-4" data-testid="ads-review">
      <div>
        <h2 className="text-xl font-semibold">Business ads</h2>
        <p className="text-sm text-muted-foreground">Ads show as "Sponsored" in customers' Business messages. Approve only honest ads that follow the business messaging policy.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {TABS.map(([id, label]) => <Button key={id} size="sm" variant={tab === id ? "default" : "outline"} onClick={() => setTab(id)}>{label}</Button>)}
      </div>
      {q.isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : !(q.data?.ads.length) ? <p className="text-sm text-muted-foreground">Nothing here.</p> : q.data.ads.map((a) => (
        <Card key={a.id} data-testid={`review-ad-${a.id}`}>
          <CardContent className="pt-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{a.businessName} · #{a.businessId} · {new Date(a.createdAt).toLocaleString()}</p>
                <p className="font-semibold">{a.headline}</p>
                <p className="text-sm">{a.body}</p>
                <p className="text-xs text-muted-foreground">Button: {a.button} · budget {rupeesText(a.dailyBudgetPaise)}/day · {a.views} views · {a.chats} chats · {rupeesText(a.spentPaise)} spent</p>
              </div>
              <Badge variant="secondary">{a.status}</Badge>
            </div>
            {a.reviewNote && <p className="text-sm text-muted-foreground">Note: {a.reviewNote}</p>}
            {a.status === "pending" && (
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => decide(a.id, "approve")} data-testid={`approve-ad-${a.id}`}>Approve</Button>
                <Input className="max-w-xs" placeholder="Reason (needed to reject)" value={notes[a.id] ?? ""} onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })} />
                <Button size="sm" variant="destructive" onClick={() => decide(a.id, "reject")}>Reject</Button>
              </div>
            )}
            {(a.status === "approved" || a.status === "paused") && <Button size="sm" variant="outline" onClick={() => decide(a.id, "stop")}>Stop this ad</Button>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
