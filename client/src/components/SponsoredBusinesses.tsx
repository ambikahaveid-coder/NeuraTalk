import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Building2, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";

type Ad = { id: number; businessId: number; businessName: string; logoUrl: string | null; headline: string; body: string; button: string };

/** "Sponsored" businesses: NeuraTalk's own click-to-chat ads (reviewed by NeuraTalk). */
export function SponsoredBusinesses() {
  const [, navigate] = useLocation();
  const ads = useQuery<{ ads: Ad[] }>({
    queryKey: ["/api/ads/feed"],
    queryFn: async () => (await apiRequest("GET", "/api/ads/feed")).json(),
    staleTime: 5 * 60_000,
    retry: false,
  });
  if (!ads.data?.ads.length) return null;

  async function chat(ad: Ad) {
    try {
      const r = await (await apiRequest("POST", `/api/ads/${ad.id}/chat`)).json();
      navigate(`/business-chat/${r.businessId}`);
    } catch {
      navigate(`/business-chat/${ad.businessId}`);
    }
  }

  return (
    <section aria-label="Sponsored" className="space-y-2">
      {ads.data.ads.map((ad) => (
        <div key={ad.id} className="flex gap-3 rounded-xl border bg-card p-3" data-testid={`sponsored-${ad.id}`}>
          {ad.logoUrl ? <img src={ad.logoUrl} alt="" className="w-11 h-11 rounded-full object-cover shrink-0" /> : (
            <div className="w-11 h-11 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0"><Building2 className="w-5 h-5" /></div>
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-xs text-muted-foreground truncate">{ad.businessName} · <span className="font-medium">Sponsored</span></p>
            <p className="font-semibold leading-snug">{ad.headline}</p>
            <p className="text-sm text-muted-foreground">{ad.body}</p>
            <Button size="sm" onClick={() => chat(ad)} data-testid={`sponsored-chat-${ad.id}`}>
              <MessageCircle className="w-4 h-4 mr-1.5" />{ad.button}
            </Button>
          </div>
        </div>
      ))}
    </section>
  );
}
