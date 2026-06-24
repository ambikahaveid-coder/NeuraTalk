import assert from "node:assert/strict";
import { resolveEffectiveCallMode, resolveTranslationEnabled } from "../../shared/call-behavior";
import { getBillingVerificationFailureResult, isStrictBillingGuardEnabled } from "../../shared/billing-guard";
import { normalizeTenantSlug, usesFirebasePhoneOtp } from "../../shared/auth-runtime";
import { calculateBillableSecondsForBudget, simulateChargeForDuration } from "../../shared/billing-math";
import { resolveCallerIdentityMode, resolveRequestedJoinMethod } from "../../shared/call-routing";
import { normalizePhoneNumber } from "../../shared/phone";
import { createLinkedAbortController, getProviderHealthSnapshot, runWithResilience } from "../../server/voice-resilience";

async function run() {
  const appToAppVideo = resolveEffectiveCallMode("app_to_app", "video", true);
  assert.deepEqual(appToAppVideo, { effectiveCallType: "video", effectiveLipsync: true });

  const pstnDowngrade = resolveEffectiveCallMode("app_to_pstn", "video", true);
  assert.deepEqual(pstnDowngrade, { effectiveCallType: "voice", effectiveLipsync: false });

  assert.equal(
    resolveTranslationEnabled({ callerLanguage: "en", calleeLanguage: "te" }),
    true,
  );
  assert.equal(
    resolveTranslationEnabled({ callerLanguage: "en", calleeLanguage: "en" }),
    false,
  );
  assert.equal(
    resolveTranslationEnabled({
      callerLanguage: "en",
      calleeLanguage: "te",
      requestedTranslationEnabled: false,
    }),
    false,
  );
  assert.equal(
    resolveTranslationEnabled({
      callerLanguage: "auto",
      calleeLanguage: "te",
      requestedTranslationEnabled: true,
    }),
    true,
  );

  assert.equal(normalizePhoneNumber("9876543210", { defaultCountryCode: "IN" }), "+919876543210");
  assert.equal(normalizePhoneNumber("+1 (415) 555-0101"), "+14155550101");
  assert.equal(normalizeTenantSlug("  Acme-India "), "acme-india");
  assert.equal(normalizeTenantSlug(""), null);
  assert.equal(usesFirebasePhoneOtp({ PHONE_OTP_PROVIDER: "firebase" } as NodeJS.ProcessEnv), true);
  assert.equal(usesFirebasePhoneOtp({ PHONE_OTP_PROVIDER: "msg91" } as NodeJS.ProcessEnv), false);
  assert.equal(calculateBillableSecondsForBudget({
    budgetPaise: 199,
    ratePerMinutePaise: 100,
    perSecondBilling: true,
  }), 119);
  assert.equal(calculateBillableSecondsForBudget({
    budgetPaise: 199,
    ratePerMinutePaise: 100,
    perSecondBilling: false,
  }), 60);
  assert.equal(calculateBillableSecondsForBudget({
    budgetPaise: 99,
    ratePerMinutePaise: 100,
    perSecondBilling: false,
  }), 0);
  assert.equal(simulateChargeForDuration({
    durationSeconds: 61,
    ratePerMinutePaise: 60,
    perSecondBilling: true,
  }).totalPaise, 61);
  assert.equal(simulateChargeForDuration({
    durationSeconds: 61,
    ratePerMinutePaise: 60,
    perSecondBilling: false,
  }).totalPaise, 120);
  assert.equal(resolveRequestedJoinMethod({
    transportPreference: "auto",
    calleeHasApp: true,
    calleeUserId: "42",
  }), "app_to_app");
  assert.equal(resolveRequestedJoinMethod({
    transportPreference: "auto",
    calleeHasApp: false,
  }), "app_to_pstn");
  assert.equal(resolveCallerIdentityMode({
    joinMethod: "app_to_app",
  }), "app_identity");
  assert.equal(resolveCallerIdentityMode({
    joinMethod: "app_to_pstn",
    organizationCallerId: "+911234567890",
    callerVerifiedNumber: "+919876543210",
    callerPhoneVerified: true,
  }), "organization_caller_id");
  assert.equal(resolveCallerIdentityMode({
    joinMethod: "app_to_pstn",
    callerVerifiedNumber: "+919876543210",
    callerPhoneVerified: true,
  }), "user_verified_number");
  assert.equal(resolveCallerIdentityMode({
    joinMethod: "app_to_pstn",
    callerVerifiedNumber: "+919876543210",
    callerPhoneVerified: false,
  }), "provider_caller_id");

  const linkedAbort = createLinkedAbortController({
    timeoutMs: 25,
    label: "smoke-timeout",
  });
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(linkedAbort.controller.signal.aborted, true);
  linkedAbort.cleanup();

  let attempts = 0;
  const resilientResult = await runWithResilience(async () => {
    attempts += 1;
    if (attempts < 2) {
      throw new Error("first-attempt-failure");
    }
    return "ok";
  }, {
    provider: "smoke-provider",
    operation: "retry",
    timeoutMs: 200,
    retries: 1,
  });
  assert.equal(resilientResult, "ok");
  assert.equal(attempts, 2);

  const providerHealth = getProviderHealthSnapshot().find((entry) => entry.provider === "smoke-provider");
  assert.equal(Boolean(providerHealth), true);
  assert.equal(providerHealth?.state === "healthy" || providerHealth?.state === "degraded", true);

  const originalNodeEnv = process.env.NODE_ENV;
  const originalStrict = process.env.STRICT_BILLING_GUARD;

  process.env.NODE_ENV = "production";
  delete process.env.STRICT_BILLING_GUARD;
  assert.equal(isStrictBillingGuardEnabled(), true);

  process.env.NODE_ENV = "development";
  process.env.STRICT_BILLING_GUARD = "true";
  assert.equal(isStrictBillingGuardEnabled(), true);

  process.env.NODE_ENV = "development";
  process.env.STRICT_BILLING_GUARD = "false";
  assert.equal(isStrictBillingGuardEnabled(), false);
  assert.equal(getBillingVerificationFailureResult().allowed, true);

  process.env.NODE_ENV = "production";
  delete process.env.STRICT_BILLING_GUARD;
  assert.equal(getBillingVerificationFailureResult().allowed, false);
  assert.equal(getBillingVerificationFailureResult().reason, "BILLING_UNAVAILABLE");

  process.env.NODE_ENV = originalNodeEnv;
  if (originalStrict === undefined) {
    delete process.env.STRICT_BILLING_GUARD;
  } else {
    process.env.STRICT_BILLING_GUARD = originalStrict;
  }

  console.log("qa:smoke passed");
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
