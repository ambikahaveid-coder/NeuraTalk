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
            Simple, Transparent Pricing
          </h1>
          <p className="text-xl text-muted-foreground">
            Choose the plan that works best for you or your team
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
            <div className="grid md:grid-cols-3 gap-6">
              <Card className="hover-elevate" data-testid="card-plan-free">
                <CardHeader>
                  <CardTitle>Free</CardTitle>
                  <CardDescription>Get started with basic features</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="mb-6">
                    <span className="text-3xl font-bold" data-testid="text-price-free">₹0</span>
                    <span className="text-muted-foreground">/month</span>
                  </div>
                  <ul className="space-y-2">
                    <li className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-green-500" />
                      <span>10 minutes/month</span>
                    </li>
                    <li className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-green-500" />
                      <span>Basic translation</span>
                    </li>
                    <li className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-green-500" />
                      <span>AI chat assistant</span>
                    </li>
                  </ul>
                </CardContent>
                <CardFooter>
                  <Link href="/login" className="w-full">
                    <Button variant="outline" className="w-full" data-testid="button-get-started-free">
                      Get Started
                    </Button>
                  </Link>
                </CardFooter>
              </Card>

              <Card className="hover-elevate border-primary relative" data-testid="card-plan-pro">
                <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">Popular</Badge>
                <CardHeader>
                  <CardTitle>Pro</CardTitle>
                  <CardDescription>For regular users</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="mb-6">
                    <span className="text-3xl font-bold" data-testid="text-price-pro">₹499</span>
                    <span className="text-muted-foreground">/month</span>
                  </div>
                  <ul className="space-y-2">
                    <li className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-green-500" />
                      <span>100 minutes/month</span>
                    </li>
                    <li className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-green-500" />
                      <span>All languages</span>
                    </li>
                    <li className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-green-500" />
                      <span>Voice memos</span>
                    </li>
                    <li className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-green-500" />
                      <span>Priority support</span>
                    </li>
                  </ul>
                </CardContent>
                <CardFooter>
                  <Link href="/login" className="w-full">
                    <Button className="w-full" data-testid="button-get-started-pro">
                      Get Started
                    </Button>
                  </Link>
                </CardFooter>
              </Card>

              <Card className="hover-elevate" data-testid="card-plan-unlimited">
                <CardHeader>
                  <CardTitle>Unlimited</CardTitle>
                  <CardDescription>For power users</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="mb-6">
                    <span className="text-3xl font-bold" data-testid="text-price-unlimited">₹999</span>
                    <span className="text-muted-foreground">/month</span>
                  </div>
                  <ul className="space-y-2">
                    <li className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-green-500" />
                      <span>Unlimited minutes</span>
                    </li>
                    <li className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-green-500" />
                      <span>All features</span>
                    </li>
                    <li className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-green-500" />
                      <span>API access</span>
                    </li>
                    <li className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-green-500" />
                      <span>24/7 support</span>
                    </li>
                  </ul>
                </CardContent>
                <CardFooter>
                  <Link href="/login" className="w-full">
                    <Button className="w-full" data-testid="button-get-started-unlimited">
                      Get Started
                    </Button>
                  </Link>
                </CardFooter>
              </Card>
            </div>
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
            <div className="grid md:grid-cols-2 gap-6">
              <Card className="hover-elevate" data-testid="card-business-starter">
                <CardHeader>
                  <CardTitle>Business Starter</CardTitle>
                  <CardDescription>For small teams getting started</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="mb-6">
                    <span className="text-3xl font-bold">₹4,999</span>
                    <span className="text-muted-foreground">/month</span>
                  </div>
                  <ul className="space-y-2">
                    <li className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-green-500" />
                      <span>Up to 5 team members</span>
                    </li>
                    <li className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-green-500" />
                      <span>500 minutes/month</span>
                    </li>
                    <li className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-green-500" />
                      <span>Team dashboard</span>
                    </li>
                    <li className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-green-500" />
                      <span>Usage analytics</span>
                    </li>
                  </ul>
                </CardContent>
                <CardFooter>
                  <Link href="/contact" className="w-full">
                    <Button variant="outline" className="w-full" data-testid="button-contact-starter">
                      Contact Sales
                    </Button>
                  </Link>
                </CardFooter>
              </Card>

              <Card className="hover-elevate border-primary" data-testid="card-business-enterprise">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Zap className="w-5 h-5 text-primary" />
                    <CardTitle>Enterprise</CardTitle>
                  </div>
                  <CardDescription>Custom solutions for large organizations</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="mb-6">
                    <span className="text-3xl font-bold">Custom</span>
                  </div>
                  <ul className="space-y-2">
                    <li className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-green-500" />
                      <span>Unlimited team members</span>
                    </li>
                    <li className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-green-500" />
                      <span>Custom minute packages</span>
                    </li>
                    <li className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-green-500" />
                      <span>SSO & IP whitelisting</span>
                    </li>
                    <li className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-green-500" />
                      <span>Dedicated support</span>
                    </li>
                    <li className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-green-500" />
                      <span>Custom SLA</span>
                    </li>
                  </ul>
                </CardContent>
                <CardFooter>
                  <Link href="/contact" className="w-full">
                    <Button className="w-full" data-testid="button-contact-enterprise">
                      Contact Sales
                    </Button>
                  </Link>
                </CardFooter>
              </Card>
            </div>
          )}
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-2xl font-bold mb-4">Need Help Choosing?</h2>
          <p className="text-muted-foreground mb-6">
            Our team is here to help you find the perfect plan for your needs
          </p>
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
