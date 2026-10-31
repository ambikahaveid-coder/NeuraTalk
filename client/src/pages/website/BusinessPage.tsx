import { motion } from "framer-motion";
import {
  BadgeCheck, BarChart3, Ban, Bolt, Clock, Code2, ClipboardList, KeyRound, Languages, Megaphone,
  MessageSquare, PhoneCall, QrCode, ShoppingBag, Store, Tags, Truck, Users,
} from "lucide-react";
import { COMPANY } from "./site-facts";
import {
  BusinessInbox, BusinessProfile, ClosingBanner, DetailGrid, OrderChat, PAPER, PageHero, PrimaryAction,
  SectionTitle, Story, reveal,
} from "./site-ui";

const FEATURES = [
  { icon: Store, title: "Business profile", desc: "Logo, name, category, about, address, opening hours and website — shown to every customer who chats with you." },
  { icon: BadgeCheck, title: "Verified tick", desc: "The blue tick appears after the NeuraTalk team has checked your business. Signing up alone never gives a tick." },
  { icon: Clock, title: "Greeting and away messages", desc: "Welcome new customers automatically and reply when you're closed, based on your business hours." },
  { icon: Bolt, title: "Quick replies and labels", desc: "Type / to send a saved answer. Label chats like New order or Paid to keep track." },
  { icon: QrCode, title: "Chat link and QR code", desc: "Print your QR at the counter or share your link. Anyone who opens it lands in a chat with you." },
  { icon: PhoneCall, title: "Translated calls", desc: "Customers can call your team from the chat. Each side speaks and hears their own language." },
  { icon: ClipboardList, title: "Forms in chat", desc: "Send a short form for bookings or feedback. Answers are collected in one list you can download." },
  { icon: BarChart3, title: "Statistics", desc: "Messages sent, delivered, read and received over the last 30 days." },
  { icon: Users, title: "Your team", desc: "Add team members with roles. A campaign can need a second person's approval before it goes out." },
];

const MESSAGE_TYPES = [
  { icon: MessageSquare, name: "Chat", example: "Yes, the blue saree is in stock.", rules: "Your team writes freely. You can start a chat with a customer by their mobile number; they can block you at any time." },
  { icon: Truck, name: "Utility updates", example: "Hi Ravi, your order is ready for pickup.", rules: "Sent from a utility template that NeuraTalk has approved, only to customers who agreed to receive updates. No offers allowed." },
  { icon: KeyRound, name: "Login codes (OTP)", example: "Your Kiran Store code is 482913.", rules: "Delivered inside the customer's NeuraTalk app, shown only to them, and never stored in readable form after it is used." },
  { icon: Megaphone, name: "Offers (marketing)", example: "Festival sale: 20% off this weekend.", rules: "Needs an approved marketing template and the customer's opt-in. Daily limits apply, and customers can switch offers off per business." },
];

