import { Link } from "wouter";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Mail } from "lucide-react";
import { COMPANY, LANGUAGE_SUMMARY, CALL_TEXT_RETENTION_DAYS } from "./site-facts";

type Faq = { id: string; q: string; a: React.ReactNode };

const GROUPS: { title: string; items: Faq[] }[] = [
  {
    title: "Calls",
    items: [
      {
        id: "what-is",
        q: "What is NeuraTalk?",
        a: "An app for voice and video calls, chats and business messages that are translated while you talk or type. You speak or write in your language; the other person hears or reads it in theirs.",
      },
      {
        id: "settings",
        q: "Do I have to choose a language before calling?",
        a: "You can choose a language before the call. Automatic detection is available for supported languages; detection quality depends on speech and the connection.",
      },
      {
        id: "own-voice",
        q: "Will they hear a robot voice?",
        a: "No. In the app, open Settings → Your voice and read three short passages (about two minutes), or allow NeuraTalk to learn your voice from the first half-minute you speak in a call (the recording itself is not kept). After that, your translated words are spoken in your voice. Until then, the other person hears your original voice and sees translated captions — we never use a robot voice.",
      },
      {
        id: "captions",
        q: "Do I need to read anything on screen?",
        a: "You can choose translated captions or translated speech in call settings. If the other person hasn't recorded their voice yet, captions turn on automatically and you still hear their original voice.",
      },
      {
        id: "delay",
        q: "How long is the delay?",
        a: "Delay varies with language pair, network, microphone and provider. The live call pipeline processes speech, translation and audio as they become available.",
      },
      {
        id: "noise",
        q: "What if I'm somewhere noisy?",
        a: "Noise processing may help. Recognition can still be affected by background noise, device quality and language coverage.",
      },
      {
        id: "video-calls",
        q: "Does it work in video calls?",
        a: "Yes. Video calls are translated the same way as voice calls.",
      },
      {
        id: "languages",
        q: "Which languages are supported?",
        a: `${LANGUAGE_SUMMARY} — any pair, in either direction. Mixed speech like Tenglish or Hinglish usually works, but names and mixed sentences are where mistakes are most likely.`,
      },
      {
        id: "group-calls",
        q: "Can I call more than one person?",
        a: "Yes. Group voice and video calls are translated for everyone. People who share a language hear each other directly.",
      },
      {
        id: "other-person",
        q: "Does the other person need NeuraTalk?",
        a: "Yes, for now both people need the NeuraTalk app or website. Translated calls to ordinary phone numbers are not available yet.",
      },
    ],
  },
  {
    title: "Chats and businesses",
    items: [
      {
        id: "chat",
        q: "Are chats translated too?",
        a: "Yes. Write in your language; the other person reads it in theirs. Tap a message to see the original. Groups work the same way, and you can send photos, videos, documents, voice messages and your location.",
      },
      {
        id: "businesses",
        q: "Can I message shops and companies?",
        a: <>Yes. Businesses on NeuraTalk appear in your Chats list with their name and logo. A blue tick means NeuraTalk has checked the business. You can block any business, or switch off its offers and still get order updates and codes. Businesses can learn more on the <Link href="/business" className="underline">NeuraTalk Business</Link> page.</>,
      },
      {
        id: "business-sees",
        q: "What does a business see about me?",
        a: "Your name, profile photo and number, and the messages you send it — never your other chats.",
      },
    ],
  },
  {
    title: "Account & billing",
    items: [
      {
        id: "start",
        q: "How do I get started?",
        a: "Sign up with your phone number, verify the code we send, and you can start calling. New accounts get free translated minutes to try it. No credit card needed.",
      },
      {
        id: "pricing",
        q: "How much does it cost?",
        a: <>Translated call time is taken from your balance, which you can see in the app. See the <Link href="/pricing" className="underline">pricing page</Link> for current rates.</>,
      },
      {
        id: "refunds",
        q: "Can I get a refund?",
        a: <>Yes, in the cases described in our <Link href="/refund-policy" className="underline">refund policy</Link>.</>,
      },
    ],
  },
  {
    title: "Privacy & your voice",
    items: [
      {
        id: "privacy",
        q: "Are my calls recorded?",
        a: `No. Call audio is never stored. The translated text of a call is kept in your call history for ${CALL_TEXT_RETENTION_DAYS} days, then deleted. Speech passes through our cloud providers (Microsoft Azure, OpenAI, ElevenLabs) only to be translated and spoken.`,
      },
      {
        id: "voice-training",
        q: "What happens to my voice recording?",
        a: "It is used only to speak your own words in your own calls, never anyone else's. You can switch your voice off or delete it any time from Settings → Your voice.",
      },
      {
        id: "security",
        q: "Are calls encrypted?",
        a: <>Calls and messages are encrypted in transit. They are not end-to-end encrypted, because translation needs our servers to process speech and text. Details are in the <Link href="/trust" className="underline">Trust Center</Link> and <Link href="/privacy" className="underline">Privacy Policy</Link>.</>,
      },
      {
        id: "delete-account",
        q: "How do I delete my account?",
        a: "In the app: More → Privacy → Delete my account. Your number, name, photo and voice are removed and you are signed out everywhere. You can also download your data there first.",
      },
    ],
  },
];

export default function FAQPage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-b from-primary/5 to-background">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-4">Questions and answers</h1>
          <p className="text-lg text-muted-foreground">Straight answers about calls, chats, businesses and your data.</p>
        </div>
      </section>

      <section className="py-12 px-4">
        <div className="max-w-3xl mx-auto space-y-10">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <Badge variant="outline" className="mb-4">{group.title}</Badge>
              <Accordion type="single" collapsible className="w-full">
                {group.items.map((item) => (
                  <AccordionItem key={item.id} value={item.id}>
                    <AccordionTrigger className="text-left">{item.q}</AccordionTrigger>
                    <AccordionContent className="text-muted-foreground leading-relaxed">{item.a}</AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          ))}
        </div>

        <div className="max-w-3xl mx-auto mt-16 p-8 rounded-2xl bg-primary/5 border border-primary/10 text-center">
          <h2 className="text-2xl font-bold mb-3">Still have a question?</h2>
          <p className="text-muted-foreground mb-6">Write to us and we'll get back to you.</p>
          <Button className="gap-2" onClick={() => (window.location.href = `mailto:${COMPANY.email}`)}>
            <Mail className="w-4 h-4" />
            Email support
          </Button>
        </div>
      </section>
    </div>
  );
}
