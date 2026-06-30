export default function CookiePolicyPage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-6">Cookie Policy</h1>
          <p className="text-muted-foreground">Last updated: June 2026</p>
          <p className="text-sm text-muted-foreground mt-2">
            Compliant with EU ePrivacy Directive, GDPR, and India DPDP Act 2023
          </p>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto prose prose-neutral dark:prose-invert">
          <h2>1. What Are Cookies?</h2>
          <p>
            Cookies are small text files placed on your device when you visit our website or use our
            application. They allow us to recognise your device, remember your preferences, and provide
            a secure, functional experience.
          </p>

          <h2>2. Cookies We Use</h2>

          <h3>2.1 Strictly Necessary Cookies</h3>
          <p>These cookies are essential for the platform to function and cannot be disabled.</p>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="border p-2 text-left">Cookie</th>
                <th className="border p-2 text-left">Purpose</th>
                <th className="border p-2 text-left">Duration</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border p-2"><code>neuratalk_session</code></td>
                <td className="border p-2">Maintains your authenticated session</td>
                <td className="border p-2">Session</td>
              </tr>
              <tr>
                <td className="border p-2"><code>csrf_token</code></td>
                <td className="border p-2">Prevents cross-site request forgery</td>
                <td className="border p-2">Session</td>
              </tr>
              <tr>
                <td className="border p-2"><code>cookie_consent</code></td>
                <td className="border p-2">Stores your cookie preferences</td>
                <td className="border p-2">1 year</td>
              </tr>
            </tbody>
          </table>

          <h3>2.2 Functional Cookies</h3>
          <p>These cookies enable enhanced functionality and personalisation. You may disable them, but some features may not work.</p>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="border p-2 text-left">Cookie</th>
                <th className="border p-2 text-left">Purpose</th>
                <th className="border p-2 text-left">Duration</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border p-2"><code>lang_pref</code></td>
                <td className="border p-2">Remembers your language selection</td>
                <td className="border p-2">1 year</td>
              </tr>
              <tr>
                <td className="border p-2"><code>theme_pref</code></td>
                <td className="border p-2">Stores dark/light mode preference</td>
                <td className="border p-2">1 year</td>
              </tr>
              <tr>
                <td className="border p-2"><code>pwa_install_prompt</code></td>
                <td className="border p-2">Tracks whether PWA install was dismissed</td>
                <td className="border p-2">30 days</td>
              </tr>
            </tbody>
          </table>

          <h3>2.3 Analytics Cookies (Consent Required)</h3>
          <p>
            These cookies help us understand how users interact with NeuraTalk so we can improve the product.
            They are only set after you provide explicit consent.
          </p>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="border p-2 text-left">Provider</th>
                <th className="border p-2 text-left">Purpose</th>
                <th className="border p-2 text-left">Duration</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border p-2">Internal analytics</td>
                <td className="border p-2">Page views, feature engagement (no PII)</td>
                <td className="border p-2">90 days</td>
              </tr>
            </tbody>
          </table>

          <h2>3. How to Manage Cookies</h2>
          <p>You can control cookies in several ways:</p>
          <ul>
            <li><strong>Cookie Settings Panel:</strong> Click "Cookie Settings" in the bottom banner to update your preferences at any time.</li>
            <li><strong>Browser Settings:</strong> Most browsers allow you to block or delete cookies through their privacy settings. Refer to your browser's help documentation.</li>
            <li><strong>Opt-out of Analytics:</strong> Contact us at privacy@neuratalk.in to opt out of analytics tracking.</li>
          </ul>

          <div className="bg-amber-500/10 border border-amber-500/30 p-4 rounded-lg my-4">
            <p className="font-semibold text-amber-600 dark:text-amber-400">Note:</p>
            <p>Blocking strictly necessary cookies will prevent login and core platform functionality from working.</p>
          </div>

          <h2>4. Third-Party Cookies</h2>
          <p>
            NeuraTalk does not load third-party advertising or tracking scripts. Any third-party services
            integrated (e.g., payment gateway, WebRTC infrastructure) set cookies only in the context of
            delivering their specific service and are subject to their own cookie policies.
          </p>

          <h2>5. Web Storage</h2>
          <p>
            In addition to cookies, we use browser <code>localStorage</code> and <code>sessionStorage</code> for:
          </p>
          <ul>
            <li>Caching your dashboard state to reduce loading times</li>
            <li>Storing temporary call session data during active calls</li>
            <li>PWA offline queue for pending actions</li>
          </ul>
          <p>This data is stored only on your device and is never transmitted to third parties.</p>

          <h2>6. Legal Basis</h2>
          <p>
            Strictly necessary cookies are set on the basis of our <strong>legitimate interest</strong> in
            providing a secure, functional service. All other cookies are set on the basis of your
            <strong> explicit consent</strong> (GDPR Art. 6(1)(a) / DPDP Act Section 4).
          </p>

          <h2>7. Updates to This Policy</h2>
          <p>
            We may update this Cookie Policy as our use of cookies changes or as regulations evolve.
            Changes will be posted here and your consent may be re-requested where required.
          </p>

          <h2>8. Contact</h2>
          <div className="bg-muted p-4 rounded-lg">
            <p><strong>Privacy Inquiries:</strong> privacy@neuratalk.in</p>
            <p><strong>DPO:</strong> dpo@neuratalk.in</p>
            <p><strong>Address:</strong> Mindwhile IT Solutions Pvt Ltd, 4th Floor, Mayuri Tech Park, Mangalagiri, Guntur, AP 522503</p>
          </div>
        </div>
      </section>
    </div>
  );
}
