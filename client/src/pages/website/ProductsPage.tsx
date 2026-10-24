import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AudioLines, Bot, Building2, Check, Code2, MessageSquare, Mic, Phone, Users, Video } from "lucide-react";
import { LANGUAGES } from "./site-facts";

const PRODUCTS = [
  {
    icon: Phone,
    title: "Translated voice calls",
    desc: "Call anyone on NeuraTalk. Each person speaks their language and hears the other in theirs.",
    points: ["Each speaker's language detected automatically", "Translated speech, or captions if you prefer", "Same language? Nothing is translated"],
  },
  {
    icon: Video,
    title: "Translated video calls",
    desc: "Everything voice calls do, with the camera on — one-to-one or in a group.",
    points: ["Group voice and video calls", "Background noise reduced", "Switch the camera on or off mid-call"],
  },
  {
    icon: Mic,
    title: "Your own voice",
    desc: "Record three short passages, or let NeuraTalk learn your voice from a call. Your translated words are then spoken in your voice.",
    points: ["About two minutes to set up", "Used only for your own words", "Switch off or delete any time"],
  },
  {
    icon: MessageSquare,
    title: "Translated chat",
    desc: "Write in your language; they read it in theirs. Tap a message to see the original.",
    points: ["Handles mixed Telugu–English, Hindi–English", "Photos, videos, documents and location", "Voice messages with transcripts"],
  },
  {
    icon: Users,
    title: "Group chats",
    desc: "Everyone writes in their own language and reads every message in theirs.",
    points: ["Photos and files for the whole group", "Group info and members", "Translated for each member"],
  },
  {
    icon: AudioLines,
    title: "In person",
    desc: "Two people, one phone. Each speaks their language and hears the other in theirs.",
    points: ["No second phone needed", "Works face to face", "Same languages as calls"],
  },
  {
    icon: Bot,
    title: "Assistant",
    desc: "Ask questions or get help writing a message, in your own language.",
    points: ["Built into the app", "Answers in your language", "Can make mistakes — check important facts"],
  },
  {
    icon: Building2,
    title: "NeuraTalk Business",
    desc: "A separate app for businesses to chat with and call customers in their languages.",
    points: ["Verified tick after NeuraTalk's check", "Catalog, automatic replies, quick replies, labels", "Updates, login codes and offers under clear rules"],
    href: "/business",
  },
  {
    icon: Code2,
    title: "Business API",
    desc: "Send order updates and login codes from your own systems.",
    points: ["API keys per business", "Approved templates only", "Signed webhooks"],
    href: "/sdk-docs",
  },
];

export default function ProductsPage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-b from-primary/5 to-background">
        <div className="max-w-4xl mx-auto text-center">
          <Badge variant="outline" className="mb-4">Products</Badge>
          <h1 className="text-4xl font-bold mb-4">Talk across languages with live translation</h1>
          <p className="text-lg text-muted-foreground">Calls, video, chats and business messages in {LANGUAGES.length} languages — so the conversation stays human.</p>
        </div>
      </section>

      <section className="py-12 px-4">
        <div className="max-w-6xl mx-auto grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {PRODUCTS.map((p) => (
            <Card key={p.title} className="h-full flex flex-col">
              <CardHeader>
                <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center mb-2">
                  <p.icon className="w-5 h-5 text-primary" />
                </div>
                <CardTitle className="text-lg">{p.title}</CardTitle>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col">
                <p className="text-muted-foreground mb-4 text-sm leading-relaxed">{p.desc}</p>
                <ul className="space-y-2 text-sm">
                  {p.points.map((pt) => (
                    <li key={pt} className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                      {pt}
                    </li>
                  ))}
                </ul>
                {p.href && <Link href={p.href} className="mt-4 text-sm text-primary underline">Learn more</Link>}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="py-16 px-4 bg-muted/30">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">Try it on your next call</h2>
          <p className="text-muted-foreground mb-8">New accounts get 15 free translated call minutes. No credit card needed.</p>
          <Link href="/login">
            <Button size="lg" data-testid="button-start-free">Start calling free</Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
