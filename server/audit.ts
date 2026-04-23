/**
 * AUDIT LOGGING SYSTEM
 * 
 * WHY THIS EXISTS:
 * Track admin changes and critical actions for compliance and debugging.
 * Super Admin view only.
 * 
 * RULES (from requirements):
 * - Track admin changes
 * - Track critical actions
 * - Super Admin view only
 * - Do NOT log sensitive data (passwords, OTPs, call content)
 */

import { db } from "./db";
import { auditLogs, AUDIT_ACTION, users, type AuditAction } from "@shared/schema";
import { eq, desc, and, sql, gte, lte } from "drizzle-orm";
import { logger } from "./observability";

// ============================================================================
// AUDIT LOGGING FUNCTIONS
// ============================================================================

interface AuditLogParams {
  userId?: number;
  organizationId?: number;
  action: AuditAction;
  entityType: string;
  entityId?: number;
  oldValue?: Record<string, any>;
  newValue?: Record<string, any>;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Sanitize sensitive data from audit logs
 * Never log passwords, OTPs, tokens, or call content
 */
function sanitizeForAudit(data: Record<string, any> | undefined): Record<string, any> | undefined {
  if (!data) return undefined;
  
  const sensitiveKeys = [
    'password', 'passwordHash', 'token', 'sessionToken', 'authToken',
    'otp', 'otpCode', 'codeHash', 'secret', 'apiKey', 'apiSecret',
    'content', 'transcript', 'audioUrl', 'voiceSample',
    'creditCard', 'cardNumber', 'cvv', 'ssn'
  ];
  
  const sanitized = { ...data };
  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk.toLowerCase()))) {
      sanitized[key] = '[REDACTED]';
    }
  }
  
  return sanitized;
}

/**
 * Create an audit log entry
 */
export async function createAuditLog(params: AuditLogParams): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      userId: params.userId ?? null,
      organizationId: params.organizationId ?? null,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId ?? null,
      oldValue: sanitizeForAudit(params.oldValue) ?? null,
      newValue: sanitizeForAudit(params.newValue) ?? null,
      metadata: params.metadata ?? {},
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
    });
  } catch (err) {
    // Don't fail the main operation if audit logging fails
    logger.error("Audit", "Failed to create audit log", err as Error);
  }
}

async function resolveOrganizationIdForUser(userId: number): Promise<number | undefined> {
  const [user] = await db.select({
    organizationId: users.organizationId,
  }).from(users).where(eq(users.id, userId));

  return user?.organizationId ?? undefined;
}

/**
 * Get audit logs with filters (Super Admin only)
 */
export async function getAuditLogs(options: {
  limit?: number;
  offset?: number;
  action?: AuditAction;
  entityType?: string;
  userId?: number;
  startDate?: Date;
  endDate?: Date;
}) {
  const { limit = 50, offset = 0, action, entityType, userId, startDate, endDate } = options;
  
  let conditions: any[] = [];
  
  if (action) {
    conditions.push(eq(auditLogs.action, action));
  }
  if (entityType) {
    conditions.push(eq(auditLogs.entityType, entityType));
  }
  if (userId) {
    conditions.push(eq(auditLogs.userId, userId));
  }
  if (startDate) {
    conditions.push(gte(auditLogs.createdAt, startDate));
  }
  if (endDate) {
    conditions.push(lte(auditLogs.createdAt, endDate));
  }
  
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  
  const logs = await db.select({
    id: auditLogs.id,
    userId: auditLogs.userId,
    action: auditLogs.action,
    entityType: auditLogs.entityType,
    entityId: auditLogs.entityId,
    oldValue: auditLogs.oldValue,
    newValue: auditLogs.newValue,
    metadata: auditLogs.metadata,
    ipAddress: auditLogs.ipAddress,
    userAgent: auditLogs.userAgent,
    createdAt: auditLogs.createdAt,
    userName: users.username,
    userEmail: users.email,
  })
    .from(auditLogs)
    .leftJoin(users, eq(auditLogs.userId, users.id))
    .where(whereClause)
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit)
    .offset(offset);
  
  // Get total count
  const [{ count }] = await db.select({ count: sql<number>`count(*)` })
    .from(auditLogs)
    .where(whereClause);
  
  return {
    logs,
    total: Number(count),
    limit,
    offset,
  };
}

