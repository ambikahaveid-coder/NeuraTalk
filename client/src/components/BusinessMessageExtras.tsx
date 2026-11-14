import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, ExternalLink, IndianRupee, List, MapPin, Phone, Reply, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Extras under a business message, shared by the customer's chat page and
 * the business inbox: reply buttons, list menus, contact cards and UPI
 * payment cards. The customer can tap; the business only sees them.
 */

export type MessageButton = { type: "quick_reply" | "url" | "call" | "copy_code"; id?: string; title: string; url?: string; phone?: string; code?: string };
export type MessageList = { button: string; sections: Array<{ title?: string; rows: Array<{ id: string; title: string; description?: string }> }> };
export type MessageContact = { name: string; phone: string; email?: string; organization?: string };
export type MessagePayment = {
  requestId: number; amountPaise: number; note?: string | null; upiId: string; payeeName: string;
  status: "requested" | "customer_paid" | "paid" | "cancelled"; upiLink: string; reference: string;
};
export type ExtrasMeta = {
  buttons?: MessageButton[]; list?: MessageList; contact?: MessageContact; payment?: MessagePayment; locationRequest?: boolean;
  buttonReply?: { messageId: number; buttonId: string; title?: string };
};

export const rupeesText = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: paise % 100 ? 2 : 0 })}`;

export function MessageButtons({ buttons, tappedId, onReply }: { buttons: MessageButton[]; tappedId?: string | null; onReply?: (id: string) => void }) {
  const [showAll, setShowAll] = useState(false);
  const [copied, setCopied] = useState(false);
  // Like WhatsApp: with more than 3 buttons, show 2 and "See all options".
  const shown = buttons.length > 3 && !showAll ? buttons.slice(0, 2) : buttons;
  return (
    <div className="flex flex-col gap-1.5 mt-1.5" data-testid="message-buttons">
      {shown.map((b, i) => {
        const icon = b.type === "url" ? <ExternalLink className="w-3.5 h-3.5" /> : b.type === "call" ? <Phone className="w-3.5 h-3.5" /> : b.type === "copy_code" ? <Copy className="w-3.5 h-3.5" /> : <Reply className="w-3.5 h-3.5" />;
        if (b.type === "copy_code" && b.code) {
          return (
            <Button
              key={i}
              variant="outline"
              size="sm"
              data-testid="message-copy-code"
              onClick={() => {
                void navigator.clipboard?.writeText(b.code!).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => undefined);
              }}
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : icon}
              <span className="ml-1.5">{copied ? "Copied" : b.title}</span>
              <span className="ml-1.5 font-mono text-xs text-muted-foreground">{b.code}</span>
            </Button>
          );
        }
        if (b.type === "url" && b.url) {
          return <Button key={i} asChild variant="outline" size="sm"><a href={b.url} target="_blank" rel="noopener noreferrer">{icon}<span className="ml-1.5">{b.title}</span></a></Button>;
        }
        if (b.type === "call" && b.phone) {
          return <Button key={i} asChild variant="outline" size="sm"><a href={`tel:${b.phone.replace(/\s/g, "")}`}>{icon}<span className="ml-1.5">{b.title}</span></a></Button>;
        }
        return (
          <Button
            key={i}
            variant="outline"
            size="sm"
            className={cn(tappedId && tappedId === b.id && "border-primary")}
            disabled={!onReply || !!tappedId}
            onClick={() => b.id && onReply?.(b.id)}
          >
            {icon}<span className="ml-1.5">{b.title}</span>
          </Button>
        );
      })}
      {buttons.length > 3 && !showAll && (
        <Button variant="ghost" size="sm" onClick={() => setShowAll(true)} data-testid="message-buttons-all">
          <List className="w-3.5 h-3.5" /><span className="ml-1.5">See all options</span>
        </Button>
      )}
    </div>
  );
}

/** "Send location" under a business message that asked for it. */
export function LocationRequestButton({ onSend, sent }: { onSend?: (loc: { latitude: number; longitude: number }) => Promise<void>; sent?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function share() {
    if (!onSend) return;
    if (!navigator.geolocation) { setError("This browser can't share a location."); return; }
    setBusy(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onSend({ latitude: pos.coords.latitude, longitude: pos.coords.longitude })
          .catch((e) => setError(e instanceof Error ? e.message : "Could not send."))
          .finally(() => setBusy(false));
      },
      () => { setBusy(false); setError("Allow location access in your browser, then try again."); },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }
  return (
    <div className="mt-1.5">
      <Button variant="outline" size="sm" className="w-full" disabled={!onSend || busy || sent} onClick={share} data-testid="message-location-request">
        <MapPin className="w-3.5 h-3.5" /><span className="ml-1.5">{sent ? "Location sent" : busy ? "Finding you…" : "Send location"}</span>
      </Button>
      {error && <p className="text-xs text-destructive mt-1" role="alert">{error}</p>}
    </div>
  );
}

export function MessageListMenu({ list, pickedId, onPick }: { list: MessageList; pickedId?: string | null; onPick?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" className="mt-1.5 w-full" onClick={() => setOpen(true)} data-testid="message-list-open">
        <List className="w-4 h-4 mr-1.5" />{list.button}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{list.button}</DialogTitle></DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto space-y-3">
            {list.sections.map((s, si) => (
              <div key={si}>
                {s.title && <p className="text-xs font-semibold uppercase text-primary mb-1">{s.title}</p>}
                <div className="divide-y rounded-md border">
                  {s.rows.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      disabled={!onPick || !!pickedId}
                      onClick={() => { onPick?.(r.id); setOpen(false); }}
                      className={cn("w-full text-left px-3 py-2 hover:bg-muted disabled:hover:bg-transparent disabled:cursor-default", pickedId === r.id && "bg-primary/10")}
                      data-testid={`message-list-row-${r.id}`}
                    >
                      <p className="text-sm font-medium">{r.title}</p>
                      {r.description && <p className="text-xs text-muted-foreground">{r.description}</p>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ContactCard({ contact }: { contact: MessageContact }) {
  return (
    <div className="mt-1.5 flex items-center gap-3 rounded-lg bg-primary/10 p-2.5" data-testid="message-contact">
      <div className="w-9 h-9 shrink-0 rounded-full bg-primary text-primary-foreground flex items-center justify-center"><User className="w-5 h-5" /></div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold truncate">{contact.name}</p>
        {contact.organization && <p className="text-xs text-muted-foreground truncate">{contact.organization}</p>}
        <p className="text-xs text-muted-foreground">{contact.phone}</p>
      </div>
      <Button asChild variant="ghost" size="icon" aria-label={`Call ${contact.name}`}>
        <a href={`tel:${contact.phone.replace(/\s/g, "")}`}><Phone className="w-4 h-4" /></a>
      </Button>
    </div>
  );
}

const STATUS_CUSTOMER: Record<MessagePayment["status"], string> = {
  requested: "Waiting for payment",
  customer_paid: "You said you paid · the business is checking",
  paid: "Paid ✓",
  cancelled: "Cancelled",
};
const STATUS_BUSINESS: Record<MessagePayment["status"], string> = {
  requested: "Waiting for the customer",
  customer_paid: "Customer says they paid · check your bank",
  paid: "Paid ✓",
  cancelled: "Cancelled",
};

/**
 * UPI payment request. Customer: scan the QR with any UPI app (or tap Pay on
 * a phone), then "I've paid". Business: confirm once the money arrived.
 */
export function PaymentCard({ payment, onPaid, onSettle }: {
  payment: MessagePayment;
  /** Customer view. */
  onPaid?: (reference: string | undefined) => Promise<void>;
  /** Business view. */
  onSettle?: (status: "paid" | "cancelled") => void;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const business = !!onSettle;
  const canPay = !business && !!onPaid && payment.status === "requested";
  const open = payment.status === "requested" || payment.status === "customer_paid";

  useEffect(() => {
    if (!canPay) return;
    let alive = true;
    QRCode.toDataURL(payment.upiLink, { margin: 1, width: 180 }).then((d) => { if (alive) setQr(d); }).catch(() => undefined);
    return () => { alive = false; };
  }, [canPay, payment.upiLink]);

  async function confirmPaid() {
    setBusy(true);
    setError(null);
    try {
      await onPaid?.(reference.trim() || undefined);
      setAsking(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send.");
    } finally {
      setBusy(false);
    }
  }

  const tone = payment.status === "paid" ? "text-green-600" : payment.status === "cancelled" ? "text-muted-foreground" : "text-orange-600";
  return (
    <div className="mt-1.5 rounded-lg border bg-card p-3 space-y-1.5" data-testid="message-payment">
      <div className="flex items-center gap-1">
        <IndianRupee className="w-4 h-4 text-primary" aria-hidden />
        <span className="text-xl font-bold">{rupeesText(payment.amountPaise).slice(1)}</span>
      </div>
      {payment.note && <p className="text-sm text-muted-foreground">{payment.note}</p>}
      <p className="text-xs text-muted-foreground">To {payment.payeeName} · {payment.upiId}</p>
      <p className={cn("text-sm font-semibold", tone)} data-testid="payment-status">{(business ? STATUS_BUSINESS : STATUS_CUSTOMER)[payment.status]}</p>
      {canPay && (
        <div className="space-y-2 pt-1">
          {qr && (
            <div className="flex flex-col items-center gap-1">
              <img src={qr} alt="UPI QR code to pay" className="w-40 h-40 rounded bg-white p-1" />
              <p className="text-xs text-muted-foreground">Scan with any UPI app</p>
            </div>
          )}
          <Button asChild className="w-full md:hidden"><a href={payment.upiLink}>Pay with UPI app</a></Button>
          <Button variant="outline" className="w-full" onClick={() => setAsking(true)} data-testid="payment-i-paid">I've paid</Button>
        </div>
      )}
      {business && open && (
        <div className="flex gap-2 pt-1">
          <Button size="sm" className="flex-1" onClick={() => onSettle?.("paid")} data-testid="payment-received">Money received</Button>
          <Button size="sm" variant="ghost" onClick={() => onSettle?.("cancelled")}>Cancel</Button>
        </div>
      )}
      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>I've paid</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">The business will check that {rupeesText(payment.amountPaise)} reached them.</p>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / reference (optional, 12 digits)" maxLength={30} aria-label="UTR or reference" />
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAsking(false)}>Cancel</Button>
            <Button onClick={confirmPaid} disabled={busy}>{busy ? "Sending…" : "Tell the business"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
