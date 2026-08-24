/**
 * Business Audiences -- Phase 4 (2026-08-24).
 * See docs/neura-ecosystem/29_BUSINESS_CUSTOMERS_AUDIENCES_IMPLEMENTATION.md.
 *
 * STATIC audiences only. DYNAMIC is a declared-but-rejected type -- no
 * rules/query engine exists (doc 29 section 9); this is the documented
 * extension point, not a fake implementation.
 */
import { db } from "../../db";
import {
  audiences,
  audienceMembers,
  customers,
  organizations,
  AUDIENCE_TYPE,
  AUDIENCE_STATUS,
  CUSTOMER_STATUS,
  type AudienceStatus,
} from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { createAuditLog, AUDIT_ACTION_AUDIENCE } from "./audit";

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function assertValidStatus(status: string): asserts status is AudienceStatus {
  if (!Object.values(AUDIENCE_STATUS).includes(status as AudienceStatus)) {
    throw new ValidationError(`Invalid status: ${status}`);
  }
}

export interface CreateAudienceInput {
  name: string;
  description?: string;
  type?: string;
}

export async function createAudience(businessId: number, actorUserId: number, input: CreateAudienceInput) {
  const [business] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, businessId));
  if (!business) throw new NotFoundError("Business not found");

  const type = input.type ?? AUDIENCE_TYPE.STATIC;
  if (type === AUDIENCE_TYPE.DYNAMIC) {
    throw new ValidationError("Dynamic audiences are not implemented yet -- create a static audience instead");
  }
  if (type !== AUDIENCE_TYPE.STATIC) {
    throw new ValidationError(`Invalid audience type: ${type}`);
  }

  const [existing] = await db.select().from(audiences)
    .where(and(eq(audiences.businessId, businessId), eq(audiences.name, input.name)));
  if (existing) throw new ValidationError(`An audience named "${input.name}" already exists for this business`);

  const [audience] = await db.insert(audiences).values({
    businessId,
    name: input.name,
    description: input.description?.trim() || null,
    type: AUDIENCE_TYPE.STATIC,
    status: AUDIENCE_STATUS.ACTIVE,
    createdBy: actorUserId,
  }).returning();

  await createAuditLog(actorUserId, businessId, AUDIT_ACTION_AUDIENCE.CREATED, audience.id, { name: audience.name });
  return audience;
}

export async function listAudiences(businessId: number, status?: string) {
  const conditions = [eq(audiences.businessId, businessId)];
  if (status) {
    assertValidStatus(status);
    conditions.push(eq(audiences.status, status));
  }
  const rows = await db.select().from(audiences).where(and(...conditions)).orderBy(desc(audiences.createdAt));

  const result = [];
  for (const a of rows) {
    const members = await db.select().from(audienceMembers).where(eq(audienceMembers.audienceId, a.id));
    result.push({ ...a, memberCount: members.length });
  }
  return result;
}

async function getOwnedAudience(businessId: number, audienceId: number) {
  const [a] = await db.select().from(audiences).where(and(eq(audiences.id, audienceId), eq(audiences.businessId, businessId)));
  if (!a) throw new NotFoundError("Audience not found");
  return a;
}

export async function getAudience(businessId: number, audienceId: number) {
  const a = await getOwnedAudience(businessId, audienceId).catch(() => null);
  if (!a) return null;
  const members = await db.select({
    id: audienceMembers.id, customerId: audienceMembers.customerId, addedAt: audienceMembers.addedAt,
  }).from(audienceMembers).where(eq(audienceMembers.audienceId, audienceId));
  return { ...a, members };
}

export interface UpdateAudienceInput {
  name?: string;
  description?: string;
}

export async function updateAudience(businessId: number, actorUserId: number, audienceId: number, input: UpdateAudienceInput) {
  const existing = await getOwnedAudience(businessId, audienceId);
  if (existing.status === AUDIENCE_STATUS.ARCHIVED) {
    throw new ValidationError("Cannot edit an archived audience");
  }

  if (input.name !== undefined && input.name !== existing.name) {
    const [dup] = await db.select().from(audiences)
      .where(and(eq(audiences.businessId, businessId), eq(audiences.name, input.name)));
    if (dup) throw new ValidationError(`An audience named "${input.name}" already exists for this business`);
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description.trim() || null;

  const [updated] = await db.update(audiences).set(patch).where(eq(audiences.id, audienceId)).returning();
  await createAuditLog(actorUserId, businessId, AUDIT_ACTION_AUDIENCE.UPDATED, audienceId, { fields: Object.keys(patch) });
  return updated;
}

export async function archiveAudience(businessId: number, actorUserId: number, audienceId: number) {
  const existing = await getOwnedAudience(businessId, audienceId);
  if (existing.status === AUDIENCE_STATUS.ARCHIVED) {
    throw new ValidationError("Audience is already archived");
  }

  const [updated] = await db.update(audiences).set({
    status: AUDIENCE_STATUS.ARCHIVED,
    archivedBy: actorUserId,
    archivedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(audiences.id, audienceId)).returning();

  await createAuditLog(actorUserId, businessId, AUDIT_ACTION_AUDIENCE.ARCHIVED, audienceId, {});
  return updated;
}

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

export async function addMember(businessId: number, actorUserId: number, audienceId: number, customerId: number) {
  const audience = await getOwnedAudience(businessId, audienceId);
  if (audience.status === AUDIENCE_STATUS.ARCHIVED) {
    throw new ValidationError("Cannot add members to an archived audience");
  }

  const [customer] = await db.select().from(customers).where(and(eq(customers.id, customerId), eq(customers.businessId, businessId)));
  if (!customer) throw new NotFoundError("Customer not found in this business");
  if (customer.status === CUSTOMER_STATUS.ARCHIVED) {
    throw new ValidationError("Cannot add an archived customer to an audience");
  }

  const [existing] = await db.select().from(audienceMembers)
    .where(and(eq(audienceMembers.audienceId, audienceId), eq(audienceMembers.customerId, customerId)));
  if (existing) throw new ValidationError("Customer is already a member of this audience");

  const [member] = await db.insert(audienceMembers).values({
    audienceId, customerId, addedBy: actorUserId,
  }).returning();

  await createAuditLog(actorUserId, businessId, AUDIT_ACTION_AUDIENCE.MEMBER_ADDED, audienceId, { customerId });
  return member;
}

export async function removeMember(businessId: number, actorUserId: number, audienceId: number, customerId: number) {
  await getOwnedAudience(businessId, audienceId);

  const [existing] = await db.select().from(audienceMembers)
    .where(and(eq(audienceMembers.audienceId, audienceId), eq(audienceMembers.customerId, customerId)));
  if (!existing) throw new NotFoundError("Customer is not a member of this audience");

  await db.delete(audienceMembers).where(eq(audienceMembers.id, existing.id));
  await createAuditLog(actorUserId, businessId, AUDIT_ACTION_AUDIENCE.MEMBER_REMOVED, audienceId, { customerId });
}

export async function listMembers(businessId: number, audienceId: number) {
  await getOwnedAudience(businessId, audienceId);
  const memberships = await db.select().from(audienceMembers).where(eq(audienceMembers.audienceId, audienceId));

  const result = [];
  for (const m of memberships) {
    const [customer] = await db.select().from(customers).where(eq(customers.id, m.customerId));
    if (!customer) continue; // defensive -- FK+cascade delete means this shouldn't happen in practice
    result.push({
      membershipId: m.id,
      customerId: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      status: customer.status,
      addedAt: m.addedAt,
    });
  }
  return result;
}
