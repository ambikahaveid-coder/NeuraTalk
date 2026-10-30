/**
 * Business messaging rules, the way WhatsApp Business works:
 *
 * 1. 24-hour customer service window. When a customer has written in the
 *    last 24 hours the business may reply freely (text, photo, video, PDF).
 *    Otherwise the business can only send a template NeuraTalk approved.
 *    This is what separates a business message from a normal chat: a shop
 *    cannot advertise by just typing to someone who never wrote to it.
 *
 * 2. Sending one approved template to one customer (from the Business app
 *    or the API). Same checks as a broadcast: approved version of this
 *    business, marketing consent + frequency cap, NeuraTalk restriction and
 *    daily limit, wallet charge. Template media (photo/video/PDF header,
 *    approved together with the text) travels as an attachment.
 */
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  businessConversations, customers, messagingAttachments, messagingDeliveries, messagingEvents, messagingMessages,
  messagingParticipants, templates, templateVersions,
  CUSTOMER_STATUS, MESSAGE_CATEGORY, MESSAGE_DELIVERY_STATUS, MESSAGE_EVENT_TYPE, MESSAGE_TYPE, MESSAGING_PARTICIPANT_TYPE,
  TEMPLATE_VERSION_STATUS, type TemplateVariableDeclaration,
} from "@shared/schema";
import { renderTemplateContent, TemplateRenderError } from "../templates/render";
import { isEligibleForChannel, linkCustomerToNeuraTalkUser } from "../customers/service";
import { reserveBusinessThroughputSlot, reserveCustomerFrequencySlot } from "../campaigns/frequency";
import { chargeCampaignMessage } from "../campaigns/billing";
import { campaignPricePaise } from "./pricing";
import { createDailyMessagingGate } from "./account-health";
import { findOrCreateCustomerConversation } from "./service";
import { deliverCommittedMessage } from "./delivery";

export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export class ServiceWindowClosedError extends Error {
  constructor() {
    super("The customer hasn't written in the last 24 hours. Send an approved template instead — they can reply to it.");
    this.name = "ServiceWindowClosedError";
  }
}

export class TemplateSendError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) {
    super(message);
    this.name = "TemplateSendError";
  }
}

/** When the customer last wrote in this conversation, and whether the business may still reply freely. */
export async function serviceWindow(conversationId: number): Promise<{ open: boolean; lastCustomerMessageAt: Date | null; closesAt: Date | null }> {
  // "Within 24 hours" is decided by the database's own clock, the same clock
  // that stamped created_at -- correct whatever timezone the servers use.
  const [row] = await db.select({
    at: sql<Date | null>`max(${messagingMessages.createdAt})`.mapWith(messagingMessages.createdAt),
    open: sql<boolean>`coalesce(max(${messagingMessages.createdAt}) > now() - interval '24 hours', false)`,
  })
    .from(messagingMessages)
    .innerJoin(messagingParticipants, eq(messagingParticipants.id, messagingMessages.senderParticipantId))
    .where(and(
      eq(messagingMessages.conversationId, conversationId),
      isNull(messagingMessages.deletedAt),
      or(
        eq(messagingParticipants.participantType, MESSAGING_PARTICIPANT_TYPE.CUSTOMER),
        and(eq(messagingParticipants.participantType, MESSAGING_PARTICIPANT_TYPE.USER), eq(messagingParticipants.role, "customer")),
      ),
    ));
  const last = row?.at ? new Date(row.at) : null;
  if (!last) return { open: false, lastCustomerMessageAt: null, closesAt: null };
  const closesAt = new Date(last.getTime() + SERVICE_WINDOW_MS);
  return { open: row?.open === true || String(row?.open) === "true", lastCustomerMessageAt: last, closesAt };
}

export async function serviceWindowForBusinessConversation(businessId: number, businessConversationId: number) {
  const [conv] = await db.select({ conversationId: businessConversations.conversationId }).from(businessConversations)
    .where(and(eq(businessConversations.id, businessConversationId), eq(businessConversations.businessId, businessId)));
  if (!conv) return null;
  return serviceWindow(conv.conversationId);
}

/** A business's approved templates that can be sent to one customer (marketing / utility). */
export async function approvedTemplates(businessId: number) {
  const rows = await db.select({
    templateId: templates.id,
    name: templates.name,
    category: templates.category,
    versionId: templateVersions.id,
    title: templateVersions.title,
    content: templateVersions.content,
    variables: templateVersions.variables,
    mediaType: templateVersions.mediaType,
    mediaUrl: templateVersions.mediaUrl,
    language: templateVersions.language,
  }).from(templateVersions)
    .innerJoin(templates, eq(templates.id, templateVersions.templateId))
    .where(and(
      eq(templates.businessId, businessId),
      eq(templateVersions.status, TEMPLATE_VERSION_STATUS.APPROVED),
      inArray(templates.category, [MESSAGE_CATEGORY.MARKETING, MESSAGE_CATEGORY.UTILITY]),
    ))
    .orderBy(desc(templateVersions.id))
    .limit(100);
  return rows;
}

