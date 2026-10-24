import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRight, BadgeCheck, BarChart3, Ban, Bolt, Clock, Code2, KeyRound, Languages, Megaphone,
  MessageSquare, PhoneCall, QrCode, ShoppingBag, Store, Tags, Truck, Users,
} from "lucide-react";
import { COMPANY } from "./site-facts";

const FEATURES = [
  { icon: MessageSquare, title: "Team inbox", desc: "Every customer chat in one place, on the NeuraTalk Business app and the web. Take a chat, assign it, search, and see when it was delivered and read." },
  { icon: Languages, title: "Their language, yours", desc: "Customers write in their language; your team reads it in theirs, and replies the same way. Tap any message to see the original." },
  { icon: Store, title: "Business profile", desc: "Logo, name, category, about, address, opening hours and website — shown to every customer who chats with you." },
  { icon: BadgeCheck, title: "Verified tick", desc: "The blue tick appears after the NeuraTalk team has checked your business. Signing up alone never gives a tick." },
  { icon: ShoppingBag, title: "Catalog", desc: "Products and services with photos and prices. Customers open it inside your chat and ask about any item." },
  { icon: Clock, title: "Greeting and away messages", desc: "Welcome new customers automatically and reply when you're closed, based on your business hours." },
  { icon: Bolt, title: "Quick replies and labels", desc: "Type / to send a saved answer. Label chats like New order or Paid to keep track." },
  { icon: QrCode, title: "Chat link and QR code", desc: "Print your QR at the counter or share your link. Anyone who opens it lands in a chat with you." },
  { icon: PhoneCall, title: "Translated calls", desc: "Customers can call your team from the chat. Each side speaks and hears their own language." },
  { icon: BarChart3, title: "Statistics", desc: "Messages sent, delivered, read and received over the last 30 days." },
  { icon: Users, title: "Your team", desc: "Add team members with roles. A campaign can need a second person's approval before it goes out." },
  { icon: Code2, title: "Developer API", desc: "Send order updates and login codes from your own systems with an API key." },
];

const MESSAGE_TYPES = [
  {
    icon: MessageSquare,
    name: "Chat",
    example: "\"Yes, the blue saree is in stock.\"",
    rules: "Your team writes freely. You can start a chat with a customer by their mobile number; they can block you at any time.",
  },
  {
    icon: Truck,
    name: "Utility updates",
    example: "\"Hi Ravi, your order is ready for pickup.\"",
    rules: "Sent from a utility template that NeuraTalk has approved, only to customers who agreed to receive updates. No offers allowed.",
  },
  {
    icon: KeyRound,
    name: "Login codes (OTP)",
    example: "\"Your Kiran Store code is 482913.\"",
    rules: "Delivered inside the customer's NeuraTalk app, shown only to them, and never stored in readable form after it is used.",
  },
  {
    icon: Megaphone,
    name: "Offers (marketing)",
    example: "\"Festival sale: 20% off this weekend.\"",
    rules: "Needs an approved marketing template and the customer's opt-in. Daily limits apply, and customers can switch offers off per business.",
  },
];

