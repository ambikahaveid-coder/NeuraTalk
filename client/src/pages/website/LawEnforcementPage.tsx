import { Link } from "wouter";
import { LegalPage } from "./LegalPage";
import { CALL_TEXT_RETENTION_DAYS, COMPANY, POLICIES_UPDATED } from "./site-facts";

/** How NeuraTalk answers requests from police, courts and government. */
export default function LawEnforcementPage() {
  return (
    <LegalPage title="Law Enforcement Guidelines" updated={POLICIES_UPDATED} audience="For police, courts and government agencies, and for users who want to know how we respond">
      <h2>1. Our approach</h2>
      <p>
        We respect our users' privacy and we follow the law. We disclose user data only when Indian law requires it — for example a valid
        order or notice under the Bharatiya Nagarik Suraksha Sanhita, 2023, the Information Technology Act, 2000 and its rules, or a court
        order — or in an emergency involving a risk of death or serious injury. We check every request, and we push back on requests that are
        unlawful, too broad or not properly signed.
      </p>

      <h2>2. What we hold (and what we don't)</h2>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr><th className="border p-2 text-left">Data</th><th className="border p-2 text-left">Held?</th></tr>
        </thead>
        <tbody>
          <tr><td className="border p-2">Account: phone number, name, profile photo, sign-up date, last sign-in, IP address of recent sessions</td><td className="border p-2">Yes, while the account exists</td></tr>
          <tr><td className="border p-2">Call details: who called whom, when, how long</td><td className="border p-2">Yes, {CALL_TEXT_RETENTION_DAYS} days</td></tr>
          <tr><td className="border p-2">Call audio</td><td className="border p-2">No — calls are never recorded</td></tr>
          <tr><td className="border p-2">Text of a call and its translation</td><td className="border p-2">{CALL_TEXT_RETENTION_DAYS} days</td></tr>
          <tr><td className="border p-2">Chat messages and files</td><td className="border p-2">Until the user deletes them or the account; disappearing messages and opened view-once photos are deleted</td></tr>
          <tr><td className="border p-2">Deleted messages and accounts</td><td className="border p-2">Not recoverable after deletion, except backups kept for a short time for disaster recovery</td></tr>
          <tr><td className="border p-2">Payment card numbers</td><td className="border p-2">No — handled by our payment partner</td></tr>
        </tbody>
      </table>

      <h2>3. How to send a request</h2>
      <ul>
        <li>Email <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a> with the subject "Law enforcement request", from an official
          government email address.</li>
        <li>Include: the legal provision, the case or FIR number, the issuing officer's name, rank and contact, the phone number(s) or
          account(s) concerned, the exact data needed and the time period. Requests must be on letterhead and signed.</li>
        <li>Postal address for notices: {COMPANY.legalName}, {COMPANY.address}.</li>
      </ul>

      <h2>4. Emergencies</h2>
      <p>
        If someone is at immediate risk of death or serious injury, write "EMERGENCY" in the subject and explain the risk. We may share the
        minimum data needed to prevent harm before formal paperwork arrives.
      </p>

      <h2>5. Preserving data</h2>
      <p>
        We can preserve the data of a specific account for 90 days while you obtain legal process. Because of our retention periods, please ask
        for preservation quickly.
      </p>

      <h2>6. Telling users</h2>
      <p>
        We tell users about requests for their data unless the law forbids it, a court orders us not to, or telling them would put someone at risk.
      </p>

      <h2>7. Child safety</h2>
      <p>
        We report child sexual abuse material to the authorities as Indian law requires, and keep what is required for the investigation.
      </p>

      <p>
        Users: see our <Link href="/privacy">Privacy Policy</Link> for how we protect your data, and <Link href="/grievance">Grievance</Link> for how to complain.
      </p>
    </LegalPage>
  );
}
