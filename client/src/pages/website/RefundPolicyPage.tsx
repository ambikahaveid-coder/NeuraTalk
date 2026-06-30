export default function RefundPolicyPage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-6">Refund Policy</h1>
          <p className="text-muted-foreground">Last updated: June 2026</p>
          <p className="text-sm text-muted-foreground mt-2">
            Compliant with Consumer Protection Act 2019 (India) and RBI Payment Guidelines
          </p>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto prose prose-neutral dark:prose-invert">
          <h2>1. Overview</h2>
          <p>
            NeuraTalk, operated by Mindwhile IT Solutions Pvt Ltd, offers a fair and transparent refund
            process. This policy applies to all credit purchases, subscription plans, and add-on purchases
            made on our platform.
          </p>

          <h2>2. Credit Purchases</h2>
          <h3>2.1 Eligibility for Refund</h3>
          <p>Prepaid credits (NeuraTalk Credits) are eligible for a full refund if:</p>
          <ul>
            <li>The refund request is raised within <strong>7 days</strong> of purchase.</li>
            <li>Less than 10% of the purchased credits have been consumed.</li>
            <li>The purchase was not part of a promotional or discounted package.</li>
          </ul>

          <h3>2.2 Partial Refunds</h3>
          <p>Partial refunds may be granted for the unused portion of credits if:</p>
          <ul>
            <li>The refund request is raised within <strong>30 days</strong> of purchase.</li>
            <li>A verified technical fault on our platform caused credit loss.</li>
          </ul>

          <h3>2.3 Non-Refundable Credits</h3>
          <ul>
            <li>Credits consumed through successful calls, translations, or API usage.</li>
            <li>Bonus credits awarded as part of promotional offers.</li>
            <li>Credits purchased more than 30 days ago.</li>
          </ul>

          <h2>3. Subscription Plans</h2>
          <h3>3.1 Monthly Subscriptions</h3>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="border p-2 text-left">Scenario</th>
                <th className="border p-2 text-left">Refund</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border p-2">Cancellation within 24 hours of new subscription</td>
                <td className="border p-2">100% refund</td>
              </tr>
              <tr>
                <td className="border p-2">Cancellation within 7 days, minimal usage</td>
                <td className="border p-2">Pro-rated refund for remaining days</td>
              </tr>
              <tr>
                <td className="border p-2">Cancellation after 7 days</td>
                <td className="border p-2">No refund; service continues until period end</td>
              </tr>
              <tr>
                <td className="border p-2">Service outage exceeding 4 hours in a month</td>
                <td className="border p-2">Pro-rated credit for downtime period</td>
              </tr>
            </tbody>
          </table>

          <h3>3.2 Annual Subscriptions</h3>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="border p-2 text-left">Scenario</th>
                <th className="border p-2 text-left">Refund</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border p-2">Cancellation within 14 days of purchase</td>
                <td className="border p-2">100% refund</td>
              </tr>
              <tr>
                <td className="border p-2">Cancellation after 14 days, before 3 months</td>
                <td className="border p-2">Pro-rated refund for unused months</td>
              </tr>
              <tr>
                <td className="border p-2">Cancellation after 3 months</td>
                <td className="border p-2">No refund; service continues until year end</td>
              </tr>
            </tbody>
          </table>

          <h2>4. Enterprise Plans</h2>
          <p>
            Enterprise plan refunds are governed by the specific terms in your Enterprise Agreement (MSA).
            In the absence of custom terms, the standard annual subscription refund policy applies.
            Contact your account manager or enterprise@neuratalk.in for assistance.
          </p>

          <h2>5. Technical Issues &amp; Service Credits</h2>
          <p>
            If you experience a verified technical issue caused by our platform (e.g., failed calls due to
            our infrastructure, incorrect billing), we will:
          </p>
          <ul>
            <li>Issue service credits to your account within 5 business days of verified incident.</li>
            <li>Process a refund to the original payment method if credits are not acceptable.</li>
          </ul>

          <div className="bg-primary/10 p-4 rounded-lg my-4">
            <p className="font-semibold">How to Report a Technical Issue:</p>
            <p>Email support@neuratalk.in with your account email, transaction ID, and a description of the issue. We investigate all reports within 48 hours.</p>
          </div>

          <h2>6. How to Request a Refund</h2>
          <ol>
            <li>Log in to your NeuraTalk account.</li>
            <li>Navigate to <strong>Billing → Transaction History</strong>.</li>
            <li>Click the transaction you wish to dispute and select <strong>Request Refund</strong>.</li>
            <li>Provide the reason and any supporting details.</li>
            <li>Our team will respond within <strong>3 business days</strong>.</li>
          </ol>
          <p>Alternatively, email billing@neuratalk.in with your transaction ID and reason.</p>

          <h2>7. Refund Processing Time</h2>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="border p-2 text-left">Payment Method</th>
                <th className="border p-2 text-left">Refund Timeline</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border p-2">UPI / Net Banking</td>
                <td className="border p-2">3–5 business days</td>
              </tr>
              <tr>
                <td className="border p-2">Credit / Debit Card</td>
                <td className="border p-2">5–10 business days</td>
              </tr>
              <tr>
                <td className="border p-2">NeuraTalk Credits</td>
                <td className="border p-2">Immediate (credited to account)</td>
              </tr>
            </tbody>
          </table>

          <h2>8. Dispute Resolution</h2>
          <p>
            If your refund request is denied and you disagree with the decision, you may escalate to:
          </p>
          <ul>
            <li><strong>Grievance Officer:</strong> grievance@neuratalk.in (response within 15 days)</li>
            <li><strong>Consumer Forum:</strong> Under the Consumer Protection Act 2019 (India)</li>
            <li><strong>Payment Dispute:</strong> Contact your bank or card issuer for chargeback under applicable rules</li>
          </ul>

          <h2>9. Contact</h2>
          <div className="bg-muted p-4 rounded-lg">
            <p><strong>Billing Support:</strong> billing@neuratalk.in</p>
            <p><strong>General Support:</strong> support@neuratalk.in</p>
            <p><strong>Phone:</strong> +91 80 4567 8900 (Mon–Fri, 9am–6pm IST)</p>
          </div>
        </div>
      </section>
    </div>
  );
}
