/**
 * Business messaging account health: a quality rating and a daily messaging
 * limit for each business, so a business can only reach as many customers
 * as its track record earns -- the main protection against spam.
 *
 * - Quality (last 7 days): customers who blocked the business, turned off
 *   its offers, or reported it, out of the customers it messaged.
 * - Limit: unique customers per rolling 24 h that the business may START
 *   messaging (campaigns). New businesses start at 250; with high quality
 *   and real use the limit steps up automatically; low quality lowers it a
 *   step. A NeuraTalk super admin can set and lock it.
 *
 * Replies inside a conversation the customer started are never limited.
 */
import { db } from "../../db";
import { organizations, customers, customerConsents, campaigns, campaignRecipients, abuseReports, CAMPAIGN_RECIPIENT_STATUS, CUSTOMER_CONSENT_STATUS } from "@shared/schema";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { listPolicyActions, isRestricted, type PolicyAction } from "./policy";
import { getMessagePrices } from "./pricing";

export const MESSAGING_TIERS = [250, 1000, 10_000, 100_000] as const;
export const DEFAULT_MESSAGING_TIER = MESSAGING_TIERS[0];
const LIMIT_SETTINGS_KEY = "messagingLimit";
const DAY_MS = 24 * 60 * 60 * 1000;
// Below this many customers reached in a week there is not enough signal.
const MIN_REACHED_FOR_RATING = 20;

export type MessagingQuality = "new" | "high" | "medium" | "low";

export interface StoredLimit {
  tier: number;
  // true: set by a NeuraTalk admin and not changed automatically.
  pinned: boolean;
  updatedAt: string | null;
}

export interface AccountHealth {
  quality: MessagingQuality;
  /** Limit the business set/earned (before a low-quality step down). */
  tier: number;
  /** What actually applies now. */
  effectiveLimit: number;
  pinned: boolean;
  usedLast24h: number;
  reachedLast7d: number;
  negative: { blocks: number; optOuts: number; reports: number };
  negativeRatePercent: number;
  nextTier: number | null;
  /** Plain-language next step for the business. */
  advice: string;
  /** NeuraTalk restricted campaigns (latest restriction, until lifted). */
  restriction: { reason: string; since: string } | null;
  /** Warnings / restrictions / lifts from NeuraTalk, newest first. */
  notices: PolicyAction[];
  /** What each message costs now (paise). */
  prices: { marketingPaise: number; utilityPaise: number; otpPaise: number };
}

export function readStoredLimit(settings: unknown): StoredLimit {
  const raw = (settings as Record<string, unknown> | null)?.[LIMIT_SETTINGS_KEY] as Record<string, unknown> | undefined;
  const tier = Number(raw?.tier);
  return {
    tier: (MESSAGING_TIERS as readonly number[]).includes(tier) ? tier : DEFAULT_MESSAGING_TIER,
    pinned: raw?.pinned === true,
    updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : null,
  };
}

export function qualityFor(reached: number, negativeTotal: number): MessagingQuality {
  if (reached < MIN_REACHED_FOR_RATING) return "new";
  const rate = negativeTotal / reached;
  if (rate < 0.02) return "high";
  if (rate < 0.05) return "medium";
  return "low";
}

export function stepDown(tier: number): number {
  const i = (MESSAGING_TIERS as readonly number[]).indexOf(tier);
  return i > 0 ? MESSAGING_TIERS[i - 1] : MESSAGING_TIERS[0];
}

export function nextTierFor(tier: number): number | null {
  const i = (MESSAGING_TIERS as readonly number[]).indexOf(tier);
  return i >= 0 && i < MESSAGING_TIERS.length - 1 ? MESSAGING_TIERS[i + 1] : null;
}

/** Unique customers this business started messaging (campaign sends) since `since`. */
async function customersMessagedSince(businessId: number, since: Date): Promise<Set<number>> {
  const rows = await db.selectDistinct({ customerId: campaignRecipients.customerId })
    .from(campaignRecipients)
    .innerJoin(campaigns, eq(campaigns.id, campaignRecipients.campaignId))
    .where(and(
      eq(campaigns.businessId, businessId),
      eq(campaignRecipients.status, CAMPAIGN_RECIPIENT_STATUS.SENT),
      gt(campaignRecipients.processedAt, since),
    ));
  return new Set(rows.map((r) => r.customerId));
}

async function negativeSignals(businessId: number, since: Date) {
  const [blocks] = await db.select({ n: sql<number>`count(*)::int` }).from(customers)
    .where(and(eq(customers.businessId, businessId), gt(customers.blockedByCustomerAt, since)));
  // Turned off offers from their own app (a business changing it doesn't count).
  const [optOuts] = await db.select({ n: sql<number>`count(*)::int` }).from(customerConsents)
    .where(and(
      eq(customerConsents.businessId, businessId),
      eq(customerConsents.status, CUSTOMER_CONSENT_STATUS.REVOKED),
      eq(customerConsents.source, "customer_app"),
      gt(customerConsents.updatedAt, since),
    ));
  const [reports] = await db.select({ n: sql<number>`count(*)::int` }).from(abuseReports)
    .where(and(
      inArray(abuseReports.reportedEntityType, ["business", "organization"]),
      eq(abuseReports.reportedEntityId, businessId),
      gt(abuseReports.createdAt, since),
    ));
  return { blocks: blocks?.n ?? 0, optOuts: optOuts?.n ?? 0, reports: reports?.n ?? 0 };
}

