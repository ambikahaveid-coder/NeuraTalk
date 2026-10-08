/**
 * Auth service — pure business logic for authentication flows.
 * No express req/res. Controller/routes sit on top.
 */

import { db } from "../../db";
import { storage } from "../../storage";
import { hashPassword, isPasswordHashSupported, needsPasswordRehash, verifyPassword } from "../../password-utils";
import { createSession, invalidateAllSessionsForUser, invalidateSession, validateSession } from "../../role-middleware";
import { requestOtp, verifyOtp } from "../../otp-auth";
import { verifyFirebaseToken, verifyFirebaseTokenDetailed, isFirebaseAdminConfigured } from "../../firebase-admin";
import { issueWsToken } from "../../signaling-server";
import { AuditHelpers } from "../../audit";
import { grantFreeTrialIfEligible } from "../../free-trial";
import { USER_ROLES, users, billingPlans, subscriptions } from "@shared/schema";
import { normalizePhoneNumber } from "@shared/phone";
import { normalizeTenantSlug, usesFirebasePhoneOtp } from "@shared/auth-runtime";
import { eq, and, or } from "drizzle-orm";
import { ObjectStorageService } from "../../ai_integrations/object_storage/objectStorage";
import { setObjectAclPolicy } from "../../ai_integrations/object_storage/objectAcl";

function generateSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export interface RegisterInput {
  username: string;
  password?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  role?: string | null;
  organizationName?: string | null;
  tenantSlug?: string | null;
  organizationSlug?: string | null;
  [key: string]: unknown;
}

interface AuthRequestContext {
  userAgent?: string;
  ipAddress?: string;
  requestedTenantSlug?: string | null;
}

function buildSessionBinding(organization?: { id: number; slug: string } | null) {
  return {
    organizationId: organization?.id ?? null,
    tenantSlug: organization?.slug ?? null,
    sessionScope: organization ? "tenant" : "platform",
  };
}

export async function registerUser(input: RegisterInput, context?: AuthRequestContext) {
  const existing = await storage.getUserByUsername(input.username);
  if (existing) {
    return { error: "USERNAME_EXISTS" as const };
  }

  let organizationId: number | undefined;
  if (input.role === "business" && input.organizationName) {
    const slug = generateSlug(input.organizationName);
    const org = await storage.createOrganization({
      name: input.organizationName,
      slug,
      plan: "free",
    });
    organizationId = org.id;
  }

  const user = await storage.createUser({
    username: input.username,
    password: input.password ? hashPassword(input.password) : null,
    email: input.email,
    avatarUrl: input.avatarUrl,
    role: input.role || USER_ROLES.CONSUMER,
    organizationId,
  });

  let organization = null;
  if (organizationId) {
    await storage.addOrgMember({
      organizationId,
      userId: user.id,
      memberRole: "owner",
    });
    organization = await storage.getOrganization(organizationId);
  } else {
    await grantFreeTrialIfEligible(user.id);
  }

  const token = await createSession(
    user.id,
    context?.userAgent,
    context?.ipAddress,
    buildSessionBinding(organization),
  );
  const { password: _pw, ...safeUser } = user;
  return { user: safeUser, organization, token };
}

export interface LoginInput {
  username: string;
  password: string;
  tenantSlug?: string | null;
  organizationSlug?: string | null;
}

export async function loginUser(input: LoginInput, context?: AuthRequestContext) {
  const user = await storage.getUserByUsername(input.username);
  if (!user || !user.password) {
    return { error: "INVALID_CREDENTIALS" as const };
  }

  if (!user.isActive) {
    return { error: "USER_INACTIVE" as const };
  }

  if (!isPasswordHashSupported(user.password)) {
    return { error: "PASSWORD_RESET_REQUIRED" as const };
  }

  const passwordValid = verifyPassword(input.password, user.password);
  if (!passwordValid) {
    return { error: "INVALID_CREDENTIALS" as const };
  }

  if (needsPasswordRehash(user.password)) {
    await db.update(users)
      .set({ password: hashPassword(input.password) })
      .where(eq(users.id, user.id));
  }

  const requestedTenantSlug = normalizeTenantSlug(
    context?.requestedTenantSlug ?? input.tenantSlug ?? input.organizationSlug,
  );

  let organization = null;
  if (requestedTenantSlug) {
    organization = await storage.getOrganizationBySlug(requestedTenantSlug);
    if (!organization) {
      return { error: "TENANT_NOT_FOUND" as const };
    }

    if (user.role !== "super_admin" && user.organizationId !== organization.id) {
      return { error: "TENANT_ACCESS_DENIED" as const };
    }
  } else if (user.organizationId) {
    organization = await storage.getOrganization(user.organizationId);
  }

  if (user.organizationId && !organization && user.role !== "super_admin") {
    return { error: "TENANT_ACCESS_DENIED" as const };
  }

  if (
    organization &&
    user.role !== "super_admin" &&
    organization.status &&
    organization.status !== "approved"
  ) {
    return { error: "TENANT_INACTIVE" as const };
  }

  const token = await createSession(
    user.id,
    context?.userAgent,
    context?.ipAddress,
    buildSessionBinding(organization),
  );
  const { password: _pw, ...safeUser } = user;
  return { user: safeUser, organization, token };
}

