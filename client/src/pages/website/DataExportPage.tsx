export default function DataExportPage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-6">Data Export Policy</h1>
          <p className="text-muted-foreground">Last updated: June 2026</p>
          <p className="text-sm text-muted-foreground mt-2">
            Your right to data portability under DPDP Act 2023 (Section 11) and GDPR Article 20
          </p>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto prose prose-neutral dark:prose-invert">
          <h2>1. Your Right to Data Portability</h2>
          <p>
            You have the right to receive a copy of your personal data in a structured, commonly used,
            and machine-readable format. NeuraTalk supports data export for all users as part of our
            commitment to data portability under the DPDP Act 2023 and GDPR.
          </p>

          <h2>2. What You Can Export</h2>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="border p-2 text-left">Data Category</th>
                <th className="border p-2 text-left">Format</th>
                <th className="border p-2 text-left">Availability</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border p-2">Profile information</td>
                <td className="border p-2">JSON</td>
                <td className="border p-2">Immediate</td>
              </tr>
              <tr>
                <td className="border p-2">Call history &amp; metadata</td>
                <td className="border p-2">JSON, CSV</td>
                <td className="border p-2">Immediate</td>
              </tr>
              <tr>
                <td className="border p-2">Call recordings</td>
                <td className="border p-2">MP3 / WAV</td>
                <td className="border p-2">Up to 90-day retention window</td>
              </tr>
              <tr>
                <td className="border p-2">Transcripts</td>
                <td className="border p-2">TXT, JSON</td>
                <td className="border p-2">Up to 90-day retention window</td>
              </tr>
              <tr>
                <td className="border p-2">Contacts</td>
                <td className="border p-2">CSV, vCard</td>
                <td className="border p-2">Immediate</td>
              </tr>
              <tr>
                <td className="border p-2">Billing history &amp; invoices</td>
                <td className="border p-2">PDF, JSON</td>
                <td className="border p-2">Immediate</td>
              </tr>
              <tr>
                <td className="border p-2">AI persona configurations</td>
                <td className="border p-2">JSON</td>
                <td className="border p-2">Immediate</td>
              </tr>
              <tr>
                <td className="border p-2">API usage logs</td>
                <td className="border p-2">JSON, CSV</td>
                <td className="border p-2">Last 90 days</td>
              </tr>
              <tr>
                <td className="border p-2">Consent records</td>
                <td className="border p-2">JSON</td>
                <td className="border p-2">Immediate</td>
              </tr>
            </tbody>
          </table>

          <div className="bg-primary/10 p-4 rounded-lg my-4">
            <p className="font-semibold">Note on Voice Models:</p>
            <p>Cloned voice models are proprietary model files and are not available for export in a portable format due to model format complexity. You may delete them at any time from Settings → Voice Identity.</p>
          </div>

          <h2>3. How to Export Your Data</h2>
          <h3>3.1 Self-Service Export</h3>
          <ol>
            <li>Log in to your NeuraTalk account.</li>
            <li>Go to <strong>Settings → Privacy → Export My Data</strong>.</li>
            <li>Select the data categories you want to include.</li>
            <li>Choose your preferred format (where options exist).</li>
            <li>Click <strong>Generate Export</strong>.</li>
            <li>You will receive a download link via email within 24 hours (large exports may take up to 72 hours).</li>
            <li>The download link is valid for <strong>7 days</strong> and encrypted.</li>
          </ol>

          <h3>3.2 Requesting via Email</h3>
          <p>
            Email privacy@neuratalk.in with subject "Data Export Request". Include your registered
            email and phone number for identity verification. We will process and respond within
            <strong> 30 days</strong> as required by law.
          </p>

          <h2>4. Enterprise &amp; Organisation Data Export</h2>
          <p>Company admins can export organisation-wide data including:</p>
          <ul>
            <li>All agent accounts and their activity logs</li>
            <li>Organisation call history and analytics</li>
            <li>Billing records for the entire organisation</li>
            <li>Enterprise number configurations (non-sensitive metadata)</li>
            <li>SIP trunk configurations (API credentials excluded)</li>
          </ul>
          <p>
            Go to <strong>Admin Panel → Compliance → Data Export</strong> or contact enterprise@neuratalk.in
            for large-scale exports.
          </p>

          <h2>5. API Export</h2>
          <p>
            Enterprise plans have access to a Data Export API that enables programmatic export for
            compliance and system integration purposes. Refer to the <a href="/api-docs">API Documentation</a>
            for the <code>GET /api/v1/export</code> endpoint specifications.
          </p>

          <h2>6. Security of Exports</h2>
          <ul>
            <li>All export archives are encrypted with a one-time key.</li>
            <li>Download links are single-use and time-limited (7 days).</li>
            <li>Export requests are logged in the audit trail.</li>
            <li>Large exports are verified against your account identity before delivery.</li>
          </ul>

          <h2>7. Scope Limitations</h2>
          <p>Data export does not include:</p>
          <ul>
            <li>Internal system logs not related to your personal data</li>
            <li>Data that would reveal proprietary algorithms or security systems</li>
            <li>Data of other users (including other call participants who are separate data subjects)</li>
            <li>Data that is subject to a legal hold or ongoing investigation</li>
          </ul>

          <h2>8. Contact</h2>
          <div className="bg-muted p-4 rounded-lg">
            <p><strong>Data Export Requests:</strong> privacy@neuratalk.in</p>
            <p><strong>Enterprise Exports:</strong> enterprise@neuratalk.in</p>
            <p><strong>DPO:</strong> dpo@neuratalk.in</p>
            <p><strong>Response Time:</strong> Within 30 days of verified request</p>
          </div>
        </div>
      </section>
    </div>
  );
}
