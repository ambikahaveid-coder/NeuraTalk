import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Loader2, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { serverMessage } from "@/lib/server-message";
import { rupeesText } from "@/components/BusinessMessageExtras";

type Data = {
  settings: { enabled: boolean; chatMode: string; callsEnabled: boolean; ringSeconds: number; knowledge: string | null; instructions: string | null; assistantName: string | null; voiceGender: string };
  access: { status: string; trialEndsAt: string | null; periodEnd: string | null; voiceSecondsLeft: number };
  plan: { pricePaise: number; trialDays: number; voiceMinutes: number; extraMinutePaise: number };
  knowledgePreview: string;
};
type Item = { id: number; channel: string; counterpartName: string | null; summary: string | null; importance: string | null; lead: Record<string, unknown> | null; handoff: boolean; lastAt: string };

const day = (s: string | null) => (s ? new Date(s).toLocaleDateString() : "");

/** AI receptionist (server/ai-assistant.ts) on the business dashboard. */
export default function AssistantSection({ base }: { base: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const key = [base, "assistant"];
  const q = useQuery<Data>({ queryKey: key, queryFn: async () => (await apiRequest("GET", `${base}/assistant`)).json() });
  const inbox = useQuery<{ items: Item[] }>({ queryKey: [base, "assistant", "inbox"], queryFn: async () => (await apiRequest("GET", `${base}/assistant/inbox`)).json() });
  const [form, setForm] = useState({ knowledge: "", instructions: "", assistantName: "" });
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.data) setForm({ knowledge: q.data.settings.knowledge ?? "", instructions: q.data.settings.instructions ?? "", assistantName: q.data.settings.assistantName ?? "" });
  }, [q.data?.settings.knowledge, q.data?.settings.instructions, q.data?.settings.assistantName]);

  async function save(change: Record<string, unknown>) {
    try {
      await apiRequest("PUT", `${base}/assistant`, change);
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast({ title: "Couldn't save", description: serverMessage(e, "Try again."), variant: "destructive" });
    }
  }
  async function ask() {
    if (!question.trim()) return;
    setBusy(true);
    setAnswer(null);
    try {
      const r = await (await apiRequest("POST", `${base}/assistant/test`, { message: question })).json();
      setAnswer(`${r.result.reply}${r.result.handoff ? "  (→ hands over to your team)" : ""}`);
    } catch (e) {
      setAnswer(serverMessage(e, "Could not ask."));
    } finally {
      setBusy(false);
    }
  }
  async function subscribe() {
    try {
      await apiRequest("POST", `${base}/assistant/subscribe`);
      toast({ title: "Paid for 30 days" });
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast({ title: "Couldn't pay", description: serverMessage(e, "Add money to your wallet first."), variant: "destructive" });
    }
  }

  if (q.isLoading) return <Loader2 className="w-5 h-5 animate-spin" />;
  if (!q.data) return <p className="text-sm text-destructive">Could not load.</p>;
  const { settings: s, access: a, plan: p } = q.data;
  const planText = a.status === "trial" ? `Free trial until ${day(a.trialEndsAt)} · ${Math.floor(a.voiceSecondsLeft / 60)} call minutes left`
    : a.status === "active" ? `Paid until ${day(a.periodEnd)} · ${Math.floor(a.voiceSecondsLeft / 60)} call minutes left`
    : a.status === "expired" ? `Trial or plan ended. ${rupeesText(p.pricePaise)} a month to keep it.`
    : a.status === "paused" ? "Paused by NeuraTalk. Write to support@mindwhile.com."
    : `${p.trialDays} days free, then ${rupeesText(p.pricePaise)} a month: unlimited chat answers, ${p.voiceMinutes} call minutes (extra ${rupeesText(p.extraMinutePaise)}/min).`;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0" data-testid="assistant-section">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Bot className="w-4 h-4" />AI receptionist</CardTitle>
          <CardDescription>
            Answers customers in chat and on calls, in their language, from your profile, hours, catalog and notes. Takes order and booking requests for
            your team and hands over to a person when needed. It always says it is an AI assistant.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted p-3 text-sm">
            <span>{planText}</span>
            {["trial", "expired", "active"].includes(a.status) && <Button size="sm" onClick={subscribe} data-testid="button-assistant-subscribe">{a.status === "active" ? "Renew" : "Subscribe"} ({rupeesText(p.pricePaise)} from wallet)</Button>}
          </div>
          <label className="flex items-center justify-between gap-3">
            <span className="font-medium">AI receptionist on</span>
            <Switch checked={s.enabled} onCheckedChange={(v) => save({ enabled: v })} data-testid="switch-assistant" />
          </label>
          {s.enabled && (
            <>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant={s.chatMode === "always" ? "default" : "outline"} onClick={() => save({ chatMode: "always" })}>Answer chats any time</Button>
                <Button size="sm" variant={s.chatMode === "outside_hours" ? "default" : "outline"} onClick={() => save({ chatMode: "outside_hours" })}>Only outside opening hours</Button>
              </div>
              <label className="flex items-center justify-between gap-3">
                <span>Answer calls nobody picks up (after {s.ringSeconds} s)</span>
                <Switch checked={s.callsEnabled} onCheckedChange={(v) => save({ callsEnabled: v })} />
              </label>
              <div className="space-y-1">
                <Label htmlFor="as-k">What customers ask (it already knows your profile, hours and catalog)</Label>
                <Textarea id="as-k" rows={6} maxLength={12000} value={form.knowledge} onChange={(e) => setForm({ ...form, knowledge: e.target.value })}
                  placeholder="Free delivery within 3 km. Bulk orders need 1 day notice. Payment by UPI or cash." data-testid="input-assistant-knowledge" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="as-i">How it should talk</Label>
                <Input id="as-i" maxLength={2000} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} placeholder="Warm and short." />
              </div>
              <Button onClick={() => save({ knowledge: form.knowledge || null, instructions: form.instructions || null, assistantName: form.assistantName || null })} data-testid="button-assistant-save">Save</Button>
            </>
          )}
        </CardContent>
      </Card>
      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle>Try it</CardTitle><CardDescription>Ask like a customer before they do.</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            <div className="flex gap-2">
              <Input value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} placeholder='"Do you deliver to Brodipet?"' data-testid="input-assistant-question" />
              <Button size="icon" onClick={ask} disabled={busy} aria-label="Ask">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}</Button>
            </div>
            {answer && <p className="rounded-md bg-primary/10 p-3 text-sm" data-testid="assistant-answer">🤖 {answer}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Conversations it handled</CardTitle></CardHeader>
          <CardContent>
            {!(inbox.data?.items.length) ? <p className="text-sm text-muted-foreground">Nothing yet.</p> : (
              <ul className="divide-y text-sm">
                {inbox.data.items.slice(0, 30).map((i) => (
                  <li key={i.id} className="py-2 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{i.counterpartName ?? "Customer"}</span>
                      <Badge variant="secondary">{i.channel === "call" ? "Call" : "Chat"}</Badge>
                      {i.handoff && <Badge variant="destructive">Needs a person</Badge>}
                      {i.lead && <Badge>Request</Badge>}
                    </div>
                    {i.summary && <p className="text-muted-foreground">{i.summary}</p>}
                    {i.lead && <p className="text-xs">{Object.entries(i.lead).map(([k, v]) => `${k}: ${String(v)}`).join(" · ")}</p>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
