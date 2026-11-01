import type { BillingPlan } from "@shared/schema";
import { buildStrictBillingPlanConfig, getEstimatedRatePerMinute } from "./billing-config";

type BillingPlanLike = Pick<
  BillingPlan,
  | "name"
  | "description"
  | "planType"
  | "billingModel"
  | "duration"
  | "includedMinutes"
  | "priceInPaise"
  | "currency"
  | "features"
  | "rates"
  | "freeUnits"
  | "limits"
  | "featuresEnabled"
  | "perSecondBilling"
  | "isFeatured"
>;

export interface BillingPlanPresentation {
  displayName: string;
  tierLabel: "trial" | "starter" | "premium" | "gold" | "platinum" | "enterprise";
  includedSeconds: number;
  ratePerMinutePaise: number;
  ratePerSecondPaise: number;
  priceFormatted: string;
  ratePerMinuteFormatted: string;
  ratePerSecondFormatted: string;
  featureHighlights: string[];
  /** e.g. "2,000 translated call minutes · 90 days". */
  minutesLabel: string;
  /** "/week", "/month", "/3 months", "/year", or "" for custom and free plans. */
  periodSuffix: string;
  /** Plain description built from the plan's real numbers (never a promise we don't enforce). */
  summaryText: string;
  standards: {
    voiceCalls: boolean;
    videoCalls: boolean;
    faceToFace: boolean;
    emotionAware: boolean;
    apiAccess: boolean;
  };
}

export function formatInrFromPaise(paise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: paise % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(paise / 100);
}

export function summarizeBillingPlan(plan: BillingPlanLike): BillingPlanPresentation {
  const config = buildStrictBillingPlanConfig({ plan });
  const features = toFeatureMap(plan.features);
  const displayName = getPlanDisplayName(plan, features);
  const tierLabel = getTierLabel(plan, features);
  const includedSeconds = Math.max(
    0,
    (config.freeUnits.minutes || 0) * 60 || (plan.includedMinutes || 0) * 60,
  );
  const configuredRatePerMinutePaise = getEstimatedRatePerMinute(config, { callType: "voice" });
  const fallbackRatePerSecondPaise =
    plan.priceInPaise > 0 && includedSeconds > 0 ? plan.priceInPaise / includedSeconds : 0;
  const ratePerMinutePaise =
    configuredRatePerMinutePaise > 0 ? configuredRatePerMinutePaise : fallbackRatePerSecondPaise * 60;
  const ratePerSecondPaise = ratePerMinutePaise / 60;

  const standards = {
    voiceCalls: true,
    videoCalls: true,
    faceToFace: true,
    emotionAware: features.emotionPreservation !== false,
    apiAccess: Boolean(features.apiAccess || features.customIntegrations || features.contactSales || plan.planType === "b2b"),
  };

  // Only what every plan really gets today. Support levels, SLAs and "emotion-aware" voice are
  // not offered as separate, enforced features, so they are not listed (even if a plan row has the flag).
  const isBusiness = plan.planType === "b2b";
  const custom = Boolean(features.contactSales) || displayName === "Enterprise";
  const featureHighlights = dedupe([
    "AI translation in voice and video calls",
    isBusiness ? "AI translation of customer chats" : "AI translation of chats (10 messages use 1 minute)",
    isBusiness ? null : "Your own voice, learned in your first call",
    "In-person translation",
    isBusiness ? null : "Calls and chats without translation are always free",
    isBusiness ? "NeuraTalk Business app and team inbox" : null,
    isBusiness ? "Business API for order updates and login codes" : null,
    config.billingType === "hybrid" ? "Hybrid wallet + credit billing" : null,
    config.billingType === "postpaid" ? "Postpaid invoicing" : null,
    config.billingType === "prepaid" && !custom && plan.priceInPaise > 0 ? "Prepaid — never renews on its own" : null,
  ]);

  const minutes = plan.includedMinutes || 0;
  const period = PERIOD[plan.duration as keyof typeof PERIOD];
  const minutesText = `${new Intl.NumberFormat("en-IN").format(minutes)} AI translation minutes`;
  const minutesLabel = custom || minutes >= 99999
    ? "Minutes agreed with our team"
    : plan.priceInPaise === 0
      ? `${minutesText} · once, for every new account`
      : period ? `${minutesText} · ${period.length}` : minutesText;
  const periodSuffix = custom || plan.priceInPaise === 0 || !period ? "" : period.suffix;
  const summaryText = custom
    ? isBusiness ? "For larger teams. Minutes, team size and terms are agreed with our team." : "For heavy use. Minutes and terms are agreed with our team."
    : plan.priceInPaise === 0
      ? `${minutesText} to try AI translation, once. Calls and chats without translation are free.`
      : isBusiness
        ? `${minutesText} for your team to use within ${period ? period.length : "the plan period"}.`
        : `${minutesText} to use within ${period ? period.length : "the plan period"}.`;

  return {
    displayName,
    tierLabel,
    includedSeconds,
    ratePerMinutePaise,
    ratePerSecondPaise,
    priceFormatted: plan.priceInPaise > 0 ? formatInrFromPaise(plan.priceInPaise) : features.contactSales ? "Custom" : "Free",
    ratePerMinuteFormatted: formatRate(ratePerMinutePaise, "min", features.contactSales),
    ratePerSecondFormatted: formatRate(ratePerSecondPaise, "sec", features.contactSales),
    featureHighlights,
    minutesLabel,
    periodSuffix,
    summaryText,
    standards,
  };
}

