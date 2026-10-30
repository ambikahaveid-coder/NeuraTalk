/**
 * Business verification (blue tick), checked by NeuraTalk like WhatsApp's
 * Meta verification -- but suited to Indian small businesses: no website or
 * Facebook page needed; a government registration and a PAN are.
 *
 * The business submits:
 *   - legal name (as on the documents) and the brand name customers will see
 *   - ONE business registration: GST, Udyam (MSME), Shop & Establishment /
 *     trade licence, Certificate of Incorporation or FSSAI licence
 *   - PAN card (the business's, or the owner's for a proprietorship)
 *   - optional: owner ID (masked Aadhaar / voter ID / passport / driving
 *     licence), address proof, website, social page
 * Files: PDF, JPG or PNG, up to 5 MB each, at most 6. Stored privately --
 * only the business that uploaded them and NeuraTalk super admins (through
 * the admin route below) can open them.
 *
 * NeuraTalk approves -> blue tick + the approved brand name and legal name
 * on the business. Rejects -> the reason is shown to the business, which can
 * fix and submit again. Changing the name later removes the tick
 * (business-profile/service.ts).
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import { organizations, users } from "@shared/schema";
import { requireAuth, requireCompanyAccess, requireRole, requireSuperAdmin } from "../../role-middleware";
import { logger } from "../../observability";
import { sendPushNotification } from "../../firebase-admin";

export const BUSINESS_DOC_TYPES = {
  gst: "GST registration certificate",
  udyam: "Udyam (MSME) registration certificate",
  shop_establishment: "Shop & Establishment / trade licence",
  incorporation: "Certificate of Incorporation (company / LLP)",
  fssai: "FSSAI food licence",
} as const;

export const FILE_KINDS = {
  business_proof: "Business registration",
  pan: "PAN card",
  owner_id: "Owner ID (masked Aadhaar / voter ID / passport / driving licence)",
  address_proof: "Address proof (electricity bill / rent agreement)",
  other: "Other",
} as const;

const ALLOWED_MIME = ["application/pdf", "image/jpeg", "image/png"];
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 6;

export async function ensureVerificationTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "business_verification_requests" (
      "id" serial PRIMARY KEY,
      "business_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "status" text NOT NULL DEFAULT 'pending',
      "legal_name" text NOT NULL,
      "brand_name" text NOT NULL,
      "business_doc_type" text NOT NULL,
      "business_doc_number" text,
      "pan_number" text,
      "website" text,
      "social_url" text,
      "files" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "submitted_by" integer NOT NULL,
      "submitted_at" timestamp DEFAULT now(),
      "reviewed_by" integer,
      "reviewed_at" timestamp,
      "decision_reason" text
    )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "business_verification_business_idx" ON "business_verification_requests" ("business_id", "submitted_at")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "business_verification_status_idx" ON "business_verification_requests" ("status")`);
}

interface StoredFile { kind: keyof typeof FILE_KINDS; path: string; name: string; mimeType: string; sizeBytes: number }
interface RequestRow {
  id: number; business_id: number; status: "pending" | "approved" | "rejected" | "withdrawn";
  legal_name: string; brand_name: string; business_doc_type: string; business_doc_number: string | null;
  pan_number: string | null; website: string | null; social_url: string | null; files: StoredFile[];
  submitted_by: number; submitted_at: Date | string; reviewed_by: number | null; reviewed_at: Date | string | null; decision_reason: string | null;
}

function rows<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? (result as T[])) || [];
}

function iso(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString();
  const s = v == null ? "" : String(v);
  if (!s) return null;
  return /([zZ]|[+-]\d\d:?\d\d)$/.test(s) ? s : `${s.replace(" ", "T")}Z`;
}

/** PAN shown as ABCDE••••F to anyone but the reviewer. */
function maskPan(pan: string | null): string | null {
  if (!pan) return null;
  return pan.length >= 10 ? `${pan.slice(0, 5)}••••${pan.slice(-1)}` : "••••";
}

