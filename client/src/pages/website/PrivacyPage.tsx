import { Link } from "wouter";
import { COMPANY, POLICIES_UPDATED, PROCESSORS, CALL_TEXT_RETENTION_DAYS } from "./site-facts";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-6">Privacy Policy</h1>
          <p className="text-muted-foreground">Last updated: {POLICIES_UPDATED}</p>
          <p className="text-sm text-muted-foreground mt-2">Written to meet India's Digital Personal Data Protection Act, 2023 and the IT Act, 2000</p>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto prose prose-neutral dark:prose-invert">
          <p className="lead">
            NeuraTalk is run by {COMPANY.legalName} ("we"). We are the data fiduciary for the personal data described here. This policy
            explains, in plain words, what we collect, why, who helps us process it, how long we keep it, and the choices you have.
          </p>

          <h2>1. The short version</h2>
          <ul>
            <li>We never record the audio of your calls.</li>
            <li>The translated text of a call is kept in your call history for {CALL_TEXT_RETENTION_DAYS} days, then deleted.</li>
            <li>Chats are kept so you can read them on your devices, until you delete them or your account.</li>
            <li>Your cloned voice speaks only your own words, and you can delete it any time.</li>
            <li>We do not sell your data and do not use your calls or messages to train our own AI models.</li>
            <li>You can download your data and delete your account from the app (More → Privacy).</li>
          </ul>

          <h2>2. What we collect</h2>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr><th className="border p-2 text-left">Data</th><th className="border p-2 text-left">What exactly</th></tr>
            </thead>
            <tbody>
              <tr><td className="border p-2">Account</td><td className="border p-2">Mobile number, name, profile photo, preferred language, app settings.</td></tr>
              <tr><td className="border p-2">Calls</td><td className="border p-2">Who called whom, when and for how long; the text of what was said and its translation (call audio is not stored).</td></tr>
              <tr><td className="border p-2">Chats</td><td className="border p-2">Messages, their translations, and photos, videos, documents, voice messages, locations, polls and votes, contact cards and stickers you choose to send; reactions; which messages you starred.</td></tr>
              <tr><td className="border p-2">Your voice</td><td className="border p-2">Voice samples you record, or speech from your calls if you allow NeuraTalk to learn your voice, and the cloned voice made from them.</td></tr>
              <tr><td className="border p-2">Contacts</td><td className="border p-2">If you allow it, numbers from your address book are checked against NeuraTalk to show who uses it. They are not stored on our servers; names are read on your phone only.</td></tr>
              <tr><td className="border p-2">Businesses you talk to</td><td className="border p-2">Your chats with businesses, which updates and offers you agreed to, and whether you blocked a business. A business may also add your number to its customer list (for example from its own records); it must have your permission to send you offers, and you can stop them with STOP or by blocking it.</td></tr>
              <tr><td className="border p-2">Privacy and security settings</td><td className="border p-2">Your last-seen and read-receipt choices, and — if you turn on two-step verification — your PIN, stored only as a salted hash we cannot read back.</td></tr>
              <tr><td className="border p-2">Payments and usage</td><td className="border p-2">Your plan, wallet balance, minutes used and invoices. Card details are handled by our payment partner, not by us.</td></tr>
              <tr><td className="border p-2">Device and security</td><td className="border p-2">Device type, app version, notification token, IP address, sign-in sessions and error logs.</td></tr>
            </tbody>
          </table>

          <h2>3. Why we use it</h2>
          <ul>
            <li>To make calls and chats work: connect people, translate speech and text, speak translations in your voice, show captions and deliver messages and notifications.</li>
            <li>To run NeuraTalk Business: show your name and photo to businesses you chat with, deliver the updates, codes and offers you agreed to, and stop those you blocked or switched off.</li>
            <li>To bill you correctly and keep track of minutes and messages.</li>
            <li>To keep accounts safe: sign-in, fraud and abuse prevention, and fixing problems.</li>
            <li>To meet legal obligations, such as tax records and lawful requests from authorities.</li>
          </ul>
          <p>
            We rely on your consent (which you give when you sign up and when you switch features like voice learning on), on what is
            needed to provide the service you asked for, and on legal obligations. You can withdraw consent at any time; some features will
            then stop working.
          </p>

          <h2>4. Who helps us process your data</h2>
          <p>We use these service providers only to run NeuraTalk, under contracts that limit what they may do with your data:</p>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr><th className="border p-2 text-left">Provider</th><th className="border p-2 text-left">What for</th><th className="border p-2 text-left">Where</th></tr>
            </thead>
            <tbody>
              {PROCESSORS.map((p) => (
                <tr key={p.name}><td className="border p-2">{p.name}</td><td className="border p-2">{p.purpose}</td><td className="border p-2">{p.location}</td></tr>
              ))}
            </tbody>
          </table>
          <p>
            Some of these providers are outside India. We transfer data only to countries not restricted by the Government of India under the
            DPDP Act, and only what each provider needs. Businesses you chat with see your name, profile photo and number, and the messages
            you send them — never your other chats.
          </p>

          <h2>5. How long we keep it</h2>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr><th className="border p-2 text-left">Data</th><th className="border p-2 text-left">Kept for</th></tr>
            </thead>
            <tbody>
              <tr><td className="border p-2">Call audio</td><td className="border p-2">Not stored</td></tr>
              <tr><td className="border p-2">Call history and translated call text</td><td className="border p-2">{CALL_TEXT_RETENTION_DAYS} days</td></tr>
              <tr><td className="border p-2">Chats and files</td><td className="border p-2">Until you delete them or your account (disappearing messages: until their timer ends)</td></tr>
              <tr><td className="border p-2">View-once photos and videos</td><td className="border p-2">In a 1:1 chat, deleted from our storage as soon as they are opened; in a group, kept until the sender deletes the message, and each member can open it once</td></tr>
              <tr><td className="border p-2">Starred messages, stickers, privacy settings</td><td className="border p-2">Until you remove them or delete your account</td></tr>
              <tr><td className="border p-2">Voice samples and cloned voice</td><td className="border p-2">Until you delete your voice or your account</td></tr>
              <tr><td className="border p-2">Login codes from businesses</td><td className="border p-2">The readable code is erased as soon as it is used, expires or is replaced</td></tr>
              <tr><td className="border p-2">Billing records</td><td className="border p-2">As long as tax and accounting law requires (typically 8 years)</td></tr>
              <tr><td className="border p-2">Security logs</td><td className="border p-2">Only as long as needed to keep accounts safe and investigate abuse</td></tr>
            </tbody>
          </table>

          <h2>6. Your rights</h2>
          <ul>
            <li><strong>See and download your data</strong> — More → Privacy → Download my data.</li>
            <li><strong>Correct it</strong> — edit your profile in the app, or write to us.</li>
            <li><strong>Delete it</strong> — delete chats, your voice, or your whole account (More → Privacy → Delete my account). Messages you already sent stay with the people who received them.</li>
            <li><strong>Withdraw consent</strong> — switch off voice learning, offers from a business, or notifications at any time.</li>
            <li><strong>Nominate</strong> someone to exercise these rights if you die or become unable to, by writing to us.</li>
            <li><strong>Complain</strong> — to our Grievance Officer (below), and if you are not satisfied, to the Data Protection Board of India.</li>
          </ul>

          <h2>7. Security</h2>
          <p>
            Calls, messages and files travel over encrypted connections. Translation needs our servers to process speech and text, so calls
            are not end-to-end encrypted. Files you send can only be opened by the people in that conversation. Login codes from businesses are
            stored encrypted. Access to production data is limited to staff who need it. If a breach affects your data, we will inform you and
            the Data Protection Board as the law requires.
          </p>

          <h2>7a. Things that stay on your phone</h2>
          <ul>
            <li>The secret code for <strong>locked chats</strong> and the list of chats you locked are kept only in your phone's encrypted storage. We never receive them.</li>
            <li>Names from your address book are read on your phone only.</li>
            <li>When you export a chat, the file is created on your phone and goes only where you choose to share it.</li>
          </ul>

          <h2>8. Children</h2>
          <p>NeuraTalk is for people aged 18 and over. We do not knowingly collect data from children; if you think a child is using NeuraTalk, contact us and we will remove the account. See our <Link href="/age-policy">Age Policy</Link>.</p>

          <h2>9. Changes</h2>
          <p>If we change this policy in a way that matters, we will tell you in the app or by email before the change applies.</p>

          <h2>10. Contact and Grievance Officer</h2>
          <div className="bg-muted p-4 rounded-lg not-prose text-sm space-y-1">
            <p className="font-semibold">Grievance Officer, {COMPANY.legalName}</p>
            <p>{COMPANY.address}</p>
            <p>Email: {COMPANY.email} (subject "Privacy" or "Grievance") · Phone: {COMPANY.phone}</p>
            <p>We acknowledge within 24 hours and aim to resolve within 15 days.</p>
          </div>
          <p className="text-sm">See also: <Link href="/terms">Terms of Service</Link> · <Link href="/data-retention">Data Retention</Link> · <Link href="/cookie-policy">Cookie Policy</Link></p>
        </div>
      </section>
    </div>
  );
}
