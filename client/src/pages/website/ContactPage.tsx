import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ArrowRight, Clock, Mail, MapPin, Phone } from "lucide-react";
import { COMPANY } from "./site-facts";
import { PageHero } from "./site-ui";

export default function ContactPage() {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    const formData = new FormData(e.target as HTMLFormElement);
    try {
      const response = await fetch("/api/website/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.get("name"),
          email: formData.get("email"),
          phone: formData.get("phone"),
          inquiry: formData.get("inquiry"),
          company: formData.get("company"),
          message: formData.get("message"),
        }),
      });
      const data = await response.json();
      if (response.ok) {
        toast({ title: "Message sent", description: data.message || "We'll get back to you within 24 hours." });
        (e.target as HTMLFormElement).reset();
      } else {
        toast({ title: "Couldn't send", description: data.error || "Failed to send message", variant: "destructive" });
      }
    } catch {
      toast({ title: "Couldn't send", description: "Network error. Please try again.", variant: "destructive" });
    }
    setIsSubmitting(false);
  };

  const rows = [
    { icon: Mail, title: "Email", body: <a href={`mailto:${COMPANY.email}`} className="font-medium hover:text-primary">{COMPANY.email}</a>, note: "Support, sales and partnerships" },
    { icon: Phone, title: "Phone", body: <a href={COMPANY.phoneHref} className="font-medium hover:text-primary">{COMPANY.phone}</a> },
    { icon: Clock, title: "Support hours", body: <span className="font-medium">Mon–Fri 9:00 AM – 6:00 PM · Sat 10:00 AM – 2:00 PM</span>, note: "Indian Standard Time" },
    { icon: MapPin, title: "Office", body: <span className="font-medium">{COMPANY.shortName}</span>, note: COMPANY.address },
  ];

  return (
    <div className="min-h-screen bg-background">
      <PageHero eyebrow="Contact" title="Talk to a person at NeuraTalk" body="Questions about your account, a business on NeuraTalk, or working with us. Write to us and we'll reply." />

      <section className="px-4 py-16 md:py-20">
        <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-3xl border bg-background p-6 sm:p-10">
            <h2 className="text-2xl font-semibold">Send us a message</h2>
            <form onSubmit={handleSubmit} className="mt-8 space-y-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">Full name</Label>
                  <Input id="name" name="name" required placeholder="Your name" className="h-11" data-testid="input-contact-name" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" name="email" type="email" required placeholder="you@company.com" className="h-11" data-testid="input-contact-email" />
                </div>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone number</Label>
                  <Input id="phone" name="phone" placeholder="+91 98765 43210" className="h-11" data-testid="input-contact-phone" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="inquiry">What is it about?</Label>
                  <Select name="inquiry" defaultValue="general">
                    <SelectTrigger className="h-11" data-testid="select-inquiry-type"><SelectValue placeholder="Select type" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="general">General question</SelectItem>
                      <SelectItem value="sales">NeuraTalk Business / sales</SelectItem>
                      <SelectItem value="support">Help with the app</SelectItem>
                      <SelectItem value="partnership">Partnership</SelectItem>
                      <SelectItem value="enterprise">Enterprise plan</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="company">Company name (optional)</Label>
                <Input id="company" name="company" placeholder="Your company" className="h-11" data-testid="input-contact-company" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="message">Message</Label>
                <Textarea id="message" name="message" required rows={6} placeholder="Tell us how we can help…" data-testid="input-contact-message" />
              </div>
              <Button type="submit" className="h-12 w-full rounded-full text-base" disabled={isSubmitting} data-testid="button-submit-contact">
                {isSubmitting ? "Sending…" : "Send message"}
              </Button>
            </form>
          </div>

          <div>
            <div className="divide-y">
              {rows.map((r) => (
                <div key={r.title} className="flex gap-4 py-6 first:pt-0">
                  <r.icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <p className="text-sm text-muted-foreground">{r.title}</p>
                    <div className="mt-1 break-words">{r.body}</div>
                    {r.note && <p className="mt-1 text-sm text-muted-foreground">{r.note}</p>}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 rounded-3xl bg-muted/50 p-6">
              <p className="font-semibold">Looking for something specific?</p>
              <ul className="mt-3 space-y-2 text-sm">
                {[
                  ["/help", "Help Center — answers to common questions"],
                  ["/report-abuse", "Report abuse or a fake account"],
                  ["/grievance", "Grievance Officer (IT Rules 2021)"],
                  ["/business", "Bring your business to NeuraTalk"],
                ].map(([href, label]) => (
                  <li key={href}><Link href={href} className="inline-flex items-center gap-1.5 text-primary hover:underline">{label} <ArrowRight className="h-3.5 w-3.5" /></Link></li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
