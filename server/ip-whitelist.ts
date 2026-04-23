import { Request, Response, NextFunction, Router } from "express";
import { db } from "./db";
import { ipWhitelists, organizations } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { requireRole } from "./role-middleware";
import { z } from "zod";

function ipToLong(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

function cidrMatch(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split('/');
  const bits = bitsStr ? parseInt(bitsStr, 10) : 32;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  
  const ipLong = ipToLong(ip);
  const rangeLong = ipToLong(range);
  
  return (ipLong & mask) === (rangeLong & mask);
}

function isIpAllowed(clientIp: string, whitelistedEntries: { ipAddress: string }[]): boolean {
  if (whitelistedEntries.length === 0) {
    return true;
  }
  
  for (const entry of whitelistedEntries) {
    if (entry.ipAddress.includes('/')) {
      if (cidrMatch(clientIp, entry.ipAddress)) {
        return true;
      }
    } else {
      if (clientIp === entry.ipAddress) {
        return true;
      }
    }
  }
  
  return false;
}

function normalizeIpAddress(ip: string): string {
  if (ip.startsWith('::ffff:')) {
    return ip.slice(7);
  }
  if (ip === '::1') {
    return '127.0.0.1';
  }
  return ip;
}

function getClientIp(req: Request): string {
  const trustedProxies = process.env.TRUSTED_PROXIES?.split(',').map(p => p.trim()) || [];
  const isBehindTrustedProxy = trustedProxies.length > 0;
  
  if (isBehindTrustedProxy) {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (forwardedFor) {
      const ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
      const clientIp = ips.split(',')[0].trim();
      return normalizeIpAddress(clientIp);
    }
  }
  
  const remoteAddr = req.socket.remoteAddress || '0.0.0.0';
  return normalizeIpAddress(remoteAddr);
}

export async function ipWhitelistMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!req.user?.organizationId) {
    return next();
  }

  try {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, req.user.organizationId));
    
    if (!org) {
      return next();
    }

    const settings = org.settings as any || {};
    if (!settings.ipWhitelistEnabled) {
      return next();
    }

    const whitelist = await db.select()
      .from(ipWhitelists)
      .where(and(
        eq(ipWhitelists.organizationId, req.user.organizationId),
        eq(ipWhitelists.isActive, true)
      ));

    const clientIp = getClientIp(req);

    if (!isIpAllowed(clientIp, whitelist)) {
      return res.status(403).json({
        error: "Access denied",
        message: "Your IP address is not in the allowed list for this organization",
        clientIp: clientIp
      });
    }

    next();
  } catch (error) {
    console.error("IP whitelist check error:", error);
    next();
  }
}

const router = Router();

router.get("/api/organization/ip-whitelist", requireRole("company_admin", "super_admin"), async (req: Request, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    
    if (!organizationId && req.user!.role !== "super_admin") {
      return res.status(400).json({ error: "No organization associated with user" });
    }

    const orgId = organizationId || parseInt(req.query.organizationId as string);
    
    if (!orgId) {
      return res.status(400).json({ error: "Organization ID required" });
    }

    const whitelist = await db.select()
      .from(ipWhitelists)
      .where(eq(ipWhitelists.organizationId, orgId));

    res.json(whitelist);
  } catch (error) {
    console.error("Error fetching IP whitelist:", error);
    res.status(500).json({ error: "Failed to fetch IP whitelist" });
  }
});

const addIpSchema = z.object({
  ipAddress: z.string().min(1),
  description: z.string().optional(),
});

router.post("/api/organization/ip-whitelist", requireRole("company_admin", "super_admin"), async (req: Request, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    
    if (!organizationId && req.user!.role !== "super_admin") {
      return res.status(400).json({ error: "No organization associated with user" });
    }

    const parsed = addIpSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    }

    const { ipAddress, description } = parsed.data;
    const orgId = organizationId || req.body.organizationId;

    const [entry] = await db.insert(ipWhitelists).values({
      organizationId: orgId,
      ipAddress,
      description,
      createdBy: req.user!.id,
    }).returning();

    res.status(201).json(entry);
  } catch (error) {
    console.error("Error adding IP to whitelist:", error);
    res.status(500).json({ error: "Failed to add IP to whitelist" });
  }
});

router.delete("/api/organization/ip-whitelist/:id", requireRole("company_admin", "super_admin"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const organizationId = req.user!.organizationId;

    const [entry] = await db.select()
      .from(ipWhitelists)
      .where(eq(ipWhitelists.id, id));

    if (!entry) {
      return res.status(404).json({ error: "IP entry not found" });
    }

    if (req.user!.role !== "super_admin" && entry.organizationId !== organizationId) {
      return res.status(403).json({ error: "Not authorized to delete this entry" });
    }

    await db.delete(ipWhitelists).where(eq(ipWhitelists.id, id));

    res.json({ success: true, message: "IP entry deleted" });
  } catch (error) {
    console.error("Error deleting IP from whitelist:", error);
    res.status(500).json({ error: "Failed to delete IP from whitelist" });
  }
});

router.post("/api/organization/ip-whitelist/toggle", requireRole("company_admin", "super_admin"), async (req: Request, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    
    if (!organizationId && req.user!.role !== "super_admin") {
      return res.status(400).json({ error: "No organization associated with user" });
    }

    const { enabled } = req.body;
    const orgId = organizationId || req.body.organizationId;

    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
    
    if (!org) {
      return res.status(404).json({ error: "Organization not found" });
    }

    const currentSettings = (org.settings as any) || {};
    const newSettings = { ...currentSettings, ipWhitelistEnabled: Boolean(enabled) };

    await db.update(organizations)
      .set({ settings: newSettings })
      .where(eq(organizations.id, orgId));

    res.json({ 
      success: true, 
      enabled: Boolean(enabled),
      message: enabled ? "IP whitelist enabled" : "IP whitelist disabled"
    });
  } catch (error) {
    console.error("Error toggling IP whitelist:", error);
    res.status(500).json({ error: "Failed to toggle IP whitelist" });
  }
});

router.get("/api/organization/ip-whitelist/status", requireRole("company_admin", "super_admin"), async (req: Request, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    
    if (!organizationId && req.user!.role !== "super_admin") {
      return res.status(400).json({ error: "No organization associated with user" });
    }

    const orgId = organizationId || parseInt(req.query.organizationId as string);

    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
    
    if (!org) {
      return res.status(404).json({ error: "Organization not found" });
    }

    const settings = (org.settings as any) || {};
    const clientIp = getClientIp(req);

    res.json({ 
      enabled: Boolean(settings.ipWhitelistEnabled),
      currentIp: clientIp
    });
  } catch (error) {
    console.error("Error getting IP whitelist status:", error);
    res.status(500).json({ error: "Failed to get IP whitelist status" });
  }
});

export default router;
