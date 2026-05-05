import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  billingAccounts,
  billingLedgerEntries,
  billingPlans,
  billingReservations,
  billingSettings,
  callBillingRecords,
  organizations,
  platformSettings,
  subscriptions,
  usageRecords,
  type BillingAccount,
  type BillingPlan,
  type BillingSettingsType,
  type Organization,
  type Subscription,
} from "@shared/schema";
import { db } from "./db";
import {
  buildStrictBillingPlanConfig,
  getEstimatedRatePerMinute,
  strictBillingPlanConfigSchema,
  type StrictBillingPlanConfig,
  type StrictBillingType,
} from "./billing-config";
import { calculateBillableSecondsForBudget, calculateChargeIncrement } from "@shared/billing-math";
import { logger } from "./observability";
import { getRedisClient, withRedisLock } from "./redis";

export interface CallBillingStartInput {
  sessionId: string;
  userId: number | null;
  organizationId?: number | null;
  callType: "voice" | "video";
  translationEnabled?: boolean;
  recordingEnabled?: boolean;
  joinMethod?: "app_to_app" | "app_to_pstn" | "conference";
  activateOnAnswer?: boolean;
  pricingOverride?: Partial<StrictBillingPlanConfig> | null;
}

export interface CallBillingAuthorization {
  allowed: boolean;
  reason?: string;
  reservationId: string | null;
  subscriptionId: number | null;
  billingAccountId: number | null;
  billingType: StrictBillingType;
  currency: string;
  maxDurationSeconds: number;
  estimatedRatePerMinutePaise: number;
  estimatedRatePerSecondPaise: number;
  freeSecondsRemaining: number;
  freeCreditsRemainingPaise: number;
  walletBalancePaise: number;
  lockedBalancePaise: number;
  outstandingPostpaidPaise: number;
  creditLimitPaise: number;
}

export interface CallBillingProgress {
  sessionId: string;
  totalCostPaise: number;
  prepaidDebitPaise: number;
  postpaidAccrualPaise: number;
  durationSeconds: number;
  freeSecondsRemaining: number;
  freeCreditsRemainingPaise: number;
  walletBalancePaise: number;
  lockedBalancePaise: number;
  outstandingPostpaidPaise: number;
}

export interface CallBillingFinalization extends CallBillingProgress {
  callId: string;
  invoiceableAmountPaise: number;
  costBreakdown: Record<string, number>;
}

export interface CallBillingActivation extends CallBillingProgress {
  activatedAtMs: number;
}

interface BillingContext {
  organization: Organization | null;
  settings: BillingSettingsType | null;
  account: BillingAccount | null;
  subscription: Subscription | null;
  plan: BillingPlan | null;
  config: StrictBillingPlanConfig;
  currency: string;
}

interface FeatureCounter {
  seconds: number;
  paise: number;
  remainder: number;
}

interface CallRuntimeState {
  sessionId: string;
  userId: number | null;
  organizationId: number | null;
  billingAccountId: number | null;
  subscriptionId: number | null;
  reservationId: string | null;
  billingType: StrictBillingType;
  callType: "voice" | "video";
  translationEnabled: boolean;
  recordingEnabled: boolean;
  joinMethod: "app_to_app" | "app_to_pstn" | "conference";
  currency: string;
  config: StrictBillingPlanConfig;
  estimatedRatePerMinutePaise: number;
  pricingOverride: Partial<StrictBillingPlanConfig> | null;
  maxDurationSeconds: number;
  freeSecondsRemaining: number;
  freeCreditsRemainingPaise: number;
  walletBalancePaise: number;
  lockedBalancePaise: number;
  totalReservedPaise: number;
  reservedAvailablePaise: number;
  outstandingPostpaidPaise: number;
  creditLimitPaise: number;
  currentDayUsageSeconds: number;
  usageDayAnchor: Date;
  durationSeconds: number;
  prepaidDebitPaise: number;
  postpaidAccrualPaise: number;
  includedFreeSecondsUsed: number;
  includedFreeCreditsUsedPaise: number;
  initialLockedPaise: number;
  topupLockedPaise: number;
  billingActive: boolean;
  authorizedAtMs: number;
  answeredAtMs: number | null;
  startedAtMs: number;
  lastProcessedAtMs: number;
  hardStopAtMs: number;
  terminationRequestedReason: string | null;
  features: {
    voice: FeatureCounter;
    video: FeatureCounter;
    translation: FeatureCounter;
    recording: FeatureCounter;
  };
}

type BillingSummaryRow = {
  totalRevenuePaise: number | null;
  outstandingPaise: number | null;
  activeCalls: number | null;
};

const GLOBAL_BILLING_DEFAULTS_KEY = "billing_global_defaults";
const MAX_OPEN_CALL_SECONDS = 60 * 60 * 24;
const BILLING_RUNTIME_KEY_PREFIX = "billing:runtime:";
const BILLING_RUNTIME_LOCK_PREFIX = "billing:lock:";
const BILLING_ACTIVE_SET_KEY = "billing:active";
const BILLING_RUNTIME_TTL_SECONDS = 60 * 60 * 24 * 2;
let billingSupervisorStarted = false;

export const billingEvents = new EventEmitter();

function runtimeKey(sessionId: string): string {
  return `${BILLING_RUNTIME_KEY_PREFIX}${sessionId}`;
}

function runtimeLockKey(sessionId: string): string {
  return `${BILLING_RUNTIME_LOCK_PREFIX}${sessionId}`;
}

function serializeRuntimeState(runtime: CallRuntimeState): string {
  return JSON.stringify({
    ...runtime,
    usageDayAnchor: runtime.usageDayAnchor.toISOString(),
  });
}

function deserializeRuntimeState(payload: string): CallRuntimeState {
  const parsed = JSON.parse(payload) as Partial<CallRuntimeState> & { usageDayAnchor: string };
  const startedAtMs = typeof parsed.startedAtMs === "number" ? parsed.startedAtMs : 0;
  const billingActive = typeof parsed.billingActive === "boolean" ? parsed.billingActive : startedAtMs > 0;
  return {
    ...(parsed as CallRuntimeState),
    billingActive,
    authorizedAtMs: typeof parsed.authorizedAtMs === "number" ? parsed.authorizedAtMs : startedAtMs || Date.now(),
    answeredAtMs: typeof parsed.answeredAtMs === "number" ? parsed.answeredAtMs : (billingActive ? startedAtMs || Date.now() : null),
    usageDayAnchor: new Date(parsed.usageDayAnchor),
  };
}

async function persistRuntimeSession(runtime: CallRuntimeState) {
  const redis = getRedisClient();
  const multi = redis.multi()
    .set(runtimeKey(runtime.sessionId), serializeRuntimeState(runtime), "EX", BILLING_RUNTIME_TTL_SECONDS);

  if (runtime.billingActive) {
    multi.sadd(BILLING_ACTIVE_SET_KEY, runtime.sessionId);
  } else {
    multi.srem(BILLING_ACTIVE_SET_KEY, runtime.sessionId);
  }

  await multi.exec();
}

async function loadRuntimeSession(sessionId: string): Promise<CallRuntimeState | null> {
  const redis = getRedisClient();
  const payload = await redis.get(runtimeKey(sessionId));
  if (!payload) {
    return null;
  }

  return deserializeRuntimeState(payload);
}

