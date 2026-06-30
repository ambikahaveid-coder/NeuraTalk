export default function ReleaseNotesPage() {
  const releases = [
    {
      version: "2.5.0",
      date: "June 2026",
      type: "major",
      highlights: [
        "Enterprise Number Integration Hub — connect existing Airtel/Jio/BSNL/SIP numbers without migration",
        "Kamailio SIP Core production deployment with LCR failover across Indian carriers",
        "RTPEngine media proxy with SRTP encryption and AI-fork transcription pipeline",
        "AI Agent Assist — real-time GPT suggestions during live calls with escalation detection",
        "Multi-language AI transcription with OpenAI Whisper + Azure Cognitive Services fallback",
      ],
    },
    {
      version: "2.4.0",
      date: "May 2026",
      type: "major",
      highlights: [
        "LiveKit WebRTC integration for enterprise-grade voice and video calling",
        "PSTN calling via SIP trunk integration with Indian carriers",
        "Real-time call quality monitoring with jitter, packet loss, and MOS score",
        "Enterprise billing with usage-based credit metering",
        "Company admin dashboard with agent management and call routing",
      ],
    },
    {
      version: "2.3.0",
      date: "April 2026",
      type: "major",
      highlights: [
        "AI Voice Cloning — create personalised voice models from voice samples",
        "50+ language translation support with dialect awareness",
        "Face-to-Face translator mode with dual-pane real-time translation",
        "Voice assistant with customisable AI personas",
        "Meeting scheduler with Google Calendar integration",
      ],
    },
    {
      version: "2.2.0",
      date: "March 2026",
      type: "minor",
      highlights: [
        "Mobile PWA with offline-capable dashboard",
        "Push notifications for incoming calls and messages",
        "Dark mode improvements and design system refresh",
        "Call history export to CSV and PDF",
        "Enhanced accessibility: screen reader support, keyboard navigation",
      ],
    },
    {
      version: "2.1.0",
      date: "February 2026",
      type: "minor",
      highlights: [
        "Investor dashboard with real-time metrics and financial projections",
        "API documentation portal with live playground",
        "Webhook support for enterprise call events",
        "Multi-region session management with Redis Sentinel",
        "HMAC-signed webhook verification with timing-safe comparison",
      ],
    },
    {
      version: "2.0.0",
      date: "January 2026",
      type: "major",
      highlights: [
        "Complete platform redesign with glassmorphism dark UI",
        "Firebase OTP authentication replacing email/password",
        "Role-based access control (Super Admin / Company Admin / Agent / Consumer)",
        "Razorpay payment integration with UPI and card support",
        "DPDP Act 2023 compliance infrastructure",
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-6">Release Notes</h1>
          <p className="text-muted-foreground">
            What's new in NeuraTalk — product updates, new features, and improvements
          </p>
        </div>
      </section>

      <section className="py-12 px-4">
        <div className="max-w-3xl mx-auto space-y-8">
          {releases.map((release) => (
            <div key={release.version} className="bg-card border rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <h2 className="text-2xl font-bold">v{release.version}</h2>
                  <span className={`text-xs px-2 py-1 rounded font-medium ${
                    release.type === "major"
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground"
                  }`}>
                    {release.type === "major" ? "Major Release" : "Minor Update"}
                  </span>
                </div>
                <span className="text-sm text-muted-foreground">{release.date}</span>
              </div>
              <ul className="space-y-2">
                {release.highlights.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className="text-primary mt-0.5 flex-shrink-0">•</span>
                    <span className="text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div className="bg-card border rounded-xl p-6 text-center">
            <h3 className="font-bold mb-2">Stay Updated</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Get notified when new features are released.
            </p>
            <a href="mailto:updates@neuratalk.in?subject=Subscribe to Release Notes" className="inline-block px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors">
              Subscribe to Updates
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
