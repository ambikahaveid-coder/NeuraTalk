/**
 * SUPER ADMIN SETTINGS ROUTES
 * 
 * Comprehensive admin control panel for:
 * - Payment gateways
 * - Languages
 * - Countries
 * - Legal content
 * - Support contacts
 * - Audit logs
 * 
 * All settings are database-driven and changeable without code changes.
 */

import { Express } from "express";
import { z } from "zod";
import { db } from "./db";
import { 
  supportedLanguages, paymentGateways, legalContent, supportContacts,
  auditLogs, countries, platformSettings,
  insertSupportedLanguageSchema, insertPaymentGatewaySchema,
  insertLegalContentSchema, insertSupportContactSchema
} from "@shared/schema";
import { eq, desc, asc, and } from "drizzle-orm";
import { logger } from "./observability";
import { requireAuth, requireSuperAdmin } from "./role-middleware";
import { getAuditLogs, getAuditStats, AuditHelpers } from "./audit";
import { featureFlags, type FeatureFlagName } from "./feature-flags";

// Update validation schemas
const updateLanguageSchema = z.object({
  isEnabled: z.boolean().optional(),
  displayOrder: z.number().int().positive().optional(),
  isDefault: z.boolean().optional(),
});

const updatePaymentGatewaySchema = z.object({
  isEnabled: z.boolean().optional(),
  isTestMode: z.boolean().optional(),
  keyIdEnvVar: z.string().optional().nullable(),
  keySecretEnvVar: z.string().optional().nullable(),
  webhookSecret: z.string().optional().nullable(),
  configJson: z.record(z.unknown()).optional().nullable(),
});

const updateLegalContentSchema = z.object({
  title: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

const updateSupportContactSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  displayOrder: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
});

const updateCountrySchema = z.object({
  isEnabled: z.boolean().optional(),
  dialCode: z.string().optional(),
  currency: z.string().optional(),
});

