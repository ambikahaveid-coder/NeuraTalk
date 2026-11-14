import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { COMPANY, LANGUAGE_SUMMARY, CALL_TEXT_RETENTION_DAYS, CHAT_MESSAGES_PER_AI_MINUTE } from "./site-facts";

type Article = { id: string; q: string; a: string };

/** Real answers, searchable on the page — no dead links. */
const SECTIONS: { title: string; articles: Article[] }[] = [
  {
    title: "Getting started",
    articles: [
      { id: "signup", q: "How do I create an account?", a: "Install the NeuraTalk app, enter your mobile number and the 6-digit code we send. Choose your language, and you're ready. Chats and calls without translation are free. New accounts get 5 free AI translation minutes to try it." },
      { id: "first-call", q: "How do I make my first translated call?", a: "Open Contacts or search a number, tap the call button and talk. NeuraTalk detects each person's language and translates automatically. The other person needs NeuraTalk too." },
      { id: "languages", q: "Which languages can I use?", a: `${LANGUAGE_SUMMARY}. Any pair works in either direction. Names, numbers and mixed-language sentences are where mistakes are most likely.` },
    ],
  },
  {
    title: "Calls and your voice",
    articles: [
      { id: "voice", q: "How do I set up my own voice?", a: "More → Your voice, then read three short passages aloud (about two minutes). Or allow NeuraTalk to learn your voice (one tap) from the first 15 seconds you speak in a call. Until then, people hear your original voice with translated captions." },
      { id: "delete-voice", q: "How do I delete my voice?", a: "More → Your voice → Delete. It is removed from our voice provider too." },
      { id: "closed", q: "Calls don't ring when the app is closed", a: "More → Calls when the app is closed, then allow notifications, full-screen calls and no battery restriction. Some phones also need NeuraTalk added to their 'auto-start' list." },
      { id: "quality", q: "The translation is slow or wrong", a: "Use a quiet place, speak in full sentences and wait a moment for the translation. A stable connection helps. Check that each person's language is set correctly in the call." },
      { id: "in-person", q: "How does in-person mode work?", a: "Home → In person. Place the phone between you; each person speaks their language and hears the other in theirs." },
    ],
  },
  {
    title: "Chats",
    articles: [
      { id: "chat-translate", q: "How does chat translation work?", a: "You write in your language, they read it in theirs. Tap a message to see the original. You can switch translation off for a chat with the Translate switch at the top." },
      { id: "groups", q: "Can I chat with a group?", a: "Yes. Chats → Groups. Everyone writes in their own language and reads every message in theirs." },
      { id: "files", q: "Who can see the photos and files I send?", a: "Only the people in that chat or group." },
      { id: "private-chat", q: "How do I start a Private chat?", a: "Open the chat → menu → Private chat. Messages are encrypted on your phone so only you and the other person can read them; they aren't translated and don't show on the web. Both of you need the latest app. Tap the shield icon to compare security codes." },
      { id: "group-link", q: "How do I invite people with a link?", a: "Group info → Invite via link (admins only). Share the link or QR code. Reset it to make the old link stop working, or turn it off." },
      { id: "join-link", q: "How do I join a group from a link?", a: "Tap the link, or Chats menu → Join group with link and paste it. You'll see the group's name and size before you join." },
      { id: "broadcast", q: "How do broadcast lists work?", a: "Chats menu → Broadcast lists → New list, pick at least 2 people and send. Each person gets it as a normal message from you. Only people who have messaged you or saved your number receive it." },
      { id: "wallpaper", q: "How do I change the chat wallpaper?", a: "For all chats: Chats menu → Wallpaper. For one chat: open it → menu → Wallpaper. Groups: Group info → Wallpaper." },
      { id: "screen-share", q: "How do I share my screen in a call?", a: "In a one-to-one call, tap the screen icon at the top. Android asks your permission each time. Tap it again to stop. Everything on your screen is visible, including notifications." },
    ],
  },
  {
    title: "Your AI assistant",
    articles: [
      { id: "assistant-on", q: "How do I turn on my AI assistant?", a: "More → My AI assistant → Assistant on. The first 7 days are free. Then tap \"I'm busy\" times (30 min, 1 hour…) whenever you can't answer." },
      { id: "assistant-calls", q: "How does the assistant take calls?", a: "If you don't answer within your ring time, or while you're busy, it answers, says it's your AI assistant and takes a message. When a call rings you can also tap \"Let my assistant answer\"." },
      { id: "assistant-messages", q: "Where do I see what the assistant handled?", a: "More → My AI assistant → Messages taken. Urgent ones are marked, and you get a notification for each." },
      { id: "assistant-pay", q: "How do I pay for the assistant?", a: "After the free week, it's ₹99 for 30 days. In My AI assistant tap Pay, pay NeuraTalk's UPI ID and enter the UTR. We confirm it, usually within a working day. It doesn't renew by itself." },
    ],
  },
  {
    title: "Payments",
    articles: [
      { id: "upi-id", q: "How do I add my UPI ID?", a: "Open any chat → menu → Request money; NeuraTalk asks for your UPI ID once. It's shown only to people you chat with." },
      { id: "request-money", q: "How do I ask someone for money?", a: "Chat menu → Request money (UPI), enter the amount. They pay from their UPI app and tap \"I've paid\"; you tap Money received once it's in your bank." },
      { id: "pay-someone", q: "How do I pay someone?", a: "Chat menu → Pay (UPI). Your UPI app opens with their UPI ID; finish the payment there. Never share your UPI PIN or OTP in a chat." },
      { id: "payment-problem", q: "I paid but they say they didn't get it", a: "Check the UTR in your UPI app and share it in the chat. NeuraTalk doesn't move the money, so a failed or disputed payment is handled by your bank." },
    ],
  },
  {
    title: "Businesses",
    articles: [
      { id: "find-business", q: "How do I message a business?", a: "Chats → the shop icon at the top, then search the business name, or open its link or QR code. Your chats with businesses appear in your Chats list with their name and logo." },
      { id: "verified", q: "What does the blue tick mean?", a: "The NeuraTalk team has checked that the business is what it says it is. It is not an endorsement of its products." },
      { id: "block-business", q: "How do I stop messages from a business?", a: "Open the chat, tap its name, then Block, or switch off Receive offers to keep only order updates and codes." },
      { id: "start-business", q: "How do I bring my business to NeuraTalk?", a: "Use the NeuraTalk Business app with a number for your business, and create your profile there. See the NeuraTalk Business page or write to us." },
      { id: "receptionist", q: "How do I set up the AI receptionist?", a: "NeuraTalk Business → Tools → AI receptionist (or Messaging → AI receptionist on the dashboard). Turn it on, add what customers usually ask, and try a question. 14 days free, then ₹999 for 30 days from your wallet." },
      { id: "business-payments", q: "How do I take payments from customers?", a: "Tools → Payments (UPI): add your UPI ID. In a chat, tap ₹ and enter the amount. The customer pays from their UPI app; you tap Money received once it's in your bank." },
      { id: "ads", q: "How do ads work?", a: "Tools → Ads → New ad. NeuraTalk reviews it; then it shows as Sponsored in Business messages. You pay ₹2 per chat started, never more than your daily budget." },
      { id: "sms", q: "Can I reach customers who don't have NeuraTalk?", a: "Tools → SMS for customers without NeuraTalk. They get one SMS with your name and a link to read your message. ₹0.25 per SMS from your wallet; it starts once NeuraTalk's SMS registration is approved." },
    ],
  },
  {
    title: "Account, billing and privacy",
    articles: [
      { id: "minutes", q: "How are minutes charged?", a: `Only AI translation uses minutes. Translated call time is counted while translation runs, and every ${CHAT_MESSAGES_PER_AI_MINUTE} translated chat messages use one minute. Calls and chats without translation are free. You can see your balance in More → Account.` },
      { id: "refund", q: "Can I get a refund?", a: "In the cases listed in our Refund Policy. Write to us with your number and the reason." },
      { id: "stored", q: "Are my calls recorded?", a: `No. Call audio is never stored. The translated text of a call is kept in your call history for ${CALL_TEXT_RETENTION_DAYS} days, then deleted.` },
      { id: "export", q: "How do I download my data?", a: "More → Privacy → Download my data." },
      { id: "delete", q: "How do I delete my account?", a: "More → Privacy → Delete my account. Your number, name, photo and voice are removed and you are signed out everywhere. Messages you already sent stay with the people who received them." },
    ],
  },
];

