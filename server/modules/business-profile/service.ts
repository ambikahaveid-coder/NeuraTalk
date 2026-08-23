/**
 * Business Profile + Branding -- Phase 1 (2026-08-23).
 * See docs/neura-ecosystem/26_BUSINESS_PROFILE_BRANDING_IMPLEMENTATION.md.
 *
 * Reuses the existing `organizations` table as the business entity (per
 * doc 19's finding -- no second Business table), the existing `settings`
 * jsonb column for branding (no new columns for colors), and the existing
 * object-storage presigned-upload flow for the logo.
 */
import { db } from "../../db";
import { organizations, businessBrandingSchema, BRANDING_SETTINGS_KEY, type BusinessBranding } from "@shared/schema";
import { eq } from "drizzle-orm";
import { AuditHelpers } from "../../audit";
import { ObjectStorageService } from "../../ai_integrations/object_storage/objectStorage";
import { setObjectAclPolicy } from "../../ai_integrations/object_storage/objectAcl";

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

// Only these fields are ever writable through the profile-update path --
// an explicit allow-list, not a spread of the request body, so lifecycle
// fields (status, approvedBy, isActive, etc.) can never be mass-assigned
// through this route regardless of what a client sends.
export interface BusinessProfileUpdate {
  name?: string;
  legalBusinessName?: string;
  description?: string;
  industry?: string;
  website?: string;
  email?: string;
  phone?: string;
  address?: string;
  addressCity?: string;
  addressState?: string;
  addressCountry?: string;
  addressPostalCode?: string;
}

const WRITABLE_PROFILE_FIELDS: (keyof BusinessProfileUpdate)[] = [
  "name", "legalBusinessName", "description", "industry", "website",
  "email", "phone", "address", "addressCity", "addressState", "addressCountry", "addressPostalCode",
];

export interface BusinessProfile {
  id: number;
  name: string;
  legalBusinessName: string | null;
  description: string | null;
  industry: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressCountry: string | null;
  addressPostalCode: string | null;
  logoUrl: string | null;
  status: string | null;
}

function toProfile(org: typeof organizations.$inferSelect): BusinessProfile {
  return {
    id: org.id,
    name: org.name,
    legalBusinessName: org.legalBusinessName,
    description: org.description,
    industry: org.industry,
    website: org.website,
    email: org.email,
    phone: org.phone,
    address: org.address,
    addressCity: org.addressCity,
    addressState: org.addressState,
    addressCountry: org.addressCountry,
    addressPostalCode: org.addressPostalCode,
    logoUrl: org.logoUrl,
    status: org.status,
  };
}

export async function getBusinessProfile(businessId: number): Promise<BusinessProfile | null> {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, businessId));
  if (!org) return null;
  return toProfile(org);
}

export async function updateBusinessProfile(
  businessId: number,
  actorUserId: number,
  patch: BusinessProfileUpdate,
): Promise<BusinessProfile> {
  const [existing] = await db.select().from(organizations).where(eq(organizations.id, businessId));
  if (!existing) throw new NotFoundError("Business not found");

  const setValues: Record<string, unknown> = {};
  const oldValues: Record<string, unknown> = {};
  for (const field of WRITABLE_PROFILE_FIELDS) {
    if (patch[field] !== undefined) {
      setValues[field] = patch[field];
      oldValues[field] = (existing as Record<string, unknown>)[field];
    }
  }

  if (Object.keys(setValues).length === 0) {
    return toProfile(existing);
  }

  const [updated] = await db.update(organizations).set(setValues).where(eq(organizations.id, businessId)).returning();

  await AuditHelpers.logSettingsChange(actorUserId, `business_profile:${businessId}`, oldValues, setValues);

  return toProfile(updated);
}

export async function getBranding(businessId: number): Promise<BusinessBranding> {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, businessId));
  if (!org) throw new NotFoundError("Business not found");
  const settings = (org.settings as Record<string, unknown>) ?? {};
  return (settings[BRANDING_SETTINGS_KEY] as BusinessBranding) ?? {};
}

