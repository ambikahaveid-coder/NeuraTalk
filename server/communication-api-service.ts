import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { db } from "./db";
import { summarizeBillingPlan } from "./billing-plan-utils";
import { issueAccessToken, verifyWebhook } from "./livekit-service";
import type { AuthenticatedApiKey } from "./api-key-auth";
import {
  assignMaskedNumber,
  getMaskedNumberBySession,
  releaseMaskedNumber,
} from "./number-masking-service";
import { logger } from "./observability";
import { getRedisClient, withRedisLock } from "./redis";
import { BillingEngine } from "./billing-engine";
import type { StrictBillingPlanConfig } from "./billing-config";
import {
  activatePstnFallback as activateUnifiedPstnFallback,
  endCallById as endUnifiedCallById,
  getSmartCall,
  initiateCall as initiateUnifiedCall,
  updateSmartCallStatus,
} from "./modules/calls/service";
import { smartCallEvents } from "./modules/calls/smart-router";
import { buildUnifiedSessionFromCommunicationSession } from "./modules/calls/session-view";
import {
  billingPlans,
  communicationApiKeyPricing,
  communicationSessionEvents,
  communicationSessions,
  invoices,
  subscriptions,
} from "@shared/schema";

type BillingModel = "prepaid" | "postpaid";
type CallType = "voice" | "video";
type JoinMethod = "app_to_app" | "app_to_pstn";

interface ParticipantInput {
  externalId: string;
  phoneNumber?: string | null;
  displayName?: string | null;
  language?: string | null;
}

export interface CreateCommunicationCallInput {
  caller: ParticipantInput;
  callee: ParticipantInput;
  callType: CallType;
  transportPreference?: "app_to_app" | "auto" | "pstn";
  enableRecording?: boolean;
  enableAiAssistant?: boolean;
  metadata?: Record<string, unknown>;
}

interface PricingProfile {
  source: "api-key" | "subscription";
  pricingId: number | null;
  subscriptionId: number | null;
  billingModel: BillingModel;
  voiceRatePerSecondPaise: number;
  videoRatePerSecondPaise: number;
  pstnFallbackRatePerSecondPaise: number;
  connectionFeePaise: number;
  currency: string;
  allowPstnFallback: boolean;
  allowRecording: boolean;
  maxConcurrentSessions: number;
  region: string;
  prepaidBalancePaise: number | null;
  currentPostpaidUsagePaise: number;
  postpaidCreditLimitPaise: number | null;
  planBudgetPaise: number | null;
}

const CONCURRENT_COUNTER_PREFIX = "communication:api-key:";
const CONCURRENT_RELEASE_PREFIX = "communication:counter-released:";
const RESOURCE_RELEASE_PREFIX = "communication:resource-released:";

export const communicationApiEvents = new EventEmitter();
communicationApiEvents.setMaxListeners(64);

let mirrorBound = false;

function redisClient() {
  return getRedisClient();
}

function transportPreferenceToJoinMethod(input?: "app_to_app" | "auto" | "pstn"): "app_to_app" | "app_to_pstn" | "auto" {
  if (input === "pstn") return "app_to_pstn";
  if (input === "app_to_app") return "app_to_app";
  return "auto";
}

function buildPricingOverride(pricing: PricingProfile): Partial<StrictBillingPlanConfig> {
  return {
    billingType: pricing.billingModel === "postpaid" ? "postpaid" : "prepaid",
    perSecondBilling: true,
    rates: {
      voicePerMinutePaise: Math.max(0, pricing.voiceRatePerSecondPaise * 60),
      videoPerMinutePaise: Math.max(0, pricing.videoRatePerSecondPaise * 60),
      translationPerMinutePaise: 0,
      recordingPerMinutePaise: 0,
    },
    freeUnits: {
      minutes: 0,
      credits: 0,
    },
    limits: {
      maxConcurrentCalls: Math.max(0, pricing.maxConcurrentSessions),
      dailyUsageLimit: 0,
    },
    featuresEnabled: pricing.allowRecording
      ? ["translation", "recording"]
      : ["translation"],
  };
}

function getWsBaseUrl() {
  const appBaseUrl = process.env.APP_BASE_URL;
  if (!appBaseUrl) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("[CommunicationAPI] APP_BASE_URL must be set in production");
    }
    return `ws://localhost:${process.env.PORT || 5000}`;
  }
  return appBaseUrl.replace(/^http/i, "ws");
}

async function counterIncrement(key: string) {
  return await redisClient().incr(key);
}

