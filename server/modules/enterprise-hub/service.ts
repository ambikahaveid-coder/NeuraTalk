import { eq, and, desc } from "drizzle-orm";
import { db } from "../../db";
import {
  enterpriseNumbers,
  numberVerifications,
  sipIntegrations,
  languageRules,
  aiConfigurations,
  integrationAuditLogs,
  organizations,
  type InsertEnterpriseNumber,
  type InsertSipIntegration,
  type InsertLanguageRule,
  type InsertAiConfiguration,
} from "@shared/schema";
import { logger } from "../../observability";
import { randomInt } from "crypto";

// ── Audit helper ─────────────────────────────────────────────────────────────

export async function logHubAudit(opts: {
  organizationId: number;
  enterpriseNumberId?: number | null;
  actorId?: number | null;
  action: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}) {
  await db.insert(integrationAuditLogs).values({
    organizationId: opts.organizationId,
    enterpriseNumberId: opts.enterpriseNumberId ?? null,
    actorId: opts.actorId ?? null,
    action: opts.action,
    details: opts.details ?? {},
    ipAddress: opts.ipAddress ?? null,
  });
}

// ── Enterprise Numbers ────────────────────────────────────────────────────────

export async function listEnterpriseNumbers(organizationId: number) {
  return db
    .select()
    .from(enterpriseNumbers)
    .where(eq(enterpriseNumbers.organizationId, organizationId))
    .orderBy(desc(enterpriseNumbers.createdAt));
}

export async function getEnterpriseNumber(id: number, organizationId: number) {
  const [row] = await db
    .select()
    .from(enterpriseNumbers)
    .where(and(eq(enterpriseNumbers.id, id), eq(enterpriseNumbers.organizationId, organizationId)));
  return row ?? null;
}

export async function registerEnterpriseNumber(
  data: InsertEnterpriseNumber,
  actorId: number,
  ipAddress?: string,
) {
  const [created] = await db.insert(enterpriseNumbers).values(data).returning();
  await logHubAudit({
    organizationId: data.organizationId,
    enterpriseNumberId: created.id,
    actorId,
    action: "number_registered",
    details: { phoneNumber: data.phoneNumber, integrationType: data.integrationType },
    ipAddress,
  });
  return created;
}

export async function updateEnterpriseNumber(
  id: number,
  organizationId: number,
  patch: Partial<InsertEnterpriseNumber>,
  actorId: number,
) {
  const [updated] = await db
    .update(enterpriseNumbers)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(enterpriseNumbers.id, id), eq(enterpriseNumbers.organizationId, organizationId)))
    .returning();
  if (updated) {
    await logHubAudit({ organizationId, enterpriseNumberId: id, actorId, action: "number_updated", details: patch as Record<string, unknown> });
  }
  return updated ?? null;
}

export async function deleteEnterpriseNumber(id: number, organizationId: number, actorId: number) {
  const [deleted] = await db
    .delete(enterpriseNumbers)
    .where(and(eq(enterpriseNumbers.id, id), eq(enterpriseNumbers.organizationId, organizationId)))
    .returning();
  if (deleted) {
    await logHubAudit({ organizationId, enterpriseNumberId: id, actorId, action: "number_deleted" });
  }
  return !!deleted;
}

// ── Verification Workflow ─────────────────────────────────────────────────────

function generateOtp(): string {
  return String(randomInt(100000, 999999));
}

export async function initiateVerification(
  enterpriseNumberId: number,
  organizationId: number,
  method: string,
  actorId: number,
) {
  const number = await getEnterpriseNumber(enterpriseNumberId, organizationId);
  if (!number) throw new Error("Enterprise number not found");

  const otp = generateOtp();
  const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

  const [verification] = await db
    .insert(numberVerifications)
    .values({
      enterpriseNumberId,
      organizationId,
      method,
      status: "sent",
      otp,
      otpExpiresAt,
    })
    .returning();

  await logHubAudit({
    organizationId,
    enterpriseNumberId,
    actorId,
    action: "verification_initiated",
    details: { method, verificationId: verification.id },
  });

  // In production, this would trigger an actual OTP delivery via MSG91/SMS/voice
  logger.info("EnterpriseHub", `Verification OTP for ${number.phoneNumber}: ${otp} (method: ${method})`);

  return { verificationId: verification.id, method, expiresAt: otpExpiresAt };
}

