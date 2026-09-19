import type { Express, Request, Response } from "express";
import { eq, and, desc, asc, isNotNull, sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAuth } from "../../role-middleware";
import {
  departments, branches, teams, teamMembers, businessHours, holidayCalendar,
  ivrMenus, ivrOptions, callQueues, agentPresence, pbxIntegrations,
  supervisorSessions, costCenters, users, organizations, enterpriseNumbers,
  insertDepartmentSchema, insertBranchSchema, insertTeamSchema, insertTeamMemberSchema,
  insertBusinessHoursSchema, insertHolidayCalendarSchema,
  insertIvrMenuSchema, insertIvrOptionSchema,
  insertCallQueueSchema, insertAgentPresenceSchema, insertPbxIntegrationSchema,
  insertCostCenterSchema, insertSupervisorSessionSchema,
} from "@shared/schema";
import { logAuditEvent } from "../../audit-logging";
import { logger } from "../../observability";

function requireOrgAdmin(req: any, res: any, next: any) {
  const role = req.user?.role as string | undefined;
  if (role === "super_admin" || role === "company_admin") return next();
  return res.status(403).json({ error: "Company admin or above required" });
}

const guard = [requireAuth, requireOrgAdmin];

const departmentUpdateSchema = insertDepartmentSchema.omit({ organizationId: true }).partial();
const branchUpdateSchema = insertBranchSchema.omit({ organizationId: true }).partial();
const teamUpdateSchema = insertTeamSchema.omit({ organizationId: true }).partial();
const businessHoursUpdateSchema = insertBusinessHoursSchema.omit({ organizationId: true }).partial();
const ivrMenuUpdateSchema = insertIvrMenuSchema.omit({ organizationId: true }).partial();
const callQueueUpdateSchema = insertCallQueueSchema.omit({ organizationId: true }).partial();
const pbxUpdateSchema = insertPbxIntegrationSchema.omit({ organizationId: true }).partial();
const costCenterUpdateSchema = insertCostCenterSchema.omit({ organizationId: true, currentMonthSpendPaise: true, alertEmailSent: true }).partial();

async function referenceBelongsToOrganization(table: any, id: number, organizationId: number): Promise<boolean> {
  const [row] = await db.select({ organizationId: table.organizationId })
    .from(table)
    .where(eq(table.id, id));
  return row?.organizationId === organizationId;
}

