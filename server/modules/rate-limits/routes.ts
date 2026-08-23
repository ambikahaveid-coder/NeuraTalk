/**
 * Rate-limit rule admin governance (P1 foundation hardening, 2026-08-23).
 *
 * The `rateLimitRules` table (shared/schema.ts) already existed with a single
 * read consumer (server/production-routes.ts, an unrelated abuse-report
 * feature) but no admin write path anywhere -- the table has been dead
 * infrastructure since it was added. This adds CRUD only. It does NOT wire
 * these rules into an actual request-throttling middleware and does NOT seed
 * any default rules, so no production rate limit changes as a result of this
 * change alone -- per the explicit instruction not to change production rate
 * limits arbitrarily. The existing in-memory/Redis IP-based limiters
 * (server/rate-limit.ts: authLimiter, otpRequestLimiter, etc.) are untouched
 * and remain the actual enforcement mechanism today.
 */
import type { Express, Request, Response } from "express";
import { db } from "../../db";
import { rateLimitRules, insertRateLimitRuleSchema } from "@shared/schema";
import { eq } from "drizzle-orm";
import { requireAuth, requireSuperAdmin } from "../../role-middleware";
import { AuditHelpers, createAuditLog } from "../../audit";
import { AUDIT_ACTION } from "@shared/schema";
import { logger } from "../../observability";

function badRequest(res: Response, msg: string) {
  return res.status(400).json({ success: false, error: msg });
}

export function registerRateLimitAdminRoutes(app: Express): void {
  app.get("/api/admin/rate-limit-rules", requireAuth, requireSuperAdmin, async (_req: Request, res: Response) => {
    try {
      const rules = await db.select().from(rateLimitRules).orderBy(rateLimitRules.id);
      res.json({ success: true, rules });
    } catch (error) {
      logger.error("RateLimitAdmin", "Failed to list rules", error as Error);
      res.status(500).json({ success: false, error: "Failed to list rate-limit rules" });
    }
  });

  app.post("/api/admin/rate-limit-rules", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    const parsed = insertRateLimitRuleSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error.message);

    try {
      const [rule] = await db.insert(rateLimitRules).values(parsed.data).returning();
      await createAuditLog({
        userId: req.user!.id,
        action: AUDIT_ACTION.CREATE,
        entityType: "rate_limit_rule",
        entityId: rule.id,
        newValue: parsed.data,
      });
      res.status(201).json({ success: true, rule });
    } catch (error) {
      logger.error("RateLimitAdmin", "Failed to create rule", error as Error);
      res.status(500).json({ success: false, error: "Failed to create rate-limit rule" });
    }
  });

  app.patch("/api/admin/rate-limit-rules/:id", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    const ruleId = parseInt(req.params.id);
    if (!Number.isFinite(ruleId)) return badRequest(res, "Invalid rule id");

    const parsed = insertRateLimitRuleSchema.partial().safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error.message);
    if (Object.keys(parsed.data).length === 0) return badRequest(res, "No fields to update");

    try {
      const [existing] = await db.select().from(rateLimitRules).where(eq(rateLimitRules.id, ruleId));
      if (!existing) return res.status(404).json({ success: false, error: "Rule not found" });

      const [updated] = await db.update(rateLimitRules)
        .set(parsed.data)
        .where(eq(rateLimitRules.id, ruleId))
        .returning();

      await createAuditLog({
        userId: req.user!.id,
        action: AUDIT_ACTION.UPDATE,
        entityType: "rate_limit_rule",
        entityId: ruleId,
        oldValue: existing,
        newValue: parsed.data,
      });
      res.json({ success: true, rule: updated });
    } catch (error) {
      logger.error("RateLimitAdmin", "Failed to update rule", error as Error);
      res.status(500).json({ success: false, error: "Failed to update rate-limit rule" });
    }
  });

  // Enable/disable are the same PATCH path (isEnabled boolean) -- kept as a
  // dedicated route too for an explicit, audited, single-purpose action.
  app.patch("/api/admin/rate-limit-rules/:id/enabled", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    const ruleId = parseInt(req.params.id);
    const { isEnabled } = req.body;
    if (!Number.isFinite(ruleId)) return badRequest(res, "Invalid rule id");
    if (typeof isEnabled !== "boolean") return badRequest(res, "isEnabled must be a boolean");

    try {
      const [existing] = await db.select().from(rateLimitRules).where(eq(rateLimitRules.id, ruleId));
      if (!existing) return res.status(404).json({ success: false, error: "Rule not found" });

      const [updated] = await db.update(rateLimitRules)
        .set({ isEnabled })
        .where(eq(rateLimitRules.id, ruleId))
        .returning();

      await AuditHelpers.logSettingsChange(req.user!.id, "rate_limit_rule_enabled", existing.isEnabled, isEnabled);
      res.json({ success: true, rule: updated });
    } catch (error) {
      logger.error("RateLimitAdmin", "Failed to toggle rule", error as Error);
      res.status(500).json({ success: false, error: "Failed to toggle rate-limit rule" });
    }
  });
}