export default function BusinessPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHero
        eyebrow="NeuraTalk Business"
        testId="text-business-title"
        title={<>Your customers write in their language. <span className="text-primary">You read it in yours.</span></>}
        body="The NeuraTalk Business app gives your shop, clinic or company a profile, a team inbox, a catalog and translated calls — all inside NeuraTalk, without any other messaging service."
        actions={<>
          <PrimaryAction href="/contact" testId="button-business-contact">Get NeuraTalk Business</PrimaryAction>
          <PrimaryAction href="/business-messaging-policy" variant="outline">Business messaging rules</PrimaryAction>
        </>}
        visual={<BusinessProfile />}
      />

      {/* Steps */}
      <section className="px-4 py-20 md:py-28">
        <div className="mx-auto max-w-6xl">
          <SectionTitle title="Up and running in minutes" body="Use a number for your business, separate from your personal NeuraTalk — just like other business messaging apps." />
          <div className="mt-14 grid gap-10 md:grid-cols-3">
            {[
              { title: "Sign in with your business number", desc: "Open the NeuraTalk Business app and verify the number with a one-time code." },
              { title: "Create your profile", desc: "Business name, category, logo and a few words about you. You can chat with customers straight away." },
              { title: "Let customers find you", desc: "They search your name in NeuraTalk, open your link or scan your QR code — or you message them first." },
            ].map((s, i) => (
              <motion.div key={s.title} {...reveal} transition={{ ...reveal.transition, delay: i * 0.08 }} className="border-t pt-6">
                <p className="text-5xl font-semibold text-primary/30">{i + 1}</p>
                <h3 className="mt-4 text-xl font-semibold">{s.title}</h3>
                <p className="mt-2 leading-relaxed text-muted-foreground">{s.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <Story
        paper
        title="One inbox for the whole team"
        body="Every customer chat in one place, on the NeuraTalk Business app and the web. Take a chat, assign it, search, and see when it was delivered and read. Customers write in their language; your team reads it in theirs."
        visual={<BusinessInbox />}
      >
        <div className="mt-6 flex flex-wrap gap-2 text-sm">
          {[[Languages, "Translated both ways"], [Tags, "Labels"], [Bolt, "Quick replies"]].map(([I, l]) => {
            const Icon = I as typeof Tags;
            return <span key={l as string} className="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1.5"><Icon className="h-4 w-4 text-primary" />{l as string}</span>;
          })}
        </div>
      </Story>

      <Story
        flip
        title="Show your catalog. Take the order in the chat."
        body="Products and services with photos and prices. Customers open your catalog inside the chat, ask about any item and order. Each step of the order — accepted, ready, delivered — appears in the chat, in their language."
        visual={<OrderChat />}
      >
        <div className="mt-6 flex flex-wrap gap-2 text-sm">
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1.5"><ShoppingBag className="h-4 w-4 text-primary" />Catalog</span>
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1.5"><Truck className="h-4 w-4 text-primary" />Order updates</span>
        </div>
      </Story>

      <section className={`px-4 py-20 md:py-28 ${PAPER}`}>
        <div className="mx-auto max-w-6xl">
          <SectionTitle title="Everything a business needs to talk to customers" />
          <DetailGrid items={FEATURES} />
        </div>
      </section>

      {/* Message types */}
      <section className="px-4 py-20 md:py-28">
        <div className="mx-auto max-w-6xl">
          <SectionTitle
            title="Four kinds of messages, four sets of rules"
            body={'Updates, codes and offers are kept apart, each with its own template, consent and limits. NeuraTalk reviews every template before it can be sent, and rejects an "update" that is really an offer.'}
          />
          <div className="mt-14 grid gap-px overflow-hidden rounded-3xl border bg-border md:grid-cols-2">
            {MESSAGE_TYPES.map((m) => (
              <motion.div key={m.name} {...reveal} className="bg-background p-7 md:p-9">
                <div className="flex items-center gap-2.5"><m.icon className="h-5 w-5 text-primary" /><h3 className="text-lg font-semibold">{m.name}</h3></div>
                <p className="mt-4 w-fit max-w-full rounded-2xl rounded-bl-md bg-muted/70 px-4 py-2.5 text-[15px]">“{m.example}”</p>
                <p className="mt-4 leading-relaxed text-muted-foreground">{m.rules}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Control and facts */}
      <section className={`px-4 py-20 md:py-24 ${PAPER}`}>
        <div className="mx-auto grid max-w-6xl gap-12 md:grid-cols-2">
          {[
            { icon: Ban, title: "Customers stay in control", items: [
              "They can block any business; nothing it sends reaches them until they unblock it.",
              "They can switch offers off for one business and still get order updates and codes.",
              "A business sees the customer's name and profile photo — never their other chats.",
            ] },
            { icon: Code2, title: "Good to know", items: [
              "Messages are delivered inside NeuraTalk. Customers need the NeuraTalk app; SMS delivery is not offered.",
              "Updates, login codes and campaigns are paid from the business's prepaid wallet. Chatting with customers is not charged per message, and customers never pay to message a business.",
              "A number that is already someone's personal NeuraTalk stays personal; use a separate number for the business.",
            ] },
          ].map((b) => (
            <motion.div key={b.title} {...reveal}>
              <b.icon className="h-7 w-7 text-primary" />
              <h3 className="mt-4 text-2xl font-semibold">{b.title}</h3>
              <ul className="mt-5 space-y-4">
                {b.items.map((t) => <li key={t} className="border-l-2 border-primary/30 pl-4 leading-relaxed text-muted-foreground">{t}</li>)}
              </ul>
            </motion.div>
          ))}
        </div>
      </section>

      <ClosingBanner title="Bring your business to NeuraTalk" body="Tell us about your business and we'll get you the NeuraTalk Business app and set up your wallet.">
        <PrimaryAction href="/contact" variant="outline">Talk to us</PrimaryAction>
        <a href={`mailto:${COMPANY.email}?subject=NeuraTalk%20Business`} className="inline-flex h-12 items-center justify-center rounded-full border border-primary-foreground/40 px-7 text-base hover:bg-primary-foreground/10">{COMPANY.email}</a>
      </ClosingBanner>
    </div>
  );
}