function parseOptionalId(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

async function validateOrganizationReferences(
  req: Request,
  res: Response,
  references: Array<{ table: any; value: unknown; name: string }>,
): Promise<boolean> {
  const organizationId = orgId(req);
  for (const reference of references) {
    if (reference.value === undefined || reference.value === null) continue;
    const id = parseOptionalId(reference.value);
    if (!id || !(await referenceBelongsToOrganization(reference.table, id, organizationId))) {
      res.status(404).json({ error: `${reference.name} not found` });
      return false;
    }
  }
  return true;
}

function orgId(req: Request): number {
  return (req.user as any).organizationId;
}
function actorId(req: Request): number {
  return (req.user as any).id;
}

// ─────────────────── DEPARTMENTS ────────────────────────────────────────────

async function listDepartments(req: Request, res: Response) {
  const rows = await db.select().from(departments)
    .where(eq(departments.organizationId, orgId(req)))
    .orderBy(asc(departments.name));
  res.json(rows);
}

async function createDepartment(req: Request, res: Response) {
  const parsed = insertDepartmentSchema.safeParse({ ...req.body, organizationId: orgId(req) });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const [row] = await db.insert(departments).values(parsed.data).returning();
  await logAuditEvent({ userId: actorId(req), organizationId: orgId(req), action: "admin_action", details: { entity: "department", entityId: row.id, op: "create" } });
  res.status(201).json(row);
}

async function updateDepartment(req: Request, res: Response) {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(departments).where(and(eq(departments.id, id), eq(departments.organizationId, orgId(req))));
  if (!existing) return res.status(404).json({ error: "Not found" });
  const parsed = departmentUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (!await validateOrganizationReferences(req, res, [
    { table: departments, value: parsed.data.parentDepartmentId, name: "Parent department" },
  ])) return;
  const [row] = await db.update(departments).set({ ...parsed.data, updatedAt: new Date() }).where(and(eq(departments.id, id), eq(departments.organizationId, orgId(req)))).returning();
  res.json(row);
}

async function deleteDepartment(req: Request, res: Response) {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(departments).where(and(eq(departments.id, id), eq(departments.organizationId, orgId(req))));
  if (!existing) return res.status(404).json({ error: "Not found" });
  await db.delete(departments).where(and(eq(departments.id, id), eq(departments.organizationId, orgId(req))));
  res.json({ success: true });
}

// ─────────────────── BRANCHES ───────────────────────────────────────────────

async function listBranches(req: Request, res: Response) {
  const rows = await db.select().from(branches)
    .where(eq(branches.organizationId, orgId(req)))
    .orderBy(asc(branches.name));
  res.json(rows);
}

async function createBranch(req: Request, res: Response) {
  const parsed = insertBranchSchema.safeParse({ ...req.body, organizationId: orgId(req) });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const [row] = await db.insert(branches).values(parsed.data).returning();
  await logAuditEvent({ userId: actorId(req), organizationId: orgId(req), action: "admin_action", details: { entity: "branch", entityId: row.id, op: "create" } });
  res.status(201).json(row);
}

async function updateBranch(req: Request, res: Response) {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(branches).where(and(eq(branches.id, id), eq(branches.organizationId, orgId(req))));
  if (!existing) return res.status(404).json({ error: "Not found" });
  const parsed = branchUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const [row] = await db.update(branches).set({ ...parsed.data, updatedAt: new Date() }).where(and(eq(branches.id, id), eq(branches.organizationId, orgId(req)))).returning();
  res.json(row);
}

async function deleteBranch(req: Request, res: Response) {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(branches).where(and(eq(branches.id, id), eq(branches.organizationId, orgId(req))));
  if (!existing) return res.status(404).json({ error: "Not found" });
  await db.delete(branches).where(and(eq(branches.id, id), eq(branches.organizationId, orgId(req))));
  res.json({ success: true });
}

// ─────────────────── TEAMS ──────────────────────────────────────────────────

async function listTeams(req: Request, res: Response) {
  const rows = await db.select().from(teams)
    .where(eq(teams.organizationId, orgId(req)))
    .orderBy(asc(teams.name));
  res.json(rows);
}

async function createTeam(req: Request, res: Response) {
  const parsed = insertTeamSchema.safeParse({ ...req.body, organizationId: orgId(req) });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (!await validateOrganizationReferences(req, res, [
    { table: departments, value: parsed.data.departmentId, name: "Department" },
    { table: branches, value: parsed.data.branchId, name: "Branch" },
  ])) return;
  const [row] = await db.insert(teams).values(parsed.data).returning();
  await logAuditEvent({ userId: actorId(req), organizationId: orgId(req), action: "admin_action", details: { entity: "team", entityId: row.id, op: "create" } });
  res.status(201).json(row);
}

async function updateTeam(req: Request, res: Response) {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(teams).where(and(eq(teams.id, id), eq(teams.organizationId, orgId(req))));
  if (!existing) return res.status(404).json({ error: "Not found" });
  const parsed = teamUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (!await validateOrganizationReferences(req, res, [
    { table: departments, value: parsed.data.departmentId, name: "Department" },
    { table: branches, value: parsed.data.branchId, name: "Branch" },
  ])) return;
  const [row] = await db.update(teams).set({ ...parsed.data, updatedAt: new Date() }).where(and(eq(teams.id, id), eq(teams.organizationId, orgId(req)))).returning();
  res.json(row);
}

async function deleteTeam(req: Request, res: Response) {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(teams).where(and(eq(teams.id, id), eq(teams.organizationId, orgId(req))));
  if (!existing) return res.status(404).json({ error: "Not found" });
  await db.delete(teams).where(and(eq(teams.id, id), eq(teams.organizationId, orgId(req))));
  res.json({ success: true });
}

async function listTeamMembers(req: Request, res: Response) {
  const teamId = parseInt(req.params.teamId);
  if (!await referenceBelongsToOrganization(teams, teamId, orgId(req))) return res.status(404).json({ error: "Team not found" });
  const rows = await db.select({
    id: teamMembers.id, teamId: teamMembers.teamId, userId: teamMembers.userId,
    role: teamMembers.role, joinedAt: teamMembers.joinedAt,
    userName: users.username, userEmail: users.email,
  })
    .from(teamMembers)
    .innerJoin(users, eq(teamMembers.userId, users.id))
    .where(eq(teamMembers.teamId, teamId));
  res.json(rows);
}

async function addTeamMember(req: Request, res: Response) {
  const teamId = parseInt(req.params.teamId);
  if (!await referenceBelongsToOrganization(teams, teamId, orgId(req))) return res.status(404).json({ error: "Team not found" });
  const parsed = insertTeamMemberSchema.safeParse({ ...req.body, teamId });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const [member] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, parsed.data.userId), eq(users.organizationId, orgId(req))));
  if (!member) return res.status(404).json({ error: "User not found" });
  const [row] = await db.insert(teamMembers).values(parsed.data).onConflictDoNothing().returning();
  res.status(201).json(row ?? { message: "Already a member" });
}