export async function forgotPassword(identifier: string, channel: "email" | "mobile") {
  if (channel === "mobile" && usesFirebasePhoneOtp()) {
    return { error: "PHONE_RESET_USES_FIREBASE" as const };
  }

  const normalizedIdentifier = channel === "mobile" ? normalizePhoneNumber(identifier) : identifier;
  const whereClause = channel === "email"
    ? eq(users.email, normalizedIdentifier)
    : eq(users.phone, normalizedIdentifier);
  const user = await db.query.users.findFirst({ where: whereClause });

  // Silent success prevents user enumeration
  if (!user) return { success: true };
  await requestOtp(normalizedIdentifier, channel);
  return { success: true };
}

export async function resetPassword(
  identifier: string,
  channel: "email" | "mobile",
  code: string,
  newPassword: string,
) {
  const normalizedIdentifier = channel === "mobile" ? normalizePhoneNumber(identifier) : identifier;
  const otpResult = await verifyOtp(normalizedIdentifier, channel, code);
  if (!otpResult.success) {
    return { error: "INVALID_OTP" as const, message: otpResult.message };
  }

  const whereClause = channel === "email"
    ? eq(users.email, normalizedIdentifier)
    : eq(users.phone, normalizedIdentifier);
  const user = await db.query.users.findFirst({ where: whereClause });
  if (!user) return { error: "USER_NOT_FOUND" as const };

  await invalidateAllSessionsForUser(user.id);
  await db.update(users).set({ password: hashPassword(newPassword) }).where(eq(users.id, user.id));
  const organization = user.organizationId
    ? await storage.getOrganization(user.organizationId)
    : null;
  const token = await createSession(user.id, undefined, undefined, buildSessionBinding(organization));
  const { password: _pw, ...safeUser } = user;
  return { user: safeUser, token };
}

export async function changePassword(
  userId: number,
  currentPassword: string,
  newPassword: string,
) {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  if (!user) return { error: "USER_NOT_FOUND" as const };
  if (!user.password) return { error: "PASSWORD_AUTH_NOT_AVAILABLE" as const };
  if (!isPasswordHashSupported(user.password)) return { error: "PASSWORD_RESET_REQUIRED" as const };

  const passwordValid = verifyPassword(currentPassword, user.password);
  if (!passwordValid) {
    return { error: "INVALID_CURRENT_PASSWORD" as const };
  }

  await invalidateAllSessionsForUser(user.id);
  await db.update(users)
    .set({ password: hashPassword(newPassword) })
    .where(eq(users.id, user.id));

  return { success: true as const };
}

