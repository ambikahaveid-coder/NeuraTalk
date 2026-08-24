/**
 * Business OTP / Authentication Messaging -- Phase 6 API surface.
 * See docs/neura-ecosystem/31_BUSINESS_OTP_AUTHENTICATION_IMPLEMENTATION.md.
 *
 * No generic /send-message endpoint -- every route here is OTP-challenge-
 * specific. Layered rate limiting: IP/user-scoped (businessOtpChallengeLimiter/
 * businessOtpVerifyLimiter), business-scoped (businessOtpBusinessDailyLimiter),
 * and destination-scoped (Redis lockout, enforced inside verifyChallenge
 * itself, not at the route layer, since it needs the challenge's own
 * destination which isn't known until the service looks it up).
 */
import type { Express } from "express";
import { requireAuth, requireCompanyAccess, requirePermission, requireAnyPermission } from "../../role-middleware";
import { PERMISSIONS } from "@shared/schema";
import { businessOtpChallengeLimiter, businessOtpBusinessDailyLimiter, businessOtpVerifyLimiter } from "../../rate-limit";
import * as ctrl from "./controller";

export function registerOtpRoutes(app: Express): void {
  const manage = [requireAuth, requireCompanyAccess("businessId"), requirePermission(PERMISSIONS.OTP_MANAGE)];
  const view = [requireAuth, requireCompanyAccess("businessId"), requireAnyPermission(PERMISSIONS.OTP_MANAGE, PERMISSIONS.OTP_VIEW)];

  app.post(
    "/api/v1/business/:businessId/otp/challenges",
    ...manage, businessOtpChallengeLimiter, businessOtpBusinessDailyLimiter,
    ctrl.postChallenge,
  );
  app.get("/api/v1/business/:businessId/otp/challenges", ...view, ctrl.getChallenges);
  app.get("/api/v1/business/:businessId/otp/challenges/:challengeId", ...view, ctrl.getChallengeById);
  app.post(
    "/api/v1/business/:businessId/otp/challenges/:challengeId/verify",
    ...view, businessOtpVerifyLimiter,
    ctrl.postVerify,
  );
  app.post(
    "/api/v1/business/:businessId/otp/challenges/:challengeId/resend",
    ...manage, businessOtpChallengeLimiter,
    ctrl.postResend,
  );
}
