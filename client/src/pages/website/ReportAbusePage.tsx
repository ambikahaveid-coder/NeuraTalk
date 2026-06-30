import { useState } from "react";

export default function ReportAbusePage() {
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({
    type: "",
    description: "",
    evidence: "",
    reporterEmail: "",
  });

  const abuseTypes = [
    "Spam or Unwanted Calls",
    "Harassment or Threats",
    "Voice Cloning / Impersonation Without Consent",
    "Fraud or Scam",
    "Hate Speech or Discrimination",
    "Copyright / Intellectual Property Violation",
    "Illegal Content or Activity",
    "Privacy Violation / Unauthorised Recording",
    "AI Misuse (Deepfake, Synthetic Voice Fraud)",
    "Other",
  ];

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-card border rounded-xl p-8 text-center">
          <div className="text-5xl mb-4">✅</div>
          <h2 className="text-2xl font-bold mb-3">Report Submitted</h2>
          <p className="text-muted-foreground mb-2">
            Thank you for helping keep NeuraTalk safe. We take all reports seriously.
          </p>
          <p className="text-sm text-muted-foreground mb-6">
            Our Trust &amp; Safety team will review your report within <strong>24–48 hours</strong>.
            If you provided an email, we'll keep you updated.
          </p>
          <a href="/" className="inline-block px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
            Return to Home
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-6">Report Abuse</h1>
          <p className="text-muted-foreground">
            Help us keep NeuraTalk safe for everyone. All reports are reviewed by our Trust &amp; Safety team.
          </p>
        </div>
      </section>

      <section className="py-12 px-4">
        <div className="max-w-2xl mx-auto">
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-8">
            <p className="text-sm text-amber-700 dark:text-amber-300">
              <strong>Emergency:</strong> If you are in immediate danger or this involves a criminal matter,
              contact law enforcement directly. For cybercrime in India: <strong>cybercrime.gov.in</strong> or call <strong>1930</strong>.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="bg-card border rounded-xl p-8 space-y-6">
            <div>
              <label className="block text-sm font-medium mb-2">Type of Abuse *</label>
              <select
                required
                className="w-full px-3 py-2 border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                <option value="">Select abuse type...</option>
                {abuseTypes.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Description *</label>
              <textarea
                required
                rows={5}
                placeholder="Describe what happened in as much detail as possible. Include dates, times, phone numbers involved, and any other relevant information."
                className="w-full px-3 py-2 border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Evidence / Screenshots</label>
              <textarea
                rows={3}
                placeholder="Paste links, call IDs, or describe any evidence you have. (File uploads: email evidence to trust@neuratalk.in)"
                className="w-full px-3 py-2 border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                value={form.evidence}
                onChange={(e) => setForm({ ...form, evidence: e.target.value })}
              />
              <p className="text-xs text-muted-foreground mt-1">
                To attach files or recordings as evidence, email them to trust@neuratalk.in referencing your report.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Your Email (optional)</label>
              <input
                type="email"
                placeholder="your@email.com — for updates on this report"
                className="w-full px-3 py-2 border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                value={form.reporterEmail}
                onChange={(e) => setForm({ ...form, reporterEmail: e.target.value })}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Anonymous reports are accepted. Providing your email lets us follow up with you.
              </p>
            </div>

            <div className="bg-muted rounded-lg p-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground mb-1">What happens after you report:</p>
              <ul className="space-y-1">
                <li>• Our Trust &amp; Safety team reviews all reports within 24–48 hours.</li>
                <li>• For serious violations (fraud, impersonation, illegal content), we act within hours.</li>
                <li>• We may contact you for more information if you provided an email.</li>
                <li>• We will not share your identity with the reported party without your consent.</li>
                <li>• False or malicious reports may result in action against the reporter's account.</li>
              </ul>
            </div>

            <button
              type="submit"
              className="w-full py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
            >
              Submit Report
            </button>
          </form>

          <div className="mt-8 bg-card border rounded-xl p-6">
            <h3 className="font-bold mb-3">Other Ways to Report</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><strong>Email:</strong> trust@neuratalk.in</li>
              <li><strong>Legal notices:</strong> legal@neuratalk.in</li>
              <li><strong>Law enforcement requests:</strong> legal@neuratalk.in (include official letterhead)</li>
              <li><strong>Grievance Officer (India):</strong> grievance@neuratalk.in</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