async function counterDecrement(key: string) {
  const next = await redisClient().decr(key);
  if (next <= 0) {
    await redisClient().del(key);
    return 0;
  }
  return next;
}

async function counterGet(key: string) {
  const value = await redisClient().get(key);
  return value ? Number(value) || 0 : 0;
}

async function incrementConcurrentCounter(apiKeyId: number, maxConcurrentSessions: number) {
  const key = `${CONCURRENT_COUNTER_PREFIX}${apiKeyId}:active`;
  await withRedisLock(`${key}:lock`, async () => {
    const current = await counterGet(key);
    if (current >= maxConcurrentSessions) {
      throw new Error("CONCURRENT_SESSION_LIMIT_REACHED");
    }
    await counterIncrement(key);
  }, { ttlMs: 5_000 });
}

async function releaseConcurrentCounter(apiKeyId: number, sessionId: string) {
  const releaseKey = `${CONCURRENT_RELEASE_PREFIX}${sessionId}`;
  const claimed = await redisClient().set(releaseKey, "1", "EX", 60 * 60 * 24, "NX");
  if (claimed === "OK") {
    await counterDecrement(`${CONCURRENT_COUNTER_PREFIX}${apiKeyId}:active`);
  }
}

async function releaseSessionResources(sessionId: string, apiKeyId?: number | null) {
  const releaseKey = `${RESOURCE_RELEASE_PREFIX}${sessionId}`;
  const claimed = await redisClient().set(releaseKey, "1", "EX", 60 * 60 * 24, "NX");
  if (claimed !== "OK") {
    return;
  }

  if (apiKeyId) {
    await releaseConcurrentCounter(apiKeyId, sessionId).catch(() => undefined);
  }

  await releaseMaskedNumber(sessionId).catch(() => undefined);
}

async function getPricingProfile(apiKey: AuthenticatedApiKey): Promise<PricingProfile> {
  const [pricingRow] = await db.select()
    .from(communicationApiKeyPricing)
    .where(eq(communicationApiKeyPricing.apiKeyId, apiKey.id))
    .limit(1);

  if (pricingRow) {
    return {
      source: "api-key",
      pricingId: pricingRow.id,
      subscriptionId: apiKey.subscriptionId ?? null,
      billingModel: (pricingRow.billingModel as BillingModel) || "prepaid",
      voiceRatePerSecondPaise: Math.max(0, pricingRow.voiceRatePerSecondPaise ?? 1),
      videoRatePerSecondPaise: Math.max(0, pricingRow.videoRatePerSecondPaise ?? pricingRow.voiceRatePerSecondPaise ?? 2),
      pstnFallbackRatePerSecondPaise: Math.max(0, pricingRow.pstnFallbackRatePerSecondPaise ?? 0),
      connectionFeePaise: Math.max(0, pricingRow.connectionFeePaise ?? 0),
      currency: pricingRow.currency || "INR",
      allowPstnFallback: pricingRow.allowPstnFallback !== false,
      allowRecording: pricingRow.allowRecording === true,
      maxConcurrentSessions: Math.max(1, pricingRow.maxConcurrentSessions ?? 100),
      region: pricingRow.region || "ap-south-1",
      prepaidBalancePaise: pricingRow.prepaidBalancePaise ?? 0,
      currentPostpaidUsagePaise: pricingRow.currentPostpaidUsagePaise ?? 0,
      postpaidCreditLimitPaise: pricingRow.postpaidCreditLimitPaise ?? 0,
      planBudgetPaise: null,
    };
  }

  const [subscriptionRow] = await db.select({
    subscription: subscriptions,
    plan: billingPlans,
  })
    .from(subscriptions)
    .innerJoin(billingPlans, eq(subscriptions.planId, billingPlans.id))
    .where(and(
      eq(subscriptions.organizationId, apiKey.organizationId),
      eq(subscriptions.status, "active"),
    ))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);

  if (!subscriptionRow) {
    throw new Error("SUBSCRIPTION_REQUIRED");
  }

  const summary = summarizeBillingPlan(subscriptionRow.plan);
  const defaultVoiceRate = summary.ratePerSecondPaise > 0 ? summary.ratePerSecondPaise : 1;
  return {
    source: "subscription",
    pricingId: null,
    subscriptionId: subscriptionRow.subscription.id,
    billingModel: (subscriptionRow.subscription.billingModel as BillingModel) || "prepaid",
    voiceRatePerSecondPaise: defaultVoiceRate,
    videoRatePerSecondPaise: Math.max(defaultVoiceRate, Number((defaultVoiceRate * 1.3).toFixed(3))),
    pstnFallbackRatePerSecondPaise: Number(Math.max(1, defaultVoiceRate * 0.75).toFixed(3)),
    connectionFeePaise: 0,
    currency: subscriptionRow.plan.currency || "INR",
    allowPstnFallback: true,
    allowRecording: Boolean((subscriptionRow.plan.features as Record<string, unknown> | null)?.recording),
    maxConcurrentSessions: 50,
    region: "ap-south-1",
    prepaidBalancePaise: null,
    currentPostpaidUsagePaise: subscriptionRow.subscription.currentUsage ?? 0,
    postpaidCreditLimitPaise: subscriptionRow.subscription.creditLimit ?? null,
    planBudgetPaise: subscriptionRow.plan.priceInPaise ?? null,
  };
}

