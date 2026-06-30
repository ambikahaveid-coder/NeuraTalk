export default function CancellationPolicyPage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-6">Cancellation Policy</h1>
          <p className="text-muted-foreground">Last updated: June 2026</p>
          <p className="text-sm text-muted-foreground mt-2">
            Governed by Indian Contract Act 1872 and Consumer Protection Act 2019
          </p>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto prose prose-neutral dark:prose-invert">
          <h2>1. Overview</h2>
          <p>
            You may cancel your NeuraTalk subscription or individual services at any time. This policy
            explains when and how cancellations take effect, and what happens to your data and remaining
            credits upon cancellation.
          </p>

          <h2>2. Cancelling a Subscription</h2>
          <h3>2.1 How to Cancel</h3>
          <ol>
            <li>Log in to your account at neuratalk.in.</li>
            <li>Go to <strong>Settings → Billing → Manage Plan</strong>.</li>
            <li>Click <strong>Cancel Subscription</strong> and confirm.</li>
            <li>You will receive a cancellation confirmation email within 5 minutes.</li>
          </ol>
          <p>You may also request cancellation by emailing billing@neuratalk.in from your registered email address.</p>

          <h3>2.2 When Cancellation Takes Effect</h3>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="border p-2 text-left">Plan Type</th>
                <th className="border p-2 text-left">Cancellation Effect</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border p-2">Monthly subscription</td>
                <td className="border p-2">Access continues until end of current billing period; no further charges</td>
              </tr>
              <tr>
                <td className="border p-2">Annual subscription</td>
                <td className="border p-2">Access continues until end of annual period; see Refund Policy for early cancellation refunds</td>
              </tr>
              <tr>
                <td className="border p-2">Pay-as-you-go credits</td>
                <td className="border p-2">Unused credits remain valid for 12 months from last purchase date</td>
              </tr>
              <tr>
                <td className="border p-2">Enterprise plan</td>
                <td className="border p-2">Per the cancellation notice period in your Enterprise Agreement (typically 30–90 days)</td>
              </tr>
            </tbody>
          </table>

          <h2>3. What Happens After Cancellation</h2>

          <h3>3.1 Immediate Effects</h3>
          <ul>
            <li>No new charges will be applied.</li>
            <li>You retain full access to your plan features until the period end date.</li>
            <li>API keys remain active until period end.</li>
          </ul>

          <h3>3.2 After Access Ends</h3>
          <ul>
            <li>Your account is downgraded to a free tier (if available) or placed in a read-only state.</li>
            <li>Active calls and integrations are terminated.</li>
            <li>Enterprise number registrations and SIP trunk configurations are disabled.</li>
            <li>Scheduled calls and meetings are cancelled with participant notifications.</li>
          </ul>

          <h3>3.3 Data Retention After Cancellation</h3>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="border p-2 text-left">Data Type</th>
                <th className="border p-2 text-left">Retention After Cancellation</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border p-2">Account profile data</td>
                <td className="border p-2">Retained for 90 days, then deleted</td>
              </tr>
              <tr>
                <td className="border p-2">Call history &amp; logs</td>
                <td className="border p-2">Retained for 90 days; exportable within this window</td>
              </tr>
              <tr>
                <td className="border p-2">Billing &amp; transaction records</td>
                <td className="border p-2">7 years (legal/tax compliance)</td>
              </tr>
              <tr>
                <td className="border p-2">Voice models &amp; clones</td>
                <td className="border p-2">Deleted immediately upon account closure request</td>
              </tr>
              <tr>
                <td className="border p-2">Unused credits</td>
                <td className="border p-2">Forfeited 90 days after cancellation unless refund is requested</td>
              </tr>
            </tbody>
          </table>

          <div className="bg-primary/10 p-4 rounded-lg my-4">
            <p className="font-semibold">Export Your Data Before Cancelling:</p>
            <p>
              We recommend exporting your call history, contact lists, and API configurations before cancelling.
              Go to <strong>Settings → Data Export</strong> to download a complete copy of your data.
            </p>
          </div>

          <h2>4. Cancelling Specific Add-Ons or Features</h2>
          <p>
            Individual add-ons (e.g., AI Transcription Pack, Voice Cloning Bundle, Additional DID Numbers)
            can be cancelled independently without affecting your main subscription. Add-ons continue until
            the current billing period ends. Go to <strong>Settings → Billing → Add-Ons</strong> to manage them.
          </p>

          <h2>5. Admin-Initiated Cancellation</h2>
          <p>
            NeuraTalk reserves the right to suspend or cancel accounts for:
          </p>
          <ul>
            <li>Violation of our Terms of Service</li>
            <li>Fraudulent, abusive, or illegal usage</li>
            <li>Non-payment after a 7-day grace period</li>
            <li>Regulatory compliance requirements</li>
          </ul>
          <p>
            In such cases, we will provide at least 48 hours advance notice except where immediate
            termination is required for security or legal reasons.
          </p>

          <h2>6. Reactivation</h2>
          <p>
            You may reactivate your account within 90 days of cancellation. Your previous data and
            configurations will be restored. After 90 days, you will need to create a new account.
          </p>

          <h2>7. Contact</h2>
          <div className="bg-muted p-4 rounded-lg">
            <p><strong>Billing Support:</strong> billing@neuratalk.in</p>
            <p><strong>Enterprise Cancellations:</strong> enterprise@neuratalk.in</p>
            <p><strong>Grievance Officer:</strong> grievance@neuratalk.in</p>
          </div>
        </div>
      </section>
    </div>
  );
}
