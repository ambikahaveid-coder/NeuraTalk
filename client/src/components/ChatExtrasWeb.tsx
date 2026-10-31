import { useEffect, useState } from "react";
import { BarChart3, CheckCircle2, Circle, Eye, Loader2, UserRound } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getAuthToken } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

export type WebPoll = {
  question: string;
  options: Array<{ id: string; text: string; votes: number }>;
  multiple: boolean;
  totalVoters: number;
  myVotes: string[];
};
export type WebContact = { name: string; phones: string[]; userId: number | null };

/** True when a chat message needs one of the special views below. */
export function isSpecialMessage(m: { poll?: unknown; contact?: unknown; viewOnce?: boolean; messageType?: string; attachmentUrl?: string | null }) {
  return Boolean(m.poll || m.contact || m.viewOnce || (m.messageType === "sticker" && m.attachmentUrl));
}

/**
 * Polls (vote here), contact cards, stickers and view-once photos for the
 * website chat. `apiBase` is "/api/personal-chats/<id>" or "/api/group-chats/<id>".
 */
export function ChatExtrasWeb({
  message,
  apiBase,
  isOwn,
  question,
  onChanged,
}: {
  message: { id: number | string; poll?: WebPoll | null; contact?: WebContact | null; viewOnce?: boolean; viewOnceOpened?: boolean; messageType?: string; attachmentUrl?: string | null; attachmentMime?: string | null; createdAt?: string };
  apiBase: string;
  isOwn: boolean;
  question?: string;
  onChanged?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [viewUrl, setViewUrl] = useState<string | null>(null);
  const [viewType, setViewType] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const auth = { Authorization: `Bearer ${getAuthToken() ?? ""}` };
  const box = cn("max-w-[85%] rounded-2xl border p-3 text-sm", isOwn ? "bg-primary/10 border-primary/20" : "bg-card");

  if (message.messageType === "sticker" && message.attachmentUrl && !message.viewOnce) {
    return <StickerImg path={message.attachmentUrl} />;
  }

  if (message.poll) {
    const poll = message.poll;
    const vote = async (optionId: string) => {
      if (typeof message.id !== "number" || busy) return;
      const mine = poll.myVotes.includes(optionId);
      const next = mine ? poll.myVotes.filter((x) => x !== optionId) : poll.multiple ? [...poll.myVotes, optionId] : [optionId];
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`${apiBase}/messages/${message.id}/vote`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ optionIds: next }) });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not vote.");
        onChanged?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not vote.");
      } finally {
        setBusy(false);
      }
    };
    return (
      <div className={box} data-testid={`web-poll-${message.id}`}>
        <p className="flex items-center gap-1 text-xs text-muted-foreground"><BarChart3 className="w-3.5 h-3.5" /> Poll · {poll.multiple ? "select one or more" : "select one"}</p>
        <p className="font-semibold mt-1 mb-2">{question || poll.question}</p>
        <div className="space-y-2">
          {poll.options.map((o) => {
            const mine = poll.myVotes.includes(o.id);
            const pct = poll.totalVoters ? Math.round((o.votes / poll.totalVoters) * 100) : 0;
            return (
              <button key={o.id} type="button" disabled={busy} onClick={() => vote(o.id)} className="w-full text-left" data-testid={`web-poll-option-${o.id}`}>
                <div className="flex items-center gap-2">
                  {mine ? <CheckCircle2 className="w-4 h-4 text-primary" /> : <Circle className="w-4 h-4 text-muted-foreground" />}
                  <span className="flex-1">{o.text}</span>
                  <span className="text-xs text-muted-foreground">{o.votes}</span>
                </div>
                <div className="ml-6 mt-1 h-1.5 rounded bg-muted overflow-hidden"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground mt-2">{poll.totalVoters === 1 ? "1 person voted" : `${poll.totalVoters} people voted`}</p>
        {error && <p className="text-xs text-destructive mt-1">{error}</p>}
      </div>
    );
  }

  if (message.contact) {
    const c = message.contact;
    return (
      <div className={box} data-testid={`web-contact-${message.id}`}>
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center"><UserRound className="w-5 h-5 text-primary" /></div>
          <div>
            <p className="font-semibold">{c.name}</p>
            {c.phones[0] && <a href={`tel:${c.phones[0].replace(/\s/g, "")}`} className="text-xs text-primary underline">{c.phones[0]}</a>}
            {c.userId ? <p className="text-xs text-green-600 dark:text-green-400">On NeuraTalk</p> : null}
          </div>
        </div>
      </div>
    );
  }

  if (message.viewOnce) {
    const alreadyOpened = opened || Boolean(message.viewOnceOpened);
    const isVideo = (message.attachmentMime ?? "").startsWith("video") || message.messageType === "file";
    const open = async () => {
      if (typeof message.id !== "number" || busy) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`${apiBase}/messages/${message.id}/view-once`, { headers: auth });
        if (res.status === 410) { setOpened(true); throw new Error("This was already opened."); }
        if (!res.ok) throw new Error("Could not open. Try again.");
        const blob = await res.blob();
        setViewType(blob.type);
        setViewUrl(URL.createObjectURL(blob));
        setOpened(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not open.");
      } finally {
        setBusy(false);
      }
    };
    const close = () => {
      if (viewUrl) URL.revokeObjectURL(viewUrl);
      setViewUrl(null);
      onChanged?.();
    };
    return (
      <div className={box} data-testid={`web-view-once-${message.id}`}>
        <button type="button" disabled={isOwn || alreadyOpened || busy} onClick={open} className="flex items-center gap-2 disabled:cursor-default">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4 text-primary" />}
          <span className={cn("font-medium", alreadyOpened && "italic text-muted-foreground")}>
            {alreadyOpened ? "Opened" : isOwn ? `View once ${isVideo ? "video" : "photo"}` : `${isVideo ? "Video" : "Photo"} · view once — click to open`}
          </span>
        </button>
        {error && <p className="text-xs text-destructive mt-1">{error}</p>}
        <Dialog open={Boolean(viewUrl)} onOpenChange={(o) => { if (!o) close(); }}>
          <DialogContent className="max-w-3xl">
            <DialogHeader><DialogTitle>View once</DialogTitle></DialogHeader>
            {viewUrl && (viewType.startsWith("video")
              ? <video src={viewUrl} controls autoPlay className="w-full max-h-[70vh]" />
              : <img src={viewUrl} alt="View once" className="w-full max-h-[70vh] object-contain" onContextMenu={(e) => e.preventDefault()} />)}
            <Button variant="outline" onClick={close}>Close — it can't be opened again</Button>
          </DialogContent>
        </Dialog>
      </div>
    );
  }
  return null;
}

/** A sticker: just the picture, fetched with the session (chat files are private). */
function StickerImg({ path }: { path: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    fetch(path, { headers: { Authorization: `Bearer ${getAuthToken() ?? ""}` } })
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then((b) => { if (!cancelled) { url = URL.createObjectURL(b); setSrc(url); } })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [path]);
  if (failed) return <span className="text-xs text-muted-foreground">Sticker</span>;
  return src ? <img src={src} alt="Sticker" className="w-36 h-36 object-contain" data-testid="web-sticker" /> : <div className="w-36 h-36 rounded-xl bg-muted animate-pulse" />;
}
