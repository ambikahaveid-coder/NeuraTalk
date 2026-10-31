import { Link } from "wouter";
import { LegalPage } from "./LegalPage";
import { COMPANY, GRIEVANCE_ACK_HOURS, GRIEVANCE_RESOLVE_DAYS, POLICIES_UPDATED, URGENT_REMOVAL_HOURS } from "./site-facts";

/** Grievance redressal (IT Rules 2021, DPDP Act 2023, Consumer Protection E-Commerce Rules 2020). */
export default function GrievancePage() {
  return (
    <LegalPage title="Grievance Redressal" updated={POLICIES_UPDATED} audience="How to complain about content, your data, a business or our service">
      <h2>1. Grievance Officer</h2>
      <p>
        <strong>Grievance Officer, {COMPANY.legalName}</strong><br />
        {COMPANY.address}<br />
        Email: <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a> (subject "Grievance") · Phone: <a href={COMPANY.phoneHref}>{COMPANY.phone}</a><br />
        Working hours: Monday to Saturday, 10 am to 6 pm IST, except public holidays.
      </p>

      <h2>2. What you can complain about</h2>
      <ul>
        <li>Content or behaviour that breaks our <Link href="/community-guidelines">Community Guidelines</Link> or the law.</li>
        <li>How we handle your personal data, or a request to see, correct or delete it (Digital Personal Data Protection Act, 2023).</li>
        <li>A business on NeuraTalk (spam, fraud, an order problem) — complain to the business first; if it doesn't help, to us.</li>
        <li>Our service, billing or a decision we made about your account.</li>
      </ul>

      <h2>3. Timelines</h2>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr><th className="border p-2 text-left">Step</th><th className="border p-2 text-left">Our commitment</th></tr>
        </thead>
        <tbody>
          <tr><td className="border p-2">Acknowledge your complaint</td><td className="border p-2">Within {GRIEVANCE_ACK_HOURS} hours</td></tr>
          <tr><td className="border p-2">Resolve it</td><td className="border p-2">Within {GRIEVANCE_RESOLVE_DAYS} days</td></tr>
          <tr><td className="border p-2">Remove intimate images shared without consent, or content impersonating you</td><td className="border p-2">Within {URGENT_REMOVAL_HOURS} hours of your complaint</td></tr>
        </tbody>
      </table>

      <h2>4. What to include</h2>
      <ul>
        <li>Your name and the phone number of your NeuraTalk account.</li>
        <li>What happened, when, and the phone number, group or business involved.</li>
        <li>Screenshots or message details if you have them. Don't send us passwords, PINs or card numbers.</li>
      </ul>
      <p>
        Faster in the app: open the chat → menu → <strong>Report</strong>. On the web: <Link href="/report-abuse">Report Abuse</Link>.
      </p>

      <h2>5. If you are not satisfied</h2>
      <ul>
        <li>For content decisions, you may appeal to the Grievance Appellate Committee set up by the Government of India under the IT Rules.</li>
        <li>For personal data, you may complain to the Data Protection Board of India after using our grievance process.</li>
        <li>For a consumer dispute, you may approach the consumer commission.</li>
      </ul>
    </LegalPage>
  );
}
