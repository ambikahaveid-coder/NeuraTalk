export default function TrustCenterPage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-6">Trust Center</h1>
          <p className="text-xl text-muted-foreground mb-4">
            Security, privacy, and compliance — at the core of everything we build
          </p>
          <p className="text-sm text-muted-foreground">
            NeuraTalk is operated by Mindwhile IT Solutions Pvt Ltd
          </p>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-5xl mx-auto">

          <div className="grid md:grid-cols-3 gap-6 mb-16">
            <div className="bg-card border rounded-xl p-6 text-center">
              <div className="w-12 h-12 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl">🔒</span>
              </div>
              <h3 className="font-bold text-lg mb-2">End-to-End Encrypted</h3>
              <p className="text-sm text-muted-foreground">All voice calls and media are encrypted using DTLS-SRTP. TLS 1.3 for all API and web traffic.</p>
            </div>
            <div className="bg-card border rounded-xl p-6 text-center">
              <div className="w-12 h-12 bg-blue-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl">🛡️</span>
              </div>
              <h3 className="font-bold text-lg mb-2">Privacy First</h3>
              <p className="text-sm text-muted-foreground">We don't sell your data. Translations are processed in-memory and never stored without consent.</p>
            </div>
            <div className="bg-card border rounded-xl p-6 text-center">
              <div className="w-12 h-12 bg-purple-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl">✅</span>
              </div>
              <h3 className="font-bold text-lg mb-2">Compliance Ready</h3>
              <p className="text-sm text-muted-foreground">DPDP Act 2023, GDPR, SOC 2 controls, and ISO 27001 security practices built in.</p>
            </div>
          </div>

          <div className="prose prose-neutral dark:prose-invert max-w-none">
            <h2>Security Architecture</h2>

            <h3>Infrastructure Security</h3>
            <ul>
              <li><strong>Network:</strong> All production services run behind a WAF and DDoS protection layer.</li>
              <li><strong>Access Control:</strong> Zero-trust network model; no direct public access to backend services.</li>
              <li><strong>Secrets Management:</strong> All API keys and credentials stored in encrypted secret stores; never in code or config files.</li>
              <li><strong>Patch Management:</strong> Critical security patches applied within 24 hours; routine patches within 7 days.</li>
              <li><strong>Intrusion Detection:</strong> 24/7 monitoring with automated alerting and incident response runbooks.</li>
            </ul>

            <h3>Application Security</h3>
            <ul>
              <li><strong>Authentication:</strong> Firebase Auth with OTP verification; no plain-text passwords stored.</li>
              <li><strong>Session Security:</strong> HTTPOnly, Secure, SameSite=Strict cookies; short session TTL with refresh tokens.</li>
              <li><strong>API Security:</strong> Rate limiting, HMAC-signed webhooks, timing-safe comparisons to prevent timing attacks.</li>
              <li><strong>Input Validation:</strong> All inputs validated using Zod schemas; parameterised queries for all database operations.</li>
              <li><strong>OWASP Top 10:</strong> Actively tested and mitigated (XSS, SQLi, CSRF, SSRF, etc.).</li>
              <li><strong>Dependency Scanning:</strong> Automated vulnerability scanning in CI/CD pipeline.</li>
            </ul>

            <h3>Voice &amp; Media Security</h3>
            <ul>
              <li><strong>Call Encryption:</strong> DTLS-SRTP for all RTP media streams via RTPEngine.</li>
              <li><strong>SRTP:</strong> AES-128-CM-HMAC-SHA1-80 cipher suite.</li>
              <li><strong>SIP TLS:</strong> All SIP signalling over TLS 1.2+.</li>
              <li><strong>No Default Recording:</strong> Calls are never recorded unless explicitly enabled by an admin with appropriate consent flows.</li>
            </ul>

            <h2>Privacy Practices</h2>

            <h3>Data Minimisation</h3>
            <ul>
              <li>We collect only the data necessary to provide the requested service.</li>
              <li>Real-time translations are processed in-memory; audio is not stored after the call ends.</li>
              <li>Call metadata (duration, participants) is retained; content is not stored by default.</li>
            </ul>

            <h3>Data Residency</h3>
            <ul>
              <li>Primary data stored on India-based infrastructure (Digital Ocean, Mumbai region).</li>
              <li>No cross-border data transfers without adequate safeguards (SCCs, adequacy decisions).</li>
            </ul>

            <h3>Third-Party Processors</h3>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="border p-2 text-left">Processor</th>
                  <th className="border p-2 text-left">Purpose</th>
                  <th className="border p-2 text-left">Compliance</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border p-2">OpenAI</td>
                  <td className="border p-2">AI translation &amp; transcription</td>
                  <td className="border p-2">SOC 2 Type II, GDPR DPA</td>
                </tr>
                <tr>
                  <td className="border p-2">Razorpay</td>
                  <td className="border p-2">Payment processing</td>
                  <td className="border p-2">PCI-DSS Level 1, RBI licensed</td>
                </tr>
                <tr>
                  <td className="border p-2">Firebase (Google)</td>
                  <td className="border p-2">Authentication</td>
                  <td className="border p-2">ISO 27001, SOC 2, GDPR</td>
                </tr>
                <tr>
                  <td className="border p-2">Digital Ocean</td>
                  <td className="border p-2">Cloud infrastructure</td>
                  <td className="border p-2">SOC 2 Type II, ISO 27001</td>
                </tr>
                <tr>
                  <td className="border p-2">LiveKit</td>
                  <td className="border p-2">WebRTC media infrastructure</td>
                  <td className="border p-2">SOC 2 Type II</td>
                </tr>
                <tr>
                  <td className="border p-2">MSG91</td>
                  <td className="border p-2">SMS &amp; OTP delivery</td>
                  <td className="border p-2">TRAI compliant, India DPA</td>
                </tr>
              </tbody>
            </table>

            <h2>Compliance Certifications</h2>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="border p-2 text-left">Framework</th>
                  <th className="border p-2 text-left">Status</th>
                  <th className="border p-2 text-left">Scope</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border p-2">DPDP Act 2023 (India)</td>
                  <td className="border p-2"><span className="text-green-500 font-semibold">Compliant</span></td>
                  <td className="border p-2">Full platform</td>
                </tr>
                <tr>
                  <td className="border p-2">GDPR (EU)</td>
                  <td className="border p-2"><span className="text-green-500 font-semibold">Compliant</span></td>
                  <td className="border p-2">EU users</td>
                </tr>
                <tr>
                  <td className="border p-2">SOC 2 Type II</td>
                  <td className="border p-2"><span className="text-yellow-500 font-semibold">Controls in place</span></td>
                  <td className="border p-2">Audit in progress</td>
                </tr>
                <tr>
                  <td className="border p-2">ISO 27001</td>
                  <td className="border p-2"><span className="text-yellow-500 font-semibold">Controls in place</span></td>
                  <td className="border p-2">Certification in progress</td>
                </tr>
                <tr>
                  <td className="border p-2">PCI-DSS</td>
                  <td className="border p-2"><span className="text-green-500 font-semibold">Compliant</span></td>
                  <td className="border p-2">Payment processing via Razorpay</td>
                </tr>
              </tbody>
            </table>

            <h2>Vulnerability Disclosure</h2>
            <p>
              We welcome responsible disclosure of security vulnerabilities. If you discover a security
              issue, please report it to <strong>security@neuratalk.in</strong> before making it public.
              We commit to:
            </p>
            <ul>
              <li>Acknowledge your report within 48 hours.</li>
              <li>Provide status updates every 7 days.</li>
              <li>Resolve critical vulnerabilities within 30 days.</li>
              <li>Credit researchers who disclose responsibly (with permission).</li>
            </ul>
            <p>We do not pursue legal action against researchers who follow responsible disclosure practices.</p>

            <h2>Incident Response</h2>
            <p>In the event of a security incident:</p>
            <ul>
              <li>Affected users will be notified within 72 hours (GDPR) or promptly under DPDP.</li>
              <li>Notifications will include: what happened, what data was affected, what we're doing about it, and what you can do.</li>
              <li>We maintain a documented incident response plan reviewed quarterly.</li>
            </ul>

            <h2>Contact Security &amp; Trust Team</h2>
            <div className="bg-muted p-4 rounded-lg">
              <p><strong>Security Issues:</strong> security@neuratalk.in</p>
              <p><strong>Trust &amp; Safety:</strong> trust@neuratalk.in</p>
              <p><strong>DPO:</strong> dpo@neuratalk.in</p>
              <p><strong>Compliance:</strong> compliance@neuratalk.in</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
