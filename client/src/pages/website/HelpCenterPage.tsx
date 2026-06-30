export default function HelpCenterPage() {
  const sections = [
    {
      title: "Getting Started",
      icon: "🚀",
      articles: [
        { title: "How to create a NeuraTalk account", desc: "Sign up with your phone number via OTP authentication." },
        { title: "Making your first call with translation", desc: "Start a voice call and enable real-time translation in one tap." },
        { title: "Understanding NeuraTalk Credits", desc: "How credits work, how to top up, and what each feature costs." },
        { title: "Choosing the right plan", desc: "Compare Free, Basic, Pro, and Enterprise plans." },
      ],
    },
    {
      title: "Voice & Video Calls",
      icon: "📞",
      articles: [
        { title: "How does real-time voice translation work?", desc: "AI translates your speech as you speak, in under 1 second." },
        { title: "Supported languages and translation quality", desc: "50+ languages with accuracy tiers — know what to expect." },
        { title: "Poor call quality troubleshooting", desc: "Fix audio dropouts, echo, and translation delays." },
        { title: "Enabling call recording", desc: "How to record calls legally with participant consent." },
        { title: "Using the Face-to-Face translator", desc: "In-person translation mode with dual-pane display." },
      ],
    },
    {
      title: "AI Features",
      icon: "🤖",
      articles: [
        { title: "Creating a Voice Clone", desc: "Record voice samples to create your personalised AI voice model." },
        { title: "Setting up AI Personas", desc: "Configure the AI assistant to match your communication style." },
        { title: "Agent Assist for enterprise teams", desc: "Real-time AI suggestions during customer calls." },
        { title: "Understanding AI accuracy limitations", desc: "When to use AI translation and when to use a human interpreter." },
      ],
    },
    {
      title: "Enterprise & Business",
      icon: "🏢",
      articles: [
        { title: "Setting up your company account", desc: "Invite agents, configure departments, and set up routing." },
        { title: "Connecting an existing business number (Number Hub)", desc: "Register your Airtel/Jio/BSNL/SIP number without migration." },
        { title: "SIP trunk configuration", desc: "Connect enterprise PBX or SIP providers to NeuraTalk." },
        { title: "API integration guide", desc: "Use the NeuraTalk API for custom call flows and automation." },
        { title: "Webhook setup and security", desc: "Receive real-time events with HMAC-verified webhooks." },
      ],
    },
    {
      title: "Account & Billing",
      icon: "💳",
      articles: [
        { title: "How to upgrade or change plans", desc: "Switch plans without losing your data or credits." },
        { title: "Requesting a refund", desc: "Eligible refund scenarios and how to initiate a request." },
        { title: "Exporting your data", desc: "Download your call history, contacts, and settings." },
        { title: "Deleting your account", desc: "What happens to your data and how to permanently delete." },
        { title: "GST invoices and billing receipts", desc: "Download tax invoices from your billing dashboard." },
      ],
    },
    {
      title: "Privacy & Security",
      icon: "🔒",
      articles: [
        { title: "Is my call content stored?", desc: "Translations are in-memory only; recordings require explicit opt-in." },
        { title: "How do I delete my voice clone?", desc: "Remove your voice identity from Settings → Voice Identity." },
        { title: "Managing consent and data permissions", desc: "Control what data you share and with whom." },
        { title: "Two-factor authentication", desc: "NeuraTalk uses OTP-based auth by default for all users." },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-6">Help Center</h1>
          <p className="text-xl text-muted-foreground mb-8">
            Find answers to common questions about NeuraTalk
          </p>
          <div className="max-w-lg mx-auto">
            <input
              type="search"
              placeholder="Search for help articles..."
              className="w-full px-4 py-3 border rounded-xl bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>
      </section>

      <section className="py-12 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-2 gap-6">
            {sections.map((section) => (
              <div key={section.title} className="bg-card border rounded-xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-2xl">{section.icon}</span>
                  <h2 className="font-bold text-lg">{section.title}</h2>
                </div>
                <ul className="space-y-3">
                  {section.articles.map((article) => (
                    <li key={article.title} className="border-b last:border-0 pb-3 last:pb-0">
                      <p className="text-sm font-medium text-primary cursor-pointer hover:underline">
                        {article.title}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">{article.desc}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-12 bg-card border rounded-xl p-8 text-center">
            <h2 className="text-2xl font-bold mb-3">Still need help?</h2>
            <p className="text-muted-foreground mb-6">
              Our support team is available Monday–Friday, 9am–6pm IST.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <a
                href="mailto:support@neuratalk.in"
                className="inline-flex items-center justify-center px-5 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                📧 Email Support
              </a>
              <a
                href="/contact"
                className="inline-flex items-center justify-center px-5 py-2.5 border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
              >
                📝 Submit a Ticket
              </a>
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              Email: support@neuratalk.in · Phone: +91 80 4567 8900
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
