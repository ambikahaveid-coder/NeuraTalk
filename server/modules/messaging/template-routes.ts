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

/**
 * Ready-made templates a business can start from (like WhatsApp's template
 * library). They are written to pass review -- updates contain no offers --
 * but are still reviewed once the business saves its own copy.
 */
export const TEMPLATE_LIBRARY = [
  {
    id: "order_confirmed", category: "utility", name: "Order confirmed",
    header: "Order confirmed ✅",
    content: "Hi {{name}}, we received your order {{order_id}}. We will tell you when it is on the way.",
    footer: "Reply here if you have a question",
    buttons: [{ type: "quick_reply", id: "thanks", title: "Thank you" }],
  },
  {
    id: "out_for_delivery", category: "utility", name: "Out for delivery",
    content: "Hi {{name}}, your order {{order_id}} is out for delivery and should reach you by {{time}}.",
    buttons: [{ type: "quick_reply", id: "home", title: "I'm at home" }, { type: "quick_reply", id: "later", title: "Deliver later" }],
  },
  {
    id: "ready_for_pickup", category: "utility", name: "Ready for pickup",
    content: "Hi {{name}}, your order {{order_id}} is ready. You can pick it up today until {{time}}.",
    buttons: [{ type: "quick_reply", id: "coming", title: "I'm coming" }],
  },
  {
    id: "appointment_reminder", category: "utility", name: "Appointment reminder",
    header: "Appointment reminder",
    content: "Hi {{name}}, this is a reminder of your appointment on {{date}} at {{time}}.",
    buttons: [{ type: "quick_reply", id: "confirm", title: "Confirm" }, { type: "quick_reply", id: "reschedule", title: "Reschedule" }],
  },
  {
    id: "payment_received", category: "utility", name: "Payment received",
    content: "Hi {{name}}, we received your payment of ₹{{amount}} for {{order_id}}. Thank you!",
  },
  {
    id: "festival_offer", category: "marketing", name: "Festival offer",
    header: "Festival special 🎉",
    content: "Hi {{name}}, enjoy {{discount}}% off on all products this week. Visit us or order in this chat.",
    footer: "Reply STOP to stop offers",
    buttons: [{ type: "quick_reply", id: "show", title: "Show me" }, { type: "quick_reply", id: "stop", title: "Stop offers" }],
  },
  {
    id: "new_arrivals", category: "marketing", name: "New arrivals",
    content: "Hi {{name}}, new stock has arrived! Take a look before it sells out.",
    buttons: [{ type: "quick_reply", id: "catalog", title: "See catalog" }],
  },
  {
    id: "we_miss_you", category: "marketing", name: "We miss you",
    content: "Hi {{name}}, it has been a while! Here is {{discount}}% off your next order, valid till {{date}}.",
    footer: "Reply STOP to stop offers",
  },
] as const;

export function registerTemplateSendRoutes(app: Express): void {
  const team = [requireAuth, requireCompanyAccess("businessId"), requirePermission(PERMISSIONS.MESSAGING_SEND)];

  app.get("/api/business/:businessId/template-library", ...team, (_req: Request, res: Response) => {
    return res.json({ success: true, templates: TEMPLATE_LIBRARY });
  });

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
