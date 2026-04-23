/**
 * Admin Configuration Routes
 * 
 * Super Admin only - manage platform secrets like Firebase and TURN configuration
 */

import type { Express, Request, Response, NextFunction } from "express";
import { configService, PLATFORM_CONFIG_KEYS } from "./config-service";
import { db } from "./db";
import { users, userSessions } from "@shared/schema";
import { eq, and, gt } from "drizzle-orm";
import { z } from "zod";

async function validateSession(token: string): Promise<number | null> {
  const session = await db.query.userSessions.findFirst({
    where: and(
      eq(userSessions.token, token),
      gt(userSessions.expiresAt, new Date())
    ),
  });
  return session?.userId ?? null;
}

async function requireSuperAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const token = authHeader.slice(7);
  
  try {
    const userId = await validateSession(token);
    if (!userId) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }
    
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    
    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }
    
    if (user.role !== "super_admin") {
      res.status(403).json({ error: "Super Admin access required" });
      return;
    }
    
    (req as any).user = user;
    next();
  } catch (err) {
    console.error("Auth error:", err);
    res.status(500).json({ error: "Authentication failed" });
  }
}

const setSecretSchema = z.object({
  key: z.string(),
  value: z.string().min(1),
});

const deleteSecretSchema = z.object({
  key: z.string(),
});

export function registerAdminConfigRoutes(app: Express): void {
  app.get("/api/admin/config/status", requireSuperAdmin, async (_req, res) => {
    try {
      const status = await configService.getConfigStatus();
      const summary = configService.getConfigSummary();
      
      res.json({
        configs: status,
        summary,
        availableKeys: PLATFORM_CONFIG_KEYS,
      });
    } catch (error) {
      console.error("Failed to get config status:", error);
      res.status(500).json({ error: "Failed to get configuration status" });
    }
  });

  app.post("/api/admin/config/secret", requireSuperAdmin, async (req, res) => {
    try {
      const { key, value } = setSecretSchema.parse(req.body);
      const user = (req as any).user;
      
      const validKey = PLATFORM_CONFIG_KEYS.find(k => k.key === key);
      if (!validKey) {
        return res.status(400).json({ error: `Invalid config key: ${key}` });
      }
      
      if (key === "FIREBASE_SERVICE_ACCOUNT_JSON") {
        try {
          JSON.parse(value);
        } catch {
          return res.status(400).json({ error: "Invalid JSON for service account" });
        }
      }
      
      await configService.setSecret(key, value, user.id);
      
      res.json({ 
        success: true, 
        message: `${key} configured successfully`,
        requiresRestart: key.startsWith("FIREBASE_"),
      });
    } catch (error: any) {
      console.error("Failed to set secret:", error);
      res.status(500).json({ error: error.message || "Failed to save configuration" });
    }
  });

  app.delete("/api/admin/config/secret", requireSuperAdmin, async (req, res) => {
    try {
      const { key } = deleteSecretSchema.parse(req.body);
      const user = (req as any).user;
      
      await configService.deleteSecret(key, user.id);
      
      res.json({ success: true, message: `${key} removed` });
    } catch (error: any) {
      console.error("Failed to delete secret:", error);
      res.status(500).json({ error: error.message || "Failed to delete configuration" });
    }
  });

  app.post("/api/admin/config/test-firebase", requireSuperAdmin, async (_req, res) => {
    try {
      const isConfigured = configService.isFirebaseConfigured();
      
      if (!isConfigured) {
        return res.json({ 
          success: false, 
          message: "Firebase not fully configured. Missing required keys." 
        });
      }
      
      res.json({ 
        success: true, 
        message: "Firebase configuration appears valid. Restart server to apply changes." 
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/config/test-turn", requireSuperAdmin, async (_req, res) => {
    try {
      const isConfigured = configService.isTurnConfigured();
      
      if (!isConfigured) {
        return res.json({ 
          success: false, 
          message: "TURN server not configured. Add URL and credentials." 
        });
      }
      
      res.json({ 
        success: true, 
        message: "TURN server configuration appears valid.",
        turnUrl: configService.getSecret("TURN_SERVER_URL")?.replace(/:([^:]+)@/, ":***@"),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  console.log("[AdminConfig] Routes registered");
}