function presentForBusiness(r: RequestRow) {
  return {
    id: r.id, status: r.status, legalName: r.legal_name, brandName: r.brand_name,
    businessDocType: r.business_doc_type, businessDocLabel: BUSINESS_DOC_TYPES[r.business_doc_type as keyof typeof BUSINESS_DOC_TYPES] ?? r.business_doc_type,
    panNumber: maskPan(r.pan_number), website: r.website, socialUrl: r.social_url,
    files: (r.files ?? []).map((f) => ({ kind: f.kind, kindLabel: FILE_KINDS[f.kind] ?? f.kind, name: f.name, sizeBytes: f.sizeBytes })),
    submittedAt: iso(r.submitted_at), reviewedAt: iso(r.reviewed_at), reason: r.decision_reason,
  };
}

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const submitSchema = z.object({
  legalName: z.string().trim().min(2, "Enter the legal name as on your documents").max(200),
  brandName: z.string().trim().min(2, "Enter the name customers will see").max(80),
  businessDocType: z.enum(Object.keys(BUSINESS_DOC_TYPES) as [keyof typeof BUSINESS_DOC_TYPES]),
  businessDocNumber: z.string().trim().max(40).optional(),
  panNumber: z.string().trim().toUpperCase().regex(PAN_RE, "PAN looks wrong (format ABCDE1234F)").optional(),
  website: z.string().trim().url().max(300).optional().or(z.literal("").transform(() => undefined)),
  socialUrl: z.string().trim().url().max(300).optional().or(z.literal("").transform(() => undefined)),
  files: z.array(z.object({
    kind: z.enum(Object.keys(FILE_KINDS) as [keyof typeof FILE_KINDS]),
    path: z.string().trim().startsWith("/objects/").max(500),
    name: z.string().trim().max(200).optional(),
  })).min(1).max(MAX_FILES),
}).superRefine((v, ctx) => {
  if (!v.files.some((f) => f.kind === "business_proof")) ctx.addIssue({ code: "custom", message: "Add your business registration document", path: ["files"] });
  if (!v.files.some((f) => f.kind === "pan")) ctx.addIssue({ code: "custom", message: "Add a PAN card (business, or the owner's for a proprietorship)", path: ["files"] });
  if (v.businessDocType === "gst" && v.businessDocNumber && !GSTIN_RE.test(v.businessDocNumber.toUpperCase())) {
    ctx.addIssue({ code: "custom", message: "GSTIN looks wrong (15 characters)", path: ["businessDocNumber"] });
  }
});

class InputError extends Error {}

/** Checks one uploaded file and keeps it private to its uploader. */
async function checkFile(uploaderId: number, f: { kind: keyof typeof FILE_KINDS; path: string; name?: string }): Promise<StoredFile> {
  if (f.path.includes("..")) throw new InputError("Invalid file.");
  const { ObjectStorageService, ObjectNotFoundError } = await import("../../ai_integrations/object_storage/objectStorage");
  const { getObjectAclPolicy, setObjectAclPolicy } = await import("../../ai_integrations/object_storage/objectAcl");
  let file;
  try {
    file = await new ObjectStorageService().getObjectEntityFile(f.path);
  } catch (err) {
    if (err instanceof ObjectNotFoundError) throw new InputError("A file was not uploaded. Please try again.");
    throw err;
  }
  const [meta] = await file.getMetadata();
  const mime = String(meta.contentType || "");
  if (!ALLOWED_MIME.includes(mime)) throw new InputError("Documents must be PDF, JPG or PNG.");
  const size = typeof meta.size === "number" ? meta.size : Number(meta.size ?? 0);
  if (size > MAX_FILE_BYTES) throw new InputError("Each document must be 5 MB or smaller.");
  const acl = await getObjectAclPolicy(file);
  const { mayClaimUpload } = await import("../../ai_integrations/object_storage/upload-owner");
  if ((acl && acl.owner !== String(uploaderId)) || (!acl && !(await mayClaimUpload(f.path, uploaderId)))) {
    throw new InputError("One of the files belongs to someone else.");
  }
  // Private: the uploader only. NeuraTalk reviewers read it through the admin route.
  await setObjectAclPolicy(file, { owner: String(uploaderId), visibility: "private" });
  return { kind: f.kind, path: f.path, name: (f.name || f.kind).slice(0, 200), mimeType: mime, sizeBytes: size };
}

async function notifyCompanyAdmins(businessId: number, title: string, body: string) {
  const admins = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.organizationId, businessId), inArray(users.role, ["company_admin"])));
  for (const a of admins) {
    sendPushNotification(a.id, { title, body, data: { type: "business_notice", businessId: String(businessId) } }).catch(() => undefined);
  }
}

