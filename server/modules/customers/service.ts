/**
 * Business Customers -- Phase 4 (2026-08-24).
 * See docs/neura-ecosystem/29_BUSINESS_CUSTOMERS_AUDIENCES_IMPLEMENTATION.md.
 *
 * Recipient FOUNDATION only -- no campaign/OTP/utility/marketing sending
 * lives here. A business customer is NOT a NEURA login; `linkedUserId` is an
 * optional pointer to one, never a requirement, and this module never
 * mutates the `users` table.
 */
import { db } from "../../db";
import {
  customers,
  customerConsents,
  organizations,
  users,
  CUSTOMER_STATUS,
  CUSTOMER_SOURCE,
  CUSTOMER_CONSENT_CHANNEL,
  CUSTOMER_CONSENT_STATUS,
  type CustomerStatus,
  type CustomerConsentChannel,
} from "@shared/schema";
import { eq, and, desc, or, ilike } from "drizzle-orm";
import { normalizePhoneForIndia } from "@shared/phone";
import { normalizeEmail } from "@shared/email";
import { createAuditLog, AUDIT_ACTION_CUSTOMER } from "./audit";
import { logger } from "../../observability";

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
// Deterministic conflict result for a duplicate phone/email/externalRef
// within the same business -- never silently merged (doc 29 section 4).
export class DuplicateCustomerError extends Error {
  constructor(message: string, public readonly existingCustomerId: number) {
    super(message);
    this.name = "DuplicateCustomerError";
  }
}

type DbLike = Pick<typeof db, "select" | "update" | "insert">;

function assertValidStatus(status: string): asserts status is CustomerStatus {
  if (!Object.values(CUSTOMER_STATUS).includes(status as CustomerStatus)) {
    throw new ValidationError(`Invalid status: ${status}`);
  }
}

export interface CreateCustomerInput {
  name?: string;
  phone?: string;
  email?: string;
  externalRef?: string;
  notes?: string;
  linkedUserId?: number;
  source?: string;
}

/** Checks for an existing customer in this business matching normalized phone/email/externalRef. Returns the first match, or null. */
async function findDuplicate(businessId: number, normalizedPhone: string, normalizedEmail: string, externalRef: string, dbClient: DbLike = db) {
  const conditions = [];
  if (normalizedPhone) conditions.push(eq(customers.normalizedPhone, normalizedPhone));
  if (normalizedEmail) conditions.push(eq(customers.normalizedEmail, normalizedEmail));
  if (externalRef) conditions.push(eq(customers.externalRef, externalRef));
  if (conditions.length === 0) return null;

  const [existing] = await dbClient.select().from(customers)
    .where(and(eq(customers.businessId, businessId), or(...conditions)));
  return existing ?? null;
}

export async function createCustomer(businessId: number, actorUserId: number, input: CreateCustomerInput) {
  const [business] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, businessId));
  if (!business) throw new NotFoundError("Business not found");

  if (!input.name?.trim() && !input.phone?.trim() && !input.email?.trim()) {
    throw new ValidationError("At least one of name, phone, or email is required");
  }

  const normalizedPhone = input.phone ? normalizePhoneForIndia(input.phone) : "";
  const normalizedEmailValue = input.email ? normalizeEmail(input.email) : "";
  const externalRef = input.externalRef?.trim() ?? "";
  const source = input.source ?? CUSTOMER_SOURCE.MANUAL;
  if (!Object.values(CUSTOMER_SOURCE).includes(source as any)) {
    throw new ValidationError(`Invalid source: ${source}`);
  }

  const duplicate = await findDuplicate(businessId, normalizedPhone, normalizedEmailValue, externalRef);
  if (duplicate) {
    throw new DuplicateCustomerError(
      `A customer already exists in this business matching this phone/email/external reference`,
      duplicate.id,
    );
  }

  const [customer] = await db.insert(customers).values({
    businessId,
    linkedUserId: input.linkedUserId ?? null,
    name: input.name?.trim() || null,
    phone: input.phone?.trim() || null,
    normalizedPhone: normalizedPhone || null,
    email: input.email?.trim() || null,
    normalizedEmail: normalizedEmailValue || null,
    externalRef: externalRef || null,
    notes: input.notes?.trim() || null,
    status: CUSTOMER_STATUS.ACTIVE,
    source,
    createdBy: actorUserId,
  }).returning();

  await createAuditLog(actorUserId, businessId, AUDIT_ACTION_CUSTOMER.CREATED, customer.id, {
    name: customer.name, source: customer.source,
  });

  return customer;
}

