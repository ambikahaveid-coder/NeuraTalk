import type { Request, Response } from "express";
import { z } from "zod";
import { logger } from "../../observability";
import { AuditHelpers, getAuditLogs } from "../../audit";
import { db } from "../../db";
import { users, callConsents, organizations } from "@shared/schema";
import { eq } from "drizzle-orm";
import * as service from "./service";
import { recordTranscriptCounter, getTranscriptMetricsSnapshot } from "./metrics";

/**
 * Ownership check — matches the convention established in
 * server/voice-training.ts (super_admin bypasses; otherwise requester must
 * be a participant on the call), extended so a company_admin can also
 * reach transcripts belonging to their own org's members (needed for
 * adminExport below) without granting them access to other orgs' calls.
 */
async function canAccessCall(req: Request, callIdentifier: string): Promise<boolean> {
  const user = req.user!;
  if (user.role === "super_admin") return true;

  const owners = await service.getCallOwnerUserIds(callIdentifier);
  if (owners.includes(user.id)) return true;

  const orgId = (user as any).organizationId as number | undefined;
  if (user.role === "company_admin" && orgId && owners.length > 0) {
    const owningUsers = await db.select({ id: users.id }).from(users)
      .where(eq(users.organizationId, orgId));
    const orgUserIds = new Set(owningUsers.map((u) => u.id));
    return owners.some((id) => orgUserIds.has(id));
  }

  return false;
}

export async function getTranscript(req: Request, res: Response) {
  try {
    const callId = req.params.callId;
    if (!(await canAccessCall(req, callId))) {
      return res.status(403).json({ error: "Access denied" });
    }
    const segments = await service.getTranscript(callId);
    res.json({ callId, segments });
  } catch (error) {
    logger.error("Transcripts", `getTranscript failed: ${String(error)}`);
    res.status(500).json({ error: "Failed to fetch transcript" });
  }
}

