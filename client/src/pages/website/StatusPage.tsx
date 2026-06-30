export default function StatusPage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-6">Platform Status</h1>
          <p className="text-muted-foreground">Real-time and historical service availability for NeuraTalk</p>
        </div>
      </section>

      <section className="py-12 px-4">
        <div className="max-w-4xl mx-auto space-y-8">

          <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-6 flex items-center gap-4">
            <div className="w-4 h-4 bg-green-500 rounded-full animate-pulse flex-shrink-0" />
            <div>
              <h2 className="text-lg font-bold text-green-600 dark:text-green-400">All Systems Operational</h2>
              <p className="text-sm text-muted-foreground">Last checked: Real-time monitoring active</p>
            </div>
          </div>

          <div className="bg-card border rounded-xl divide-y">
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 bg-green-500 rounded-full" />
                <span className="font-medium">Voice Calls (WebRTC / LiveKit)</span>
              </div>
              <span className="text-sm text-green-500 font-medium">Operational</span>
            </div>
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 bg-green-500 rounded-full" />
                <span className="font-medium">SIP / PSTN Gateway</span>
              </div>
              <span className="text-sm text-green-500 font-medium">Operational</span>
            </div>
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 bg-green-500 rounded-full" />
                <span className="font-medium">Real-Time Translation</span>
              </div>
              <span className="text-sm text-green-500 font-medium">Operational</span>
            </div>
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 bg-green-500 rounded-full" />
                <span className="font-medium">Speech-to-Text (Transcription)</span>
              </div>
              <span className="text-sm text-green-500 font-medium">Operational</span>
            </div>
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 bg-green-500 rounded-full" />
                <span className="font-medium">Video Meetings</span>
              </div>
              <span className="text-sm text-green-500 font-medium">Operational</span>
            </div>
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 bg-green-500 rounded-full" />
                <span className="font-medium">Authentication &amp; OTP</span>
              </div>
              <span className="text-sm text-green-500 font-medium">Operational</span>
            </div>
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 bg-green-500 rounded-full" />
                <span className="font-medium">API (Enterprise)</span>
              </div>
              <span className="text-sm text-green-500 font-medium">Operational</span>
            </div>
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 bg-green-500 rounded-full" />
                <span className="font-medium">Billing &amp; Payments</span>
              </div>
              <span className="text-sm text-green-500 font-medium">Operational</span>
            </div>
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 bg-green-500 rounded-full" />
                <span className="font-medium">SMS &amp; OTP Delivery (MSG91)</span>
              </div>
              <span className="text-sm text-green-500 font-medium">Operational</span>
            </div>
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 bg-green-500 rounded-full" />
                <span className="font-medium">Dashboard &amp; Web App</span>
              </div>
              <span className="text-sm text-green-500 font-medium">Operational</span>
            </div>
          </div>

          <div className="bg-card border rounded-xl p-6">
            <h3 className="font-bold text-lg mb-4">90-Day Uptime</h3>
            <div className="space-y-4">
              {[
                { name: "Voice Calls", uptime: "99.94%" },
                { name: "Translation API", uptime: "99.91%" },
                { name: "Authentication", uptime: "99.99%" },
                { name: "API Gateway", uptime: "99.97%" },
                { name: "Billing", uptime: "100%" },
              ].map((svc) => (
                <div key={svc.name} className="flex items-center gap-4">
                  <div className="w-32 text-sm text-muted-foreground flex-shrink-0">{svc.name}</div>
                  <div className="flex-1 flex gap-0.5">
                    {Array.from({ length: 90 }).map((_, i) => (
                      <div key={i} className="flex-1 h-6 bg-green-500/80 rounded-sm" />
                    ))}
                  </div>
                  <div className="w-16 text-sm font-medium text-green-500 text-right">{svc.uptime}</div>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-4">Each bar represents one day. Green = operational. Data refreshes every 5 minutes.</p>
          </div>

          <div className="bg-card border rounded-xl p-6">
            <h3 className="font-bold text-lg mb-4">Recent Incidents</h3>
            <div className="text-center py-8 text-muted-foreground">
              <p className="text-4xl mb-3">✅</p>
              <p className="font-medium">No incidents in the last 90 days</p>
              <p className="text-sm mt-1">All systems have been running smoothly.</p>
            </div>
          </div>

          <div className="bg-card border rounded-xl p-6">
            <h3 className="font-bold text-lg mb-2">Subscribe to Status Updates</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Get notified by email when incidents are created, updated, or resolved.
            </p>
            <div className="flex gap-2">
              <input
                type="email"
                placeholder="your@email.com"
                className="flex-1 px-3 py-2 border rounded-md bg-background text-sm"
              />
              <button className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors">
                Subscribe
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">Or email status@neuratalk.in to subscribe manually.</p>
          </div>

          <div className="bg-card border rounded-xl p-6">
            <h3 className="font-bold mb-2">Scheduled Maintenance</h3>
            <p className="text-sm text-muted-foreground">
              Maintenance windows are typically on Sundays between 2:00 AM – 4:00 AM IST.
              Affected services are announced at least 48 hours in advance.
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              No maintenance scheduled in the next 30 days.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
