export interface BillingCheckResult {
  allowed: boolean;
  reason?: string;
  remainingMinutes?: number;
  remainingCredits?: number;
  remainingWalletPaise?: number;
  warningMessage?: string;
  subscriptionStatus?: string;
}

export function isStrictBillingGuardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STRICT_BILLING_GUARD === "true"
    || (env.NODE_ENV || "").toLowerCase() === "production";
}

export function getBillingVerificationFailureResult(
  env: NodeJS.ProcessEnv = process.env,
): BillingCheckResult {
  if (isStrictBillingGuardEnabled(env)) {
    return {
      allowed: false,
      reason: "BILLING_UNAVAILABLE",
      warningMessage: "Billing verification is temporarily unavailable. Please try again shortly.",
    };
  }

  return {
    allowed: true,
    warningMessage: "Unable to verify billing status. Proceeding with caution.",
  };
}
