import type { Request, Response } from "express";
import { z } from "zod";
import type { AuthenticatedUser } from "../../role-middleware";
import { AuditHelpers } from "../../audit";
import { logger } from "../../observability";
import {
  registerWebhookEndpoint,
  listWebhookEndpoints,
  deleteWebhookEndpoint,
  setWebhookEndpointActive,
  updateWebhookEndpoint,
  rotateWebhookSecret,
  isValidWebhookEventType,
} from "./service";

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

const createWebhookSchema = z.object({
  url: z.string().url(),
  subscribedEvents: z.array(z.string()).min(1),
});

export async function createWebhook(req: Request, res: Response) {
  const user = getUser(req);
  const orgId = Number(req.params.orgId);
  if (!Number.isFinite(orgId)) return badRequest(res, "Invalid orgId");
  if (!isOrgAdmin(user, orgId)) return forbidden(res);

  const parsed = createWebhookSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error.message);

  const unknownEvents = parsed.data.subscribedEvents.filter((e) => !isValidWebhookEventType(e));
  if (unknownEvents.length > 0) {
    return badRequest(res, `Unknown event types: ${unknownEvents.join(", ")}`);
  }

  try {
    const endpoint = await registerWebhookEndpoint({
      organizationId: orgId,
      url: parsed.data.url,
      subscribedEvents: parsed.data.subscribedEvents,
      createdBy: user.id,
    });
    await AuditHelpers.logCreate(user.id, "webhook_endpoint", endpoint.id, { url: endpoint.url, orgId });
    // The signing secret is returned ONCE, on creation — same convention as
    // an API key — never retrievable again via GET.
    return res.status(201).json({ success: true, webhook: endpoint });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "WEBHOOK_URL_MUST_BE_HTTPS") {
      return badRequest(res, "Webhook URL must use HTTPS");
    }
    logger.error("Webhooks", "Failed to register webhook endpoint", error as Error);
    return res.status(500).json({ success: false, error: "Failed to register webhook" });
  }
}

export async function listWebhooks(req: Request, res: Response) {
  const user = getUser(req);
  const orgId = Number(req.params.orgId);
  if (!Number.isFinite(orgId)) return badRequest(res, "Invalid orgId");
  if (!isOrgAdmin(user, orgId)) return forbidden(res);

  const webhooks = await listWebhookEndpoints(orgId);
  return res.json({ success: true, webhooks });
}

export async function deleteWebhook(req: Request, res: Response) {
  const user = getUser(req);
  const orgId = Number(req.params.orgId);
  const webhookId = Number(req.params.webhookId);
  if (!Number.isFinite(orgId) || !Number.isFinite(webhookId)) return badRequest(res, "Invalid id");
  if (!isOrgAdmin(user, orgId)) return forbidden(res);

  const deleted = await deleteWebhookEndpoint(orgId, webhookId);
  if (!deleted) return res.status(404).json({ success: false, error: "Webhook not found" });
  await AuditHelpers.logDelete(user.id, "webhook_endpoint", webhookId, { orgId });
  return res.json({ success: true });
}

const updateWebhookSchema = z.object({
  url: z.string().url().optional(),
  subscribedEvents: z.array(z.string()).min(1).optional(),
}).refine((v) => v.url || v.subscribedEvents, { message: "Provide url and/or subscribedEvents" });

export async function updateWebhook(req: Request, res: Response) {
  const user = getUser(req);
  const orgId = Number(req.params.orgId);
  const webhookId = Number(req.params.webhookId);
  if (!Number.isFinite(orgId) || !Number.isFinite(webhookId)) return badRequest(res, "Invalid id");
  if (!isOrgAdmin(user, orgId)) return forbidden(res);

  const parsed = updateWebhookSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error.message);

  try {
    const updated = await updateWebhookEndpoint(orgId, webhookId, parsed.data);
    if (!updated) return res.status(404).json({ success: false, error: "Webhook not found" });
    await AuditHelpers.logSettingsChange(user.id, "webhook_endpoint_update", null, { orgId, webhookId, ...parsed.data });
    return res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "WEBHOOK_URL_MUST_BE_HTTPS") return badRequest(res, "Webhook URL must use HTTPS");
    if (message.startsWith("UNKNOWN_EVENT_TYPES:")) return badRequest(res, message);
    logger.error("Webhooks", "Failed to update webhook endpoint", error as Error);
    return res.status(500).json({ success: false, error: "Failed to update webhook" });
  }
}

/**
 * Rotate a webhook's signing secret (P1 foundation hardening, 2026-08-23).
 * Same one-time-display contract as creation -- returned once in this response,
 * never retrievable again via GET.
 */
export async function rotateWebhook(req: Request, res: Response) {
  const user = getUser(req);
  const orgId = Number(req.params.orgId);
  const webhookId = Number(req.params.webhookId);
  if (!Number.isFinite(orgId) || !Number.isFinite(webhookId)) return badRequest(res, "Invalid id");
  if (!isOrgAdmin(user, orgId)) return forbidden(res);

  const secret = await rotateWebhookSecret(orgId, webhookId);
  if (!secret) return res.status(404).json({ success: false, error: "Webhook not found" });
  await AuditHelpers.logSettingsChange(user.id, "webhook_endpoint_secret_rotated", null, { orgId, webhookId });
  return res.json({ success: true, secret, message: "Secret rotated. Save it now - it will not be shown again." });
}

const toggleWebhookSchema = z.object({ isActive: z.boolean() });

export async function toggleWebhook(req: Request, res: Response) {
  const user = getUser(req);
  const orgId = Number(req.params.orgId);
  const webhookId = Number(req.params.webhookId);
  if (!Number.isFinite(orgId) || !Number.isFinite(webhookId)) return badRequest(res, "Invalid id");
  if (!isOrgAdmin(user, orgId)) return forbidden(res);

  const parsed = toggleWebhookSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error.message);

  const updated = await setWebhookEndpointActive(orgId, webhookId, parsed.data.isActive);
  if (!updated) return res.status(404).json({ success: false, error: "Webhook not found" });
  await AuditHelpers.logSettingsChange(user.id, "webhook_endpoint_toggle", null, { orgId, webhookId, isActive: parsed.data.isActive });
  return res.json({ success: true });
}