const MEDIA_MIME: Record<string, string> = { image: "image/jpeg", video: "video/mp4", document: "application/pdf" };

/** What a template may carry (WhatsApp-like limits). */
const TEMPLATE_MEDIA: Record<string, { types: string[]; maxBytes: number }> = {
  image: { types: ["image/jpeg", "image/png", "image/webp"], maxBytes: 5 * 1024 * 1024 },
  video: { types: ["video/mp4", "video/3gpp"], maxBytes: 16 * 1024 * 1024 },
  document: { types: ["application/pdf"], maxBytes: 20 * 1024 * 1024 },
};

/**
 * Checks a file uploaded to NeuraTalk for use in a template and makes it
 * readable by any customer (it is reviewed by NeuraTalk with the text).
 * Only NeuraTalk storage paths: never an outside link.
 */
export async function prepareTemplateMedia(ownerUserId: number, path: string): Promise<{ mediaType: string; mediaUrl: string; mimeType: string }> {
  if (!path.startsWith("/objects/") || path.includes("..")) throw new TemplateSendError("Upload the photo, video or PDF to NeuraTalk first.", "MEDIA_INVALID");
  const { ObjectStorageService } = await import("../../ai_integrations/object_storage/objectStorage");
  const { getObjectAclPolicy, setObjectAclPolicy } = await import("../../ai_integrations/object_storage/objectAcl");
  let file;
  try {
    file = await new ObjectStorageService().getObjectEntityFile(path);
  } catch {
    throw new TemplateSendError("The file was not uploaded. Try again.", "MEDIA_NOT_FOUND");
  }
  const [meta] = await file.getMetadata();
  const mime = String(meta.contentType || "");
  const kind = Object.entries(TEMPLATE_MEDIA).find(([, rule]) => rule.types.includes(mime))?.[0];
  if (!kind) throw new TemplateSendError("Use a JPG/PNG photo, an MP4 video or a PDF.", "MEDIA_TYPE");
  if (typeof meta.size === "number" && meta.size > TEMPLATE_MEDIA[kind].maxBytes) {
    throw new TemplateSendError(`That file is too large (max ${Math.round(TEMPLATE_MEDIA[kind].maxBytes / 1024 / 1024)} MB).`, "MEDIA_TOO_LARGE");
  }
  const existing = await getObjectAclPolicy(file);
  const { mayClaimUpload } = await import("../../ai_integrations/object_storage/upload-owner");
  if ((existing && existing.owner !== String(ownerUserId)) || (!existing && !(await mayClaimUpload(path, ownerUserId)))) {
    throw new TemplateSendError("This file belongs to someone else.", "MEDIA_NOT_OWNED", 403);
  }
  await setObjectAclPolicy(file, { owner: String(ownerUserId), visibility: "public" });
  return { mediaType: kind, mediaUrl: path, mimeType: mime };
}

export interface SendTemplateInput {
  businessId: number;
  customerId: number;
  templateVersionId: number;
  variables?: Record<string, unknown>;
}

export interface SendTemplateResult {
  messageId: number;
  businessConversationId: number;
  chargedPaise: number;
  content: string;
}