async function saveLimit(businessId: number, limit: StoredLimit): Promise<void> {
  await db.update(organizations)
    .set({
      settings: sql`jsonb_set(coalesce(${organizations.settings}, '{}'::jsonb), ${`{${LIMIT_SETTINGS_KEY}}`}::text[], ${JSON.stringify(limit)}::jsonb)`,
    })
    .where(eq(organizations.id, businessId));
}

function adviceFor(h: Omit<AccountHealth, "advice">): string {
  if (h.restriction) {
    return `NeuraTalk has paused your campaigns: ${h.restriction.reason} Replies to customers still work. Contact support after fixing this.`;
  }
  if (h.quality === "low") {
    return "Many customers blocked you, turned off your offers or reported you this week. Send fewer promotions, only to people who asked for them. Your daily limit is lowered until this improves.";
  }
  if (h.quality === "medium") {
    return "Some customers are blocking you or turning off offers. Keep messages useful and relevant to stay at High quality.";
  }
  if (h.nextTier && !h.pinned) {
    return `Keep quality High and reach at least ${Math.ceil(h.tier / 2)} customers in a day to move up to ${h.nextTier.toLocaleString("en-IN")} customers a day.`;
  }
  if (h.pinned) return "Your limit is set by NeuraTalk. Contact support to change it.";
  return "You have the highest limit.";
}

/**
 * Current health; also applies an earned automatic step up (not when pinned
 * by an admin): High quality and at least half the limit used in some
 * recent day -- approximated by unique customers in the last 24 h.
 */
export async function getAccountHealth(businessId: number): Promise<AccountHealth | null> {
  const [org] = await db.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, businessId));
  if (!org) return null;
  const stored = readStoredLimit(org.settings);
  const now = Date.now();
  const [day, week, negative] = await Promise.all([
    customersMessagedSince(businessId, new Date(now - DAY_MS)),
    customersMessagedSince(businessId, new Date(now - 7 * DAY_MS)),
    negativeSignals(businessId, new Date(now - 7 * DAY_MS)),
  ]);
  const negativeTotal = negative.blocks + negative.optOuts + negative.reports;
  const quality = qualityFor(week.size, negativeTotal);

  let tier = stored.tier;
  const next = nextTierFor(tier);
  if (!stored.pinned && quality === "high" && next && day.size >= tier / 2) {
    tier = next;
    await saveLimit(businessId, { tier, pinned: false, updatedAt: new Date(now).toISOString() });
  }

  const [notices, prices] = await Promise.all([listPolicyActions(businessId, 10), getMessagePrices()]);
  const restricted = isRestricted(notices);

  const base: Omit<AccountHealth, "advice"> = {
    quality,
    tier,
    restriction: restricted ? { reason: restricted.reason, since: restricted.createdAt } : null,
    notices,
    prices: { marketingPaise: prices.marketingPaise, utilityPaise: prices.utilityPaise, otpPaise: prices.otpPaise },
    effectiveLimit: restricted ? 0 : quality === "low" ? stepDown(tier) : tier,
    pinned: stored.pinned,
    usedLast24h: day.size,
    reachedLast7d: week.size,
    negative,
    negativeRatePercent: week.size > 0 ? Math.round((negativeTotal / week.size) * 1000) / 10 : 0,
    nextTier: nextTierFor(tier),
  };
  return { ...base, advice: adviceFor(base) };
}

/** Super admin: set (and optionally lock) a business's daily limit. */
export async function setMessagingLimit(businessId: number, tier: number, pinned: boolean): Promise<StoredLimit> {
  if (!(MESSAGING_TIERS as readonly number[]).includes(tier)) throw new Error("Unknown messaging limit");
  const limit: StoredLimit = { tier, pinned, updatedAt: new Date().toISOString() };
  await saveLimit(businessId, limit);
  return limit;
}

/**
 * Per-campaign-run gate: allows a send if the customer was already messaged
 * in the last 24 h (no new conversation) or the business is under its
 * limit. Counts in memory during one run, starting from the database.
 */
export async function createDailyMessagingGate(businessId: number) {
  const health = await getAccountHealth(businessId);
  const limit = health?.effectiveLimit ?? DEFAULT_MESSAGING_TIER;
  const restricted = Boolean(health?.restriction);
  const reached = await customersMessagedSince(businessId, new Date(Date.now() - DAY_MS));
  return {
    limit,
    restricted,
    allow(customerId: number): boolean {
      // A restriction by NeuraTalk stops every campaign send.
      if (restricted) return false;
      if (reached.has(customerId)) return true;
      if (reached.size >= limit) return false;
      reached.add(customerId);
      return true;
    },
  };
}
