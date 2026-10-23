import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, AudioLines, Info, Pause, Play, RotateCcw, Volume2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

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
  ravi: { name: "Ravi", initial: "R", language: "Telugu" },
  sarah: { name: "Sarah", initial: "S", language: "English" },
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
      <section className="py-16 px-4 bg-gradient-to-b from-primary/5 to-background">
        <div className="max-w-3xl mx-auto text-center">
          <Badge variant="outline" className="mb-4">How a call works</Badge>
          <h1 className="text-4xl md:text-5xl font-bold mb-4" data-testid="text-demo-title">Ravi speaks Telugu. Sarah speaks English.</h1>
          <p className="text-lg text-muted-foreground">
            Press play to follow a scripted Telugu-English example. Real call voice and language support depend on the configured providers and voice profiles.
          </p>
        </div>
      </section>

      <section className="px-4 pb-16">
        <div className="max-w-4xl mx-auto">
          <div className="grid md:grid-cols-2 gap-4">
            {(["ravi", "sarah"] as const).map((who) => {
              const person = PEOPLE[who];
              const speaking = turn?.speaker === who;
              const hearing = turn && turn.speaker !== who;
              return (
                <Card key={who} className={`transition-colors ${speaking ? "border-primary" : ""}`} data-testid={`demo-person-${who}`}>
                  <CardContent className="p-6">
                    <div className="flex items-center gap-3 mb-5">
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center font-semibold text-lg ${speaking ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                        {person.initial}
                      </div>
                      <div>
                        <p className="font-semibold">{person.name}</p>
                        <p className="text-xs text-muted-foreground">speaks {person.language}</p>
                      </div>
                      <div className="ml-auto text-xs text-muted-foreground">
                        {speaking ? "talking" : hearing ? "listening" : ""}
                      </div>
                    </div>
                    <div className="min-h-[96px]">
                      {!turn && (
                        <p className="text-sm text-muted-foreground">
                          {who === "ravi" ? "Press play below to start the call." : "Waiting for Ravi…"}
                        </p>
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
                                <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Says, in {turn.saidLanguage}</p>
                                <p className="text-lg leading-snug">“{turn.said}”</p>
                              </>
                            ) : (
                              <>
                                <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
                                  <Volume2 className="w-3.5 h-3.5" />Hears, in {turn.heardLanguage} · {PEOPLE[turn.speaker].name}'s voice
                                </p>
                                <p className="text-lg leading-snug">“{turn.heard}”</p>
                              </>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="flex flex-col items-center gap-3 mt-6">
            <div className="flex gap-2">
              <Button size="lg" onClick={toggle} data-testid="button-demo-play">
                {playing ? <><Pause className="w-5 h-5 mr-2" />Pause</> : finished ? <><RotateCcw className="w-5 h-5 mr-2" />Play again</> : <><Play className="w-5 h-5 mr-2" />{index < 0 ? "Play the call" : "Continue"}</>}
              </Button>
            </div>
            <div className="flex gap-1.5" aria-hidden>
              {DEMO_CALL.map((_, i) => (
                <span key={i} data-testid={i <= index ? "demo-progress-done" : "demo-progress-todo"} className={`h-1.5 w-8 rounded-full ${i <= index ? "bg-primary" : "bg-muted"}`} />
              ))}
            </div>
          </div>

          <div className="mt-8 flex items-start gap-3 rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
            <Info className="w-4 h-4 mt-0.5 shrink-0" />
            <p>
              This is a scripted text example, not live call audio. In a real call, translated speech or captions depend on language and provider availability.
            </p>
          </div>
        </div>
      </section>

      <section className="py-16 px-4 bg-muted/30">
        <div className="max-w-5xl mx-auto grid md:grid-cols-3 gap-6">
          {[
            { title: "Languages can be selected", desc: "Supported languages can be detected automatically, or selected before calling." },
            { title: "Captions are optional", desc: "Listeners can choose translated voice or captions." },
            { title: "Nobody heard a robot", desc: "Each heard the other's own voice, recorded once in the app. Without a recording, captions are shown instead." },
          ].map((p) => (
            <div key={p.title} className="flex gap-3">
              <AudioLines className="w-5 h-5 text-primary mt-0.5 shrink-0" />
              <div>
                <h3 className="font-semibold mb-1">{p.title}</h3>
                <p className="text-sm text-muted-foreground">{p.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4" data-testid="text-demo-cta">Try it on a real call</h2>
          <p className="text-muted-foreground mb-8">Sign up, record your voice, and call someone who speaks another language.</p>
          <Link href="/login">
            <Button size="lg">Start calling free <ArrowRight className="ml-2 w-5 h-5" /></Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