async function removeTeamMember(req: Request, res: Response) {
  const teamId = parseInt(req.params.teamId);
  const userId = parseInt(req.params.userId);
  if (!await referenceBelongsToOrganization(teams, teamId, orgId(req))) return res.status(404).json({ error: "Team not found" });
  const [member] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.organizationId, orgId(req))));
  if (!member) return res.status(404).json({ error: "User not found" });
  await db.delete(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
  res.json({ success: true });
}

// ─────────────────── BUSINESS HOURS ─────────────────────────────────────────

async function listBusinessHours(req: Request, res: Response) {
  const rows = await db.select().from(businessHours)
    .where(eq(businessHours.organizationId, orgId(req)))
    .orderBy(asc(businessHours.name));
  res.json(rows);
}

async function createBusinessHours(req: Request, res: Response) {
  const parsed = insertBusinessHoursSchema.safeParse({ ...req.body, organizationId: orgId(req) });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (!await validateOrganizationReferences(req, res, [
    { table: branches, value: parsed.data.branchId, name: "Branch" },
    { table: enterpriseNumbers, value: parsed.data.enterpriseNumberId, name: "Enterprise number" },
  ])) return;
  const [row] = await db.insert(businessHours).values(parsed.data).returning();
  res.status(201).json(row);
}

async function updateBusinessHours(req: Request, res: Response) {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(businessHours).where(and(eq(businessHours.id, id), eq(businessHours.organizationId, orgId(req))));
  if (!existing) return res.status(404).json({ error: "Not found" });
  const parsed = businessHoursUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (!await validateOrganizationReferences(req, res, [
    { table: branches, value: parsed.data.branchId, name: "Branch" },
    { table: enterpriseNumbers, value: parsed.data.enterpriseNumberId, name: "Enterprise number" },
  ])) return;
  const [row] = await db.update(businessHours).set({ ...parsed.data, updatedAt: new Date() }).where(and(eq(businessHours.id, id), eq(businessHours.organizationId, orgId(req)))).returning();
  res.json(row);
}

async function deleteBusinessHours(req: Request, res: Response) {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(businessHours).where(and(eq(businessHours.id, id), eq(businessHours.organizationId, orgId(req))));
  if (!existing) return res.status(404).json({ error: "Not found" });
  await db.delete(businessHours).where(and(eq(businessHours.id, id), eq(businessHours.organizationId, orgId(req))));
  res.json({ success: true });
}

// ─────────────────── HOLIDAYS ───────────────────────────────────────────────

async function listHolidays(req: Request, res: Response) {
  const rows = await db.select().from(holidayCalendar)
    .where(eq(holidayCalendar.organizationId, orgId(req)))
    .orderBy(asc(holidayCalendar.date));
  res.json(rows);
}

async function createHoliday(req: Request, res: Response) {
  const parsed = insertHolidayCalendarSchema.safeParse({ ...req.body, organizationId: orgId(req) });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (!await validateOrganizationReferences(req, res, [
    { table: branches, value: parsed.data.branchId, name: "Branch" },
  ])) return;
  const [row] = await db.insert(holidayCalendar).values(parsed.data).returning();
  res.status(201).json(row);
}

async function deleteHoliday(req: Request, res: Response) {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(holidayCalendar).where(and(eq(holidayCalendar.id, id), eq(holidayCalendar.organizationId, orgId(req))));
  if (!existing) return res.status(404).json({ error: "Not found" });
  await db.delete(holidayCalendar).where(and(eq(holidayCalendar.id, id), eq(holidayCalendar.organizationId, orgId(req))));
  res.json({ success: true });
}

// ─────────────────── IVR MENUS ──────────────────────────────────────────────

async function listIvrMenus(req: Request, res: Response) {
  const rows = await db.select().from(ivrMenus)
    .where(eq(ivrMenus.organizationId, orgId(req)))
    .orderBy(asc(ivrMenus.name));
  res.json(rows);
}

