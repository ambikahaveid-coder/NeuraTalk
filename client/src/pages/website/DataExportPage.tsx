import { Link } from "wouter";
import { COMPANY, LEGAL_UPDATED } from "./site-facts";

/** Mirrors GET /api/gdpr/export (server/gdpr-routes.ts). */
export default function DataExportPage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-6">Download your data</h1>
          <p className="text-muted-foreground">Last updated: {LEGAL_UPDATED}</p>
          <p className="text-sm text-muted-foreground mt-2">Your right to access your personal data under the Digital Personal Data Protection Act, 2023</p>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto prose prose-neutral dark:prose-invert">
          <h2>How to download it</h2>
          <ol>
            <li>Open NeuraTalk and go to <strong>More → Privacy</strong>.</li>
            <li>Tap <strong>Download my data</strong>.</li>
            <li>Save or share the file it creates (JSON, readable by any text editor).</li>
          </ol>

          <h2>What the file contains</h2>
          <ul>
            <li>Your profile: number, name, language and account settings.</li>
            <li>The chat messages you sent (the most recent 5,000).</li>
            <li>Your voice settings (not the voice itself).</li>
            <li>Your plans, invoices and registered devices.</li>
          </ul>
          <p>
            Call history and translated call text are visible in the app (More → Account → Call History &amp; Transcripts) for 30 days after
            each call. Photos and files you sent remain available in your chats.
          </p>

          <h2>Need something that isn't in the file?</h2>
          <p>
            Email {COMPANY.email} with the subject "Data request" and your registered mobile number. We reply within 15 days. See our
            <Link href="/privacy"> Privacy Policy</Link> for all your rights.
          </p>
        </div>
      </section>
    </div>
  );
}
