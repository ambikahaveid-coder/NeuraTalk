import type { ReactNode } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  ArrowRight, BadgeCheck, Check, CheckCheck, EyeOff, Languages, Lock, Megaphone, MicOff, Mic,
  Monitor, Paperclip, Phone, PhoneOff, QrCode, Send, Smile, Timer, UserRound, Users, Video, VolumeX,
} from "lucide-react";
import { motion } from "framer-motion";
import { LANGUAGES, INDIAN_LANGUAGES, CALL_TEXT_RETENTION_DAYS } from "./site-facts";

/** The languages the app offers (site-facts.ts mirrors the app's list). */
export const CALL_LANGUAGES = LANGUAGES;

const reveal = {
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] },
};

/** Warm paper tone for alternating sections; quiet in dark mode. */
const PAPER = "bg-[#F5F2EC] dark:bg-white/[0.03]";

const DETAILS = [
  { icon: UserRound, title: "Your own voice", desc: "Record yourself once, or let NeuraTalk learn from the first half-minute of your first call. Until then, people hear your original voice with translated captions." },
  { icon: Languages, title: "Language-aware calls", desc: "Supported spoken languages are detected automatically. You can also pick yours before you call." },
  { icon: EyeOff, title: "Captions when needed", desc: "Prefer reading? Switch to captions any time. If your voice isn't recorded yet, they appear on their own." },
  { icon: Timer, title: "Translated as you talk", desc: "Recognition, translation and speech run during the call. The delay depends on the languages, connection and provider." },
  { icon: MicOff, title: "Less background noise", desc: "Noise processing helps your words come through. A good microphone and a quiet room still help most." },
  { icon: Video, title: "Voice and video", desc: "The same translation works on video calls. You see their face and hear them in your language." },
];

// ------------------------------------------------------------------ product pictures
// Drawn in HTML so they stay sharp, follow light/dark mode and match the real app.

function PhoneFrame({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`relative w-[272px] sm:w-[292px] h-[560px] sm:h-[600px] rounded-[2.75rem] bg-neutral-900 p-[9px] shadow-[0_30px_80px_-20px_rgba(15,23,42,0.45)] ${className}`}>
      <div className="relative h-full w-full overflow-hidden rounded-[2.2rem] bg-background">
        <div className="absolute left-1/2 top-2 z-20 h-5 w-24 -translate-x-1/2 rounded-full bg-neutral-900" aria-hidden />
        {children}
      </div>
    </div>
  );
}

function ChatHeader({ name, sub, initial, tone = "bg-sky-500" }: { name: string; sub: string; initial: string; tone?: string }) {
  return (
    <div className="flex items-center gap-2.5 border-b bg-background px-3 pb-2.5 pt-9">
      <div className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold text-white ${tone}`}>{initial}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold leading-tight">{name}</p>
        <p className="text-[11px] text-muted-foreground">{sub}</p>
      </div>
      <Video className="h-4 w-4 text-muted-foreground" />
      <Phone className="h-4 w-4 text-muted-foreground" />
    </div>
  );
}

function Bubble({ mine, children, time, note }: { mine?: boolean; children: ReactNode; time: string; note?: string }) {
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[82%] rounded-2xl px-3 py-1.5 text-[13px] leading-snug shadow-sm ${mine ? "rounded-br-md bg-primary/15 dark:bg-primary/25" : "rounded-bl-md bg-background"}`}>
        <p>{children}</p>
        {note && <p className="mt-0.5 text-[10.5px] text-primary">{note}</p>}
        <p className="mt-0.5 flex items-center justify-end gap-0.5 text-[10px] text-muted-foreground">
          {time}{mine && <CheckCheck className="h-3 w-3 text-sky-500" />}
        </p>
      </div>
    </div>
  );
}

function Composer() {
  return (
    <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-background/95 px-2.5 py-2.5">
      <div className="flex flex-1 items-center gap-2 rounded-full border bg-muted/40 px-3 py-2 text-[12px] text-muted-foreground">
        <Smile className="h-4 w-4" /> <span className="flex-1">Message</span> <Paperclip className="h-4 w-4" />
      </div>
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground"><Mic className="h-4 w-4" /></div>
    </div>
  );
}