async function createIvrMenu(req: Request, res: Response) {
  const parsed = insertIvrMenuSchema.safeParse({ ...req.body, organizationId: orgId(req) });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (!await validateOrganizationReferences(req, res, [
    { table: enterpriseNumbers, value: parsed.data.enterpriseNumberId, name: "Enterprise number" },
  ])) return;
  const [row] = await db.insert(ivrMenus).values(parsed.data).returning();
  res.status(201).json(row);
}

async function updateIvrMenu(req: Request, res: Response) {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(ivrMenus).where(and(eq(ivrMenus.id, id), eq(ivrMenus.organizationId, orgId(req))));
  if (!existing) return res.status(404).json({ error: "Not found" });
  const parsed = ivrMenuUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (!await validateOrganizationReferences(req, res, [
    { table: enterpriseNumbers, value: parsed.data.enterpriseNumberId, name: "Enterprise number" },
  ])) return;
  const [row] = await db.update(ivrMenus).set({ ...parsed.data, updatedAt: new Date() }).where(and(eq(ivrMenus.id, id), eq(ivrMenus.organizationId, orgId(req)))).returning();
  res.json(row);
}

async function deleteIvrMenu(req: Request, res: Response) {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(ivrMenus).where(and(eq(ivrMenus.id, id), eq(ivrMenus.organizationId, orgId(req))));
  if (!existing) return res.status(404).json({ error: "Not found" });
  await db.delete(ivrMenus).where(and(eq(ivrMenus.id, id), eq(ivrMenus.organizationId, orgId(req))));
  res.json({ success: true });
}

async function listIvrOptions(req: Request, res: Response) {
  const menuId = parseInt(req.params.menuId);
  if (!await referenceBelongsToOrganization(ivrMenus, menuId, orgId(req))) return res.status(404).json({ error: "IVR menu not found" });
  const rows = await db.select().from(ivrOptions)
    .where(eq(ivrOptions.menuId, menuId))
    .orderBy(asc(ivrOptions.displayOrder));
  res.json(rows);
}

async function createIvrOption(req: Request, res: Response) {
  const menuId = parseInt(req.params.menuId);
  if (!await referenceBelongsToOrganization(ivrMenus, menuId, orgId(req))) return res.status(404).json({ error: "IVR menu not found" });
  const parsed = insertIvrOptionSchema.safeParse({ ...req.body, menuId });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const [row] = await db.insert(ivrOptions).values(parsed.data).returning();
  res.status(201).json(row);
}

async function deleteIvrOption(req: Request, res: Response) {
  const id = parseInt(req.params.optionId);
  const [option] = await db.select({ menuId: ivrOptions.menuId }).from(ivrOptions).where(eq(ivrOptions.id, id));
  if (!option || !await referenceBelongsToOrganization(ivrMenus, option.menuId, orgId(req))) return res.status(404).json({ error: "IVR option not found" });
  await db.delete(ivrOptions).where(eq(ivrOptions.id, id));
  res.json({ success: true });
}

// ─────────────────── CALL QUEUES ────────────────────────────────────────────

async function listCallQueues(req: Request, res: Response) {
  const rows = await db.select().from(callQueues)
    .where(eq(callQueues.organizationId, orgId(req)))
    .orderBy(asc(callQueues.name));
  res.json(rows);
}

async function createCallQueue(req: Request, res: Response) {
  const parsed = insertCallQueueSchema.safeParse({ ...req.body, organizationId: orgId(req) });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (!await validateOrganizationReferences(req, res, [
    { table: teams, value: parsed.data.teamId, name: "Team" },
  ])) return;
  const [row] = await db.insert(callQueues).values(parsed.data).returning();
  res.status(201).json(row);
}

async function updateCallQueue(req: Request, res: Response) {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(callQueues).where(and(eq(callQueues.id, id), eq(callQueues.organizationId, orgId(req))));
  if (!existing) return res.status(404).json({ error: "Not found" });
  const parsed = callQueueUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (!await validateOrganizationReferences(req, res, [
    { table: teams, value: parsed.data.teamId, name: "Team" },
  ])) return;
  const [row] = await db.update(callQueues).set({ ...parsed.data, updatedAt: new Date() }).where(and(eq(callQueues.id, id), eq(callQueues.organizationId, orgId(req)))).returning();
  res.json(row);
}

async function deleteCallQueue(req: Request, res: Response) {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(callQueues).where(and(eq(callQueues.id, id), eq(callQueues.organizationId, orgId(req))));
  if (!existing) return res.status(404).json({ error: "Not found" });
  await db.delete(callQueues).where(and(eq(callQueues.id, id), eq(callQueues.organizationId, orgId(req))));
  res.json({ success: true });
}

