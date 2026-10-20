import { Link } from "wouter";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Mail } from "lucide-react";

type Faq = { id: string; q: string; a: React.ReactNode };

const GROUPS: { title: string; items: Faq[] }[] = [
  {
    title: "Calls",
    items: [
      {
        id: "what-is",
        q: "What is NeuraTalk?",
        a: "An app for voice and video calls between people who speak different languages. While you talk, your words are translated and the other person hears them in your own voice — so it feels like a normal call.",
      },
      {
        id: "settings",
        q: "Do I have to choose a language before calling?",
        a: "No. NeuraTalk works out which language each person is speaking from their voice. If you both speak the same language, nothing is translated and you just hear each other directly.",
      },
      {
        id: "own-voice",
        q: "Will they hear a robot voice?",
        a: "Not once you've recorded your voice. In the app, open Settings → Your voice and read three short passages (about two minutes). After that, your translated words are spoken in your voice. Until then, a natural standard voice is used.",
      },
      {
        id: "captions",
        q: "Do I need to read anything on screen?",
        a: "No. There are no captions during calls by default — you just listen. If you want them, you can turn captions on from the call screen.",
      },
      {
        id: "delay",
        q: "How long is the delay?",
        a: "In our tests the other person starts hearing you within about 0.6 seconds of you finishing a sentence. A weak network or a lot of background noise can make it a little longer.",
      },
      {
        id: "noise",
        q: "What if I'm somewhere noisy?",
        a: "Background noise is removed on your device before your voice is sent, which helps the translation understand you the first time.",
      },
      {
        id: "video-calls",
        q: "Does it work in video calls?",
        a: "Yes. Video calls are translated the same way as voice calls.",
      },
      {
        id: "languages",
        q: "Which languages are supported?",
        a: "English, Hindi, Telugu, Tamil, Kannada, Malayalam, Marathi, Bengali, Gujarati and Punjabi — any pair, in either direction. Mixed speech like Tenglish or Hinglish usually works, but names and mixed sentences are where mistakes are most likely.",
      },
      {
        id: "other-person",
        q: "Does the other person need NeuraTalk?",
        a: "Yes, for now both people need the NeuraTalk app or website. Translated calls to ordinary phone numbers are not available yet.",
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
        a: "No, calls are not recorded by default. Speech passes through our cloud providers (Microsoft Azure, ElevenLabs, OpenAI) only to be translated and spoken.",
      },
      {
        id: "voice-training",
        q: "What happens to my voice recording?",
        a: "It is used only to speak your own words in your own calls, never anyone else's. You can switch your voice off or delete it any time from Settings → Your voice.",
      },
      {
        id: "security",
        q: "Are calls encrypted?",
        a: <>Yes, calls are encrypted in transit. Details of how we handle data are in the <Link href="/trust" className="underline">Trust Center</Link> and <Link href="/privacy" className="underline">Privacy Policy</Link>.</>,
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
          <p className="text-lg text-muted-foreground">Straight answers about how NeuraTalk calls work.</p>
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
          <Button className="gap-2" onClick={() => (window.location.href = "mailto:support@mindwhile.com")}>
            <Mail className="w-4 h-4" />
            Email support
          </Button>
        </div>
      </section>
    </div>
  );
}
