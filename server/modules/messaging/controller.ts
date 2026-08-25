import type { Request, Response } from "express";
import { z } from "zod";
import { logger } from "../../observability";
import {
  createBusinessConversation,
  getBusinessConversation,
  listMessages,
  sendUserInitiatedMessage,
  sendBusinessAgentMessage,
  listBusinessConversations,
  claimConversation,
  unassignConversation,
  adminSetConversationAssignment,
  listEligibleAssignees,
  getPublicBusinessIdentity,
  listUserInitiatedMessages,
  InvalidParticipantError,
  NotFoundError,
  NotAParticipantError,
  SenderIdentityMismatchError,
  AssignmentConflictError,
  NotYourAssignmentError,
  InvalidAssigneeError,
  type ConversationAssignmentFilter,
} from "./service";
import { subscribeToBusinessEvents, subscribeToConsumerEvents, type MessagingRealtimeEvent } from "./realtime";
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

const ASSIGNMENT_FILTER_VALUES: ConversationAssignmentFilter[] = ["all", "mine", "unassigned"];

// P1-5: the Business Inbox's conversation list -- see listBusinessConversations's
// doc comment in service.ts for why this route didn't already exist.
// P1-6: added the ?assignment= filter; "mine" resolves against req.user.id,
// never a client-supplied user id.
export async function listConversations(req: Request, res: Response) {
  const businessId = Number(req.params.businessId);
  if (!Number.isFinite(businessId) || businessId <= 0) return badRequest(res, "Invalid businessId");

  const rawAssignment = typeof req.query.assignment === "string" ? req.query.assignment : "all";
  if (!ASSIGNMENT_FILTER_VALUES.includes(rawAssignment as ConversationAssignmentFilter)) {
    return badRequest(res, "Invalid assignment filter");
  }
  const assignment = rawAssignment as ConversationAssignmentFilter;

  try {
    const conversations = await listBusinessConversations(businessId, { assignment, viewerUserId: req.user!.id });
    return res.json({ success: true, conversations });
  } catch (error) {
    logger.error("Messaging", "Failed to list business conversations", error as Error);
    return res.status(500).json({ success: false, error: "Failed to load conversations" });
  }
}

// P1-6: self-claim -- authenticatedUserId always from req.user.id.
export async function claimConversationHandler(req: Request, res: Response) {
  const businessId = Number(req.params.businessId);
  const conversationId = Number(req.params.id);
  if (!Number.isFinite(businessId) || !Number.isFinite(conversationId)) return badRequest(res, "Invalid id");

  try {
    const conversation = await claimConversation(businessId, conversationId, req.user!.id);
    return res.json({ success: true, conversation });
  } catch (error) {
    if (error instanceof NotFoundError) return res.status(404).json({ success: false, error: error.message });
    if (error instanceof AssignmentConflictError) return res.status(409).json({ success: false, error: error.message });
    logger.error("Messaging", "Failed to claim conversation", error as Error);
    return res.status(500).json({ success: false, error: "Failed to claim conversation" });
  }
}

// P1-6: self-unassign -- authenticatedUserId always from req.user.id; only
// releases the caller's OWN assignment (see unassignConversation's doc
// comment in service.ts for why this doesn't let anyone clear anyone
// else's).
export async function unassignConversationHandler(req: Request, res: Response) {
  const businessId = Number(req.params.businessId);
  const conversationId = Number(req.params.id);
  if (!Number.isFinite(businessId) || !Number.isFinite(conversationId)) return badRequest(res, "Invalid id");

  try {
    const conversation = await unassignConversation(businessId, conversationId, req.user!.id);
    return res.json({ success: true, conversation });
  } catch (error) {
    if (error instanceof NotFoundError) return res.status(404).json({ success: false, error: error.message });
    if (error instanceof NotYourAssignmentError) return res.status(403).json({ success: false, error: error.message });
    logger.error("Messaging", "Failed to unassign conversation", error as Error);
    return res.status(500).json({ success: false, error: "Failed to unassign conversation" });
  }
}

// P1-7: company_admin/super_admin-only. assigneeUserId: a positive integer
// to assign/reassign, or null to unassign -- never omitted-vs-null
// ambiguity (z.object requires the key; .nullable() accepts exactly
// `null`, not undefined), so "clear the assignment" is always explicit.
const assignmentSchema = z.object({
  assigneeUserId: z.number().int().positive().nullable(),
});

// P1-7: route-gated by requireRole("company_admin", "super_admin") (see
// routes.ts) -- actingUserId always req.user.id, targetUserId always the
// validated request body field, both businessId/conversationId always the
// URL params. No field here can be used to spoof who is acting.
export async function setConversationAssignmentHandler(req: Request, res: Response) {
  const businessId = Number(req.params.businessId);
  const conversationId = Number(req.params.id);
  if (!Number.isFinite(businessId) || !Number.isFinite(conversationId)) return badRequest(res, "Invalid id");

  const parsed = assignmentSchema.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error.message);

  try {
    const conversation = await adminSetConversationAssignment(businessId, conversationId, req.user!.id, parsed.data.assigneeUserId);
    return res.json({ success: true, conversation });
  } catch (error) {
    if (error instanceof NotFoundError) return res.status(404).json({ success: false, error: error.message });
    if (error instanceof InvalidAssigneeError) return res.status(403).json({ success: false, error: error.message });
    logger.error("Messaging", "Failed to set conversation assignment", error as Error);
    return res.status(500).json({ success: false, error: "Failed to update assignment" });
  }
}

