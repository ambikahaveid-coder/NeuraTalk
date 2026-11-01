import { Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, AudioLines, Bot, Code2, Megaphone, Users } from "lucide-react";
import { LANGUAGES } from "./site-facts";
import {
  CallScreen, ClosingBanner, DesktopWeb, DetailGrid, GroupChat, HeroChat, PAPER, PageHero, PrimaryAction,
  SectionTitle, Story, VoiceSetup, reveal,
} from "./site-ui";

function Chips({ items }: { items: string[] }) {
  return (
    <div className="mt-6 flex flex-wrap gap-2 text-sm">
      {items.map((t) => <span key={t} className="rounded-full border bg-background px-3 py-1.5">{t}</span>)}
    </div>
  );
}

export default function ProductsPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHero
        eyebrow="Products"
        title={<>One app for every conversation, <span className="text-primary">in every language.</span></>}
        body={`Calls, video, chats, groups and business messages in ${LANGUAGES.length} languages. You talk and write the way you always do; NeuraTalk does the translating.`}
        actions={<>
          <PrimaryAction href="/login" testId="button-start-free">Start calling free</PrimaryAction>
          <PrimaryAction href="/demo" variant="outline">See how a call works</PrimaryAction>
        </>}
      />

      <Story
        title="Calls that speak your language"
        body="Call anyone on NeuraTalk. Each speaker's language is detected automatically, translated speech or captions follow, and when you both speak the same language nothing is translated at all."
        visual={<CallScreen />}
      >
        <Chips items={["Translated voice calls", "Translated video calls", "Group voice and video calls", "Background noise reduced"]} />
      </Story>

      <Story
        paper
        flip
        title="Heard in your own voice"
        body="Record three short passages, or let NeuraTalk learn your voice from a call. Your translated words are then spoken in your voice. Until then, people hear your original voice with translated captions."
        visual={<VoiceSetup />}
      >
        <Chips items={["About two minutes to set up", "Used only for your own words", "Switch off or delete any time"]} />
      </Story>

      <Story
        title="Chat without a language barrier"
        body="Write in your language; they read it in theirs. Mixed Telugu–English or Hindi–English usually works. Tap any message to see what was originally written."
        visual={<HeroChat />}
      >
        <Chips items={["Photos, videos and documents", "Voice messages", "Location", "Polls and contact cards"]} />
      </Story>

      <Story
        paper
        flip
        title="Groups, communities and channels"
        body="Everyone writes in their own language and reads every message in theirs. Bring related groups together in a community, or follow channels for updates."
        visual={<GroupChat />}
      />

      <Story
        title="On your computer, too"
        body="On your computer, open neuratalk.in and tap Log in, then scan the QR code with your phone. Your chats appear on the big screen, and you can sign any computer out from your phone."
        visual={<DesktopWeb />}
        link={{ href: "/login", label: "Open NeuraTalk on your computer — scan the QR code" }}
      />

      <section className={`px-4 py-20 md:py-28 ${PAPER}`}>
        <div className="mx-auto max-w-6xl">
          <SectionTitle title="And a few more things" />
          <DetailGrid items={[
            { icon: AudioLines, title: "In person", desc: "Two people, one phone. Each speaks their language and hears the other in theirs. No second phone needed." },
            { icon: Bot, title: "Assistant", desc: "Ask questions or get help writing a message, in your own language. It can make mistakes, so check important facts." },
            { icon: Megaphone, title: "Status updates", desc: "Share text and photos with the people you chat with. Each viewer reads your words in their language." },
          ]} />
        </div>
      </section>

      {/* For businesses */}
      <section className="px-4 py-12">
        <div className="mx-auto grid max-w-6xl gap-6 md:grid-cols-2">
          {[
            { icon: Users, title: "NeuraTalk Business", desc: "A separate app for shops, clinics and companies to chat with and call customers in their languages. Verified tick after NeuraTalk's check, catalog, orders, quick replies and labels.", href: "/business", label: "Explore NeuraTalk Business" },
            { icon: Code2, title: "Business API", desc: "Send order updates and login codes from your own systems. API keys per business, approved templates only, signed webhooks.", href: "/sdk-docs", label: "Read the API docs" },
          ].map((c) => (
            <motion.div key={c.title} {...reveal} className="rounded-[2rem] bg-slate-900 p-8 text-white md:p-10 dark:ring-1 dark:ring-white/10">
              <c.icon className="h-7 w-7 text-sky-300" />
              <h3 className="mt-5 text-2xl font-semibold">{c.title}</h3>
              <p className="mt-3 leading-relaxed text-white/70">{c.desc}</p>
              <Link href={c.href} className="mt-6 inline-flex items-center gap-1.5 font-medium text-sky-300 hover:underline">{c.label} <ArrowRight className="h-4 w-4" /></Link>
            </motion.div>
          ))}
        </div>
      </section>

      <ClosingBanner title="Try it on your next call" body="New accounts get 5 free AI translation minutes. No credit card needed.">
        <PrimaryAction href="/login" variant="outline">Create free account</PrimaryAction>
      </ClosingBanner>
    </div>
  );
}