export default function BusinessPage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 md:py-24 px-4 bg-gradient-to-b from-primary/5 to-background">
        <div className="max-w-4xl mx-auto text-center">
          <Badge variant="outline" className="mb-4"><Store className="w-3.5 h-3.5 mr-1.5" />NeuraTalk Business</Badge>
          <h1 className="text-4xl md:text-5xl font-bold mb-5 tracking-tight" data-testid="text-business-title">
            Your customers write in their language.
            <span className="block text-primary">You read it in yours.</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            The NeuraTalk Business app gives your shop, clinic or company a profile, a team inbox, a catalog and translated calls —
            all inside NeuraTalk, without any other messaging service.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/contact"><Button size="lg" data-testid="button-business-contact">Get NeuraTalk Business <ArrowRight className="ml-2 w-5 h-5" /></Button></Link>
            <Link href="/business-messaging-policy"><Button size="lg" variant="outline">Business messaging rules</Button></Link>
          </div>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-3">Up and running in minutes</h2>
          <p className="text-center text-muted-foreground mb-10">Use a number for your business, separate from your personal NeuraTalk — just like other business messaging apps.</p>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { step: "1", title: "Sign in with your business number", desc: "Open the NeuraTalk Business app and verify the number with a one-time code." },
              { step: "2", title: "Create your profile", desc: "Business name, category, logo and a few words about you. You can chat with customers straight away." },
              { step: "3", title: "Let customers find you", desc: "They search your name in NeuraTalk, open your link or scan your QR code — or you message them first." },
            ].map((s) => (
              <Card key={s.step}><CardContent className="p-6">
                <span className="w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center mb-4">{s.step}</span>
                <h3 className="font-semibold text-lg mb-2">{s.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{s.desc}</p>
              </CardContent></Card>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 px-4 bg-muted/30">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-10">Everything a business needs to talk to customers</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((f) => (
              <Card key={f.title} className="h-full"><CardContent className="p-6">
                <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center mb-4"><f.icon className="w-5 h-5 text-primary" /></div>
                <h3 className="font-semibold text-lg mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </CardContent></Card>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-3">Four kinds of messages, four sets of rules</h2>
          <p className="text-center text-muted-foreground mb-10 max-w-3xl mx-auto">
            Updates, codes and offers are kept apart, each with its own template, consent and limits. NeuraTalk reviews every template before
            it can be sent, and rejects an "update" that is really an offer.
          </p>
          <div className="grid md:grid-cols-2 gap-6">
            {MESSAGE_TYPES.map((m) => (
              <Card key={m.name} className="h-full"><CardContent className="p-6">
                <div className="flex items-center gap-2 mb-2"><m.icon className="w-5 h-5 text-primary" /><h3 className="font-semibold text-lg">{m.name}</h3></div>
                <p className="text-sm italic text-muted-foreground mb-3">{m.example}</p>
                <p className="text-sm leading-relaxed">{m.rules}</p>
              </CardContent></Card>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 px-4 bg-muted/30">
        <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-8">
          <Card><CardContent className="p-6">
            <div className="flex items-center gap-2 mb-3"><Ban className="w-5 h-5 text-primary" /><h3 className="font-semibold text-lg">Customers stay in control</h3></div>
            <ul className="space-y-2 text-sm text-muted-foreground list-disc pl-5">
              <li>They can block any business; nothing it sends reaches them until they unblock it.</li>
              <li>They can switch offers off for one business and still get order updates and codes.</li>
              <li>A business sees the customer's name and profile photo — never their other chats.</li>
            </ul>
          </CardContent></Card>
          <Card><CardContent className="p-6">
            <div className="flex items-center gap-2 mb-3"><Tags className="w-5 h-5 text-primary" /><h3 className="font-semibold text-lg">Good to know</h3></div>
            <ul className="space-y-2 text-sm text-muted-foreground list-disc pl-5">
              <li>Messages are delivered inside NeuraTalk. Customers need the NeuraTalk app; SMS delivery is not offered.</li>
              <li>Updates, login codes and campaigns are paid from the business's prepaid wallet. Chatting with customers is not charged per message, and customers never pay to message a business.</li>
              <li>A number that is already someone's personal NeuraTalk stays personal; use a separate number for the business.</li>
            </ul>
          </CardContent></Card>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto text-center rounded-3xl bg-primary text-primary-foreground px-6 py-14">
          <h2 className="text-3xl font-bold mb-4">Bring your business to NeuraTalk</h2>
          <p className="text-lg opacity-90 mb-8">Tell us about your business and we'll get you the NeuraTalk Business app and set up your wallet.</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/contact"><Button size="lg" variant="secondary">Talk to us</Button></Link>
            <a href={`mailto:${COMPANY.email}?subject=NeuraTalk%20Business`}><Button size="lg" variant="outline" className="bg-transparent text-primary-foreground border-primary-foreground/40 hover:bg-primary-foreground/10">{COMPANY.email}</Button></a>
          </div>
        </div>
      </section>
    </div>
  );
}
