import { useEffect, useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type TwoStepResult = { token: string; user: any };

/**
 * Asked after the OTP when the account has two-step verification on.
 * Resolves with the session; rejects if the person cancels or runs out of tries.
 */
export function TwoStepDialog({
  ticket,
  resetAvailableAt,
  onDone,
  onCancel,
}: {
  ticket: string;
  resetAvailableAt?: string | null;
  onDone: (result: TwoStepResult) => void;
  onCancel: (reason: string) => void;
}) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (resetAvailableAt) setInfo(`A PIN reset is pending. You can sign in without it after ${new Date(resetAvailableAt).toLocaleDateString()}.`);
  }, [resetAvailableAt]);

  async function submit(value = pin) {
    if (!/^\d{6}$/.test(value)) {
      setError("Enter your 6-digit PIN.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/two-step/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket, pin: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.token) {
        onDone({ token: data.token, user: data.user });
        return;
      }
      setPin("");
      setError(data?.message || "Wrong PIN.");
      if (res.status === 429 || data?.code === "TICKET_EXPIRED") onCancel(data?.message || "Please sign in again.");
    } catch {
      setError("Could not check the PIN. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  async function forgot() {
    if (!window.confirm("For your safety, the PIN can only be removed 7 days after you ask. Signing in with the PIN before then cancels the reset. Request a reset?")) return;
    try {
      const res = await fetch("/api/auth/two-step/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket }),
      });
      const data = await res.json().catch(() => ({}));
      setInfo(data?.resetAvailableAt
        ? `Reset requested. You can sign in without the PIN after ${new Date(data.resetAvailableAt).toLocaleDateString()}.`
        : data?.message || "Reset requested.");
    } catch {
      setError("Could not request a reset. Check your connection.");
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel("Sign-in cancelled."); }}>
      <DialogContent className="max-w-sm" data-testid="dialog-two-step">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Lock className="w-5 h-5 text-primary" /> Two-step verification</DialogTitle>
          <DialogDescription>This account is protected with a 6-digit PIN.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => { e.preventDefault(); void submit(); }}
        >
          <Input
            autoFocus
            type="password"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={pin}
            className="text-center text-2xl tracking-[0.5em]"
            aria-label="Two-step PIN"
            data-testid="input-two-step-pin"
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "").slice(0, 6);
              setPin(v);
              if (v.length === 6 && !busy) void submit(v);
            }}
          />
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          {info && <p className="text-sm text-muted-foreground">{info}</p>}
          <Button type="submit" className="w-full" disabled={busy} data-testid="button-two-step-continue">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Continue"}
          </Button>
          <Button type="button" variant="ghost" className="w-full" onClick={forgot} disabled={busy}>Forgot PIN?</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
