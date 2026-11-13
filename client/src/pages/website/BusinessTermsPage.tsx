import { Link } from "wouter";
import { LegalPage } from "./LegalPage";
import { COMPANY, MARKETING_CAP_PER_DAY } from "./site-facts";

const BUSINESS_TERMS_UPDATED = "13 November 2026";

/** The contract for businesses: account, team, wallet, API, data roles, suspension. */
export default function BusinessTermsPage() {
  return (
    // Section 4 (paying for credit and plans) changed on 13 November 2026.
    <LegalPage title="NeuraTalk Business Terms" updated={BUSINESS_TERMS_UPDATED} audience="For businesses using the NeuraTalk Business app, the business dashboard or the business API">
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
        <li><strong>Pay first.</strong> There are no free minutes or free credit for businesses. Your wallet is credited, or your plan
          started, only after we receive your payment and record its reference. Until then, paid sending, business calls and AI translation stay off.</li>
        <li><strong>How to pay.</strong> In the dashboard or the NeuraTalk Business app (Wallet &amp; plan), choose a credit pack, an amount, or a
          plan, pay to the UPI ID or bank account shown there, and send us the payment reference (UTR). We check it against our bank statement,
          then add the credit or start the plan. Each payment reference can be used once. If we can't find the payment, we tell you why in the same screen.</li>
        <li><strong>If a NeuraTalk partner manages your account</strong> (you see "Managed by …"), you buy credit and plans from that
          partner and pay the partner, under your own agreement with it; the partner confirms your payments and supports you. Prices you pay
          the partner are set by the partner. These terms and our messaging rules still apply to you, and NeuraTalk can still act on your account
          to protect customers.</li>
        <li><strong>Plans</strong> give AI translation minutes for business calls for the number of days shown. They do not renew on their own.
          When a plan ends you have 7 days to renew; after that your business account is paused until a new plan is paid. Your wallet balance is kept.</li>
        <li><strong>Wallet.</strong> Messages, and calls after your plan minutes run out, are paid from your prepaid wallet. Extra credit given
          with a pack (a bonus) is promotional credit: you can use it like any credit, but it has no cash value and is not refunded.</li>
        <li>Business messages are charged from your prepaid wallet at the rates shown in the dashboard when you send. Replies to a customer who
          wrote to you in the last 24 hours are not charged. Messages we skip because the customer blocked you, switched offers off, is not on
          NeuraTalk, or reached the daily limit are not charged. We may agree special rates with a business; they are shown in your dashboard.</li>
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
