import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, Check, Code2, MessageSquare, Mic, Phone, Video } from "lucide-react";

const PRODUCTS = [
  {
    icon: Phone,
    title: "Translated voice calls",
    desc: "Call anyone on NeuraTalk. Speech and captions are translated for supported language pairs.",
    points: ["Choose a language or use supported automatic detection", "Speech or caption output", "Same language? Nothing is translated"],
  },
  {
    icon: Video,
    title: "Translated video calls",
    desc: "Everything voice calls do, with the camera on.",
    points: ["Same translation as voice calls", "Background noise removed", "Switch the camera on or off mid-call"],
  },
  {
    icon: Mic,
    title: "Your own voice",
    desc: "Record three short passages once. From then on, your translated words are spoken in your voice. Until then, people see captions.",
    points: ["About two minutes to set up", "Used only for your own words", "Switch off or delete any time"],
  },
  {
    icon: MessageSquare,
    title: "Translated chat",
    desc: "Message in your language; they read it in theirs.",
    points: ["Handles mixed Telugu–English, Hindi–English", "Photos, videos and documents", "Voice messages"],
  },
  {
    icon: Building2,
    title: "For businesses",
    desc: "Give your team a way to talk to every customer in the customer's language.",
    points: ["Company account and team members", "Call history", "Admin controls"],
  },
  {
    icon: Code2,
    title: "Developer API",
    desc: "Bring NeuraTalk translation into your own product.",
    points: ["REST API", "Webhooks", "Developer docs"],
  },
];

export default function ProductsPage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-b from-primary/5 to-background">
        <div className="max-w-4xl mx-auto text-center">
          <Badge variant="outline" className="mb-4">Products</Badge>
          <h1 className="text-4xl font-bold mb-4">Talk across languages with live translation</h1>
          <p className="text-lg text-muted-foreground">Calls, video and chat that translate themselves — so the conversation stays human.</p>
        </div>
      </section>

      <section className="py-12 px-4">
        <div className="max-w-6xl mx-auto grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {PRODUCTS.map((p) => (
            <Card key={p.title} className="h-full">
              <CardHeader>
                <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center mb-2">
                  <p.icon className="w-5 h-5 text-primary" />
                </div>
                <CardTitle className="text-lg">{p.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-4 text-sm leading-relaxed">{p.desc}</p>
                <ul className="space-y-2 text-sm">
                  {p.points.map((pt) => (
                    <li key={pt} className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                      {pt}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="py-16 px-4 bg-muted/30">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">Try it on your next call</h2>
          <p className="text-muted-foreground mb-8">New accounts get free translated minutes. No credit card needed.</p>
          <Link href="/login">
            <Button size="lg" data-testid="button-start-free">Start calling free</Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
