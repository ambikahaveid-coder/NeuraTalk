import { Link } from "wouter";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ClosingBanner, PAPER, PageHero, PrimaryAction, SectionTitle, reveal } from "./site-ui";

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
  minutesLabel?: string;
  periodSuffix?: string;
}

function PlanCard({ plan, business }: { plan: BillingPlan; business?: boolean }) {
  const featured = !business && plan.tierLabel === "premium";
  const extras: string[] = plan.minutesLabel ? [plan.minutesLabel] : [];
  return (
    <motion.div
      {...reveal}
      className={`relative flex h-full flex-col rounded-3xl border bg-background p-7 ${featured ? "border-primary shadow-[0_20px_60px_-24px_hsl(var(--primary)/0.5)] ring-1 ring-primary" : ""}`}
      data-testid={business ? `card-business-plan-${plan.id}` : `card-plan-${plan.id}`}
    >
      {featured && <span className="absolute -top-3 left-7 rounded-full bg-primary px-3 py-0.5 text-xs font-medium text-primary-foreground">Popular</span>}
      <h3 className="text-xl font-semibold" data-testid={business ? undefined : `text-plan-name-${plan.id}`}>{plan.displayName || plan.name}</h3>
      <p className="mt-2 min-h-[3rem] text-sm leading-relaxed text-muted-foreground">{plan.description}</p>
      <p className="mt-6">
        <span className="text-4xl font-semibold tracking-tight" data-testid={business ? undefined : `text-plan-price-${plan.id}`}>{plan.priceFormatted || `Rs ${plan.priceMonthly}`}</span>
        {plan.periodSuffix ? <span className="text-muted-foreground"> {plan.periodSuffix}</span> : null}
      </p>
      {plan.ratePerSecondFormatted && plan.ratePerSecondFormatted !== "Custom" && plan.ratePerSecondFormatted !== "Included" && (
        <p className="mt-2 text-xs text-muted-foreground">
          Effective usage: {plan.ratePerSecondFormatted}{!business && plan.ratePerMinuteFormatted ? ` and ${plan.ratePerMinuteFormatted}` : ""}
        </p>
      )}
      <ul className="mt-6 flex-1 space-y-2.5">
        {[...extras, ...(plan.features ?? [])].map((f, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span>{f}</span></li>
        ))}
      </ul>
      <Link href={business ? "/contact" : "/login"} className="mt-8 block">
        <Button className="h-11 w-full rounded-full" variant={featured ? "default" : "outline"} data-testid={business ? `button-contact-${plan.id}` : `button-select-plan-${plan.id}`}>
          {business ? "Contact Sales" : "Get Started"}
        </Button>
      </Link>
    </motion.div>
  );
}

function PlanSkeletons({ n }: { n: number }) {
  return (
    <div className={`grid gap-6 ${n === 3 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="h-80 animate-pulse rounded-3xl border bg-muted/40" />
      ))}
    </div>
  );
}

export default function PricingPage() {
  const { data: plans, isLoading } = useQuery<BillingPlan[]>({ queryKey: ["/api/billing/plans"] });
  const b2cPlans = plans?.filter((p) => p.type === "b2c") || [];
  const b2bPlans = plans?.filter((p) => p.type === "b2b") || [];

  return (
    <div className="min-h-screen bg-background">
      <PageHero
        eyebrow="Pricing"
        testId="text-pricing-title"
        title="Pay only for translated minutes"
        body="Chats and calls without translation are free. Every new account gets 5 free AI translation minutes to try it. Prices in Indian Rupees."
      >
        <span className="sr-only" data-testid="badge-pricing">Pricing</span>
      </PageHero>

      <section className="px-4 py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-3xl font-semibold tracking-tight" data-testid="text-individual-plans">Individual Plans</h2>
          <p className="mt-2 text-muted-foreground">For you, your family and friends.</p>
          <div className="mt-10">
            {isLoading ? <PlanSkeletons n={3} /> : b2cPlans.length > 0 ? (
              <div className="grid gap-6 md:grid-cols-3">{b2cPlans.map((p) => <PlanCard key={p.id} plan={p} />)}</div>
            ) : <PlansUnavailable />}
          </div>
        </div>
      </section>

      <section className={`px-4 py-20 ${PAPER}`}>
        <div className="mx-auto max-w-6xl">
          <h2 className="text-3xl font-semibold tracking-tight" data-testid="text-business-plans">Business Plans</h2>
          <p className="mt-2 text-muted-foreground">For shops, clinics and companies using NeuraTalk Business.</p>
          <div className="mt-10">
            {isLoading ? <PlanSkeletons n={2} /> : b2bPlans.length > 0 ? (
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">{b2bPlans.map((p) => <PlanCard key={p.id} plan={p} business />)}</div>
            ) : <PlansUnavailable />}
          </div>
        </div>
      </section>

      <section className="px-4 py-20 md:py-28">
        <div className="mx-auto max-w-6xl">
          <SectionTitle title="How billing works" />
          <div className="mt-12 grid gap-px overflow-hidden rounded-3xl border bg-border sm:grid-cols-2">
            {[
              ["No surprise renewals", "Plans and top-ups are prepaid and never renew on their own."],
              ["Pay as you talk", "Translated call time is deducted as you use it; chats are included."],
              ["Business wallet", "Businesses pay for updates, login codes and campaign messages from a prepaid business wallet. Messages that aren't sent are not charged."],
              ["Clear taxes and refunds", <>Prices show applicable taxes such as GST. See our <Link href="/refund-policy" className="underline underline-offset-2">Refund Policy</Link>.</>],
            ].map(([t, d]) => (
              <motion.div key={t as string} {...reveal} className="bg-background p-7">
                <h3 className="font-semibold">{t}</h3>
                <p className="mt-2 leading-relaxed text-muted-foreground">{d}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <ClosingBanner title="Questions about plans or a business wallet?" body="We'll explain the plans, minutes and wallet in plain words.">
        <PrimaryAction href="/contact" variant="outline" testId="button-contact-sales">Contact Sales</PrimaryAction>
        <Link href="/faq" className="inline-flex h-12 items-center justify-center rounded-full border border-primary-foreground/40 px-7 text-base hover:bg-primary-foreground/10" data-testid="button-view-faq">View FAQ</Link>
      </ClosingBanner>
    </div>
  );
}

/** Shown if plans can't be loaded -- never invented prices. */
function PlansUnavailable() {
  return (
    <div className="rounded-3xl border bg-background p-10 text-center" data-testid="card-plans-unavailable">
      <p className="font-medium">Current plans couldn't be loaded right now.</p>
      <p className="mt-2 text-sm text-muted-foreground">Please refresh the page, see your plans in the app, or ask us.</p>
      <Link href="/contact"><Button variant="outline" className="mt-5 rounded-full">Contact us</Button></Link>
    </div>
  );
}
