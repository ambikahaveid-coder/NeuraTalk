import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useContacts } from "@/hooks/use-contacts";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import AppNavigation from "@/components/AppNavigation";
import PhoneIdentityCard from "@/components/PhoneIdentityCard";
import { QueryErrorState } from "@/components/QueryErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Phone, Video, Search, Clock, Star, Sparkles,
  CreditCard, Users, History, Mic, Globe,
} from "lucide-react";

function looksLikePhoneTarget(identifier: string) {
  return /^\+?\d{10,15}$/.test(String(identifier || "").replace(/\s+/g, ""));
}

interface RecentCall {
  id: number | string;
  peerName: string;
  peerIdentifier: string;
  direction: "inbound" | "outbound";
  status: string;
  durationSec?: number;
  startedAt: string;
  translationEnabled?: boolean;
  session?: {
    routeType?: string | null;
    callee?: { displayName?: string | null; phoneNumber?: string | null; externalId?: string | null };
    durationSeconds?: number | null;
    translationEnabled?: boolean | null;
  };
}

export default function ConsumerDashboard() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const { contacts, toggleFavorite } = useContacts();
  const [search, setSearch] = useState("");
  const [dial, setDial] = useState("");

  // NOTE: queryFn used to swallow every failure into a fake "empty/zero"
  // success response (`{ calls: [] }` / `{ balanceInr: 0, ... }`). That made
  // a genuine backend outage indistinguishable from "you really do have ₹0
  // and no call history" — the worst possible UX for a balance display.
  // Letting the error propagate lets react-query's real isError/error state
  // drive an honest error UI with retry instead.
  const {
    data: recentData,
    isLoading: recentLoading,
    isError: recentIsError,
    error: recentError,
    refetch: refetchRecent,
  } = useQuery<{ calls: RecentCall[] }>({
    queryKey: ["/api/calls/history", { limit: 5 }],
    queryFn: async () => await apiRequest("GET", "/api/calls/history?limit=5") as any,
  });

  const {
    data: balanceData,
    isLoading: balanceLoading,
    isError: balanceIsError,
    error: balanceError,
    refetch: refetchBalance,
  } = useQuery<{ balanceInr: number; minutesRemaining: number }>({
    queryKey: ["/api/billing/balance"],
    queryFn: async () => await apiRequest("GET", "/api/billing/balance") as any,
  });

  const filteredContacts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? contacts.filter(c =>
          c.name.toLowerCase().includes(q) ||
          c.identifier.toLowerCase().includes(q))
      : contacts;
    return list.slice(0, 8);
  }, [contacts, search]);

  const favorites = useMemo(() => contacts.filter(c => c.isFavorite).slice(0, 6), [contacts]);
  const contactRouteLabel = (hasApp?: boolean) => (hasApp ? "App" : "PSTN");

  const preferredCallIdentifier = (identifier: string) => {
    const linkedContact = contacts.find((contact) => contact.identifier === identifier);
    return linkedContact?.hasApp ? (linkedContact.appPreferredIdentifier || linkedContact.identifier) : identifier;
  };
  const dialLinkedContact = contacts.find((contact) => contact.identifier === dial.trim());
  const dialLooksLikePstn = dialLinkedContact?.hasApp === false || (!dialLinkedContact && looksLikePhoneTarget(dial.trim()));

  const startCall = (identifier: string, mode: "voice" | "video" = "voice") => {
    const url = `/calls/c2c?identifier=${encodeURIComponent(preferredCallIdentifier(identifier))}&mode=${mode}`;
    navigate(url);
  };

  const handleDial = (mode: "voice" | "video") => {
    const target = dial.trim();
    if (!target) return;
    startCall(target, mode);
  };

  const initials = (name: string) =>
    name.split(" ").map(n => n[0]).slice(0, 2).join("").toUpperCase();

  const recentPeerName = (call: RecentCall) =>
    call.session?.callee?.displayName || call.peerName || call.peerIdentifier;

  const recentPeerIdentifier = (call: RecentCall) =>
    call.session?.routeType === "app_to_app"
      ? call.session?.callee?.externalId || call.session?.callee?.phoneNumber || call.peerIdentifier
      : call.session?.callee?.phoneNumber || call.session?.callee?.externalId || call.peerIdentifier;

  const recentTranslationEnabled = (call: RecentCall) =>
    call.session?.translationEnabled ?? call.translationEnabled;
  const recentRouteLabel = (call: RecentCall) =>
    call.session?.routeType === "app_to_app"
      ? "App"
      : call.session?.routeType === "app_to_pstn"
        ? "PSTN"
        : "Call";

  const recentDurationMinutes = (call: RecentCall) => {
    const durationSeconds = call.session?.durationSeconds ?? call.durationSec;
    return durationSeconds != null ? Math.round(durationSeconds / 60) : null;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      <AppNavigation />

      <div className="container mx-auto p-4 max-w-6xl pt-24 pb-12 space-y-6">
        {/* Greeting + balance strip */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="md:col-span-2">
            <CardContent className="pt-6">
              <p className="text-sm text-gray-500">Welcome back</p>
              <h1 className="text-3xl font-bold">
                {user?.username ?? "there"} 👋
              </h1>
              <p className="text-gray-600 mt-1">
                Ready to talk across any language — make a call in one tap.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6 space-y-2">
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <CreditCard className="w-4 h-4" /> Balance
              </div>
              {balanceLoading ? (
                <>
                  <Skeleton className="h-8 w-24" />
                  <Skeleton className="h-3 w-32" />
                </>
              ) : balanceIsError ? (
                <QueryErrorState error={balanceError} onRetry={() => refetchBalance()} label="your balance" className="p-3" />
              ) : (
                <>
                  <div className="text-2xl font-bold">
                    ₹{(balanceData?.balanceInr ?? 0).toFixed(2)}
                  </div>
                  <div className="text-xs text-gray-500">
                    ~{balanceData?.minutesRemaining ?? 0} min of translated calling
                  </div>
                </>
              )}
              <Button
                size="sm" variant="outline" className="w-full mt-2"
                onClick={() => navigate("/billing")}
              >
                Add credit
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Dial pad */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Phone className="w-5 h-5 text-blue-600" /> Quick Dial
            </CardTitle>
            <CardDescription>
              Enter a phone number or NeuraTalk username to call. Translation is automatic if languages differ.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-3">
              <Input
                placeholder="+91 98xxxxxxx or username"
                value={dial}
                onChange={e => setDial(e.target.value)}
                className="flex-1 text-lg"
                onKeyDown={e => { if (e.key === "Enter") handleDial("voice"); }}
              />
              <Button onClick={() => handleDial("voice")} className="gap-2">
                <Phone className="w-4 h-4" /> Voice
              </Button>
              <Button
                onClick={() => handleDial("video")}
                variant="outline"
                className="gap-2"
                disabled={dialLooksLikePstn}
                title={dialLooksLikePstn ? "Video is available only for app-to-app targets" : "Start video call"}
              >
                <Video className="w-4 h-4" /> Video
              </Button>
            </div>
            {dialLooksLikePstn ? (
              <p className="mt-3 text-xs text-gray-500">
                This target looks like a mobile/PSTN number. Use voice for the phone bridge. Video is available only app-to-app.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2 mt-4 text-xs text-gray-500">
              <Badge variant="secondary" className="gap-1">
                <Sparkles className="w-3 h-3" /> AI translation
              </Badge>
              <Badge variant="secondary" className="gap-1">
                <Globe className="w-3 h-3" /> 12+ languages
              </Badge>
              <Badge variant="secondary" className="gap-1">
                <Mic className="w-3 h-3" /> Emotion-preserving
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Phone Identity — caller ID verify + call forwarding */}
        <PhoneIdentityCard />

        {/* Favorites + Contacts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2">
                <Star className="w-5 h-5 text-yellow-500 fill-yellow-400" />
                Favorites
              </CardTitle>
              <Link href="/calls/c2c">
                <Button variant="ghost" size="sm">View all</Button>
              </Link>
            </CardHeader>
            <CardContent>
              {favorites.length === 0 ? (
                <p className="text-sm text-gray-500 py-6 text-center">
                  Tap the star on any contact to pin them here.
                </p>
              ) : (
                <div className="space-y-2">
                  {favorites.map(c => (
                    <div key={c.id} className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded-lg">
                      <Avatar className="w-10 h-10">
                        <AvatarFallback>{initials(c.name)}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{c.name}</div>
                        <div className="text-xs text-gray-500 truncate flex items-center gap-2">
                          <span>{c.identifier}</span>
                          <Badge variant={c.hasApp ? "secondary" : "outline"} className="h-5 px-2">
                            {contactRouteLabel(c.hasApp)}
                          </Badge>
                        </div>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => toggleFavorite(c.id)}>
                        <Star className="w-4 h-4 fill-yellow-400 text-yellow-500" />
                      </Button>
                      <Button size="sm" onClick={() => startCall(c.identifier, "voice")} className="bg-green-500 hover:bg-green-600">
                        <Phone className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-600" />
                Contacts
              </CardTitle>
              <div className="relative mt-2">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                <Input
                  className="pl-10"
                  placeholder="Search contacts..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            </CardHeader>
            <CardContent>
              {filteredContacts.length === 0 ? (
                <p className="text-sm text-gray-500 py-6 text-center">
                  No contacts yet — add your first from the calling page.
                </p>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {filteredContacts.map(c => (
                    <div key={c.id} className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded-lg">
                      <Avatar className="w-9 h-9">
                        <AvatarFallback>{initials(c.name)}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{c.name}</div>
                        <div className="text-xs text-gray-500 truncate">
                          {c.language?.toUpperCase() ?? "EN"} · {c.identifier}
                        </div>
                      </div>
                      <div className="shrink-0">
                        <Badge variant={c.hasApp ? "secondary" : "outline"} className="h-5 px-2">
                          {contactRouteLabel(c.hasApp)}
                        </Badge>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => startCall(c.identifier, "voice")}>
                        <Phone className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={c.hasApp === false}
                        title={c.hasApp === false ? "Video is available only for app-to-app contacts" : "Start video call"}
                        onClick={() => startCall(c.identifier, "video")}
                      >
                        <Video className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Recent calls */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2">
              <History className="w-5 h-5 text-purple-600" /> Recent calls
            </CardTitle>
            <Link href="/call-history">
              <Button variant="ghost" size="sm">Full history</Button>
            </Link>
          </CardHeader>
          <CardContent>
            {recentLoading ? (
              <div className="space-y-3 py-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : recentIsError ? (
              <QueryErrorState error={recentError} onRetry={() => refetchRecent()} label="your recent calls" />
            ) : !recentData?.calls || recentData.calls.length === 0 ? (
              <p className="text-sm text-gray-500 py-6 text-center">
                Your recent calls will appear here.
              </p>
            ) : (
              <div className="divide-y">
                {recentData.calls.map(call => (
                  <div key={call.id} className="flex items-center gap-3 py-3">
                    <Avatar className="w-9 h-9">
                      <AvatarFallback>{initials(recentPeerName(call) || "?")}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{recentPeerName(call)}</div>
                      <div className="text-xs text-gray-500 flex items-center gap-2">
                        <Clock className="w-3 h-3" />
                        {new Date(call.startedAt).toLocaleString()}
                        {recentDurationMinutes(call) != null && <span>· {recentDurationMinutes(call)}m</span>}
                        {recentTranslationEnabled(call) && <Sparkles className="w-3 h-3 text-purple-500" />}
                      </div>
                    </div>
                    <Badge variant={call.direction === "inbound" ? "secondary" : "outline"} className="text-xs">
                      {call.direction}
                    </Badge>
                    <Badge variant={call.session?.routeType === "app_to_app" ? "secondary" : "outline"} className="text-xs">
                      {recentRouteLabel(call)}
                    </Badge>
                    <Button size="sm" variant="ghost" onClick={() => startCall(recentPeerIdentifier(call), "voice")}>
                      <Phone className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
