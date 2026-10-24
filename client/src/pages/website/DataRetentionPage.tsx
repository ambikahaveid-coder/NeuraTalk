import { Link } from "wouter";
import { COMPANY, LEGAL_UPDATED, CALL_TEXT_RETENTION_DAYS } from "./site-facts";

/** Retention periods as the product enforces them today. */
const ROWS: [string, string, string][] = [
  ["Call audio", "Not stored", "Calls are translated live; audio is never saved."],
  ["Call history and translated call text", `${CALL_TEXT_RETENTION_DAYS} days after the call`, "Deleted automatically every day by a scheduled job."],
  ["Personal and group chats, files", "Until you delete them or your account", "Clearing a chat removes it from your view; the other person keeps their copy."],
  ["Chats with businesses", "Until the business or you delete them, or your account is deleted", "A business keeps its own record of conversations with its customers."],
  ["Voice samples and cloned voice", "Until you delete your voice or your account", "Deleted at our voice provider as well."],
  ["Login codes from businesses", "Readable code erased on use, expiry or replacement", "Only an encrypted copy exists while the code is valid."],
  ["Account profile", "Until you delete your account", "Then your number, name, photo and email are erased."],
  ["Billing and invoices", "As long as tax and company law require", "Typically several years after the transaction."],
  ["Security and audit logs", "As long as needed to protect accounts and investigate abuse", "Access is limited to authorised staff."],
];

export default function DataRetentionPage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-6">Data Retention</h1>
          <p className="text-muted-foreground">Last updated: {LEGAL_UPDATED}</p>
          <p className="text-sm text-muted-foreground mt-2">How long NeuraTalk keeps each kind of data, and why</p>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-4xl mx-auto prose prose-neutral dark:prose-invert">
          <p>
            We keep personal data only as long as it is needed to provide NeuraTalk, or as long as the law requires, as the Digital Personal
            Data Protection Act, 2023 asks of us.
          </p>
          <table className="w-full border-collapse text-sm">
            <thead><tr><th className="border p-2 text-left">Data</th><th className="border p-2 text-left">Kept for</th><th className="border p-2 text-left">Notes</th></tr></thead>
            <tbody>
              {ROWS.map(([d, k, n]) => (
                <tr key={d}><td className="border p-2">{d}</td><td className="border p-2">{k}</td><td className="border p-2">{n}</td></tr>
              ))}
            </tbody>
          </table>

          <h2>Deleting sooner</h2>
          <p>
            You can delete chats, your voice, or your whole account at any time — see <Link href="/account-deletion">Delete your account</Link>.
            For anything else, write to {COMPANY.email}.
          </p>
          <p>See also our <Link href="/privacy">Privacy Policy</Link>.</p>
        </div>
      </section>
    </div>
  );
}