// P1-7: same role gate as setConversationAssignmentHandler -- this list is
// only ever consumed by the admin reassignment picker.
export async function listEligibleAssigneesHandler(req: Request, res: Response) {
  const businessId = Number(req.params.businessId);
  if (!Number.isFinite(businessId) || businessId <= 0) return badRequest(res, "Invalid businessId");

  try {
    const members = await listEligibleAssignees(businessId);
    return res.json({ success: true, members });
  } catch (error) {
    logger.error("Messaging", "Failed to list eligible assignees", error as Error);
    return res.status(500).json({ success: false, error: "Failed to load members" });
  }
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
    // P1-5: sendBusinessAgentMessage (not createMessage directly) --
    // auto-joins the authenticated, already-authorized agent as a
    // participant on first reply to a conversation, so the Business Inbox
    // works for any agent, not only whoever happened to create the
    // conversation. See its doc comment in service.ts for the full
    // reasoning; sender identity/tenant checks are unchanged.
    const result = await sendBusinessAgentMessage({
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

// P1-2 (2026-08-25): consumer-facing entry point -- a normal NeuraTalk user
// (not a business employee) messaging a business. Same content limit
// (8192) as createMessageSchema above -- that's the existing canonical
// messaging limit (also enforced again server-side in
// sendUserInitiatedMessage -> createMessageTx), not a new one invented
// here. No senderParticipantId field: unlike postMessage (used by an
// already-a-participant business agent replying inside a known
// conversation), this caller never knows the conversation/participant ids
// up front -- sendUserInitiatedMessage resolves/creates all of that itself.
const sendUserMessageSchema = z.object({
  content: z.string().min(1).max(8192),
  messageType: z.string().optional(),
});

export async function sendUserMessage(req: Request, res: Response) {
  const businessId = Number(req.params.businessId);
  if (!Number.isFinite(businessId) || businessId <= 0) return badRequest(res, "Invalid businessId");

  const parsed = sendUserMessageSchema.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error.message);

  try {
    // authenticatedUserId comes exclusively from the session (req.user.id,
    // set by requireAuth from the verified token/cookie) -- never from
    // req.body, and sendUserMessageSchema above has no field a client could
    // use to supply a competing id even if it tried.
    const result = await sendUserInitiatedMessage({
      businessId,
      authenticatedUserId: req.user!.id,
      content: parsed.data.content,
      messageType: parsed.data.messageType,
    });
    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    if (error instanceof NotFoundError) return res.status(404).json({ success: false, error: error.message });
    // Not expected on this path (sendUserInitiatedMessage always resolves/
    // creates the caller's own participant before creating the message),
    // but mapped defensively for consistency with postMessage above rather
    // than falling through to a generic 500 if the invariant ever changes.
    if (error instanceof NotAParticipantError) return res.status(403).json({ success: false, error: error.message });
    if (error instanceof SenderIdentityMismatchError) return res.status(403).json({ success: false, error: error.message });
    const message = error instanceof Error ? error.message : String(error);
    if (message === "VALIDATION_EMPTY_CONTENT") return badRequest(res, "content must not be empty");
    if (message === "VALIDATION_CONTENT_TOO_LONG") return badRequest(res, "content exceeds maximum length");
    logger.error("Messaging", "Failed to send user-initiated message", error as Error);
    return res.status(500).json({ success: false, error: "Failed to send message" });
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

// P1-3A Part A: consumer-facing, requireAuth only (see routes.ts) -- any
// authenticated NeuraTalk user may look up a business's public identity,
// not just its members. getPublicBusinessIdentity's explicit column list is
// the actual safety boundary; this handler adds no further filtering.
export async function getBusinessIdentity(req: Request, res: Response) {
  const businessId = Number(req.params.businessId);
  if (!Number.isFinite(businessId) || businessId <= 0) return badRequest(res, "Invalid businessId");

  try {
    const identity = await getPublicBusinessIdentity(businessId);
    if (!identity) return res.status(404).json({ success: false, error: "Business not found" });
    return res.json({ success: true, business: identity });
  } catch (error) {
    logger.error("Messaging", "Failed to fetch business identity", error as Error);
    return res.status(500).json({ success: false, error: "Failed to load business" });
  }
}

// P1-3A Part B: consumer-facing read counterpart to sendUserMessage.
// authenticatedUserId comes exclusively from req.user.id, exactly like
// sendUserMessage -- there is no query/body field that could supply a
// competing identity. requireAuth only (see routes.ts), no
// requireCompanyAccess: the caller reads THEIR OWN conversation with this
// business, not the business's internal conversation list.
export async function getUserMessages(req: Request, res: Response) {
  const businessId = Number(req.params.businessId);
  if (!Number.isFinite(businessId) || businessId <= 0) return badRequest(res, "Invalid businessId");

  const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
  const offset = req.query.offset !== undefined ? Number(req.query.offset) : undefined;
  if (limit !== undefined && !Number.isFinite(limit)) return badRequest(res, "Invalid limit");
  if (offset !== undefined && !Number.isFinite(offset)) return badRequest(res, "Invalid offset");

  try {
    const result = await listUserInitiatedMessages(businessId, req.user!.id, { limit, offset });
    return res.json({ success: true, ...result });
  } catch (error) {
    logger.error("Messaging", "Failed to fetch user-initiated messages", error as Error);
    return res.status(500).json({ success: false, error: "Failed to load messages" });
  }
}

const SSE_HEARTBEAT_MS = 20_000;

/**
 * P2: shared SSE plumbing (headers, ready frame, heartbeat, close cleanup)
 * -- deliberately mirrors server/personal-chat-routes.ts's
 * /api/personal-chats/stream handler's exact shape, since that's the only
 * other place in this codebase this pattern has been proven in production.
 * `subscribe` is one of subscribeToBusinessEvents/subscribeToConsumerEvents
 * (already called with the caller-verified businessId/userId before this
 * runs) and `project` narrows a raw MessagingRealtimeEvent down to exactly
 * what this specific audience (consumer vs. agent) is allowed to see --
 * see toConsumerFrame/toInboxFrame below.
 */
function runMessagingSseStream(
  req: Request,
  res: Response,
  subscribe: (listener: (event: MessagingRealtimeEvent) => void) => () => void,
  project: (event: MessagingRealtimeEvent) => Record<string, unknown> | null,
): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (payload: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  send({ type: "ready", emittedAt: new Date().toISOString() });

  const heartbeat = setInterval(() => {
    send({ type: "heartbeat", ts: Date.now() });
  }, SSE_HEARTBEAT_MS);

  const listener = (event: MessagingRealtimeEvent) => {
    const frame = project(event);
    if (frame) send(frame);
  };
  const unsubscribe = subscribe(listener);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
}

// Strips fields a consumer has no legitimate reason to see over the wire:
// customerUserId is purely an internal routing key (their own id, already
// known to them, but not something the wire format needs to repeat), and
// assignment.changed is Business Inbox-only -- a consumer's own chat page
// has no use for who on the business side is handling their conversation
// internally, so that event type is filtered out entirely for this
// audience rather than forwarded and ignored client-side.
function toConsumerFrame(event: MessagingRealtimeEvent): Record<string, unknown> | null {
  if (event.type === "message.created") {
    return {
      type: event.type,
      conversationId: event.conversationId,
      message: event.message,
      emittedAt: new Date().toISOString(),
    };
  }
  return null;
}

// Inbox frame keeps businessId/conversationId (the panel needs both to
// decide which cached query to invalidate) but still never includes
// customerUserId -- that field only ever exists to route the event to the
// right consumer stream locally in realtime.ts, it has no purpose once
// the event reaches an authorized agent's browser.
function toInboxFrame(event: MessagingRealtimeEvent): Record<string, unknown> | null {
  const { customerUserId: _drop, ...rest } = event as any;
  return { ...rest, emittedAt: new Date().toISOString() };
}

// P2: consumer-facing stream, same requireAuth-only reasoning as
// getUserMessages/sendUserMessage above (see routes.ts) -- the caller
// reads/subscribes to THEIR OWN conversation with this business, not the
// business's internal event feed. userId passed to subscribeToConsumerEvents
// is ALWAYS req.user.id -- there is no query/body field that could name a
// different user, so this can never be used to eavesdrop on someone else's
// conversation regardless of what businessId is supplied (an invalid/
// unrelated businessId just means the subscription never matches any
// published event, not an error -- consistent with getUserMessages's own
// "no conversation yet -> empty result" behavior rather than a 404).
export async function streamUserMessages(req: Request, res: Response) {
  const businessId = Number(req.params.businessId);
  if (!Number.isFinite(businessId) || businessId <= 0) return badRequest(res, "Invalid businessId");

  runMessagingSseStream(
    req,
    res,
    (listener) => subscribeToConsumerEvents(req.user!.id, businessId, listener),
    toConsumerFrame,
  );
}

// P2: Business Inbox stream. Same RBAC stack as listConversations/
// getMessages (requireAuth + requireCompanyAccess + requirePermission
// MESSAGING_VIEW, enforced in routes.ts before this ever runs) -- this
// handler adds no authorization logic of its own, matching every other
// handler in this file. businessId is the validated URL param (already
// confirmed to belong to req.user's own organization by
// requireCompanyAccess), never client-suppliable beyond that check.
export async function streamBusinessConversations(req: Request, res: Response) {
  const businessId = Number(req.params.businessId);
  if (!Number.isFinite(businessId) || businessId <= 0) return badRequest(res, "Invalid businessId");

  runMessagingSseStream(
    req,
    res,
    (listener) => subscribeToBusinessEvents(businessId, listener),
    toInboxFrame,
  );
}