async function recordLifecycleEvent(
  sessionId: string,
  eventType: string,
  payload: Record<string, unknown> = {},
) {
  await db.insert(communicationSessionEvents).values({
    sessionId,
    eventType,
    payload,
  }).catch((error) => {
    logger.warn("CommunicationApi", `event write failed for ${sessionId}: ${String(error)}`);
  });

  communicationApiEvents.emit("event", {
    sessionId,
    eventType,
    payload,
    occurredAt: new Date().toISOString(),
  });
}

async function persistSessionStatus(
  sessionId: string,
  status: string,
  extra: Partial<typeof communicationSessions.$inferInsert> = {},
) {
  await db.update(communicationSessions)
    .set({
      status,
      updatedAt: new Date(),
      ...extra,
    })
    .where(eq(communicationSessions.sessionId, sessionId));
}

async function loadCommunicationSession(sessionId: string, apiKeyId?: number) {
  const query = db.select().from(communicationSessions)
    .where(apiKeyId
      ? and(eq(communicationSessions.sessionId, sessionId), eq(communicationSessions.apiKeyId, apiKeyId))
      : eq(communicationSessions.sessionId, sessionId))
    .limit(1);
  const [session] = await query;
  return session ?? null;
}

function ensureMirrorBinding() {
  if (mirrorBound) {
    return;
  }

  mirrorBound = true;

  smartCallEvents.on("status_changed", (event: Record<string, unknown>) => {
    void syncSmartCallMirror(String(event.callId || ""), {
      status: typeof event.status === "string" ? event.status : undefined,
      metadata: (event.metadata as Record<string, unknown> | undefined) || {},
    });
  });

  smartCallEvents.on("billing_started", (event: Record<string, unknown>) => {
    const callId = String(event.callId || "");
    if (!callId) return;
    void recordLifecycleEvent(callId, "billing_started", event).catch(() => undefined);
  });

  smartCallEvents.on("billing_stopped", (event: Record<string, unknown>) => {
    const callId = String(event.callId || "");
    if (!callId) return;
    void recordLifecycleEvent(callId, "billing_stopped", event).catch(() => undefined);
  });

  smartCallEvents.on("balance_low_triggered", (event: Record<string, unknown>) => {
    const callId = String(event.callId || "");
    if (!callId) return;
    void recordLifecycleEvent(callId, "balance_low_triggered", event).catch(() => undefined);
  });
}

