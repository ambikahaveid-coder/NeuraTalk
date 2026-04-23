import type { BillingPlan } from "@shared/schema";
import { z } from "zod";

export const STRICT_BILLING_TYPES = ["prepaid", "postpaid", "hybrid"] as const;
export type StrictBillingType = (typeof STRICT_BILLING_TYPES)[number];

export const billingRatesSchema = z.object({
  voicePerMinutePaise: z.number().int().nonnegative().default(0),
  videoPerMinutePaise: z.number().int().nonnegative().default(0),
  translationPerMinutePaise: z.number().int().nonnegative().default(0),
  recordingPerMinutePaise: z.number().int().nonnegative().default(0),
});

export const billingFreeUnitsSchema = z.object({
  minutes: z.number().int().nonnegative().default(0),
  credits: z.number().int().nonnegative().default(0),
});

export const billingLimitsSchema = z.object({
  maxConcurrentCalls: z.number().int().nonnegative().default(0),
  dailyUsageLimit: z.number().int().nonnegative().default(0),
});

export const strictBillingPlanConfigSchema = z.object({
  billingType: z.enum(STRICT_BILLING_TYPES).default("prepaid"),
  perSecondBilling: z.boolean().default(true),
  rates: billingRatesSchema.default({
    voicePerMinutePaise: 0,
    videoPerMinutePaise: 0,
    translationPerMinutePaise: 0,
    recordingPerMinutePaise: 0,
  }),
  freeUnits: billingFreeUnitsSchema.default({
    minutes: 0,
    credits: 0,
  }),
  limits: billingLimitsSchema.default({
    maxConcurrentCalls: 0,
    dailyUsageLimit: 0,
  }),
  featuresEnabled: z.array(z.string()).default([]),
});

export type BillingRates = z.infer<typeof billingRatesSchema>;
export type BillingFreeUnits = z.infer<typeof billingFreeUnitsSchema>;
export type BillingLimits = z.infer<typeof billingLimitsSchema>;
export type StrictBillingPlanConfig = z.infer<typeof strictBillingPlanConfigSchema>;

type BillingPlanLike = Partial<
  Pick<
    BillingPlan,
    | "billingModel"
    | "includedMinutes"
    | "priceInPaise"
    | "features"
    | "rates"
    | "freeUnits"
    | "limits"
    | "featuresEnabled"
    | "perSecondBilling"
  >
>;

export function parseBillingRates(input: unknown): BillingRates {
  return billingRatesSchema.parse(billingRatesSchema.partial().catch({}).parse(input ?? {}));
}

export function parseBillingFreeUnits(input: unknown): BillingFreeUnits {
  return billingFreeUnitsSchema.parse(billingFreeUnitsSchema.partial().catch({}).parse(input ?? {}));
}

export function parseBillingLimits(input: unknown): BillingLimits {
  return billingLimitsSchema.parse(billingLimitsSchema.partial().catch({}).parse(input ?? {}));
}

export function parseFeaturesEnabled(
  input: unknown,
  legacyFeatures?: unknown,
): string[] {
  const explicit = Array.isArray(input)
    ? input.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];

  const derived = legacyFeatures && typeof legacyFeatures === "object" && !Array.isArray(legacyFeatures)
    ? Object.entries(legacyFeatures as Record<string, unknown>)
        .filter(([, enabled]) => enabled === true)
        .map(([feature]) => feature)
    : [];

  return Array.from(new Set([...explicit, ...derived]));
}

export function normalizeBillingType(input: unknown): StrictBillingType {
  return strictBillingPlanConfigSchema.shape.billingType.catch("prepaid").parse(input);
}

export function buildStrictBillingPlanConfig(options: {
  plan?: BillingPlanLike | null;
  globalDefaults?: Partial<StrictBillingPlanConfig> | null;
  override?: Partial<StrictBillingPlanConfig> | null;
} = {}): StrictBillingPlanConfig {
  const { plan, globalDefaults, override } = options;

  const planRates = parseBillingRates(plan?.rates);
  const legacyDerivedVoiceRate = deriveLegacyVoiceRate(plan);
  const mergedRates = {
    ...parseBillingRates(globalDefaults?.rates),
    ...planRates,
    ...parseBillingRates(override?.rates),
  };

  if (
    mergedRates.voicePerMinutePaise <= 0 &&
    legacyDerivedVoiceRate > 0
  ) {
    mergedRates.voicePerMinutePaise = legacyDerivedVoiceRate;
  }

  const mergedFreeUnits = {
    ...parseBillingFreeUnits(globalDefaults?.freeUnits),
    ...parseBillingFreeUnits(plan?.freeUnits),
    ...parseBillingFreeUnits(override?.freeUnits),
  };

  const mergedLimits = {
    ...parseBillingLimits(globalDefaults?.limits),
    ...parseBillingLimits(plan?.limits),
    ...parseBillingLimits(override?.limits),
  };

  const featuresEnabled = parseFeaturesEnabled(
    override?.featuresEnabled ?? plan?.featuresEnabled ?? globalDefaults?.featuresEnabled,
    plan?.features,
  );

  return strictBillingPlanConfigSchema.parse({
    billingType:
      override?.billingType ??
      normalizeBillingType(plan?.billingModel ?? globalDefaults?.billingType),
    perSecondBilling:
      override?.perSecondBilling ??
      plan?.perSecondBilling ??
      globalDefaults?.perSecondBilling ??
      true,
    rates: mergedRates,
    freeUnits: mergedFreeUnits,
    limits: mergedLimits,
    featuresEnabled,
  });
}

export function deriveLegacyVoiceRate(plan?: BillingPlanLike | null): number {
  if (!plan) return 0;
  const includedMinutes = Math.max(0, plan.includedMinutes ?? 0);
  const priceInPaise = Math.max(0, plan.priceInPaise ?? 0);
  if (includedMinutes <= 0 || priceInPaise <= 0) {
    return 0;
  }
  return Math.max(1, Math.round(priceInPaise / includedMinutes));
}

export function getEstimatedRatePerMinute(
  config: StrictBillingPlanConfig,
  options: {
    callType: "voice" | "video";
    translationEnabled?: boolean;
    recordingEnabled?: boolean;
  },
): number {
  const base =
    options.callType === "video"
      ? config.rates.videoPerMinutePaise
      : config.rates.voicePerMinutePaise;

  return Math.max(
    0,
    base +
      (options.translationEnabled ? config.rates.translationPerMinutePaise : 0) +
      (options.recordingEnabled ? config.rates.recordingPerMinutePaise : 0),
  );
}

export function getEstimatedRatePerSecond(
  config: StrictBillingPlanConfig,
  options: {
    callType: "voice" | "video";
    translationEnabled?: boolean;
    recordingEnabled?: boolean;
  },
): number {
  return getEstimatedRatePerMinute(config, options) / 60;
}