export default function HelpCenterPage() {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => SECTIONS
      .map((s) => ({ ...s, articles: s.articles.filter((a) => !q || `${a.q} ${a.a}`.toLowerCase().includes(q)) }))
      .filter((s) => s.articles.length > 0),
    [q],
  );

  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-6">Help Center</h1>
          <p className="text-xl text-muted-foreground mb-8">Quick answers about calls, chats, businesses and your account</p>
          <div className="max-w-lg mx-auto relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search help" className="pl-9 h-11" aria-label="Search help" />
          </div>
        </div>
      </section>

      <section className="py-12 px-4">
        <div className="max-w-3xl mx-auto space-y-10">
          {filtered.length === 0 && (
            <p className="text-center text-muted-foreground">Nothing matches "{query}". Try other words, or write to us below.</p>
          )}
          {filtered.map((section) => (
            <div key={section.title}>
              <Badge variant="outline" className="mb-3">{section.title}</Badge>
              <Accordion type="single" collapsible>
                {section.articles.map((a) => (
                  <AccordionItem key={a.id} value={a.id}>
                    <AccordionTrigger className="text-left">{a.q}</AccordionTrigger>
                    <AccordionContent className="text-muted-foreground leading-relaxed">{a.a}</AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          ))}

          <div className="bg-card border rounded-xl p-8 text-center">
            <h2 className="text-2xl font-bold mb-3">Still need help?</h2>
            <p className="text-muted-foreground mb-6">Write to us with your registered number and what happened. We reply on working days.</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <a href={`mailto:${COMPANY.email}`} className="inline-flex items-center justify-center px-5 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">Email support</a>
              <Link href="/contact" className="inline-flex items-center justify-center px-5 py-2.5 border rounded-lg text-sm font-medium hover:bg-muted transition-colors">Contact form</Link>
            </div>
            <p className="text-xs text-muted-foreground mt-4">{COMPANY.email} · {COMPANY.phone}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