async function syncSmartCallMirror(
  sessionId: string,
  opts: {
    status?: string;
    metadata?: Record<string, unknown>;
  } = {},
) {
  if (!sessionId) return;

  const session = await loadCommunicationSession(sessionId);
  if (!session) {
    return;
  }

  const [smartCall, billing, mapping] = await Promise.all([
    getSmartCall(sessionId).catch(() => null),
    BillingEngine.getCallSessionProgress(sessionId).catch(() => null),
    getMaskedNumberBySession(sessionId).catch(() => null),
  ]);

  const status = smartCall?.status || opts.status || session.status;
  const connectedAt = smartCall?.connectedAt ? new Date(smartCall.connectedAt) : session.connectedAt;
  const endedAt = smartCall?.endedAt ? new Date(smartCall.endedAt) : session.endedAt;
  const telemetry = {
    ...(session.telemetry as Record<string, unknown> | null || {}),
    smartCallStatus: smartCall?.status ?? status,
    lastProviderEventAt: smartCall?.lastProviderEventAt ?? null,
    lastMediaActivityAt: smartCall?.lastMediaActivityAt ?? null,
    terminationReason: smartCall?.terminationReason ?? null,
  };

  await persistSessionStatus(sessionId, status, {
    joinMethod: (smartCall?.joinMethod as string | undefined) ?? session.joinMethod,
    pstnCallId: smartCall?.pstnCallId ?? session.pstnCallId,
    maskedNumber: mapping?.maskedNumber || session.maskedNumber,
    connectedParticipantCount: status === "active"
      ? Math.max(session.connectedParticipantCount ?? 0, 2)
      : session.connectedParticipantCount,
    billedSeconds: billing?.durationSeconds ?? session.billedSeconds ?? 0,
    totalCostPaise: billing?.totalCostPaise ?? session.totalCostPaise ?? 0,
    connectedAt,
    endedAt,
    telemetry,
  });

  await recordLifecycleEvent(sessionId, `session.${status}`, {
    status,
    billedSeconds: billing?.durationSeconds ?? session.billedSeconds ?? 0,
    totalCostPaise: billing?.totalCostPaise ?? session.totalCostPaise ?? 0,
    metadata: opts.metadata || {},
  });

  if (["ended", "failed", "cancelled", "missed", "busy"].includes(status)) {
    await releaseSessionResources(sessionId, session.apiKeyId);
  }
}

export function startCommunicationBillingLoop() {
  ensureMirrorBinding();
}

