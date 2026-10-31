import type { ReactNode } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  ArrowRight, BadgeCheck, CheckCheck, Lock, Mic, Paperclip, Phone, PhoneOff, QrCode, Send, Smile, Video, VolumeX,
} from "lucide-react";
import { motion } from "framer-motion";

/*
 * Shared look for every public page (home, products, business, pricing, FAQ, contact, how it works):
 * warm paper sections, big calm headlines, one idea per section, and product pictures drawn in HTML
 * so they stay sharp, follow light/dark mode and match the real app.
 */

export const reveal = {
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] },
};

/** Warm paper tone for alternating sections; quiet in dark mode. */
export const PAPER = "bg-[#F5F2EC] dark:bg-white/[0.03]";

// ------------------------------------------------------------------ product pictures
// Drawn in HTML so they stay sharp, follow light/dark mode and match the real app.

export function PhoneFrame({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`relative w-[272px] sm:w-[292px] h-[560px] sm:h-[600px] rounded-[2.75rem] bg-neutral-900 p-[9px] shadow-[0_30px_80px_-20px_rgba(15,23,42,0.45)] ${className}`}>
      <div className="relative h-full w-full overflow-hidden rounded-[2.2rem] bg-background">
        <div className="absolute left-1/2 top-2 z-20 h-5 w-24 -translate-x-1/2 rounded-full bg-neutral-900" aria-hidden />
        {children}
      </div>
    </div>
  );
}

