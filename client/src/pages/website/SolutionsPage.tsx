import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, Headphones, Hospital, Users, Plane, ShoppingBag, Play, ArrowRight } from "lucide-react";

export default function SolutionsPage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <Badge className="mb-4">Solutions</Badge>
          <h1 className="text-4xl font-bold mb-6">Built for Real Business Needs</h1>
          <p className="text-xl text-muted-foreground mb-8">
            From call centers to hospitals, NeuraTalk adapts to your industry
          </p>
          <Link href="/demo">
            <Button size="lg" className="gap-2" data-testid="button-solutions-demo">
              <Play className="w-5 h-5" />
              See How It Works
              <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl font-bold mb-8">B2B Solutions</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            <Card className="hover-elevate">
              <CardHeader>
                <Headphones className="w-10 h-10 mb-2 text-primary" />
                <CardTitle>Call Centers</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-4">
                  Handle customers in any language with a single team. Reduce hiring costs 
                  while expanding your reach.
                </p>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li>Real-time call translation</li>
                  <li>Agent performance analytics</li>
                  <li>Quality monitoring</li>
                  <li>CRM integration ready</li>
                </ul>
              </CardContent>
            </Card>

            <Card className="hover-elevate">
              <CardHeader>
                <Hospital className="w-10 h-10 mb-2 text-primary" />
                <CardTitle>Healthcare</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-4">
                  Help patients explain symptoms in their language. 
                  Doctors receive accurate translations with medical context.
                </p>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li>Patient-doctor translation</li>
                  <li>Medical terminology aware</li>
                  <li>HIPAA-ready architecture</li>
                  <li>Emergency hotline support</li>
                </ul>
              </CardContent>
            </Card>

            <Card className="hover-elevate">
              <CardHeader>
                <Building2 className="w-10 h-10 mb-2 text-primary" />
                <CardTitle>Enterprise</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-4">
                  Connect global teams seamlessly. Every meeting, every call, 
                  everyone understands.
                </p>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li>Video conference translation</li>
                  <li>Meeting transcription</li>
                  <li>Team collaboration tools</li>
                  <li>SSO integration</li>
                </ul>
              </CardContent>
            </Card>

            <Card className="hover-elevate">
              <CardHeader>
                <Plane className="w-10 h-10 mb-2 text-primary" />
                <CardTitle>Travel & Tourism</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-4">
                  Serve international travelers in their language. 
                  From booking to checkout.
                </p>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li>Guest service translation</li>
                  <li>Booking assistance</li>
                  <li>Concierge support</li>
                  <li>Emergency communication</li>
                </ul>
              </CardContent>
            </Card>

            <Card className="hover-elevate">
              <CardHeader>
                <ShoppingBag className="w-10 h-10 mb-2 text-primary" />
                <CardTitle>E-commerce</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-4">
                  Customer support in regional languages. 
                  Reduce returns with better communication.
                </p>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li>Order support calls</li>
                  <li>Return/refund handling</li>
                  <li>Product assistance</li>
                  <li>COD verification</li>
                </ul>
              </CardContent>
            </Card>

            <Card className="hover-elevate">
              <CardHeader>
                <Users className="w-10 h-10 mb-2 text-primary" />
                <CardTitle>BPO & Outsourcing</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-4">
                  Expand service offerings without multilingual hiring. 
                  Serve more markets instantly.
                </p>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li>Multi-client support</li>
                  <li>Quality assurance</li>
                  <li>Performance reporting</li>
                  <li>White-label options</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <section className="py-16 px-4 bg-muted/30">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl font-bold mb-8">B2C Solutions</h2>
          <div className="grid md:grid-cols-3 gap-6">
            <Card>
              <CardContent className="p-6">
                <h3 className="font-semibold mb-2">Family Communication</h3>
                <p className="text-sm text-muted-foreground">
                  Talk to grandparents in Telugu while they respond in their dialect. 
                  Stay connected across generations.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <h3 className="font-semibold mb-2">Language Learning</h3>
                <p className="text-sm text-muted-foreground">
                  Practice conversations with AI that corrects pronunciation 
                  and suggests better phrasing.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <h3 className="font-semibold mb-2">Daily Assistance</h3>
                <p className="text-sm text-muted-foreground">
                  Get help from government offices, banks, or services 
                  even when they don't speak your language.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-6">Custom Solutions</h2>
          <p className="text-muted-foreground mb-8">
            Have a unique use case? We build custom integrations for enterprise clients.
          </p>
          <Link href="/contact">
            <Button size="lg" data-testid="button-contact-sales">
              Contact Sales
            </Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
