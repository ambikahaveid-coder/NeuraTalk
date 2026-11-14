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
            Welcome to NeuraTalk. These terms explain what you can expect from us and what we expect from you. We've tried to write them the
            way we'd explain them across a table: plainly, and without hiding anything in the small print.
          </p>
          <p>
            NeuraTalk is run by {COMPANY.legalName} (CIN {COMPANY.cin}), a company registered in India ("NeuraTalk", "we", "us"). These
            terms cover the NeuraTalk app, the NeuraTalk Business app, neuratalk.in, NeuraTalk on the web and our APIs (together, "NeuraTalk").
            By creating an account or using NeuraTalk you agree to them. If you use NeuraTalk for a business, you confirm you're allowed to
            accept these terms for it, and "you" includes that business.
          </p>

          <h2>1. What NeuraTalk is</h2>
          <p>
            NeuraTalk is a messaging and calling app built so that language never gets in the way. You talk or type in your language, and the
            other person hears or reads it in theirs. Here is what that includes today:
          </p>
          <ul>
            <li><strong>Chats and groups</strong> — one-to-one and group chats, communities, channels and status, with photos, videos, documents,
              voice messages, locations, polls, stickers and contact cards. Messages can be translated for each reader.</li>
            <li><strong>Calls</strong> — voice and video calls, group calls and screen sharing. Calls can be translated while you speak, in your own
              voice once NeuraTalk knows it, or as captions.</li>
            <li><strong>Private chats</strong> — one-to-one chats that are end-to-end encrypted on your phone and are not translated.</li>
            <li><strong>Payments by UPI</strong> — you can ask a friend or a business for money, or pay them, through your own UPI app.</li>
            <li><strong>Your AI assistant</strong> — if you turn it on, it answers chats and calls for you while you're busy.</li>
            <li><strong>NeuraTalk Business</strong> — profiles, catalogs, orders, a team inbox, auto-replies, an AI receptionist, broadcasts,
              ads inside NeuraTalk, and an API for a business's own software.</li>
          </ul>
          <p>
            Most of this works only when both people use NeuraTalk. Businesses can, where we offer it, reach customers who don't have
            NeuraTalk yet with one SMS that links to the message. <strong>NeuraTalk is not a replacement for your mobile phone service and cannot
            be used to call emergency services. In an emergency, call 112.</strong>
          </p>

          <h2>2. Your account</h2>
          <ul>
            <li>You must be at least 18 years old. See our <Link href="/age-policy">Age Policy</Link>.</li>
            <li>You sign up with a mobile number you own. Keep your phone and any two-step PIN safe — you're responsible for what happens on your
              account. If you think someone else has access, sign out other devices in More → Linked devices and tell us.</li>
            <li>Use your real name or the name people know you by, and keep one personal account per person.</li>
            <li>A number used for a business can't also be someone's personal account.</li>
          </ul>

          <h2>3. Your privacy</h2>
          <p>
            Our <Link href="/privacy">Privacy Policy</Link> explains what we collect, why, where it's stored (India) and the choices you have. A few
            things worth saying up front:
          </p>
          <ul>
            <li>We never record the audio of your calls, and we don't sell your data.</li>
            <li>Translation needs our servers to read the text or speech being translated, so <strong>calls and normal chats are encrypted in transit and
              at rest, but not end to end.</strong> Private chats are end to end encrypted: we can't read them.</li>
            <li>We don't use your calls or messages to train our own AI models.</li>
          </ul>

          <h2>4. What you share</h2>
          <ul>
            <li>What you say, write and send is yours. You give us permission to store, process, translate and deliver it only so NeuraTalk can work
              for you and the people you talk to.</li>
            <li>Only share what you have the right to share — including other people's photos, numbers and information.</li>
            <li>Group invite links let anyone who has the link join. If you're a group admin, share them carefully; you can reset or turn off a link
              any time.</li>
            <li>When you share your screen in a call, the other person sees whatever is on it, including notifications. Stop sharing before you
              open anything private.</li>
            <li>Broadcast lists reach only people who have messaged you or saved your number. Don't use them to spam.</li>
          </ul>

          <h2>5. Your voice</h2>
          <ul>
            <li>You can create a voice only of yourself. Never record, upload or let NeuraTalk learn anyone else's voice.</li>
            <li>NeuraTalk learns your voice from your calls only if you allow it, and you can switch that off any time.</li>
            <li>Your voice speaks only your own words: your translated words in your calls and, if you choose, your AI assistant — which always says it
              is an assistant. It is never used for anyone else.</li>
            <li>Delete your voice any time in Settings → Your voice. The full rules are in the <Link href="/voice-policy">Voice and Consent Policy</Link>.</li>
          </ul>

          <h2>6. Translation and AI can be wrong</h2>
          <p>
            Translation, speech recognition, cloned voices and AI assistants are automatic, and they make mistakes — especially with names,
            numbers, mixed languages, accents and noise. Check anything important. Don't rely on them for medical, legal, financial or safety
            decisions; use a qualified human interpreter for those. See the <Link href="/translation-disclaimer">Translation Disclaimer</Link> and
            the <Link href="/ai-usage-policy">AI Usage Policy</Link>.
          </p>

          <h2>7. Your AI assistant</h2>
          <ul>
            <li>If you turn it on, your assistant replies to chats and answers calls for you while you're busy, or when a call isn't picked up. It
              always tells the other person that it is an AI assistant, and it never pretends to be you.</li>
            <li>You decide what it may say through your instructions, and you're responsible for them. Don't instruct it to mislead, sell to, or
              collect information from people who didn't ask for it.</li>
            <li>What people say to your assistant is kept for you in "Messages taken". Treat it with the same care as any message.</li>
            <li>It costs money to run: see section 9. You can switch it off any time.</li>
          </ul>

          <h2>8. Payments between people and businesses</h2>
          <ul>
            <li>When you pay someone, or ask someone to pay you, the money moves from one bank to another through your own UPI app. <strong>NeuraTalk
              never holds, moves or guarantees that money, and isn't a party to what you're paying for.</strong></li>
            <li>A payment request only shows what someone asked for; "I've paid" only means the payer says so. Check your bank or UPI app
              before you hand over goods or treat a payment as received.</li>
            <li>Never share your UPI PIN, OTP or card details in a chat — no genuine person, business or NeuraTalk staff member will ask for them.
              Report anyone who does.</li>
            <li>Disputes about a purchase are between you and the seller; UPI disputes go through your bank. We'll help by acting on reports of fraud.</li>
          </ul>

          <h2>9. What NeuraTalk costs</h2>
          <ul>
            <li><strong>Free:</strong> chats, voice, video and group calls between people, private chats, groups and communities, when no AI is used.</li>
            <li><strong>AI translation is paid.</strong> New personal accounts get {FREE_AI_MINUTES} free AI translation minutes, once. After that,
              translation needs a plan. Translated call time is counted per second while translation runs, and every {CHAT_MESSAGES_PER_AI_MINUTE}{" "}
              translated chat messages use one minute. When your minutes run out, calls and messages still go through, just without translation.</li>
            <li><strong>Your AI assistant:</strong> 7 days free, then ₹99 for 30 days (unlimited chat replies and 60 call minutes). Pay by UPI and
              send us the reference; we confirm it and the 30 days start.</li>
            <li><strong>Businesses pay first</strong> from a prepaid wallet: messages, campaigns, business calls, AI translation, SMS, ads and the AI
              receptionist (14 days free, then ₹999 for 30 days with 300 call minutes; extra minutes ₹6 each). Messages that aren't sent aren't
              charged, and an SMS that fails is refunded.</li>
            <li>Nothing renews or is charged again unless you choose to pay. Current prices are on the <Link href="/pricing">pricing page</Link> and
              in the app, in Indian Rupees including or showing GST. We'll tell you in the app before a price change applies to you.</li>
            <li>Refunds follow our <Link href="/refund-policy">Refund Policy</Link> and <Link href="/cancellation-policy">Cancellation Policy</Link>.</li>
          </ul>

          <h2>10. Things you must not do</h2>
          <p>Using NeuraTalk means not using it to:</p>
          <ul>
            <li>break the law, or help someone else break it;</li>
            <li>harass, threaten, bully, defraud or impersonate anyone — including through translation, a cloned voice or an AI assistant;</li>
            <li>send spam, chain messages or unwanted offers, or buy, sell or scrape contact lists;</li>
            <li>run payment, loan, job or investment scams, or ask anyone for their UPI PIN or OTP;</li>
            <li>share content that sexually exploits children, promotes terrorism or violence, or infringes someone's rights;</li>
            <li>record or monitor someone without their consent, or clone someone else's voice;</li>
            <li>break, overload, reverse-engineer or get around the limits of NeuraTalk, except where the law allows;</li>
            <li>resell NeuraTalk without a written partner agreement with us.</li>
          </ul>
          <p>
            The full rules are in our <Link href="/community-guidelines">Community Guidelines</Link>, which are part of these terms. Anyone can report
            misuse at <Link href="/report-abuse">Report Abuse</Link> or by long-pressing a message or chat in the app.
          </p>

          <h2>11. Businesses</h2>
          <ul>
            <li>Businesses also agree to the <Link href="/business-terms">NeuraTalk Business Terms</Link>, the <Link href="/business-messaging-policy">Business
              Messaging Policy</Link> (templates, consent, SMS and ads) and the <Link href="/commerce-policy">Commerce Policy</Link> (what may be sold).</li>
            <li>The verified tick is given after our review, can be removed, and isn't an endorsement. See the <Link href="/verified-badge-policy">Verified
              Business Badge</Link> policy.</li>
            <li>Customers can block a business or switch off its offers at any time, and businesses must respect that.</li>
            <li>For its customers' data, a business decides how it's used and is responsible under data protection law; we process it on the
              business's behalf.</li>
            <li>A business is responsible for its team, its partner (if a NeuraTalk partner manages its account), its API keys and its AI receptionist.</li>
          </ul>

          <h2>12. When things go wrong</h2>
          <p>
            We work hard to keep NeuraTalk running and improving, but we can't promise it will always be available, error-free, or offer every
            language or feature. We may add, change or remove features. Service levels apply only where we've agreed them in writing with a business.
          </p>
          <p>
            To the extent the law allows, NeuraTalk is provided "as is". We're not responsible for translation or AI mistakes, for what other
            users or businesses say, sell or do, for payments between users, or for problems with your device, network or other services. We're
            not liable for indirect or consequential losses. Our total liability for any claim is limited to the greater of what you paid us in
            the 12 months before the claim and ₹5,000. None of this limits liability that the law doesn't allow us to limit, including for fraud
            or gross negligence, or your rights under the Consumer Protection Act, 2019.
          </p>
          <p>
            If you use NeuraTalk in breach of these terms or the law and someone makes a claim against us because of it, you agree to cover the
            reasonable costs and losses that result.
          </p>

          <h2>13. Suspending or closing accounts</h2>
          <ul>
            <li>You can delete your account any time from the app (More → Privacy → Delete my account). See <Link href="/account-deletion">Account Deletion</Link>.</li>
            <li>We may limit, suspend or close an account, remove content, or switch off features such as payments, the AI assistant or business
              messaging if these terms or the law are broken, to protect other people, or when the law requires it. Where it's safe and lawful
              we'll tell you why and how to appeal.</li>
          </ul>

          <h2>14. Changes to these terms</h2>
          <p>
            We'll update these terms as NeuraTalk changes. For changes that matter, we'll tell you in the app or by email before they apply. If you
            keep using NeuraTalk after that, the new terms apply; if you don't agree, you can delete your account.
          </p>

          <h2>15. Disputes and grievances</h2>
          <ul>
            <li>These terms are governed by the laws of India.</li>
            <li>Please talk to us first — most problems are solved quickly. If a dispute isn't resolved within 30 days, it will go to arbitration in
              Guntur, Andhra Pradesh, under the Arbitration and Conciliation Act, 1996, in English — unless the law gives you the right to go to a
              consumer commission.</li>
            <li>Grievance Officer: write to {COMPANY.email} with "Grievance" in the subject. We acknowledge within 24 hours and aim to resolve within
              15 days, as the Information Technology Rules, 2021 require. Details are on the <Link href="/grievance">Grievance</Link> page.</li>
          </ul>

          <h2>16. The rest</h2>
          <p>
            These terms, the <Link href="/privacy">Privacy Policy</Link> and the policies linked above are the whole agreement between us about
            NeuraTalk. If one part can't be enforced, the rest still applies. If we don't enforce something straight away, we haven't given up the
            right to. You can't transfer these terms; we may transfer them to a company that takes over NeuraTalk, and we'll tell you if we do.
          </p>

          <h2>17. Contact us</h2>
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
