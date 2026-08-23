import type { Request, Response } from "express";
import { z } from "zod";
import { logger } from "../../observability";
import {
  createBusinessConversation,
  getBusinessConversation,
  createMessage,
  listMessages,
  InvalidParticipantError,
  NotFoundError,
  NotAParticipantError,
  SenderIdentityMismatchError,
} from "./service";
import { MESSAGING_PARTICIPANT_TYPE } from "@shared/schema";

function badRequest(res: Response, msg: string) {
  return res.status(400).json({ success: false, error: msg });
}

const createConversationSchema = z.object({
  additionalParticipants: z.array(z.object({
    participantType: z.enum([MESSAGING_PARTICIPANT_TYPE.USER, MESSAGING_PARTICIPANT_TYPE.BUSINESS]),
    participantId: z.number().int().positive(),
    role: z.string().optional(),
  })).max(50).optional(),
});

export async function createConversation(req: Request, res: Response) {
  const businessId = Number(req.params.businessId);
  if (!Number.isFinite(businessId) || businessId <= 0) return badRequest(res, "Invalid businessId");

  const parsed = createConversationSchema.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error.message);

  try {
    const result = await createBusinessConversation({
      businessId,
      additionalParticipants: parsed.data.additionalParticipants,
    });
    return res.status(201).json({ success: true, conversation: result });
  } catch (error) {
    if (error instanceof NotFoundError) return res.status(404).json({ success: false, error: error.message });
    if (error instanceof InvalidParticipantError) return badRequest(res, error.message);
    logger.error("Messaging", "Failed to create business conversation", error as Error);
    return res.status(500).json({ success: false, error: "Failed to create conversation" });
  }
}

export async function getConversation(req: Request, res: Response) {
  const businessId = Number(req.params.businessId);
  const conversationId = Number(req.params.id);
  if (!Number.isFinite(businessId) || !Number.isFinite(conversationId)) return badRequest(res, "Invalid id");

  const result = await getBusinessConversation(businessId, conversationId);
  if (!result) return res.status(404).json({ success: false, error: "Conversation not found" });
  return res.json({ success: true, conversation: result });
}

const createMessageSchema = z.object({
  // Optional, and NEVER trusted as the write value -- see service.ts's
  // createMessage doc comment. Consistency-check only against the sender
  // identity resolved server-side from the authenticated user (P1 fix,
  // 2026-08-23).
  senderParticipantId: z.number().int().positive().optional(),
  content: z.string().min(1).max(8192),
  messageType: z.string().optional(),
  // category is deliberately NOT accepted here -- structural governance,
  // see doc 24 section 6. Any category field in the request body is ignored.
});

export async function postMessage(req: Request, res: Response) {
  const businessId = Number(req.params.businessId);
  const conversationId = Number(req.params.id);
  if (!Number.isFinite(businessId) || !Number.isFinite(conversationId)) return badRequest(res, "Invalid id");

  const parsed = createMessageSchema.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error.message);

  try {
    const result = await createMessage({
      businessId,
      businessConversationId: conversationId,
      authenticatedUserId: req.user!.id,
      senderParticipantId: parsed.data.senderParticipantId,
      content: parsed.data.content,
      messageType: parsed.data.messageType,
    });
    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    if (error instanceof NotFoundError) return res.status(404).json({ success: false, error: error.message });
    if (error instanceof NotAParticipantError) return res.status(403).json({ success: false, error: error.message });
    if (error instanceof SenderIdentityMismatchError) return res.status(403).json({ success: false, error: error.message });
    const message = error instanceof Error ? error.message : String(error);
    if (message === "VALIDATION_EMPTY_CONTENT") return badRequest(res, "content must not be empty");
    if (message === "VALIDATION_CONTENT_TOO_LONG") return badRequest(res, "content exceeds maximum length");
    logger.error("Messaging", "Failed to create message", error as Error);
    return res.status(500).json({ success: false, error: "Failed to create message" });
  }
}

export async function getMessages(req: Request, res: Response) {
  const businessId = Number(req.params.businessId);
  const conversationId = Number(req.params.id);
  if (!Number.isFinite(businessId) || !Number.isFinite(conversationId)) return badRequest(res, "Invalid id");

  const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
  const offset = req.query.offset !== undefined ? Number(req.query.offset) : undefined;
  if (limit !== undefined && !Number.isFinite(limit)) return badRequest(res, "Invalid limit");
  if (offset !== undefined && !Number.isFinite(offset)) return badRequest(res, "Invalid offset");

  const result = await listMessages(businessId, conversationId, { limit, offset });
  if (!result) return res.status(404).json({ success: false, error: "Conversation not found" });
  return res.json({ success: true, ...result });
}