/**
 * P1-1 (2026-08-25): resolves the customer record for a REAL NeuraTalk user
 * contacting a business themselves, keyed by (businessId, linkedUserId) --
 * deliberately NOT the phone/email/externalRef dedup createCustomer() uses,
 * because a user-initiated contact usually has no phone/email on file with
 * this business at all, and reusing that dedup here would either miss the
 * common case or risk colliding with the customers table's own unique
 * indexes on normalizedPhone/normalizedEmail if we tried to populate them
 * from the user's profile. A business's separately, manually-entered
 * customer row for the same real person (phone/email match, linkedUserId
 * still null) is NOT reconciled here -- that is a product decision (should
 * it auto-link at all, and is that itself a consent question) left for a
 * later phase, not decided unilaterally in this one.
 *
 * Accepts an optional tx so the caller (messaging/service.ts's
 * sendUserInitiatedMessage) can compose this inside its own transaction,
 * same DbLike convention used elsewhere in this codebase (e.g.
 * messaging/service.ts's createBusinessConversationTx). The check-then-
 * insert has a narrow residual race (two literally-simultaneous first
 * messages from the same never-before-seen user to the same business could
 * both pass the "not found" check) since there is no unique DB constraint
 * on (businessId, linkedUserId) to catch it -- adding one would be a schema
 * migration, out of scope for this change. Flagged here rather than
 * silently assumed safe.
 */
export async function findOrCreateCustomerByLinkedUser(
  businessId: number,
  userId: number,
  dbClient: DbLike = db,
): Promise<typeof customers.$inferSelect> {
  const [existing] = await dbClient.select().from(customers)
    .where(and(eq(customers.businessId, businessId), eq(customers.linkedUserId, userId)));
  if (existing) return existing;

  const [business] = await dbClient.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, businessId));
  if (!business) throw new NotFoundError("Business not found");

  const [user] = await dbClient.select({ id: users.id, username: users.username }).from(users).where(eq(users.id, userId));
  if (!user) throw new NotFoundError("User not found");

  const [customer] = await dbClient.insert(customers).values({
    businessId,
    linkedUserId: userId,
    name: user.username || null,
    status: CUSTOMER_STATUS.ACTIVE,
    source: CUSTOMER_SOURCE.MANUAL,
    createdBy: userId,
  }).returning();

  await createAuditLog(userId, businessId, AUDIT_ACTION_CUSTOMER.CREATED, customer.id, {
    name: customer.name, source: customer.source, userInitiated: true,
  });

  return customer;
}

export interface ListCustomersOptions {
  search?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export async function listCustomers(businessId: number, options: ListCustomersOptions = {}) {
  const conditions = [eq(customers.businessId, businessId)];
  if (options.status) {
    assertValidStatus(options.status);
    conditions.push(eq(customers.status, options.status));
  }
  if (options.search?.trim()) {
    const term = `%${options.search.trim()}%`;
    conditions.push(
      or(
        ilike(customers.name, term),
        ilike(customers.phone, term),
        ilike(customers.email, term),
        ilike(customers.externalRef, term),
      )!,
    );
  }

  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);

  return db.select().from(customers).where(and(...conditions))
    .orderBy(desc(customers.createdAt)).limit(limit).offset(offset);
}

export async function getCustomer(businessId: number, customerId: number) {
  const [c] = await db.select().from(customers).where(and(eq(customers.id, customerId), eq(customers.businessId, businessId)));
  return c ?? null;
}

async function getOwnedCustomer(businessId: number, customerId: number, dbClient: DbLike = db) {
  const [c] = await dbClient.select().from(customers).where(and(eq(customers.id, customerId), eq(customers.businessId, businessId)));
  if (!c) throw new NotFoundError("Customer not found");
  return c;
}

export interface UpdateCustomerInput {
  name?: string;
  phone?: string;
  email?: string;
  externalRef?: string;
  notes?: string;
  status?: string; // ACTIVE <-> BLOCKED only -- archiving goes through archiveCustomer
}

