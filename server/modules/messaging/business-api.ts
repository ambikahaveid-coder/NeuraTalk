/**
 * Business API (like the WhatsApp Business Cloud API), for a business's own
 * software, authenticated with its API key (header X-API-Key).
 *
 *   /api/v1/me/<path>   →   the same code the business dashboard and app use, /api/business/<its id>/<path>
 *
 * "me" is always the key's own business, so a key can never reach another
 * business. Requests run as the business's admin with the dashboard's own
 * checks (24-hour rule, template review, consent, limits, billing, pause).
 * Only the endpoints listed in ROUTES are open; team, API keys, payments and
 * approvals stay dashboard-only.
 */
import type { Express, NextFunction, Request, Response } from "express";
import { createApiKeyMiddleware } from "../../api-key-auth";
import { buildApiActorUser } from "../../role-middleware";
import { logger } from "../../observability";
import { businessActorUserId } from "./api-routes";
import { apiNotPaused, recordApiUse } from "./automation-admin";

type Rule = { method: string; path: RegExp; pattern: string; doc: string; target?: string };
const id = "\\d+";
const R = (method: string, p: string, doc: string, target?: string): Rule => ({ method, path: new RegExp(`^${p.replace(/:id/g, id)}$`), pattern: p, doc, target });

/** Open endpoints. `target` (when set) replaces the business path, e.g. uploads. */
export const ROUTES: Rule[] = [
  // Conversations and messages
  R("GET", "/conversations", "List conversations (?status=, ?assignment=, ?limit=, ?offset=)"),
  R("POST", "/chats", "Start a chat with a customer by phone number"),
  R("GET", "/conversations/:id", "One conversation"),
  R("GET", "/conversations/:id/messages", "Message history (customer messages include translatedContent in your language). Marks them read unless ?markRead=false"),
  R("POST", "/conversations/:id/read", "Mark the customer's messages as read (blue ticks)"),
  R("POST", "/conversations/:id/messages", "Send text, a photo/video/document/voice (attachment), a location, reply buttons, a list menu (list), a contact card (contact), a sticker (sticker: WebP/PNG ≤500 KB), or a reply to a message (replyToMessageId); 24-hour rule"),
  R("POST", "/conversations/:id/template", "Send an approved template (any time)"),
  R("POST", "/conversations/:id/products", "Send product cards from your catalog"),
  R("POST", "/conversations/:id/form", "Send a form"),
  R("POST", "/conversations/:id/payment-request", "Ask the customer to pay by UPI: { amountPaise, note?, orderId? }"),
  R("POST", "/conversations/:id/typing", "Show 'typing…' to the customer"),
  R("POST", "/conversations/:id/messages/:id/reaction", "React to a message"),
  R("PATCH", "/conversations/:id/labels", "Set labels on a conversation"),
  R("GET", "/conversations/:id/window", "Is the 24-hour reply window open, and until when"),
  // Customers and consent
  R("GET", "/customers", "List customers"),
  R("POST", "/customers", "Add a customer"),
  R("POST", "/customers/import", "Add many customers"),
  R("GET", "/customers/:id", "One customer"),
  R("PUT", "/customers/:id", "Update a customer"),
  R("POST", "/customers/:id/archive", "Archive a customer"),
  R("GET", "/customers/:id/consent", "What the customer agreed to receive"),
  R("POST", "/customers/:id/consent", "Record consent for updates / offers / codes"),
  // Templates
  R("GET", "/broadcast-templates", "Your templates and their review status"),
  R("POST", "/broadcast-templates", "Create a template; NeuraTalk reviews it before it can be sent"),
  R("GET", "/sendable-templates", "Approved templates you can send now"),
  // Catalog and orders
  R("GET", "/catalog", "Catalog items"),
  R("POST", "/catalog", "Add an item"),
  R("PATCH", "/catalog/:id", "Change an item (price, availability, …)"),
  R("DELETE", "/catalog/:id", "Remove an item"),
  R("GET", "/orders", "Orders customers placed"),
  R("PATCH", "/orders/:id", "Update an order's status (accepted, ready, delivered, cancelled)"),
  // AI receptionist
  R("GET", "/assistant", "AI receptionist: on/off, plan, call minutes left"),
  R("GET", "/assistant/inbox", "Conversations it handled: summaries, order/booking requests (lead), handovers to a person"),
  // Click-to-chat ads inside NeuraTalk
  R("GET", "/ads", "Your ads, their review status, views, chats started and spend"),
  R("POST", "/ads", "Create an ad (NeuraTalk reviews it): { headline, body, button?, dailyBudgetPaise }"),
  R("PATCH", "/ads/:id", "Pause, resume, end, or change the budget/words of an ad"),
  // SMS for customers without NeuraTalk (read-only here; turn on in the dashboard)
  R("GET", "/sms-settings", "Is SMS for customers without NeuraTalk on, which kinds, price, last 30 days"),
  R("GET", "/sms-messages", "SMS sent for you (customer, status, opened)"),
  // UPI payments (money goes straight to your UPI ID; NeuraTalk never holds it)
  R("GET", "/payment-settings", "Your UPI ID for payment requests"),
  R("GET", "/payment-requests", "Payment requests and their status (?status=requested|customer_paid|paid|cancelled)"),
  R("PATCH", "/payment-requests/:id", "Mark a payment request paid (money arrived) or cancelled"),
  // Forms and bots
  R("GET", "/forms", "Forms"),
  R("POST", "/forms", "Create a form"),
  R("PUT", "/forms/:id", "Change a form"),
  R("DELETE", "/forms/:id", "Remove a form"),
  R("GET", "/forms/:id/responses", "Answers to a form"),
  R("GET", "/auto-responders", "Auto-reply bots"),
  R("POST", "/auto-responders", "Add an auto-reply bot"),
  R("PUT", "/auto-responders/:id", "Change an auto-reply bot"),
  R("DELETE", "/auto-responders/:id", "Remove an auto-reply bot"),
  // Business
  R("GET", "/profile", "Business profile"),
  R("PATCH", "/profile", "Update the business profile"),
  R("GET", "/account", "Business account summary"),
  R("GET", "/messaging-stats", "Sent, delivered, read and received in the last 30 days"),
  R("GET", "/credits", "Wallet balance, plan, prices and spending (read-only)"),
  // Media: get an upload address, PUT the file there, then send it as an attachment
  R("POST", "/media", "Get an address to upload a photo/video/document/voice file", "/api/uploads/request-url"),
];