const PERIOD = {
  daily: { length: "1 day", suffix: "/day" },
  weekly: { length: "7 days", suffix: "/week" },
  monthly: { length: "30 days", suffix: "/month" },
  quarterly: { length: "90 days", suffix: "/3 months" },
  yearly: { length: "365 days", suffix: "/year" },
} as const;

function getPlanDisplayName(plan: BillingPlanLike, features: Record<string, any>): string {
  if (features.contactSales || plan.name.toLowerCase() === "enterprise") return "Enterprise";

  if (plan.planType === "b2c") {
    if (plan.priceInPaise === 0) return "Free Trial";
    if (plan.duration === "weekly" && plan.includedMinutes <= 150) return "Starter";
    if (plan.duration === "weekly") return "Silver";
    if (plan.duration === "monthly") return "Premium";
    if (plan.duration === "quarterly") return "Gold";
    if (plan.duration === "yearly") return "Platinum";
  }

  if (plan.planType === "b2b") {
    const normalized = plan.name.toLowerCase();
    if (normalized.includes("starter")) return "Starter";
    if (normalized.includes("business")) return "Premium Team";
    if (normalized.includes("professional")) return "Gold Team";
    if (normalized.includes("enterprise")) return "Enterprise";
  }

  return plan.name;
}

function getTierLabel(
  plan: BillingPlanLike,
  features: Record<string, any>,
): BillingPlanPresentation["tierLabel"] {
  if (features.contactSales || plan.name.toLowerCase() === "enterprise") return "enterprise";
  if (plan.priceInPaise === 0) return "trial";
  if (plan.duration === "quarterly") return "gold";
  if (plan.duration === "yearly") return "platinum";
  if (plan.duration === "monthly" || plan.isFeatured) return "premium";
  return "starter";
}

function formatRate(ratePaise: number, unit: "sec" | "min", isCustom = false): string {
  if (isCustom) return "Custom";
  if (!Number.isFinite(ratePaise) || ratePaise <= 0) return "Included";

  const rupees = ratePaise / 100;
  const fractionDigits = unit === "sec" ? (rupees < 1 ? 3 : 2) : 2;
  return `₹${rupees.toFixed(fractionDigits)}/${unit}`;
}

function toFeatureMap(features: BillingPlanLike["features"]): Record<string, any> {
  if (!features || typeof features !== "object" || Array.isArray(features)) return {};
  return features as Record<string, any>;
}

function dedupe(items: Array<string | null>): string[] {
  return Array.from(new Set(items.filter((item): item is string => Boolean(item))));
}