export function ChatHeader({ name, sub, initial, tone = "bg-sky-500" }: { name: string; sub: string; initial: string; tone?: string }) {
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

export function Bubble({ mine, children, time, note }: { mine?: boolean; children: ReactNode; time: string; note?: string }) {
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

export function Composer() {
  return (
    <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-background/95 px-2.5 py-2.5">
      <div className="flex flex-1 items-center gap-2 rounded-full border bg-muted/40 px-3 py-2 text-[12px] text-muted-foreground">
        <Smile className="h-4 w-4" /> <span className="flex-1">Message</span> <Paperclip className="h-4 w-4" />
      </div>
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground"><Mic className="h-4 w-4" /></div>
    </div>
  );
}

export const WALLPAPER = "bg-muted/50 [background-image:radial-gradient(hsl(var(--foreground)/0.06)_1px,transparent_1px)] [background-size:14px_14px]";

export function HeroChat() {
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

export function Wave({ className = "" }: { className?: string }) {
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

export function CallScreen() {
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

export function GroupChat() {
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

export function DesktopWeb() {
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
      <div className="grid h-[300px] grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] sm:h-[340px]">
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

export function BusinessProfile() {
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

export function Story({ title, body, visual, flip, paper, link, children }: {
  title: string; body: ReactNode; visual: ReactNode; flip?: boolean; paper?: boolean;
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

/** Top of an inner page: big headline on warm paper, optional actions and picture. */
export function PageHero({ eyebrow, title, body, actions, visual, testId, children }: {
  eyebrow?: string; title: ReactNode; body?: ReactNode; actions?: ReactNode; visual?: ReactNode; testId?: string; children?: ReactNode;
}) {
  return (
    <section className={`overflow-hidden px-4 pb-16 pt-14 md:pb-24 md:pt-20 ${PAPER}`}>
      <div className={`mx-auto grid max-w-6xl items-center gap-12 ${visual ? "lg:grid-cols-[1.1fr_0.9fr]" : ""}`}>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className={visual ? "" : "max-w-3xl"}>
          {eyebrow && <p className="mb-4 text-sm font-medium uppercase tracking-[0.16em] text-primary">{eyebrow}</p>}
          <h1 className="text-[2.4rem] font-semibold leading-[1.05] tracking-tight sm:text-6xl" data-testid={testId}>{title}</h1>
          {body && <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground md:text-xl">{body}</p>}
          {actions && <div className="mt-9 flex flex-col gap-3 sm:flex-row">{actions}</div>}
          {children}
        </motion.div>
        {visual && (
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.15 }} className="relative flex justify-center">
            <div className="absolute -inset-x-6 bottom-10 top-10 rounded-full bg-primary/10 blur-3xl" aria-hidden />
            <div className="relative">{visual}</div>
          </motion.div>
        )}
      </div>
    </section>
  );
}

export function SectionTitle({ title, body, center }: { title: ReactNode; body?: ReactNode; center?: boolean }) {
  return (
    <motion.div {...reveal} className={center ? "mx-auto max-w-3xl text-center" : "max-w-3xl"}>
      <h2 className="text-[2rem] font-semibold leading-[1.1] tracking-tight sm:text-5xl">{title}</h2>
      {body && <p className="mt-5 text-lg leading-relaxed text-muted-foreground md:text-xl">{body}</p>}
    </motion.div>
  );
}

/** Icon + title + one or two lines; no boxes. */
export function DetailGrid({ items, cols = 3 }: { items: Array<{ icon: typeof Phone; title: string; desc: ReactNode }>; cols?: 2 | 3 }) {
  return (
    <div className={`mt-14 grid gap-x-12 gap-y-10 sm:grid-cols-2 ${cols === 3 ? "lg:grid-cols-3" : ""}`}>
      {items.map((d, i) => (
        <motion.div key={d.title} {...reveal} transition={{ ...reveal.transition, delay: (i % 3) * 0.06 }}>
          <d.icon className="h-6 w-6 text-primary" />
          <h3 className="mt-4 text-lg font-semibold">{d.title}</h3>
          <p className="mt-2 leading-relaxed text-muted-foreground">{d.desc}</p>
        </motion.div>
      ))}
    </div>
  );
}

export function PrimaryAction({ href, children, testId, variant = "solid" }: { href: string; children: ReactNode; testId?: string; variant?: "solid" | "outline" }) {
  return (
    <Link href={href}>
      <Button size="lg" variant={variant === "outline" ? "outline" : "default"} className={`h-12 w-full rounded-full px-7 text-base sm:w-auto ${variant === "outline" ? "bg-background" : ""}`} data-testid={testId}>
        {children}{variant === "solid" && <ArrowRight className="ml-2 h-5 w-5" />}
      </Button>
    </Link>
  );
}

/** Blue closing banner at the bottom of a page. */
export function ClosingBanner({ title, body, children, testId }: { title: string; body: string; children: ReactNode; testId?: string }) {
  return (
    <section className="px-4 pb-24 pt-8">
      <motion.div {...reveal} className="mx-auto max-w-6xl rounded-[2rem] bg-primary px-6 py-16 text-center text-primary-foreground md:py-20">
        <h2 className="mx-auto max-w-3xl text-[2rem] font-semibold leading-[1.1] tracking-tight sm:text-5xl" data-testid={testId}>{title}</h2>
        <p className="mx-auto mt-5 max-w-2xl text-lg opacity-90">{body}</p>
        <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">{children}</div>
      </motion.div>
    </section>
  );
}

/** Business team inbox on a computer. */
export function BusinessInbox() {
  const rows = [
    { n: "Lakshmi", m: "Is the blue saree in stock?", l: "New order", lc: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200", t: "2 min", c: "bg-pink-500" },
    { n: "Arjun", m: "Thank you, received it!", l: "Paid", lc: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200", t: "18 min", c: "bg-sky-500" },
    { n: "Fatima", m: "Can I pick it up today?", l: "Pickup", lc: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200", t: "1 h", c: "bg-orange-500" },
  ];
  return (
    <div className="w-full max-w-[560px] overflow-hidden rounded-2xl border bg-background shadow-[0_30px_80px_-24px_rgba(15,23,42,0.35)]">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <p className="text-sm font-semibold">Inbox · Kiran Sarees</p>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">3 open</span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="border-r">
          {rows.map((r, i) => (
            <div key={r.n} className={`border-b px-3 py-2.5 ${i === 0 ? "bg-muted/60" : ""}`}>
              <div className="flex items-center gap-2">
                <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white ${r.c}`}>{r.n[0]}</div>
                <p className="flex-1 truncate text-[12px] font-medium">{r.n}</p>
                <span className="text-[9.5px] text-muted-foreground">{r.t}</span>
              </div>
              <p className="mt-1 truncate pl-9 text-[10.5px] text-muted-foreground">{r.m}</p>
              <span className={`ml-9 mt-1 inline-block rounded px-1.5 text-[9.5px] ${r.lc}`}>{r.l}</span>
            </div>
          ))}
        </div>
        <div className={`flex flex-col ${WALLPAPER}`}>
          <div className="flex-1 space-y-1.5 p-2.5 text-[11px]">
            <div className="w-fit max-w-[90%] rounded-xl rounded-bl-sm bg-background px-2 py-1 shadow-sm">Is the blue saree in stock?<p className="text-[9px] text-primary">Translated from Tamil</p></div>
            <div className="ml-auto w-fit max-w-[90%] rounded-xl rounded-br-sm bg-primary/15 px-2 py-1 shadow-sm dark:bg-primary/25">Yes! ₹1,200. Shall I keep one for you?<p className="text-[9px] text-muted-foreground">She reads it in Tamil</p></div>
          </div>
          <div className="flex items-center gap-1.5 bg-background/90 p-2"><div className="flex-1 rounded-full border px-2 py-1 text-[10px] text-muted-foreground">Type / for quick replies</div><Send className="h-3.5 w-3.5 text-primary" /></div>
        </div>
      </div>
    </div>
  );
}

/** Customer's chat with a business: catalog item and an order update. */
export function OrderChat() {
  return (
    <PhoneFrame>
      <div className="flex items-center gap-2.5 border-b bg-background px-3 pb-2.5 pt-9">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-pink-500 text-sm font-semibold text-white">K</div>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 truncate text-sm font-semibold leading-tight">Kiran Sarees <BadgeCheck className="h-3.5 w-3.5 text-primary" /></p>
          <p className="text-[11px] text-muted-foreground">Business account</p>
        </div>
      </div>
      <div className={`h-full space-y-2 px-3 pb-24 pt-3 ${WALLPAPER}`}>
        <div className="w-[78%] overflow-hidden rounded-2xl rounded-bl-md bg-background shadow-sm">
          <div className="h-24 bg-gradient-to-br from-sky-200 to-indigo-300 dark:from-sky-800 dark:to-indigo-900" />
          <div className="p-2.5"><p className="text-[12.5px] font-semibold">Blue silk saree</p><p className="text-[11px] text-muted-foreground">₹1,200 · In stock</p></div>
        </div>
        <Bubble mine time="11:20">I'll take one, please.</Bubble>
        <div className="w-[85%] rounded-2xl rounded-bl-md bg-background p-3 shadow-sm">
          <p className="text-[11px] font-semibold text-primary">Order #12</p>
          {["Placed", "Accepted", "Ready for pickup"].map((s) => (
            <p key={s} className="mt-1 flex items-center gap-1.5 text-[12px]"><span className="h-2 w-2 rounded-full bg-primary" />{s}</p>
          ))}
          <p className="mt-1 text-right text-[10px] text-muted-foreground">11:42</p>
        </div>
      </div>
      <Composer />
    </PhoneFrame>
  );
}

/** "Your voice" set-up screen. */
export function VoiceSetup() {
  return (
    <PhoneFrame>
      <div className="h-full bg-background px-4 pt-12">
        <p className="text-lg font-semibold">Your voice</p>
        <p className="mt-1 text-[12px] leading-snug text-muted-foreground">Read three short passages in your language. People will hear your translated words in your voice.</p>
        <div className="mt-5 space-y-2.5">
          {["Passage 1", "Passage 2", "Passage 3"].map((p, i) => (
            <div key={p} className="flex items-center gap-3 rounded-2xl border p-3">
              <span className={`flex h-9 w-9 items-center justify-center rounded-full ${i < 2 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                {i < 2 ? <CheckCheck className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </span>
              <span className="flex-1 text-[13px] font-medium">{p}</span>
              <span className="text-[11px] text-muted-foreground">{i < 2 ? "Recorded" : "Tap to record"}</span>
            </div>
          ))}
        </div>
        <div className="mt-5 rounded-2xl bg-muted/60 p-3 text-[11.5px] leading-snug text-muted-foreground">
          Used only to speak your own words. Switch it off or delete it any time.
        </div>
        <div className="mt-6 flex justify-center"><span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg"><Mic className="h-7 w-7" /></span></div>
      </div>
    </PhoneFrame>
  );
}

