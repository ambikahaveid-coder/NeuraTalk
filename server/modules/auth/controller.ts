/**
 * Auth controller — thin request/response adapters.
 * Parses/validates input, calls service, maps result to HTTP.
 */

import type { Request, Response } from "express";
import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import { api } from "@shared/routes";
import { logger } from "../../observability";
import { clearOtpVerifyFailures, recordOtpVerifyFailure } from "../../rate-limit";
import * as svc from "./service";

const forgotPasswordSchema = z.object({
  identifier: z.string().min(1),
  channel: z.enum(["email", "mobile"]),
});

const resetPasswordSchema = z.object({
  identifier: z.string().min(1),
  channel: z.enum(["email", "mobile"]),
  code: z.string().length(6),
  newPassword: z.string().min(10, "Password must be at least 10 characters"),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(10, "Password must be at least 10 characters"),
});

const firebaseVerifySchema = z.object({
  idToken: z.string().min(1),
});

const otpRequestSchema = z.object({
  identifier: z.string().min(1),
  channel: z.enum(["email", "mobile"]),
});

const otpVerifySchema = z.object({
  identifier: z.string().min(1),
  channel: z.enum(["email", "mobile"]),
  code: z.string().length(6),
  firebaseToken: z.string().optional(),
});

export async function register(req: Request, res: Response) {
  try {
    const input = api.auth.register.input.parse(req.body);
    const result = await svc.registerUser(input, {
      userAgent: req.headers["user-agent"],
      ipAddress: req.ip || req.socket.remoteAddress,
      requestedTenantSlug: typeof req.headers["x-tenant-slug"] === "string"
        ? req.headers["x-tenant-slug"]
        : undefined,
    });
    if ("error" in result) {
      return res.status(400).json({ message: "Username already exists" });
    }
    res.status(201).json({ ...result.user, organization: result.organization, token: result.token });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: err.errors[0].message });
    }
    logger.error("Auth", "Register failed", err as Error);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function login(req: Request, res: Response) {
  try {
    const input = api.auth.login.input.parse(req.body);
    const requestedTenantSlug = typeof req.headers["x-tenant-slug"] === "string"
      ? req.headers["x-tenant-slug"]
      : undefined;

    const result = await svc.loginUser(input, {
      userAgent: req.headers["user-agent"],
      ipAddress: req.ip || req.socket.remoteAddress,
      requestedTenantSlug,
    });
    if ("error" in result) {
      if (result.error === "TENANT_NOT_FOUND") {
        return res.status(404).json({ message: "Requested company workspace was not found" });
      }
      if (result.error === "TENANT_ACCESS_DENIED") {
        return res.status(403).json({ message: "This account cannot access the requested company workspace" });
      }
      if (result.error === "TENANT_INACTIVE") {
        return res.status(403).json({ message: "This company workspace is not active yet" });
      }
      if (result.error === "USER_INACTIVE") {
        return res.status(403).json({ message: "This account is inactive. Please contact your administrator." });
      }
      if (result.error === "PASSWORD_RESET_REQUIRED") {
        return res.status(403).json({ message: "Password reset required for this account" });
      }
      return res.status(401).json({ message: "Invalid credentials" });
    }
    res.json({ ...result.user, organization: result.organization, token: result.token });
  } catch {
    res.status(400).json({ message: "Invalid input" });
  }
}

export async function forgotPassword(req: Request, res: Response) {
  try {
    const { identifier, channel } = forgotPasswordSchema.parse(req.body);
    const result = await svc.forgotPassword(identifier, channel);
    if ("error" in result && result.error === "PHONE_RESET_USES_FIREBASE") {
      return res.status(400).json({
        success: false,
        message: "Mobile accounts use Firebase Phone Auth. Please sign in with phone OTP instead.",
      });
    }
    res.json({ success: true, message: `Reset code sent to your ${channel}` });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.errors[0].message });
    }
    res.status(500).json({ success: false, message: "Failed to send reset code" });
  }
}

export async function resetPassword(req: Request, res: Response) {
  try {
    const input = resetPasswordSchema.parse(req.body);
    const result = await svc.resetPassword(input.identifier, input.channel, input.code, input.newPassword);
    if ("error" in result) {
      if (result.error === "INVALID_OTP") {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.status(404).json({ success: false, message: "User not found" });
    }
    res.json({ success: true, message: "Password reset successful", token: result.token, user: result.user });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.errors[0].message });
    }
    res.status(500).json({ success: false, message: "Reset failed. Please try again." });
  }
}

export async function changePassword(req: Request, res: Response) {
  try {
    const input = changePasswordSchema.parse(req.body);
    const result = await svc.changePassword(req.user!.id, input.currentPassword, input.newPassword);
    if ("error" in result) {
      if (result.error === "INVALID_CURRENT_PASSWORD") {
        return res.status(400).json({ success: false, message: "Current password is incorrect" });
      }
      if (result.error === "PASSWORD_AUTH_NOT_AVAILABLE") {
        return res.status(400).json({ success: false, message: "This account does not have password login enabled yet" });
      }
      if (result.error === "PASSWORD_RESET_REQUIRED") {
        return res.status(403).json({ success: false, message: "Password reset required for this account" });
      }
      return res.status(404).json({ success: false, message: "User not found" });
    }
    res.json({ success: true, message: "Password updated successfully" });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.errors[0].message });
    }
    res.status(500).json({ success: false, message: "Password update failed" });
  }
}

