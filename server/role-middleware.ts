/**
 * ROLE-BASED ACCESS MIDDLEWARE
 *
 * WHY THIS EXISTS:
 * Multi-tenant B2B platforms need strict role-based access control.
 * Different roles have different permissions across the platform.
 *
 * ROLES:
 * - super_admin: Platform owner, can manage all companies and settings
 * - company_admin: Company owner, can manage their company and agents
 * - agent: Company staff, can handle calls and use features
 * - consumer: B2C user, personal use only
 */

import { randomBytes } from "crypto";
import { Request, Response, NextFunction } from "express";
import { and, eq, gt, lt } from "drizzle-orm";
import { db } from "./db";
import {
  users,
  organizations,
  userSessions,
  orgMembers,
  PERMISSIONS,
} from "@shared/schema";
import { logger, toHumanReadableError } from "./observability";
import { setContextUserId } from "./request-context";

// ============================================================================
// TYPES
// ============================================================================

export interface AuthenticatedUser {
  id: number;
  username: string;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  preferredLanguage?: string | null;
  pushNotificationsEnabled?: boolean;
  role: string;
  organizationId: number | null;
  tenantSlug?: string | null;
  memberRole?: string | null;
  permissions?: string[];
  sessionId?: number;
  sessionScope?: string | null;
  mfaVerifiedAt?: Date | null;
  organization?: {
    id: number;
    name: string;
    slug: string;
    status: string | null;
  } | null;
}

export interface SessionCreateOptions {
  organizationId?: number | null;
  tenantSlug?: string | null;
  sessionScope?: string;
  mfaVerifiedAt?: Date | null;
}