async function removeRuntimeSession(sessionId: string) {
  const redis = getRedisClient();
  await redis.multi()
    .del(runtimeKey(sessionId))
    .srem(BILLING_ACTIVE_SET_KEY, sessionId)
    .exec();
}

async function listActiveRuntimeSessionIds(): Promise<string[]> {
  return await getRedisClient().smembers(BILLING_ACTIVE_SET_KEY);
}

function emptyFeatureCounter(): FeatureCounter {
  return { seconds: 0, paise: 0, remainder: 0 };
}

function normalizeOverride(input: unknown): Partial<StrictBillingPlanConfig> {
  return strictBillingPlanConfigSchema.partial().catch({}).parse(input ?? {});
}

function startOfDay(anchor = new Date()): Date {
  const next = new Date(anchor);
  next.setHours(0, 0, 0, 0);
  return next;
}

function isSameCalendarDay(left: Date, right: Date): boolean {
  return startOfDay(left).getTime() === startOfDay(right).getTime();
}

function featureCostSummary(runtime: CallRuntimeState) {
  return {
    voicePaise: runtime.features.voice.paise,
    videoPaise: runtime.features.video.paise,
    translationPaise: runtime.features.translation.paise,
    recordingPaise: runtime.features.recording.paise,
  };
}

function totalCost(runtime: CallRuntimeState): number {
  return runtime.features.voice.paise
    + runtime.features.video.paise
    + runtime.features.translation.paise
    + runtime.features.recording.paise;
}

function invoiceableAmount(runtime: CallRuntimeState): number {
  return runtime.postpaidAccrualPaise;
}

function getRemainingPostpaidCapacity(runtime: CallRuntimeState): number {
  return Math.max(0, runtime.creditLimitPaise - runtime.outstandingPostpaidPaise);
}

function getMaxDurationSeconds(runtime: CallRuntimeState): number {
  if (runtime.estimatedRatePerMinutePaise <= 0) {
    return MAX_OPEN_CALL_SECONDS;
  }

  const prepaidBudgetPaise = runtime.freeCreditsRemainingPaise
    + Math.max(0, runtime.walletBalancePaise - runtime.lockedBalancePaise)
    + runtime.reservedAvailablePaise;
  const postpaidBudgetPaise = runtime.billingType === "prepaid" ? 0 : getRemainingPostpaidCapacity(runtime);
  const billableSeconds = calculateBillableSecondsForBudget({
    budgetPaise: prepaidBudgetPaise + postpaidBudgetPaise,
    ratePerMinutePaise: runtime.estimatedRatePerMinutePaise,
    perSecondBilling: runtime.config.perSecondBilling,
  });

  return Math.max(0, runtime.freeSecondsRemaining + billableSeconds);
}

function incrementFeatureSeconds(runtime: CallRuntimeState, seconds: number) {
  if (runtime.callType === "video") {
    runtime.features.video.seconds += seconds;
  } else {
    runtime.features.voice.seconds += seconds;
  }

  if (runtime.translationEnabled) {
    runtime.features.translation.seconds += seconds;
  }

  if (runtime.recordingEnabled) {
    runtime.features.recording.seconds += seconds;
  }
}

function billFeature(
  counter: FeatureCounter,
  ratePerMinutePaise: number,
  seconds: number,
  elapsedPaidSeconds: number,
  perSecondBilling: boolean,
): number {
  const { deltaPaise, nextRemainder } = calculateChargeIncrement({
    elapsedPaidSeconds,
    ratePerMinutePaise,
    billedRemainder: counter.remainder,
    perSecondBilling,
    seconds,
  });
  counter.remainder = nextRemainder;
  counter.paise += deltaPaise;
  return deltaPaise;
}

async function getGlobalBillingDefaults(): Promise<Partial<StrictBillingPlanConfig>> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, GLOBAL_BILLING_DEFAULTS_KEY)).limit(1);
  return normalizeOverride(row?.value);
}

async function getPlanById(planId: number | null | undefined): Promise<BillingPlan | null> {
  if (!planId) return null;
  const [plan] = await db.select().from(billingPlans).where(eq(billingPlans.id, planId)).limit(1);
  return plan ?? null;
}

async function getActiveSubscriptionForOrganization(organizationId: number): Promise<{
  subscription: Subscription;
  plan: BillingPlan;
} | null> {
  const [row] = await db.select({
    subscription: subscriptions,
    plan: billingPlans,
  })
    .from(subscriptions)
    .innerJoin(billingPlans, eq(subscriptions.planId, billingPlans.id))
    .where(and(eq(subscriptions.organizationId, organizationId), eq(subscriptions.status, "active")))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);

  return row ?? null;
}

async function getActiveSubscriptionForUser(userId: number): Promise<{
  subscription: Subscription;
  plan: BillingPlan;
} | null> {
  const [row] = await db.select({
    subscription: subscriptions,
    plan: billingPlans,
  })
    .from(subscriptions)
    .innerJoin(billingPlans, eq(subscriptions.planId, billingPlans.id))
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, "active")))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);

  return row ?? null;
}

async function getDefaultPlan(planType: "b2b" | "b2c"): Promise<BillingPlan | null> {
  const [plan] = await db.select()
    .from(billingPlans)
    .where(and(eq(billingPlans.planType, planType), eq(billingPlans.isEnabled, true)))
    .orderBy(desc(billingPlans.isDefault), billingPlans.displayOrder, billingPlans.priceInPaise)
    .limit(1);

  return plan ?? null;
}

async function ensureOrganizationBillingAccount(organizationId: number): Promise<BillingAccount> {
  const [existing] = await db.select().from(billingAccounts).where(eq(billingAccounts.organizationId, organizationId)).limit(1);
  if (existing) {
    return existing;
  }

  const activeSubscription = await getActiveSubscriptionForOrganization(organizationId);
  const fallbackPlan = activeSubscription?.plan ?? await getDefaultPlan("b2b");
  const config = buildStrictBillingPlanConfig({ plan: fallbackPlan ?? undefined });

  const [created] = await db.insert(billingAccounts).values({
    organizationId,
    assignedPlanId: activeSubscription?.plan.id ?? fallbackPlan?.id ?? null,
    billingType: config.billingType,
    includedSecondsRemaining: Math.max(0, config.freeUnits.minutes * 60),
    includedCreditsRemaining: Math.max(0, config.freeUnits.credits * 100),
    maxConcurrentCalls: config.limits.maxConcurrentCalls,
    dailyUsageLimitSeconds: config.limits.dailyUsageLimit,
    currency: fallbackPlan?.currency || "INR",
  }).returning();

  return created;
}