export async function firebaseVerify(idToken: string) {
  const verified = await verifyFirebaseTokenDetailed(idToken);
  if (!verified.ok) return { error: "INVALID_TOKEN" as const, reason: verified.reason };
  const firebaseUser = verified;

  // Firebase always returns E.164 ("+919876543210"), but older rows may have
  // been stored without the "+" or as a bare 10-digit national number (admin
  // imports, legacy MSG91 flow). Match all of those so an existing account is
  // found instead of hitting the unique-username constraint on insert.
  const e164 = firebaseUser.phoneNumber;
  const phoneVariants = new Set([e164, e164.replace(/^\+/, "")]);
  if (e164.startsWith("+91") && e164.length === 13) phoneVariants.add(e164.slice(3));

  let user = await db.query.users.findFirst({
    where: or(
      ...Array.from(phoneVariants).map((p) => eq(users.phone, p)),
      eq(users.username, e164),
    ),
  });

  const isNewUser = !user;
  if (!user) {
    const [newUser] = await db.insert(users).values({
      username: e164,
      phone: e164,
      phoneVerified: true,
      role: "consumer",
    }).returning();
    user = newUser;
  }

  // Grant the free trial to any individual consumer who has never had a
  // subscription — not just brand-new rows. Accounts created while no free
  // plan existed would otherwise be locked out of calls permanently.
  if (!user.organizationId && user.role === USER_ROLES.CONSUMER) {
    await grantFreeTrialIfEligible(user.id);
  }

  if (!user.isActive) {
    return { error: "USER_INACTIVE" as const };
  }

  const organization = user.organizationId
    ? await storage.getOrganization(user.organizationId)
    : null;
  const token = await createSession(user.id, undefined, undefined, buildSessionBinding(organization));
  await AuditHelpers.logLogin(user.id, undefined, undefined, user.organizationId ?? undefined);
  const { password: _pw, ...safeUser } = user;
  return { user: safeUser, token, isNewUser };
}

export async function requestAuthOtp(identifier: string, channel: "email" | "mobile") {
  if (channel === "mobile") {
    return {
      success: false,
      message:
        "Phone authentication requires Firebase Phone Auth. " +
        "Use the Firebase OTP flow on the login screen.",
    };
  }
  return await requestOtp(identifier, channel);
}

export type VerifyAuthOtpResult =
  | { success: true; token: string; userId: number; user: any; message?: string }
  | { success: false; status: number; message: string };

export async function verifyAuthOtp(params: {
  identifier: string;
  channel: "email" | "mobile";
  code: string;
  firebaseToken?: string;
  userAgent?: string;
  ipAddress?: string;
  requestedTenantSlug?: string | null;
}): Promise<VerifyAuthOtpResult> {
  const {
    identifier,
    channel,
    code,
    firebaseToken,
    userAgent,
    ipAddress,
    requestedTenantSlug,
  } = params;

  let result: { success: boolean; userId?: number; message?: string };

  if (firebaseToken && channel === "mobile") {
    if (!isFirebaseAdminConfigured()) {
      return { success: false, status: 400, message: "Firebase Phone Auth is not configured on this server. Please use SMS OTP." };
    }
    const verifiedToken = await verifyFirebaseToken(firebaseToken);
    if (!verifiedToken) {
      return { success: false, status: 401, message: "Invalid or expired verification token. Please try again." };
    }
    const verifiedPhone = verifiedToken.phoneNumber;

    let user = await db.query.users.findFirst({
      where: or(eq(users.phone, verifiedPhone), eq(users.phone, verifiedPhone.replace(/^\+/, ""))),
    });
    if (!user) {
      const username = `user_${Date.now().toString(36)}`;
      const [newUser] = await db.insert(users).values({
        username,
        phone: verifiedPhone,
        phoneVerified: true,
        role: "consumer",
      }).returning();
      user = newUser;
    } else {
      await db.update(users).set({ phoneVerified: true }).where(eq(users.id, user.id));
    }
    if (!user.organizationId && user.role === USER_ROLES.CONSUMER) {
      await grantFreeTrialIfEligible(user.id);
    }
    result = { success: true, userId: user.id };
  } else {
    if (channel === "mobile") {
      return {
        success: false,
        status: 400,
        message:
          "Phone authentication requires Firebase Phone Auth. " +
          "Please use the phone OTP login flow and submit the resulting ID token.",
      };
    }
    result = await verifyOtp(identifier, channel, code);
  }

  if (!result.success || !result.userId) {
    return { success: false, status: 400, message: result.message || "Verification failed" };
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, result.userId),
    with: { organization: true },
  });

  if (!user?.isActive) {
    return {
      success: false,
      status: 403,
      message: "This account is inactive. Please contact your administrator.",
    };
  }

  const normalizedRequestedTenantSlug = normalizeTenantSlug(requestedTenantSlug);
  if (normalizedRequestedTenantSlug && user?.role !== "super_admin") {
    if (!user?.organization) {
      return {
        success: false,
        status: 403,
        message: "This account does not belong to the requested company workspace",
      };
    }

    if (user.organization.slug !== normalizedRequestedTenantSlug) {
      return {
        success: false,
        status: 403,
        message: "This account does not belong to the requested company workspace",
      };
    }
  }

  const token = await createSession(
    result.userId,
    userAgent,
    ipAddress,
    buildSessionBinding(user?.organization ?? null),
  );
  await AuditHelpers.logLogin(result.userId, ipAddress, userAgent, user?.organizationId ?? undefined);

  return {
    success: true,
    token,
    userId: result.userId,
    user: user ? {
      id: user.id,
      username: user.username,
      email: user.email,
      phone: user.phone,
      role: user.role,
      organization: user.organization,
    } : null,
    message: result.message,
  };
}