export function registerBusinessVerificationRoutes(app: Express): void {
  const owner = [requireAuth, requireCompanyAccess("businessId"), requireRole("company_admin", "super_admin")];
  const bizId = (req: Request) => {
    const id = Number(req.params.businessId);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  };

  // What the business sees: status, its latest request, and what to upload.
  app.get("/api/business/:businessId/verification", ...owner, async (req: Request, res: Response) => {
    const businessId = bizId(req);
    if (!businessId) return res.status(400).json({ success: false, error: "Invalid business" });
    const [org] = await db.select({ name: organizations.name, legalBusinessName: organizations.legalBusinessName, verifiedAt: organizations.verifiedAt })
      .from(organizations).where(eq(organizations.id, businessId));
    if (!org) return res.status(404).json({ success: false, error: "Business not found" });
    const [latest] = rows<RequestRow>(await db.execute(sql`
      SELECT * FROM business_verification_requests WHERE business_id = ${businessId} ORDER BY submitted_at DESC LIMIT 1`));
    const status = org.verifiedAt ? "verified" : latest?.status === "pending" ? "pending" : latest?.status === "rejected" ? "rejected" : "not_requested";
    return res.json({
      success: true,
      status,
      verifiedAt: org.verifiedAt,
      name: org.name,
      legalName: org.legalBusinessName,
      request: latest ? presentForBusiness(latest) : null,
      requirements: {
        businessDocTypes: Object.entries(BUSINESS_DOC_TYPES).map(([id, label]) => ({ id, label })),
        fileKinds: Object.entries(FILE_KINDS).map(([id, label]) => ({ id, label, required: id === "business_proof" || id === "pan" })),
        formats: "PDF, JPG or PNG",
        maxFileMb: MAX_FILE_BYTES / 1024 / 1024,
        maxFiles: MAX_FILES,
      },
    });
  });

  // Submit documents for review.
  app.post("/api/business/:businessId/verification", ...owner, async (req: Request, res: Response) => {
    const businessId = bizId(req);
    if (!businessId) return res.status(400).json({ success: false, error: "Invalid business" });
    const parsed = submitSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? "Check the details" });
    try {
      const [org] = await db.select({ verifiedAt: organizations.verifiedAt, status: organizations.status }).from(organizations).where(eq(organizations.id, businessId));
      if (!org) return res.status(404).json({ success: false, error: "Business not found" });
      if (org.verifiedAt) return res.status(409).json({ success: false, error: "Your business is already verified." });
      const files: StoredFile[] = [];
      for (const f of parsed.data.files) files.push(await checkFile(req.user!.id, f));
      const d = parsed.data;
      const created = await db.transaction(async (tx) => {
        // One open request at a time: a new submission replaces a pending one.
        await tx.execute(sql`UPDATE business_verification_requests SET status = 'withdrawn' WHERE business_id = ${businessId} AND status = 'pending'`);
        const [row] = rows<RequestRow>(await tx.execute(sql`
          INSERT INTO business_verification_requests
            (business_id, legal_name, brand_name, business_doc_type, business_doc_number, pan_number, website, social_url, files, submitted_by)
          VALUES (${businessId}, ${d.legalName}, ${d.brandName}, ${d.businessDocType}, ${d.businessDocNumber?.toUpperCase() ?? null},
                  ${d.panNumber ?? null}, ${d.website ?? null}, ${d.socialUrl ?? null}, ${JSON.stringify(files)}::jsonb, ${req.user!.id})
          RETURNING *`));
        await tx.update(organizations).set({ verificationRequestedAt: new Date() }).where(eq(organizations.id, businessId));
        return row;
      });
      logger.info("BusinessVerification", "Submitted", { businessId, requestId: created.id, files: files.length });
      return res.status(201).json({ success: true, request: presentForBusiness(created) });
    } catch (err) {
      if (err instanceof InputError) return res.status(400).json({ success: false, error: err.message });
      logger.error("BusinessVerification", "Submit failed", err as Error);
      return res.status(500).json({ success: false, error: "Could not submit. Try again." });
    }
  });

  // ---------- NeuraTalk super admin ----------
  const admin = [requireAuth, requireSuperAdmin];

  app.get("/api/admin/verification-requests", ...admin, async (req: Request, res: Response) => {
    const status = ["pending", "approved", "rejected", "all"].includes(String(req.query.status)) ? String(req.query.status) : "pending";
    const list = rows<RequestRow & { org_name: string; org_logo: string | null; org_phone: string | null; org_email: string | null; verified_at: Date | null; submitter: string | null }>(await db.execute(sql`
      SELECT r.*, o.name AS org_name, o.logo_url AS org_logo, o.phone AS org_phone, o.email AS org_email, o.verified_at,
             COALESCE(NULLIF(u.display_name, ''), u.username, u.phone) AS submitter
      FROM business_verification_requests r
      JOIN organizations o ON o.id = r.business_id
      LEFT JOIN users u ON u.id = r.submitted_by
      WHERE ${status === "all" ? sql`r.status <> 'withdrawn'` : sql`r.status = ${status}`}
      ORDER BY r.submitted_at ${status === "pending" ? sql`ASC` : sql`DESC`}
      LIMIT 200`));
    return res.json({
      success: true,
      requests: list.map((r) => ({
        ...presentForBusiness(r),
        panNumber: r.pan_number, // the reviewer checks the full number against the card
        businessDocNumber: r.business_doc_number,
        business: { id: r.business_id, name: r.org_name, logoUrl: r.org_logo, phone: r.org_phone, email: r.org_email, verified: Boolean(r.verified_at) },
        submittedBy: r.submitter,
        files: (r.files ?? []).map((f, index) => ({ index, kind: f.kind, kindLabel: FILE_KINDS[f.kind] ?? f.kind, name: f.name, mimeType: f.mimeType, sizeBytes: f.sizeBytes })),
      })),
    });
  });

  // Open one document (super admins only; never a public link).
  app.get("/api/admin/verification-requests/:id/files/:index", ...admin, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const index = Number(req.params.index);
    if (!Number.isSafeInteger(id) || !Number.isSafeInteger(index) || index < 0) return res.status(400).json({ error: "Invalid" });
    const [row] = rows<RequestRow>(await db.execute(sql`SELECT * FROM business_verification_requests WHERE id = ${id}`));
    const f = row?.files?.[index];
    if (!f) return res.status(404).json({ error: "Not found" });
    try {
      const { ObjectStorageService } = await import("../../ai_integrations/object_storage/objectStorage");
      const storage = new ObjectStorageService();
      const file = await storage.getObjectEntityFile(f.path);
      res.setHeader("Cache-Control", "private, no-store");
      await storage.downloadObject(file, res, 0, { downloadName: f.name, forceDownload: req.query.download === "1" });
    } catch (err) {
      logger.error("BusinessVerification", "File open failed", err as Error);
      if (!res.headersSent) res.status(404).json({ error: "File not available" });
    }
  });

  app.post("/api/admin/verification-requests/:id/approve", ...admin, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id)) return res.status(400).json({ success: false, error: "Invalid" });
    const parsed = z.object({ brandName: z.string().trim().min(2).max(80).optional(), note: z.string().trim().max(500).optional() }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, error: "Check the name" });
    const [row] = rows<RequestRow>(await db.execute(sql`
      UPDATE business_verification_requests
      SET status = 'approved', reviewed_by = ${req.user!.id}, reviewed_at = now(), decision_reason = ${parsed.data.note ?? null}
      WHERE id = ${id} AND status = 'pending' RETURNING *`));
    if (!row) return res.status(409).json({ success: false, error: "This request was already decided." });
    const brandName = parsed.data.brandName ?? row.brand_name;
    await db.update(organizations).set({
      name: brandName,
      legalBusinessName: row.legal_name,
      verifiedAt: new Date(),
      verifiedBy: req.user!.id,
    }).where(eq(organizations.id, row.business_id));
    await notifyCompanyAdmins(row.business_id, "Your business is verified ✔", `Customers now see the blue tick next to ${brandName}.`);
    logger.info("BusinessVerification", "Approved", { requestId: id, businessId: row.business_id, by: req.user!.id });
    return res.json({ success: true });
  });

  app.post("/api/admin/verification-requests/:id/reject", ...admin, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const parsed = z.object({ reason: z.string().trim().min(5, "Tell the business what to fix").max(500) }).safeParse(req.body ?? {});
    if (!Number.isSafeInteger(id) || !parsed.success) return res.status(400).json({ success: false, error: parsed.success ? "Invalid" : parsed.error.issues[0]?.message });
    const [row] = rows<RequestRow>(await db.execute(sql`
      UPDATE business_verification_requests
      SET status = 'rejected', reviewed_by = ${req.user!.id}, reviewed_at = now(), decision_reason = ${parsed.data.reason}
      WHERE id = ${id} AND status = 'pending' RETURNING *`));
    if (!row) return res.status(409).json({ success: false, error: "This request was already decided." });
    await db.update(organizations).set({ verificationRequestedAt: null }).where(eq(organizations.id, row.business_id));
    await notifyCompanyAdmins(row.business_id, "Verification needs a change", parsed.data.reason);
    logger.info("BusinessVerification", "Rejected", { requestId: id, businessId: row.business_id, by: req.user!.id });
    return res.json({ success: true });
  });
}

/** For dashboards: how many requests are waiting. */
export async function pendingVerificationCount(): Promise<number> {
  const [r] = rows<{ n: number }>(await db.execute(sql`SELECT count(*)::int AS n FROM business_verification_requests WHERE status = 'pending'`));
  return Number(r?.n ?? 0);
}