async function resolveBillingContext(input: {
  userId: number | null;
  organizationId: number | null;
  pricingOverride?: Partial<StrictBillingPlanConfig> | null;
}): Promise<BillingContext> {
  const globalDefaults = await getGlobalBillingDefaults();
  const sessionOverride = normalizeOverride(input.pricingOverride);

  if (input.organizationId) {
    const [organization] = await db.select().from(organizations).where(eq(organizations.id, input.organizationId)).limit(1);
    const [settings] = await db.select().from(billingSettings).where(eq(billingSettings.organizationId, input.organizationId)).limit(1);
    const account = await ensureOrganizationBillingAccount(input.organizationId);
    const activeSubscription = await getActiveSubscriptionForOrganization(input.organizationId);
    const explicitPlan = await getPlanById(account.assignedPlanId);
    const plan = explicitPlan ?? activeSubscription?.plan ?? await getDefaultPlan("b2b");
    const accountOverride = normalizeOverride(account.customPricingOverride);

    if (account.maxConcurrentCalls > 0 || account.dailyUsageLimitSeconds > 0) {
      accountOverride.limits = {
        ...(accountOverride.limits || {}),
        maxConcurrentCalls: account.maxConcurrentCalls || accountOverride.limits?.maxConcurrentCalls || 0,
        dailyUsageLimit: account.dailyUsageLimitSeconds || accountOverride.limits?.dailyUsageLimit || 0,
      };
    }
    if (account.billingType) {
      accountOverride.billingType = account.billingType as StrictBillingType;
    }

    const effectiveOverride = normalizeOverride({
      ...accountOverride,
      ...sessionOverride,
      rates: {
        ...(accountOverride.rates || {}),
        ...(sessionOverride.rates || {}),
      },
      freeUnits: {
        ...(accountOverride.freeUnits || {}),
        ...(sessionOverride.freeUnits || {}),
      },
      limits: {
        ...(accountOverride.limits || {}),
        ...(sessionOverride.limits || {}),
      },
      featuresEnabled: sessionOverride.featuresEnabled ?? accountOverride.featuresEnabled,
    });

    return {
      organization: organization ?? null,
      settings: settings ?? null,
      account,
      subscription: activeSubscription?.subscription ?? null,
      plan,
      config: buildStrictBillingPlanConfig({
        plan: plan ?? undefined,
        globalDefaults,
        override: effectiveOverride,
      }),
      currency: account.currency || plan?.currency || "INR",
    };
  }

  if (!input.userId) {
    return {
      organization: null,
      settings: null,
      account: null,
      subscription: null,
      plan: null,
      config: buildStrictBillingPlanConfig({ globalDefaults }),
      currency: "INR",
    };
  }

  const activeSubscription = await getActiveSubscriptionForUser(input.userId);
  const plan = activeSubscription?.plan ?? await getDefaultPlan("b2c");

  return {
    organization: null,
    settings: null,
    account: null,
    subscription: activeSubscription?.subscription ?? null,
    plan,
    config: buildStrictBillingPlanConfig({
      plan: plan ?? undefined,
      globalDefaults,
      override: sessionOverride,
    }),
    currency: plan?.currency || "INR",
  };
}

async function getActiveCallCount(scope: {
  organizationId: number | null;
  userId: number | null;
}): Promise<number> {
  if (scope.organizationId) {
    const [row] = await db.select({ count: sql<number>`count(*)` })
      .from(callBillingRecords)
      .where(and(eq(callBillingRecords.organizationId, scope.organizationId), eq(callBillingRecords.status, "active")));
    return Number(row?.count ?? 0);
  }

  if (!scope.userId) {
    return 0;
  }

  const [row] = await db.select({ count: sql<number>`count(*)` })
    .from(callBillingRecords)
    .where(and(eq(callBillingRecords.userId, scope.userId), eq(callBillingRecords.status, "active")));
  return Number(row?.count ?? 0);
}

function computeInitialReservePaise(
  billingType: StrictBillingType,
  ratePerMinutePaise: number,
  walletAvailablePaise: number,
): number {
  if (billingType === "postpaid" || ratePerMinutePaise <= 0 || walletAvailablePaise <= 0) {
    return 0;
  }

  return Math.min(walletAvailablePaise, Math.max(1, ratePerMinutePaise));
}

async function persistRuntimeState(runtime: CallRuntimeState) {
  await db.update(callBillingRecords)
    .set({
      voiceSeconds: runtime.features.voice.seconds,
      videoSeconds: runtime.features.video.seconds,
      translationSeconds: runtime.features.translation.seconds,
      recordingSeconds: runtime.features.recording.seconds,
      includedFreeSecondsUsed: runtime.includedFreeSecondsUsed,
      includedFreeCreditsUsed: runtime.includedFreeCreditsUsedPaise,
      prepaidDebitPaise: runtime.prepaidDebitPaise,
      postpaidAccrualPaise: runtime.postpaidAccrualPaise,
      totalCostPaise: totalCost(runtime),
      costBreakdown: {
        ...featureCostSummary(runtime),
        prepaidDebitPaise: runtime.prepaidDebitPaise,
        postpaidAccrualPaise: runtime.postpaidAccrualPaise,
        includedFreeSecondsUsed: runtime.includedFreeSecondsUsed,
        includedFreeCreditsUsedPaise: runtime.includedFreeCreditsUsedPaise,
      },
      updatedAt: new Date(),
    })
    .where(eq(callBillingRecords.callId, runtime.sessionId));

  if (runtime.reservationId) {
    await db.update(billingReservations)
      .set({
        reservedAmountPaise: runtime.totalReservedPaise,
        consumedAmountPaise: runtime.prepaidDebitPaise,
        updatedAt: new Date(),
      })
      .where(eq(billingReservations.reservationId, runtime.reservationId));
  }

  if (runtime.billingAccountId) {
    await db.update(billingAccounts)
      .set({
        walletBalancePaise: runtime.walletBalancePaise,
        lockedBalancePaise: runtime.lockedBalancePaise,
        includedSecondsRemaining: runtime.freeSecondsRemaining,
        includedCreditsRemaining: runtime.freeCreditsRemainingPaise,
        outstandingPostpaidPaise: runtime.outstandingPostpaidPaise,
        currentDayUsageSeconds: runtime.currentDayUsageSeconds,
        usageDayAnchor: runtime.usageDayAnchor,
        updatedAt: new Date(),
      })
      .where(eq(billingAccounts.id, runtime.billingAccountId));
  }

  if (runtime.subscriptionId && !runtime.billingAccountId) {
    const subscriptionUpdate: {
      currentUsage: number;
      minutesUsed: number;
      minutesRemaining?: number;
      updatedAt: Date;
    } = {
      currentUsage: runtime.prepaidDebitPaise + runtime.postpaidAccrualPaise,
      minutesUsed: Math.max(0, Math.ceil(runtime.durationSeconds / 60)),
      updatedAt: new Date(),
    };

    if (runtime.billingType !== "postpaid") {
      subscriptionUpdate.minutesRemaining = Math.max(0, Math.ceil(runtime.freeSecondsRemaining / 60));
    }

    await db.update(subscriptions)
      .set(subscriptionUpdate)
      .where(eq(subscriptions.id, runtime.subscriptionId));
  }
}

async function topUpReservation(runtime: CallRuntimeState, requiredPaise: number) {
  if (!runtime.billingAccountId || requiredPaise <= 0) {
    return;
  }

  const availableWalletPaise = Math.max(0, runtime.walletBalancePaise - runtime.lockedBalancePaise);
  if (availableWalletPaise <= 0) {
    return;
  }

  const reserveTarget = Math.max(requiredPaise, runtime.estimatedRatePerMinutePaise);
  const topupAmount = Math.min(availableWalletPaise, reserveTarget);
  if (topupAmount <= 0) {
    return;
  }

  runtime.lockedBalancePaise += topupAmount;
  runtime.totalReservedPaise += topupAmount;
  runtime.reservedAvailablePaise += topupAmount;
  runtime.topupLockedPaise += topupAmount;
}