const WALLPAPER = "bg-muted/50 [background-image:radial-gradient(hsl(var(--foreground)/0.06)_1px,transparent_1px)] [background-size:14px_14px]";

function HeroChat() {
  return (
    <PhoneFrame>
      <ChatHeader name="Ananya" sub="online" initial="A" tone="bg-rose-500" />
      <div className={`h-full space-y-2 px-3 pb-24 pt-3 ${WALLPAPER}`}>
        <p className="mx-auto w-fit rounded-md bg-background/90 px-2 py-0.5 text-[10px] text-muted-foreground shadow-sm">Today</p>
        <Bubble time="10:02" note="Translated from Telugu · show original">Hi! What time is the meeting tomorrow?</Bubble>
        <Bubble mine time="10:03">10 am works for me. I'll send you the address.</Bubble>
        <Bubble time="10:03" note="Translated from Telugu · show original">Perfect. Shall I call you on the way?</Bubble>
        <Bubble mine time="10:04">Yes, call me. Talk in Telugu — I'll hear you in English.</Bubble>
        <div className="flex justify-start">
          <div className="flex items-center gap-2 rounded-2xl rounded-bl-md bg-background px-3 py-2 shadow-sm">
            <Phone className="h-3.5 w-3.5 text-primary" />
            <span className="text-[12px]">Voice call · 4 min · translated</span>
          </div>
        </div>
      </div>
      <Composer />
    </PhoneFrame>
  );
}