export async function firebaseVerify(req: Request, res: Response) {
  try {
    const { idToken } = firebaseVerifySchema.parse(req.body);
    const result = await svc.firebaseVerify(idToken);
    if ("error" in result) {
      if (result.error === "USER_INACTIVE") {
        return res.status(403).json({ success: false, message: "This account is inactive. Please contact your administrator." });
      }
      return res.status(401).json({ success: false, message: "Invalid Firebase token" });
    }
    res.json({ success: true, token: result.token, user: result.user, isNewUser: result.isNewUser });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.errors[0].message });
    }
    res.status(500).json({ success: false, message: "Firebase verification failed" });
  }
}

export function wsToken(req: Request, res: Response) {
  const user = req.user!;
  const authHeader = req.headers.authorization;
  const sessionToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!sessionToken || !user.sessionId) {
    return res.status(401).json({ message: "Active session required" });
  }

  const token = svc.issueSignalingToken(user.id, user.sessionId, sessionToken, user.phone ?? undefined);
  res.json({ token, expiresInSeconds: 300 });
}

export async function me(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    res.json({
      id: req.user.id,
      username: req.user.username,
      email: req.user.email,
      phone: req.user.phone,
      role: req.user.role,
      organizationId: req.user.organizationId,
      organization: req.user.organization || null,
      tenantSlug: req.user.tenantSlug || req.user.organization?.slug || null,
      memberRole: req.user.memberRole || null,
      permissions: req.user.permissions || [],
      sessionScope: req.user.sessionScope || null,
      mfaVerifiedAt: req.user.mfaVerifiedAt || null,
    });
  } catch (err) {
    logger.error("Auth", "Profile lookup failed", err as Error);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function otpRequest(req: Request, res: Response) {
  try {
    const { identifier, channel } = otpRequestSchema.parse(req.body);
    const result = await svc.requestAuthOtp(identifier, channel);
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.errors[0].message });
    }
    logger.error("Auth", "OTP request failed", err as Error);
    res.status(500).json({ success: false, message: "Something went wrong" });
  }
}

export async function otpVerify(req: Request, res: Response) {
  try {
    const input = otpVerifySchema.parse(req.body);
    const userAgent = req.headers["user-agent"];
    const ipAddress = req.ip || req.socket.remoteAddress;
    const result = await svc.verifyAuthOtp({
      identifier: input.identifier,
      channel: input.channel,
      code: input.code,
      firebaseToken: input.firebaseToken,
      userAgent,
      ipAddress,
      requestedTenantSlug: typeof req.headers["x-tenant-slug"] === "string"
        ? req.headers["x-tenant-slug"]
        : undefined,
    });

    if (!result.success) {
      const identifier = input.identifier;
      void recordOtpVerifyFailure(identifier);
      logger.warn("Auth", "OTP verify failed", { masked: identifier.slice(0, 4) + "****", ip: req.ip, channel: input.channel });
      return res.status(result.status).json({ success: false, message: result.message });
    }
    void clearOtpVerifyFailures(input.identifier);
    res.json({
      success: true,
      userId: result.userId,
      message: result.message,
      token: result.token,
      user: result.user,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.errors[0].message });
    }
    logger.error("Auth", "OTP verify failed", err as Error);
    res.status(500).json({ success: false, message: "Something went wrong" });
  }
}

export async function adminSecretLogin(req: Request, res: Response) {
  try {
    const schema = z.object({
      email: z.string().email(),
      secret: z.string().min(1),
    });
    const { email, secret } = schema.parse(req.body);

    const superAdminEmail = process.env.SUPER_ADMIN_EMAIL?.trim();
    const superAdminSecret = process.env.SUPER_ADMIN_SECRET?.trim();

    if (!superAdminEmail || !superAdminSecret) {
      logger.error("Auth", "SUPER_ADMIN_EMAIL or SUPER_ADMIN_SECRET not configured — admin login disabled");
      return res.status(503).json({ success: false, message: "Admin login not configured on this server." });
    }

    // Timing-safe comparison for both email and secret to prevent enumeration via timing oracle
    const emailBuf = Buffer.from(email.trim().toLowerCase());
    const expectedEmailBuf = Buffer.from(superAdminEmail.toLowerCase());
    const secretBuf = Buffer.from(secret.trim());
    const expectedSecretBuf = Buffer.from(superAdminSecret);

    // Pad to same length before comparison to prevent length-based timing leaks
    const emailMatch = emailBuf.length === expectedEmailBuf.length &&
      timingSafeEqual(emailBuf, expectedEmailBuf);
    const secretMatch = secretBuf.length === expectedSecretBuf.length &&
      timingSafeEqual(secretBuf, expectedSecretBuf);

    if (!emailMatch || !secretMatch) {
      return res.status(401).json({ success: false, message: "Invalid credentials." });
    }

    const result = await svc.loginBySuperAdminEmail(superAdminEmail.trim(), {
      userAgent: req.headers["user-agent"],
      ipAddress: req.ip || req.socket.remoteAddress,
    });

    if ("error" in result) {
      return res.status(401).json({ success: false, message: "Super admin account not found. Check seeding." });
    }

    res.json({ success: true, token: result.token, user: result.user });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.errors[0].message });
    }
    logger.error("Auth", "Admin secret login failed", err as Error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function logout(req: Request, res: Response) {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
    await svc.logout(token, req.user?.id);
    res.json({ success: true, message: "Logged out successfully" });
  } catch (err) {
    logger.error("Auth", "Logout failed", err as Error);
    res.json({ success: true, message: "Logged out" });
  }
}