async function applySecond(runtime: CallRuntimeState) {
  if (
    runtime.config.limits.dailyUsageLimit > 0
    && runtime.currentDayUsageSeconds >= runtime.config.limits.dailyUsageLimit
  ) {
    throw new Error("DAILY_USAGE_LIMIT_REACHED");
  }

  incrementFeatureSeconds(runtime, 1);
  runtime.currentDayUsageSeconds += 1;
  runtime.durationSeconds += 1;

  if (runtime.freeSecondsRemaining > 0) {
    runtime.freeSecondsRemaining -= 1;
    runtime.includedFreeSecondsUsed += 1;
    return;
  }

  const elapsedPaidSeconds = Math.max(0, runtime.durationSeconds - runtime.includedFreeSecondsUsed);
  let deltaCostPaise = 0;
  deltaCostPaise += billFeature(
    runtime.features.voice,
    runtime.callType === "voice" ? runtime.config.rates.voicePerMinutePaise : 0,
    1,
    elapsedPaidSeconds,
    runtime.config.perSecondBilling,
  );
  deltaCostPaise += billFeature(
    runtime.features.video,
    runtime.callType === "video" ? runtime.config.rates.videoPerMinutePaise : 0,
    1,
    elapsedPaidSeconds,
    runtime.config.perSecondBilling,
  );
  deltaCostPaise += billFeature(
    runtime.features.translation,
    runtime.translationEnabled ? runtime.config.rates.translationPerMinutePaise : 0,
    1,
    elapsedPaidSeconds,
    runtime.config.perSecondBilling,
  );
  deltaCostPaise += billFeature(
    runtime.features.recording,
    runtime.recordingEnabled ? runtime.config.rates.recordingPerMinutePaise : 0,
    1,
    elapsedPaidSeconds,
    runtime.config.perSecondBilling,
  );

  if (deltaCostPaise <= 0) {
    return;
  }

  let remainingCostPaise = deltaCostPaise;

  if (runtime.freeCreditsRemainingPaise > 0) {
    const creditsUsed = Math.min(runtime.freeCreditsRemainingPaise, remainingCostPaise);
    runtime.freeCreditsRemainingPaise -= creditsUsed;
    runtime.includedFreeCreditsUsedPaise += creditsUsed;
    remainingCostPaise -= creditsUsed;
  }

  if (remainingCostPaise > 0 && runtime.billingType !== "postpaid") {
    if (runtime.reservedAvailablePaise < remainingCostPaise) {
      await topUpReservation(runtime, remainingCostPaise - runtime.reservedAvailablePaise);
    }

    const prepaidSpend = Math.min(runtime.reservedAvailablePaise, remainingCostPaise);
    if (prepaidSpend > 0) {
      runtime.reservedAvailablePaise -= prepaidSpend;
      runtime.walletBalancePaise = Math.max(0, runtime.walletBalancePaise - prepaidSpend);
      runtime.lockedBalancePaise = Math.max(0, runtime.lockedBalancePaise - prepaidSpend);
      runtime.prepaidDebitPaise += prepaidSpend;
      remainingCostPaise -= prepaidSpend;
    }
  }

  if (remainingCostPaise > 0) {
    if (runtime.billingType === "prepaid") {
      throw new Error("INSUFFICIENT_BALANCE");
    }

    const remainingCreditPaise = getRemainingPostpaidCapacity(runtime);
    if (remainingCreditPaise < remainingCostPaise) {
      throw new Error("CREDIT_LIMIT_EXCEEDED");
    }

    runtime.outstandingPostpaidPaise += remainingCostPaise;
    runtime.postpaidAccrualPaise += remainingCostPaise;
  }
}

function normalizeTerminationReason(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  switch (raw) {
    case "INSUFFICIENT_BALANCE":
    case "CREDIT_LIMIT_EXCEEDED":
    case "DAILY_USAGE_LIMIT_REACHED":
      return raw;
    default:
      return "BILLING_RUNTIME_FAILURE";
  }
}

async function markTerminationRequested(runtime: CallRuntimeState, reason: string) {
  runtime.terminationRequestedReason = reason;
  await persistRuntimeState(runtime);
  await persistRuntimeSession(runtime);
  billingEvents.emit("session.termination_requested", {
    sessionId: runtime.sessionId,
    reason,
  });
}

export class BillingEngine {
  static async ensureOrganizationBillingAccount(organizationId: number) {
    return ensureOrganizationBillingAccount(organizationId);
  }