export function registerAdminSettingsRoutes(app: Express) {
  // ============================================================================
  // LANGUAGE MANAGEMENT
  // ============================================================================

  /**
   * Get all supported languages
   */
  app.get("/api/admin/languages", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const languages = await db.select()
        .from(supportedLanguages)
        .orderBy(asc(supportedLanguages.displayOrder));
      res.json({ success: true, data: languages });
    } catch (err) {
      logger.error("AdminSettings", "Failed to fetch languages", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch languages" });
    }
  });

  /**
   * Add a new language
   */
  app.post("/api/admin/languages", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const parsed = insertSupportedLanguageSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: "Invalid data", errors: parsed.error.errors });
      }

      const [language] = await db.insert(supportedLanguages).values(parsed.data).returning();
      
      await AuditHelpers.logCreate(req.user!.id, 'language', language.id, parsed.data);
      
      res.json({ success: true, data: language });
    } catch (err) {
      logger.error("AdminSettings", "Failed to add language", err as Error);
      res.status(500).json({ success: false, message: "Failed to add language" });
    }
  });

  /**
   * Update a language
   */
  app.put("/api/admin/languages/:id", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ success: false, message: "Invalid language ID" });
      }

      const parsed = updateLanguageSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: "Invalid data", errors: parsed.error.errors });
      }

      const [existing] = await db.select().from(supportedLanguages).where(eq(supportedLanguages.id, id));
      if (!existing) {
        return res.status(404).json({ success: false, message: "Language not found" });
      }
      
      const [updated] = await db.update(supportedLanguages)
        .set(parsed.data)
        .where(eq(supportedLanguages.id, id))
        .returning();

      await AuditHelpers.logUpdate(req.user!.id, 'language', id, existing, updated);

      res.json({ success: true, data: updated });
    } catch (err) {
      logger.error("AdminSettings", "Failed to update language", err as Error);
      res.status(500).json({ success: false, message: "Failed to update language" });
    }
  });

  // ============================================================================
  // PAYMENT GATEWAY MANAGEMENT
  // ============================================================================

  /**
   * Get all payment gateways
   */
  app.get("/api/admin/payment-gateways", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const gateways = await db.select()
        .from(paymentGateways)
        .orderBy(asc(paymentGateways.name));
      res.json({ success: true, data: gateways });
    } catch (err) {
      logger.error("AdminSettings", "Failed to fetch payment gateways", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch payment gateways" });
    }
  });

  /**
   * Add a new payment gateway
   */
  app.post("/api/admin/payment-gateways", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const parsed = insertPaymentGatewaySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: "Invalid data", errors: parsed.error.errors });
      }

      const [gateway] = await db.insert(paymentGateways).values(parsed.data).returning();
      
      await AuditHelpers.logCreate(req.user!.id, 'payment_gateway', gateway.id, { name: parsed.data.name });
      
      res.json({ success: true, data: gateway });
    } catch (err) {
      logger.error("AdminSettings", "Failed to add payment gateway", err as Error);
      res.status(500).json({ success: false, message: "Failed to add payment gateway" });
    }
  });

  /**
   * Update payment gateway settings
   */
  app.put("/api/admin/payment-gateways/:id", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ success: false, message: "Invalid gateway ID" });
      }

      const parsed = updatePaymentGatewaySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: "Invalid data", errors: parsed.error.errors });
      }

      const [existing] = await db.select().from(paymentGateways).where(eq(paymentGateways.id, id));
      if (!existing) {
        return res.status(404).json({ success: false, message: "Payment gateway not found" });
      }

      const [updated] = await db.update(paymentGateways)
        .set({ 
          ...parsed.data,
          updatedAt: new Date()
        })
        .where(eq(paymentGateways.id, id))
        .returning();

      await AuditHelpers.logUpdate(req.user!.id, 'payment_gateway', id, 
        { isEnabled: existing.isEnabled, isTestMode: existing.isTestMode },
        { isEnabled: updated.isEnabled, isTestMode: updated.isTestMode }
      );

      res.json({ success: true, data: updated });
    } catch (err) {
      logger.error("AdminSettings", "Failed to update payment gateway", err as Error);
      res.status(500).json({ success: false, message: "Failed to update payment gateway" });
    }
  });

  // ============================================================================
  // LEGAL CONTENT MANAGEMENT
  // ============================================================================

  /**
   * Get all legal content
   */
  app.get("/api/admin/legal-content", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const content = await db.select()
        .from(legalContent)
        .orderBy(asc(legalContent.key), asc(legalContent.languageCode));
      res.json({ success: true, data: content });
    } catch (err) {
      logger.error("AdminSettings", "Failed to fetch legal content", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch legal content" });
    }
  });

  /**
   * Get legal content by key and language (public)
   */
  app.get("/api/legal/:key", async (req, res) => {
    try {
      const { key } = req.params;
      const lang = (req.query.lang as string) || "en";

      const [content] = await db.select()
        .from(legalContent)
        .where(and(
          eq(legalContent.key, key),
          eq(legalContent.languageCode, lang),
          eq(legalContent.isActive, true)
        ));

      if (!content) {
        // Fall back to English
        const [fallback] = await db.select()
          .from(legalContent)
          .where(and(
            eq(legalContent.key, key),
            eq(legalContent.languageCode, "en"),
            eq(legalContent.isActive, true)
          ));
        
        if (!fallback) {
          return res.status(404).json({ success: false, message: "Content not found" });
        }
        return res.json({ success: true, data: fallback });
      }

      res.json({ success: true, data: content });
    } catch (err) {
      logger.error("AdminSettings", "Failed to fetch legal content", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch content" });
    }
  });

  /**
   * Create or update legal content
   */
  app.post("/api/admin/legal-content", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const parsed = insertLegalContentSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: "Invalid data", errors: parsed.error.errors });
      }

      // Check if content exists for this key+language
      const [existing] = await db.select()
        .from(legalContent)
        .where(and(
          eq(legalContent.key, parsed.data.key),
          eq(legalContent.languageCode, parsed.data.languageCode || "en")
        ));

      let result;
      if (existing) {
        // Update and increment version
        [result] = await db.update(legalContent)
          .set({
            ...parsed.data,
            version: (existing.version || 1) + 1,
            updatedBy: req.user!.id,
            updatedAt: new Date()
          })
          .where(eq(legalContent.id, existing.id))
          .returning();
        
        await AuditHelpers.logUpdate(req.user!.id, 'legal_content', existing.id, 
          { version: existing.version }, 
          { version: result.version }
        );
      } else {
        // Insert new
        [result] = await db.insert(legalContent)
          .values({ ...parsed.data, updatedBy: req.user!.id })
          .returning();
        
        await AuditHelpers.logCreate(req.user!.id, 'legal_content', result.id, { key: parsed.data.key });
      }

      res.json({ success: true, data: result });
    } catch (err) {
      logger.error("AdminSettings", "Failed to save legal content", err as Error);
      res.status(500).json({ success: false, message: "Failed to save content" });
    }
  });

  // ============================================================================
  // SUPPORT CONTACTS MANAGEMENT
  // ============================================================================

  /**
   * Get all support contacts
   */
  app.get("/api/admin/support-contacts", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const contacts = await db.select()
        .from(supportContacts)
        .orderBy(asc(supportContacts.displayOrder));
      res.json({ success: true, data: contacts });
    } catch (err) {
      logger.error("AdminSettings", "Failed to fetch support contacts", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch contacts" });
    }
  });

  /**
   * Get public support contacts
   */
  app.get("/api/support-contacts", async (req, res) => {
    try {
      const lang = (req.query.lang as string) || "en";
      
      const contacts = await db.select()
        .from(supportContacts)
        .where(and(
          eq(supportContacts.isEnabled, true),
          eq(supportContacts.languageCode, lang)
        ))
        .orderBy(asc(supportContacts.displayOrder));
      
      res.json({ success: true, data: contacts });
    } catch (err) {
      logger.error("AdminSettings", "Failed to fetch support contacts", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch contacts" });
    }
  });

  /**
   * Add support contact
   */
  app.post("/api/admin/support-contacts", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const parsed = insertSupportContactSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: "Invalid data", errors: parsed.error.errors });
      }

      const [contact] = await db.insert(supportContacts).values(parsed.data).returning();
      
      await AuditHelpers.logCreate(req.user!.id, 'support_contact', contact.id, parsed.data);
      
      res.json({ success: true, data: contact });
    } catch (err) {
      logger.error("AdminSettings", "Failed to add support contact", err as Error);
      res.status(500).json({ success: false, message: "Failed to add contact" });
    }
  });

  /**
   * Update support contact
   */
  app.put("/api/admin/support-contacts/:id", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { type, label, value, languageCode, isEnabled, displayOrder } = req.body;

      const [updated] = await db.update(supportContacts)
        .set({ type, label, value, languageCode, isEnabled, displayOrder })
        .where(eq(supportContacts.id, id))
        .returning();

      res.json({ success: true, data: updated });
    } catch (err) {
      logger.error("AdminSettings", "Failed to update support contact", err as Error);
      res.status(500).json({ success: false, message: "Failed to update contact" });
    }
  });

  /**
   * Delete support contact
   */
  app.delete("/api/admin/support-contacts/:id", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      const [deleted] = await db.delete(supportContacts)
        .where(eq(supportContacts.id, id))
        .returning();

      await AuditHelpers.logDelete(req.user!.id, 'support_contact', id, deleted);

      res.json({ success: true, message: "Contact deleted" });
    } catch (err) {
      logger.error("AdminSettings", "Failed to delete support contact", err as Error);
      res.status(500).json({ success: false, message: "Failed to delete contact" });
    }
  });

  // ============================================================================
  // ENABLED COUNTRIES MANAGEMENT
  // ============================================================================

  /**
   * Toggle country enabled status
   */
  app.put("/api/admin/countries/:id/toggle", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { isEnabled } = req.body;

      const [updated] = await db.update(countries)
        .set({ isEnabled })
        .where(eq(countries.id, id))
        .returning();

      await AuditHelpers.logUpdate(req.user!.id, 'country', id, 
        { isEnabled: !isEnabled }, 
        { isEnabled }
      );

      res.json({ success: true, data: updated });
    } catch (err) {
      logger.error("AdminSettings", "Failed to toggle country", err as Error);
      res.status(500).json({ success: false, message: "Failed to toggle country" });
    }
  });

  // ============================================================================
  // AUDIT LOGS (View only)
  // ============================================================================

  /**
   * Get audit logs
   */
  app.get("/api/admin/audit-logs", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      const action = req.query.action as string | undefined;
      const entityType = req.query.entityType as string | undefined;
      
      const result = await getAuditLogs({
        limit,
        offset,
        action: action as any,
        entityType,
      });

      res.json({ success: true, ...result });
    } catch (err) {
      logger.error("AdminSettings", "Failed to fetch audit logs", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch audit logs" });
    }
  });

  /**
   * Get audit stats
   */
  app.get("/api/admin/audit-stats", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const days = parseInt(req.query.days as string) || 7;
      const stats = await getAuditStats(days);
      res.json({ success: true, data: stats });
    } catch (err) {
      logger.error("AdminSettings", "Failed to fetch audit stats", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch stats" });
    }
  });

  // ============================================================================
  // PLATFORM SETTINGS (Consolidated)
  // ============================================================================

  /**
   * Get all platform settings
   */
  app.get("/api/admin/platform-settings", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const settings = await db.select().from(platformSettings);
      res.json({ success: true, data: settings });
    } catch (err) {
      logger.error("AdminSettings", "Failed to fetch platform settings", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch settings" });
    }
  });

  /**
   * Update platform setting
   */
  app.put("/api/admin/platform-settings/:key", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { key } = req.params;
      const { value, description } = req.body;

      // Get old value for audit
      const [existing] = await db.select().from(platformSettings).where(eq(platformSettings.key, key));
      
      let result;
      if (existing) {
        [result] = await db.update(platformSettings)
          .set({ value, description, updatedBy: req.user!.id, updatedAt: new Date() })
          .where(eq(platformSettings.key, key))
          .returning();
      } else {
        [result] = await db.insert(platformSettings)
          .values({ key, value, description, updatedBy: req.user!.id })
          .returning();
      }

      await AuditHelpers.logSettingsChange(req.user!.id, key, existing?.value, value);

      res.json({ success: true, data: result });
    } catch (err) {
      logger.error("AdminSettings", "Failed to update platform setting", err as Error);
      res.status(500).json({ success: false, message: "Failed to update setting" });
    }
  });

  // ============================================================================
  // FEATURE FLAGS
  // ============================================================================

  /**
   * Get all feature flags
   */
  app.get("/api/admin/feature-flags", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const flags = featureFlags.getAllFlags();
      res.json({ success: true, data: flags });
    } catch (err) {
      logger.error("AdminSettings", "Failed to fetch feature flags", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch feature flags" });
    }
  });

  /**
   * Update feature flag
   */
  app.put("/api/admin/feature-flags/:name", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const flagName = req.params.name as FeatureFlagName;
      const { enabled, killSwitch, rolloutPercentage } = req.body;
      
      const flag = featureFlags.getFlag(flagName);
      if (!flag) {
        return res.status(404).json({ success: false, message: "Feature flag not found" });
      }

      const updatedBy = req.user?.username || `user_${req.user?.id}`;

      if (typeof enabled === "boolean") {
        if (enabled) {
          featureFlags.enable(flagName, updatedBy);
        } else {
          featureFlags.disable(flagName, updatedBy);
        }
      }

      if (typeof killSwitch === "boolean") {
        if (killSwitch) {
          featureFlags.killSwitch(flagName, updatedBy);
        } else {
          featureFlags.removeKillSwitch(flagName, updatedBy);
        }
      }

      if (typeof rolloutPercentage === "number") {
        featureFlags.setRolloutPercentage(flagName, rolloutPercentage, updatedBy);
      }

      const updatedFlag = featureFlags.getFlag(flagName);
      
      await AuditHelpers.logSettingsChange(
        req.user!.id, 
        `feature_flag:${flagName}`, 
        { enabled: flag.enabled, killSwitch: flag.killSwitch },
        { enabled: updatedFlag?.enabled, killSwitch: updatedFlag?.killSwitch }
      );

      res.json({ success: true, data: updatedFlag });
    } catch (err) {
      logger.error("AdminSettings", "Failed to update feature flag", err as Error);
      res.status(500).json({ success: false, message: "Failed to update feature flag" });
    }
  });

  logger.info("AdminSettings", "Admin settings routes registered");
}
