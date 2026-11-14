import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Globe, Heart, Lock, MapPin, Scale, Shield } from "lucide-react";
import { COMPANY, INDIAN_LANGUAGES, LANGUAGES } from "./site-facts";

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-6">About NeuraTalk</h1>
          <p className="text-xl text-muted-foreground">Talk to anyone. In your own language.</p>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold mb-6">Why we built it</h2>
          <div className="space-y-4 text-muted-foreground leading-relaxed">
            <p>
              Think of the conversations that stop at the language. A grandmother in Vijayawada and her grandson's wife from Pune. A
              shopkeeper in Guntur and a customer who only speaks Tamil. A nurse explaining a prescription to a worker who came from Odisha.
              Everyone has a phone and a messaging app — and still, they can't really talk.
            </p>
            <p>
              We started NeuraTalk to fix that. It works like the messaging apps you already know — chats, groups, calls, photos, voice
              notes — with one difference: when the other person speaks another language, NeuraTalk quietly translates. You type in Telugu,
              they read it in Hindi. You speak in Tamil, they hear you in English. Once NeuraTalk knows your voice, they hear your words in your
              own voice, so it still feels like you.
            </p>
            <p>
              Today NeuraTalk speaks {LANGUAGES.length} languages, {INDIAN_LANGUAGES.length} of them Indian, and it's built for the way people actually
              talk here — mixing English into Telugu, Hindi into Tamil, and switching mid-sentence.
            </p>
          </div>
        </div>
      </section>

      <section className="py-16 px-4 bg-muted/30">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold mb-6">What you can do with it</h2>
          <ul className="space-y-3 text-muted-foreground leading-relaxed list-disc pl-5">
            <li><strong className="text-foreground">Chat and call like you always do</strong> — one-to-one and groups, communities, status, voice and video calls,
              group calls and screen sharing. Free when no translation is needed.</li>
            <li><strong className="text-foreground">Be understood in any of {LANGUAGES.length} languages</strong> — translated chats, translated calls in your own voice, or
              captions, and an in-person mode for two people sharing one phone.</li>
            <li><strong className="text-foreground">Keep some things just between you two</strong> — Private chats are end to end encrypted on your phones.</li>
            <li><strong className="text-foreground">Pay and get paid</strong> — ask a friend or a shop for money, or pay them, through your own UPI app.</li>
            <li><strong className="text-foreground">Never miss what matters</strong> — when you're busy, your AI assistant answers chats and calls, says it's your
              assistant, and tells you what was urgent.</li>
            <li><strong className="text-foreground">Run your business in your customers' languages</strong> — NeuraTalk Business gives shops, clinics and companies a
              profile, catalog, orders, a team inbox, an AI receptionist and an API, with every customer served in their own language.</li>
          </ul>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-12">What we hold ourselves to</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { icon: Heart, title: "Feel human", desc: "A call should feel like talking, not like operating a translator. Your own voice; an assistant that always says it's an assistant." },
              { icon: Shield, title: "Your data stays yours", desc: "We never record call audio, never sell data, and don't train our own AI on your conversations. Delete your voice or account from the app." },
              { icon: MapPin, title: "Made and kept in India", desc: "Built in Andhra Pradesh. Your account, chats and files are stored in India (AWS Mumbai), under Indian law." },
              { icon: Lock, title: "Honest about security", desc: "Translation needs our servers to read what's translated, so we say plainly which chats are end to end encrypted (Private chats) and which aren't." },
              { icon: Globe, title: "Indian languages first", desc: "Telugu, Hindi, Tamil and the rest are first-class — including the way people mix them with English." },
              { icon: Scale, title: "No overpromising", desc: "Translation and AI can be wrong, and we tell you so. We say what works today, and what doesn't yet." },
            ].map((v) => (
              <Card key={v.title}><CardContent className="p-6">
                <v.icon className="w-8 h-8 mb-4 text-primary" />
                <h3 className="font-semibold mb-2">{v.title}</h3>
                <p className="text-sm text-muted-foreground">{v.desc}</p>
              </CardContent></Card>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 px-4 bg-muted/30">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold mb-6">How it works, briefly</h2>
          <div className="space-y-4 text-muted-foreground leading-relaxed">
            <p>
              In a call, your phone cleans up background noise, speech recognition works out what you said and in which language, it's
              translated, and the other person hears it in your voice — usually within about a second, depending on the languages and the
              connection. Chats are translated as they're delivered, and you can always see the original.
            </p>
            <p>
              Calls run on LiveKit. Speech recognition and call translation use Microsoft Azure in India; chat translation and the AI assistant
              use OpenAI; voices are made and spoken with ElevenLabs. Our servers, database, files and backups are in India (AWS Mumbai). The
              full list of providers and what each one does is in the <Link href="/privacy" className="underline">Privacy Policy</Link> and the{" "}
              <Link href="/trust" className="underline">Trust Center</Link>.
            </p>
          </div>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold mb-6">The company</h2>
          <div className="text-muted-foreground space-y-1">
            <p>NeuraTalk is built by <strong className="text-foreground">{COMPANY.legalName}</strong>, an Indian technology company.</p>
            <p>{COMPANY.address}</p>
            <p>CIN {COMPANY.cin}</p>
            <p>{COMPANY.email} · {COMPANY.phone}</p>
          </div>
          <p className="mt-6 text-muted-foreground">
            Questions, ideas or a problem? Write to us at {COMPANY.email}. Businesses can also see{" "}
            <Link href="/business" className="underline">NeuraTalk Business</Link>, and people who want to resell NeuraTalk can ask us about our partner programme.
          </p>
        </div>
      </section>
    </div>
  );
}