export interface SessionValidationOptions {
  requestedTenantId?: number | null;
  requestedTenantSlug?: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

// ============================================================================
// ROLE HIERARCHY
// ============================================================================

const ROLE_HIERARCHY: Record<string, number> = {
  super_admin: 100,
  investor: 75,
  company_admin: 50,
  agent: 25,
  consumer: 10,
};

const COMPANY_ADMIN_PERMISSIONS = [
  PERMISSIONS.CALLS_INITIATE,
  PERMISSIONS.CALLS_RECEIVE,
  PERMISSIONS.CALLS_RECORD,
  PERMISSIONS.CALLS_TRANSFER,
  PERMISSIONS.CALLS_VIEW_HISTORY,
  PERMISSIONS.CALLS_VIEW_ALL,
  PERMISSIONS.USERS_VIEW,
  PERMISSIONS.USERS_CREATE,
  PERMISSIONS.USERS_EDIT,
  PERMISSIONS.USERS_DELETE,
  PERMISSIONS.USERS_ASSIGN_ROLES,
  PERMISSIONS.ORG_VIEW_SETTINGS,
  PERMISSIONS.ORG_EDIT_SETTINGS,
  PERMISSIONS.ORG_MANAGE_BILLING,
  PERMISSIONS.ORG_VIEW_ANALYTICS,
  PERMISSIONS.ORG_MANAGE_INTEGRATIONS,
  PERMISSIONS.SECURITY_VIEW_AUDIT,
  PERMISSIONS.SECURITY_MANAGE_IP,
  PERMISSIONS.SECURITY_MANAGE_SESSIONS,
  PERMISSIONS.API_READ,
  PERMISSIONS.API_WRITE,
  PERMISSIONS.API_MANAGE_KEYS,
  PERMISSIONS.AI_CHAT,
  PERMISSIONS.AI_VOICE,
  PERMISSIONS.AI_TRANSLATION,
];

const MANAGER_PERMISSIONS = [
  PERMISSIONS.CALLS_INITIATE,
  PERMISSIONS.CALLS_RECEIVE,
  PERMISSIONS.CALLS_TRANSFER,
  PERMISSIONS.CALLS_VIEW_HISTORY,
  PERMISSIONS.CALLS_VIEW_ALL,
  PERMISSIONS.USERS_VIEW,
  PERMISSIONS.ORG_VIEW_SETTINGS,
  PERMISSIONS.ORG_VIEW_ANALYTICS,
  PERMISSIONS.SECURITY_VIEW_AUDIT,
  PERMISSIONS.AI_CHAT,
  PERMISSIONS.AI_VOICE,
  PERMISSIONS.AI_TRANSLATION,
  PERMISSIONS.API_READ,
];

const AGENT_PERMISSIONS = [
  PERMISSIONS.CALLS_INITIATE,
  PERMISSIONS.CALLS_RECEIVE,
  PERMISSIONS.CALLS_VIEW_HISTORY,
  PERMISSIONS.AI_CHAT,
  PERMISSIONS.AI_TRANSLATION,
];

const CONSUMER_PERMISSIONS = [
  PERMISSIONS.CALLS_INITIATE,
  PERMISSIONS.CALLS_RECEIVE,
  PERMISSIONS.CALLS_VIEW_HISTORY,
  PERMISSIONS.AI_CHAT,
  PERMISSIONS.AI_VOICE,
  PERMISSIONS.AI_TRANSLATION,
];

function getRoleLevel(role: string): number {
  return ROLE_HIERARCHY[role] || 0;
}

function getDefaultPermissions(role: string, memberRole?: string | null): string[] {
  if (role === "super_admin") {
    return ["*"];
  }

  const normalizedMemberRole = (memberRole || "").toLowerCase();
  if (normalizedMemberRole === "owner" || normalizedMemberRole === "admin") {
    return COMPANY_ADMIN_PERMISSIONS;
  }
  if (normalizedMemberRole === "manager") {
    return MANAGER_PERMISSIONS;
  }

  if (role === "company_admin") {
    return COMPANY_ADMIN_PERMISSIONS;
  }
  if (role === "agent") {
    return AGENT_PERMISSIONS;
  }
  if (role === "investor") {
    return [PERMISSIONS.ORG_VIEW_ANALYTICS];
  }
  if (role === "consumer") {
    return CONSUMER_PERMISSIONS;
  }

  return [];
}

function buildPermissionSet(role: string, memberRole?: string | null, assignedPermissions?: unknown): string[] {
  const explicitPermissions = Array.isArray(assignedPermissions)
    ? assignedPermissions.filter((value): value is string => typeof value === "string")
    : [];

  return Array.from(
    new Set([
      ...getDefaultPermissions(role, memberRole),
      ...explicitPermissions,
    ]),
  );
}

function hasRequestedPermission(user: AuthenticatedUser, permission: string): boolean {
  const permissions = user.permissions || [];
  if (user.role === "super_admin" || permissions.includes("*")) {
    return true;
  }

  return permissions.includes(permission);
}

function extractRequestedTenantBinding(req: Request): SessionValidationOptions {
  const headerTenantId = req.headers["x-tenant-id"];
  const headerTenantSlug = req.headers["x-tenant-slug"];
  const queryTenantId = req.query.tenantId;
  const queryTenantSlug = req.query.tenantSlug;

  const requestedTenantId = typeof headerTenantId === "string"
    ? Number.parseInt(headerTenantId, 10)
    : typeof queryTenantId === "string"
      ? Number.parseInt(queryTenantId, 10)
      : null;

  const requestedTenantSlug = typeof headerTenantSlug === "string"
    ? headerTenantSlug.trim()
    : typeof queryTenantSlug === "string"
      ? queryTenantSlug.trim()
      : null;

  return {
    requestedTenantId: Number.isFinite(requestedTenantId) ? requestedTenantId : null,
    requestedTenantSlug: requestedTenantSlug || null,
  };
}

// ============================================================================
// SESSION MANAGEMENT (Database-backed for production)
// ============================================================================

const SESSION_EXPIRY_HOURS = 24;

/**
 * Generate cryptographically secure session token
 * Using 256-bit random bytes for security
 */
function generateSecureToken(): string {
  return `sess_${randomBytes(32).toString("hex")}`;
}

async function resolveSessionCreateOptions(
  userId: number,
  options?: SessionCreateOptions,
): Promise<Required<SessionCreateOptions>> {
  if (options?.organizationId !== undefined && options?.tenantSlug !== undefined) {
    return {
      organizationId: options.organizationId ?? null,
      tenantSlug: options.tenantSlug ?? null,
      sessionScope: options.sessionScope ?? (options.organizationId ? "tenant" : "platform"),
      mfaVerifiedAt: options.mfaVerifiedAt ?? null,
    };
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    with: {
      organization: true,
    },
  });

