/**
 * B2B Admin Routes — virtual number pool, agent skills, per-org DID management.
 * All endpoints require org-admin or super-admin role.
 */

import type { Express, Request, Response } from "express";
import { eq, and, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { requireAuth } from "../../role-middleware";
import type { AuthenticatedUser } from "../../role-middleware";
import {
  communicationVirtualNumbers,
  organizations,
  agentSkills,
  orgDIDNumbers,
  users,
  type InsertAgentSkill,
  type InsertOrgDIDNumber,
} from "@shared/schema";
import { logger } from "../../observability";

// ── helpers ──────────────────────────────────────────────────────────────────

function getUser(req: Request): AuthenticatedUser {
  return (req as any).user as AuthenticatedUser;
}

function isSuperAdmin(user: AuthenticatedUser): boolean {
  return (user as any).role === "super_admin" || (user as any).isSuperAdmin === true;
}

function isOrgAdmin(user: AuthenticatedUser, orgId: number): boolean {
  return isSuperAdmin(user) ||
    ((user as any).organizationId === orgId && ((user as any).role === "company_admin" || (user as any).role === "org_admin"));
}

function badRequest(res: Response, msg: string) {
  return res.status(400).json({ success: false, error: msg });
}

function forbidden(res: Response) {
  return res.status(403).json({ success: false, error: "Forbidden" });
}

// ── virtual number pool (super-admin only) ───────────────────────────────────

async function listVirtualNumbers(req: Request, res: Response) {
  const user = getUser(req);
  if (!isSuperAdmin(user)) return forbidden(res);

  const numbers = await db.select().from(communicationVirtualNumbers)
    .orderBy(communicationVirtualNumbers.createdAt);

  return res.json({ success: true, data: numbers });
}

async function addVirtualNumber(req: Request, res: Response) {
  const user = getUser(req);
  if (!isSuperAdmin(user)) return forbidden(res);

  const schema = z.object({
    phoneNumber: z.string().min(8),
    provider: z.string().default("msg91"),
    countryCode: z.string().default("IN"),
    region: z.string().default("ap-south-1"),
    capabilities: z.object({
      voice: z.boolean().default(true),
      pstn: z.boolean().default(true),
      sms: z.boolean().default(false),
    }).optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error.message);

  const [inserted] = await db.insert(communicationVirtualNumbers).values({
    phoneNumber: parsed.data.phoneNumber,
    provider: parsed.data.provider,
    countryCode: parsed.data.countryCode,
    region: parsed.data.region,
    capabilities: parsed.data.capabilities ?? { voice: true, pstn: true, sms: false },
    status: "available",
  }).returning();

  logger.info("B2BAdmin", "Virtual number added", { phoneNumber: parsed.data.phoneNumber });
  return res.status(201).json({ success: true, data: inserted });
}

async function updateVirtualNumberStatus(req: Request, res: Response) {
  const user = getUser(req);
  if (!isSuperAdmin(user)) return forbidden(res);

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return badRequest(res, "Invalid id");

  const schema = z.object({
    status: z.enum(["available", "assigned", "maintenance", "disabled"]),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error.message);

  const [updated] = await db.update(communicationVirtualNumbers)
    .set({ status: parsed.data.status, updatedAt: new Date() })
    .where(eq(communicationVirtualNumbers.id, id))
    .returning();

  if (!updated) return res.status(404).json({ success: false, error: "Not found" });
  return res.json({ success: true, data: updated });
}

// ── org DID numbers ───────────────────────────────────────────────────────────

async function listOrgDIDs(req: Request, res: Response) {
  const user = getUser(req);
  const orgId = Number(req.params.orgId);
  if (!Number.isFinite(orgId)) return badRequest(res, "Invalid orgId");
  if (!isOrgAdmin(user, orgId)) return forbidden(res);

  const dids = await db.select().from(orgDIDNumbers)
    .where(eq(orgDIDNumbers.organizationId, orgId))
    .orderBy(orgDIDNumbers.createdAt);

  return res.json({ success: true, data: dids });
}

async function addOrgDID(req: Request, res: Response) {
  const user = getUser(req);
  const orgId = Number(req.params.orgId);
  if (!Number.isFinite(orgId)) return badRequest(res, "Invalid orgId");
  if (!isOrgAdmin(user, orgId)) return forbidden(res);

  const schema = z.object({
    phoneNumber: z.string().min(8),
    label: z.string().optional(),
    type: z.enum(["inbound", "outbound", "both"]).default("both"),
    provider: z.string().default("msg91"),
    ivrEnabled: z.boolean().default(false),
    ivrConfig: z.record(z.unknown()).optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error.message);

  // verify org exists
  const [org] = await db.select({ id: organizations.id })
    .from(organizations).where(eq(organizations.id, orgId));
  if (!org) return res.status(404).json({ success: false, error: "Organization not found" });

  const [inserted] = await db.insert(orgDIDNumbers).values({
    organizationId: orgId,
    phoneNumber: parsed.data.phoneNumber,
    label: parsed.data.label,
    type: parsed.data.type,
    provider: parsed.data.provider,
    ivrEnabled: parsed.data.ivrEnabled,
    ivrConfig: parsed.data.ivrConfig ?? {},
    isActive: true,
  } as InsertOrgDIDNumber).returning();

  logger.info("B2BAdmin", "Org DID added", { orgId, phoneNumber: parsed.data.phoneNumber });
  return res.status(201).json({ success: true, data: inserted });
}

async function updateOrgDID(req: Request, res: Response) {
  const user = getUser(req);
  const orgId = Number(req.params.orgId);
  const didId = Number(req.params.didId);
  if (!Number.isFinite(orgId) || !Number.isFinite(didId)) return badRequest(res, "Invalid id");
  if (!isOrgAdmin(user, orgId)) return forbidden(res);

  const schema = z.object({
    label: z.string().optional(),
    type: z.enum(["inbound", "outbound", "both"]).optional(),
    isActive: z.boolean().optional(),
    ivrEnabled: z.boolean().optional(),
    ivrConfig: z.record(z.unknown()).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error.message);

  const [updated] = await db.update(orgDIDNumbers)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(orgDIDNumbers.id, didId), eq(orgDIDNumbers.organizationId, orgId)))
    .returning();

  if (!updated) return res.status(404).json({ success: false, error: "DID not found" });
  return res.json({ success: true, data: updated });
}

async function deleteOrgDID(req: Request, res: Response) {
  const user = getUser(req);
  const orgId = Number(req.params.orgId);
  const didId = Number(req.params.didId);
  if (!Number.isFinite(orgId) || !Number.isFinite(didId)) return badRequest(res, "Invalid id");
  if (!isOrgAdmin(user, orgId)) return forbidden(res);

  await db.delete(orgDIDNumbers)
    .where(and(eq(orgDIDNumbers.id, didId), eq(orgDIDNumbers.organizationId, orgId)));

  return res.json({ success: true });
}

// ── org outbound caller ID (shortcut via settings.outboundCallerId) ───────────

async function setOrgOutboundCallerId(req: Request, res: Response) {
  const user = getUser(req);
  const orgId = Number(req.params.orgId);
  if (!Number.isFinite(orgId)) return badRequest(res, "Invalid orgId");
  if (!isOrgAdmin(user, orgId)) return forbidden(res);

  const schema = z.object({
    callerId: z.string().min(8),   // E.164 phone number
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error.message);

  const [org] = await db.select({ id: organizations.id, settings: organizations.settings })
    .from(organizations).where(eq(organizations.id, orgId));
  if (!org) return res.status(404).json({ success: false, error: "Organization not found" });

  const existingSettings = (org.settings as Record<string, unknown>) ?? {};
  const newSettings = { ...existingSettings, outboundCallerId: parsed.data.callerId };

  await db.update(organizations)
    .set({ settings: newSettings })
    .where(eq(organizations.id, orgId));

  logger.info("B2BAdmin", "Org outbound caller ID set", { orgId, callerId: parsed.data.callerId });
  return res.json({ success: true, callerId: parsed.data.callerId });
}

async function setOrgSipTrunk(req: Request, res: Response) {
  const user = getUser(req);
  const orgId = Number(req.params.orgId);
  if (!Number.isFinite(orgId)) return badRequest(res, "Invalid orgId");
  if (!isOrgAdmin(user, orgId)) return forbidden(res);

  const schema = z.object({
    host: z.string().min(3),
    port: z.number().int().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    transport: z.enum(["udp", "tcp", "tls"]).default("tls"),
    enabled: z.boolean().default(true),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error.message);

  const [org] = await db.select({ id: organizations.id, settings: organizations.settings })
    .from(organizations).where(eq(organizations.id, orgId));
  if (!org) return res.status(404).json({ success: false, error: "Organization not found" });

  const existingSettings = (org.settings as Record<string, unknown>) ?? {};
  const sipTrunk = {
    host: parsed.data.host,
    port: parsed.data.port ?? 5060,
    username: parsed.data.username,
    password: parsed.data.password,
    transport: parsed.data.transport,
    enabled: parsed.data.enabled,
  };
  const newSettings = { ...existingSettings, sipTrunk };

  await db.update(organizations)
    .set({ settings: newSettings })
    .where(eq(organizations.id, orgId));

  logger.info("B2BAdmin", "Org SIP trunk configured", { orgId, host: parsed.data.host });
  return res.json({ success: true, sipTrunk });
}

async function getOrgSettings(req: Request, res: Response) {
  const user = getUser(req);
  const orgId = Number(req.params.orgId);
  if (!Number.isFinite(orgId)) return badRequest(res, "Invalid orgId");
  if (!isOrgAdmin(user, orgId)) return forbidden(res);

  const [org] = await db.select({
    id: organizations.id,
    name: organizations.name,
    settings: organizations.settings,
    plan: organizations.plan,
    status: organizations.status,
  }).from(organizations).where(eq(organizations.id, orgId));

  if (!org) return res.status(404).json({ success: false, error: "Organization not found" });

  const settings = (org.settings as Record<string, unknown>) ?? {};
  return res.json({
    success: true,
    data: {
      ...org,
      outboundCallerId: settings.outboundCallerId ?? null,
      sipTrunk: settings.sipTrunk ?? null,
    },
  });
}

// ── agent skills ──────────────────────────────────────────────────────────────

async function listAgentSkills(req: Request, res: Response) {
  const user = getUser(req);
  const orgId = Number(req.params.orgId);
  if (!Number.isFinite(orgId)) return badRequest(res, "Invalid orgId");
  if (!isOrgAdmin(user, orgId)) return forbidden(res);

  const rows = await db.select({
    id: agentSkills.id,
    userId: agentSkills.userId,
    skills: agentSkills.skills,
    maxConcurrentCalls: agentSkills.maxConcurrentCalls,
    isAvailable: agentSkills.isAvailable,
    priority: agentSkills.priority,
    updatedAt: agentSkills.updatedAt,
    userName: users.username,
    userEmail: users.email,
  })
    .from(agentSkills)
    .innerJoin(users, eq(agentSkills.userId, users.id))
    .where(eq(agentSkills.organizationId, orgId));

  return res.json({ success: true, data: rows });
}

async function upsertAgentSkill(req: Request, res: Response) {
  const user = getUser(req);
  const orgId = Number(req.params.orgId);
  const agentUserId = Number(req.params.userId);
  if (!Number.isFinite(orgId) || !Number.isFinite(agentUserId)) return badRequest(res, "Invalid id");
  if (!isOrgAdmin(user, orgId)) return forbidden(res);

  const schema = z.object({
    skills: z.array(z.string()).min(1),
    maxConcurrentCalls: z.number().int().min(1).max(20).default(3),
    isAvailable: z.boolean().default(true),
    priority: z.number().int().min(1).max(10).default(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error.message);

  const existing = await db.select({ id: agentSkills.id })
    .from(agentSkills)
    .where(and(eq(agentSkills.userId, agentUserId), eq(agentSkills.organizationId, orgId)));

  let row;
  if (existing.length > 0) {
    [row] = await db.update(agentSkills)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(and(eq(agentSkills.userId, agentUserId), eq(agentSkills.organizationId, orgId)))
      .returning();
  } else {
    [row] = await db.insert(agentSkills)
      .values({
        userId: agentUserId,
        organizationId: orgId,
        ...parsed.data,
      } as InsertAgentSkill)
      .returning();
  }

  return res.json({ success: true, data: row });
}

async function deleteAgentSkill(req: Request, res: Response) {
  const user = getUser(req);
  const orgId = Number(req.params.orgId);
  const agentUserId = Number(req.params.userId);
  if (!Number.isFinite(orgId) || !Number.isFinite(agentUserId)) return badRequest(res, "Invalid id");
  if (!isOrgAdmin(user, orgId)) return forbidden(res);

  await db.delete(agentSkills)
    .where(and(eq(agentSkills.userId, agentUserId), eq(agentSkills.organizationId, orgId)));

  return res.json({ success: true });
}

// ── routing ───────────────────────────────────────────────────────────────────

export function registerB2BAdminRoutes(app: Express): void {
  // Virtual number pool (super-admin)
  app.get("/api/admin/virtual-numbers", requireAuth, listVirtualNumbers);
  app.post("/api/admin/virtual-numbers", requireAuth, addVirtualNumber);
  app.patch("/api/admin/virtual-numbers/:id/status", requireAuth, updateVirtualNumberStatus);

  // Org settings
  app.get("/api/admin/orgs/:orgId/settings", requireAuth, getOrgSettings);
  app.put("/api/admin/orgs/:orgId/outbound-caller-id", requireAuth, setOrgOutboundCallerId);
  app.put("/api/admin/orgs/:orgId/sip-trunk", requireAuth, setOrgSipTrunk);

  // Org DID numbers
  app.get("/api/admin/orgs/:orgId/dids", requireAuth, listOrgDIDs);
  app.post("/api/admin/orgs/:orgId/dids", requireAuth, addOrgDID);
  app.patch("/api/admin/orgs/:orgId/dids/:didId", requireAuth, updateOrgDID);
  app.delete("/api/admin/orgs/:orgId/dids/:didId", requireAuth, deleteOrgDID);

  // Agent skills
  app.get("/api/admin/orgs/:orgId/agent-skills", requireAuth, listAgentSkills);
  app.put("/api/admin/orgs/:orgId/agent-skills/:userId", requireAuth, upsertAgentSkill);
  app.delete("/api/admin/orgs/:orgId/agent-skills/:userId", requireAuth, deleteAgentSkill);
}
