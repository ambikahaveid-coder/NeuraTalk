import { Link } from "wouter";
import { COMPANY, POLICIES_UPDATED, FREE_AI_MINUTES, CHAT_MESSAGES_PER_AI_MINUTE } from "./site-facts";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-6">Terms of Service</h1>
          <p className="text-muted-foreground">Last updated: {POLICIES_UPDATED}</p>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto prose prose-neutral dark:prose-invert">
          <p className="lead">
            These terms are an agreement between you and {COMPANY.legalName} (CIN {COMPANY.cin}), the company that runs NeuraTalk
            ("NeuraTalk", "we", "us"). By creating an account or using the NeuraTalk apps, the NeuraTalk Business app, the website or
            the API (together, the "Services"), you agree to them. If you use the Services for a business, you confirm you are allowed
            to accept these terms for it, and "you" includes that business.
          </p>

          <h2>1. What NeuraTalk does</h2>
          <ul>
            <li>Voice and video calls translated while you talk, spoken in your own cloned voice once you have one, or shown as captions.</li>
            <li>Translated one-to-one and group chats, including photos, videos, documents, voice messages and location.</li>
            <li>An in-person mode for two people sharing one phone, and an AI assistant.</li>
            <li>NeuraTalk Business: business profiles, a team inbox, catalogs, automatic replies, translated customer calls, and
              utility updates, login codes and offers sent under our <Link href="/business-messaging-policy">Business Messaging Policy</Link>.</li>
            <li>An API for businesses to send updates and login codes from their own systems.</li>
          </ul>
          <p>
            Both people need NeuraTalk; we do not connect to ordinary phone numbers and do not send SMS. <strong>NeuraTalk is not a
            replacement for your phone service and cannot be used to call emergency services.</strong>
          </p>

          <h2>2. Your account</h2>
          <ul>
            <li>You must be at least 18 years old.</li>
            <li>You sign in with a mobile number you control and must keep access to it secure. You are responsible for what happens on your account.</li>
            <li>Give accurate information and keep one personal account per person.</li>
            <li>A number used for a business account cannot also be used as someone's personal account.</li>
          </ul>

          <h2>3. Your voice</h2>
          <ul>
            <li>You may create a voice only of yourself. Never record, upload or let NeuraTalk learn anyone else's voice.</li>
            <li>NeuraTalk learns your voice from your calls only if you allow it in the app, and you can switch that off at any time.</li>
            <li>Your cloned voice speaks only your own translated words in your own calls. It is never used for anyone else.</li>
            <li>You can switch your voice off or delete it any time in Settings → Your voice.</li>
          </ul>

          <h2>4. Translation and AI</h2>
          <p>
            Translation, speech recognition, voice and the assistant are automatic and can be wrong — especially with names, numbers, mixed
            languages, accents and noise. Do not rely on them for medical, legal, financial or safety-critical decisions; use a qualified
            human interpreter for those. See our <Link href="/translation-disclaimer">Translation Disclaimer</Link> and
            <Link href="/ai-usage-policy"> AI Usage Policy</Link>.
          </p>

          <h2>5. Your content</h2>
          <ul>
            <li>You own what you say, write and share ("your content"). You give us permission to store, process, translate and deliver it
              only to provide the Services to you and the people you talk to.</li>
            <li>We do not record call audio. The translated text of a call is kept in your call history for a limited time, and chats stay
              until you delete them, as described in our <Link href="/privacy">Privacy Policy</Link>.</li>
            <li>We do not sell your content and do not use your calls or messages to train our own AI models.</li>
            <li>You are responsible for having the right to share what you send, including other people's photos and information.</li>
          </ul>

          <h2>6. Acceptable use</h2>
          <p>You must not use NeuraTalk to:</p>
          <ul>
            <li>break the law, or help anyone else break it;</li>
            <li>harass, threaten, defraud or impersonate anyone, or send spam;</li>
            <li>share content that sexually exploits children, promotes violence or terrorism, or infringes someone's rights;</li>
            <li>record or monitor others without their consent, or clone someone else's voice;</li>
            <li>interfere with the Services, get around limits, scrape data, or reverse-engineer the apps except where the law allows;</li>
            <li>resell the Services without our written agreement.</li>
          </ul>
          <p>
            The full rules are in our <Link href="/community-guidelines">Community Guidelines</Link>, which are part of these terms. Anyone can report
            misuse at <Link href="/report-abuse">Report Abuse</Link>. You must be 18 or older — see the <Link href="/age-policy">Age Policy</Link>. The own-voice
            feature follows the <Link href="/voice-policy">Voice and Consent Policy</Link>.
          </p>

          <h2>7. Business accounts</h2>
          <ul>
            <li>Businesses must follow the <Link href="/business-terms">NeuraTalk Business Terms</Link>, the <Link href="/business-messaging-policy">Business Messaging Policy</Link>
              (template review, consent and marketing limits) and the <Link href="/commerce-policy">Commerce Policy</Link> (what may be sold).</li>
            <li>The verified tick is given only after our review, can be removed at any time, and is not an endorsement — see
              the <Link href="/verified-badge-policy">Verified Business Badge</Link> policy.</li>
            <li>Customers can block a business or switch off its offers; businesses must respect that.</li>
            <li>For its customers' data, the business decides how it is used and is responsible for complying with data protection law. We
              process that data on the business's behalf.</li>
            <li>The business is responsible for its team members and for everything sent with its account or API keys.</li>
          </ul>

          <h2>8. Plans, wallet and payment</h2>
          <ul>
            <li><strong>Free for personal use:</strong> chats, and voice, video and group calls between people, when no AI translation is used.</li>
            <li><strong>AI translation is paid.</strong> Each new personal account gets {FREE_AI_MINUTES} free AI translation minutes, once, to try it.
              After that, translated calls and chat translation need a plan. Translated call time is counted per second while translation runs,
              and every {CHAT_MESSAGES_PER_AI_MINUTE} translated chat messages use one minute. When your minutes run out, calls still connect and
              messages are still delivered, without translation, and a translated call in progress ends.</li>
            <li>Current plans and prices are on our <Link href="/pricing">pricing page</Link> and in the app, in Indian Rupees (₹).</li>
            <li><strong>Businesses pay first.</strong> A business account gets no free minutes or credit. Updates, login codes, campaigns,
              business calls and AI translation are paid from the business's prepaid wallet, which is credited only after we receive the
              payment. Messages that are not sent are not charged.</li>
            <li>Prices include or will show applicable taxes such as GST. Online payments, when offered, are processed by our payment
              partner; we never see your full card details.</li>
            <li>We will give notice in the app or by email before a price change applies to you. Refunds are covered by our
              <Link href="/refund-policy"> Refund Policy</Link> and <Link href="/cancellation-policy">Cancellation Policy</Link>.</li>
          </ul>

          <h2>9. Availability and changes to the Services</h2>
          <p>
            We work to keep NeuraTalk available and improving, but we do not promise it will always be available, error-free or offer every
            language pair or feature. We may change, add or remove features. Specific service levels apply only if we agree them in writing
            with a business.
          </p>

          <h2>10. Suspension and closing your account</h2>
          <ul>
            <li>You can delete your account at any time from the app or as described on our <Link href="/account-deletion">Account Deletion</Link> page.</li>
            <li>We may suspend or close an account, remove content or switch off features if these terms or the law are broken, to protect
              other people, or when the law requires it. Where it is safe and lawful, we will tell you why and how to appeal.</li>
          </ul>

          <h2>11. Our responsibility to you</h2>
          <p>
            The Services are provided "as is" to the extent the law allows. We are not responsible for losses caused by translation mistakes,
            for what other users or businesses say or do, or for problems with your device, network or third-party services. We are not liable
            for indirect or consequential losses. Our total liability to you for any claim is limited to the greater of the amount you paid us in
            the 12 months before the claim and ₹5,000. Nothing in these terms limits liability that cannot be limited by law, including for fraud
            or gross negligence, or your rights under the Consumer Protection Act, 2019.
          </p>

          <h2>12. Your responsibility to us</h2>
          <p>
            If you use NeuraTalk in breach of these terms or the law and someone makes a claim against us because of it, you agree to cover the
            reasonable costs and losses that result.
          </p>

          <h2>13. Changes to these terms</h2>
          <p>
            We may update these terms. For material changes we will tell you in the app or by email before they apply. If you keep using
            NeuraTalk after that, the new terms apply; if you do not agree, you can delete your account.
          </p>

          <h2>14. Law, disputes and grievances</h2>
          <ul>
            <li>These terms are governed by the laws of India.</li>
            <li>Please contact us first — most problems are solved quickly. If a dispute cannot be resolved within 30 days, it will be referred to
              arbitration in Guntur, Andhra Pradesh under the Arbitration and Conciliation Act, 1996, in English, unless the law gives you the
              right to go to a consumer forum.</li>
            <li>Grievance Officer (details and timelines on our <Link href="/grievance">Grievance</Link> page): write to {COMPANY.email} with "Grievance" in the subject. We acknowledge complaints within 24 hours and aim to
              resolve them within 15 days, as required by the Information Technology Rules, 2021.</li>
          </ul>

          <h2>15. Other terms</h2>
          <p>
            These terms, our <Link href="/privacy">Privacy Policy</Link> and the policies linked above are the whole agreement between us about
            the Services. If one part is found unenforceable, the rest still applies. You may not transfer these terms; we may transfer them to a
            company that takes over NeuraTalk, with notice to you.
          </p>

          <h2>16. Contact</h2>
          <div className="bg-muted p-4 rounded-lg not-prose text-sm space-y-1">
            <p className="font-semibold">{COMPANY.legalName}</p>
            <p>{COMPANY.address}</p>
            <p>CIN {COMPANY.cin}</p>
            <p>Email: {COMPANY.email} · Phone: {COMPANY.phone}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
