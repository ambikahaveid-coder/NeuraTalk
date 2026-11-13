import { useState } from "react";
import { useLocation, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Link2, Loader2, Smartphone, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { serverMessage } from "@/lib/server-message";

const RETURN_TO_KEY = "neuratalk_return_to";

type Preview ={ id: number; name: string; description: string | null; members: number; createdBy: string | null; alreadyMember: boolean };

/** A group invite link (neuratalk.in/g/<code>): see the group, then join it here or in the app. */
export default function GroupInvitePage() {
  const [, params] = useRoute("/g/:code");
  const [, navigate] = useLocation();
  const { isAuthenticated } = useAuth();
  const code = params?.code ?? "";
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useQuery<{ group: Preview }>({
    queryKey: ["/api/group-invites", code],
    queryFn: async () => (await apiRequest("GET", `/api/group-invites/${encodeURIComponent(code)}`)).json(),
    enabled: !!code && isAuthenticated,
    retry: false,
  });

  const isAndroid = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
  // Opens the app if installed; otherwise Android shows the Play Store page.
  const appLink = isAndroid
    ? `intent://g/${code}#Intent;scheme=neuratalk;package=com.Mindwhile.neuratalk;S.browser_fallback_url=${encodeURIComponent("https://play.google.com/store/apps/details?id=com.Mindwhile.neuratalk")};end`
    : `neuratalk://g/${code}`;

  async function join() {
    setJoining(true);
    setError(null);
    try {
      await (await apiRequest("POST", `/api/group-invites/${encodeURIComponent(code)}/join`)).json();
      navigate("/web");
    } catch (e) {
      setError(serverMessage(e, "Could not join."));
      setJoining(false);
    }
  }

  function signIn() {
    try { sessionStorage.setItem(RETURN_TO_KEY, `/g/${code}`); } catch { /* storage unavailable */ }
    navigate("/login");
  }

  const g = preview.data?.group;
  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <Card className="max-w-sm w-full">
        <CardContent className="py-8 px-6 text-center space-y-4">
          <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Users className="w-8 h-8 text-primary" aria-hidden />
          </div>
          {!isAuthenticated ? (
            <>
              <div>
                <h1 className="text-xl font-bold">You're invited to a group</h1>
                <p className="text-sm text-muted-foreground mt-1">Everyone reads the group in their own language on NeuraTalk.</p>
              </div>
              <Button asChild className="w-full" data-testid="invite-open-app">
                <a href={appLink}><Smartphone className="w-4 h-4 mr-2" />Open in the NeuraTalk app</a>
              </Button>
              <Button variant="outline" className="w-full" onClick={signIn} data-testid="invite-sign-in">
                Sign in to join on the web
              </Button>
            </>
          ) : preview.isLoading ? (
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground mx-auto" aria-label="Loading" />
          ) : preview.isError || !g ? (
            <div>
              <Link2 className="w-6 h-6 text-destructive mx-auto" aria-hidden />
              <p className="font-medium mt-2">This invite link isn't valid any more</p>
              <p className="text-sm text-muted-foreground mt-1">Ask the group admin for a new one.</p>
            </div>
          ) : (
            <>
              <div>
                <h1 className="text-xl font-bold" data-testid="invite-group-name">{g.name}</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  Group · {g.members} member{g.members === 1 ? "" : "s"}{g.createdBy ? ` · created by ${g.createdBy}` : ""}
                </p>
                {g.description && <p className="text-sm mt-2">{g.description}</p>}
              </div>
              {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
              {g.alreadyMember ? (
                <Button className="w-full" onClick={() => navigate("/web")}>You're in this group — open chats</Button>
              ) : (
                <Button className="w-full" onClick={join} disabled={joining} data-testid="invite-join">
                  {joining ? "Joining…" : "Join group"}
                </Button>
              )}
              <a href={appLink} className="block text-sm text-primary underline underline-offset-4">Open in the app instead</a>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
