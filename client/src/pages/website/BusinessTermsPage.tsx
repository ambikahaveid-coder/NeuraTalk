import { Link } from "wouter";
import { LegalPage } from "./LegalPage";
import { COMPANY, MARKETING_CAP_PER_DAY, POLICIES_UPDATED } from "./site-facts";

/** The contract for businesses: account, team, wallet, API, data roles, suspension. */
export default function BusinessTermsPage() {
  return (
    <LegalPage title="NeuraTalk Business Terms" updated={POLICIES_UPDATED} audience="For businesses using the NeuraTalk Business app, the business dashboard or the business API">
      <p>
        These terms apply in addition to our <Link href="/terms">Terms of Service</Link> when you use NeuraTalk for a business. "You" means the business
        and everyone who uses NeuraTalk on its behalf. By turning on business features you confirm that you are allowed to accept these terms for
        the business. The service is provided by {COMPANY.legalName}.
      </p>

      <h2>1. Your account and team</h2>
      <ul>
        <li>Give true details about the business and keep them up to date.</li>
        <li>You decide who is on your team and what each person may do. You are responsible for everything your team members do and for every
          action taken with your API keys. Keep keys secret; revoke a key immediately if it may have leaked.</li>
        <li>Some actions need a second admin to approve them (for example sending a broadcast). Don't share one person's login to get around this.</li>
      </ul>

      <h2>2. Rules you agree to</h2>
      <p>
        You must follow the <Link href="/business-messaging-policy">Business Messaging Policy</Link>, the <Link href="/commerce-policy">Commerce Policy</Link>,
        the <Link href="/community-guidelines">Community Guidelines</Link> and all laws that apply to your messages and sales — including consumer protection,
        advertising, telecom and data protection law. In short:
      </p>
      <ul>
        <li>Only message customers who contacted you or agreed to hear from you; respect STOP and blocks at once.</li>
        <li>Offers go only to customers who agreed to receive them, and at most {MARKETING_CAP_PER_DAY} offers a day from your business to any one customer.</li>
        <li>After a customer has been quiet for 24 hours, you can only send an approved template until they write again.</li>
      </ul>

      <h2>3. Customer data</h2>
      <ul>
        <li><strong>You</strong> are the data fiduciary for your customers' personal data — the contact lists you import, the notes and labels you add and the
          messages you send them. You must have a lawful reason and, for offers, the customer's consent. When you import a customer list you confirm this
          for every number on it.</li>
        <li><strong>NeuraTalk</strong> processes that data only on your instructions to provide the service, as set out in
          our <Link href="/dpa">Data Processing Agreement</Link>. We do not sell it or use it to advertise to your customers.</li>
        <li>NeuraTalk is the data fiduciary for each customer's own NeuraTalk account. A customer can block you, stop offers, or delete their account at any time.</li>
        <li>Answer data requests from your customers (access, correction, deletion) within the time the law requires; we will help with what we hold.</li>
      </ul>

      <h2>4. Wallet and charges</h2>
      <ul>
        <li>Business messages are charged from your prepaid wallet at the rates shown in the dashboard when you send. Messages we skip because the
          customer blocked you, switched offers off, or reached the daily limit are not charged.</li>
        <li>Prices may change; we will show new prices in the dashboard at least 7 days before they apply. Messages already sent keep their price.</li>
        <li>Taxes are added as the law requires. Refunds of unused wallet balance follow our <Link href="/refund-policy">Refund Policy</Link>.</li>
      </ul>

      <h2>5. Templates, verification and review</h2>
      <ul>
        <li>NeuraTalk reviews every template version before it can be used, and may reject or later disable a template that breaks the rules.</li>
        <li>The verified tick is given and removed as explained in the <Link href="/verified-badge-policy">Verified Business Badge</Link> policy.</li>
      </ul>

      <h2>6. Availability and changes</h2>
      <p>
        We work to keep NeuraTalk available and fast, but we do not promise it will never be interrupted. Messages are delivered inside NeuraTalk only;
        we do not send SMS or messages through other apps. We may change or remove features; we give notice in the dashboard of changes that
        significantly reduce what you can do.
      </p>

      <h2>7. Suspension and ending</h2>
      <ul>
        <li>We may limit, suspend or close a business account that breaks these terms or the policies above, puts people at risk, or is not paid for.
          For serious harm (fraud, child safety, weapons, drugs) we act immediately; otherwise we tell you and give you a reasonable chance to fix it.</li>
        <li>You can stop using NeuraTalk Business at any time. When the account closes we delete your business data within 90 days, except what the law
          requires us to keep, and you can download your customer list before then.</li>
      </ul>

      <h2>8. Responsibility</h2>
      <ul>
        <li>You are responsible for your products, prices, deliveries, refunds and customer service, and for the content of your messages.</li>
        <li>You agree to cover NeuraTalk's reasonable costs if a claim is made against us because of your messages, your products or your breach of these terms.</li>
        <li>As far as the law allows, our total liability to you for any claim about NeuraTalk Business is limited to the amount you paid us in the 12 months
          before the claim. Nothing limits liability that cannot be limited by law.</li>
      </ul>

      <h2>9. Law and disputes</h2>
      <p>
        These terms are governed by the laws of India. Disputes are resolved as set out in the <Link href="/terms">Terms of Service</Link> (arbitration in
        Guntur, Andhra Pradesh), without taking away any right the law gives you. Please contact us first; most problems can be solved quickly.
      </p>
    </LegalPage>
  );
}
