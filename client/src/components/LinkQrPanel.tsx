import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Loader2, RefreshCw, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";

type Start = { secret: string; code: string; expiresAt: string };

/**
 * The QR code + short code a computer shows so a phone can link it (like WhatsApp Web).
 * Polls until the phone approves, then hands the new login (this computer's own session) to onLinked.
 */
export function LinkQrPanel({ onLinked }: { onLinked: (token: string, user: any) => void }) {
  const [start, setStart] = useState<Start | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const linkedRef = useRef(onLinked);
  linkedRef.current = onLinked;

  const begin = useCallback(async () => {
    setExpired(false);
    setError(null);
    setStart(null);
    setQr(null);
    try {
      const res = await fetch("/api/link-device/start", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data?.secret) throw new Error(data?.message || "Please try again.");
      setStart(data);
      setQr(await QRCode.toDataURL(`${window.location.origin}/link-device?code=${data.code}`, { margin: 1, width: 264 }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    }
  }, []);

  useEffect(() => { void begin(); }, [begin]);

  useEffect(() => {
    if (!start) return;
    const poll = async () => {
      try {
        const res = await fetch(`/api/link-device/status?secret=${encodeURIComponent(start.secret)}`);
        const data = await res.json();
        if (data?.status === "linked" && data.token && data.user) {
          linkedRef.current(data.token, data.user);
          return;
        }
        if (data?.status === "expired") {
          setExpired(true);
          return;
        }
      } catch { /* network blip: keep trying */ }
      timer.current = window.setTimeout(poll, 2000);
    };
    timer.current = window.setTimeout(poll, 2000);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [start]);

  const pretty = start ? `${start.code.slice(0, 4)}-${start.code.slice(4)}` : "";

  return (
    <div className="flex flex-col items-center gap-3" data-testid="link-device-qr-area">
      {error ? (
        <div className="flex h-64 w-64 flex-col items-center justify-center gap-3 rounded-2xl border p-4 text-center">
          <p className="text-sm text-destructive" role="alert">{error}</p>
          <Button onClick={begin} className="rounded-full"><RefreshCw className="mr-2 h-4 w-4" />Try again</Button>
        </div>
      ) : expired ? (
        <div className="flex h-64 w-64 flex-col items-center justify-center gap-3 rounded-2xl border p-4 text-center">
          <p className="text-sm text-muted-foreground">The code expired.</p>
          <Button onClick={begin} className="rounded-full" data-testid="button-new-code"><RefreshCw className="mr-2 h-4 w-4" />Get a new code</Button>
        </div>
      ) : qr ? (
        <img src={qr} alt="QR code to link this computer" className="h-64 w-64 rounded-2xl border bg-white p-2" data-testid="img-link-qr" />
      ) : (
        <div className="flex h-64 w-64 items-center justify-center rounded-2xl border"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      )}
      {start && !expired && (
        <p className="font-mono text-xl tracking-[0.25em]" data-testid="text-link-code" aria-label={`Code ${pretty}`}>{pretty}</p>
      )}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Smartphone className="h-3.5 w-3.5" /> Waiting for your phone…</p>
    </div>
  );
}