export async function sendTemplateToCustomer(input: SendTemplateInput): Promise<SendTemplateResult> {
  const [version] = await db.select().from(templateVersions).where(eq(templateVersions.id, input.templateVersionId));
  const [template] = version ? await db.select().from(templates).where(eq(templates.id, version.templateId)) : [];
  if (!version || !template || template.businessId !== input.businessId) throw new TemplateSendError("Template not found.", "TEMPLATE_NOT_FOUND", 404);
  if (version.status !== TEMPLATE_VERSION_STATUS.APPROVED) throw new TemplateSendError("NeuraTalk hasn't approved this template yet.", "TEMPLATE_NOT_APPROVED");
  if (template.category !== MESSAGE_CATEGORY.MARKETING && template.category !== MESSAGE_CATEGORY.UTILITY) {
    throw new TemplateSendError("Codes are sent with the OTP API, not as a template message.", "WRONG_CATEGORY");
  }

  const [customer] = await db.select().from(customers).where(and(eq(customers.id, input.customerId), eq(customers.businessId, input.businessId)));
  if (!customer) throw new TemplateSendError("Customer not found.", "CUSTOMER_NOT_FOUND", 404);
  if (customer.status !== CUSTOMER_STATUS.ACTIVE) throw new TemplateSendError("This customer is blocked or archived.", "CUSTOMER_INACTIVE", 409);
  if (customer.blockedByCustomerAt) throw new TemplateSendError("This customer has blocked your business.", "BLOCKED_BY_CUSTOMER", 409);
  if (!customer.linkedUserId && !(await linkCustomerToNeuraTalkUser(customer))) {
    throw new TemplateSendError("This customer isn't on NeuraTalk yet. Invite them first.", "NOT_ON_NEURATALK", 409);
  }
  if (template.category === MESSAGE_CATEGORY.MARKETING && !(await isEligibleForChannel(input.businessId, customer.id, MESSAGE_CATEGORY.MARKETING as any))) {
    throw new TemplateSendError("This customer hasn't agreed to receive offers from you.", "NO_MARKETING_CONSENT", 409);
  }

  const gate = await createDailyMessagingGate(input.businessId);
  if (gate.restricted) throw new TemplateSendError("NeuraTalk has paused your business messages. See Tools → account health.", "BUSINESS_RESTRICTED", 403);
  if (!gate.allow(customer.id)) throw new TemplateSendError("You reached today's limit of new customer conversations.", "DAILY_LIMIT_REACHED", 429);

  let rendered: string;
  try {
    const values: Record<string, unknown> = { ...(input.variables ?? {}) };
    const declared = ((version.variables as TemplateVariableDeclaration[]) ?? []);
    if (customer.name && declared.some((d) => d.name === "name") && values.name === undefined) values.name = customer.name;
    rendered = renderTemplateContent(version.content, declared, values).rendered;
  } catch (err) {
    if (err instanceof TemplateRenderError) throw new TemplateSendError(err.message, "TEMPLATE_VARIABLES");
    throw err;
  }

  let price = 10;
  try { price = await campaignPricePaise(template.category); } catch { /* default */ }

  const result = await db.transaction(async (tx) => {
    if (template.category === MESSAGE_CATEGORY.MARKETING) {
      const slot = await reserveCustomerFrequencySlot(tx, input.businessId, customer.id);
      if (!slot.allowed) throw new TemplateSendError("This customer already got enough offers from you today.", "FREQUENCY_CAP", 429);
      const throughput = await reserveBusinessThroughputSlot(tx, input.businessId);
      if (!throughput.allowed) throw new TemplateSendError("Too many offers this hour. Try again later.", "THROUGHPUT_CAP", 429);
    }
    const charge = await chargeCampaignMessage(tx, input.businessId, price);
    if (!charge.charged) {
      throw new TemplateSendError(
        charge.reason === "billing_not_configured" ? "Billing isn't set up for your business yet." : "Not enough balance in your wallet.",
        charge.reason === "billing_not_configured" ? "BILLING_NOT_CONFIGURED" : "INSUFFICIENT_CREDIT",
        402,
      );
    }
    const { conversation, businessConversation, participants } = await findOrCreateCustomerConversation(tx, input.businessId, customer.id);
    const business = participants.find((p) => p.participantType === MESSAGING_PARTICIPANT_TYPE.BUSINESS);
    // Same recipient as a broadcast: the conversation's customer record.
    const recipients = participants.filter((p) => p.participantType === MESSAGING_PARTICIPANT_TYPE.CUSTOMER);
    if (!business || recipients.length === 0) throw new TemplateSendError("Could not open the chat.", "SYSTEM_ERROR", 500);

    const [message] = await tx.insert(messagingMessages).values({
      conversationId: conversation.id,
      senderParticipantId: business.id,
      messageType: MESSAGE_TYPE.TEMPLATE,
      category: template.category,
      content: rendered,
      templateId: template.id,
    }).returning();
    if (version.mediaUrl && version.mediaType && version.mediaUrl.startsWith("/objects/")) {
      await tx.insert(messagingAttachments).values({
        messageId: message.id,
        attachmentType: version.mediaType,
        url: version.mediaUrl,
        mimeType: ((version.metadata as { mediaMimeType?: string } | null)?.mediaMimeType) ?? MEDIA_MIME[version.mediaType] ?? null,
      });
    }
    await tx.insert(messagingDeliveries).values(recipients.map((p) => ({
      messageId: message.id, participantId: p.id, status: MESSAGE_DELIVERY_STATUS.QUEUED,
    })));
    await tx.insert(messagingEvents).values({
      conversationId: conversation.id,
      messageId: message.id,
      eventType: MESSAGE_EVENT_TYPE.MESSAGE_CREATED,
      payload: { senderParticipantId: business.id, recipientCount: recipients.length, generationSource: { type: "template", id: version.id } },
    });
    return { messageId: message.id, businessConversationId: businessConversation.id, chargedPaise: charge.costPaise ?? price, content: rendered };
  });

  await deliverCommittedMessage({ businessId: input.businessId, businessConversationId: result.businessConversationId, messageId: result.messageId, publishCreated: true });
  return result;
}
