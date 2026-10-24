import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, Building2, User, Zap } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface BillingPlan {
  id: number;
  name: string;
  displayName?: string;
  type: string;
  description: string;
  priceMonthly: string;
  priceYearly: string;
  priceFormatted?: string;
  currency: string;
  features: string[];
  tierLabel?: string;
  ratePerSecondFormatted?: string;
  ratePerMinuteFormatted?: string;
  standards?: {
    voiceCalls: boolean;
    videoCalls: boolean;
    faceToFace: boolean;
    emotionAware: boolean;
    apiAccess: boolean;
  };
  isActive: boolean;
  callMinutesIncluded: number;
  translationMinutesIncluded: number;
  voiceMinutesIncluded: number;
  usersIncluded: number;
}

export default function PricingPage() {
  const { data: plans, isLoading } = useQuery<BillingPlan[]>({
    queryKey: ["/api/billing/plans"],
  });

  const b2cPlans = plans?.filter(p => p.type === "b2c") || [];
  const b2bPlans = plans?.filter(p => p.type === "b2b") || [];
  const planLabel = (plan: BillingPlan) => plan.displayName || plan.name;

  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <Badge className="mb-4" data-testid="badge-pricing">Pricing</Badge>
          <h1 className="text-4xl font-bold mb-6" data-testid="text-pricing-title">
            Pay only for translated minutes
          </h1>
          <p className="text-xl text-muted-foreground">
            Every new account gets 15 free translated call minutes. Prices in Indian Rupees.
          </p>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-2 mb-8">
            <User className="w-6 h-6 text-primary" />
            <h2 className="text-2xl font-bold" data-testid="text-individual-plans">Individual Plans</h2>
          </div>

          {isLoading ? (
            <div className="grid md:grid-cols-3 gap-6">
              {[1, 2, 3].map((i) => (
                <Card key={i} className="animate-pulse">
                  <CardHeader>
                    <div className="h-6 bg-muted rounded w-1/2 mb-2" />
                    <div className="h-4 bg-muted rounded w-3/4" />
                  </CardHeader>
                  <CardContent>
                    <div className="h-8 bg-muted rounded w-1/3 mb-4" />
                    <div className="space-y-2">
                      {[1, 2, 3, 4].map((j) => (
                        <div key={j} className="h-4 bg-muted rounded" />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : b2cPlans.length > 0 ? (
            <div className="grid md:grid-cols-3 gap-6">
              {b2cPlans.map((plan) => (
                <Card 
                  key={plan.id} 
                  className={`hover-elevate relative ${plan.tierLabel === "premium" ? 'border-primary' : ''}`}
                  data-testid={`card-plan-${plan.id}`}
                >
                  {plan.tierLabel === "premium" && (
                    <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">Popular</Badge>
                  )}
                  <CardHeader>
                    <CardTitle data-testid={`text-plan-name-${plan.id}`}>{planLabel(plan)}</CardTitle>
                    <CardDescription>{plan.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="mb-6">
                      <span className="text-3xl font-bold" data-testid={`text-plan-price-${plan.id}`}>{plan.priceFormatted || `Rs ${plan.priceMonthly}`}</span>
                      <span className="text-muted-foreground">/{plan.type === "b2c" ? "plan" : "month"}</span>
                    </div>
                    {plan.ratePerSecondFormatted ? (
                      <p className="mb-4 text-xs text-muted-foreground">
                        Effective usage: {plan.ratePerSecondFormatted} and {plan.ratePerMinuteFormatted}
                      </p>
                    ) : null}
                    <ul className="space-y-2">
                      {plan.features?.map((feature, idx) => (
                        <li key={idx} className="flex items-center gap-2 text-sm">
                          <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                          <span>{feature}</span>
                        </li>
                      ))}
                      {plan.standards?.videoCalls && (
                        <li className="flex items-center gap-2 text-sm">
                          <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                          <span>Voice, video, and face-to-face ready</span>
                        </li>
                      )}
                      {plan.callMinutesIncluded > 0 && (
                        <li className="flex items-center gap-2 text-sm">
                          <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                          <span>{plan.callMinutesIncluded} call minutes/month</span>
                        </li>
                      )}
                      {plan.translationMinutesIncluded > 0 && (
                        <li className="flex items-center gap-2 text-sm">
                          <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                          <span>{plan.translationMinutesIncluded} translation minutes/month</span>
                        </li>
                      )}
                    </ul>
                  </CardContent>
                  <CardFooter>
                    <Link href="/login" className="w-full">
                      <Button className="w-full" data-testid={`button-select-plan-${plan.id}`}>
                        Get Started
                      </Button>
                    </Link>
                  </CardFooter>
                </Card>
              ))}
            </div>
          ) : (
            <PlansUnavailable />
          )}
        </div>
      </section>

      <section className="py-16 px-4 bg-muted/50">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-2 mb-8">
            <Building2 className="w-6 h-6 text-primary" />
            <h2 className="text-2xl font-bold" data-testid="text-business-plans">Business Plans</h2>
          </div>

          {isLoading ? (
            <div className="grid md:grid-cols-2 gap-6">
              {[1, 2].map((i) => (
                <Card key={i} className="animate-pulse">
                  <CardHeader>
                    <div className="h-6 bg-muted rounded w-1/2 mb-2" />
                    <div className="h-4 bg-muted rounded w-3/4" />
                  </CardHeader>
                  <CardContent>
                    <div className="h-8 bg-muted rounded w-1/3 mb-4" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : b2bPlans.length > 0 ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {b2bPlans.map((plan) => (
                <Card 
                  key={plan.id} 
                  className="hover-elevate"
                  data-testid={`card-business-plan-${plan.id}`}
                >
                  <CardHeader>
                    <CardTitle>{planLabel(plan)}</CardTitle>
                    <CardDescription>{plan.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="mb-6">
                      <span className="text-3xl font-bold">{plan.priceFormatted || `Rs ${plan.priceMonthly}`}</span>
                      <span className="text-muted-foreground">/month</span>
                    </div>
                    {plan.ratePerSecondFormatted ? (
                      <p className="mb-4 text-xs text-muted-foreground">
                        Effective usage: {plan.ratePerSecondFormatted}
                      </p>
                    ) : null}
                    <ul className="space-y-2">
                      {plan.features?.map((feature, idx) => (
                        <li key={idx} className="flex items-center gap-2 text-sm">
                          <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                          <span>{feature}</span>
                        </li>
                      ))}
                      {plan.usersIncluded > 0 && (
                        <li className="flex items-center gap-2 text-sm">
                          <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                          <span>Up to {plan.usersIncluded} team members</span>
                        </li>
                      )}
                    </ul>
                  </CardContent>
                  <CardFooter>
                    <Link href="/contact" className="w-full">
                      <Button variant="outline" className="w-full" data-testid={`button-contact-${plan.id}`}>
                        Contact Sales
                      </Button>
                    </Link>
                  </CardFooter>
                </Card>
              ))}
            </div>
          ) : (
            <PlansUnavailable />
          )}
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-2xl font-bold mb-4">How billing works</h2>
          <ul className="text-left text-muted-foreground mb-8 space-y-2 max-w-2xl mx-auto list-disc pl-5">
            <li>Plans and top-ups are prepaid and never renew on their own.</li>
            <li>Translated call time is deducted as you use it; chats are included.</li>
            <li>Businesses pay for updates, login codes and campaign messages from a prepaid business wallet. Messages that aren't sent are not charged.</li>
            <li>Prices show applicable taxes such as GST. See our <Link href="/refund-policy" className="underline">Refund Policy</Link>.</li>
          </ul>
          <p className="text-muted-foreground mb-6">Questions about plans or a business wallet?</p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link href="/contact">
              <Button size="lg" data-testid="button-contact-sales">
                Contact Sales
              </Button>
            </Link>
            <Link href="/faq">
              <Button variant="outline" size="lg" data-testid="button-view-faq">
                View FAQ
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

/** Shown if plans can't be loaded -- never invented prices. */
function PlansUnavailable() {
  return (
    <Card data-testid="card-plans-unavailable">
      <CardContent className="p-8 text-center">
        <p className="font-medium mb-2">Current plans couldn't be loaded right now.</p>
        <p className="text-sm text-muted-foreground mb-4">Please refresh the page, see your plans in the app, or ask us.</p>
        <Link href="/contact"><Button variant="outline">Contact us</Button></Link>
      </CardContent>
    </Card>
  );
}
