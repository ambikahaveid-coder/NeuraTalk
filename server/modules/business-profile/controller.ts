import type { Request, Response } from "express";
import { z, ZodError } from "zod";
import { logger } from "../../observability";
import {
  getBusinessProfile,
  updateBusinessProfile,
  getBranding,
  updateBranding,
  setLogo,
  removeLogo,
  NotFoundError,
  InvalidLogoUploadError,
} from "./service";

function badRequest(res: Response, msg: string) {
  return res.status(400).json({ success: false, error: msg });
}

function parseBusinessId(req: Request): number | null {
  const id = Number(req.params.businessId);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function getProfile(req: Request, res: Response) {
  const businessId = parseBusinessId(req);
  if (businessId === null) return badRequest(res, "Invalid businessId");

  const profile = await getBusinessProfile(businessId);
  if (!profile) return res.status(404).json({ success: false, error: "Business not found" });
  return res.json({ success: true, profile });
}

// Explicit allow-list -- matches service.ts's WRITABLE_PROFILE_FIELDS.
// Anything not listed here (status, logoUrl, isActive, approvedBy, etc.)
// is structurally impossible to set through this route.
const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  legalBusinessName: z.string().trim().max(300).optional(),
  description: z.string().trim().max(2000).optional(),
  industry: z.string().trim().max(100).optional(),
  website: z.string().trim().url().max(500).optional().or(z.literal("")),
  email: z.string().trim().email().max(255).optional(),
  phone: z.string().trim().max(30).optional(),
  address: z.string().trim().max(500).optional(),
  addressCity: z.string().trim().max(120).optional(),
  addressState: z.string().trim().max(120).optional(),
  addressCountry: z.string().trim().max(120).optional(),
  addressPostalCode: z.string().trim().max(20).optional(),
}).strict();

export async function patchProfile(req: Request, res: Response) {
  const businessId = parseBusinessId(req);
  if (businessId === null) return badRequest(res, "Invalid businessId");

  const parsed = updateProfileSchema.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error.message);

  try {
    const profile = await updateBusinessProfile(businessId, req.user!.id, parsed.data);
    return res.json({ success: true, profile });
  } catch (error) {
    if (error instanceof NotFoundError) return res.status(404).json({ success: false, error: error.message });
    logger.error("BusinessProfile", "Failed to update profile", error as Error);
    return res.status(500).json({ success: false, error: "Failed to update profile" });
  }
}

export async function getBrandingHandler(req: Request, res: Response) {
  const businessId = parseBusinessId(req);
  if (businessId === null) return badRequest(res, "Invalid businessId");

  try {
    const branding = await getBranding(businessId);
    return res.json({ success: true, branding });
  } catch (error) {
    if (error instanceof NotFoundError) return res.status(404).json({ success: false, error: error.message });
    logger.error("BusinessProfile", "Failed to get branding", error as Error);
    return res.status(500).json({ success: false, error: "Failed to get branding" });
  }
}

export async function patchBranding(req: Request, res: Response) {
  const businessId = parseBusinessId(req);
  if (businessId === null) return badRequest(res, "Invalid businessId");

  try {
    const branding = await updateBranding(businessId, req.user!.id, req.body ?? {});
    return res.json({ success: true, branding });
  } catch (error) {
    if (error instanceof NotFoundError) return res.status(404).json({ success: false, error: error.message });
    if (error instanceof ZodError) return badRequest(res, error.message);
    logger.error("BusinessProfile", "Failed to update branding", error as Error);
    return res.status(500).json({ success: false, error: "Failed to update branding" });
  }
}

const setLogoSchema = z.object({
  objectPath: z.string().trim().min(1).max(2000),
});

export async function putLogo(req: Request, res: Response) {
  const businessId = parseBusinessId(req);
  if (businessId === null) return badRequest(res, "Invalid businessId");

  const parsed = setLogoSchema.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error.message);

  try {
    const logoUrl = await setLogo(businessId, req.user!.id, parsed.data.objectPath);
    return res.json({ success: true, logoUrl });
  } catch (error) {
    if (error instanceof NotFoundError) return res.status(404).json({ success: false, error: error.message });
    if (error instanceof InvalidLogoUploadError) return badRequest(res, error.message);
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("ObjectNotFound") || (error as any)?.name === "ObjectNotFoundError") {
      return badRequest(res, "Uploaded object not found -- upload may have failed");
    }
    logger.error("BusinessProfile", "Failed to set logo", error as Error);
    return res.status(500).json({ success: false, error: "Failed to set logo" });
  }
}

export async function deleteLogo(req: Request, res: Response) {
  const businessId = parseBusinessId(req);
  if (businessId === null) return badRequest(res, "Invalid businessId");

  try {
    await removeLogo(businessId, req.user!.id);
    return res.json({ success: true });
  } catch (error) {
    if (error instanceof NotFoundError) return res.status(404).json({ success: false, error: error.message });
    logger.error("BusinessProfile", "Failed to remove logo", error as Error);
    return res.status(500).json({ success: false, error: "Failed to remove logo" });
  }
}
