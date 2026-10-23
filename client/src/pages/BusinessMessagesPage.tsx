import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BadgeCheck, Building2, Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { QueryErrorState } from "@/components/QueryErrorState";
import { apiRequest } from "@/lib/queryClient";
import { getAuthToken } from "@/hooks/use-auth";

/**
 * The consumer's "Business" inbox: every business they have a chat with --
 * order updates, codes, offers and their own conversations -- newest first.
 */

export interface BusinessThread {
  businessId: number;
  businessName: string;
  logoUrl: string | null;
  lastMessage: { content: string; createdAt: string | null; fromBusiness: boolean } | null;
  unreadCount: number;
}

const THREADS_KEY = ["/api/messaging/business-threads"];

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { day: "numeric", month: "short" });
}

export default function BusinessMessagesPage() {
  const queryClient = useQueryClient();
  const threadsQuery = useQuery<{ success: true; threads: BusinessThread[] }>({
    queryKey: THREADS_KEY,
    queryFn: async () => (await apiRequest("GET", "/api/messaging/business-threads")).json(),
    refetchInterval: 15000,
  });

  // A new business message anywhere refreshes the list (personal-chat stream
  // carries an app-wide "business.message" signal).
  useEffect(() => {
    const token = getAuthToken();
    if (!token) return;
    const source = new EventSource(`/api/personal-chats/stream?auth=${encodeURIComponent(token)}`);
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload?.type === "business.message") queryClient.invalidateQueries({ queryKey: THREADS_KEY });
      } catch {
        // ignore malformed frames; the 15 s refresh keeps the list current
      }
    };
    source.onerror = () => source.close();
    return () => source.close();
  }, [queryClient]);

  const threads = threadsQuery.data?.threads ?? [];
  const [query, setQuery] = useState("");
  const searchQuery = useQuery<{ success: true; businesses: Array<{ id: number; name: string; logoUrl: string | null; category: string | null; city: string | null; verified: boolean }> }>({
    queryKey: ["/api/messaging/businesses", query.trim()],
    queryFn: async () => (await apiRequest("GET", `/api/messaging/businesses?q=${encodeURIComponent(query.trim())}`)).json(),
    enabled: query.trim().length >= 2,
  });
  const found = searchQuery.data?.businesses ?? [];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="border-b px-4 py-3 bg-background/70 backdrop-blur-sm flex items-center gap-3">
        <Link href="/chat">
          <Button variant="ghost" size="icon" aria-label="Back to chats" data-testid="button-business-messages-back">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </Link>
        <h1 className="font-semibold text-lg">Business messages</h1>
      </div>

      <main className="flex-1 w-full max-w-2xl mx-auto p-4 space-y-4">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a business by name, type or city"
            className="pl-9"
            aria-label="Find a business"
            data-testid="input-find-business"
          />
        </div>
        {query.trim().length >= 2 && (
          <section aria-label="Businesses found">
            {searchQuery.isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
            ) : found.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No business found for “{query.trim()}”.</p>
            ) : (
              <ul className="divide-y rounded-lg border bg-card" data-testid="list-found-businesses">
                {found.map((b) => (
                  <li key={b.id}>
                    <Link href={`/business-chat/${b.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 outline-none focus-visible:bg-muted/50">
                      {b.logoUrl ? <img src={b.logoUrl} alt="" className="w-10 h-10 rounded-full object-cover" /> : (
                        <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center"><Building2 className="w-5 h-5" /></div>
                      )}
                      <div className="min-w-0">
                        <p className="font-medium flex items-center gap-1 truncate">{b.name}{b.verified && <BadgeCheck className="w-4 h-4 text-primary shrink-0" aria-label="Verified" />}</p>
                        <p className="text-xs text-muted-foreground truncate">{[b.category, b.city].filter(Boolean).join(" · ") || "Business"}</p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {threadsQuery.isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : threadsQuery.isError ? (
          <QueryErrorState error={threadsQuery.error} onRetry={() => threadsQuery.refetch()} label="business messages" />
        ) : threads.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <Building2 className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p className="font-medium text-foreground">No business messages yet</p>
              <p className="text-sm mt-1">Order updates, verification codes and offers from businesses you use will show up here. Search above to message a business.</p>
            </CardContent>
          </Card>
        ) : (
          <ul className="divide-y rounded-lg border bg-card" data-testid="list-business-threads">
            {threads.map((thread) => (
              <li key={thread.businessId}>
                <Link
                  href={`/business-chat/${thread.businessId}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 focus-visible:bg-muted/50 outline-none"
                  data-testid={`link-business-thread-${thread.businessId}`}
                >
                  {thread.logoUrl ? (
                    <img src={thread.logoUrl} alt="" className="w-11 h-11 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="w-11 h-11 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <Building2 className="w-5 h-5" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={`truncate ${thread.unreadCount ? "font-semibold" : "font-medium"}`}>{thread.businessName}</span>
                      <span className="text-xs text-muted-foreground shrink-0">{formatWhen(thread.lastMessage?.createdAt)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <p className={`text-sm truncate ${thread.unreadCount ? "text-foreground" : "text-muted-foreground"}`}>
                        {thread.lastMessage ? `${thread.lastMessage.fromBusiness ? "" : "You: "}${thread.lastMessage.content}` : ""}
                      </p>
                      {thread.unreadCount > 0 && (
                        <Badge className="rounded-full px-2 shrink-0" aria-label={`${thread.unreadCount} unread`}>{thread.unreadCount}</Badge>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
