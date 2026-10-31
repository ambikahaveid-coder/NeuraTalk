import { Link } from "wouter";
import { LegalPage } from "./LegalPage";
import { POLICIES_UPDATED } from "./site-facts";

/** What the verified tick means, how a business gets it, and when it is removed. */
export default function VerifiedBadgePolicyPage() {
  return (
    <LegalPage title="Verified Business Badge" updated={POLICIES_UPDATED} audience="For businesses on NeuraTalk Business">
      <h2>1. What the tick means</h2>
      <p>
        A blue tick next to a business name means the NeuraTalk team has checked documents showing that the business exists and that the account
        is run by it. It does <strong>not</strong> mean NeuraTalk recommends the business, its products or its prices, and it is not a
        guarantee of quality.
      </p>

      <h2>2. How to apply</h2>
      <p>In the NeuraTalk Business app: Tools → <strong>Get verified</strong>. You provide:</p>
      <ul>
        <li>the legal business name and the name customers know you by;</li>
        <li>the business PAN, and the GSTIN if the business is registered for GST;</li>
        <li>a document that proves the business exists (for example GST certificate, shop and establishment licence, certificate of
          incorporation or Udyam registration) and the PAN card — as PDF, JPG or PNG, up to 5 MB each, up to 6 files;</li>
        <li>a website or address where customers can find you, if you have one.</li>
      </ul>
      <p>
        The documents are stored privately. Only NeuraTalk's verification team can open them; they are never shown to customers or other
        businesses.
      </p>

      <h2>3. How we decide</h2>
      <ul>
        <li>The names and numbers on the documents must match each other and the application.</li>
        <li>The name shown with the tick is the name we checked. If you change your display name, the tick may be removed until we check again.</li>
        <li>We may ask for more documents or decline without detailed reasons when we can't confirm who runs the account. If we decline, we tell
          you in the app; you can fix the problem and apply again.</li>
      </ul>

      <h2>4. When the tick is removed</h2>
      <ul>
        <li>The business no longer exists, changes owner, or the documents turn out to be false.</li>
        <li>The account breaks the <Link href="/business-messaging-policy">Business Messaging Policy</Link>, the <Link href="/commerce-policy">Commerce Policy</Link> or
          the <Link href="/community-guidelines">Community Guidelines</Link>.</li>
        <li>Many customers report the business for fraud or misleading messages.</li>
      </ul>
      <p>False documents lead to the account being closed and may be reported to the authorities.</p>

      <h2>5. Customers</h2>
      <p>
        Even with a tick, never share OTPs, PINs or card details in a chat, and check offers that look too good to be true. Report a business
        from its chat → menu → Report.
      </p>
    </LegalPage>
  );
}