// ─────────────────── AGENT PRESENCE ─────────────────────────────────────────

async function getOrgPresence(req: Request, res: Response) {
  const rows = await db.select({
    id: agentPresence.id, userId: agentPresence.userId, status: agentPresence.status,
    statusMessage: agentPresence.statusMessage, currentCallId: agentPresence.currentCallId,
    queueId: agentPresence.queueId, teamId: agentPresence.teamId,
    lastStatusChangeAt: agentPresence.lastStatusChangeAt, lastHeartbeatAt: agentPresence.lastHeartbeatAt,
    userName: users.username, userEmail: users.email, avatarUrl: users.avatarUrl,
  })
    .from(agentPresence)
    .innerJoin(users, eq(agentPresence.userId, users.id))
    .where(eq(agentPresence.organizationId, orgId(req)));
  res.json(rows);
}

async function updateMyPresence(req: Request, res: Response) {
  const userId = actorId(req);
  const oId = orgId(req);
  const { status, statusMessage, queueId, teamId } = req.body;
  const allowed = ["online", "available", "busy", "away", "break", "dnd", "offline"];
  if (!allowed.includes(status)) return res.status(400).json({ error: "Invalid status" });
  if (!await validateOrganizationReferences(req, res, [
    { table: callQueues, value: queueId, name: "Queue" },
    { table: teams, value: teamId, name: "Team" },
  ])) return;

  const [row] = await db.insert(agentPresence)
    .values({ userId, organizationId: oId, status, statusMessage, queueId, teamId, lastStatusChangeAt: new Date(), lastHeartbeatAt: new Date() })
    .onConflictDoUpdate({
      target: agentPresence.userId,
      set: { status, statusMessage, queueId, teamId, organizationId: oId, lastStatusChangeAt: new Date(), lastHeartbeatAt: new Date(), updatedAt: new Date() },
    })
    .returning();

  // Real ACD queue: the moment an agent becomes available, try to hand
  // them the oldest waiting call they're skilled for (queue-service.ts).
  // Fire-and-forget — presence update must not block/fail on queue lookup.
  if (status === "available") {
    const { tryAssignQueuedCallToAgent } = await import("../calls/queue-service");
    void tryAssignQueuedCallToAgent(oId, userId).catch((err: unknown) => {
      logger.warn("EnterpriseAdmin", `queue assignment check failed for agent ${userId}: ${String(err)}`);
    });
  }

  res.json(row);
}

async function heartbeat(req: Request, res: Response) {
  await db.update(agentPresence)
    .set({ lastHeartbeatAt: new Date(), updatedAt: new Date() })
    .where(and(eq(agentPresence.userId, actorId(req)), eq(agentPresence.organizationId, orgId(req))));
  res.json({ ok: true });
}

// ─────────────────── PBX INTEGRATIONS ───────────────────────────────────────

async function listPbxIntegrations(req: Request, res: Response) {
  const rows = await db.select().from(pbxIntegrations)
    .where(eq(pbxIntegrations.organizationId, orgId(req)))
    .orderBy(asc(pbxIntegrations.name));
  // Mask passwords before sending
  res.json(rows.map(r => ({ ...r, password: r.password ? "••••••••" : null, apiKey: r.apiKey ? "••••••••" : null })));
}

async function createPbxIntegration(req: Request, res: Response) {
  const parsed = insertPbxIntegrationSchema.safeParse({ ...req.body, organizationId: orgId(req) });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const [row] = await db.insert(pbxIntegrations).values(parsed.data).returning();
  await logAuditEvent({ userId: actorId(req), organizationId: orgId(req), action: "admin_action", details: { entity: "pbx_integration", entityId: row.id, op: "create" } });
  res.status(201).json({ ...row, password: row.password ? "••••••••" : null, apiKey: row.apiKey ? "••••••••" : null });
}

async function updatePbxIntegration(req: Request, res: Response) {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(pbxIntegrations).where(and(eq(pbxIntegrations.id, id), eq(pbxIntegrations.organizationId, orgId(req))));
  if (!existing) return res.status(404).json({ error: "Not found" });
  const parsed = pbxUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const update: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
  if (update.password === "••••••••") delete update.password;
  if (update.apiKey === "••••••••") delete update.apiKey;
  const [row] = await db.update(pbxIntegrations).set(update).where(and(eq(pbxIntegrations.id, id), eq(pbxIntegrations.organizationId, orgId(req)))).returning();
  res.json({ ...row, password: row.password ? "••••••••" : null, apiKey: row.apiKey ? "••••••••" : null });
}

