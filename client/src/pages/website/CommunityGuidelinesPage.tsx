import { Link } from "wouter";
import { LegalPage } from "./LegalPage";
import { MINIMUM_AGE, POLICIES_UPDATED, URGENT_REMOVAL_HOURS } from "./site-facts";

/** What nobody may do on NeuraTalk: people, groups, status, businesses. Part of the Terms. */
export default function CommunityGuidelinesPage() {
  return (
    <LegalPage title="Community Guidelines" updated={POLICIES_UPDATED} audience="For everyone who uses NeuraTalk: chats, groups, calls, status and business accounts">
      <p>
        NeuraTalk lets people talk across languages. That only works if everyone can trust it. These guidelines say what is not allowed,
        how you can report it, and what we do about it. They are part of our <Link href="/terms">Terms of Service</Link>. Businesses must
        also follow the <Link href="/business-messaging-policy">Business Messaging Policy</Link> and
        the <Link href="/commerce-policy">Commerce Policy</Link>.
      </p>

      <h2>1. Be who you are</h2>
      <ul>
        <li>Use your own phone number and your own name or a name people know you by.</li>
        <li>Do not pretend to be another person, a business, a brand, a public figure, a police or government body, or NeuraTalk staff.</li>
        <li>Do not use another person's voice. The own-voice feature may only be made from <strong>your</strong> voice — see
          the <Link href="/voice-policy">Voice and Consent Policy</Link>.</li>
        <li>You must be {MINIMUM_AGE} or older. See the <Link href="/age-policy">Age Policy</Link>.</li>
      </ul>

      <h2>2. Never allowed</h2>
      <p>Whatever the language, and whether in a chat, group, call, status, profile, sticker, poll, business catalog or broadcast:</p>
      <ul>
        <li><strong>Child sexual abuse material</strong> of any kind, and anything that sexualises children. We remove it, keep what the law
          requires us to keep, and report it to the authorities.</li>
        <li>Sharing intimate or sexual images or videos of someone without their consent, including morphed or AI-made ones.</li>
        <li>Threats of violence, encouraging violence, terrorism or violent extremism.</li>
        <li>Harassment, bullying, stalking, or repeatedly contacting someone who asked you to stop.</li>
        <li>Hate speech: attacking people because of religion, caste, race, ethnicity, nationality, sex, gender, sexual orientation,
          disability or serious illness.</li>
        <li>Fraud and scams: fake prizes, loans or jobs, phishing links, asking for OTPs, PINs, card or bank details, investment schemes
          that promise fixed or guaranteed returns.</li>
        <li>Spam: bulk or automated messages to people who did not ask for them, chain messages, adding people to groups to sell to them.</li>
        <li>Selling or promoting illegal goods or services (see the <Link href="/commerce-policy">Commerce Policy</Link>).</li>
        <li>Content that encourages self-harm or suicide. If someone tells you they may harm themselves, encourage them to contact
          local emergency services (112 in India) or a helpline.</li>
        <li>Deliberately false information likely to cause public harm, such as fake health cures or fake news about elections or
          emergencies.</li>
        <li>Sharing other people's private information (their number, address, ID documents, photos) to harm or shame them.</li>
        <li>Content that breaks someone else's copyright or trademark (see our <Link href="/copyright">Copyright Policy</Link>).</li>
        <li>Malware, hacking, scraping, trying to get into accounts that aren't yours, or overloading our systems.</li>
      </ul>

      <h2>3. Translation is not an excuse</h2>
      <p>
        NeuraTalk translates what you say. You are responsible for what you write or say in your own language; the same rules apply to
        the translated version. If a translation looks offensive but the original wasn't, report it and we will look at both.
      </p>

      <h2>4. Groups</h2>
      <ul>
        <li>Group admins choose who joins and may remove members or messages. Admins are responsible for keeping their group within these
          guidelines.</li>
        <li>Do not add people to groups they didn't ask to join for selling, politics or mass messaging.</li>
      </ul>

      <h2>5. How to report</h2>
      <ul>
        <li>In the app: open the chat → menu → <strong>Report</strong>, or tap and hold a message. You can also block the person; they won't be
          able to call or message you.</li>
        <li>On the web: the <Link href="/report-abuse">Report Abuse</Link> page.</li>
        <li>Complaints about intimate images or impersonation of you are acted on within {URGENT_REMOVAL_HOURS} hours of receiving them, as
          Indian law requires. Other complaints follow the timelines on our <Link href="/grievance">Grievance</Link> page.</li>
      </ul>
      <p>
        Calls and chats on NeuraTalk are processed on our servers for translation and are <strong>not</strong> end-to-end encrypted. Our team does not
        read chats as a routine. When something is reported, the reviewer looks at the reported messages and what is needed to understand them.
      </p>

      <h2>6. What we do</h2>
      <ul>
        <li>Remove content, limit features (for example, stop someone starting new chats or groups), or suspend or permanently ban the
          account, depending on how serious and how repeated the problem is.</li>
        <li>Ban the phone number and related accounts for the most serious harms.</li>
        <li>Keep records and report to law enforcement where the law requires it or where someone is in danger (see
          our <Link href="/law-enforcement">Law Enforcement Guidelines</Link>).</li>
      </ul>
      <p>
        If we act on your account, we tell you why in the app or by email, unless the law or someone's safety prevents it. You can appeal
        by writing to us within 30 days; a different person reviews the appeal.
      </p>
    </LegalPage>
  );
}
