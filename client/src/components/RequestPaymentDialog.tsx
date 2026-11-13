import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";
import { serverMessage } from "@/lib/server-message";

type Settings = { upiId: string; payeeName: string } | null;

export function useUpiSettings(businessId: number, enabled = true) {
  return useQuery<{ settings: Settings }>({
    queryKey: ["/api/business", businessId, "payment-settings"],
    queryFn: async () => (await apiRequest("GET", `/api/business/${businessId}/payment-settings`)).json(),
    enabled: businessId > 0 && enabled,
  });
}

/** Save the business's UPI ID (shown to customers on payment requests). */
export function UpiSettingsForm({ businessId, current, onSaved }: { businessId: number; current: Settings; onSaved?: () => void }) {
  const queryClient = useQueryClient();
  const [upiId, setUpiId] = useState(current?.upiId ?? "");
  const [payeeName, setPayeeName] = useState(current?.payeeName ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setUpiId(current?.upiId ?? ""); setPayeeName(current?.payeeName ?? ""); }, [current?.upiId, current?.payeeName]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await apiRequest("PUT", `/api/business/${businessId}/payment-settings`, { upiId, payeeName });
      await queryClient.invalidateQueries({ queryKey: ["/api/business", businessId, "payment-settings"] });
      onSaved?.();
    } catch (e) {
      setError(serverMessage(e, "Could not save."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="upi-id">UPI ID</Label>
        <Input id="upi-id" value={upiId} onChange={(e) => setUpiId(e.target.value)} placeholder="shopname@okaxis" data-testid="input-upi-id" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="upi-name">Name shown to customers</Label>
        <Input id="upi-name" value={payeeName} onChange={(e) => setPayeeName(e.target.value)} placeholder="Sri Sai Tiffins" data-testid="input-upi-name" />
      </div>
      <p className="text-xs text-muted-foreground">Customers pay to this UPI ID from their own UPI app. The money goes straight to your bank; NeuraTalk never holds it.</p>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <Button onClick={save} disabled={busy} data-testid="button-save-upi">{busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Save UPI ID</Button>
    </div>
  );
}

/** Ask the customer in this chat to pay by UPI. */
export function RequestPaymentDialog({ businessId, conversationId, open, onOpenChange, onSent }: {
  businessId: number; conversationId: number; open: boolean; onOpenChange: (o: boolean) => void; onSent: () => void;
}) {
  const settings = useUpiSettings(businessId, open);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const rupees = Number(amount.replace(/,/g, ""));
    if (!Number.isFinite(rupees) || rupees < 1) { setError("Enter an amount of ₹1 or more."); return; }
    setBusy(true);
    setError(null);
    try {
      await apiRequest("POST", `/api/business/${businessId}/conversations/${conversationId}/payment-request`, {
        amountPaise: Math.round(rupees * 100), ...(note.trim() ? { note: note.trim() } : {}),
      });
      setAmount("");
      setNote("");
      onOpenChange(false);
      onSent();
    } catch (e) {
      setError(serverMessage(e, "Could not send the request."));
    } finally {
      setBusy(false);
    }
  }

  const s = settings.data?.settings ?? null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Request payment (UPI)</DialogTitle></DialogHeader>
        {settings.isLoading ? (
          <Loader2 className="w-5 h-5 animate-spin mx-auto" />
        ) : !s ? (
          <>
            <p className="text-sm text-muted-foreground">Add your UPI ID first.</p>
            <UpiSettingsForm businessId={businessId} current={null} />
          </>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="pay-amount">Amount (₹)</Label>
              <Input id="pay-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="250" data-testid="input-pay-amount" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pay-note">For (optional)</Label>
              <Input id="pay-note" value={note} maxLength={80} onChange={(e) => setNote(e.target.value)} placeholder="2 idli + dosa" />
            </div>
            <p className="text-xs text-muted-foreground">Paid to {s.upiId}, straight to your bank.</p>
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
            <Button className="w-full" onClick={send} disabled={busy} data-testid="button-send-payment-request">
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Send request
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
