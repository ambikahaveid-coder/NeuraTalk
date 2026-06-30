export default function DataRetentionPage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-6">Data Retention Policy</h1>
          <p className="text-muted-foreground">Last updated: June 2026</p>
          <p className="text-sm text-muted-foreground mt-2">
            Compliant with DPDP Act 2023, GDPR Article 5(1)(e), and IT Act 2000
          </p>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto prose prose-neutral dark:prose-invert">
          <h2>1. Purpose</h2>
          <p>
            This Data Retention Policy defines how long NeuraTalk (Mindwhile IT Solutions Pvt Ltd) retains
            different categories of personal and operational data, the basis for retention, and how data is
            securely deleted when retention periods expire. Retention periods are set to the minimum
            necessary for the stated purpose (data minimisation principle).
          </p>

          <h2>2. Retention Schedule</h2>

          <h3>2.1 Account &amp; Identity Data</h3>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="border p-2 text-left">Data Category</th>
                <th className="border p-2 text-left">Retention Period</th>
                <th className="border p-2 text-left">Legal Basis</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border p-2">Name, email, phone number</td>
                <td className="border p-2">Duration of account + 90 days</td>
                <td className="border p-2">Contract performance</td>
              </tr>
              <tr>
                <td className="border p-2">Authentication logs (OTP, login)</td>
                <td className="border p-2">90 days</td>
                <td className="border p-2">Security / fraud prevention</td>
              </tr>
              <tr>
                <td className="border p-2">Role &amp; permission records</td>
                <td className="border p-2">Duration of account + 90 days</td>
                <td className="border p-2">Contract performance</td>
              </tr>
              <tr>
                <td className="border p-2">KYB/KYC documents (enterprise)</td>
                <td className="border p-2">5 years after contract end</td>
                <td className="border p-2">PMLA / regulatory obligation</td>
              </tr>
            </tbody>
          </table>

          <h3>2.2 Communication Data</h3>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="border p-2 text-left">Data Category</th>
                <th className="border p-2 text-left">Retention Period</th>
                <th className="border p-2 text-left">Legal Basis</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border p-2">Call metadata (duration, participants, timestamps)</td>
                <td className="border p-2">1 year</td>
                <td className="border p-2">Contract / legitimate interest</td>
              </tr>
              <tr>
                <td className="border p-2">Real-time translations (in-memory processing)</td>
                <td className="border p-2">Not stored — discarded after call</td>
                <td className="border p-2">Data minimisation</td>
              </tr>
              <tr>
                <td className="border p-2">Call recordings (when enabled)</td>
                <td className="border p-2">90 days or until manually deleted</td>
                <td className="border p-2">Explicit consent</td>
              </tr>
              <tr>
                <td className="border p-2">Transcripts (when enabled)</td>
                <td className="border p-2">90 days or until manually deleted</td>
                <td className="border p-2">Explicit consent</td>
              </tr>
              <tr>
                <td className="border p-2">Meeting recordings</td>
                <td className="border p-2">90 days or until manually deleted</td>
                <td className="border p-2">Explicit consent</td>
              </tr>
              <tr>
                <td className="border p-2">Chat messages</td>
                <td className="border p-2">90 days after last interaction</td>
                <td className="border p-2">Service provision</td>
              </tr>
            </tbody>
          </table>

          <h3>2.3 Voice &amp; AI Data</h3>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="border p-2 text-left">Data Category</th>
                <th className="border p-2 text-left">Retention Period</th>
                <th className="border p-2 text-left">Legal Basis</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border p-2">Voice samples (for model training)</td>
                <td className="border p-2">Until withdrawal of consent or account deletion</td>
                <td className="border p-2">Explicit consent</td>
              </tr>
              <tr>
                <td className="border p-2">Cloned voice models</td>
                <td className="border p-2">Until deletion request or account closure</td>
                <td className="border p-2">Explicit consent</td>
              </tr>
              <tr>
                <td className="border p-2">AI persona configurations</td>
                <td className="border p-2">Duration of account + 30 days</td>
                <td className="border p-2">Service provision</td>
              </tr>
              <tr>
                <td className="border p-2">Sentiment analysis results</td>
                <td className="border p-2">Not stored — in-memory processing only</td>
                <td className="border p-2">Data minimisation</td>
              </tr>
            </tbody>
          </table>

          <h3>2.4 Billing &amp; Financial Data</h3>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="border p-2 text-left">Data Category</th>
                <th className="border p-2 text-left">Retention Period</th>
                <th className="border p-2 text-left">Legal Basis</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border p-2">Transaction records &amp; invoices</td>
                <td className="border p-2">7 years</td>
                <td className="border p-2">Income Tax Act / GST Act</td>
              </tr>
              <tr>
                <td className="border p-2">Payment method tokens (masked)</td>
                <td className="border p-2">Until card expiry or removal by user</td>
                <td className="border p-2">Contract / PCI-DSS</td>
              </tr>
              <tr>
                <td className="border p-2">Credit usage logs</td>
                <td className="border p-2">3 years</td>
                <td className="border p-2">Dispute resolution</td>
              </tr>
              <tr>
                <td className="border p-2">Subscription history</td>
                <td className="border p-2">7 years</td>
                <td className="border p-2">Legal/tax compliance</td>
              </tr>
            </tbody>
          </table>

          <h3>2.5 Security &amp; Audit Logs</h3>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="border p-2 text-left">Data Category</th>
                <th className="border p-2 text-left">Retention Period</th>
                <th className="border p-2 text-left">Legal Basis</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border p-2">Security event logs (failed logins, alerts)</td>
                <td className="border p-2">1 year</td>
                <td className="border p-2">Security / fraud prevention</td>
              </tr>
              <tr>
                <td className="border p-2">Admin action audit trail</td>
                <td className="border p-2">3 years</td>
                <td className="border p-2">Compliance / accountability</td>
              </tr>
              <tr>
                <td className="border p-2">API access logs</td>
                <td className="border p-2">90 days</td>
                <td className="border p-2">Security / debugging</td>
              </tr>
              <tr>
                <td className="border p-2">Consent records</td>
                <td className="border p-2">Duration of account + 3 years</td>
                <td className="border p-2">DPDP / GDPR accountability</td>
              </tr>
            </tbody>
          </table>

          <h2>3. Deletion Process</h2>
          <p>When a retention period expires, data is deleted through:</p>
          <ul>
            <li><strong>Database Records:</strong> Permanently deleted via secure wipe (overwrite + confirmation)</li>
            <li><strong>File Storage:</strong> Cryptographic erasure (encryption key destruction) + physical deletion</li>
            <li><strong>Backups:</strong> Purged from backup rotation within the backup TTL cycle (maximum 30 days beyond primary deletion)</li>
            <li><strong>Logs:</strong> Rotated and overwritten per retention schedule</li>
          </ul>

          <h2>4. Data Subject Requests</h2>
          <p>
            You may request early deletion of your personal data at any time, subject to legal retention
            obligations. To exercise this right:
          </p>
          <ul>
            <li>Use <strong>Settings → Privacy → Delete My Data</strong> in the dashboard.</li>
            <li>Email privacy@neuratalk.in with "Erasure Request" in the subject line.</li>
          </ul>
          <p>
            We will confirm deletion within 30 days. Note that data subject to legal hold (e.g., tax
            records) cannot be erased until the statutory retention period expires.
          </p>

          <h2>5. Third-Party Processors</h2>
          <p>
            Sub-processors we use (AI providers, payment gateways) are contractually required to maintain
            retention periods no longer than necessary for service delivery. Their data processing agreements
            are available in our <a href="/dpa">Data Processing Agreement</a>.
          </p>

          <h2>6. Policy Review</h2>
          <p>
            This policy is reviewed annually or whenever relevant legislation changes. Changes are
            communicated to users via email and in-app notification.
          </p>

          <h2>7. Contact</h2>
          <div className="bg-muted p-4 rounded-lg">
            <p><strong>Data Protection Officer:</strong> dpo@neuratalk.in</p>
            <p><strong>Privacy Inquiries:</strong> privacy@neuratalk.in</p>
            <p><strong>Address:</strong> Mindwhile IT Solutions Pvt Ltd, 4th Floor, Mayuri Tech Park, Mangalagiri, Guntur, AP 522503</p>
          </div>
        </div>
      </section>
    </div>
  );
}
