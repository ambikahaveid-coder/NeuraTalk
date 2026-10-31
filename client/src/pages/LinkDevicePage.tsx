import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Link, useLocation } from "wouter";
import { Loader2, RefreshCw, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LogoWithIcon } from "@/components/Logo";
import { useAuth } from "@/hooks/use-auth";

type Start = { secret: string; code: string; expiresAt: string };

/**
 * Use NeuraTalk on this computer by linking it from your phone (like WhatsApp Web):
 * show a QR + short code, the phone approves, this page signs in.
 */
export default function LinkDevicePage() {
  const { setAuth } = useAuth();
  const [, setLocation] = useLocation();
  const [start, setStart] = useState<Start | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

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
      setQr(await QRCode.toDataURL(`${window.location.origin}/link-device?code=${data.code}`, { margin: 1, width: 240 }));
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
          setAuth(data.token, data.user);
          setLocation("/login"); // signed-in visitors are sent on to their own dashboard
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
  }, [start, setAuth, setLocation]);

  const pretty = start ? `${start.code.slice(0, 4)}-${start.code.slice(4)}` : "";

  return (
    <div className="min-h-screen bg-background flex flex-col items-center px-4 py-10">
      <Link href="/"><LogoWithIcon size="md" /></Link>
      <Card className="w-full max-w-3xl mt-8">
        <CardContent className="p-6 sm:p-10 grid gap-8 md:grid-cols-[1fr_auto] items-center">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold mb-4">Use NeuraTalk on this computer</h1>
            <ol className="space-y-3 text-muted-foreground list-decimal pl-5">
              <li>Open <strong className="text-foreground">NeuraTalk</strong> on your phone.</li>
              <li>Go to <strong className="text-foreground">More → Linked devices</strong> and tap <strong className="text-foreground">Link a device</strong>.</li>
              <li>Point your phone at this QR code, or type the code below.</li>
            </ol>
            <p className="text-sm text-muted-foreground mt-6">
              Only link computers you trust. You can sign this computer out any time from your phone (More → Linked devices).
            </p>
            <p className="text-sm mt-4"><Link href="/login" className="text-primary underline">Sign in with your phone number instead</Link></p>
          </div>
          <div className="flex flex-col items-center gap-3" data-testid="link-device-qr-area">
            {error ? (
              <div className="text-center space-y-3">
                <p className="text-destructive text-sm" role="alert">{error}</p>
                <Button onClick={begin}><RefreshCw className="w-4 h-4 mr-2" />Try again</Button>
              </div>
            ) : expired ? (
              <div className="w-60 h-60 rounded-xl border flex flex-col items-center justify-center gap-3 text-center p-4">
                <p className="text-sm text-muted-foreground">The code expired.</p>
                <Button onClick={begin} data-testid="button-new-code"><RefreshCw className="w-4 h-4 mr-2" />Get a new code</Button>
              </div>
            ) : qr ? (
              <img src={qr} alt="QR code to link this computer" className="w-60 h-60 rounded-xl bg-white p-2" data-testid="img-link-qr" />
            ) : (
              <div className="w-60 h-60 rounded-xl border flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            )}
            {start && !expired && (
              <p className="font-mono text-2xl tracking-widest" data-testid="text-link-code">{pretty}</p>
            )}
            <p className="text-xs text-muted-foreground flex items-center gap-1"><Smartphone className="w-3.5 h-3.5" /> Waiting for your phone…</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
