/**
 * AI translation of chat messages is part of the paid AI service, like
 * translated calls. A message is ALWAYS delivered; it is only translated
 * while the sender may use AI translation:
 *  - personal users: while they have AI minutes (5 free to try, then a plan);
 *    every CHAT_MESSAGES_PER_AI_MINUTE translated messages use one minute;
 *  - business users: while their company has paid (checkOrgBillingStatus).
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { subscriptions, users } from "@shared/schema";
import { getRedisClient } from "./redis";
import { logger } from "./observability";
import { checkOrgBillingStatus, checkUserBillingStatus } from "./usage-enforcement";

export const CHAT_MESSAGES_PER_AI_MINUTE = 10;
const CACHE_MS = 30_000;
const allowedCache = new Map<number, { allowed: boolean; at: number }>();

async function payerOf(userId: number) {
  const [row] = await db.select({ organizationId: users.organizationId, role: users.role })
    .from(users).where(eq(users.id, userId));
  return row ?? null;
}

/** May this sender's chat messages be AI-translated right now? */
export async function mayTranslateChatFor(userId: number | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const cached = allowedCache.get(userId);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.allowed;
  let allowed = false;
  try {
    const payer = await payerOf(userId);
    if (payer?.role === "super_admin") allowed = true;
    else if (payer?.organizationId) allowed = (await checkOrgBillingStatus(payer.organizationId)).allowed;
    else allowed = (await checkUserBillingStatus(userId)).allowed;
  } catch (error) {
    logger.warn("AiChatUsage", `billing check failed for ${userId}: ${String(error)}`);
    allowed = false;
  }
  allowedCache.set(userId, { allowed, at: Date.now() });
  return allowed;
}

/**
 * Counts translated messages for a personal sender and takes one AI minute
 * per CHAT_MESSAGES_PER_AI_MINUTE. Business senders are billed by their
 * company plan instead. Never throws: a counting problem must not lose a message.
 */
export async function recordChatTranslations(userId: number | null | undefined, translatedCount: number): Promise<void> {
  if (!userId || translatedCount <= 0) return;
  try {
    const payer = await payerOf(userId);
    if (!payer || payer.organizationId || payer.role === "super_admin") return;
    const key = `ai_chat_translations:${userId}`;
    const total = await getRedisClient().incrby(key, translatedCount);
    const minutesDue = Math.floor(total / CHAT_MESSAGES_PER_AI_MINUTE) - Math.floor((total - translatedCount) / CHAT_MESSAGES_PER_AI_MINUTE);
    if (minutesDue <= 0) return;
    const [active] = await db.select({ id: subscriptions.id })
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, "active")))
      .orderBy(desc(subscriptions.createdAt))
      .limit(1);
    if (!active) return;
    await db.update(subscriptions)
      .set({
        minutesRemaining: sql`greatest(0, coalesce(${subscriptions.minutesRemaining}, 0) - ${minutesDue})`,
        minutesUsed: sql`coalesce(${subscriptions.minutesUsed}, 0) + ${minutesDue}`,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, active.id));
    allowedCache.delete(userId);
  } catch (error) {
    logger.warn("AiChatUsage", `could not record chat translations for ${userId}: ${String(error)}`);
  }
}
