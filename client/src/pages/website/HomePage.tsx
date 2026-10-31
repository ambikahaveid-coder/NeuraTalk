import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  ArrowRight, BadgeCheck, Check, CheckCheck, EyeOff, Languages, Lock, Megaphone, MicOff, Mic,
  Monitor, Paperclip, Phone, PhoneOff, QrCode, Send, Smile, Timer, UserRound, Users, Video, VolumeX,
} from "lucide-react";
import { motion } from "framer-motion";
import { reveal, PAPER, HeroChat, CallScreen, GroupChat, DesktopWeb, BusinessProfile, Story } from "./site-ui";
import { LANGUAGES, INDIAN_LANGUAGES, CALL_TEXT_RETENTION_DAYS } from "./site-facts";

/** The languages the app offers (site-facts.ts mirrors the app's list). */
export const CALL_LANGUAGES = LANGUAGES;

const DETAILS = [
  { icon: UserRound, title: "Your own voice", desc: "Record yourself once, or let NeuraTalk learn from the first half-minute of your first call. Until then, people hear your original voice with translated captions." },
  { icon: Languages, title: "Language-aware calls", desc: "Supported spoken languages are detected automatically. You can also pick yours before you call." },
  { icon: EyeOff, title: "Captions when needed", desc: "Prefer reading? Switch to captions any time. If your voice isn't recorded yet, they appear on their own." },
  { icon: Timer, title: "Translated as you talk", desc: "Recognition, translation and speech run during the call. The delay depends on the languages, connection and provider." },
  { icon: MicOff, title: "Less background noise", desc: "Noise processing helps your words come through. A good microphone and a quiet room still help most." },
  { icon: Video, title: "Voice and video", desc: "The same translation works on video calls. You see their face and hear them in your language." },
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <section className={`relative overflow-hidden px-4 pb-20 pt-14 md:pb-28 md:pt-20 ${PAPER}`}>
        <div className="mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[1.1fr_0.9fr]">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <h1 className="text-[2.6rem] font-semibold leading-[1.04] tracking-tight sm:text-6xl lg:text-7xl" data-testid="text-hero-title">
              Speak your language.{" "}
              <span className="text-primary">They hear you in theirs.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground md:text-xl">
              Calls and chats on NeuraTalk are translated while you talk and type. Record your voice once, and people hear your translated words in your own voice.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link href="/login">
                <Button size="lg" className="h-12 w-full rounded-full px-7 text-base sm:w-auto" data-testid="button-get-started">
                  Get started free <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </Link>
              <Link href="/login">
                <Button size="lg" variant="outline" className="h-12 w-full rounded-full bg-background px-7 text-base sm:w-auto" data-testid="button-how-it-works">
                  <Monitor className="mr-2 h-5 w-5" /> Use on your computer (scan QR)
                </Button>
              </Link>
            </div>
            <p className="mt-6 text-sm text-muted-foreground">
              {LANGUAGES.length} languages, including {INDIAN_LANGUAGES.length} Indian · No credit card
            </p>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.15 }} className="relative flex justify-center">
            <div className="absolute -inset-x-6 top-10 bottom-10 rounded-full bg-primary/10 blur-3xl" aria-hidden />
            <HeroChat />
          </motion.div>
        </div>
      </section>

      <Story
        title="Talk in your language. Be heard in your voice."
        body="NeuraTalk translates the call while it happens. Once you've recorded your voice, people hear your translated words in it. Until then, they read translated captions, never a robot voice."
        visual={<CallScreen />}
        link={{ href: "/demo", label: "See how a call works" }}
      />

      <Story
        paper
        flip
        title="Groups where everyone speaks their own language"
        body="Everyone writes the way they're used to, and everyone reads every message in their own language. Run polls, bring groups together in communities, and follow channels for updates."
        visual={<GroupChat />}
      >
        <div className="mt-6 flex flex-wrap gap-2 text-sm">
          {[[Users, "Groups"], [UserRound, "Communities"], [Megaphone, "Channels"]].map(([I, l]) => {
            const Icon = I as typeof Users;
            return <span key={l as string} className="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1.5"><Icon className="h-4 w-4 text-primary" />{l as string}</span>;
          })}
        </div>
      </Story>

      <Story
        title="Your chats, on your computer"
        body="On your computer, open neuratalk.in and tap Log in. Scan the QR code with your phone, and your chats are on the big screen. You can sign any computer out from your phone."
        visual={<DesktopWeb />}
        link={{ href: "/login", label: "Open NeuraTalk on your computer — scan the QR code" }}
      />

      {/* Business */}
      <section className="px-4 py-8 md:py-12">
        <div className="mx-auto max-w-6xl overflow-hidden rounded-[2rem] bg-slate-900 px-6 py-16 text-white md:px-14 md:py-20 dark:bg-slate-900/80 dark:ring-1 dark:ring-white/10">
          <div className="grid items-center gap-12 md:grid-cols-2">
            <motion.div {...reveal}>
              <p className="text-sm font-medium uppercase tracking-[0.16em] text-sky-300">NeuraTalk Business</p>
              <h2 className="mt-4 text-[2rem] font-semibold leading-[1.1] tracking-tight sm:text-5xl">Talk to every customer in their language</h2>
              <p className="mt-5 max-w-md text-lg leading-relaxed text-white/70">
                A separate app for shops, clinics and companies. Customers see your name and logo, chat and call you in their own language, and get order updates and login codes from you inside NeuraTalk.
              </p>
              <ul className="mt-7 space-y-3 text-[15px] text-white/85">
                {["Verified tick once NeuraTalk has checked your business", "Catalog, forms, quick replies, greeting and away messages", "Your own chat link and QR code"].map((t) => (
                  <li key={t} className="flex items-start gap-2.5"><Check className="mt-0.5 h-5 w-5 shrink-0 text-sky-300" />{t}</li>
                ))}
              </ul>
              <Link href="/business">
                <Button size="lg" className="mt-9 h-12 rounded-full bg-white px-7 text-base text-slate-900 hover:bg-white/90" data-testid="button-b2b-contact">
                  Explore NeuraTalk Business <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </motion.div>
            <motion.div {...reveal} className="flex justify-center"><BusinessProfile /></motion.div>
          </div>
        </div>
      </section>

      {/* The small things */}
      <section className="px-4 py-20 md:py-28">
        <div className="mx-auto max-w-6xl">
          <motion.h2 {...reveal} className="max-w-2xl text-[2rem] font-semibold leading-[1.1] tracking-tight sm:text-5xl">
            It should feel like talking, not like using a translator
          </motion.h2>
          <div className="mt-14 grid gap-x-12 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {DETAILS.map((d, i) => (
              <motion.div key={d.title} {...reveal} transition={{ ...reveal.transition, delay: (i % 3) * 0.06 }}>
                <d.icon className="h-6 w-6 text-primary" />
                <h3 className="mt-4 text-lg font-semibold">{d.title}</h3>
                <p className="mt-2 leading-relaxed text-muted-foreground">{d.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Languages */}
      <section className={`px-4 py-20 md:py-24 ${PAPER}`}>
        <motion.div {...reveal} className="mx-auto max-w-5xl text-center">
          <h2 className="text-[2rem] font-semibold tracking-tight sm:text-5xl">{LANGUAGES.length} languages</h2>
          <p className="mt-4 text-lg text-muted-foreground">Any pair, in either direction. Your recorded voice can speak all of them.</p>
          <div className="mt-10 flex flex-wrap justify-center gap-x-2 gap-y-3">
            {CALL_LANGUAGES.map((l) => (
              <span key={l} className="rounded-full border bg-background px-4 py-2 text-[15px]">{l}</span>
            ))}
          </div>
          <p className="mt-8 text-sm text-muted-foreground">
            Translation is automatic and can make mistakes, especially with names and mixed-language sentences.{" "}
            <Link href="/translation-disclaimer" className="underline underline-offset-2">Read more</Link>
          </p>
        </motion.div>
      </section>

      {/* Privacy */}
      <section className="px-4 py-20 md:py-28">
        <div className="mx-auto grid max-w-6xl gap-12 md:grid-cols-[0.8fr_1.2fr]">
          <motion.div {...reveal}>
            <Lock className="h-8 w-8 text-primary" />
            <h2 className="mt-5 text-[2rem] font-semibold leading-[1.1] tracking-tight sm:text-5xl">Privacy, plainly</h2>
            <p className="mt-5 text-lg text-muted-foreground">What happens to your words and your voice, without the fine print.</p>
            <Link href="/trust" className="mt-7 inline-flex items-center gap-1.5 font-medium text-primary hover:underline">Visit the Trust Center <ArrowRight className="h-4 w-4" /></Link>
          </motion.div>
          <div className="grid gap-px overflow-hidden rounded-3xl border bg-border sm:grid-cols-2">
            {[
              ["Encrypted in transit", "Calls and messages are encrypted on the way between your phone and our servers."],
              ["No call recordings", `Call audio is never recorded. The translated text of a call stays in your call history for ${CALL_TEXT_RETENTION_DAYS} days.`],
              ["Named providers", "Speech is processed by Microsoft Azure, OpenAI and ElevenLabs only to translate and speak it."],
              ["Your voice is yours", "Your voice is only used to speak your own words. Switch it off or delete it any time."],
            ].map(([t, d]) => (
              <motion.div key={t} {...reveal} className="bg-background p-7">
                <h3 className="font-semibold">{t}</h3>
                <p className="mt-2 leading-relaxed text-muted-foreground">{d}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Closing */}
      <section className="px-4 pb-24">
        <motion.div {...reveal} className="mx-auto max-w-6xl rounded-[2rem] bg-primary px-6 py-16 text-center text-primary-foreground md:py-20">
          <h2 className="mx-auto max-w-3xl text-[2rem] font-semibold leading-[1.1] tracking-tight sm:text-5xl">Call someone who doesn't speak your language</h2>
          <p className="mt-5 text-lg opacity-90">Sign up with your phone number. It takes under a minute.</p>
          <Link href="/login">
            <Button size="lg" variant="secondary" className="mt-9 h-12 rounded-full px-8 text-base" data-testid="button-cta-signup">
              Create free account <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </Link>
        </motion.div>
      </section>
    </div>
  );
}
