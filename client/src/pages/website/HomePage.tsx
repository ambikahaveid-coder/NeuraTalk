import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRight, AudioLines, Building2, CheckCircle2, EyeOff, Headphones,
  Languages, Mic, MicOff, PhoneCall, Shield, Timer, UserRound, Video, Volume2,
} from "lucide-react";
import { motion } from "framer-motion";

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-50px" },
  transition: { duration: 0.5 },
};

/** Languages exposed for live voice and translated captions today. */
export const CALL_LANGUAGES = [
  "English", "Hindi", "Telugu", "Tamil", "Kannada", "Malayalam",
  "Marathi", "Bengali", "Gujarati", "Punjabi", "Urdu", "Spanish",
  "French", "German", "Japanese", "Korean", "Chinese", "Arabic",
  "Portuguese", "Russian",
];

const FEATURES = [
  {
    icon: UserRound,
    title: "Your own voice",
    desc: "Record yourself once in the app. After that, people hear your translated words in your voice. Until then, they hear your original voice with translated captions.",
  },
  {
    icon: Languages,
    title: "Language-aware calls",
    desc: "NeuraTalk auto-detects supported spoken languages. You can also choose your language before calling.",
  },
  {
    icon: EyeOff,
    title: "Captions when needed",
    desc: "Prefer reading? Switch to captions. And if your voice isn't recorded yet, captions appear automatically so nothing is lost.",
  },
  {
    icon: Timer,
    title: "Realtime translation",
    desc: "Speech recognition, translation and speech synthesis run during the call. Actual delay depends on the language pair, connection and provider.",
  },
  {
    icon: MicOff,
    title: "Background noise removed",
    desc: "Noise processing can help call audio come through clearly. Recognition quality still depends on the microphone and environment.",
  },
  {
    icon: Video,
    title: "Voice and video",
    desc: "The same translation works in video calls. You see their face and hear them in your language.",
  },
];

