/**
 * Campaign billing gate -- Phase 5 (2026-08-24), refactored in Phase 6
 * (2026-08-24) to compose on the generic, extracted primitive in
 * server/modules/billing/message-billing.ts, which OTP (Phase 6) also
 * uses -- see docs/neura-ecosystem/30_CAMPAIGN_ENGINE_IMPLEMENTATION.md
 * section 9 and docs/neura-ecosystem/31_BUSINESS_OTP_AUTHENTICATION_IMPLEMENTATION.md
 * section 14. No behavior change from Phase 5 -- same atomic CAS, same
 * table, same semantics; this file now just supplies campaigns' own
 * placeholder cost constant and re-exports the shared charge function
 * under its established name so campaigns/service.ts didn't need to change.
 *
 * PRICING IS NOT DEFINED BY THIS PHASE. `PLACEHOLDER_COST_PER_MESSAGE_PAISE`
 * exists only so the engine has a concrete, testable gate with a real
 * accounting effect -- doc 30 section 9 explicitly separates "campaign
 * execution accounting" (built here) from "future pricing policy" (NOT
 * decided here). Do not read this constant as an approved price.
 */
export { chargeMessage as chargeCampaignMessage, type ChargeResult } from "../billing/message-billing";

// NOT an approved price -- see file header.
export const PLACEHOLDER_COST_PER_MESSAGE_PAISE = 10;
