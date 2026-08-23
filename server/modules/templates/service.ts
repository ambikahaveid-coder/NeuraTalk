/**
 * Business Message Template Engine -- Phase 2 (2026-08-24).
 * See docs/neura-ecosystem/27_BUSINESS_TEMPLATE_ENGINE_IMPLEMENTATION.md.
 */
import { db } from "../../db";
import {
  templates,
  templateVersions,
  organizations,
  MESSAGE_CATEGORY,
  TEMPLATE_VERSION_STATUS,
  type MessageCategory,
  type TemplateVariableDeclaration,
} from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { createAuditLog, AUDIT_ACTION_TEMPLATE } from "./audit";
import { logger } from "../../observability";
import { assertLegalTemplateTransition, isContentMutable, IllegalTemplateTransitionError } from "./lifecycle";
import { validateTemplateContent, renderTemplateContent, type RenderResult } from "./render";

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
export class SelfApprovalError extends Error {
  constructor() {
    super("You cannot approve a template version you submitted yourself");
    this.name = "SelfApprovalError";
  }
}
export { IllegalTemplateTransitionError };

function assertValidCategory(category: string): asserts category is MessageCategory {
  if (!Object.values(MESSAGE_CATEGORY).includes(category as MessageCategory)) {
    throw new ValidationError(`Invalid category: ${category}`);
  }
}

// ---------------------------------------------------------------------------
// Template (the stable name+category container)
// ---------------------------------------------------------------------------

export async function createTemplate(businessId: number, actorUserId: number, input: { name: string; category: string }) {
  const [business] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, businessId));
  if (!business) throw new NotFoundError("Business not found");

  assertValidCategory(input.category);

  const [existing] = await db.select().from(templates)
    .where(and(eq(templates.businessId, businessId), eq(templates.name, input.name)));
  if (existing) throw new ValidationError(`A template named "${input.name}" already exists for this business`);

  const [template] = await db.insert(templates).values({
    businessId,
    name: input.name,
    category: input.category,
    createdBy: actorUserId,
  }).returning();

  await createAuditLog(actorUserId, businessId, AUDIT_ACTION_TEMPLATE.CREATED, template.id, undefined, {
    name: template.name, category: template.category,
  });

  return template;
}

export async function listTemplates(businessId: number) {
  const rows = await db.select().from(templates).where(eq(templates.businessId, businessId)).orderBy(desc(templates.createdAt));
  const result = [];
  for (const t of rows) {
    const versions = await db.select().from(templateVersions).where(eq(templateVersions.templateId, t.id));
    result.push({ ...t, versionCount: versions.length });
  }
  return result;
}

export async function getTemplate(businessId: number, templateId: number) {
  const [t] = await db.select().from(templates).where(and(eq(templates.id, templateId), eq(templates.businessId, businessId)));
  if (!t) return null;
  const versions = await db.select().from(templateVersions).where(eq(templateVersions.templateId, templateId)).orderBy(desc(templateVersions.createdAt));
  return { ...t, versions };
}