async function deletePbxIntegration(req: Request, res: Response) {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(pbxIntegrations).where(and(eq(pbxIntegrations.id, id), eq(pbxIntegrations.organizationId, orgId(req))));
  if (!existing) return res.status(404).json({ error: "Not found" });
  await db.delete(pbxIntegrations).where(and(eq(pbxIntegrations.id, id), eq(pbxIntegrations.organizationId, orgId(req))));
  res.json({ success: true });
}

async function testPbxConnection(req: Request, res: Response) {
  const id = parseInt(req.params.id);
  const [pbx] = await db.select().from(pbxIntegrations).where(and(eq(pbxIntegrations.id, id), eq(pbxIntegrations.organizationId, orgId(req))));
  if (!pbx) return res.status(404).json({ error: "Not found" });

  // Mark as checking
  await db.update(pbxIntegrations).set({ connectionStatus: "unknown", lastCheckedAt: new Date() }).where(and(eq(pbxIntegrations.id, id), eq(pbxIntegrations.organizationId, orgId(req))));

  // Attempt a basic TCP port check
  const net = await import("net");
  const socket = new net.Socket();
  const host = pbx.host;
  const port = pbx.port ?? 5060;
  let connected = false;

  const result = await new Promise<{ success: boolean; message: string }>((resolve) => {
    socket.setTimeout(5000);
    socket.connect(port, host, () => {
      connected = true;
      socket.destroy();
      resolve({ success: true, message: `TCP connection to ${host}:${port} succeeded` });
    });
    socket.on("timeout", () => { socket.destroy(); resolve({ success: false, message: `Timeout connecting to ${host}:${port}` }); });
    socket.on("error", (err) => { resolve({ success: false, message: `Connection error: ${err.message}` }); });
  });

  const status = result.success ? "connected" : "disconnected";
  await db.update(pbxIntegrations).set({ connectionStatus: status, lastCheckedAt: new Date() }).where(and(eq(pbxIntegrations.id, id), eq(pbxIntegrations.organizationId, orgId(req))));

  res.json(result);
}

// ─────────────────── COST CENTERS ───────────────────────────────────────────

async function listCostCenters(req: Request, res: Response) {
  const rows = await db.select().from(costCenters)
    .where(eq(costCenters.organizationId, orgId(req)))
    .orderBy(asc(costCenters.name));
  res.json(rows);
}

async function createCostCenter(req: Request, res: Response) {
  const parsed = insertCostCenterSchema.safeParse({ ...req.body, organizationId: orgId(req) });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (!await validateOrganizationReferences(req, res, [
    { table: departments, value: parsed.data.departmentId, name: "Department" },
  ])) return;
  const [row] = await db.insert(costCenters).values(parsed.data).returning();
  res.status(201).json(row);
}

async function updateCostCenter(req: Request, res: Response) {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(costCenters).where(and(eq(costCenters.id, id), eq(costCenters.organizationId, orgId(req))));
  if (!existing) return res.status(404).json({ error: "Not found" });
  const parsed = costCenterUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (!await validateOrganizationReferences(req, res, [
    { table: departments, value: parsed.data.departmentId, name: "Department" },
  ])) return;
  const [row] = await db.update(costCenters).set({ ...parsed.data, updatedAt: new Date() }).where(and(eq(costCenters.id, id), eq(costCenters.organizationId, orgId(req)))).returning();
  res.json(row);
}

async function deleteCostCenter(req: Request, res: Response) {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(costCenters).where(and(eq(costCenters.id, id), eq(costCenters.organizationId, orgId(req))));
  if (!existing) return res.status(404).json({ error: "Not found" });
  await db.delete(costCenters).where(and(eq(costCenters.id, id), eq(costCenters.organizationId, orgId(req))));
  res.json({ success: true });
}

// ─────────────────── SUPERVISOR MONITOR ─────────────────────────────────────

function requireSupervisorOrAdmin(req: any, res: any, next: any) {
  const role = req.user?.role as string | undefined;
  if (role === "super_admin" || role === "company_admin" || role === "supervisor") return next();
  return res.status(403).json({ error: "Supervisor or admin required" });
}

const supervisorGuard = [requireAuth, requireSupervisorOrAdmin];

