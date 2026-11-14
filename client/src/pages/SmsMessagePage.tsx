import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Building2, Loader2, MessageCircle, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { serverMessage } from "@/lib/server-message";

type Data = {
  business: { id: number; name: string; logoUrl: string | null; chatLink: string };
  message: { content: string; createdAt: string; metadata: { header: string | null; footer: string | null } };
};

/** The link inside a business SMS (neuratalk.in/m/<code>): read the message, then reply on NeuraTalk. Public. */
export default function SmsMessagePage() {
  const [, params] = useRoute("/m/:token");
  const token = params?.token ?? "";
  const q = useQuery<Data>({
    queryKey: ["/api/sms-links", token],
    queryFn: async () => {
      const r = await fetch(`/api/sms-links/${encodeURIComponent(token)}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`${r.status}: ${JSON.stringify(j)}`);
      return j as Data;
    },
    enabled: !!token,
    retry: false,
  });
  const isAndroid = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardContent className="py-8 px-6 space-y-5">
          {q.isLoading ? (
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground mx-auto" aria-label="Loading" />
          ) : q.isError || !q.data ? (
            <div className="text-center" role="alert">
              <p className="font-medium">{serverMessage(q.error, "This link isn't valid.")}</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden shrink-0">
                  {q.data.business.logoUrl ? <img src={q.data.business.logoUrl} alt="" className="w-12 h-12 object-cover" /> : <Building2 className="w-6 h-6 text-primary" aria-hidden />}
                </div>
                <div className="min-w-0">
                  <h1 className="font-bold text-lg truncate" data-testid="sms-business-name">{q.data.business.name}</h1>
                  <p className="text-xs text-muted-foreground">{new Date(q.data.message.createdAt).toLocaleString()}</p>
                </div>
              </div>
              <div className="rounded-2xl rounded-tl-none bg-background border p-4 space-y-2" data-testid="sms-message">
                {q.data.message.metadata.header && <p className="font-semibold">{q.data.message.metadata.header}</p>}
                <p className="whitespace-pre-wrap break-words">{q.data.message.content}</p>
                {q.data.message.metadata.footer && <p className="text-xs text-muted-foreground">{q.data.message.metadata.footer}</p>}
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Reply to {q.data.business.name} on NeuraTalk — free, and in your own language.</p>
                <Button asChild className="w-full">
                  <a href={isAndroid ? "https://play.google.com/store/apps/details?id=com.Mindwhile.neuratalk" : "/"}><Smartphone className="w-4 h-4 mr-2" />Get NeuraTalk</a>
                </Button>
                <Button asChild variant="outline" className="w-full">
                  <a href={q.data.business.chatLink}><MessageCircle className="w-4 h-4 mr-2" />Reply on the web</a>
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">You got this link by SMS because {q.data.business.name} messaged your number. NeuraTalk never shares your number.</p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