  static async startCallSession(input: CallBillingStartInput): Promise<CallBillingAuthorization> {
    try {
      const context = await resolveBillingContext({
        userId: input.userId,
        organizationId: input.organizationId ?? null,
        pricingOverride: input.pricingOverride,
      });

      if (input.organizationId && !context.organization) {
        return this.denied("ORGANIZATION_NOT_FOUND");
      }

      if (
        context.organization
        && (!context.organization.isActive || ["rejected", "suspended"].includes(context.organization.status || ""))
      ) {
        return this.denied("ORGANIZATION_BLOCKED");
      }

      if (context.settings?.isBlocked || context.account?.isBlocked || context.account?.status === "blocked") {
        return this.denied("COMPANY_BLOCKED");
      }

      if (!context.plan && !context.account && !context.subscription) {
        return this.denied("NO_ACTIVE_PLAN");
      }

      const requiresTranslation = Boolean(input.translationEnabled);
      const requiresRecording = Boolean(input.recordingEnabled);
      const featuresEnabled = new Set(context.config.featuresEnabled);

      if (featuresEnabled.size > 0) {
        if (requiresTranslation && !featuresEnabled.has("translation")) {
          return this.denied("TRANSLATION_NOT_ENABLED");
        }
        if (requiresRecording && !featuresEnabled.has("recording")) {
          return this.denied("RECORDING_NOT_ENABLED");
        }
      }

      const activeCalls = await getActiveCallCount({
        organizationId: input.organizationId ?? null,
        userId: input.organizationId ? null : input.userId,
      });
      const maxConcurrentCalls = context.account?.maxConcurrentCalls || context.config.limits.maxConcurrentCalls || 0;
      if (maxConcurrentCalls > 0 && activeCalls >= maxConcurrentCalls) {
        return this.denied("MAX_CONCURRENT_CALLS_REACHED");
      }

      const usageAnchor = context.account?.usageDayAnchor ? new Date(context.account.usageDayAnchor) : startOfDay();
      const currentDayUsageSeconds = context.account && isSameCalendarDay(usageAnchor, new Date())
        ? Math.max(0, context.account.currentDayUsageSeconds ?? 0)
        : 0;
      const effectiveUsageAnchor = isSameCalendarDay(usageAnchor, new Date()) ? usageAnchor : startOfDay();
      const dailyUsageLimit = context.account?.dailyUsageLimitSeconds || context.config.limits.dailyUsageLimit || 0;
      if (dailyUsageLimit > 0 && currentDayUsageSeconds >= dailyUsageLimit) {
        return this.denied("DAILY_USAGE_LIMIT_REACHED");
      }

      const estimatedRatePerMinutePaise = getEstimatedRatePerMinute(context.config, {
        callType: input.callType,
        translationEnabled: requiresTranslation,
        recordingEnabled: requiresRecording,
      });

      const freeSecondsRemaining = context.account
        ? Math.max(0, context.account.includedSecondsRemaining ?? 0)
        : Math.max(0, context.subscription?.minutesRemaining ?? context.config.freeUnits.minutes ?? 0) * 60;
      const freeCreditsRemainingPaise = context.account
        ? Math.max(0, context.account.includedCreditsRemaining ?? 0)
        : 0;
      const walletBalancePaise = context.account
        ? Math.max(0, context.account.walletBalancePaise ?? 0)
        : Math.max(0, (context.plan?.priceInPaise ?? 0) - (context.subscription?.currentUsage ?? 0));
      const lockedBalancePaise = context.account ? Math.max(0, context.account.lockedBalancePaise ?? 0) : 0;
      const creditLimitPaise = context.account
        ? Math.max(0, context.account.creditLimitPaise ?? 0)
        : Math.max(0, context.subscription?.creditLimit ?? 0);
      const outstandingPostpaidPaise = context.account
        ? Math.max(0, context.account.outstandingPostpaidPaise ?? 0)
        : Math.max(0, context.subscription?.currentUsage ?? 0);

      const walletAvailablePaise = Math.max(0, walletBalancePaise - lockedBalancePaise);
      const initialReservePaise = computeInitialReservePaise(
        context.config.billingType,
        estimatedRatePerMinutePaise,
        walletAvailablePaise,
      );

      const nowMs = Date.now();
      const billingActive = input.activateOnAnswer !== true;
      const runtime: CallRuntimeState = {
        sessionId: input.sessionId,
        userId: input.userId,
        organizationId: input.organizationId ?? null,
        billingAccountId: context.account?.id ?? null,
        subscriptionId: context.subscription?.id ?? null,
        reservationId: context.account ? randomUUID() : null,
        billingType: context.config.billingType,
        callType: input.callType,
        translationEnabled: requiresTranslation,
        recordingEnabled: requiresRecording,
        joinMethod: input.joinMethod || "app_to_app",
        currency: context.currency,
        config: context.config,
        estimatedRatePerMinutePaise,
        pricingOverride: normalizeOverride(input.pricingOverride),
        maxDurationSeconds: 0,
        freeSecondsRemaining,
        freeCreditsRemainingPaise,
        walletBalancePaise,
        lockedBalancePaise,
        totalReservedPaise: initialReservePaise,
        reservedAvailablePaise: initialReservePaise,
        outstandingPostpaidPaise,
        creditLimitPaise,
        currentDayUsageSeconds,
        usageDayAnchor: effectiveUsageAnchor,
        durationSeconds: 0,
        prepaidDebitPaise: 0,
        postpaidAccrualPaise: 0,
        includedFreeSecondsUsed: 0,
        includedFreeCreditsUsedPaise: 0,
        initialLockedPaise: initialReservePaise,
        topupLockedPaise: 0,
        billingActive,
        authorizedAtMs: nowMs,
        answeredAtMs: billingActive ? nowMs : null,
        startedAtMs: billingActive ? nowMs : 0,
        lastProcessedAtMs: billingActive ? nowMs : 0,
        hardStopAtMs: 0,
        terminationRequestedReason: null,
        features: {
          voice: emptyFeatureCounter(),
          video: emptyFeatureCounter(),
          translation: emptyFeatureCounter(),
          recording: emptyFeatureCounter(),
        },
      };

      runtime.maxDurationSeconds = getMaxDurationSeconds(runtime);
      if (runtime.maxDurationSeconds <= 0) {
        return this.denied("INSUFFICIENT_BALANCE");
      }
      runtime.hardStopAtMs = runtime.billingActive
        ? runtime.startedAtMs + runtime.maxDurationSeconds * 1000
        : 0;

      await db.transaction(async (tx) => {
        if (runtime.billingAccountId && initialReservePaise > 0) {
          await tx.update(billingAccounts)
            .set({
              lockedBalancePaise: runtime.lockedBalancePaise + initialReservePaise,
              updatedAt: new Date(),
            })
            .where(eq(billingAccounts.id, runtime.billingAccountId));
          runtime.lockedBalancePaise += initialReservePaise;
        }

        if (runtime.billingAccountId && !isSameCalendarDay(effectiveUsageAnchor, new Date())) {
          await tx.update(billingAccounts)
            .set({
              currentDayUsageSeconds: 0,
              usageDayAnchor: startOfDay(),
              updatedAt: new Date(),
            })
            .where(eq(billingAccounts.id, runtime.billingAccountId));
          runtime.currentDayUsageSeconds = 0;
          runtime.usageDayAnchor = startOfDay();
        }

        await tx.insert(callBillingRecords).values({
          callId: runtime.sessionId,
          organizationId: runtime.organizationId,
          billingAccountId: runtime.billingAccountId,
          subscriptionId: runtime.subscriptionId,
          reservationId: runtime.reservationId,
          userId: runtime.userId,
          callType: runtime.callType,
          joinMethod: runtime.joinMethod,
          translationUsed: runtime.translationEnabled,
          recordingUsed: runtime.recordingEnabled,
          effectivePricing: {
            billingType: runtime.billingType,
            currency: runtime.currency,
            rates: runtime.config.rates,
            limits: runtime.config.limits,
            featuresEnabled: runtime.config.featuresEnabled,
          },
          costBreakdown: {
            voicePaise: 0,
            videoPaise: 0,
            translationPaise: 0,
            recordingPaise: 0,
          },
          status: runtime.billingActive ? "active" : "created",
          startedAt: runtime.billingActive ? new Date(runtime.startedAtMs) : null,
        });

        if (runtime.reservationId) {
          await tx.insert(billingReservations).values({
            reservationId: runtime.reservationId,
            billingAccountId: runtime.billingAccountId,
            organizationId: runtime.organizationId,
            subscriptionId: runtime.subscriptionId,
            userId: runtime.userId,
            callId: runtime.sessionId,
            callType: runtime.callType,
            translationEnabled: runtime.translationEnabled,
            recordingEnabled: runtime.recordingEnabled,
            reservedAmountPaise: runtime.totalReservedPaise,
            status: "active",
            expiresAt: new Date(Date.now() + 30 * 60 * 1000),
          });
        }

        if (runtime.billingAccountId && initialReservePaise > 0) {
          await tx.insert(billingLedgerEntries).values({
            billingAccountId: runtime.billingAccountId,
            organizationId: runtime.organizationId,
            subscriptionId: runtime.subscriptionId,
            reservationId: runtime.reservationId,
            callId: runtime.sessionId,
            userId: runtime.userId,
            entryType: "wallet_lock",
            direction: "debit",
            amountPaise: initialReservePaise,
            balanceAfterPaise: runtime.walletBalancePaise,
            metadata: {
              callType: runtime.callType,
              translationEnabled: runtime.translationEnabled,
              recordingEnabled: runtime.recordingEnabled,
            },
          });
        }
      });

      await persistRuntimeSession(runtime);
      this.startRuntimeSupervisor();

      return {
        allowed: true,
        reason: undefined,
        reservationId: runtime.reservationId,
        subscriptionId: runtime.subscriptionId,
        billingAccountId: runtime.billingAccountId,
        billingType: runtime.billingType,
        currency: runtime.currency,
        maxDurationSeconds: runtime.maxDurationSeconds,
        estimatedRatePerMinutePaise: runtime.estimatedRatePerMinutePaise,
        estimatedRatePerSecondPaise: runtime.estimatedRatePerMinutePaise / 60,
        freeSecondsRemaining: runtime.freeSecondsRemaining,
        freeCreditsRemainingPaise: runtime.freeCreditsRemainingPaise,
        walletBalancePaise: runtime.walletBalancePaise,
        lockedBalancePaise: runtime.lockedBalancePaise,
        outstandingPostpaidPaise: runtime.outstandingPostpaidPaise,
        creditLimitPaise: runtime.creditLimitPaise,
      };
    } catch (error) {
      logger.error("BillingEngine", "Call authorization failed", error as Error);
      return this.denied("INTERNAL_ERROR");
    }
  }