const searchSchema = z.object({
  q: z.string().min(2).max(200),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export async function search(req: Request, res: Response) {
  try {
    const parsed = searchSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid search request", details: parsed.error.flatten() });
    }
    const user = req.user!;
    const orgScoped = req.query.scope === "org" && (user as any).organizationId;

    const result = await service.searchTranscripts({
      query: parsed.data.q,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
      organizationId: orgScoped ? (user as any).organizationId : undefined,
      userId: orgScoped ? undefined : user.id,
    });
    res.json({ query: parsed.data.q, ...result });
  } catch (error) {
    recordTranscriptCounter("search_failed");
    logger.error("Transcripts", `search failed: ${String(error)}`);
    res.status(500).json({ error: "Search failed" });
  }
}

const EXPORT_FORMATS = ["txt", "pdf", "docx"] as const;

export async function exportTranscript(req: Request, res: Response) {
  try {
    const callId = req.params.callId;
    const format = req.params.format;
    if (!EXPORT_FORMATS.includes(format as any)) {
      return res.status(400).json({ error: `Unsupported format. Use one of: ${EXPORT_FORMATS.join(", ")}` });
    }
    if (!(await canAccessCall(req, callId))) {
      return res.status(403).json({ error: "Access denied" });
    }

    const segments = await service.getTranscript(callId);
    if (segments.length === 0) {
      return res.status(404).json({ error: "No transcript found for this call" });
    }

    const title = `Call Transcript — ${callId}`;
    await AuditHelpers.logCreate(req.user!.id, "transcript_export", 0, { callId, format });

    if (format === "txt") {
      recordTranscriptCounter("exports_txt");
      res.set("Content-Type", "text/plain; charset=utf-8");
      res.set("Content-Disposition", `attachment; filename="transcript-${callId}.txt"`);
      return res.send(service.exportTranscriptAsTxt(segments));
    }
    if (format === "pdf") {
      const buffer = await service.exportTranscriptAsPdf(segments, title);
      recordTranscriptCounter("exports_pdf");
      res.set("Content-Type", "application/pdf");
      res.set("Content-Disposition", `attachment; filename="transcript-${callId}.pdf"`);
      return res.send(buffer);
    }
    const buffer = await service.exportTranscriptAsDocx(segments, title);
    recordTranscriptCounter("exports_docx");
    res.set("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.set("Content-Disposition", `attachment; filename="transcript-${callId}.docx"`);
    return res.send(buffer);
  } catch (error) {
    recordTranscriptCounter("exports_failed");
    logger.error("Transcripts", `export failed: ${String(error)}`);
    res.status(500).json({ error: "Export failed" });
  }
}

export async function deleteTranscript(req: Request, res: Response) {
  try {
    const callId = req.params.callId;
    if (!(await canAccessCall(req, callId))) {
      return res.status(403).json({ error: "Access denied" });
    }
    const deletedCount = await service.deleteTranscript(callId);
    await AuditHelpers.logDelete(req.user!.id, "transcript", 0, { callId, deletedCount });
    res.json({ success: true, deletedCount });
  } catch (error) {
    logger.error("Transcripts", `delete failed: ${String(error)}`);
    res.status(500).json({ error: "Failed to delete transcript" });
  }
}

// === Enterprise Admin ===

function requireOrgAdmin(req: Request, res: Response): number | null {
  const user = req.user!;
  const orgId = (user as any).organizationId as number | undefined;
  if (!orgId || (user.role !== "company_admin" && user.role !== "super_admin")) {
    res.status(403).json({ error: "Organization admin access required" });
    return null;
  }
  return orgId;
}

const adminSearchSchema = z.object({
  q: z.string().min(2).max(200),
  userId: z.coerce.number().int().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export async function adminSearch(req: Request, res: Response) {
  try {
    const orgId = requireOrgAdmin(req, res);
    if (!orgId) return;
    const parsed = adminSearchSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid search request", details: parsed.error.flatten() });
    }
    const result = await service.searchTranscripts({
      query: parsed.data.q,
      organizationId: orgId,
      filterUserId: parsed.data.userId,
      dateFrom: parsed.data.dateFrom ? new Date(parsed.data.dateFrom) : undefined,
      dateTo: parsed.data.dateTo ? new Date(parsed.data.dateTo) : undefined,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });
    res.json({ query: parsed.data.q, ...result });
  } catch (error) {
    recordTranscriptCounter("search_failed");
    logger.error("Transcripts", `admin search failed: ${String(error)}`);
    res.status(500).json({ error: "Search failed" });
  }
}

/**
 * Same handler as the consumer export endpoint — canAccessCall already
 * grants company_admin access to their org's calls, so no separate export
 * implementation is needed here. Kept as a distinctly-named/routed handler
 * only so the enterprise API surface is discoverable at its own URL.
 */
export async function adminExport(req: Request, res: Response) {
  return exportTranscript(req, res);
}

/** Lists org members' current retention preference — visibility for admins. */
export async function getRetentionSettings(req: Request, res: Response) {
  try {
    const orgId = requireOrgAdmin(req, res);
    if (!orgId) return;

    const orgUsers = await db.select({ id: users.id, username: users.username, email: users.email })
      .from(users).where(eq(users.organizationId, orgId));
    const consents = await db.select().from(callConsents);
    const consentByUser = new Map(consents.map((c) => [c.userId, c.dataRetention]));

    const [org] = await db.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, orgId));
    const orgDefault = (org?.settings as Record<string, unknown> | null)?.transcriptRetentionDefault ?? "none (platform default: 30 days)";

    res.json({
      orgDefault,
      members: orgUsers.map((u) => ({
        userId: u.id,
        username: u.username,
        email: u.email,
        retention: consentByUser.get(u.id) ?? "none (falls back to org/platform default)",
      })),
    });
  } catch (error) {
    logger.error("Transcripts", `getRetentionSettings failed: ${String(error)}`);
    res.status(500).json({ error: "Failed to fetch retention settings" });
  }
}

const setOrgRetentionSchema = z.object({
  dataRetention: z.enum(["none", "session", "7days", "30days"]),
});

/**
 * Sets the org-level DEFAULT retention tier, stored in organizations.settings
 * (the same JSON-settings pattern already used for outboundCallerId
 * elsewhere in this codebase — not a new mechanism). This does not override
 * an individual member's own explicit callConsents.dataRetention choice —
 * it only changes what members WITHOUT an explicit preference fall back to.
 */
export async function setOrgRetentionDefault(req: Request, res: Response) {
  try {
    const orgId = requireOrgAdmin(req, res);
    if (!orgId) return;
    const parsed = setOrgRetentionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    const [org] = await db.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, orgId));
    const newSettings = { ...(org?.settings as Record<string, unknown> ?? {}), transcriptRetentionDefault: parsed.data.dataRetention };
    await db.update(organizations).set({ settings: newSettings }).where(eq(organizations.id, orgId));

    await AuditHelpers.logSettingsChange(req.user!.id, "org_transcript_retention_default", org?.settings, newSettings);
    res.json({ success: true, transcriptRetentionDefault: parsed.data.dataRetention });
  } catch (error) {
    logger.error("Transcripts", `setOrgRetentionDefault failed: ${String(error)}`);
    res.status(500).json({ error: "Failed to update retention default" });
  }
}

const TRANSCRIPT_AUDIT_ENTITY_TYPES = ["transcript", "transcript_export", "org_transcript_retention_default"];

/**
 * Audit log visibility for transcript-related admin/user actions, scoped to
 * the requesting admin's org. getAuditLogs() (server/audit.ts) takes a
 * single entityType and has no organizationId filter of its own — rather
 * than modify that shared, already-used-elsewhere function, this queries
 * per entity type and post-filters to org members, which is correct without
 * risking a behavior change for its other callers.
 */
export async function getTranscriptAuditLog(req: Request, res: Response) {
  try {
    const orgId = requireOrgAdmin(req, res);
    if (!orgId) return;

    const orgUsers = await db.select({ id: users.id }).from(users).where(eq(users.organizationId, orgId));
    const orgUserIds = new Set(orgUsers.map((u) => u.id));

    const perType = await Promise.all(
      TRANSCRIPT_AUDIT_ENTITY_TYPES.map((entityType) => getAuditLogs({ entityType, limit: 200 })),
    );
    const logs = perType.flatMap((page) => page.logs)
      .filter((log) => log.userId != null && orgUserIds.has(log.userId))
      .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
      .slice(0, 100);

    res.json({ logs });
  } catch (error) {
    logger.error("Transcripts", `getTranscriptAuditLog failed: ${String(error)}`);
    res.status(500).json({ error: "Failed to fetch audit log" });
  }
}

/** Monitoring dashboard panel data source. */
export async function getMetrics(req: Request, res: Response) {
  const user = req.user!;
  if (user.role !== "super_admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  res.json(getTranscriptMetricsSnapshot());
}