export async function confirmVerification(
  verificationId: number,
  organizationId: number,
  otp: string,
  actorId: number,
) {
  const [verification] = await db
    .select()
    .from(numberVerifications)
    .where(
      and(
        eq(numberVerifications.id, verificationId),
        eq(numberVerifications.organizationId, organizationId),
      ),
    );

  if (!verification) throw new Error("Verification not found");
  if (verification.status === "verified") return { success: true, alreadyVerified: true };
  if (verification.status === "failed" || verification.status === "expired") {
    throw new Error("Verification already failed/expired");
  }
  if (!verification.otpExpiresAt || new Date() > verification.otpExpiresAt) {
    await db.update(numberVerifications).set({ status: "expired" }).where(eq(numberVerifications.id, verificationId));
    throw new Error("OTP expired");
  }

  const newAttempts = verification.attempts + 1;
  if (verification.otp !== otp) {
    if (newAttempts >= 5) {
      await db.update(numberVerifications)
        .set({ status: "failed", attempts: newAttempts, failureReason: "max_attempts_exceeded" })
        .where(eq(numberVerifications.id, verificationId));
      throw new Error("Max verification attempts exceeded");
    }
    await db.update(numberVerifications).set({ attempts: newAttempts }).where(eq(numberVerifications.id, verificationId));
    throw new Error("Invalid OTP");
  }

  await db.update(numberVerifications)
    .set({ status: "verified", verifiedAt: new Date(), attempts: newAttempts })
    .where(eq(numberVerifications.id, verificationId));

  if (verification.enterpriseNumberId) {
    await db.update(enterpriseNumbers)
      .set({ verificationStatus: "verified", isActive: true, updatedAt: new Date() })
      .where(eq(enterpriseNumbers.id, verification.enterpriseNumberId));

    await logHubAudit({
      organizationId,
      enterpriseNumberId: verification.enterpriseNumberId,
      actorId,
      action: "number_verified",
      details: { verificationId },
    });
  }

  return { success: true };
}

// ── SIP Integrations ──────────────────────────────────────────────────────────

export async function listSipIntegrations(organizationId: number) {
  return db
    .select()
    .from(sipIntegrations)
    .where(eq(sipIntegrations.organizationId, organizationId))
    .orderBy(desc(sipIntegrations.createdAt));
}

export async function upsertSipIntegration(
  data: InsertSipIntegration,
  actorId: number,
) {
  const [result] = await db.insert(sipIntegrations).values(data).returning();
  await logHubAudit({
    organizationId: data.organizationId,
    enterpriseNumberId: data.enterpriseNumberId ?? null,
    actorId,
    action: "sip_config_created",
    details: { sipServer: data.sipServer, label: data.label },
  });
  return result;
}

export async function updateSipIntegration(
  id: number,
  organizationId: number,
  patch: Partial<InsertSipIntegration>,
  actorId: number,
) {
  const [updated] = await db
    .update(sipIntegrations)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(sipIntegrations.id, id), eq(sipIntegrations.organizationId, organizationId)))
    .returning();
  if (updated) {
    await logHubAudit({ organizationId, enterpriseNumberId: updated.enterpriseNumberId ?? null, actorId, action: "sip_config_updated" });
  }
  return updated ?? null;
}

export async function deleteSipIntegration(id: number, organizationId: number, actorId: number) {
  const [deleted] = await db
    .delete(sipIntegrations)
    .where(and(eq(sipIntegrations.id, id), eq(sipIntegrations.organizationId, organizationId)))
    .returning();
  if (deleted) {
    await logHubAudit({ organizationId, actorId, action: "sip_config_deleted", details: { id } });
  }
  return !!deleted;
}

