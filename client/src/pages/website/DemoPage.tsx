import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Captions, Info, Languages, Pause, Play, RotateCcw, UserRound, Volume2 } from "lucide-react";
import { ClosingBanner, DetailGrid, PAPER, PageHero, PrimaryAction, SectionTitle, Wave, reveal } from "./site-ui";

type Turn = {
  speaker: "ravi" | "sarah";
  said: string;
  saidLanguage: string;
  heard: string;
  heardLanguage: string;
};

/** A scripted example call. Real calls show none of this text. */
export const DEMO_CALL: Turn[] = [
  { speaker: "ravi", said: "నమస్కారం సారా, మీ ఆర్డర్ గురించి కాల్ చేస్తున్నాను.", saidLanguage: "Telugu", heard: "Hello Sarah, I'm calling about your order.", heardLanguage: "English" },
  { speaker: "sarah", said: "Oh hi Ravi! Is it shipped yet?", saidLanguage: "English", heard: "ఓ హాయ్ రవి! అది షిప్ అయ్యిందా?", heardLanguage: "Telugu" },
  { speaker: "ravi", said: "అవును, రేపు సాయంత్రానికి మీకు చేరుతుంది.", saidLanguage: "Telugu", heard: "Yes, it will reach you by tomorrow evening.", heardLanguage: "English" },
  { speaker: "sarah", said: "That's great, thank you so much!", saidLanguage: "English", heard: "చాలా బాగుంది, చాలా ధన్యవాదాలు!", heardLanguage: "Telugu" },
];

const PEOPLE = {
  ravi: { name: "Ravi", initial: "R", language: "Telugu", tone: "from-amber-300 to-orange-500" },
  sarah: { name: "Sarah", initial: "S", language: "English", tone: "from-sky-300 to-indigo-500" },
};

const STEP_MS = 3800;