export async function createCommunicationCallSession(
  apiKey: AuthenticatedApiKey,
  input: CreateCommunicationCallInput,
) {
  ensureMirrorBinding();

  if (!input.caller.externalId || !input.callee.externalId) {
    throw new Error("CALLER_AND_CALLEE_IDS_REQUIRED");
  }
  if (input.caller.phoneNumber && input.callee.phoneNumber && input.caller.phoneNumber === input.callee.phoneNumber) {
    throw new Error("CALLER_AND_CALLEE_MUST_BE_DIFFERENT");
  }

  const pricing = await getPricingProfile(apiKey);
  await incrementConcurrentCounter(apiKey.id, pricing.maxConcurrentSessions);

  const sessionId = `call_${randomUUID()}`;
  let initiated = false;

  try {
    const mapping = await assignMaskedNumber({
      sessionId,
      apiKeyId: apiKey.id,
      organizationId: apiKey.organizationId,
      callerExternalId: input.caller.externalId,
      calleeExternalId: input.callee.externalId,
      callerRealNumber: input.caller.phoneNumber || input.caller.externalId,
      calleeRealNumber: input.callee.phoneNumber || input.callee.externalId,
      region: pricing.region,
      metadata: {
        callType: input.callType || "voice",
        transportPreference: input.transportPreference || "auto",
      },
    });

    const unified = await initiateUnifiedCall({
      sessionIdOverride: sessionId,
      callerId: input.caller.externalId,
      callerUsername: input.caller.displayName || input.caller.externalId,
      callerDisplayName: input.caller.displayName || input.caller.externalId,
      callerNumber: mapping.maskedNumber || input.caller.phoneNumber || input.caller.externalId,
      calleeIdentifier: input.callee.phoneNumber || input.callee.externalId,
      calleeDisplayName: input.callee.displayName || input.callee.externalId,
      callerLanguage: input.caller.language || "auto",
      calleeLanguage: input.callee.language || "auto",
      callType: input.callType || "voice",
      enableRecording: input.enableRecording === true && pricing.allowRecording,
      transportPreference: transportPreferenceToJoinMethod(input.transportPreference),
      organizationIdOverride: apiKey.organizationId,
      pricingOverride: buildPricingOverride(pricing),
      pstnFallbackRatePerMinutePaise: pricing.pstnFallbackRatePerSecondPaise * 60,
    });
    initiated = true;

    const callerToken = await issueAccessToken(unified.callId, {
      userId: input.caller.externalId,
      displayName: input.caller.displayName || input.caller.externalId,
      language: input.caller.language || "auto",
      role: "caller",
    });

    const calleeToken = unified.joinMethod === "app_to_app"
      ? await issueAccessToken(unified.callId, {
          userId: input.callee.externalId,
          displayName: input.callee.displayName || input.callee.externalId,
          language: input.callee.language || "auto",
          role: "callee",
        })
      : null;

    await db.insert(communicationSessions).values({
      sessionId: unified.callId,
      apiKeyId: apiKey.id,
      organizationId: apiKey.organizationId,
      pricingId: pricing.pricingId ?? undefined,
      subscriptionId: pricing.subscriptionId ?? undefined,
      maskedMappingId: mapping.id,
      livekitRoomName: unified.callId,
      callerIdentity: input.caller.externalId,
      calleeIdentity: input.callee.externalId,
      callerPhoneNumber: input.caller.phoneNumber || null,
      calleePhoneNumber: input.callee.phoneNumber || null,
      callerDisplayName: input.caller.displayName || input.caller.externalId,
      calleeDisplayName: input.callee.displayName || input.callee.externalId,
      callerLanguage: input.caller.language || "auto",
      calleeLanguage: input.callee.language || "auto",
      maskedNumber: mapping.maskedNumber,
      callType: input.callType || "voice",
      transport: "webrtc",
      joinMethod: unified.joinMethod,
      status: unified.joinMethod === "app_to_pstn" ? "ringing" : "created",
      recordingEnabled: input.enableRecording === true && pricing.allowRecording,
      aiAssistantEnabled: input.enableAiAssistant === true,
      maskingEnabled: true,
      pstnFallbackEnabled: pricing.allowPstnFallback,
      pstnCallId: unified.pstnCallId ?? null,
      metadata: {
        ...(input.metadata || {}),
        pricingSource: pricing.source,
        connectionFeePaise: pricing.connectionFeePaise,
      },
      telemetry: {
        pricingSnapshot: pricing,
      },
      startedAt: new Date(),
    });

    const createdAt = new Date();

    await recordLifecycleEvent(unified.callId, "session.created", {
      apiKeyId: apiKey.id,
      organizationId: apiKey.organizationId,
      joinMethod: unified.joinMethod,
      callType: input.callType || "voice",
      maskedNumber: mapping.maskedNumber,
    });

    const sessionView = buildUnifiedSessionFromCommunicationSession({
      id: 0,
      sessionId: unified.callId,
      apiKeyId: apiKey.id,
      organizationId: apiKey.organizationId,
      pricingId: pricing.pricingId ?? null,
      subscriptionId: pricing.subscriptionId ?? null,
      maskedMappingId: mapping.id,
      livekitRoomName: unified.callId,
      callerIdentity: input.caller.externalId,
      calleeIdentity: input.callee.externalId,
      callerPhoneNumber: input.caller.phoneNumber || null,
      calleePhoneNumber: input.callee.phoneNumber || null,
      callerDisplayName: input.caller.displayName || input.caller.externalId,
      calleeDisplayName: input.callee.displayName || input.callee.externalId,
      callerLanguage: input.caller.language || "auto",
      calleeLanguage: input.callee.language || "auto",
      maskedNumber: mapping.maskedNumber,
      callType: input.callType || "voice",
      transport: "webrtc",
      joinMethod: unified.joinMethod,
      status: unified.joinMethod === "app_to_pstn" ? "ringing" : "created",
      recordingEnabled: input.enableRecording === true && pricing.allowRecording,
      aiAssistantEnabled: input.enableAiAssistant === true,
      maskingEnabled: true,
      pstnFallbackEnabled: pricing.allowPstnFallback,
      pstnCallId: unified.pstnCallId ?? null,
      metadata: {
        ...(input.metadata || {}),
        pricingSource: pricing.source,
        connectionFeePaise: pricing.connectionFeePaise,
      },
      telemetry: {
        pricingSnapshot: pricing,
      },
      connectedParticipantCount: 0,
      billedSeconds: 0,
      totalCostPaise: 0,
      startedAt: createdAt,
      connectedAt: null,
      endedAt: null,
      createdAt,
      updatedAt: createdAt,
    }, {
      smartCallStatus: unified.joinMethod === "app_to_pstn" ? "ringing" : "created",
      provider: unified.joinMethod === "app_to_pstn" ? "msg91_sip" : "livekit",
      livekitUrl: process.env.LIVEKIT_URL || null,
      durationSeconds: 0,
    });

    return {
      sessionId: unified.callId,
      status: unified.joinMethod === "app_to_pstn" ? "ringing" : "created",
      transport: "webrtc",
      joinMethod: unified.joinMethod,
      region: pricing.region,
      livekit: {
        url: process.env.LIVEKIT_URL,
        roomName: unified.callId,
        callerToken,
        calleeToken: calleeToken ?? undefined,
      },
      masking: {
        enabled: true,
        maskedNumber: mapping.maskedNumber,
        expiresAt: mapping.expiresAt,
      },
      pricing: {
        billingModel: pricing.billingModel,
        voiceRatePerSecondPaise: pricing.voiceRatePerSecondPaise,
        videoRatePerSecondPaise: pricing.videoRatePerSecondPaise,
        pstnFallbackRatePerSecondPaise: pricing.pstnFallbackRatePerSecondPaise,
        connectionFeePaise: pricing.connectionFeePaise,
        currency: pricing.currency,
        prepaidBalancePaise: pricing.prepaidBalancePaise,
        postpaidRemainingCreditPaise: pricing.postpaidCreditLimitPaise != null
          ? Math.max(0, pricing.postpaidCreditLimitPaise - pricing.currentPostpaidUsagePaise)
          : null,
      },
      websocket: {
        url: `${getWsBaseUrl()}/ws/communication-api?session_id=${encodeURIComponent(unified.callId)}`,
      },
      session: sessionView,
    };
  } catch (error) {
    if (initiated) {
      await endUnifiedCallById(sessionId, "failed").catch(() => undefined);
    }
    await db.update(communicationSessions)
      .set({
        status: "failed",
        endedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(communicationSessions.sessionId, sessionId))
      .catch(() => undefined);
    await releaseSessionResources(sessionId, apiKey.id).catch(() => undefined);
    throw error;
  }
}

export async function activatePstnFallback(
  apiKey: AuthenticatedApiKey,
  sessionId: string,
) {
  ensureMirrorBinding();
  const pricing = await getPricingProfile(apiKey);
  if (!pricing.allowPstnFallback) {
    throw new Error("PSTN_FALLBACK_DISABLED");
  }
  const session = await loadCommunicationSession(sessionId, apiKey.id);
  if (!session) {
    throw new Error("SESSION_NOT_FOUND");
  }
  if (!session.calleePhoneNumber) {
    throw new Error("CALLEE_PHONE_REQUIRED_FOR_PSTN");
  }

  const mapping = await getMaskedNumberBySession(sessionId);
  const callerNumber = mapping?.maskedNumber || session.maskedNumber || session.callerPhoneNumber;
  if (!callerNumber || !/^\+?\d{8,15}$/.test(callerNumber)) {
    throw new Error("MASKED_NUMBER_REQUIRED");
  }

  const result = await activateUnifiedPstnFallback(sessionId, {
    callerNumber,
    calleePhoneNumber: session.calleePhoneNumber,
  });

  await syncSmartCallMirror(sessionId, {
    status: "ringing",
    metadata: {
      pstnCallId: result.pstnCallId,
      providerStatus: result.providerStatus,
    },
  });

  return {
    sessionId,
    pstnCallId: result.pstnCallId,
    providerStatus: result.providerStatus,
  };
}

export async function updateCommunicationSessionState(
  apiKey: AuthenticatedApiKey,
  sessionId: string,
  update: {
    participantIdentity?: string;
    state: "ringing" | "joined" | "left" | "failed";
    metadata?: Record<string, unknown>;
  },
) {
  ensureMirrorBinding();

  const session = await loadCommunicationSession(sessionId, apiKey.id);
  if (!session) {
    throw new Error("SESSION_NOT_FOUND");
  }

  if (update.state === "ringing") {
    await updateSmartCallStatus(sessionId, "ringing", update.metadata || {});
    return;
  }

  if (update.state === "joined") {
    const smartCall = await getSmartCall(sessionId);
    if (smartCall && !["answered", "active"].includes(smartCall.status)) {
      await updateSmartCallStatus(sessionId, "answered", {
        participantIdentity: update.participantIdentity ?? null,
        ...(update.metadata || {}),
      });
    }
    await updateSmartCallStatus(sessionId, "active", {
      participantIdentity: update.participantIdentity ?? null,
      ...(update.metadata || {}),
    });
    return;
  }

  if (update.state === "left") {
    await endCommunicationCallSessionById(sessionId, "participant_left");
    return;
  }

  if (update.state === "failed") {
    await endCommunicationCallSessionById(sessionId, "failed");
  }
}

export async function endCommunicationCallSession(
  apiKey: AuthenticatedApiKey,
  sessionId: string,
  reason = "api_end",
) {
  const session = await loadCommunicationSession(sessionId, apiKey.id);
  if (!session) {
    throw new Error("SESSION_NOT_FOUND");
  }

  return await endCommunicationCallSessionById(sessionId, reason);
}

export async function endCommunicationCallSessionById(
  sessionId: string,
  reason = "ended",
) {
  ensureMirrorBinding();

  const session = await loadCommunicationSession(sessionId);
  if (!session) {
    throw new Error("SESSION_NOT_FOUND");
  }

  await endUnifiedCallById(sessionId, reason);
  await syncSmartCallMirror(sessionId, {
    metadata: { endReason: reason },
  });

  const billing = await BillingEngine.getCallSessionProgress(sessionId).catch(() => null);
  await releaseSessionResources(sessionId, session.apiKeyId);

  return {
    sessionId,
    status: reason === "failed" ? "failed" : "ended",
    totalCostPaise: billing?.totalCostPaise ?? session.totalCostPaise ?? 0,
    billedSeconds: billing?.durationSeconds ?? session.billedSeconds ?? 0,
    reason,
  };
}

export async function getCommunicationCallStatus(
  apiKey: AuthenticatedApiKey,
  sessionId: string,
) {
  ensureMirrorBinding();
  const session = await loadCommunicationSession(sessionId, apiKey.id);
  if (!session) {
    throw new Error("SESSION_NOT_FOUND");
  }

  const [smartCall, billing, mapping, events] = await Promise.all([
    getSmartCall(sessionId).catch(() => null),
    BillingEngine.getCallSessionProgress(sessionId).catch(() => null),
    getMaskedNumberBySession(sessionId).catch(() => null),
    db.select()
      .from(communicationSessionEvents)
      .where(eq(communicationSessionEvents.sessionId, sessionId))
      .orderBy(desc(communicationSessionEvents.occurredAt))
      .limit(20),
  ]);

  const status = smartCall?.status ?? session.status;
  const connectedAt = smartCall?.connectedAt ? new Date(smartCall.connectedAt) : session.connectedAt;
  const endedAt = smartCall?.endedAt ? new Date(smartCall.endedAt) : session.endedAt;
  const durationSeconds = billing?.durationSeconds ?? session.billedSeconds ?? 0;

  return {
    sessionId,
    status,
    callType: session.callType,
    joinMethod: smartCall?.joinMethod ?? session.joinMethod,
    maskedNumber: mapping?.maskedNumber || session.maskedNumber,
    connectedParticipantCount: session.connectedParticipantCount ?? (smartCall?.status === "active" ? 2 : 0),
    billedSeconds: durationSeconds,
    totalCostPaise: billing?.totalCostPaise ?? session.totalCostPaise ?? 0,
    prepaidBalancePaise: null,
    postpaidRemainingCreditPaise: null,
    createdAt: session.createdAt,
    connectedAt,
    endedAt,
    events: events.reverse(),
    session: buildUnifiedSessionFromCommunicationSession(session, {
      smartCallStatus: status,
      provider: smartCall?.provider ?? null,
      livekitUrl: process.env.LIVEKIT_URL || null,
      durationSeconds,
    }),
  };
}

export async function listCommunicationUsage(
  apiKey: AuthenticatedApiKey,
  filters?: { from?: Date; to?: Date; limit?: number },
) {
  const from = filters?.from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to = filters?.to ?? new Date();
  const limit = Math.min(200, Math.max(1, filters?.limit ?? 50));

  const sessions = await db.select()
    .from(communicationSessions)
    .where(and(
      eq(communicationSessions.apiKeyId, apiKey.id),
      gte(communicationSessions.createdAt, from),
      lt(communicationSessions.createdAt, to),
    ))
    .orderBy(desc(communicationSessions.createdAt))
    .limit(limit);

  const totals = sessions.reduce((acc, session) => {
    acc.totalSessions += 1;
    acc.totalSeconds += session.billedSeconds ?? 0;
    acc.totalCostPaise += session.totalCostPaise ?? 0;
    if (session.callType === "video") acc.videoSessions += 1;
    else acc.voiceSessions += 1;
    return acc;
  }, {
    totalSessions: 0,
    totalSeconds: 0,
    totalCostPaise: 0,
    voiceSessions: 0,
    videoSessions: 0,
  });

  return {
    apiKeyId: apiKey.id,
    organizationId: apiKey.organizationId,
    period: { from, to },
    totals,
    sessions,
  };
}

export async function getCommunicationBillingSummary(apiKey: AuthenticatedApiKey) {
  const pricing = await getPricingProfile(apiKey);
  const cycleStart = new Date();
  cycleStart.setDate(1);
  cycleStart.setHours(0, 0, 0, 0);

  const monthSessions = await db.select()
    .from(communicationSessions)
    .where(and(
      eq(communicationSessions.apiKeyId, apiKey.id),
      gte(communicationSessions.createdAt, cycleStart),
    ))
    .orderBy(desc(communicationSessions.createdAt))
    .limit(200);

  const monthTotals = monthSessions.reduce((acc, session) => {
    acc.totalCostPaise += session.totalCostPaise ?? 0;
    acc.totalSeconds += session.billedSeconds ?? 0;
    return acc;
  }, { totalCostPaise: 0, totalSeconds: 0 });

  const recentInvoices = await db.select()
    .from(invoices)
    .where(eq(invoices.organizationId, apiKey.organizationId))
    .orderBy(desc(invoices.createdAt))
    .limit(12);

  return {
    apiKeyId: apiKey.id,
    organizationId: apiKey.organizationId,
    billingModel: pricing.billingModel,
    pricing: {
      voiceRatePerSecondPaise: pricing.voiceRatePerSecondPaise,
      videoRatePerSecondPaise: pricing.videoRatePerSecondPaise,
      pstnFallbackRatePerSecondPaise: pricing.pstnFallbackRatePerSecondPaise,
      connectionFeePaise: pricing.connectionFeePaise,
      currency: pricing.currency,
    },
    currentCycle: {
      start: cycleStart,
      totalCostPaise: monthTotals.totalCostPaise,
      totalSeconds: monthTotals.totalSeconds,
    },
    balance: {
      prepaidBalancePaise: pricing.source === "api-key" ? pricing.prepaidBalancePaise : null,
      postpaidCreditLimitPaise: pricing.postpaidCreditLimitPaise,
      currentPostpaidUsagePaise: pricing.currentPostpaidUsagePaise,
    },
    invoicePreview: pricing.billingModel === "postpaid"
      ? {
          subtotalPaise: monthTotals.totalCostPaise,
          estimatedTaxPaise: Math.round(monthTotals.totalCostPaise * 0.18),
          estimatedTotalPaise: Math.round(monthTotals.totalCostPaise * 1.18),
        }
      : null,
    recentInvoices,
  };
}

export async function handleCommunicationLiveKitWebhook(rawBody: string, authHeader: string) {
  ensureMirrorBinding();
  const event = await verifyWebhook(rawBody, authHeader);
  const roomName = (event as any)?.room?.name || (event as any)?.roomName;
  const participantIdentity = (event as any)?.participant?.identity;
  const eventName = String((event as any)?.event || (event as any)?.type || "");

  if (!roomName) {
    return { handled: false };
  }

  const session = await loadCommunicationSession(roomName);
  if (!session) {
    return { handled: false };
  }

  if (eventName.includes("participant_joined") && participantIdentity) {
    const smartCall = await getSmartCall(roomName);
    if (smartCall && !["answered", "active"].includes(smartCall.status)) {
      await updateSmartCallStatus(roomName, "answered", {
        participantIdentity,
        source: "livekit_webhook",
      });
    }
    await updateSmartCallStatus(roomName, "active", {
      participantIdentity,
      source: "livekit_webhook",
    });
  } else if (eventName.includes("participant_left") && participantIdentity) {
    await endCommunicationCallSessionById(roomName, "participant_left");
  } else if (eventName.includes("room_finished")) {
    await endCommunicationCallSessionById(roomName, "room_finished");
  }

  return { handled: true };
}

export async function handleCommunicationPstnWebhook(sessionId: string, payload: Record<string, unknown>) {
  ensureMirrorBinding();
  const session = await loadCommunicationSession(sessionId);
  if (!session) {
    return { handled: false };
  }

  const providerStatus = String(payload.status || payload.event || "").toLowerCase();
  if (providerStatus.includes("answered") || providerStatus.includes("connected")) {
    await updateSmartCallStatus(sessionId, "answered", {
      providerStatus,
      payload,
    });
    await updateSmartCallStatus(sessionId, "active", {
      providerStatus,
      payload,
    });
    return { handled: true };
  }

  if (providerStatus.includes("ring")) {
    await updateSmartCallStatus(sessionId, "ringing", {
      providerStatus,
      payload,
    });
    return { handled: true };
  }

  if (providerStatus.includes("failed") || providerStatus.includes("busy")) {
    await endCommunicationCallSessionById(sessionId, providerStatus.includes("busy") ? "busy" : "failed");
    return { handled: true };
  }

  if (providerStatus.includes("ended") || providerStatus.includes("completed")) {
    await endCommunicationCallSessionById(sessionId, "pstn_completed");
    return { handled: true };
  }

  return { handled: true };
}