export async function loginBySuperAdminEmail(
  email: string,
  context?: { userAgent?: string; ipAddress?: string },
) {
  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
    with: { organization: true },
  });

  if (!user || user.role !== "super_admin") {
    return { error: "NOT_FOUND" as const };
  }

  const token = await createSession(
    user.id,
    context?.userAgent,
    context?.ipAddress,
    buildSessionBinding(user.organization ?? null),
  );
  await AuditHelpers.logLogin(user.id, context?.ipAddress, context?.userAgent, user.organizationId ?? undefined);

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      phone: user.phone,
      role: user.role,
      organization: user.organization,
    },
  };
}

export async function logout(token: string | undefined, userId?: number) {
  if (token) {
    try { await invalidateSession(token); } catch { /* best-effort */ }
  }
  if (userId) {
    try { await AuditHelpers.logLogout(userId); } catch { /* best-effort */ }
  }
}

export async function getMe(token: string) {
  const userId = await validateSession(token);
  if (!userId) return { error: "INVALID_SESSION" as const };
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    with: { organization: true },
  });
  if (!user || !user.isActive) return { error: "USER_INACTIVE" as const };
  return {
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      phone: user.phone,
      role: user.role,
      avatarUrl: user.avatarUrl,
      organizationId: user.organizationId,
      organization: user.organization || null,
    },
  };
}

/**
 * Marks a freshly-uploaded avatar object as owned by this user and publicly
 * readable (profile photos need to be visible to call participants, same as
 * any consumer calling app) before it's persisted on the user row. Without
 * this, GET /objects/:path returns 403 for everyone including the owner --
 * canAccessObject() requires an ACL policy to exist on the object.
 */
export async function finalizeAvatarUpload(userId: number, objectPath: string): Promise<string> {
  if (!objectPath.startsWith("/objects/")) {
    throw new Error("Invalid avatar object path");
  }
  const objectStorage = new ObjectStorageService();
  const objectFile = await objectStorage.getObjectEntityFile(objectPath);
  await setObjectAclPolicy(objectFile, { owner: String(userId), visibility: "public" });
  return objectPath;
}

export async function updateProfile(
  userId: number,
  updates: {
    displayName?: string;
    avatarUrl?: string;
    preferredLanguage?: string;
    pushNotificationsEnabled?: boolean;
    translationEnabled?: boolean;
  },
): Promise<{
  id: number;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  preferredLanguage: string | null;
  pushNotificationsEnabled: boolean;
  translationEnabled: boolean;
}> {
  const setValues: Record<string, unknown> = {};
  // The unique username is never changed here: two people may share a name.
  if (updates.displayName !== undefined) setValues.displayName = updates.displayName;
  if (updates.avatarUrl !== undefined) setValues.avatarUrl = updates.avatarUrl;
  if (updates.preferredLanguage !== undefined) setValues.preferredLanguage = updates.preferredLanguage;
  if (updates.pushNotificationsEnabled !== undefined) setValues.pushNotificationsEnabled = updates.pushNotificationsEnabled;
  if (updates.translationEnabled !== undefined) setValues.translationEnabled = updates.translationEnabled;

  const [updated] = await db
    .update(users)
    .set(setValues)
    .where(eq(users.id, userId))
    .returning({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      preferredLanguage: users.preferredLanguage,
      pushNotificationsEnabled: users.pushNotificationsEnabled,
      translationEnabled: users.translationEnabled,
    });

  return updated;
}

export function issueSignalingToken(
  userId: number,
  sessionId: number,
  sessionToken: string,
  phone?: string | null,
) {
  return issueWsToken({
    userId,
    sessionId,
    sessionToken,
    phoneNumber: phone ?? undefined,
  }, 300);
}
