import { Link } from "wouter";
import { COMPANY, LEGAL_UPDATED } from "./site-facts";

/**
 * Rules for businesses that message customers on NeuraTalk. Mirrors what the
 * product enforces: NeuraTalk-reviewed templates, separate categories with
 * their own consent, marketing caps, in-app OTP, customer blocking, the
 * verified tick and the daily cap on new business-started chats.
 */
export default function BusinessMessagingPolicyPage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-4">Business Messaging Policy</h1>
          <p className="text-muted-foreground">Last updated: {LEGAL_UPDATED}</p>
          <p className="text-sm text-muted-foreground mt-2">For every business that uses NeuraTalk Business or the NeuraTalk business API</p>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto prose prose-neutral dark:prose-invert">
          <p>
            Customers trust NeuraTalk because the messages they get are wanted, honest and easy to stop. This policy explains what a
            business may send, what it needs before sending, and what happens when the rules are broken. It is part of
            our <Link href="/terms">Terms of Service</Link>.
          </p>

          <h2>1. Your business identity</h2>
          <ul>
            <li>Use a mobile number for your business that is not someone's personal NeuraTalk account.</li>
            <li>Your business name, logo, category, address and description must be accurate and must not imitate another brand,
              person or government body.</li>
            <li><strong>The verified tick</strong> means the NeuraTalk team has checked that the business is what it says it is. It is
              given only after review, can be removed at any time, and is not an endorsement of your products.</li>
            <li>You are responsible for everyone you add to your team and for every message sent from your account or with your API keys.</li>
          </ul>

          <h2>2. The four kinds of messages</h2>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr><th className="border p-2 text-left">Kind</th><th className="border p-2 text-left">What it is for</th><th className="border p-2 text-left">Not allowed</th></tr>
            </thead>
            <tbody>
              <tr><td className="border p-2">Chat</td><td className="border p-2">Two-way conversation with a customer: questions, support, orders.</td><td className="border p-2">Bulk or copy-paste promotions to people who never contacted you.</td></tr>
              <tr><td className="border p-2">Utility</td><td className="border p-2">Updates about something the customer started: order, booking, payment, delivery, appointment, account.</td><td className="border p-2">Offers, discounts, upsell, "you may also like", or any promotional line.</td></tr>
              <tr><td className="border p-2">Authentication (OTP)</td><td className="border p-2">A one-time code to sign in or confirm an action.</td><td className="border p-2">Anything other than the code and its purpose; links; asking the customer to share the code.</td></tr>
              <tr><td className="border p-2">Marketing</td><td className="border p-2">Offers, new products, events, newsletters.</td><td className="border p-2">Sending without the customer's opt-in, or after they switched offers off.</td></tr>
            </tbody>
          </table>

          <h2>3. Templates are reviewed by NeuraTalk</h2>
          <ul>
            <li>Utility, authentication and marketing messages are sent only from templates. Every template version is reviewed by the
              NeuraTalk team before it can be used — your own team cannot approve its own templates.</li>
            <li>We check that the template's category matches its content, that it is clear about who is writing, and that it follows
              this policy and the law. A "utility" template that contains an offer is rejected, with the reason shown to you.</li>
            <li>An approved template cannot be edited. Changes create a new version that is reviewed again.</li>
            <li>A campaign can only use a template of its own category; a marketing message can never be sent as a utility update.</li>
          </ul>

          <h2>4. Consent</h2>
          <ul>
            <li>Send utility updates only to customers who gave you their number for that purpose and agreed to receive updates.</li>
            <li>Send marketing only to customers who opted in to offers from you. Keep a record of how and when they agreed.</li>
            <li>Never buy, rent or scrape phone numbers or contact lists.</li>
            <li>When a customer switches offers off, blocks you, or asks you to stop, stop. NeuraTalk enforces offers-off and blocking
              automatically; requests made in chat are your responsibility to respect.</li>
          </ul>

          <h2>5. Starting a chat with a customer</h2>
          <ul>
            <li>You may message a customer first only if they gave you their number and would expect to hear from you.</li>
            <li>New business-started chats are limited per business per day. The limit protects customers and may be lowered for
              accounts that customers block or report.</li>
            <li>If the number is not on NeuraTalk yet, the message waits until they join. NeuraTalk does not send SMS.</li>
          </ul>

          <h2>6. Marketing limits</h2>
          <p>
            Marketing messages are capped per customer per day and per business. Messages over the cap are not sent and not charged.
          </p>

          <h2>7. Content that is never allowed</h2>
          <ul>
            <li>Anything illegal in India or in the customer's country, including counterfeit goods, drugs, weapons and explosives.</li>
            <li>Gambling, betting and lotteries; adult content; fake documents, reviews or followers.</li>
            <li>Loans, investments or "guaranteed returns" offers that are misleading or not permitted by Indian regulators.</li>
            <li>Health claims that promise cures or replace medical advice.</li>
            <li>Phishing, impersonation, threats, hate or harassment, and messages that ask for passwords, card numbers or OTPs.</li>
          </ul>

          <h2>8. Customer data</h2>
          <ul>
            <li>You see a customer's name, profile photo and number when they chat with you. Use this only to serve that customer.</li>
            <li>For the customer data you hold, you decide why and how it is used, and you are responsible for following the Digital
              Personal Data Protection Act, 2023 and other applicable laws. NeuraTalk processes that data on your behalf to deliver your messages.</li>
            <li>Honour customers' requests to correct or delete their data and to stop messages.</li>
          </ul>

          <h2>9. Charges</h2>
          <p>
            Utility updates, login codes and campaign messages are paid from your prepaid business wallet at the rates shown in your
            business dashboard. A message that is not sent (no consent, blocked, over a limit, not on NeuraTalk) is not charged. Chatting
            with customers is not charged per message.
          </p>

          <h2>10. Enforcement</h2>
          <p>Depending on how serious a breach is, we may — without prior notice where customers are at risk:</p>
          <ul>
            <li>reject templates or switch off campaigns;</li>
            <li>lower your messaging limits;</li>
            <li>remove the verified tick;</li>
            <li>suspend or close the business account, and report unlawful activity to the authorities.</li>
          </ul>
          <p>
            Customers can block a business in the app and report it at <Link href="/report-abuse">Report Abuse</Link>. If you think we got a decision
            wrong, write to {COMPANY.email} with your business name and the details.
          </p>

          <h2>11. Changes</h2>
          <p>We may update this policy as the product and the law change. We will tell you about material changes before they apply.</p>

          <div className="bg-muted p-4 rounded-lg not-prose text-sm">
            <p className="font-semibold mb-1">{COMPANY.legalName}</p>
            <p>{COMPANY.address}</p>
            <p>CIN {COMPANY.cin} · {COMPANY.email}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