  const organizationId = options?.organizationId ?? user?.organizationId ?? null;
  const tenantSlug = options?.tenantSlug ?? user?.organization?.slug ?? null;

  return {
    organizationId,
    tenantSlug,
    sessionScope: options?.sessionScope ?? (organizationId ? "tenant" : "platform"),
    mfaVerifiedAt: options?.mfaVerifiedAt ?? null,
  };
}

/**
 * Create a session token for a user (database-backed)
 */
export async function createSession(
  userId: number,
  userAgent?: string,
  ipAddress?: string,
  options?: SessionCreateOptions,
): Promise<string> {
  const token = generateSecureToken();
  const expiresAt = new Date(Date.now() + SESSION_EXPIRY_HOURS * 60 * 60 * 1000);

  try {
    const sessionOptions = await resolveSessionCreateOptions(userId, options);

    await db.insert(userSessions).values({
      token,
      userId,
      organizationId: sessionOptions.organizationId,
      tenantSlug: sessionOptions.tenantSlug,
      sessionScope: sessionOptions.sessionScope,
      userAgent: userAgent?.substring(0, 500),
      ipAddress: ipAddress?.substring(0, 45),
      mfaVerifiedAt: sessionOptions.mfaVerifiedAt,
      expiresAt,
    });

    logger.debug("Session", `Session created for user ${userId}`);
    return token;
  } catch (error) {
    logger.error("Session", "Failed to create session", error as Error);
    throw new Error("Failed to create session");
  }
}

export async function getSessionDetails(
  token: string,
  options?: SessionValidationOptions,
) {
  try {
    const { isTokenRevoked } = await import("./session-management");
    if (isTokenRevoked(token)) {
      return null;
    }

    const session = await db.query.userSessions.findFirst({
      where: and(
        eq(userSessions.token, token),
        gt(userSessions.expiresAt, new Date()),
      ),
    });

    if (!session) {
      return null;
    }

    if (
      options?.requestedTenantId &&
      session.organizationId &&
      session.organizationId !== options.requestedTenantId
    ) {
      logger.warn("Session", "Tenant binding mismatch by organization ID", {
        sessionId: session.id,
        sessionOrganizationId: session.organizationId,
        requestedTenantId: options.requestedTenantId,
      });
      return null;
    }

    if (
      options?.requestedTenantSlug &&
      session.tenantSlug &&
      session.tenantSlug !== options.requestedTenantSlug
    ) {
      logger.warn("Session", "Tenant binding mismatch by tenant slug", {
        sessionId: session.id,
        sessionTenantSlug: session.tenantSlug,
        requestedTenantSlug: options.requestedTenantSlug,
      });
      return null;
    }

    const newExpiresAt = new Date(Date.now() + SESSION_EXPIRY_HOURS * 60 * 60 * 1000);
    await db.update(userSessions)
      .set({
        lastActivityAt: new Date(),
        expiresAt: newExpiresAt,
      })
      .where(eq(userSessions.id, session.id));

    return {
      ...session,
      expiresAt: newExpiresAt,
    };
  } catch (error) {
    logger.error("Session", "Failed to validate session", error as Error);
    return null;
  }
}

/**
 * Validate and get user ID from session token (database-backed)
 * Implements rolling 24-hour expiration: extends expiresAt on each activity
 */
export async function validateSession(
  token: string,
  options?: SessionValidationOptions,
): Promise<number | null> {
  const session = await getSessionDetails(token, options);
  return session?.userId ?? null;
}

/**
 * Invalidate a session (logout) - soft delete by removing from DB
 */
export async function invalidateSession(token: string): Promise<void> {
  try {
    await db.delete(userSessions).where(eq(userSessions.token, token));
    logger.debug("Session", "Session invalidated");
  } catch (error) {
    logger.error("Session", "Failed to invalidate session", error as Error);
  }
}

export async function invalidateAllSessionsForUser(userId: number): Promise<void> {
  try {
    await db.delete(userSessions).where(eq(userSessions.userId, userId));
    logger.warn("Session", "All sessions invalidated for user", { userId });
  } catch (error) {
    logger.error("Session", "Failed to invalidate all user sessions", error as Error, { userId });
  }
}

/**
 * Cleanup expired sessions (call periodically)
 */
