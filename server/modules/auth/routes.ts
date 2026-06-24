/**
 * Auth routes — wires endpoints to controller handlers with middleware.
 * No business logic; no request/response shaping.
 */

import type { Express } from "express";
import { api } from "@shared/routes";
import {
  authLimiter,
  otpPhoneRequestLimiter,
  otpRequestLimiter,
  otpRequestDailyLimiter,
  otpVerifyLimiter,
  otpVerifyLockoutCheck,
  wsTokenLimiter,
} from "../../rate-limit";
import { loadUser, requireAuth } from "../../role-middleware";
import * as ctrl from "./controller";

export function registerAuthRoutes(app: Express): void {
  // Register / login
  app.post(api.auth.register.path, authLimiter, ctrl.register);
  app.post(api.auth.login.path, authLimiter, ctrl.login);

  // Password recovery
  app.post("/api/auth/forgot-password", otpRequestLimiter, otpRequestDailyLimiter, ctrl.forgotPassword);
  app.post("/api/auth/reset-password", otpVerifyLimiter, ctrl.resetPassword);
  app.post("/api/auth/change-password", authLimiter, loadUser, requireAuth, ctrl.changePassword);

  // Firebase Phone Auth
  app.post("/api/auth/firebase-verify", authLimiter, ctrl.firebaseVerify);

  // WebSocket short-lived token
  app.post("/api/auth/ws-token", wsTokenLimiter, loadUser, requireAuth, ctrl.wsToken);

  // Session recovery
  app.get(api.auth.me.path, loadUser, ctrl.me);

  // OTP (generic — used by B2C + B2B)
  app.post("/api/auth/otp/request", otpRequestLimiter, otpPhoneRequestLimiter, otpRequestDailyLimiter, ctrl.otpRequest);
  app.post("/api/auth/otp/verify", otpVerifyLimiter, otpVerifyLockoutCheck(), ctrl.otpVerify);

  // Logout
  app.post("/api/auth/logout", loadUser, ctrl.logout);
}
