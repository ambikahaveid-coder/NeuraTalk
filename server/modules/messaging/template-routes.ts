/**
 * Business app / dashboard: the 24-hour reply window of a chat, the
 * approved templates a business can send, and sending one into a chat.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { businessConversations, PERMISSIONS } from "@shared/schema";
import { requireAuth, requireCompanyAccess, requirePermission } from "../../role-middleware";
import { logger } from "../../observability";
import { approvedTemplates, sendTemplateToCustomer, serviceWindowForBusinessConversation, TemplateSendError } from "./template-send";

function ids(req: Request): { businessId: number; conversationId: number } | null {
  const businessId = Number(req.params.businessId);
  const conversationId = Number(req.params.conversationId ?? 0);
  if (!Number.isSafeInteger(businessId) || businessId <= 0 || !Number.isSafeInteger(conversationId) || conversationId < 0) return null;
  return { businessId, conversationId };
}

export function registerTemplateSendRoutes(app: Express): void {
  const team = [requireAuth, requireCompanyAccess("businessId"), requirePermission(PERMISSIONS.MESSAGING_SEND)];

  app.get("/api/business/:businessId/conversations/:conversationId/window", ...team, async (req: Request, res: Response) => {
    const p = ids(req);
    if (!p) return res.status(400).json({ success: false, error: "Invalid id" });
    try {
      const window = await serviceWindowForBusinessConversation(p.businessId, p.conversationId);
      if (!window) return res.status(404).json({ success: false, error: "Conversation not found" });
      return res.json({ success: true, ...window });
    } catch (error) {
      logger.error("Templates", "window failed", error as Error);
      return res.status(500).json({ success: false, error: "Something went wrong" });
    }
  });

  app.get("/api/business/:businessId/sendable-templates", ...team, async (req: Request, res: Response) => {
    const p = ids(req);
    if (!p) return res.status(400).json({ success: false, error: "Invalid id" });
    try {
      const list = await approvedTemplates(p.businessId);
      return res.json({ success: true, templates: list });
    } catch (error) {
      logger.error("Templates", "list failed", error as Error);
      return res.status(500).json({ success: false, error: "Something went wrong" });
    }
  });

  app.post("/api/business/:businessId/conversations/:conversationId/template", ...team, async (req: Request, res: Response) => {
    const p = ids(req);
    if (!p) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = z.object({
      templateVersionId: z.number().int().positive(),
      variables: z.record(z.unknown()).optional(),
    }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, error: "Pick a template." });
    try {
      const [conv] = await db.select({ customerId: businessConversations.customerId }).from(businessConversations)
        .where(and(eq(businessConversations.id, p.conversationId), eq(businessConversations.businessId, p.businessId)));
      if (!conv?.customerId) return res.status(404).json({ success: false, error: "Conversation not found" });
      const sent = await sendTemplateToCustomer({
        businessId: p.businessId, customerId: conv.customerId, templateVersionId: parsed.data.templateVersionId, variables: parsed.data.variables,
      });
      return res.status(201).json({ success: true, messageId: sent.messageId, chargedPaise: sent.chargedPaise });
    } catch (error) {
      if ((error as Error)?.name === TemplateSendError.name) {
        const e = error as TemplateSendError;
        return res.status(e.status).json({ success: false, code: e.code, error: e.message });
      }
      logger.error("Templates", "send failed", error as Error);
      return res.status(500).json({ success: false, error: "Could not send. Try again." });
    }
  });
}