async function getActiveCalls(req: Request, res: Response) {
  // Return agents currently on a call for this org
  const rows = await db
    .select({
      agentPresenceId: agentPresence.id,
      userId: agentPresence.userId,
      userName: users.username,
      callId: agentPresence.currentCallId,
      status: agentPresence.status,
      lastHeartbeatAt: agentPresence.lastHeartbeatAt,
    })
    .from(agentPresence)
    .leftJoin(users, eq(agentPresence.userId, users.id))
    .where(
      and(
        eq(agentPresence.organizationId, orgId(req)),
        isNotNull(agentPresence.currentCallId),
      ),
    );
  res.json(rows);
}

async function listSupervisorSessions(req: Request, res: Response) {
  const rows = await db
    .select()
    .from(supervisorSessions)
    .where(eq(supervisorSessions.organizationId, orgId(req)))
    .orderBy(desc(supervisorSessions.startedAt))
    .limit(100);
  res.json(rows);
}

async function startSupervisorSession(req: Request, res: Response) {
  const { callId, agentId, mode } = req.body;
  if (!callId || !agentId || !["listen", "whisper", "barge"].includes(mode)) {
    return res.status(400).json({ error: "callId, agentId, and mode (listen|whisper|barge) are required" });
  }

  // Verify the agent belongs to this org and is on the call
  const [agent] = await db
    .select()
    .from(agentPresence)
    .where(
      and(
        eq(agentPresence.organizationId, orgId(req)),
        eq(agentPresence.userId, parseInt(agentId)),
        eq(agentPresence.currentCallId, callId),
      ),
    );
  if (!agent) {
    return res.status(404).json({ error: "Agent not found or not on this call" });
  }

  // Issue LiveKit token for supervisor if LiveKit is configured
  let livekitToken: string | null = null;
  try {
    const { issueAccessToken } = await import("../../livekit-service");
    const supervisorUser = req.user as { id: number; name?: string; email?: string };
    const supervisorName = supervisorUser.name || supervisorUser.email || `supervisor-${supervisorUser.id}`;
    livekitToken = await issueAccessToken(callId, {
      userId: `supervisor-${supervisorUser.id}`,
      displayName: supervisorName,
      language: "en",
      role: "caller",
      translationMode: "off",
    });
  } catch {
    // LiveKit not configured — record session without token
  }

  const [session] = await db
    .insert(supervisorSessions)
    .values({
      supervisorId: actorId(req),
      organizationId: orgId(req),
      agentId: parseInt(agentId),
      callId,
      mode,
      livekitRoomName: callId,
      metadata: livekitToken ? { livekitToken } : {},
    })
    .returning();

  await logAuditEvent({
    userId: actorId(req),
    organizationId: orgId(req),
    action: "admin_action",
    details: { entity: "supervisor_session", entityId: session.id, op: "start", mode, callId },
  });

  res.status(201).json({ ...session, livekitToken });
}

async function changeSupervisorMode(req: Request, res: Response) {
  const id = parseInt(req.params.id);
  const { mode } = req.body;
  if (!["listen", "whisper", "barge"].includes(mode)) {
    return res.status(400).json({ error: "mode must be listen|whisper|barge" });
  }

  const [existing] = await db
    .select()
    .from(supervisorSessions)
    .where(and(eq(supervisorSessions.id, id), eq(supervisorSessions.supervisorId, actorId(req))));
  if (!existing) return res.status(404).json({ error: "Session not found" });
  if (existing.endedAt) return res.status(409).json({ error: "Session already ended" });

  const [updated] = await db
    .update(supervisorSessions)
    .set({ mode })
    .where(eq(supervisorSessions.id, id))
    .returning();

  res.json(updated);
}

async function endSupervisorSession(req: Request, res: Response) {
  const id = parseInt(req.params.id);
  const [existing] = await db
    .select()
    .from(supervisorSessions)
    .where(and(eq(supervisorSessions.id, id), eq(supervisorSessions.supervisorId, actorId(req))));
  if (!existing) return res.status(404).json({ error: "Session not found" });

  const [ended] = await db
    .update(supervisorSessions)
    .set({ endedAt: new Date() })
    .where(eq(supervisorSessions.id, id))
    .returning();

  res.json(ended);
}

// ─────────────────── REGISTER ───────────────────────────────────────────────

