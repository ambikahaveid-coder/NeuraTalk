import { useEffect, useState } from "react";

type ServiceState = "operational" | "degraded" | "outage";

interface SystemStatus {
  status: ServiceState;
  services: { name: string; status: ServiceState; latency?: number; message?: string }[];
  lastUpdated: string;
}

const LABEL: Record<ServiceState, string> = {
  operational: "Operational",
  degraded: "Degraded",
  outage: "Outage",
};

const DOT: Record<ServiceState, string> = {
  operational: "bg-green-500",
  degraded: "bg-amber-500",
  outage: "bg-red-500",
};

const TEXT: Record<ServiceState, string> = {
  operational: "text-green-600 dark:text-green-400",
  degraded: "text-amber-600 dark:text-amber-400",
  outage: "text-red-600 dark:text-red-400",
};

const HEADLINE: Record<ServiceState, string> = {
  operational: "All core systems operational",
  degraded: "Some systems are degraded",
  outage: "Service outage",
};

const REFRESH_MS = 60_000;

// Everything on this page comes from the live /api/status check. No uptime
// history or incident log is shown because none is recorded yet.
export default function StatusPage() {
  const [data, setData] = useState<SystemStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        const body = (await res.json()) as SystemStatus;
        if (!alive) return;
        setData(body.services ? body : null);
        setFailed(!body.services);
      } catch {
        if (alive) setFailed(true);
      }
    };
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const overall: ServiceState = failed ? "outage" : data?.status ?? "operational";

  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-6">Platform Status</h1>
          <p className="text-muted-foreground">Live service checks for NeuraTalk, refreshed every minute</p>
        </div>
      </section>

      <section className="py-12 px-4">
        <div className="max-w-4xl mx-auto space-y-8">
          {!data && !failed ? (
            <div className="bg-card border rounded-xl p-6 text-muted-foreground">Checking services…</div>
          ) : (
            <div className="bg-card border rounded-xl p-6 flex items-center gap-4">
              <div className={`w-4 h-4 rounded-full flex-shrink-0 ${DOT[overall]}`} />
              <div className="min-w-0">
                <h2 className={`text-lg font-bold ${TEXT[overall]}`}>
                  {failed ? "Status check unavailable" : HEADLINE[overall]}
                </h2>
                {data && (
                  <p className="text-sm text-muted-foreground">
                    Last checked {new Date(data.lastUpdated).toLocaleTimeString()}
                  </p>
                )}
              </div>
            </div>
          )}

          {data && (
            <div className="bg-card border rounded-xl divide-y">
              {data.services.map((svc) => (
                <div key={svc.name} className="p-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-3 h-3 rounded-full flex-shrink-0 ${DOT[svc.status]}`} />
                    <div className="min-w-0">
                      <div className="font-medium">{svc.name}</div>
                      {svc.message && <div className="text-xs text-muted-foreground">{svc.message}</div>}
                    </div>
                  </div>
                  <span className={`text-sm font-medium flex-shrink-0 ${TEXT[svc.status]}`}>{LABEL[svc.status]}</span>
                </div>
              ))}
            </div>
          )}

          <div className="bg-card border rounded-xl p-6">
            <h3 className="font-bold text-lg mb-2">Report a problem</h3>
            <p className="text-sm text-muted-foreground">
              Seeing an issue that is not listed here? Email{" "}
              <a className="text-primary underline" href="mailto:support@mindwhile.com">support@mindwhile.com</a>{" "}
              and include the time and what you were doing.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