async function getOwnedTemplate(businessId: number, templateId: number) {
  const [t] = await db.select().from(templates).where(and(eq(templates.id, templateId), eq(templates.businessId, businessId)));
  if (!t) throw new NotFoundError("Template not found");
  return t;
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

export interface DraftVersionInput {
  language?: string;
  title?: string;
  content: string;
  variables: TemplateVariableDeclaration[];
  mediaType?: string;
  mediaUrl?: string;
}

/**
 * Creates a new DRAFT version, or updates the existing DRAFT in place if
 * one already exists for this (templateId, language) -- content is only
 * ever mutated while a version is DRAFT (lifecycle.ts's isContentMutable).
 * If the latest version for this language is non-draft (submitted/
 * approved/rejected/archived), a brand new version row is created instead
 * of touching it -- this is the "editing creates a new version" guarantee.
 */
export async function createOrEditDraftVersion(businessId: number, actorUserId: number, templateId: number, input: DraftVersionInput) {
  await getOwnedTemplate(businessId, templateId);

  const language = input.language?.trim() || "en";
  validateTemplateContent(input.content, input.variables);

  const existingVersions = await db.select().from(templateVersions)
    .where(and(eq(templateVersions.templateId, templateId), eq(templateVersions.language, language)))
    .orderBy(desc(templateVersions.versionNumber));

  const latest = existingVersions[0];

  if (latest && isContentMutable(latest.status as any)) {
    // In-place edit of the existing draft.
    const [updated] = await db.update(templateVersions).set({
      title: input.title ?? null,
      content: input.content,
      variables: input.variables,
      mediaType: input.mediaType ?? null,
      mediaUrl: input.mediaUrl ?? null,
    }).where(eq(templateVersions.id, latest.id)).returning();

    await createAuditLog(actorUserId, businessId, AUDIT_ACTION_TEMPLATE.VERSION_EDITED, templateId, updated.id, { language, versionNumber: updated.versionNumber });
    return updated;
  }

  // New version -- either the first ever, or the latest is non-draft.
  const nextVersionNumber = latest ? latest.versionNumber + 1 : 1;
  const [created] = await db.insert(templateVersions).values({
    templateId,
    language,
    versionNumber: nextVersionNumber,
    status: TEMPLATE_VERSION_STATUS.DRAFT,
    title: input.title ?? null,
    content: input.content,
    variables: input.variables,
    mediaType: input.mediaType ?? null,
    mediaUrl: input.mediaUrl ?? null,
    createdBy: actorUserId,
  }).returning();

  await createAuditLog(actorUserId, businessId, AUDIT_ACTION_TEMPLATE.VERSION_CREATED, templateId, created.id, { language, versionNumber: created.versionNumber });
  return created;
}

export async function listVersions(businessId: number, templateId: number, language?: string) {
  await getOwnedTemplate(businessId, templateId);
  const conditions = [eq(templateVersions.templateId, templateId)];
  if (language) conditions.push(eq(templateVersions.language, language));
  return db.select().from(templateVersions).where(and(...conditions)).orderBy(desc(templateVersions.versionNumber));
}

async function getOwnedVersion(businessId: number, templateId: number, versionId: number) {
  await getOwnedTemplate(businessId, templateId);
  const [v] = await db.select().from(templateVersions).where(and(eq(templateVersions.id, versionId), eq(templateVersions.templateId, templateId)));
  if (!v) throw new NotFoundError("Template version not found");
  return v;
}

export async function submitVersion(businessId: number, actorUserId: number, templateId: number, versionId: number) {
  const version = await getOwnedVersion(businessId, templateId, versionId);
  assertLegalTemplateTransition(version.status as any, TEMPLATE_VERSION_STATUS.SUBMITTED);

  const [updated] = await db.update(templateVersions).set({
    status: TEMPLATE_VERSION_STATUS.SUBMITTED,
    submittedBy: actorUserId,
    submittedAt: new Date(),
  }).where(eq(templateVersions.id, versionId)).returning();

  await createAuditLog(actorUserId, businessId, AUDIT_ACTION_TEMPLATE.SUBMITTED, templateId, versionId, { language: version.language, versionNumber: version.versionNumber });
  return updated;
}

/**
 * Separation of duties (documented decision, doc 27 section 8): the same
 * user who submitted a version cannot approve it, even if they hold
 * TEMPLATES_APPROVE -- enforced here, at the resource level, since
 * permissions are role-based and can't express "not your own submission."
 * super_admin is exempted, matching the existing project-wide convention
 * (hasRequestedPermission already grants super_admin "*" everywhere else).
 */
export async function approveVersion(businessId: number, actorUserId: number, templateId: number, versionId: number, isSuperAdmin: boolean) {
  const version = await getOwnedVersion(businessId, templateId, versionId);
  assertLegalTemplateTransition(version.status as any, TEMPLATE_VERSION_STATUS.APPROVED);

  if (!isSuperAdmin && version.submittedBy === actorUserId) {
    throw new SelfApprovalError();
  }

  const [updated] = await db.update(templateVersions).set({
    status: TEMPLATE_VERSION_STATUS.APPROVED,
    decidedBy: actorUserId,
    decidedAt: new Date(),
  }).where(eq(templateVersions.id, versionId)).returning();

  await createAuditLog(actorUserId, businessId, AUDIT_ACTION_TEMPLATE.APPROVED, templateId, versionId, { language: version.language, versionNumber: version.versionNumber });
  return updated;
}

export async function rejectVersion(businessId: number, actorUserId: number, templateId: number, versionId: number, reason: string) {
  if (!reason || !reason.trim()) throw new ValidationError("A rejection reason is required");

  const version = await getOwnedVersion(businessId, templateId, versionId);
  assertLegalTemplateTransition(version.status as any, TEMPLATE_VERSION_STATUS.REJECTED);

  const [updated] = await db.update(templateVersions).set({
    status: TEMPLATE_VERSION_STATUS.REJECTED,
    decidedBy: actorUserId,
    decidedAt: new Date(),
    rejectionReason: reason,
  }).where(eq(templateVersions.id, versionId)).returning();

  await createAuditLog(actorUserId, businessId, AUDIT_ACTION_TEMPLATE.REJECTED, templateId, versionId, { language: version.language, versionNumber: version.versionNumber, reason });
  return updated;
}

/** REJECTED -> DRAFT. Same version row (not a new one) -- see lifecycle.ts's doc comment for why. */
export async function returnToDraft(businessId: number, actorUserId: number, templateId: number, versionId: number) {
  const version = await getOwnedVersion(businessId, templateId, versionId);
  assertLegalTemplateTransition(version.status as any, TEMPLATE_VERSION_STATUS.DRAFT);

  const [updated] = await db.update(templateVersions).set({
    status: TEMPLATE_VERSION_STATUS.DRAFT,
    decidedBy: null,
    decidedAt: null,
    rejectionReason: null,
  }).where(eq(templateVersions.id, versionId)).returning();

  await createAuditLog(actorUserId, businessId, AUDIT_ACTION_TEMPLATE.RETURNED_TO_DRAFT, templateId, versionId, { language: version.language, versionNumber: version.versionNumber });
  return updated;
}

export async function archiveVersion(businessId: number, actorUserId: number, templateId: number, versionId: number) {
  const version = await getOwnedVersion(businessId, templateId, versionId);
  assertLegalTemplateTransition(version.status as any, TEMPLATE_VERSION_STATUS.ARCHIVED);

  const [updated] = await db.update(templateVersions).set({
    status: TEMPLATE_VERSION_STATUS.ARCHIVED,
    archivedBy: actorUserId,
    archivedAt: new Date(),
  }).where(eq(templateVersions.id, versionId)).returning();

  await createAuditLog(actorUserId, businessId, AUDIT_ACTION_TEMPLATE.ARCHIVED, templateId, versionId, { language: version.language, versionNumber: version.versionNumber });
  return updated;
}

export async function previewVersion(businessId: number, templateId: number, versionId: number, values: Record<string, unknown>): Promise<RenderResult> {
  const version = await getOwnedVersion(businessId, templateId, versionId);
  return renderTemplateContent(version.content, (version.variables as TemplateVariableDeclaration[]) ?? [], values);
}