export default function DemoPage() {
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    if (index >= DEMO_CALL.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setIndex((i) => i + 1), index < 0 ? 300 : STEP_MS);
    return () => clearTimeout(timer);
  }, [playing, index]);

  const turn = index >= 0 ? DEMO_CALL[index] : null;
  const finished = index >= DEMO_CALL.length - 1 && !playing;

  const toggle = () => {
    if (finished) {
      setIndex(-1);
      setPlaying(true);
      return;
    }
    setPlaying((p) => !p);
  };

  return (
    <div className="min-h-screen bg-background">
      <PageHero
        eyebrow="How a call works"
        testId="text-demo-title"
        title={<>Ravi speaks Telugu. <span className="text-primary">Sarah speaks English.</span></>}
        body="Press play to follow a scripted Telugu–English example. Real call voice and language support depend on the configured providers and voice profiles."
      />

      <section className="px-4 py-16 md:py-20">
        <div className="mx-auto max-w-5xl">
          <div className="grid gap-5 md:grid-cols-2">
            {(["ravi", "sarah"] as const).map((who) => {
              const person = PEOPLE[who];
              const speaking = turn?.speaker === who;
              const hearing = Boolean(turn && turn.speaker !== who);
              return (
                <div
                  key={who}
                  className={`rounded-[2rem] bg-gradient-to-b from-slate-800 to-slate-950 p-6 text-white transition-shadow sm:p-8 ${speaking ? "shadow-[0_0_0_3px_hsl(var(--primary))]" : ""}`}
                  data-testid={`demo-person-${who}`}
                >
                  <div className="flex items-center gap-4">
                    <div className={`flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br text-xl font-semibold ${person.tone}`}>{person.initial}</div>
                    <div>
                      <p className="text-lg font-semibold">{person.name}</p>
                      <p className="text-sm text-white/60">speaks {person.language}</p>
                    </div>
                    <span className="ml-auto rounded-full bg-white/10 px-3 py-1 text-xs text-white/80">{speaking ? "talking" : hearing ? "listening" : "on call"}</span>
                  </div>
                  <div className="mt-6 h-10">{speaking ? <Wave className="text-sky-300" /> : <div className="h-10" />}</div>
                  <div className="mt-4 min-h-[110px]">
                    {!turn && (
                      <p className="text-white/60">{who === "ravi" ? "Press play below to start the call." : "Waiting for Ravi…"}</p>
                    )}
                    <AnimatePresence mode="wait">
                      {turn && (
                        <motion.div
                          key={`${index}-${who}`}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.3, delay: speaking ? 0 : 0.9 }}
                        >
                          {speaking ? (
                            <>
                              <p className="mb-1.5 text-xs uppercase tracking-wider text-white/50">Says, in {turn.saidLanguage}</p>
                              <p className="text-xl leading-snug">“{turn.said}”</p>
                            </>
                          ) : (
                            <>
                              <p className="mb-1.5 flex items-center gap-1 text-xs uppercase tracking-wider text-sky-300">
                                <Volume2 className="h-3.5 w-3.5" />Hears, in {turn.heardLanguage} · {PEOPLE[turn.speaker].name}'s voice
                              </p>
                              <p className="text-xl leading-snug">“{turn.heard}”</p>
                            </>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-8 flex flex-col items-center gap-4">
            <Button size="lg" className="h-12 rounded-full px-8 text-base" onClick={toggle} data-testid="button-demo-play">
              {playing ? <><Pause className="mr-2 h-5 w-5" />Pause</> : finished ? <><RotateCcw className="mr-2 h-5 w-5" />Play again</> : <><Play className="mr-2 h-5 w-5" />{index < 0 ? "Play the call" : "Continue"}</>}
            </Button>
            <div className="flex gap-1.5" aria-hidden>
              {DEMO_CALL.map((_, i) => (
                <span key={i} data-testid={i <= index ? "demo-progress-done" : "demo-progress-todo"} className={`h-1.5 w-10 rounded-full ${i <= index ? "bg-primary" : "bg-muted"}`} />
              ))}
            </div>
          </div>

          <div className="mx-auto mt-10 flex max-w-3xl items-start gap-3 rounded-2xl border bg-muted/40 p-5 text-sm text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <p>This is a scripted text example, not live call audio. In a real call, translated speech or captions depend on language and provider availability.</p>
          </div>
        </div>
      </section>

      {/* What happens in a real call */}
      <section className={`px-4 py-20 md:py-28 ${PAPER}`}>
        <div className="mx-auto max-w-6xl">
          <SectionTitle title="What happens in a real call" body="Three things happen. You only do the first one." />
          <div className="mt-14 grid gap-10 md:grid-cols-3">
            {[
              { title: "Call like you always do", desc: "Pick a contact, then choose voice or video and your translation language settings." },
              { title: "Talk in your language", desc: "Each person speaks the way they normally do. NeuraTalk hears which language it is." },
              { title: "They hear you, in your voice", desc: "Your words reach them translated, in your own voice. Not recorded yet? They see captions instead. Same language? Nothing is translated." },
            ].map((s, i) => (
              <motion.div key={s.title} {...reveal} transition={{ ...reveal.transition, delay: i * 0.08 }} className="border-t pt-6">
                <p className="text-5xl font-semibold text-primary/30">{i + 1}</p>
                <h3 className="mt-4 text-xl font-semibold">{s.title}</h3>
                <p className="mt-2 leading-relaxed text-muted-foreground">{s.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 py-20 md:py-28">
        <div className="mx-auto max-w-6xl">
          <SectionTitle title="You stay in charge of the call" />
          <DetailGrid items={[
            { icon: Languages, title: "Languages can be selected", desc: "Supported languages can be detected automatically, or selected before calling." },
            { icon: Captions, title: "Captions are optional", desc: "Listeners can choose translated voice or captions." },
            { icon: UserRound, title: "Nobody hears a robot", desc: "Each person hears the other's own voice, recorded once in the app. Without a recording, captions are shown instead." },
          ]} />
        </div>
      </section>

      <ClosingBanner title="Try it on a real call" testId="text-demo-cta" body="Sign up, record your voice, and call someone who speaks another language.">
        <PrimaryAction href="/login" variant="outline">Start calling free</PrimaryAction>
      </ClosingBanner>
    </div>
  );
}
