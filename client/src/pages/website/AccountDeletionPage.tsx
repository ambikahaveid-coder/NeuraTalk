import { Link } from "wouter";
import { COMPANY, LEGAL_UPDATED } from "./site-facts";

/** Mirrors server/account-deletion.ts — what deleting an account really does. */
export default function AccountDeletionPage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-6">Delete your account</h1>
          <p className="text-muted-foreground">Last updated: {LEGAL_UPDATED}</p>
          <p className="text-sm text-muted-foreground mt-2">Your right to erasure under the Digital Personal Data Protection Act, 2023</p>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto prose prose-neutral dark:prose-invert">
          <h2>Delete it from the app</h2>
          <ol>
            <li>Open NeuraTalk and go to <strong>More → Privacy</strong>.</li>
            <li>Tap <strong>Download my data</strong> first if you want a copy.</li>
            <li>Tap <strong>Delete my account</strong>, type <strong>DELETE</strong> and confirm.</li>
          </ol>
          <p>It takes effect immediately and cannot be undone.</p>

          <h2>Can't use the app?</h2>
          <p>
            Email {COMPANY.email} from any address with the subject "Delete my account" and your registered mobile number. We will check that the
            request really comes from the account's owner, then delete the account and reply within 15 days.
          </p>

          <h2>What happens when you delete</h2>
          <table className="w-full border-collapse text-sm">
            <thead><tr><th className="border p-2 text-left">Data</th><th className="border p-2 text-left">What happens</th></tr></thead>
            <tbody>
              <tr><td className="border p-2">Your number, email, name and profile photo</td><td className="border p-2">Removed immediately. Others see "Deleted account".</td></tr>
              <tr><td className="border p-2">Your voice samples and cloned voice</td><td className="border p-2">Deleted, including at our voice provider.</td></tr>
              <tr><td className="border p-2">Sign-ins and devices</td><td className="border p-2">Signed out everywhere; notifications stop.</td></tr>
              <tr><td className="border p-2">Businesses you talked to</td><td className="border p-2">They can no longer reach you on NeuraTalk.</td></tr>
              <tr><td className="border p-2">Messages you already sent</td><td className="border p-2">Stay with the people who received them, as in any messaging app.</td></tr>
              <tr><td className="border p-2">Call history and translated call text</td><td className="border p-2">Deleted automatically within 30 days of each call.</td></tr>
              <tr><td className="border p-2">Remaining minutes and wallet balance</td><td className="border p-2">Lost. Ask for any refund you are due before deleting — see the <Link href="/refund-policy">Refund Policy</Link>.</td></tr>
              <tr><td className="border p-2">Invoices and payment records</td><td className="border p-2">Kept as long as tax law requires, then deleted.</td></tr>
            </tbody>
          </table>

          <h2>Business owners</h2>
          <p>
            If you own a NeuraTalk Business account, make another team member an admin before deleting your account. If you are the only
            person in the business, the business is closed together with your account.
          </p>

          <h2>Questions</h2>
          <p>Write to our Grievance Officer at {COMPANY.email}. See also our <Link href="/privacy">Privacy Policy</Link>.</p>
        </div>
      </section>
    </div>
  );
}
