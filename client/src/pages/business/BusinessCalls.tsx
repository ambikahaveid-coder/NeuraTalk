import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Loader2, Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing } from "lucide-react";
import { getAuthToken } from "@/hooks/use-auth";

type CallRecord = {
  callId: string; direction: "outbound" | "inbound"; callerNumber: string | null; calleeNumber: string | null;
  durationSeconds: number; costPaise: number; result: string; translationEnabled: boolean; startedAt: string;
  callerLanguage: string; calleeLanguage: string | null;
};
type Data = {
  numbers: Array<{ id: number; phoneNumber: string; label: string | null; type: string; isActive: boolean }>;
  calls: CallRecord[];
  phoneLineReady: boolean;
};

const RESULT: Record<string, string> = { completed: "Answered", failed: "Failed", busy: "Busy", "no-answer": "No answer", cancelled: "Cancelled", missed: "Missed" };
const dur = (s: number) => (s >= 60 ? `${Math.floor(s / 60)} min ${s % 60}s` : `${s}s`);
const when = (iso: string) => new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** Business phone calls: its numbers, call history, and calling a customer's phone. */
export function BusinessCalls({ businessId }: { businessId: number }) {
  const [, setLocation] = useLocation();
  const [phone, setPhone] = useState("");
  const q = useQuery<Data>({
    queryKey: ["/api/business", businessId, "phone-calls"],
    queryFn: async () => {
      const res = await fetch(`/api/business/${businessId}/phone-calls`, { headers: { Authorization: `Bearer ${getAuthToken() ?? ""}` } });
      if (!res.ok) throw new Error("Couldn't load calls");
      return res.json();
    },
    enabled: businessId > 0,
    refetchInterval: 30000,
  });
  const valid = /^\+?[0-9 ]{10,16}$/.test(phone.trim());
  const dial = () => {
    const n = phone.replace(/\s/g, "");
    setLocation(`/calls/c2c?identifier=${encodeURIComponent(n.startsWith("+") ? n : `+91${n}`)}&mode=voice`);
  };

  if (q.isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (q.isError || !q.data) return <p className="text-sm text-destructive">Couldn't load your calls. Please try again.</p>;
  const d = q.data;
  const active = d.numbers.filter((n) => n.isActive);

  return (
    <div className="space-y-6" data-testid="business-calls">
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <section className="rounded-3xl border bg-background p-5">
          <h2 className="font-semibold">Call a customer's phone</h2>
          <p className="mt-1 text-sm text-muted-foreground">They answer on any phone. You talk in your language, they hear theirs.</p>
          {d.phoneLineReady && active.length > 0 ? (
            <div className="mt-4 flex gap-2">
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98765 43210"
                inputMode="tel"
                className="h-11 flex-1 rounded-full border bg-background px-4"
                data-testid="input-dial-number"
              />
              <button type="button" onClick={dial} disabled={!valid} className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-primary-foreground disabled:opacity-50" data-testid="button-dial">
                <Phone className="h-4 w-4" /> Call
              </button>
            </div>
          ) : (
            <p className="mt-4 rounded-2xl bg-muted/60 p-4 text-sm" data-testid="text-phone-line-not-ready">
              {active.length === 0
                ? "Your business doesn't have a phone number yet. Ask NeuraTalk to add one; calls to it will ring your team in the app."
                : "Phone calls aren't switched on yet. NeuraTalk is connecting the telephone line."}
              {" "}You can still call customers who use NeuraTalk from their chat.
            </p>
          )}
        </section>

        <section className="rounded-3xl border bg-background p-5">
          <h2 className="font-semibold">Your numbers</h2>
          {d.numbers.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No numbers yet.</p>
          ) : (
            <ul className="mt-3 divide-y">
              {d.numbers.map((n) => (
                <li key={n.id} className="flex items-center justify-between py-2.5 text-sm">
                  <span><span className="font-mono">{n.phoneNumber}</span>{n.label ? <span className="text-muted-foreground"> · {n.label}</span> : null}</span>
                  <span className={n.isActive ? "text-green-600" : "text-muted-foreground"}>{n.isActive ? "On" : "Off"}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="rounded-3xl border bg-background">
        <h2 className="border-b px-5 py-4 font-semibold">Recent phone calls</h2>
        {d.calls.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No phone calls yet.</p>
        ) : (
          <ul className="divide-y">
            {d.calls.map((c) => {
              const missed = c.result !== "completed";
              const other = c.direction === "inbound" ? c.callerNumber : c.calleeNumber;
              const Icon = missed ? PhoneMissed : c.direction === "inbound" ? PhoneIncoming : PhoneOutgoing;
              return (
                <li key={c.callId} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <Icon className={`h-4 w-4 shrink-0 ${missed ? "text-red-500" : "text-primary"}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{other || "Unknown number"}</span>
                    <span className="block text-muted-foreground">{c.direction === "inbound" ? "Incoming" : "Outgoing"} · {RESULT[c.result] ?? c.result}{c.result === "completed" ? ` · ${dur(c.durationSeconds)}` : ""}{c.translationEnabled ? " · translated" : ""}</span>
                  </span>
                  <span className="shrink-0 text-right text-xs text-muted-foreground">{when(c.startedAt)}{c.costPaise > 0 ? <><br />₹{(c.costPaise / 100).toFixed(2)}</> : null}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