export async function cleanupExpiredSessions(): Promise<number> {
  try {
    const result = await db.delete(userSessions)
      .where(lt(userSessions.expiresAt, new Date()))
      .returning({ id: userSessions.id });
    logger.info("Session", "Cleaned up expired sessions");
    return result.length;
  } catch (error) {
    logger.error("Session", "Failed to cleanup sessions", error as Error);
    return 0;
  }
}

/**
 * Load user from session/token into request
 * This is the base authentication middleware
 *
 * SECURITY: Only trusts properly signed session tokens, not raw user IDs
 */
export async function loadUser(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (req.user) {
      next();
      return;
    }

    // Support ?auth= query param ONLY for the specific SSE routes that need it
    // (EventSource can't set headers). Scoped narrowly — accepting it on every
    // route would let a session token leak via access logs/history/Referer
    // headers on any endpoint, not just the two that actually require it.
    const SSE_QUERY_AUTH_PATHS = new Set([
      "/api/calls/incoming/stream",
      "/api/personal-chats/stream",
    ]);
    const queryAuth = SSE_QUERY_AUTH_PATHS.has(req.path) && typeof req.query?.auth === "string"
      ? req.query.auth
      : null;
    const authHeader = queryAuth
      ? `Bearer ${queryAuth}`
      : req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      next();
      return;
    }

    const token = authHeader.slice(7);
    const requestedBinding = extractRequestedTenantBinding(req);
    const session = await getSessionDetails(token, requestedBinding);

    if (!session) {
      next();
      return;
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, session.userId),
      with: {
        organization: true,
      },
    });

    if (!user || !user.isActive) {
      next();
      return;
    }

    const membership = user.organizationId
      ? (await db.select().from(orgMembers).where(and(
        eq(orgMembers.organizationId, user.organizationId),
        eq(orgMembers.userId, user.id),
      )).limit(1))[0] ?? null
      : null;

    const permissions = buildPermissionSet(
      user.role,
      membership?.memberRole ?? null,
      membership?.permissions,
    );

    req.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      preferredLanguage: user.preferredLanguage,
      pushNotificationsEnabled: user.pushNotificationsEnabled,
      role: user.role,
      organizationId: user.organizationId,
      tenantSlug: session.tenantSlug ?? user.organization?.slug ?? null,
      memberRole: membership?.memberRole ?? null,
      permissions,
      sessionId: session.id,
      sessionScope: session.sessionScope,
      mfaVerifiedAt: session.mfaVerifiedAt,
      organization: user.organization ? {
        id: user.organization.id,
        name: user.organization.name,
        slug: user.organization.slug,
        status: user.organization.status,
      } : null,
    };

    setContextUserId(user.id);
    next();
  } catch (error) {
    logger.error("RoleMiddleware", "Failed to load user", error as Error);
    next();
  }
}

/**
 * Require authentication - user must be logged in
 */
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    res.status(401).json({
      success: false,
      message: "Please log in to continue",
    });
    return;
  }
  next();
}

/**
 * Require specific role(s)
 */
export function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "Please log in to continue",
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      logger.warn("RoleMiddleware", "Access denied - insufficient role", {
        userId: req.user.id,
        role: req.user.role,
        requiredRoles: allowedRoles,
      });
      res.status(403).json({
        success: false,
        message: "You don't have permission to access this feature",
      });
      return;
    }

    next();
  };
}

/**
 * Require one or more fine-grained permissions.
 */
export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "Please log in to continue",
      });
      return;
    }

    if (!hasRequestedPermission(req.user, permission)) {
      logger.warn("RoleMiddleware", "Access denied - missing permission", {
        userId: req.user.id,
        permission,
        permissions: req.user.permissions || [],
      });
      res.status(403).json({
        success: false,
        message: "You don't have permission to perform this action",
      });
      return;
    }

    next();
  };
}

export function requireAnyPermission(...permissions: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "Please log in to continue",
      });
      return;
    }

    if (!permissions.some((permission) => hasRequestedPermission(req.user!, permission))) {
      res.status(403).json({
        success: false,
        message: "You don't have permission to perform this action",
      });
      return;
    }

    next();
  };
}

/**
 * Require minimum role level
 */
