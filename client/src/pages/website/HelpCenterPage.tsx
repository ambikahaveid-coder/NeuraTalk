import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { COMPANY, LANGUAGE_SUMMARY, CALL_TEXT_RETENTION_DAYS } from "./site-facts";

type Article = { id: string; q: string; a: string };

/** Real answers, searchable on the page — no dead links. */
const SECTIONS: { title: string; articles: Article[] }[] = [
  {
    title: "Getting started",
    articles: [
      { id: "signup", q: "How do I create an account?", a: "Install the NeuraTalk app, enter your mobile number and the 6-digit code we send. Choose your language, and you're ready. New accounts get 15 free translated call minutes." },
      { id: "first-call", q: "How do I make my first translated call?", a: "Open Contacts or search a number, tap the call button and talk. NeuraTalk detects each person's language and translates automatically. The other person needs NeuraTalk too." },
      { id: "languages", q: "Which languages can I use?", a: `${LANGUAGE_SUMMARY}. Any pair works in either direction. Names, numbers and mixed-language sentences are where mistakes are most likely.` },
    ],
  },
  {
    title: "Calls and your voice",
    articles: [
      { id: "voice", q: "How do I set up my own voice?", a: "More → Your voice, then read three short passages aloud (about two minutes). Or allow NeuraTalk to learn your voice from the first half-minute you speak in a call. Until then, people hear your original voice with translated captions." },
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
    ],
  },
  {
    title: "Businesses",
    articles: [
      { id: "find-business", q: "How do I message a business?", a: "Chats → the shop icon at the top, then search the business name, or open its link or QR code. Your chats with businesses appear in your Chats list with their name and logo." },
      { id: "verified", q: "What does the blue tick mean?", a: "The NeuraTalk team has checked that the business is what it says it is. It is not an endorsement of its products." },
      { id: "block-business", q: "How do I stop messages from a business?", a: "Open the chat, tap its name, then Block, or switch off Receive offers to keep only order updates and codes." },
      { id: "start-business", q: "How do I bring my business to NeuraTalk?", a: "Use the NeuraTalk Business app with a number for your business, and create your profile there. See the NeuraTalk Business page or write to us." },
    ],
  },
  {
    title: "Account, billing and privacy",
    articles: [
      { id: "minutes", q: "How are minutes charged?", a: "Translated call time is taken from your plan or wallet as you use it. You can see your balance in More → Account. Same-language calls are not translated." },
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
