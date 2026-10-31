import { Link } from "wouter";
import { LegalPage } from "./LegalPage";
import { COMPANY, MINIMUM_AGE, POLICIES_UPDATED } from "./site-facts";

/** Minimum age and what happens when a child's account is found. */
export default function AgePolicyPage() {
  return (
    <LegalPage title="Age Policy" updated={POLICIES_UPDATED}>
      <h2>1. NeuraTalk is for adults</h2>
      <p>
        You must be <strong>{MINIMUM_AGE} years or older</strong> to create or use a NeuraTalk account, including NeuraTalk Business. India's Digital
        Personal Data Protection Act, 2023 treats everyone under 18 as a child and requires a parent's verifiable consent to process a child's
        data. We do not offer accounts to children, so we do not collect that consent and we do not knowingly process children's data.
      </p>

      <h2>2. What we do not do</h2>
      <ul>
        <li>We do not target ads or offers at children, track children's behaviour, or let businesses send marketing to children.</li>
        <li>Our own-voice feature is only for adults speaking with their own voice.</li>
      </ul>

      <h2>3. If a child is using NeuraTalk</h2>
      <ul>
        <li>Parents or guardians: write to <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a> with the phone number of the account and
          we will review it. You can also use the <Link href="/report-abuse">Report Abuse</Link> page.</li>
        <li>If we find that an account belongs to someone under {MINIMUM_AGE}, we close it and delete its data, apart from anything the law
          requires us to keep.</li>
        <li>If a child is in danger, contact the police (112) or the Childline helpline (1098) first.</li>
      </ul>

      <h2>4. Businesses</h2>
      <p>
        Businesses must not knowingly message, sell to or collect data about children through NeuraTalk, and must follow the age rules for
        their products (see the <Link href="/commerce-policy">Commerce Policy</Link>).
      </p>
    </LegalPage>
  );
}