  static startRuntimeSupervisor() {
    if (billingSupervisorStarted) {
      return;
    }

    billingSupervisorStarted = true;
    setInterval(() => {
      void this.processActiveRuntimeSessions();
    }, 1_000).unref?.();
  }

  private static async processActiveRuntimeSessions() {
    const sessionIds = await listActiveRuntimeSessionIds();
    await Promise.all(sessionIds.map(async (sessionId) => {
      try {
        await this.advanceRuntimeSession(sessionId);
      } catch (error) {
        logger.error("BillingEngine", `Runtime sweep failed for ${sessionId}`, error as Error);
      }
    }));
  }

  private static async advanceRuntimeSession(sessionId: string, explicitElapsedSeconds?: number): Promise<CallBillingProgress> {
    return await withRedisLock(runtimeLockKey(sessionId), async () => {
      const runtime = await loadRuntimeSession(sessionId);
      if (!runtime) {
        await removeRuntimeSession(sessionId);
        throw new Error("BILLING_SESSION_NOT_FOUND");
      }

      if (!runtime.billingActive) {
        return this.snapshot(runtime);
      }

      if (runtime.terminationRequestedReason) {
        billingEvents.emit("session.termination_requested", {
          sessionId: runtime.sessionId,
          reason: runtime.terminationRequestedReason,
        });
        return this.snapshot(runtime);
      }

      const nowMs = Date.now();
      const rawElapsedSeconds = explicitElapsedSeconds ?? Math.floor((nowMs - runtime.lastProcessedAtMs) / 1000);
      if (rawElapsedSeconds <= 0) {
        return this.snapshot(runtime);
      }

      const secondsUntilHardStop = Math.max(0, Math.floor((runtime.hardStopAtMs - runtime.lastProcessedAtMs) / 1000));
      const elapsedSeconds = explicitElapsedSeconds == null
        ? Math.min(rawElapsedSeconds, secondsUntilHardStop)
        : rawElapsedSeconds;

      if (elapsedSeconds <= 0 && nowMs >= runtime.hardStopAtMs) {
        await markTerminationRequested(runtime, "MAX_DURATION_REACHED");
        return this.snapshot(runtime);
      }

      let appliedSeconds = 0;
      try {
        for (; appliedSeconds < elapsedSeconds; appliedSeconds += 1) {
          await applySecond(runtime);
        }
      } catch (error) {
        runtime.lastProcessedAtMs += appliedSeconds * 1000;
        runtime.maxDurationSeconds = getMaxDurationSeconds(runtime);
        await persistRuntimeState(runtime);
        await persistRuntimeSession(runtime);
        await markTerminationRequested(runtime, normalizeTerminationReason(error));
        return this.snapshot(runtime);
      }

      runtime.lastProcessedAtMs += appliedSeconds * 1000;
      runtime.maxDurationSeconds = getMaxDurationSeconds(runtime);
      await persistRuntimeState(runtime);
      await persistRuntimeSession(runtime);

      if (runtime.maxDurationSeconds <= 0 || Date.now() >= runtime.hardStopAtMs) {
        await markTerminationRequested(runtime, "MAX_DURATION_REACHED");
      }

      return this.snapshot(runtime);
    }, { ttlMs: 15_000 });
  }

  static async tickCallSession(sessionId: string, elapsedSeconds = 1): Promise<CallBillingProgress> {
    return await this.advanceRuntimeSession(sessionId, elapsedSeconds);
  }

  static async activateCallSession(sessionId: string): Promise<CallBillingActivation> {
    return await withRedisLock(runtimeLockKey(sessionId), async () => {
      const runtime = await loadRuntimeSession(sessionId);
      if (!runtime) {
        throw new Error("BILLING_SESSION_NOT_FOUND");
      }

      if (runtime.billingActive) {
        return {
          ...this.snapshot(runtime),
          activatedAtMs: runtime.startedAtMs,
        };
      }

      const nowMs = Date.now();
      runtime.billingActive = true;
      runtime.answeredAtMs = nowMs;
      runtime.startedAtMs = nowMs;
      runtime.lastProcessedAtMs = nowMs;
      runtime.maxDurationSeconds = getMaxDurationSeconds(runtime);
      if (runtime.maxDurationSeconds <= 0) {
        await markTerminationRequested(runtime, "INSUFFICIENT_BALANCE");
        throw new Error("INSUFFICIENT_BALANCE");
      }
      runtime.hardStopAtMs = nowMs + runtime.maxDurationSeconds * 1000;

      await db.update(callBillingRecords)
        .set({
          status: "active",
          startedAt: new Date(nowMs),
          updatedAt: new Date(),
        })
        .where(eq(callBillingRecords.callId, runtime.sessionId));

      await persistRuntimeSession(runtime);

      return {
        ...this.snapshot(runtime),
        activatedAtMs: nowMs,
      };
    }, { ttlMs: 15_000 });
  }

  static async setCallSessionStatus(sessionId: string, status: string): Promise<void> {
    await db.update(callBillingRecords)
      .set({
        status,
        updatedAt: new Date(),
      })
      .where(eq(callBillingRecords.callId, sessionId));
  }

  static async getCallSessionProgress(sessionId: string): Promise<CallBillingProgress | null> {
    const runtime = await loadRuntimeSession(sessionId);
    if (runtime) {
      return this.snapshot(runtime);
    }

    const [record] = await db.select().from(callBillingRecords).where(eq(callBillingRecords.callId, sessionId)).limit(1);
    if (!record) {
      return null;
    }

    return {
      sessionId,
      totalCostPaise: record.totalCostPaise ?? 0,
      prepaidDebitPaise: record.prepaidDebitPaise ?? 0,
      postpaidAccrualPaise: record.postpaidAccrualPaise ?? 0,
      durationSeconds: Math.max(record.voiceSeconds ?? 0, record.videoSeconds ?? 0),
      freeSecondsRemaining: 0,
      freeCreditsRemainingPaise: 0,
      walletBalancePaise: 0,
      lockedBalancePaise: 0,
      outstandingPostpaidPaise: record.postpaidAccrualPaise ?? 0,
    };
  }

