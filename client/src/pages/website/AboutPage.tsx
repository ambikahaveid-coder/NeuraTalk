import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Globe, Heart, Scale, Shield } from "lucide-react";
import { COMPANY, INDIAN_LANGUAGES, LANGUAGES } from "./site-facts";

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-6">About NeuraTalk</h1>
          <p className="text-xl text-muted-foreground">Everyone should be able to talk to anyone, in their own language.</p>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold mb-6">Why we built it</h2>
          <div className="space-y-4 text-muted-foreground leading-relaxed">
            <p>
              India speaks hundreds of languages, and so do the families, customers and colleagues we all depend on. A grandmother in
              Vijayawada and a grandchild in Bengaluru, a shopkeeper and a tourist, a clinic and a migrant worker — too often, the
              conversation stops at the language.
            </p>
            <p>
              NeuraTalk keeps it going. You speak or write in your language; the other person hears or reads it in theirs. Once you
              record your voice, they hear your translated words in your own voice, so the call still feels like you.
            </p>
            <p>
              Today NeuraTalk brings translated voice and video calls, group calls, chats, an in-person mode and NeuraTalk Business — a
              separate app that lets businesses talk to customers in their languages — to {LANGUAGES.length} languages, including{" "}
              {INDIAN_LANGUAGES.length} Indian languages.
            </p>
          </div>
        </div>
      </section>

      <section className="py-16 px-4 bg-muted/30">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-12">What we hold ourselves to</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { icon: Heart, title: "Feel human", desc: "A call should feel like talking, not like operating a translator. Your own voice, never a robot voice." },
              { icon: Shield, title: "Privacy first", desc: "We never record call audio, never sell data, and let you delete your voice and account from the app." },
              { icon: Globe, title: "Indian languages first", desc: "Telugu, Hindi, Tamil and the others are first-class — including the way people really mix them with English." },
              { icon: Scale, title: "Honest claims", desc: "We say what works today and what doesn't. Translation can make mistakes, and we tell you so." },
            ].map((v) => (
              <Card key={v.title}><CardContent className="p-6 text-center">
                <v.icon className="w-10 h-10 mx-auto mb-4 text-primary" />
                <h3 className="font-semibold mb-2">{v.title}</h3>
                <p className="text-sm text-muted-foreground">{v.desc}</p>
              </CardContent></Card>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold mb-6">How it works</h2>
          <div className="space-y-4 text-muted-foreground leading-relaxed">
            <p>
              During a call, background noise is reduced on your device, speech recognition works out what you said and in which language,
              it is translated, and it is spoken to the other person in your cloned voice — usually within about a second, depending on the
              languages and the connection.
            </p>
            <p>
              Calls run on LiveKit. Speech recognition and call translation use Microsoft Azure in India, chat translation uses OpenAI, and
              voices are created and spoken with ElevenLabs. Our servers, database, files and backups are in India (AWS Mumbai). Details are in
              the <Link href="/trust" className="underline">Trust Center</Link>.
            </p>
          </div>
        </div>
      </section>

      <section className="py-16 px-4 bg-muted/30">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold mb-6">The company</h2>
          <div className="text-muted-foreground space-y-1">
            <p>NeuraTalk is built by <strong className="text-foreground">{COMPANY.legalName}</strong>, an Indian technology company.</p>
            <p>{COMPANY.address}</p>
            <p>CIN {COMPANY.cin}</p>
            <p>{COMPANY.email} · {COMPANY.phone}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