export async function updateCustomer(businessId: number, actorUserId: number, customerId: number, input: UpdateCustomerInput) {
  const existing = await getOwnedCustomer(businessId, customerId);
  if (existing.status === CUSTOMER_STATUS.ARCHIVED) {
    throw new ValidationError("Cannot edit an archived customer");
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };

  if (input.name !== undefined) patch.name = input.name.trim() || null;
  if (input.notes !== undefined) patch.notes = input.notes.trim() || null;

  let normalizedPhone = existing.normalizedPhone;
  let normalizedEmailValue = existing.normalizedEmail;
  let externalRef = existing.externalRef;

  if (input.phone !== undefined) {
    patch.phone = input.phone.trim() || null;
    normalizedPhone = input.phone.trim() ? normalizePhoneForIndia(input.phone) : null;
    patch.normalizedPhone = normalizedPhone;
  }
  if (input.email !== undefined) {
    patch.email = input.email.trim() || null;
    normalizedEmailValue = input.email.trim() ? normalizeEmail(input.email) : null;
    patch.normalizedEmail = normalizedEmailValue;
  }
  if (input.externalRef !== undefined) {
    externalRef = input.externalRef.trim() || null;
    patch.externalRef = externalRef;
  }

  if (input.phone !== undefined || input.email !== undefined || input.externalRef !== undefined) {
    const conditions = [];
    if (normalizedPhone) conditions.push(eq(customers.normalizedPhone, normalizedPhone));
    if (normalizedEmailValue) conditions.push(eq(customers.normalizedEmail, normalizedEmailValue));
    if (externalRef) conditions.push(eq(customers.externalRef, externalRef));
    if (conditions.length > 0) {
      const [dup] = await db.select().from(customers)
        .where(and(eq(customers.businessId, businessId), or(...conditions)));
      if (dup && dup.id !== customerId) {
        throw new DuplicateCustomerError("Another customer in this business already matches this phone/email/external reference", dup.id);
      }
    }
  }

  if (input.status !== undefined) {
    assertValidStatus(input.status);
    if (input.status === CUSTOMER_STATUS.ARCHIVED) {
      throw new ValidationError("Use the archive action to archive a customer");
    }
    patch.status = input.status;
  }

  const [updated] = await db.update(customers).set(patch).where(eq(customers.id, customerId)).returning();

  await createAuditLog(actorUserId, businessId, AUDIT_ACTION_CUSTOMER.UPDATED, customerId, { fields: Object.keys(patch) });
  return updated;
}

export async function archiveCustomer(businessId: number, actorUserId: number, customerId: number) {
  const existing = await getOwnedCustomer(businessId, customerId);
  if (existing.status === CUSTOMER_STATUS.ARCHIVED) {
    throw new ValidationError("Customer is already archived");
  }

  const [updated] = await db.update(customers).set({
    status: CUSTOMER_STATUS.ARCHIVED,
    archivedBy: actorUserId,
    archivedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(customers.id, customerId)).returning();

  await createAuditLog(actorUserId, businessId, AUDIT_ACTION_CUSTOMER.ARCHIVED, customerId, {});
  return updated;
}

// ---------------------------------------------------------------------------
// Communication eligibility -- NOT a Marketing Consent Engine (doc 29
// section 10). Absence of a row is "not eligible," never inferred from the
// customer existing. No route exposes writing this in Phase 4 -- this is
// the documented extension point for the future Campaigns/Marketing phase.
// ---------------------------------------------------------------------------

export async function isEligibleForChannel(businessId: number, customerId: number, channel: CustomerConsentChannel): Promise<boolean> {
  const [row] = await db.select().from(customerConsents)
    .where(and(eq(customerConsents.businessId, businessId), eq(customerConsents.customerId, customerId), eq(customerConsents.channel, channel)));
  return row?.status === CUSTOMER_CONSENT_STATUS.GRANTED;
}

/**
 * Phase 8: the read side of the consent write path (doc 34). Returns
 * EVERY channel's current state (a channel with no row is implicitly "not
 * eligible" -- never returned as a fabricated row). Tenant-scoped via
 * getOwnedCustomer, same as every other customer read.
 */
export async function getCustomerConsents(businessId: number, customerId: number) {
  await getOwnedCustomer(businessId, customerId);
  return db.select().from(customerConsents).where(eq(customerConsents.customerId, customerId));
}

export async function setChannelConsent(businessId: number, actorUserId: number, customerId: number, channel: CustomerConsentChannel, granted: boolean, source?: string) {
  await getOwnedCustomer(businessId, customerId);
  if (!Object.values(CUSTOMER_CONSENT_CHANNEL).includes(channel)) {
    throw new ValidationError(`Invalid channel: ${channel}`);
  }

  const status = granted ? CUSTOMER_CONSENT_STATUS.GRANTED : CUSTOMER_CONSENT_STATUS.REVOKED;
  const [existing] = await db.select().from(customerConsents)
    .where(and(eq(customerConsents.customerId, customerId), eq(customerConsents.channel, channel)));

  let row;
  if (existing) {
    [row] = await db.update(customerConsents).set({ status, source: source ?? null, updatedBy: actorUserId, updatedAt: new Date() })
      .where(eq(customerConsents.id, existing.id)).returning();
  } else {
    [row] = await db.insert(customerConsents).values({
      businessId, customerId, channel, status, source: source ?? null, updatedBy: actorUserId,
    }).returning();
  }

  await createAuditLog(actorUserId, businessId, AUDIT_ACTION_CUSTOMER.CONSENT_CHANGED, customerId, { channel, status });
  return row;
}