  static async finalizeCallSession(
    sessionId: string,
    status: "completed" | "ended" | "dropped" | "failed" = "completed",
  ): Promise<CallBillingFinalization> {
    return await withRedisLock(runtimeLockKey(sessionId), async () => {
      const runtime = await loadRuntimeSession(sessionId);
      if (!runtime) {
        await removeRuntimeSession(sessionId);
        const [record] = await db.select().from(callBillingRecords).where(eq(callBillingRecords.callId, sessionId)).limit(1);
        if (!record) {
          throw new Error("BILLING_SESSION_NOT_FOUND");
        }

        return {
          sessionId,
          callId: sessionId,
          totalCostPaise: record.totalCostPaise ?? 0,
          prepaidDebitPaise: record.prepaidDebitPaise ?? 0,
          postpaidAccrualPaise: record.postpaidAccrualPaise ?? 0,
          durationSeconds: Math.max(record.voiceSeconds ?? 0, record.videoSeconds ?? 0),
          freeSecondsRemaining: 0,
          freeCreditsRemainingPaise: 0,
          walletBalancePaise: 0,
          lockedBalancePaise: 0,
          outstandingPostpaidPaise: record.postpaidAccrualPaise ?? 0,
          invoiceableAmountPaise: record.postpaidAccrualPaise ?? 0,
          costBreakdown: (record.costBreakdown as Record<string, number>) || {},
        };
      }

      await persistRuntimeState(runtime);

      const releaseAmountPaise = runtime.reservedAvailablePaise;
      const finalTotalCostPaise = totalCost(runtime);
      const finalCostBreakdown = {
        ...featureCostSummary(runtime),
        prepaidDebitPaise: runtime.prepaidDebitPaise,
        postpaidAccrualPaise: runtime.postpaidAccrualPaise,
        includedFreeSecondsUsed: runtime.includedFreeSecondsUsed,
        includedFreeCreditsUsedPaise: runtime.includedFreeCreditsUsedPaise,
        invoiceableAmountPaise: invoiceableAmount(runtime),
        totalCostPaise: finalTotalCostPaise,
      };

      await db.transaction(async (tx) => {
        if (runtime.billingAccountId && releaseAmountPaise > 0) {
          runtime.lockedBalancePaise = Math.max(0, runtime.lockedBalancePaise - releaseAmountPaise);
          await tx.update(billingAccounts)
            .set({
              walletBalancePaise: runtime.walletBalancePaise,
              lockedBalancePaise: runtime.lockedBalancePaise,
              includedSecondsRemaining: runtime.freeSecondsRemaining,
              includedCreditsRemaining: runtime.freeCreditsRemainingPaise,
              outstandingPostpaidPaise: runtime.outstandingPostpaidPaise,
              currentDayUsageSeconds: runtime.currentDayUsageSeconds,
              usageDayAnchor: runtime.usageDayAnchor,
              updatedAt: new Date(),
            })
            .where(eq(billingAccounts.id, runtime.billingAccountId));
        }

        await tx.update(callBillingRecords)
          .set({
            voiceSeconds: runtime.features.voice.seconds,
            videoSeconds: runtime.features.video.seconds,
            translationSeconds: runtime.features.translation.seconds,
            recordingSeconds: runtime.features.recording.seconds,
            includedFreeSecondsUsed: runtime.includedFreeSecondsUsed,
            includedFreeCreditsUsed: runtime.includedFreeCreditsUsedPaise,
            prepaidDebitPaise: runtime.prepaidDebitPaise,
            postpaidAccrualPaise: runtime.postpaidAccrualPaise,
            totalCostPaise: finalTotalCostPaise,
            costBreakdown: finalCostBreakdown,
            status,
            endedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(callBillingRecords.callId, runtime.sessionId));

        if (runtime.reservationId) {
          await tx.update(billingReservations)
            .set({
              reservedAmountPaise: runtime.totalReservedPaise,
              consumedAmountPaise: runtime.prepaidDebitPaise,
              releasedAmountPaise: releaseAmountPaise,
              status: "finalized",
              finalizedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(billingReservations.reservationId, runtime.reservationId));
        }

        if (runtime.billingAccountId && runtime.topupLockedPaise > 0) {
          await tx.insert(billingLedgerEntries).values({
            billingAccountId: runtime.billingAccountId,
            organizationId: runtime.organizationId,
            subscriptionId: runtime.subscriptionId,
            reservationId: runtime.reservationId,
            callId: runtime.sessionId,
            userId: runtime.userId,
            entryType: "wallet_lock_extension",
            direction: "debit",
            amountPaise: runtime.topupLockedPaise,
            balanceAfterPaise: runtime.walletBalancePaise,
            metadata: { callType: runtime.callType },
          });
        }

        if (runtime.billingAccountId && runtime.prepaidDebitPaise > 0) {
          await tx.insert(billingLedgerEntries).values({
            billingAccountId: runtime.billingAccountId,
            organizationId: runtime.organizationId,
            subscriptionId: runtime.subscriptionId,
            reservationId: runtime.reservationId,
            callId: runtime.sessionId,
            userId: runtime.userId,
            entryType: "usage_debit",
            direction: "debit",
            amountPaise: runtime.prepaidDebitPaise,
            balanceAfterPaise: runtime.walletBalancePaise,
            metadata: finalCostBreakdown,
          });
        }

        if (runtime.billingAccountId && releaseAmountPaise > 0) {
          await tx.insert(billingLedgerEntries).values({
            billingAccountId: runtime.billingAccountId,
            organizationId: runtime.organizationId,
            subscriptionId: runtime.subscriptionId,
            reservationId: runtime.reservationId,
            callId: runtime.sessionId,
            userId: runtime.userId,
            entryType: "wallet_release",
            direction: "credit",
            amountPaise: releaseAmountPaise,
            balanceAfterPaise: runtime.walletBalancePaise,
            metadata: { releasedAmountPaise: releaseAmountPaise },
          });
        }

        if (runtime.billingAccountId && runtime.postpaidAccrualPaise > 0) {
          await tx.insert(billingLedgerEntries).values({
            billingAccountId: runtime.billingAccountId,
            organizationId: runtime.organizationId,
            subscriptionId: runtime.subscriptionId,
            reservationId: runtime.reservationId,
            callId: runtime.sessionId,
            userId: runtime.userId,
            entryType: "postpaid_accrual",
            direction: "debit",
            amountPaise: runtime.postpaidAccrualPaise,
            balanceAfterPaise: runtime.outstandingPostpaidPaise,
            metadata: finalCostBreakdown,
          });
        }

        const invoiceablePaise = invoiceableAmount(runtime);
        await tx.insert(usageRecords).values({
          subscriptionId: runtime.subscriptionId,
          userId: runtime.userId,
          organizationId: runtime.organizationId,
          externalCallId: runtime.sessionId,
          usageType: runtime.callType === "video" ? "video_call" : "voice_call",
          callType: runtime.callType,
          durationSeconds: runtime.durationSeconds,
          minutesConsumed: Math.max(1, Math.ceil(runtime.durationSeconds / 60)),
          translationUsed: runtime.translationEnabled,
          emotionAnalysisUsed: false,
          baseCostPaise: runtime.features.voice.paise + runtime.features.video.paise,
          featureCostPaise: runtime.features.translation.paise + runtime.features.recording.paise,
          totalCostPaise: finalTotalCostPaise,
          costBreakdown: finalCostBreakdown,
          billingSnapshot: {
            billingType: runtime.billingType,
            invoiceableAmountPaise: invoiceablePaise,
            currency: runtime.currency,
            effectivePricing: runtime.config.rates,
          },
          billed: invoiceablePaise <= 0,
          usageDate: new Date(),
        });
      });

      await removeRuntimeSession(sessionId);

      return {
        sessionId,
        callId: sessionId,
        totalCostPaise: finalTotalCostPaise,
        prepaidDebitPaise: runtime.prepaidDebitPaise,
        postpaidAccrualPaise: runtime.postpaidAccrualPaise,
        durationSeconds: runtime.durationSeconds,
        freeSecondsRemaining: runtime.freeSecondsRemaining,
        freeCreditsRemainingPaise: runtime.freeCreditsRemainingPaise,
        walletBalancePaise: runtime.walletBalancePaise,
        lockedBalancePaise: runtime.lockedBalancePaise,
        outstandingPostpaidPaise: runtime.outstandingPostpaidPaise,
        invoiceableAmountPaise: invoiceableAmount(runtime),
        costBreakdown: finalCostBreakdown,
      };
    }, { ttlMs: 15_000 });
  }

  static async getAdminBillingOverview() {
    const [summary] = await db.select({
      totalRevenuePaise: sql<number>`COALESCE(SUM(${callBillingRecords.prepaidDebitPaise} + ${callBillingRecords.postpaidAccrualPaise}), 0)`,
      outstandingPaise: sql<number>`COALESCE(SUM(${billingAccounts.outstandingPostpaidPaise}), 0)`,
      activeCalls: sql<number>`COALESCE((SELECT COUNT(*) FROM ${callBillingRecords} WHERE ${callBillingRecords.status} = 'active'), 0)`,
    }).from(billingAccounts) as BillingSummaryRow[];

    const [companyCount] = await db.select({
      count: sql<number>`count(*)`,
    }).from(billingAccounts);

    return {
      totalRevenuePaise: Number(summary?.totalRevenuePaise ?? 0),
      outstandingPaise: Number(summary?.outstandingPaise ?? 0),
      activeCalls: Number(summary?.activeCalls ?? 0),
      companyCount: Number(companyCount?.count ?? 0),
    };
  }

  static async listOrganizationBillingAccounts() {
    return db.select({
      account: billingAccounts,
      organization: organizations,
      plan: billingPlans,
    })
      .from(billingAccounts)
      .innerJoin(organizations, eq(billingAccounts.organizationId, organizations.id))
      .leftJoin(billingPlans, eq(billingAccounts.assignedPlanId, billingPlans.id))
      .orderBy(organizations.name);
  }

  static async assignPlanToOrganization(input: {
    organizationId: number;
    assignedPlanId?: number | null;
    billingType?: StrictBillingType;
    customPricingOverride?: Partial<StrictBillingPlanConfig> | null;
    creditLimitPaise?: number;
    maxConcurrentCalls?: number;
    dailyUsageLimitSeconds?: number;
  }) {
    const account = await ensureOrganizationBillingAccount(input.organizationId);
    const plan = await getPlanById(input.assignedPlanId ?? account.assignedPlanId ?? null);
    const config = buildStrictBillingPlanConfig({
      plan: plan ?? undefined,
      override: normalizeOverride(input.customPricingOverride),
    });

    const [updated] = await db.update(billingAccounts)
      .set({
        assignedPlanId: input.assignedPlanId ?? account.assignedPlanId,
        billingType: input.billingType ?? config.billingType,
        customPricingOverride: input.customPricingOverride ?? account.customPricingOverride,
        includedSecondsRemaining: account.assignedPlanId !== input.assignedPlanId
          ? Math.max(0, config.freeUnits.minutes * 60)
          : account.includedSecondsRemaining,
        includedCreditsRemaining: account.assignedPlanId !== input.assignedPlanId
          ? Math.max(0, config.freeUnits.credits * 100)
          : account.includedCreditsRemaining,
        creditLimitPaise: input.creditLimitPaise ?? account.creditLimitPaise,
        maxConcurrentCalls: input.maxConcurrentCalls ?? config.limits.maxConcurrentCalls,
        dailyUsageLimitSeconds: input.dailyUsageLimitSeconds ?? config.limits.dailyUsageLimit,
        updatedAt: new Date(),
      })
      .where(eq(billingAccounts.id, account.id))
      .returning();

    return updated;
  }

  static async adjustOrganizationBalance(input: {
    organizationId: number;
    amountPaise: number;
    type: "wallet_credit" | "wallet_debit" | "credit_limit_settlement" | "manual_adjustment";
    actorUserId: number;
    description?: string;
  }) {
    const account = await ensureOrganizationBillingAccount(input.organizationId);
    const nextWalletBalance = input.type === "credit_limit_settlement"
      ? account.walletBalancePaise
      : Math.max(0, account.walletBalancePaise + input.amountPaise);
    const nextOutstanding = input.type === "credit_limit_settlement"
      ? Math.max(0, account.outstandingPostpaidPaise - Math.max(0, input.amountPaise))
      : account.outstandingPostpaidPaise;

    const [updated] = await db.update(billingAccounts)
      .set({
        walletBalancePaise: nextWalletBalance,
        outstandingPostpaidPaise: nextOutstanding,
        updatedAt: new Date(),
      })
      .where(eq(billingAccounts.id, account.id))
      .returning();

    await db.insert(billingLedgerEntries).values({
      billingAccountId: account.id,
      organizationId: input.organizationId,
      entryType: input.type,
      direction: input.amountPaise >= 0 ? "credit" : "debit",
      amountPaise: Math.abs(input.amountPaise),
      balanceAfterPaise: input.type === "credit_limit_settlement" ? nextOutstanding : nextWalletBalance,
      metadata: {
        description: input.description || null,
      },
      createdBy: input.actorUserId,
    });

    return updated;
  }

  static async setOrganizationBlockStatus(input: {
    organizationId: number;
    blocked: boolean;
    reason?: string;
  }) {
    const account = await ensureOrganizationBillingAccount(input.organizationId);
    const [updated] = await db.update(billingAccounts)
      .set({
        isBlocked: input.blocked,
        status: input.blocked ? "blocked" : "active",
        blockedReason: input.blocked ? input.reason || "Blocked by super admin" : null,
        blockedAt: input.blocked ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(billingAccounts.id, account.id))
      .returning();

    await db.update(billingSettings)
      .set({
        isBlocked: input.blocked,
        blockedReason: input.blocked ? input.reason || "Blocked by super admin" : null,
        blockedAt: input.blocked ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(billingSettings.organizationId, input.organizationId));

    return updated;
  }

  static snapshot(runtime: CallRuntimeState): CallBillingProgress {
    return {
      sessionId: runtime.sessionId,
      totalCostPaise: totalCost(runtime),
      prepaidDebitPaise: runtime.prepaidDebitPaise,
      postpaidAccrualPaise: runtime.postpaidAccrualPaise,
      durationSeconds: runtime.durationSeconds,
      freeSecondsRemaining: runtime.freeSecondsRemaining,
      freeCreditsRemainingPaise: runtime.freeCreditsRemainingPaise,
      walletBalancePaise: runtime.walletBalancePaise,
      lockedBalancePaise: runtime.lockedBalancePaise,
      outstandingPostpaidPaise: runtime.outstandingPostpaidPaise,
    };
  }

  private static denied(reason: string): CallBillingAuthorization {
    return {
      allowed: false,
      reason,
      reservationId: null,
      subscriptionId: null,
      billingAccountId: null,
      billingType: "prepaid",
      currency: "INR",
      maxDurationSeconds: 0,
      estimatedRatePerMinutePaise: 0,
      estimatedRatePerSecondPaise: 0,
      freeSecondsRemaining: 0,
      freeCreditsRemainingPaise: 0,
      walletBalancePaise: 0,
      lockedBalancePaise: 0,
      outstandingPostpaidPaise: 0,
      creditLimitPaise: 0,
    };
  }
}
