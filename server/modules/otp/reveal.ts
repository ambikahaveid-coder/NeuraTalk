/**
 * In-app OTP display. The stored message always carries the redacted
 * marker (render.ts); the real code exists only encrypted on the challenge
 * row while it is PENDING and unexpired. This substitutes it back in for
 * exactly one audience -- the customer's own app (and their push
 * notification) -- and never for the business inbox, logs or API responses
 * to the business.
 */
import { db } from "../../db";
import { businessOtpChallenges, MESSAGE_CATEGORY, OTP_CHALLENGE_STATUS } from "@shared/schema";
import { inArray } from "drizzle-orm";
import { decryptTenantSecret } from "../../tenant-secrets";
import { REDACTION_MARKER } from "./render";
import { logger } from "../../observability";

const NO_LONGER_VALID = "[code no longer valid]";

type MessageLike = { id: number; category: string; content: string };

export async function revealInAppOtpCodes<T extends MessageLike>(messages: T[]): Promise<T[]> {
  const otpIds = messages
    .filter((m) => m.category === MESSAGE_CATEGORY.AUTHENTICATION && m.content.includes(REDACTION_MARKER))
    .map((m) => m.id);
  if (otpIds.length === 0) return messages;

  const challenges = await db.select({
    messageId: businessOtpChallenges.messageId,
    status: businessOtpChallenges.status,
    expiresAt: businessOtpChallenges.expiresAt,
    deliveryCiphertext: businessOtpChallenges.deliveryCiphertext,
  }).from(businessOtpChallenges).where(inArray(businessOtpChallenges.messageId, otpIds));

  const codeByMessage = new Map<number, string>();
  for (const challenge of challenges) {
    if (challenge.messageId == null) continue;
    let replacement = NO_LONGER_VALID;
    const live = challenge.status === OTP_CHALLENGE_STATUS.PENDING && challenge.expiresAt.getTime() > Date.now();
    if (live && challenge.deliveryCiphertext) {
      try {
        replacement = decryptTenantSecret(challenge.deliveryCiphertext) ?? NO_LONGER_VALID;
      } catch (error) {
        logger.error("BusinessOtp", "Could not decrypt an in-app OTP", error instanceof Error ? error : new Error(String(error)));
      }
    }
    codeByMessage.set(challenge.messageId, replacement);
  }

  return messages.map((m) => {
    const replacement = codeByMessage.get(m.id);
    return replacement ? { ...m, content: m.content.split(REDACTION_MARKER).join(replacement) } : m;
  });
}
