import { Link } from "wouter";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Mail } from "lucide-react";
import { COMPANY, LANGUAGE_SUMMARY, CALL_TEXT_RETENTION_DAYS } from "./site-facts";
import { PageHero } from "./site-ui";

type Faq = { id: string; q: string; a: React.ReactNode };

const GROUPS: { title: string; items: Faq[] }[] = [
  {
    title: "Calls",
    items: [
      { id: "what-is", q: "What is NeuraTalk?", a: "An app for voice and video calls, chats and business messages that are translated while you talk or type. You speak or write in your language; the other person hears or reads it in theirs." },
      { id: "settings", q: "Do I have to choose a language before calling?", a: "You can choose a language before the call. Automatic detection is available for supported languages; detection quality depends on speech and the connection." },
      { id: "own-voice", q: "Will they hear a robot voice?", a: "No. Allow NeuraTalk to learn your voice (one tap, nothing to record) and it learns it from the first 15 seconds you speak in a call; the audio itself is not kept. You can also read three short passages in Settings → Your voice. After that, the other person hears your translated words in your own voice. Until then, the other person hears your original voice and sees translated captions — we never use a robot voice." },
      { id: "captions", q: "Do I need to read anything on screen?", a: "You can choose translated captions or translated speech in call settings. If the other person hasn't recorded their voice yet, captions turn on automatically and you still hear their original voice." },
      { id: "delay", q: "How long is the delay?", a: "Delay varies with language pair, network, microphone and provider. The live call pipeline processes speech, translation and audio as they become available." },
      { id: "noise", q: "What if I'm somewhere noisy?", a: "Noise processing may help. Recognition can still be affected by background noise, device quality and language coverage." },
      { id: "video-calls", q: "Does it work in video calls?", a: "Yes. Video calls are translated the same way as voice calls." },
      { id: "languages", q: "Which languages are supported?", a: `${LANGUAGE_SUMMARY} — any pair, in either direction. Mixed speech like Tenglish or Hinglish usually works, but names and mixed sentences are where mistakes are most likely.` },
      { id: "group-calls", q: "Can I call more than one person?", a: "Yes. Group voice and video calls are translated for everyone. People who share a language hear each other directly." },
      { id: "other-person", q: "Does the other person need NeuraTalk?", a: "Yes, for now both people need the NeuraTalk app or website. Translated calls to ordinary phone numbers are not available yet." },
    ],
  },
  {
    title: "Chats and businesses",
    items: [
      { id: "chat", q: "Are chats translated too?", a: "Yes. Write in your language; the other person reads it in theirs. Tap a message to see the original. Groups work the same way, and you can send photos, videos, documents, voice messages and your location." },
      { id: "web", q: "Can I use NeuraTalk on my computer?", a: <>Yes. Open <Link href="/link-device" className="underline underline-offset-2">neuratalk.in/link-device</Link> on the computer, then on your phone go to More → Linked devices → Link a device and scan the code. Logging out on the computer signs out only that computer; your phone stays signed in. A computer you haven't used for 14 days is signed out automatically.</> },
      { id: "businesses", q: "Can I message shops and companies?", a: <>Yes. Businesses on NeuraTalk appear in your Chats list with their name and logo. A blue tick means NeuraTalk has checked the business. You can block any business, or switch off its offers and still get order updates and codes. Businesses can learn more on the <Link href="/business" className="underline underline-offset-2">NeuraTalk Business</Link> page.</> },
      { id: "business-sees", q: "What does a business see about me?", a: "Your name, profile photo and number, and the messages you send it — never your other chats." },
    ],
  },
  {
    title: "Account and billing",
    items: [
      { id: "start", q: "How do I get started?", a: "Sign up with your phone number, verify the code we send, and you can start calling. New accounts get free translated minutes to try it. No credit card needed." },
      { id: "pricing", q: "How much does it cost?", a: <>Translated call time is taken from your balance, which you can see in the app. See the <Link href="/pricing" className="underline underline-offset-2">pricing page</Link> for current rates.</> },
      { id: "refunds", q: "Can I get a refund?", a: <>Yes, in the cases described in our <Link href="/refund-policy" className="underline underline-offset-2">refund policy</Link>.</> },
    ],
  },
  {
    title: "Privacy and your voice",
    items: [
      { id: "privacy", q: "Are my calls recorded?", a: `No. Call audio is never stored. The translated text of a call is kept in your call history for ${CALL_TEXT_RETENTION_DAYS} days, then deleted. Speech passes through our cloud providers (Microsoft Azure, OpenAI, ElevenLabs) only to be translated and spoken.` },
      { id: "voice-training", q: "What happens to my voice recording?", a: "It is used only to speak your own words in your own calls, never anyone else's. You can switch your voice off or delete it any time from Settings → Your voice." },
      { id: "security", q: "Are calls encrypted?", a: <>Calls and messages are encrypted in transit. They are not end-to-end encrypted, because translation needs our servers to process speech and text. Details are in the <Link href="/trust" className="underline underline-offset-2">Trust Center</Link> and <Link href="/privacy" className="underline underline-offset-2">Privacy Policy</Link>.</> },
      { id: "new-sign-in", q: "How do I know if someone else signed in to my account?", a: "When a browser or computer signs in to your account, your phone gets a notification with the device and time. You can see every signed-in device in More → Linked devices and sign any of them out." },
      { id: "delete-account", q: "How do I delete my account?", a: "In the app: More → Privacy → Delete my account. Your number, name, photo and voice are removed and you are signed out everywhere. You can also download your data there first." },
    ],
  },
];

const slug = (t: string) => t.toLowerCase().replace(/[^a-z]+/g, "-");

export default function FAQPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHero eyebrow="Help" title="Questions and answers" body="Straight answers about calls, chats, businesses and your data." />

      <section className="px-4 py-16 md:py-20">
        <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[220px_1fr]">
          <nav className="hidden lg:block" aria-label="Topics">
            <div className="sticky top-24 space-y-1">
              {GROUPS.map((g) => (
                <a key={g.title} href={`#${slug(g.title)}`} className="block rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">{g.title}</a>
              ))}
            </div>
          </nav>
          <div className="space-y-14">
            {GROUPS.map((group) => (
              <div key={group.title} id={slug(group.title)} className="scroll-mt-24">
                <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{group.title}</h2>
                <Accordion type="single" collapsible className="mt-4 w-full">
                  {group.items.map((item) => (
                    <AccordionItem key={item.id} value={item.id}>
                      <AccordionTrigger className="py-5 text-left text-base font-medium sm:text-lg">{item.q}</AccordionTrigger>
                      <AccordionContent className="pb-5 text-base leading-relaxed text-muted-foreground">{item.a}</AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </div>
            ))}

            <div className="rounded-3xl border bg-muted/40 p-8 sm:p-10">
              <h2 className="text-2xl font-semibold">Still have a question?</h2>
              <p className="mt-2 text-muted-foreground">Write to us and we'll get back to you.</p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <a href={`mailto:${COMPANY.email}`} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-primary px-6 text-primary-foreground hover:bg-primary/90"><Mail className="h-4 w-4" />Email support</a>
                <Link href="/help" className="inline-flex h-11 items-center justify-center rounded-full border bg-background px-6 hover:bg-muted">Help Center</Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
