/**
 * Business OTP challenge lifecycle -- Phase 6 (2026-08-24).
 * See docs/neura-ecosystem/31_BUSINESS_OTP_AUTHENTICATION_IMPLEMENTATION.md
 * section 4. Same LEGAL_TRANSITIONS-map pattern as templates/lifecycle.ts
 * and campaigns/lifecycle.ts.
 */
import { OTP_CHALLENGE_STATUS, type OtpChallengeStatus } from "@shared/schema";

const LEGAL_TRANSITIONS: Record<OtpChallengeStatus, OtpChallengeStatus[]> = {
  [OTP_CHALLENGE_STATUS.PENDING]: [
    OTP_CHALLENGE_STATUS.VERIFIED,
    OTP_CHALLENGE_STATUS.EXPIRED,
    OTP_CHALLENGE_STATUS.FAILED,
    OTP_CHALLENGE_STATUS.SUPERSEDED,
  ],
  [OTP_CHALLENGE_STATUS.VERIFIED]: [], // terminal -- one-time verification, never re-verifiable (doc 31 section 6)
  [OTP_CHALLENGE_STATUS.EXPIRED]: [], // terminal
  [OTP_CHALLENGE_STATUS.FAILED]: [], // terminal -- exceeded max attempts
  [OTP_CHALLENGE_STATUS.SUPERSEDED]: [], // terminal -- replaced by a resend
};

export class IllegalOtpTransitionError extends Error {
  constructor(public readonly from: OtpChallengeStatus, public readonly to: OtpChallengeStatus) {
    super(`Illegal OTP challenge transition: ${from} -> ${to}`);
    this.name = "IllegalOtpTransitionError";
  }
}

export function assertLegalOtpTransition(from: OtpChallengeStatus, to: OtpChallengeStatus): void {
  const allowed = LEGAL_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new IllegalOtpTransitionError(from, to);
  }
}