function Wave({ className = "" }: { className?: string }) {
  return (
    <div className={`flex h-10 items-center gap-[3px] ${className}`} aria-hidden>
      {Array.from({ length: 22 }).map((_, i) => (
        <motion.span
          key={i}
          className="w-[3px] rounded-full bg-current"
          animate={{ height: [6, 12 + ((i * 7) % 22), 6] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: (i % 7) * 0.1, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}

function CallScreen() {
  return (
    <PhoneFrame>
      <div className="flex h-full flex-col items-center bg-gradient-to-b from-slate-800 via-slate-900 to-slate-950 px-5 pb-8 pt-14 text-white">
        <p className="text-[11px] uppercase tracking-[0.18em] text-white/50">Translated call</p>
        <div className="mt-6 flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 to-orange-500 text-3xl font-semibold">R</div>
        <p className="mt-4 text-xl font-semibold">Ravi</p>
        <p className="text-sm text-white/60">04:12</p>
        <div className="mt-6 rounded-full bg-white/10 px-3 py-1 text-[11px] text-white/80">Telugu → English · in Ravi's voice</div>
        <Wave className="mt-5 text-sky-300" />
        <div className="mt-5 w-full rounded-2xl bg-white/[0.07] p-3 text-left">
          <p className="text-[10px] uppercase tracking-wider text-white/40">Caption</p>
          <p className="mt-1 text-[13px] leading-snug text-white/90">“I'm near the bus stand, I'll be there in ten minutes.”</p>
        </div>
        <div className="mt-auto flex items-center gap-5">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10"><VolumeX className="h-5 w-5" /></span>
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500"><PhoneOff className="h-6 w-6" /></span>
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10"><Mic className="h-5 w-5" /></span>
        </div>
      </div>
    </PhoneFrame>
  );
}

function GroupChat() {
  const msgs = [
    { who: "Priya", lang: "Hindi", tone: "text-fuchsia-600 dark:text-fuchsia-400", text: "Saturday works for everyone?" },
    { who: "Karthik", lang: "Tamil", tone: "text-emerald-600 dark:text-emerald-400", text: "Yes! I'll book the hall." },
    { who: "Maria", lang: "Spanish", tone: "text-orange-600 dark:text-orange-400", text: "I'll bring the cake 🎂" },
  ];
  return (
    <PhoneFrame>
      <ChatHeader name="College friends" sub="Priya, Karthik, Maria, You" initial="CF" tone="bg-indigo-500" />
      <div className={`h-full space-y-2 px-3 pb-24 pt-3 ${WALLPAPER}`}>
        {msgs.map((m, i) => (
          <div key={m.who} className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-background px-3 py-1.5 shadow-sm">
              <p className={`text-[11px] font-semibold ${m.tone}`}>{m.who}</p>
              <p className="text-[13px] leading-snug">{m.text}</p>
              <p className="mt-0.5 text-[10.5px] text-primary">Translated from {m.lang}</p>
              <p className="text-right text-[10px] text-muted-foreground">6:1{i + 2} pm</p>
            </div>
          </div>
        ))}
        <Bubble mine time="6:16 pm">Great, see you all there!</Bubble>
        <div className="rounded-2xl bg-background p-3 shadow-sm">
          <p className="text-[12px] font-semibold">Poll: What time?</p>
          {[["5 pm", 3], ["7 pm", 1]].map(([t, n]) => (
            <div key={t as string} className="mt-2">
              <div className="flex justify-between text-[11px]"><span>{t}</span><span className="text-muted-foreground">{n}</span></div>
              <div className="mt-1 h-1.5 rounded-full bg-muted"><div className="h-1.5 rounded-full bg-primary" style={{ width: `${(Number(n) / 4) * 100}%` }} /></div>
            </div>
          ))}
        </div>
      </div>
      <Composer />
    </PhoneFrame>
  );
}

function DesktopWeb() {
  const rows = [
    { n: "Ananya", m: "Perfect. Shall I call you?", t: "10:03", c: "bg-rose-500", u: 2 },
    { n: "College friends", m: "Maria: I'll bring the cake 🎂", t: "6:14", c: "bg-indigo-500", u: 0 },
    { n: "Sharma Clinic", m: "Your appointment is confirmed", t: "Mon", c: "bg-teal-500", u: 0 },
    { n: "Dad", m: "Voice call · 12 min", t: "Sun", c: "bg-amber-500", u: 0 },
  ];
  return (
    <div className="w-full max-w-[560px] overflow-hidden rounded-2xl border bg-background shadow-[0_30px_80px_-24px_rgba(15,23,42,0.35)]">
      <div className="flex items-center gap-1.5 border-b bg-muted/60 px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400" /><span className="h-2.5 w-2.5 rounded-full bg-amber-400" /><span className="h-2.5 w-2.5 rounded-full bg-green-400" />
        <span className="ml-3 flex-1 truncate rounded-md bg-background px-2 py-0.5 text-[10.5px] text-muted-foreground"><Lock className="mr-1 inline h-2.5 w-2.5" />neuratalk.in/web</span>
      </div>
      <div className="grid h-[300px] grid-cols-[1fr_1.35fr] sm:h-[340px]">
        <div className="border-r">
          <p className="px-3 pb-1 pt-3 text-sm font-bold">Chats</p>
          {rows.map((r, i) => (
            <div key={r.n} className={`flex items-center gap-2 px-3 py-2 ${i === 0 ? "bg-muted/60" : ""}`}>
              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white ${r.c}`}>{r.n[0]}</div>
              <div className="min-w-0 flex-1">
                <div className="flex justify-between gap-1"><p className="truncate text-[11.5px] font-medium">{r.n}</p><span className="text-[9.5px] text-muted-foreground">{r.t}</span></div>
                <div className="flex items-center gap-1"><p className="flex-1 truncate text-[10.5px] text-muted-foreground">{r.m}</p>{r.u > 0 && <span className="rounded-full bg-primary px-1.5 text-[9px] text-primary-foreground">{r.u}</span>}</div>
              </div>
            </div>
          ))}
        </div>
        <div className={`flex flex-col ${WALLPAPER}`}>
          <div className="flex items-center gap-2 border-b bg-background px-3 py-2"><div className="flex h-6 w-6 items-center justify-center rounded-full bg-rose-500 text-[10px] font-semibold text-white">A</div><p className="text-[11.5px] font-semibold">Ananya</p></div>
          <div className="flex-1 space-y-1.5 p-2.5 text-[11px]">
            <div className="w-fit max-w-[85%] rounded-xl rounded-bl-sm bg-background px-2 py-1 shadow-sm">Hi! What time is the meeting tomorrow?<p className="text-[9px] text-primary">Translated from Telugu</p></div>
            <div className="ml-auto w-fit max-w-[85%] rounded-xl rounded-br-sm bg-primary/15 px-2 py-1 shadow-sm dark:bg-primary/25">10 am works for me.</div>
            <div className="w-fit max-w-[85%] rounded-xl rounded-bl-sm bg-background px-2 py-1 shadow-sm">Perfect. Shall I call you?<p className="text-[9px] text-primary">Translated from Telugu</p></div>
          </div>
          <div className="flex items-center gap-1.5 bg-background/90 p-2"><div className="flex-1 rounded-full border px-2 py-1 text-[10px] text-muted-foreground">Type a message</div><Send className="h-3.5 w-3.5 text-primary" /></div>
        </div>
      </div>
    </div>
  );
}

function BusinessProfile() {
  return (
    <PhoneFrame>
      <div className="h-full bg-muted/40 pb-6 pt-10">
        <div className="mx-3 rounded-2xl bg-background p-4 text-center shadow-sm">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-teal-500 text-xl font-semibold text-white">S</div>
          <p className="mt-2 flex items-center justify-center gap-1 font-semibold">Sharma Clinic <BadgeCheck className="h-4 w-4 text-primary" /></p>
          <p className="text-[11px] text-muted-foreground">Business account · Open today 9 am – 8 pm</p>
          <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
            {[[Send, "Message"], [Phone, "Call"], [QrCode, "QR"]].map(([I, l]) => {
              const Icon = I as typeof Send;
              return <div key={l as string} className="rounded-xl border py-2 text-primary"><Icon className="mx-auto mb-0.5 h-4 w-4" />{l as string}</div>;
            })}
          </div>
        </div>
        <p className="mx-4 mb-2 mt-4 text-[11px] font-semibold text-muted-foreground">Catalog</p>
        <div className="mx-3 grid grid-cols-2 gap-2">
          {[["General check-up", "₹500"], ["Blood test", "₹350"], ["Eye check-up", "₹400"], ["Home visit", "₹900"]].map(([n, p]) => (
            <div key={n} className="rounded-xl bg-background p-2 shadow-sm">
              <div className="mb-1.5 h-12 rounded-lg bg-gradient-to-br from-teal-100 to-sky-100 dark:from-teal-900/50 dark:to-sky-900/40" />
              <p className="truncate text-[11px] font-medium">{n}</p>
              <p className="text-[11px] text-muted-foreground">{p}</p>
            </div>
          ))}
        </div>
        <div className="mx-3 mt-3 rounded-2xl bg-background p-3 shadow-sm">
          <p className="text-[12px]">Your appointment is confirmed for Monday, 11 am.</p>
          <p className="text-[10.5px] text-primary">Sent in Telugu · you read it in English</p>
        </div>
      </div>
    </PhoneFrame>
  );
}

// ------------------------------------------------------------------ layout pieces

function Story({ title, body, visual, flip, paper, link, children }: {
  title: string; body: string; visual: ReactNode; flip?: boolean; paper?: boolean;
  link?: { href: string; label: string; testId?: string }; children?: ReactNode;
}) {
  return (
    <section className={`px-4 py-20 md:py-28 ${paper ? PAPER : ""}`}>
      <div className="mx-auto grid max-w-6xl items-center gap-12 md:grid-cols-2 md:gap-16">
        <motion.div {...reveal} className={`flex justify-center ${flip ? "md:order-2" : ""}`}>{visual}</motion.div>
        <motion.div {...reveal} className={flip ? "md:order-1" : ""}>
          <h2 className="text-[2rem] font-semibold leading-[1.1] tracking-tight sm:text-5xl">{title}</h2>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-muted-foreground md:text-xl">{body}</p>
          {children}
          {link && (
            <Link href={link.href} className="mt-7 inline-flex items-center gap-1.5 text-base font-medium text-primary hover:underline" data-testid={link.testId}>
              {link.label} <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </motion.div>
      </div>
    </section>
  );
}

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
              <Link href="/link-device">
                <Button size="lg" variant="outline" className="h-12 w-full rounded-full bg-background px-7 text-base sm:w-auto" data-testid="button-how-it-works">
                  <Monitor className="mr-2 h-5 w-5" /> Use on your computer
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
        body="Open neuratalk.in/web, scan the QR code with your phone, and your chats are on the big screen. You can sign any computer out from your phone."
        visual={<DesktopWeb />}
        link={{ href: "/link-device", label: "Link a computer" }}
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
