import { Link } from "wouter";
import { COMPANY, LEGAL_UPDATED } from "./site-facts";

export default function RefundPolicyPage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-6">Refund Policy</h1>
          <p className="text-muted-foreground">Last updated: {LEGAL_UPDATED}</p>
          <p className="text-sm text-muted-foreground mt-2">In line with the Consumer Protection Act, 2019</p>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto prose prose-neutral dark:prose-invert">
          <h2>1. How paying works</h2>
          <p>
            NeuraTalk plans and wallet top-ups are prepaid in Indian Rupees. Translated call time, and for businesses their updates, login codes
            and campaign messages, are deducted as they are used. Nothing renews or is charged again without you choosing to pay.
          </p>

          <h2>2. You are never charged for these</h2>
          <ul>
            <li>Calls where translation never started because of a problem on our side.</li>
            <li>Business messages that were not sent — no consent, blocked, over a limit, or the person isn't on NeuraTalk.</li>
          </ul>

          <h2>3. When you get money back</h2>
          <table className="w-full border-collapse text-sm">
            <thead><tr><th className="border p-2 text-left">Situation</th><th className="border p-2 text-left">What you get</th></tr></thead>
            <tbody>
              <tr><td className="border p-2">You ask within 7 days of buying a plan or top-up and have used less than 10% of it</td><td className="border p-2">Full refund</td></tr>
              <tr><td className="border p-2">You were charged twice, or charged the wrong amount</td><td className="border p-2">Full refund of the extra amount</td></tr>
              <tr><td className="border p-2">A fault on our side used up your minutes or messages</td><td className="border p-2">The minutes or messages restored, or a refund if you prefer</td></tr>
              <tr><td className="border p-2">Minutes or wallet balance already used for calls or messages that worked</td><td className="border p-2">No refund</td></tr>
              <tr><td className="border p-2">Free minutes and promotional credit</td><td className="border p-2">No cash value</td></tr>
              <tr><td className="border p-2">Business agreements with their own terms</td><td className="border p-2">As set out in that agreement</td></tr>
            </tbody>
          </table>

          <h2>4. How to ask</h2>
          <p>
            Email {COMPANY.email} with the subject "Refund", your registered mobile number, the payment reference and what happened. We reply
            within 3 working days. Approved refunds go back to the original payment method, usually within 5–10 working days depending on your
            bank.
          </p>

          <h2>5. If you disagree</h2>
          <p>
            Write to our Grievance Officer at {COMPANY.email}; we acknowledge within 24 hours and aim to resolve within 15 days. You can also
            approach a consumer commission under the Consumer Protection Act, 2019, or your bank for a chargeback.
          </p>
          <p>See also our <Link href="/cancellation-policy">Cancellation Policy</Link> and <Link href="/terms">Terms of Service</Link>.</p>
        </div>
      </section>
    </div>
  );
}
