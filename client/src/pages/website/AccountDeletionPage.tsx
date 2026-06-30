export default function AccountDeletionPage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-6">Account Deletion Policy</h1>
          <p className="text-muted-foreground">Last updated: June 2026</p>
          <p className="text-sm text-muted-foreground mt-2">
            Your right to erasure under DPDP Act 2023 (Section 12) and GDPR Article 17
          </p>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto prose prose-neutral dark:prose-invert">
          <h2>1. Your Right to Delete</h2>
          <p>
            You have the right to delete your NeuraTalk account and associated personal data at any time.
            This right is protected under the Digital Personal Data Protection Act 2023 (India) and
            the General Data Protection Regulation (EU). We make this process straightforward and permanent.
          </p>

          <h2>2. Before You Delete</h2>
          <div className="bg-amber-500/10 border border-amber-500/30 p-4 rounded-lg my-4">
            <p className="font-semibold text-amber-600 dark:text-amber-400">We recommend doing the following before deleting:</p>
            <ul className="mb-0">
              <li>Export your call history and data (Settings → Data Export)</li>
              <li>Download any call recordings you want to keep</li>
              <li>Export your contact list and AI persona configurations</li>
              <li>Cancel any active subscriptions to stop future billing</li>
              <li>Download invoices and transaction receipts from Billing</li>
            </ul>
          </div>

          <h2>3. How to Delete Your Account</h2>

          <h3>3.1 Self-Service Deletion</h3>
          <ol>
            <li>Log in to your NeuraTalk account.</li>
            <li>Navigate to <strong>Settings → Privacy → Delete Account</strong>.</li>
            <li>Read the confirmation screen carefully, which lists what will be deleted.</li>
            <li>Enter your password to confirm your identity.</li>
            <li>Click <strong>Permanently Delete My Account</strong>.</li>
            <li>You will receive a confirmation email. Your account enters a 30-day grace period.</li>
          </ol>

          <h3>3.2 Request via Email</h3>
          <p>
            If you cannot access your account, email privacy@neuratalk.in from your registered email
            address with the subject line "Account Deletion Request". Include your full name and
            registered phone number for identity verification.
          </p>

          <h2>4. Grace Period</h2>
          <p>
            After initiating deletion, your account enters a <strong>30-day grace period</strong>:
          </p>
          <ul>
            <li>Your account is immediately suspended and inaccessible.</li>
            <li>No new charges are applied.</li>
            <li>You can cancel the deletion by logging in within 30 days.</li>
            <li>After 30 days, deletion is permanent and cannot be reversed.</li>
          </ul>

          <h2>5. What Gets Deleted</h2>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="border p-2 text-left">Data</th>
                <th className="border p-2 text-left">When Deleted</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border p-2">Profile (name, email, phone)</td>
                <td className="border p-2">Within 30 days of confirmation</td>
              </tr>
              <tr>
                <td className="border p-2">Call history &amp; logs</td>
                <td className="border p-2">Within 30 days of confirmation</td>
              </tr>
              <tr>
                <td className="border p-2">Recordings &amp; transcripts</td>
                <td className="border p-2">Within 30 days of confirmation</td>
              </tr>
              <tr>
                <td className="border p-2">Voice samples &amp; cloned voice models</td>
                <td className="border p-2">Immediately upon deletion initiation</td>
              </tr>
              <tr>
                <td className="border p-2">AI personas &amp; configurations</td>
                <td className="border p-2">Within 30 days of confirmation</td>
              </tr>
              <tr>
                <td className="border p-2">Contacts &amp; preferences</td>
                <td className="border p-2">Within 30 days of confirmation</td>
              </tr>
              <tr>
                <td className="border p-2">API keys &amp; integrations</td>
                <td className="border p-2">Immediately upon deletion initiation</td>
              </tr>
              <tr>
                <td className="border p-2">Enterprise number registrations</td>
                <td className="border p-2">Within 30 days; carrier deactivation may take longer</td>
              </tr>
            </tbody>
          </table>

          <h2>6. What Is Retained After Deletion</h2>
          <p>
            Certain data must be retained for legal compliance reasons even after account deletion:
          </p>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="border p-2 text-left">Data</th>
                <th className="border p-2 text-left">Retention Period</th>
                <th className="border p-2 text-left">Legal Basis</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border p-2">Transaction records &amp; invoices</td>
                <td className="border p-2">7 years</td>
                <td className="border p-2">GST Act / Income Tax Act</td>
              </tr>
              <tr>
                <td className="border p-2">Consent records</td>
                <td className="border p-2">3 years post-deletion</td>
                <td className="border p-2">DPDP / GDPR accountability</td>
              </tr>
              <tr>
                <td className="border p-2">Fraud &amp; abuse investigation records</td>
                <td className="border p-2">As required by law enforcement</td>
                <td className="border p-2">IT Act / CrPC</td>
              </tr>
              <tr>
                <td className="border p-2">Anonymised aggregated analytics</td>
                <td className="border p-2">Indefinitely (no personal identifiers)</td>
                <td className="border p-2">Product improvement (anonymised)</td>
              </tr>
            </tbody>
          </table>

          <h2>7. Company / Enterprise Account Deletion</h2>
          <p>
            Deleting a Company Admin account does not automatically delete the organisation or its
            sub-accounts. To fully delete an organisation:
          </p>
          <ul>
            <li>All active subscriptions must be cancelled first.</li>
            <li>All agent accounts must be deactivated or transferred.</li>
            <li>Contact enterprise@neuratalk.in to initiate organisation-level deletion.</li>
          </ul>

          <h2>8. Contact</h2>
          <div className="bg-muted p-4 rounded-lg">
            <p><strong>Deletion Requests:</strong> privacy@neuratalk.in</p>
            <p><strong>Enterprise Deletions:</strong> enterprise@neuratalk.in</p>
            <p><strong>Response Time:</strong> Confirmation within 3 business days, deletion within 30 days</p>
          </div>
        </div>
      </section>
    </div>
  );
}
