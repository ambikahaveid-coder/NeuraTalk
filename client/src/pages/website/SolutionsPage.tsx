import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ArrowRight, Building2, Headphones, Home, Hospital, Plane, ShoppingBag, Store, Users } from "lucide-react";

const BUSINESS = [
  {
    icon: Store,
    title: "Shops and local businesses",
    desc: "Answer customers in their language, share your catalog, and send order updates — all from the NeuraTalk Business app.",
    points: ["Chat link and QR code at the counter", "Catalog with photos and prices", "Greeting and away messages"],
  },
  {
    icon: ShoppingBag,
    title: "E-commerce and delivery",
    desc: "Order, delivery and return conversations in the customer's language, plus login codes and updates from your own systems.",
    points: ["Utility updates from approved templates", "In-app login codes (OTP)", "Translated calls for delivery questions"],
  },
  {
    icon: Headphones,
    title: "Customer support teams",
    desc: "One team can help customers who speak different languages. Every agent reads and writes in their own.",
    points: ["Shared team inbox with assignment", "Quick replies and labels", "Translated calls with customers"],
  },
  {
    icon: Hospital,
    title: "Clinics and hospitals",
    desc: "Help patients describe how they feel in their own words, and give appointment updates in their language.",
    points: ["Patients speak and hear their language", "Appointment reminders as utility updates", "Call audio is never recorded"],
    caution: "Automatic translation can be wrong. Do not rely on it for diagnosis, consent or emergencies; use a qualified interpreter.",
  },
  {
    icon: Plane,
    title: "Travel and hospitality",
    desc: "Talk to guests before and during their stay, whatever language they speak.",
    points: ["Chat and call guests in their language", "Share your location and photos", "Staff use their own language"],
  },
  {
    icon: Building2,
    title: "Teams across languages",
    desc: "Colleagues who don't share a language can call, video-call and chat with translation.",
    points: ["Group voice and video calls", "Translated group chats", "Company accounts with team members"],
  },
];

const PEOPLE = [
  { icon: Home, title: "Family across generations", desc: "Talk to grandparents who speak Telugu or Hindi while you answer in the language you're most comfortable with." },
  { icon: Users, title: "Friends and colleagues", desc: "Stay close to people who speak another language — in your own voice." },
  { icon: Plane, title: "Working or studying away", desc: "Keep in touch with landlords, employers and new friends in a new city or country, when they're on NeuraTalk too." },
];

export default function SolutionsPage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <Badge className="mb-4">Solutions</Badge>
          <h1 className="text-4xl font-bold mb-6">Wherever language gets in the way</h1>
          <p className="text-xl text-muted-foreground mb-8">For businesses that serve customers in many languages, and for people whose families and friends speak another one.</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/business"><Button size="lg" className="gap-2" data-testid="button-solutions-business">NeuraTalk Business <ArrowRight className="w-4 h-4" /></Button></Link>
            <Link href="/demo"><Button size="lg" variant="outline" data-testid="button-solutions-demo">See how a call works</Button></Link>
          </div>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl font-bold mb-8">For businesses</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {BUSINESS.map((b) => (
              <Card key={b.title} className="h-full">
                <CardHeader>
                  <b.icon className="w-10 h-10 mb-2 text-primary" />
                  <CardTitle>{b.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground mb-4">{b.desc}</p>
                  <ul className="space-y-2 text-sm text-muted-foreground list-disc pl-5">
                    {b.points.map((p) => <li key={p}>{p}</li>)}
                  </ul>
                  {b.caution && (
                    <p className="mt-4 text-xs flex items-start gap-2 text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="w-4 h-4 shrink-0" />{b.caution}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 px-4 bg-muted/30">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl font-bold mb-8">For people</h2>
          <div className="grid md:grid-cols-3 gap-6">
            {PEOPLE.map((p) => (
              <Card key={p.title}><CardContent className="p-6">
                <p.icon className="w-8 h-8 text-primary mb-3" />
                <h3 className="font-semibold mb-2">{p.title}</h3>
                <p className="text-sm text-muted-foreground">{p.desc}</p>
              </CardContent></Card>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-6">Have a specific need?</h2>
          <p className="text-muted-foreground mb-8">Tell us how your team or customers communicate, and we'll tell you honestly whether NeuraTalk fits.</p>
          <Link href="/contact"><Button size="lg" data-testid="button-contact-sales">Talk to us</Button></Link>
        </div>
      </section>
    </div>
  );
}
