/**
 * Business utility-message billing gate -- Phase 7 (2026-08-24). See doc 32
 * section 12. Composes on the SAME primitive Campaigns and OTP use
 * (server/modules/billing/message-billing.ts) -- no duplicated billing
 * architecture, per the brief's explicit instruction.
 *
 * PRICING IS NOT DEFINED BY THIS PHASE -- `PLACEHOLDER_COST_PER_UTILITY_MESSAGE_PAISE`
 * exists only so the gate has a real, testable accounting effect,
 * identical reasoning to campaigns/billing.ts and otp/billing.ts's own
 * placeholders. A business is charged only inside the same transaction as
 * the canonical message's actual creation -- never merely because a
 * business_utility_events row was claimed/exists (a FAILED row never
 * charges anything).
 */
export { chargeMessage as chargeUtilityMessage, type ChargeResult } from "../billing/message-billing";

// NOT an approved price -- see file header.
export const PLACEHOLDER_COST_PER_UTILITY_MESSAGE_PAISE = 10;
