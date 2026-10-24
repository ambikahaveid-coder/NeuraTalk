import { Link } from "wouter";
import { COMPANY, LEGAL_UPDATED } from "./site-facts";

export default function CancellationPolicyPage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-6">Cancellation Policy</h1>
          <p className="text-muted-foreground">Last updated: {LEGAL_UPDATED}</p>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto prose prose-neutral dark:prose-invert">
          <h2>1. Nothing to cancel by default</h2>
          <p>
            NeuraTalk plans and top-ups are prepaid and do not renew automatically, so there is no subscription to cancel. When a plan ends or
            your balance runs out, you simply stop being charged; you can keep chatting, and buy more minutes whenever you like.
          </p>

          <h2>2. Stopping early</h2>
          <ul>
            <li>You can stop using NeuraTalk at any time. Unused minutes stay on your account until the plan's end date.</li>
            <li>If you stop within 7 days of buying and have used less than 10%, you can get your money back — see the <Link href="/refund-policy">Refund Policy</Link>.</li>
            <li>To close your account completely, see <Link href="/account-deletion">Delete your account</Link>. Unused minutes are lost when the account is deleted.</li>
          </ul>

          <h2>3. Businesses</h2>
          <ul>
            <li>Business wallets are prepaid. A business can stop sending at any time; scheduled campaigns can be cancelled from the dashboard before they run.</li>
            <li>To close a business account, the owner writes to {COMPANY.email}. Any refund of unused wallet balance follows the Refund Policy or the business's agreement with us.</li>
          </ul>

          <h2>4. When we cancel</h2>
          <p>
            We may suspend or close an account that breaks our <Link href="/terms">Terms of Service</Link> or
            <Link href="/business-messaging-policy"> Business Messaging Policy</Link>. If we close an account without a breach by you, we refund
            the unused prepaid balance.
          </p>

          <h2>5. Contact</h2>
          <p>{COMPANY.email} · {COMPANY.phone}</p>
        </div>
      </section>
    </div>
  );
}