export function registerEnterpriseAdminRoutes(app: Express) {
  // Departments
  app.get("/api/enterprise/departments", ...guard, listDepartments);
  app.post("/api/enterprise/departments", ...guard, createDepartment);
  app.patch("/api/enterprise/departments/:id", ...guard, updateDepartment);
  app.delete("/api/enterprise/departments/:id", ...guard, deleteDepartment);

  // Branches
  app.get("/api/enterprise/branches", ...guard, listBranches);
  app.post("/api/enterprise/branches", ...guard, createBranch);
  app.patch("/api/enterprise/branches/:id", ...guard, updateBranch);
  app.delete("/api/enterprise/branches/:id", ...guard, deleteBranch);

  // Teams
  app.get("/api/enterprise/teams", ...guard, listTeams);
  app.post("/api/enterprise/teams", ...guard, createTeam);
  app.patch("/api/enterprise/teams/:id", ...guard, updateTeam);
  app.delete("/api/enterprise/teams/:id", ...guard, deleteTeam);
  app.get("/api/enterprise/teams/:teamId/members", ...guard, listTeamMembers);
  app.post("/api/enterprise/teams/:teamId/members", ...guard, addTeamMember);
  app.delete("/api/enterprise/teams/:teamId/members/:userId", ...guard, removeTeamMember);

  // Business Hours
  app.get("/api/enterprise/business-hours", ...guard, listBusinessHours);
  app.post("/api/enterprise/business-hours", ...guard, createBusinessHours);
  app.patch("/api/enterprise/business-hours/:id", ...guard, updateBusinessHours);
  app.delete("/api/enterprise/business-hours/:id", ...guard, deleteBusinessHours);

  // Holidays
  app.get("/api/enterprise/holidays", ...guard, listHolidays);
  app.post("/api/enterprise/holidays", ...guard, createHoliday);
  app.delete("/api/enterprise/holidays/:id", ...guard, deleteHoliday);

  // IVR
  app.get("/api/enterprise/ivr", ...guard, listIvrMenus);
  app.post("/api/enterprise/ivr", ...guard, createIvrMenu);
  app.patch("/api/enterprise/ivr/:id", ...guard, updateIvrMenu);
  app.delete("/api/enterprise/ivr/:id", ...guard, deleteIvrMenu);
  app.get("/api/enterprise/ivr/:menuId/options", ...guard, listIvrOptions);
  app.post("/api/enterprise/ivr/:menuId/options", ...guard, createIvrOption);
  app.delete("/api/enterprise/ivr/:menuId/options/:optionId", ...guard, deleteIvrOption);

  // Call Queues
  app.get("/api/enterprise/call-queues", ...guard, listCallQueues);
  app.post("/api/enterprise/call-queues", ...guard, createCallQueue);
  app.patch("/api/enterprise/call-queues/:id", ...guard, updateCallQueue);
  app.delete("/api/enterprise/call-queues/:id", ...guard, deleteCallQueue);

  // Agent Presence (any authenticated user can update own; admins see all)
  app.get("/api/enterprise/presence", requireAuth, getOrgPresence);
  app.post("/api/enterprise/presence", requireAuth, updateMyPresence);
  app.post("/api/enterprise/presence/heartbeat", requireAuth, heartbeat);

  // PBX Integrations
  app.get("/api/enterprise/pbx", ...guard, listPbxIntegrations);
  app.post("/api/enterprise/pbx", ...guard, createPbxIntegration);
  app.patch("/api/enterprise/pbx/:id", ...guard, updatePbxIntegration);
  app.delete("/api/enterprise/pbx/:id", ...guard, deletePbxIntegration);
  app.post("/api/enterprise/pbx/:id/test", ...guard, testPbxConnection);

  // Cost Centers
  app.get("/api/enterprise/cost-centers", ...guard, listCostCenters);
  app.post("/api/enterprise/cost-centers", ...guard, createCostCenter);
  app.patch("/api/enterprise/cost-centers/:id", ...guard, updateCostCenter);
  app.delete("/api/enterprise/cost-centers/:id", ...guard, deleteCostCenter);

  // Supervisor Monitor / Whisper / Barge
  app.get("/api/enterprise/supervisor/active-calls", ...supervisorGuard, getActiveCalls);
  app.get("/api/enterprise/supervisor/sessions", ...supervisorGuard, listSupervisorSessions);
  app.post("/api/enterprise/supervisor/sessions", ...supervisorGuard, startSupervisorSession);
  app.patch("/api/enterprise/supervisor/sessions/:id/mode", ...supervisorGuard, changeSupervisorMode);
  app.delete("/api/enterprise/supervisor/sessions/:id", ...supervisorGuard, endSupervisorSession);
}
