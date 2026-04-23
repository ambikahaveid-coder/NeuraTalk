import { Card, CardContent } from "@/components/ui/card";
import { Globe, Heart, Shield, Users } from "lucide-react";

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-6">About NeuraTalk</h1>
          <p className="text-xl text-muted-foreground">
            Breaking language barriers, one conversation at a time.
          </p>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold mb-6">Our Story</h2>
          <div className="space-y-4 text-muted-foreground">
            <p>
              NeuraTalk was born from a simple observation: language should bring people together, 
              not keep them apart. Every day, millions of conversations are limited by language barriers - 
              families separated by migration, businesses unable to serve customers, patients struggling 
              to explain symptoms to doctors.
            </p>
            <p>
              We built NeuraTalk to change that. Using advanced AI, we enable real-time voice translation 
              that preserves not just words, but emotion, tone, and intent. When you speak Telugu and 
              your customer speaks English, NeuraTalk makes it feel like you're speaking the same language.
            </p>
            <p>
              What makes us different? We're 100% self-hosted. Your voice data never touches third-party 
              servers. No Twilio, no Agora, no external telecom services. Just pure, secure, 
              privacy-respecting technology that works.
            </p>
          </div>
        </div>
      </section>

      <section className="py-16 px-4 bg-muted/30">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-12">Our Values</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            <Card>
              <CardContent className="p-6 text-center">
                <Heart className="w-10 h-10 mx-auto mb-4 text-primary" />
                <h3 className="font-semibold mb-2">Human First</h3>
                <p className="text-sm text-muted-foreground">
                  Technology serves people, not the other way around
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6 text-center">
                <Shield className="w-10 h-10 mx-auto mb-4 text-primary" />
                <h3 className="font-semibold mb-2">Privacy by Design</h3>
                <p className="text-sm text-muted-foreground">
                  Your conversations stay yours, always
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6 text-center">
                <Globe className="w-10 h-10 mx-auto mb-4 text-primary" />
                <h3 className="font-semibold mb-2">Local Languages</h3>
                <p className="text-sm text-muted-foreground">
                  Real Telugu, Tamil, Kannada - not textbook translations
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6 text-center">
                <Users className="w-10 h-10 mx-auto mb-4 text-primary" />
                <h3 className="font-semibold mb-2">Inclusive Access</h3>
                <p className="text-sm text-muted-foreground">
                  Affordable pricing for individuals and businesses
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold mb-6">Our Technology</h2>
          <div className="space-y-4 text-muted-foreground">
            <p>
              NeuraTalk uses a proprietary, self-hosted communication infrastructure. We don't rely on 
              external telecom APIs or cloud calling services. Every component - from signaling to 
              media relay to translation - runs on our own servers.
            </p>
            <p>
              This means: No phone numbers assigned by us, no call interception, no hidden data collection. 
              We work alongside your existing phone service, enhancing calls rather than replacing them.
            </p>
            <p>
              Our AI understands context, emotion, and cultural nuances. When someone speaks angrily, 
              the translation preserves that anger. When someone speaks softly with care, 
              that tenderness comes through. This is what makes NeuraTalk feel human.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