const PREFIX = "/api/v1/me";

/** Register BEFORE the business routes (right after the session user loader). */
export function registerBusinessApiBridge(app: Express): void {
  const keyAuth = createApiKeyMiddleware("business:api");

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path !== PREFIX && !req.path.startsWith(`${PREFIX}/`)) return next();
    // A session token must not mix with a key; the key decides the business.
    if (req.user) req.user = undefined;

    const sub = req.path.slice(PREFIX.length) || "/";
    if (sub === "/" && req.method === "GET") {
      return res.json({ success: true, docs: "https://neuratalk.in/api-docs", endpoints: ROUTES.map((r) => ({ method: r.method, path: PREFIX + r.pattern, description: r.doc })) });
    }
    const rule = ROUTES.find((r) => r.method === req.method && r.path.test(sub));
    if (!rule) return res.status(404).json({ success: false, code: "NOT_AN_API_ENDPOINT", error: `${req.method} ${PREFIX}${sub} is not part of the business API. GET ${PREFIX} lists the endpoints.` });

    keyAuth(req, res, () => recordApiUse(req, res, () => {
      const writes = req.method !== "GET";
      const go = async () => {
        try {
          const businessId = req.apiKey!.organizationId;
          const actor = await buildApiActorUser(await businessActorUserId(businessId));
          if (!actor) return res.status(403).json({ success: false, error: "This business has no active admin account." });
          req.user = actor;
          const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
          req.url = (rule.target ?? `/api/business/${businessId}${sub}`) + query;
          next();
        } catch (error) {
          logger.error("BusinessApi", "bridge failed", error instanceof Error ? error : new Error(String(error)));
          res.status(500).json({ success: false, error: "Couldn't process the request." });
        }
      };
      // Sending and changes stop while NeuraTalk has paused this business's API.
      if (writes) apiNotPaused(req, res, () => { void go(); });
      else void go();
    }));
  });
}
