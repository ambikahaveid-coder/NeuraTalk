import { useQuery } from "@tanstack/react-query";
import { Loader2, Mail, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { BrandMark } from "@/components/BrandMark";

/**
 * A partner's own sign-in page (/p/<link name>): its logo, name and colour.
 * Partner staff open their panel; the partner's businesses open their
 * dashboard. Only the public brand is shown here.
 */
type Brand = { brandName: string; slug: string; logoUrl: string | null; primaryColor: string | null; supportEmail: string | null; supportPhone: string | null };

export const PARTNER_RETURN_KEY = "neuratalk_return_to";

export default function PartnerSignInPage({ slug }: { slug: string }) {
  const { isAuthenticated } = useAuth();
  const q = useQuery<{ brand: Brand }>({
    queryKey: ["/api/partners/brand", slug],
    queryFn: async () => {
      const r = await fetch(`/api/partners/brand/${encodeURIComponent(slug)}`);
      if (!r.ok) throw new Error("not found");
      return r.json();
    },
    retry: false,
  });

  if (q.isLoading) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (q.error || !q.data) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">This partner page doesn't exist or is not active.</p>
      </div>
    );
  }
  const b = q.data.brand;
  const color = b.primaryColor || "#0f766e";
  const go = (path: string) => {
    if (!isAuthenticated) {
      try { sessionStorage.setItem(PARTNER_RETURN_KEY, path); } catch { /* storage unavailable */ }
      window.location.href = "/login";
      return;
    }
    window.location.href = path;
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4" style={{ background: `linear-gradient(160deg, ${color}22, transparent 60%)` }} data-testid="partner-signin">
      <Card className="w-full max-w-sm">
        <CardContent className="space-y-5 p-6 text-center">
          <div className="flex justify-center"><BrandMark name={b.brandName} logoUrl={b.logoUrl} color={color} className="h-16 w-16 rounded-2xl" textClassName="text-2xl" /></div>
          <div>
            <h1 className="text-xl font-semibold" data-testid="partner-signin-brand">{b.brandName}</h1>
            <p className="text-sm text-muted-foreground">Business messaging and calls in every Indian language</p>
          </div>
          <div className="space-y-2">
            <Button className="w-full text-white" style={{ background: color }} onClick={() => go("/company")} data-testid="button-partner-business-login">I run a business — sign in</Button>
            <Button className="w-full" variant="outline" onClick={() => go("/partner")} data-testid="button-partner-staff-login">Partner staff sign-in</Button>
          </div>
          {(b.supportEmail || b.supportPhone) && (
            <div className="space-y-1 text-xs text-muted-foreground">
              {b.supportEmail && <p className="flex items-center justify-center gap-1"><Mail className="h-3 w-3" />{b.supportEmail}</p>}
              {b.supportPhone && <p className="flex items-center justify-center gap-1"><Phone className="h-3 w-3" />{b.supportPhone}</p>}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">Powered by NeuraTalk</p>
        </CardContent>
      </Card>
    </div>
  );
}
