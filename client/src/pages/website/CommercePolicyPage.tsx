import { Link } from "wouter";
import { LegalPage } from "./LegalPage";
import { POLICIES_UPDATED } from "./site-facts";

/** What businesses may sell or advertise through catalogs, orders, status and broadcasts. */
export default function CommercePolicyPage() {
  return (
    <LegalPage title="Commerce Policy" updated={POLICIES_UPDATED} audience="For businesses that show products, take orders or advertise on NeuraTalk">
      <p>
        NeuraTalk Business lets you show a catalog, take orders in chat, post status updates and send offers. This policy lists what you may not
        sell, offer or advertise in any of these places, including in chats with customers. It works together with
        the <Link href="/business-messaging-policy">Business Messaging Policy</Link>, the <Link href="/community-guidelines">Community Guidelines</Link> and
        the <Link href="/business-terms">Business Terms</Link>. If a product is legal only with a licence, you must hold that licence and show
        it to us on request.
      </p>

      <h2>1. Never allowed</h2>
      <ul>
        <li><strong>Weapons:</strong> firearms, ammunition, explosives, parts that make a weapon work, and prohibited knives.</li>
        <li><strong>Drugs:</strong> narcotic and psychotropic substances, anything sold as a "legal high", and drug paraphernalia.</li>
        <li><strong>Prescription medicines</strong> and medical devices that need a prescription, unless you are a licensed pharmacy following
          Indian e-pharmacy rules — and never "cures" for serious illnesses.</li>
        <li><strong>Tobacco and e-cigarettes:</strong> cigarettes, gutka and other tobacco products; e-cigarettes and vapes (banned in India).</li>
        <li><strong>Alcohol</strong>, except by businesses licensed to sell it where they operate, never to anyone under the legal age, and never
          as a "free" add-on.</li>
        <li><strong>Gambling, betting and lotteries</strong>, including fantasy or "colour prediction" schemes that are illegal where your customer is.</li>
        <li><strong>Financial schemes:</strong> chit funds or deposit schemes without registration, guaranteed returns, pyramid or multi-level schemes,
          cryptocurrency "investment plans", loan offers by anyone not registered with the RBI.</li>
        <li><strong>Fake and stolen goods:</strong> counterfeits and replicas of branded products, stolen goods, and pirated software, films or music.</li>
        <li><strong>Documents and identities:</strong> fake certificates, degrees, IDs, government documents, reviews or followers; SIM cards or bank
          accounts registered in someone else's name.</li>
        <li><strong>People, animals and body parts:</strong> human organs or remains, wildlife protected by law and products made from them
          (ivory, skins, horns).</li>
        <li><strong>Adult content and services</strong>, and dating or escort services.</li>
        <li><strong>Hazardous materials</strong> that are not allowed to be sold to the public.</li>
        <li><strong>Spyware</strong> and tools for getting into other people's phones or accounts.</li>
        <li>Anything else that is illegal where you or your customer are.</li>
      </ul>

      <h2>2. Allowed with care</h2>
      <ul>
        <li><strong>Health and wellness products</strong> (supplements, Ayurvedic products, cosmetics): no claims that they cure, treat or prevent
          disease unless approved by the regulator.</li>
        <li><strong>Financial services</strong> by registered banks, NBFCs, insurers and brokers: show your registration and the real costs and risks.</li>
        <li><strong>Age-restricted products:</strong> check age where the law requires it.</li>
        <li><strong>Political and social issue content:</strong> you must say clearly who is paying for it, and follow election rules about advertising.</li>
      </ul>

      <h2>3. Being honest with buyers</h2>
      <ul>
        <li>Prices, discounts, delivery times and stock must be true. Show the full price in rupees, including taxes and delivery, before
          the customer confirms an order.</li>
        <li>State your return, refund and cancellation terms clearly, and follow the Consumer Protection (E-Commerce) Rules, 2020.</li>
        <li>Product photos must show the real product.</li>
        <li>Never ask a customer to share an OTP, PIN or card details in chat. NeuraTalk does not handle your payments; if you take payment,
          use a regulated payment provider.</li>
      </ul>

      <h2>4. Orders in chat</h2>
      <p>
        An order placed through NeuraTalk is a contract between you and your customer. NeuraTalk shows the items, quantities and total you set,
        and the status updates you send, but is not a party to the sale, does not collect money for it, and is not responsible for delivery,
        quality or refunds. You must answer customer complaints about your orders.
      </p>

      <h2>5. Enforcement</h2>
      <ul>
        <li>We may remove an item, a collection, a status post or a template, turn off your catalog or orders, remove the verified tick, or
          suspend the business account.</li>
        <li>Serious breaches — such as weapons, drugs, child safety or fraud — lead to an immediate ban and may be reported to the authorities.</li>
        <li>You can appeal by writing to us within 30 days.</li>
      </ul>
    </LegalPage>
  );
}