/**
 * Get audit summary statistics
 */
export async function getAuditStats(days: number = 7) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  const stats = await db.select({
    action: auditLogs.action,
    count: sql<number>`count(*)`,
  })
    .from(auditLogs)
    .where(gte(auditLogs.createdAt, startDate))
    .groupBy(auditLogs.action);
  
  return stats;
}

// ============================================================================
// AUDIT HELPERS FOR COMMON OPERATIONS
// ============================================================================

export const AuditHelpers = {
  async logLogin(userId: number, ipAddress?: string, userAgent?: string, organizationId?: number) {
    const resolvedOrganizationId = organizationId ?? await resolveOrganizationIdForUser(userId);
    await createAuditLog({
      userId,
      organizationId: resolvedOrganizationId,
      action: AUDIT_ACTION.LOGIN,
      entityType: 'user',
      entityId: userId,
      ipAddress,
      userAgent,
    });
  },

  async logLogout(userId: number, organizationId?: number) {
    const resolvedOrganizationId = organizationId ?? await resolveOrganizationIdForUser(userId);
    await createAuditLog({
      userId,
      organizationId: resolvedOrganizationId,
      action: AUDIT_ACTION.LOGOUT,
      entityType: 'user',
      entityId: userId,
    });
  },

  async logCompanyApproval(adminUserId: number, companyId: number, approved: boolean, reason?: string) {
    await createAuditLog({
      userId: adminUserId,
      organizationId: companyId,
      action: approved ? AUDIT_ACTION.APPROVE : AUDIT_ACTION.REJECT,
      entityType: 'organization',
      entityId: companyId,
      metadata: { reason },
    });
  },

  async logCreditAdjustment(adminUserId: number, companyId: number, amount: number, reason: string) {
    await createAuditLog({
      userId: adminUserId,
      organizationId: companyId,
      action: AUDIT_ACTION.CREDIT_ADJUSTMENT,
      entityType: 'organization',
      entityId: companyId,
      newValue: { amount },
      metadata: { reason },
    });
  },

  async logSettingsChange(adminUserId: number, settingKey: string, oldValue: any, newValue: any) {
    const resolvedOrganizationId = await resolveOrganizationIdForUser(adminUserId);
    await createAuditLog({
      userId: adminUserId,
      organizationId: resolvedOrganizationId,
      action: AUDIT_ACTION.SETTINGS_CHANGE,
      entityType: 'platform_setting',
      metadata: { key: settingKey },
      oldValue: { value: oldValue },
      newValue: { value: newValue },
    });
  },

  async logRoleChange(adminUserId: number, targetUserId: number, oldRole: string, newRole: string) {
    const resolvedOrganizationId = await resolveOrganizationIdForUser(adminUserId);
    await createAuditLog({
      userId: adminUserId,
      organizationId: resolvedOrganizationId,
      action: AUDIT_ACTION.ROLE_CHANGE,
      entityType: 'user',
      entityId: targetUserId,
      oldValue: { role: oldRole },
      newValue: { role: newRole },
    });
  },

  async logCreate(userId: number, entityType: string, entityId: number, data: Record<string, any>) {
    const resolvedOrganizationId = await resolveOrganizationIdForUser(userId);
    await createAuditLog({
      userId,
      organizationId: resolvedOrganizationId,
      action: AUDIT_ACTION.CREATE,
      entityType,
      entityId,
      newValue: data,
    });
  },

  async logUpdate(userId: number, entityType: string, entityId: number, oldData: Record<string, any>, newData: Record<string, any>) {
    const resolvedOrganizationId = await resolveOrganizationIdForUser(userId);
    await createAuditLog({
      userId,
      organizationId: resolvedOrganizationId,
      action: AUDIT_ACTION.UPDATE,
      entityType,
      entityId,
      oldValue: oldData,
      newValue: newData,
    });
  },

  async logDelete(userId: number, entityType: string, entityId: number, data: Record<string, any>) {
    const resolvedOrganizationId = await resolveOrganizationIdForUser(userId);
    await createAuditLog({
      userId,
      organizationId: resolvedOrganizationId,
      action: AUDIT_ACTION.DELETE,
      entityType,
      entityId,
      oldValue: data,
    });
  },
};