// ── Language Rules ────────────────────────────────────────────────────────────

export async function listLanguageRules(organizationId: number, enterpriseNumberId?: number) {
  const conditions = enterpriseNumberId
    ? and(eq(languageRules.organizationId, organizationId), eq(languageRules.enterpriseNumberId, enterpriseNumberId))
    : eq(languageRules.organizationId, organizationId);
  return db.select().from(languageRules).where(conditions);
}

export async function upsertLanguageRule(data: InsertLanguageRule, actorId: number) {
  const [result] = await db.insert(languageRules).values(data).returning();
  await logHubAudit({
    organizationId: data.organizationId,
    enterpriseNumberId: data.enterpriseNumberId,
    actorId,
    action: "language_rule_created",
    details: { callerLanguage: data.callerLanguage, agentLanguage: data.agentLanguage },
  });
  return result;
}

export async function deleteLanguageRule(id: number, organizationId: number, actorId: number) {
  const [deleted] = await db
    .delete(languageRules)
    .where(and(eq(languageRules.id, id), eq(languageRules.organizationId, organizationId)))
    .returning();
  if (deleted) {
    await logHubAudit({ organizationId, actorId, action: "language_rule_deleted", details: { id } });
  }
  return !!deleted;
}

// ── AI Configurations ─────────────────────────────────────────────────────────

export async function getAiConfiguration(enterpriseNumberId: number, organizationId: number) {
  const [row] = await db
    .select()
    .from(aiConfigurations)
    .where(
      and(
        eq(aiConfigurations.enterpriseNumberId, enterpriseNumberId),
        eq(aiConfigurations.organizationId, organizationId),
      ),
    );
  return row ?? null;
}

export async function upsertAiConfiguration(
  data: InsertAiConfiguration,
  actorId: number,
) {
  const existing = await getAiConfiguration(data.enterpriseNumberId, data.organizationId);
  let result;
  if (existing) {
    const [updated] = await db
      .update(aiConfigurations)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(aiConfigurations.id, existing.id))
      .returning();
    result = updated;
  } else {
    const [created] = await db.insert(aiConfigurations).values(data).returning();
    result = created;
  }
  await logHubAudit({
    organizationId: data.organizationId,
    enterpriseNumberId: data.enterpriseNumberId,
    actorId,
    action: "ai_config_updated",
    details: data as Record<string, unknown>,
  });
  return result;
}

// ── Audit Logs ────────────────────────────────────────────────────────────────

export async function listIntegrationAuditLogs(organizationId: number, limit = 100) {
  return db
    .select()
    .from(integrationAuditLogs)
    .where(eq(integrationAuditLogs.organizationId, organizationId))
    .orderBy(desc(integrationAuditLogs.createdAt))
    .limit(limit);
}

// ── Hub Overview Stats ────────────────────────────────────────────────────────

export async function getHubOverview(organizationId: number) {
  const numbers = await listEnterpriseNumbers(organizationId);
  const sips = await listSipIntegrations(organizationId);
  const rules = await listLanguageRules(organizationId);

  const total = numbers.length;
  const verified = numbers.filter((n) => n.verificationStatus === "verified").length;
  const aiEnabled = numbers.filter((n) => n.aiEnabled).length;
  const byCarrier = numbers.reduce<Record<string, number>>((acc, n) => {
    acc[n.carrier] = (acc[n.carrier] ?? 0) + 1;
    return acc;
  }, {});
  const byType = numbers.reduce<Record<string, number>>((acc, n) => {
    acc[n.integrationType] = (acc[n.integrationType] ?? 0) + 1;
    return acc;
  }, {});

  return {
    totalNumbers: total,
    verifiedNumbers: verified,
    pendingVerification: total - verified,
    aiEnabledNumbers: aiEnabled,
    sipTrunks: sips.length,
    languageRules: rules.length,
    byCarrier,
    byIntegrationType: byType,
  };
}
