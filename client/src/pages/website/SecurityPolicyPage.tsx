import { Link } from "wouter";
import { LegalPage } from "./LegalPage";
import { COMPANY, POLICIES_UPDATED } from "./site-facts";

/** How we protect accounts, and how to report a security problem to us. */
export default function SecurityPolicyPage() {
  return (
    <LegalPage title="Security and Reporting Vulnerabilities" updated={POLICIES_UPDATED}>
      <h2>1. How we protect NeuraTalk</h2>
      <ul>
        <li>Calls, messages and files travel over encrypted connections. Because translation needs our servers to process speech and text,
          calls and chats are <strong>not</strong> end-to-end encrypted — we say this plainly so you can decide what to share.</li>
        <li>Photos, videos and documents can only be opened by the people in that chat or group. View-once photos are never sent to the
          receiver's phone as a file path; in 1:1 chats they are deleted from our storage once opened.</li>
        <li>Sign-in uses a one-time code sent to your phone. You can add <strong>two-step verification</strong>: a 6-digit PIN asked after the code,
          stored only as a salted hash. A forgotten PIN can only be removed 7 days after you ask, so a stolen SIM alone is not enough.</li>
        <li>Login codes that businesses send are stored encrypted and erased once used.</li>
        <li>Access to production systems and data is limited to staff who need it, and admin actions are logged.</li>
        <li>Business API keys are stored as hashes and can be revoked at any time.</li>
      </ul>

      <h2>2. Keeping your account safe</h2>
      <ul>
        <li>Never share your SMS code or PIN. NeuraTalk staff will never ask for them.</li>
        <li>Turn on two-step verification: More → Privacy → Two-step verification.</li>
        <li>Lock private chats with a secret code: open the chat → menu → Lock chat.</li>
        <li>If you lose your phone, sign in on a new phone; this lets you recover your account. Contact us if you need help.</li>
      </ul>

      <h2>3. Reporting a vulnerability</h2>
      <p>
        If you find a security problem in NeuraTalk, please tell us before telling anyone else. Email <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a> with
        the subject "Security", the steps to reproduce it, and what an attacker could do. We will:
      </p>
      <ul>
        <li>acknowledge your report within 3 working days;</li>
        <li>keep you updated while we fix it, and tell you when it is fixed;</li>
        <li>not take legal action against you for research done in good faith under these rules;</li>
        <li>thank you publicly if you wish.</li>
      </ul>
      <p>Rules for research:</p>
      <ul>
        <li>Use only your own accounts, or test accounts with the owner's permission. Never access, change or delete other people's data.</li>
        <li>No denial-of-service attacks, spam, social engineering of our staff or users, or physical attacks.</li>
        <li>Stop and tell us as soon as you see personal data that isn't yours, and don't keep it.</li>
        <li>Give us reasonable time to fix the problem before you publish anything.</li>
      </ul>

      <h2>4. If something goes wrong</h2>
      <p>
        If a security incident affects your personal data, we will tell you and the Data Protection Board of India as the law requires, and
        report to CERT-In within the time the CERT-In directions require. See our <Link href="/privacy">Privacy Policy</Link>.
      </p>
    </LegalPage>
  );
}