function Waveform({ bars = 18, className = "" }: { bars?: number; className?: string }) {
  return (
    <div className={`flex items-center gap-[3px] h-8 ${className}`} aria-hidden>
      {Array.from({ length: bars }).map((_, i) => (
        <motion.span
          key={i}
          className="w-[3px] rounded-full bg-current"
          animate={{ height: [6, 10 + ((i * 7) % 18), 6] }}
          transition={{ duration: 1.1, repeat: Infinity, delay: (i % 6) * 0.12, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}

/** Two people, two languages, one call — with nothing on screen to read. */
function CallIllustration() {
  return (
    <div className="relative mx-auto w-full max-w-md" aria-label="Example: Ravi speaks Telugu, Sarah hears English in Ravi's voice">
      <Card className="shadow-xl">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500" />On call · 02:14</span>
            <span>Telugu ⇄ English, automatic</span>
          </div>

          <div className="rounded-xl border p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/15 text-primary flex items-center justify-center font-semibold">R</div>
              <div className="flex-1 min-w-0">
                <p className="font-medium">Ravi</p>
                <p className="text-xs text-muted-foreground">speaks Telugu</p>
              </div>
              <Waveform className="text-primary" />
            </div>
          </div>

          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <AudioLines className="w-4 h-4" />
            translated in Ravi's own voice
          </div>

          <div className="rounded-xl border p-4 bg-muted/40">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-muted text-foreground flex items-center justify-center font-semibold">S</div>
              <div className="flex-1 min-w-0">
                <p className="font-medium">Sarah</p>
                <p className="text-xs text-muted-foreground">hears it in English</p>
              </div>
              <Volume2 className="w-5 h-5 text-muted-foreground" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <section className="relative px-4 pt-20 pb-16 md:pt-28 md:pb-24 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-background" aria-hidden />
        <div className="relative max-w-6xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <Badge variant="secondary" className="mb-5 px-3 py-1 text-sm">Translated calls across languages</Badge>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-[1.1] tracking-tight mb-5" data-testid="text-hero-title">
              Speak your language.
              <span className="block text-primary">They hear you in theirs.</span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground mb-8 max-w-xl leading-relaxed">
              NeuraTalk translates your call while you talk. Once you record your voice, the other person hears your translated words in your own voice — never a robot. Until then, they see translated captions.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 mb-8">
              <Link href="/login">
                <Button size="lg" className="w-full sm:w-auto text-base px-7" data-testid="button-get-started">
                  Start calling free
                  <ArrowRight className="ml-2 w-5 h-5" />
                </Button>
              </Link>
              <a href="#how-it-works">
                <Button size="lg" variant="outline" className="w-full sm:w-auto text-base px-7" data-testid="button-how-it-works">
                  How it works
                </Button>
              </a>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
              {["No credit card", "English + 9 Indian languages", "Same language? Nothing gets translated"].map((t) => (
                <span key={t} className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-primary" />{t}
                </span>
              ))}
            </div>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.15 }}>
            <CallIllustration />
          </motion.div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="py-20 px-4 bg-muted/30 scroll-mt-20">
        <div className="max-w-5xl mx-auto">
          <motion.div {...fadeUp} className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold mb-3">A call that just works</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">Three things happen. You only do the first one.</p>
          </motion.div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { icon: PhoneCall, step: "1", title: "Call like you always do", desc: "Pick a contact, then choose voice or video and your translation language settings." },
              { icon: Mic, step: "2", title: "Talk in your language", desc: "Each person speaks the way they normally do. NeuraTalk hears which language it is." },
              { icon: Headphones, step: "3", title: "They hear you, in your voice", desc: "Your words reach them translated, in your own voice. Not recorded yet? They see captions instead. Same language? Nothing is translated." },
            ].map((item, i) => (
              <motion.div key={item.step} {...fadeUp} transition={{ duration: 0.5, delay: i * 0.08 }}>
                <Card className="h-full">
                  <CardContent className="p-6">
                    <div className="flex items-center gap-3 mb-4">
                      <span className="w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center">{item.step}</span>
                      <item.icon className="w-5 h-5 text-primary" />
                    </div>
                    <h3 className="font-semibold text-lg mb-2">{item.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* What makes it feel human */}
      <section className="py-20 px-4">
        <div className="max-w-6xl mx-auto">
          <motion.div {...fadeUp} className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold mb-3">It should feel like talking, not like using a translator</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">Everything we build is judged by one question: does the call feel human?</p>
          </motion.div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((f, i) => (
              <motion.div key={f.title} {...fadeUp} transition={{ duration: 0.5, delay: i * 0.05 }}>
                <Card className="h-full">
                  <CardContent className="p-6">
                    <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                      <f.icon className="w-5 h-5 text-primary" />
                    </div>
                    <h3 className="font-semibold text-lg mb-2">{f.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Your voice */}
      <section className="py-20 px-4 bg-muted/30">
        <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-10 items-center">
          <motion.div {...fadeUp}>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Set up your voice in about two minutes</h2>
            <p className="text-muted-foreground text-lg mb-6 leading-relaxed">
              In the app, go to Settings → Your voice and read three short passages aloud. That's it — your voice is ready for your next call.
            </p>
            <ul className="space-y-3">
              {[
                "Only used to speak your own words in your own calls",
                "Switch it off or delete it any time",
                "Until you record, people see translated captions — never a robot voice",
              ].map((t) => (
                <li key={t} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" />{t}
                </li>
              ))}
            </ul>
          </motion.div>
          <motion.div {...fadeUp} transition={{ duration: 0.5, delay: 0.1 }}>
            <Card>
              <CardContent className="p-6 space-y-3">
                {["Passage 1", "Passage 2", "Passage 3"].map((p, i) => (
                  <div key={p} className="flex items-center gap-3 rounded-lg border p-3">
                    <span className={`w-8 h-8 rounded-full flex items-center justify-center ${i < 2 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                      {i < 2 ? <CheckCircle2 className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                    </span>
                    <span className="text-sm font-medium flex-1">{p}</span>
                    <span className="text-xs text-muted-foreground">{i < 2 ? "Recorded" : "Tap to record"}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </section>

      {/* Languages */}
      <section className="py-20 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <motion.div {...fadeUp}>
            <h2 className="text-3xl md:text-4xl font-bold mb-3">Languages</h2>
            <p className="text-muted-foreground text-lg mb-8">
              Any pair of these, in either direction. Your recorded voice can speak all of them.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {CALL_LANGUAGES.map((l) => (
                <Badge key={l} variant="outline" className="text-sm px-3 py-1.5">{l}</Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-6">
              Translation is automatic and can make mistakes, especially with names and mixed-language sentences. <Link href="/translation-disclaimer" className="underline">Read more</Link>
            </p>
          </motion.div>
        </div>
      </section>

      {/* Businesses */}
      <section className="py-20 px-4 bg-muted/30">
        <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-10 items-center">
          <motion.div {...fadeUp}>
            <Badge variant="outline" className="mb-4"><Building2 className="w-3.5 h-3.5 mr-1.5" />For businesses</Badge>
            <h2 className="text-3xl font-bold mb-4">Talk to every customer in their language</h2>
            <p className="text-muted-foreground text-lg leading-relaxed mb-6">
              Your team speaks their language, your customers speak theirs. Company accounts add team management and call history.
            </p>
            <Link href="/contact">
              <Button variant="outline" data-testid="button-b2b-contact">Talk to us <ArrowRight className="ml-2 w-4 h-4" /></Button>
            </Link>
          </motion.div>
          <motion.div {...fadeUp} transition={{ duration: 0.5, delay: 0.1 }}>
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Shield className="w-5 h-5 text-primary" />
                  <h3 className="font-semibold">Privacy, plainly</h3>
                </div>
                <ul className="space-y-3 text-sm text-muted-foreground">
                  <li>Calls are encrypted in transit.</li>
                  <li>Speech is processed by our cloud providers (Microsoft Azure, ElevenLabs, OpenAI) only to translate and speak it.</li>
                  <li>Your voice clone is never used for anyone else's words.</li>
                </ul>
                <Link href="/trust" className="inline-block text-sm text-primary mt-4 underline">Trust Center</Link>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-4">
        <motion.div {...fadeUp} className="max-w-3xl mx-auto text-center rounded-3xl bg-primary text-primary-foreground px-6 py-14">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Call someone who doesn't speak your language</h2>
          <p className="text-lg opacity-90 mb-8">Your first translated call takes less than a minute to set up.</p>
          <Link href="/login">
            <Button size="lg" variant="secondary" className="text-base px-8" data-testid="button-cta-signup">
              Create free account
              <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
          </Link>
        </motion.div>
      </section>
    </div>
  );
}
