/**
 * Business catalog: products/services with price and photo, shown to
 * customers from the business chat ("Ask about this" starts a message).
 * Photos follow the business-logo rule: re-checked as a real image and
 * made public, since a catalog is meant to be seen.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../../db";
import { businessCatalogItems, organizations, PERMISSIONS } from "@shared/schema";
import { requireAuth, requireCompanyAccess, requirePermission, requireRole } from "../../role-middleware";
import { ObjectStorageService } from "../../ai_integrations/object_storage/objectStorage";
import { setObjectAclPolicy } from "../../ai_integrations/object_storage/objectAcl";
import { logger } from "../../observability";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_ITEMS = 500;

const itemSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional().nullable(),
  pricePaise: z.number().int().nonnegative().max(1_000_000_000).optional().nullable(),
  imageUrl: z.string().trim().max(2000).optional().nullable(),
  isAvailable: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
});

class CatalogInputError extends Error {}

async function publishImage(actorUserId: number, objectPath: string | null | undefined): Promise<string | null> {
  if (!objectPath) return null;
  if (!objectPath.startsWith("/objects/") || objectPath.includes("..")) throw new CatalogInputError("Invalid image");
  const file = await new ObjectStorageService().getObjectEntityFile(objectPath);
  const [meta] = await file.getMetadata();
  if (!meta.contentType || !IMAGE_TYPES.includes(meta.contentType)) throw new CatalogInputError("The photo must be a JPEG, PNG, WebP or GIF image");
  if (typeof meta.size === "number" && meta.size > MAX_IMAGE_BYTES) throw new CatalogInputError("The photo is larger than 5 MB");
  await setObjectAclPolicy(file, { owner: String(actorUserId), visibility: "public" });
  return objectPath;
}

function fail(res: Response, error: unknown, fallback: string) {
  if (error instanceof CatalogInputError) return res.status(400).json({ success: false, error: error.message });
  if (error instanceof z.ZodError) return res.status(400).json({ success: false, error: error.errors.map((e) => e.message).join("; ") });
  logger.error("Catalog", fallback, error instanceof Error ? error : new Error(String(error)));
  return res.status(500).json({ success: false, error: fallback });
}

export async function listCatalog(businessId: number, onlyAvailable: boolean) {
  return db.select().from(businessCatalogItems)
    .where(onlyAvailable ? and(eq(businessCatalogItems.businessId, businessId), eq(businessCatalogItems.isAvailable, true)) : eq(businessCatalogItems.businessId, businessId))
    .orderBy(asc(businessCatalogItems.sortOrder), asc(businessCatalogItems.id));
}

export function registerCatalogRoutes(app: Express): void {
  const view = [requireAuth, requireCompanyAccess("businessId"), requirePermission(PERMISSIONS.MESSAGING_VIEW)];
  const manage = [requireAuth, requireCompanyAccess("businessId"), requireRole("company_admin", "super_admin")];

  // Business team: the full catalog (agents send items from the inbox).
  app.get("/api/business/:businessId/catalog", ...view, async (req: Request, res: Response) => {
    try {
      res.json({ success: true, items: await listCatalog(Number(req.params.businessId), false) });
    } catch (error) { return fail(res, error, "Failed to load catalog"); }
  });

  app.post("/api/business/:businessId/catalog", ...manage, async (req: Request, res: Response) => {
    try {
      const businessId = Number(req.params.businessId);
      const input = itemSchema.parse(req.body ?? {});
      const existing = await listCatalog(businessId, false);
      if (existing.length >= MAX_ITEMS) throw new CatalogInputError(`A catalog can hold up to ${MAX_ITEMS} items`);
      const [item] = await db.insert(businessCatalogItems).values({
        businessId,
        name: input.name,
        description: input.description ?? null,
        pricePaise: input.pricePaise ?? null,
        imageUrl: await publishImage(req.user!.id, input.imageUrl),
        isAvailable: input.isAvailable ?? true,
        sortOrder: input.sortOrder ?? existing.length,
      }).returning();
      res.status(201).json({ success: true, item });
    } catch (error) { return fail(res, error, "Failed to add item"); }
  });

  app.patch("/api/business/:businessId/catalog/:itemId", ...manage, async (req: Request, res: Response) => {
    try {
      const businessId = Number(req.params.businessId);
      const input = itemSchema.partial().parse(req.body ?? {});
      const patch: Record<string, unknown> = { ...input, updatedAt: new Date() };
      if (input.imageUrl !== undefined) patch.imageUrl = await publishImage(req.user!.id, input.imageUrl);
      const [item] = await db.update(businessCatalogItems).set(patch)
        .where(and(eq(businessCatalogItems.id, Number(req.params.itemId)), eq(businessCatalogItems.businessId, businessId))).returning();
      if (!item) return res.status(404).json({ success: false, error: "Item not found" });
      res.json({ success: true, item });
    } catch (error) { return fail(res, error, "Failed to update item"); }
  });

  app.delete("/api/business/:businessId/catalog/:itemId", ...manage, async (req: Request, res: Response) => {
    try {
      const [item] = await db.delete(businessCatalogItems)
        .where(and(eq(businessCatalogItems.id, Number(req.params.itemId)), eq(businessCatalogItems.businessId, Number(req.params.businessId)))).returning();
      if (!item) return res.status(404).json({ success: false, error: "Item not found" });
      res.json({ success: true });
    } catch (error) { return fail(res, error, "Failed to remove item"); }
  });

  // Customer: what this business offers (available items only).
  app.get("/api/messaging/business/:businessId/catalog", requireAuth, async (req: Request, res: Response) => {
    try {
      const businessId = Number(req.params.businessId);
      if (!Number.isInteger(businessId) || businessId <= 0) return res.status(400).json({ success: false, error: "Invalid businessId" });
      const [org] = await db.select({ status: organizations.status, isActive: organizations.isActive }).from(organizations).where(eq(organizations.id, businessId));
      if (!org || org.status !== "approved" || !org.isActive) return res.status(404).json({ success: false, error: "Business not found" });
      const items = await listCatalog(businessId, true);
      res.json({ success: true, items: items.map(({ id, name, description, pricePaise, imageUrl }) => ({ id, name, description, pricePaise, imageUrl })) });
    } catch (error) { return fail(res, error, "Failed to load catalog"); }
  });
}