export function requireMinRole(minRole: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "Please log in to continue",
      });
      return;
    }

    const userLevel = getRoleLevel(req.user.role);
    const requiredLevel = getRoleLevel(minRole);

    if (userLevel < requiredLevel) {
      res.status(403).json({
        success: false,
        message: "You don't have permission to access this feature",
      });
      return;
    }

    next();
  };
}

/**
 * Super Admin only access
 */
export function requireSuperAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    res.status(401).json({
      success: false,
      message: "Please log in to continue",
    });
    return;
  }

  if (req.user.role !== "super_admin") {
    res.status(403).json({
      success: false,
      message: "This feature is only available to platform administrators",
    });
    return;
  }

  next();
}

/**
 * Company Admin or Super Admin access
 */
export function requireCompanyAdminOrAbove(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    res.status(401).json({
      success: false,
      message: "Please log in to continue",
    });
    return;
  }

  if (
    req.user.role !== "super_admin" &&
    req.user.role !== "company_admin" &&
    req.user.role !== "business"
  ) {
    res.status(403).json({
      success: false,
      message: "This feature requires company administrator access",
    });
    return;
  }

  if (req.user.role === "business" && !req.user.organizationId) {
    res.status(403).json({
      success: false,
      message: "This feature requires an associated organization",
    });
    return;
  }

  next();
}

/**
 * Require user to belong to an approved company
 */
export function requireApprovedCompany(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    res.status(401).json({
      success: false,
      message: "Please log in to continue",
    });
    return;
  }

  if (req.user.role === "super_admin") {
    next();
    return;
  }

  if (req.user.role === "consumer") {
    next();
    return;
  }

  if (!req.user.organization || req.user.organization.status !== "approved") {
    res.status(403).json({
      success: false,
      message: "Your company is pending approval. Please wait for activation.",
    });
    return;
  }

  next();
}

/**
 * Require access to a specific company (own company or super admin)
 */
export function requireCompanyAccess(companyIdParam: string = "companyId") {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "Please log in to continue",
      });
      return;
    }

    const targetCompanyId = Number.parseInt(req.params[companyIdParam], 10);
    if (!Number.isFinite(targetCompanyId)) {
      res.status(400).json({
        success: false,
        message: "Invalid company identifier",
      });
      return;
    }

    if (req.user.role === "super_admin") {
      next();
      return;
    }

    if (req.user.organizationId !== targetCompanyId) {
      res.status(403).json({
        success: false,
        message: "You can only access your own company's data",
      });
      return;
    }

    next();
  };
}

// ============================================================================
// PERMISSION CHECKING HELPERS
// ============================================================================

export function hasPermission(user: AuthenticatedUser | undefined, permission: string): boolean {
  return !!user && hasRequestedPermission(user, permission);
}

export function isSuperAdmin(user: AuthenticatedUser | undefined): boolean {
  return user?.role === "super_admin";
}

export function isCompanyAdmin(user: AuthenticatedUser | undefined): boolean {
  return user?.role === "company_admin";
}

export function isAgent(user: AuthenticatedUser | undefined): boolean {
  return user?.role === "agent";
}

export function isConsumer(user: AuthenticatedUser | undefined): boolean {
  return user?.role === "consumer";
}

export function canManageCompany(user: AuthenticatedUser | undefined, companyId: number): boolean {
  if (!user) {
    return false;
  }
  if (user.role === "super_admin") {
    return true;
  }
  if (user.role === "company_admin" && user.organizationId === companyId) {
    return true;
  }
  return false;
}

export function canAccessCompany(user: AuthenticatedUser | undefined, companyId: number): boolean {
  if (!user) {
    return false;
  }
  if (user.role === "super_admin") {
    return true;
  }
  return user.organizationId === companyId;
}

export async function resolveTenantSlugForOrganization(
  organizationId: number | null | undefined,
): Promise<string | null> {
  if (!organizationId) {
    return null;
  }

  try {
    const organization = await db.query.organizations.findFirst({
      where: eq(organizations.id, organizationId),
    });
    return organization?.slug ?? null;
  } catch (error) {
    logger.warn("RoleMiddleware", "Failed to resolve tenant slug", {
      organizationId,
      error: toHumanReadableError(error instanceof Error ? error.message : String(error)),
    });
    return null;
  }
}
