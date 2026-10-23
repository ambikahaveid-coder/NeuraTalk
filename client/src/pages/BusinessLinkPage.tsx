import { useEffect } from "react";
import { useLocation, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { apiRequest } from "@/lib/queryClient";

/** A business's own link (/b/<name>, also inside its QR code): opens its chat. */
export default function BusinessLinkPage() {
  const [, params] = useRoute("/b/:slug");
  const [, navigate] = useLocation();
  const slug = (params?.slug ?? "").toLowerCase();
  const lookup = useQuery<{ success: true; business: { id: number } }>({
    queryKey: ["/api/messaging/business-link", slug],
    queryFn: async () => (await apiRequest("GET", `/api/messaging/business-link/${encodeURIComponent(slug)}`)).json(),
    enabled: !!slug,
    retry: false,
  });
  const businessId = lookup.data?.business?.id;
  useEffect(() => {
    if (businessId) navigate(`/business-chat/${businessId}`, { replace: true });
  }, [businessId, navigate]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      {lookup.isError ? (
        <Card className="max-w-sm w-full">
          <CardContent className="py-10 text-center">
            <p className="font-medium">This business link isn't active</p>
            <p className="text-sm text-muted-foreground mt-1">Check the link or search for the business in Business messages.</p>
          </CardContent>
        </Card>
      ) : (
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" aria-label="Opening chat" />
      )}
    </div>
  );
}
