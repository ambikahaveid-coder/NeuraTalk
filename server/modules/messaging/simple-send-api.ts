/**
 * One-line Send API, for systems that can only call a URL (billing software,
 * SMS-style gateways, Excel macros). Same shape as common Indian reseller
 * panels, so a business can switch by changing the address:
 *
 *   GET or POST /api/v1/send?apikey=KEY&phone=9876543210&text=TEMPLATE_NAME&Params=Ravi,1234
 *   GET or POST /api/v1/send?apikey=KEY&phone=9876543210&message=Your order is ready     (only within 24 h of the customer's last message)
 *   GET or POST /api/v1/send?apikey=KEY&phone=9876543210&stype=auth                     (NeuraTalk makes and checks the code)
 *
 * Differences from those panels, on purpose:
 *  - an API key, never the account password, and the key can be revoked;
 *  - templates must be approved first; {{name}} is filled from the customer
 *    record and Params fill the other variables in order;
 *  - images come from the approved template, not from a URL in the request;
 *  - for codes NeuraTalk generates the code; check it with /api/v1/messaging/otp/:id/verify.
 * Everything goes through the same paid, governed path as the JSON API.
 */
import type { Express, NextFunction, Request, Response } from "express";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { customers, users } from "@shared/schema";
import { normalizePhoneForIndia } from "@shared/phone";
import { createApiKeyMiddleware } from "../../api-key-auth";
import { logger } from "../../observability";
import { createCustomer, DuplicateCustomerError } from "../customers/service";
import * as otp from "../otp/service";
import { approvedTemplates, sendTemplateToCustomer, serviceWindow, ServiceWindowClosedError, TemplateSendError } from "./template-send";
import { findOrCreateCustomerConversation, sendBusinessAgentMessage } from "./service";
import { apiNotPaused, recordApiUse } from "./automation-admin";

const pick = (req: Request, ...names: string[]): string | undefined => {
  const src = { ...(req.query as Record<string, unknown>), ...((req.body && typeof req.body === "object") ? req.body as Record<string, unknown> : {}) };
  for (const n of names) {
    for (const [k, v] of Object.entries(src)) {
      if (k.toLowerCase() === n.toLowerCase() && v !== undefined && v !== null && String(v).trim() !== "") return String(Array.isArray(v) ? v[0] : v).trim();
    }
  }
  return undefined;
};

/** Accepts the key as X-API-Key (preferred) or ?apikey= (for URL-only systems). */
function keyFromQuery(req: Request, _res: Response, next: NextFunction) {
  if (!req.headers["x-api-key"]) {
    const k = pick(req, "apikey", "api_key", "key");
    if (k) req.headers["x-api-key"] = k;
  }
  // Keep the key out of anything that logs the query string later.
  for (const k of Object.keys(req.query)) if (/^(apikey|api_key|key|pass|password)$/i.test(k)) delete (req.query as Record<string, unknown>)[k];
  next();
}

class SimpleSendError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

async function actorUserId(organizationId: number): Promise<number> {
  const [u] = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.organizationId, organizationId), inArray(users.role, ["company_admin", "super_admin"])))
    .orderBy(asc(users.id)).limit(1);
  if (u) return u.id;
  const [any] = await db.select({ id: users.id }).from(users).where(eq(users.organizationId, organizationId)).orderBy(asc(users.id)).limit(1);
  if (!any) throw new SimpleSendError(400, "NO_ACCOUNT", "This business has no user account.");
  return any.id;
}

async function customerFor(organizationId: number, phone: string, name?: string): Promise<number> {
  const normalized = normalizePhoneForIndia(phone);
  if (!normalized) throw new SimpleSendError(400, "BAD_PHONE", "Invalid phone number.");
  const [existing] = await db.select({ id: customers.id }).from(customers)
    .where(and(eq(customers.businessId, organizationId), eq(customers.normalizedPhone, normalized)));
  if (existing) return existing.id;
  try {
    return (await createCustomer(organizationId, await actorUserId(organizationId), { phone, name, source: "import" })).id;
  } catch (error) {
    if (error instanceof DuplicateCustomerError) return error.existingCustomerId;
    throw error;
  }
}

/** Params "a,b,c" (or JSON array) -> the template's variables in order, {{name}} excluded. */
export function variablesFromParams(templateVariables: unknown, params: string | undefined): Record<string, string> {
  const names = (Array.isArray(templateVariables) ? templateVariables : [])
    .map((v) => (typeof v === "string" ? v : (v as { name?: string })?.name))
    .filter((n): n is string => Boolean(n) && n !== "name");
  let values: string[] = [];
  if (params) {
    try {
      const parsed = JSON.parse(params);
      values = Array.isArray(parsed) ? parsed.map(String) : String(params).split(",");
    } catch {
      values = params.split(",");
    }
  }
  const out: Record<string, string> = {};
  names.forEach((n, i) => { if (values[i] !== undefined) out[n] = values[i].trim(); });
  return out;
}

