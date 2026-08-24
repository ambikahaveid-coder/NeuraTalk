/**
 * Business OTP billing gate -- Phase 6 (2026-08-24). See doc 31 section 14.
 * Composes on the SAME primitive campaigns/billing.ts uses (server/
 * modules/billing/message-billing.ts) -- no duplicated billing
 * architecture, per the brief's explicit instruction.
 *
 * PRICING IS NOT DEFINED BY THIS PHASE -- `PLACEHOLDER_COST_PER_OTP_PAISE`
 * exists only so the gate has a real, testable accounting effect,
 * identical reasoning to campaigns/billing.ts's own placeholder. A
 * business is charged only at the moment a challenge's Authentication
 * Message + Delivery Intent are actually created (inside the same
 * transaction, same idempotency guarantee as campaigns) -- never merely
 * because a challenge row exists. See doc 31 section 14 for the exact
 * accounting boundary.
 */
export { chargeMessage as chargeOtpMessage, type ChargeResult } from "../billing/message-billing";

// NOT an approved price -- see file header.
export const PLACEHOLDER_COST_PER_OTP_PAISE = 15;