export async function updateBranding(
  businessId: number,
  actorUserId: number,
  patch: BusinessBranding,
): Promise<BusinessBranding> {
  const parsed = businessBrandingSchema.parse(patch); // throws ZodError on any unexpected field or bad color format

  const [existing] = await db.select().from(organizations).where(eq(organizations.id, businessId));
  if (!existing) throw new NotFoundError("Business not found");

  const settings = { ...(existing.settings as Record<string, unknown> ?? {}) };
  const oldBranding = (settings[BRANDING_SETTINGS_KEY] as BusinessBranding) ?? {};
  const newBranding = { ...oldBranding, ...parsed };
  settings[BRANDING_SETTINGS_KEY] = newBranding;

  await db.update(organizations).set({ settings }).where(eq(organizations.id, businessId));

  await AuditHelpers.logSettingsChange(actorUserId, `business_branding:${businessId}`, oldBranding, newBranding);

  return newBranding;
}

const LOGO_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export class InvalidLogoUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidLogoUploadError";
  }
}

const MAX_LOGO_SIZE_BYTES = 5 * 1024 * 1024; // 5MB -- far below the general 100MB chat-attachment cap; a logo has no business being that large

/**
 * Finalizes a logo that was already uploaded via the existing presigned-URL
 * flow (POST /api/uploads/request-url, unchanged, reused as-is). This sets
 * the object's ACL (public read, matching the existing chat-attachment
 * pattern in personal-chat-routes.ts) and records the resulting path as
 * the business's logoUrl.
 *
 * Security note: the shared /api/uploads/request-url endpoint accepts many
 * content types (video, zip, office docs -- it's built for general chat
 * attachments, not logos specifically), and object-storage paths are often
 * extensionless UUIDs, so a path-string/extension check alone is NOT a
 * reliable gate -- a client could request a presigned URL for a large video
 * with an extensionless path and then call this function with that path.
 * This function therefore re-reads the object's REAL stored content-type
 * and size via getMetadata() (the object storage's own recorded values, not
 * anything client-supplied) and rejects anything that isn't actually one of
 * the 4 accepted image types or exceeds MAX_LOGO_SIZE_BYTES, regardless of
 * what the object path looks like.
 */
export async function setLogo(businessId: number, actorUserId: number, objectPath: string): Promise<string> {
  const [existing] = await db.select().from(organizations).where(eq(organizations.id, businessId));
  if (!existing) throw new NotFoundError("Business not found");

  if (!objectPath.startsWith("/objects/") || objectPath.includes("..")) {
    throw new InvalidLogoUploadError("Invalid object path");
  }

  const objectStorage = new ObjectStorageService();
  const objectFile = await objectStorage.getObjectEntityFile(objectPath); // throws ObjectNotFoundError if it doesn't exist

  const [meta] = await objectFile.getMetadata();
  if (!meta.contentType || !LOGO_CONTENT_TYPES.includes(meta.contentType)) {
    throw new InvalidLogoUploadError("Logo must be an image file (JPEG, PNG, WebP, or GIF)");
  }
  if (typeof meta.size === "number" && meta.size > MAX_LOGO_SIZE_BYTES) {
    throw new InvalidLogoUploadError(`Logo exceeds maximum size of ${MAX_LOGO_SIZE_BYTES} bytes`);
  }

  await setObjectAclPolicy(objectFile, { owner: String(actorUserId), visibility: "public" });

  const oldLogoUrl = existing.logoUrl;
  await db.update(organizations).set({ logoUrl: objectPath }).where(eq(organizations.id, businessId));

  await AuditHelpers.logSettingsChange(actorUserId, `business_logo:${businessId}`, { logoUrl: oldLogoUrl }, { logoUrl: objectPath });

  return objectPath;
}

export async function removeLogo(businessId: number, actorUserId: number): Promise<void> {
  const [existing] = await db.select().from(organizations).where(eq(organizations.id, businessId));
  if (!existing) throw new NotFoundError("Business not found");

  const oldLogoUrl = existing.logoUrl;
  await db.update(organizations).set({ logoUrl: null }).where(eq(organizations.id, businessId));

  await AuditHelpers.logSettingsChange(actorUserId, `business_logo:${businessId}`, { logoUrl: oldLogoUrl }, { logoUrl: null });
}