async function handle(req: Request, res: Response) {
  const organizationId = (req as unknown as { apiKey: { organizationId: number } }).apiKey.organizationId;
  const phone = pick(req, "phone", "mobile", "number", "to");
  const templateName = pick(req, "text", "template", "templatename");
  const message = pick(req, "message", "msg");
  const stype = (pick(req, "stype") ?? "normal").toLowerCase();
  const name = pick(req, "name");
  const notes: string[] = [];
  if (pick(req, "htype", "url")) notes.push("Images come from the approved template; htype/url were ignored.");
  if (pick(req, "user", "pass", "password")) notes.push("user/pass are not used; send only your API key.");

  try {
    if (!phone) throw new SimpleSendError(400, "PHONE_REQUIRED", "phone is required.");
    const customerId = await customerFor(organizationId, phone, name);

    if (stype === "auth") {
      const challenge = await otp.createChallenge(organizationId, await actorUserId(organizationId), { customerId, purpose: pick(req, "purpose") ?? "login" });
      return res.status(201).json({ success: true, status: "sent", type: "code", challengeId: challenge.id, expiresAt: challenge.expiresAt, verify: `/api/v1/messaging/otp/${challenge.id}/verify`, notes });
    }

    if (templateName) {
      const all = await approvedTemplates(organizationId);
      const wanted = templateName.toLowerCase();
      const t = all.find((x) => (x.name ?? "").toLowerCase() === wanted) ?? all.find((x) => (x.title ?? "").toLowerCase() === wanted);
      if (!t) throw new SimpleSendError(404, "TEMPLATE_NOT_FOUND", `No approved template named "${templateName}".`);
      const sent = await sendTemplateToCustomer({
        businessId: organizationId, customerId, templateVersionId: t.versionId,
        variables: variablesFromParams(t.variables, pick(req, "params")),
      });
      return res.status(201).json({ success: true, status: "sent", type: "template", messageId: sent.messageId, chargedPaise: sent.chargedPaise, notes });
    }

    if (message) {
      const conversation = await db.transaction((tx) => findOrCreateCustomerConversation(tx, organizationId, customerId));
      const window = await serviceWindow(conversation.businessConversation.conversationId);
      if (!window.open) throw new ServiceWindowClosedError();
      const sent = await sendBusinessAgentMessage({
        businessId: organizationId, businessConversationId: conversation.businessConversation.id,
        authenticatedUserId: await actorUserId(organizationId), content: message.slice(0, 4096),
      });
      return res.status(201).json({ success: true, status: "sent", type: "text", messageId: sent.message.id, notes });
    }
    throw new SimpleSendError(400, "NOTHING_TO_SEND", "Give text=TEMPLATE_NAME, message=..., or stype=auth.");
  } catch (error) {
    if (error instanceof SimpleSendError) return res.status(error.status).json({ success: false, status: "failed", code: error.code, error: error.message });
    if ((error as Error)?.name === TemplateSendError.name) {
      const e = error as TemplateSendError;
      return res.status(e.status).json({ success: false, status: "failed", code: e.code, error: e.message });
    }
    if ((error as Error)?.name === ServiceWindowClosedError.name) {
      return res.status(409).json({ success: false, status: "failed", code: "SERVICE_WINDOW_CLOSED", error: "The customer hasn't written in the last 24 hours. Send an approved template instead." });
    }
    if (error instanceof otp.BillingError) return res.status(402).json({ success: false, status: "failed", code: "NO_CREDIT", error: "Not enough message credit." });
    if (error instanceof otp.ValidationError || error instanceof otp.OtpDeliveryUnavailableError || error instanceof otp.DuplicateChallengeError) {
      return res.status(error instanceof otp.DuplicateChallengeError ? 409 : 400).json({ success: false, status: "failed", error: (error as Error).message });
    }
    logger.error("SimpleSendApi", "send failed", error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ success: false, status: "failed", error: "Message not sent. Try again." });
  }
}

export function registerSimpleSendApi(app: Express): void {
  const auth = createApiKeyMiddleware("messages:send");
  app.get("/api/v1/send", keyFromQuery, auth, recordApiUse, apiNotPaused, handle);
  app.post("/api/v1/send", keyFromQuery, auth, recordApiUse, apiNotPaused, handle);
}
