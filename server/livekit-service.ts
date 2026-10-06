/**
 * LiveKit Service — Replaces broken custom signaling/media-relay.
 *
 * Handles:
 *   - Access token generation (JWT signed with API secret)
 *   - Room create/delete/list
 *   - Participant management
 *   - Webhook verification (call events from LiveKit)
 *
 * Env vars required:
 *   LIVEKIT_URL         — e.g. ws://<pod-ip>:7880 or wss://livekit.yourdomain.com
 *   LIVEKIT_API_KEY     — from LIVEKIT_KEYS=<key>:<secret>
 *   LIVEKIT_API_SECRET  — 32+ char secret
 */

import { AccessToken, RoomServiceClient, WebhookReceiver } from "livekit-server-sdk";
import type { Room, ParticipantInfo } from "livekit-server-sdk";
import { runWithResilience } from "./voice-resilience";

const LIVEKIT_CREATE_ROOM_TIMEOUT_MS = 15_000;
import { logger } from "./observability";

const LIVEKIT_TOKEN_MIN_TTL = 3600;   // 1 hour minimum
const LIVEKIT_TOKEN_MAX_TTL = 86400;  // 24 hour maximum
const LIVEKIT_BOT_TOKEN_TTL = 14400;  // 4 hours for server-side bots

function getLiveKitTokenTtl(): number {
  const raw = process.env.LIVEKIT_TOKEN_TTL_SECONDS;
  if (!raw) return LIVEKIT_TOKEN_MIN_TTL;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < LIVEKIT_TOKEN_MIN_TTL || parsed > LIVEKIT_TOKEN_MAX_TTL) {
    logger.warn("LiveKit", `LIVEKIT_TOKEN_TTL_SECONDS="${raw}" is outside valid range [${LIVEKIT_TOKEN_MIN_TTL}–${LIVEKIT_TOKEN_MAX_TTL}] — using ${LIVEKIT_TOKEN_MIN_TTL}s`);
    return LIVEKIT_TOKEN_MIN_TTL;
  }
  return parsed;
}

type LiveKitConfig = {
  url: string;
  apiKey: string;
  apiSecret: string;
};

let roomServiceCache: { key: string; client: RoomServiceClient } | null = null;
let webhookReceiverCache: { key: string; receiver: WebhookReceiver } | null = null;

function getLiveKitConfig(): LiveKitConfig | null {
  const url = process.env.LIVEKIT_URL?.trim();
  const apiKey = process.env.LIVEKIT_API_KEY?.trim();
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();

  if (!url || !apiKey || !apiSecret) {
    return null;
  }

  return { url, apiKey, apiSecret };
}

export function isLiveKitConfigured(): boolean {
  return getLiveKitConfig() !== null;
}

function requireLiveKitConfig(): LiveKitConfig {
  const config = getLiveKitConfig();
  if (!config) {
    throw new Error("LIVEKIT_UNAVAILABLE");
  }
  return config;
}

function getRoomService(): RoomServiceClient {
  const config = requireLiveKitConfig();
  const cacheKey = `${config.url}|${config.apiKey}|${config.apiSecret}`;
  if (!roomServiceCache || roomServiceCache.key !== cacheKey) {
    roomServiceCache = {
      key: cacheKey,
      client: new RoomServiceClient(config.url.replace(/^ws/, "http"), config.apiKey, config.apiSecret),
    };
  }
  return roomServiceCache.client;
}

function getWebhookReceiver(): WebhookReceiver {
  const config = requireLiveKitConfig();
  const cacheKey = `${config.apiKey}|${config.apiSecret}`;
  if (!webhookReceiverCache || webhookReceiverCache.key !== cacheKey) {
    webhookReceiverCache = {
      key: cacheKey,
      receiver: new WebhookReceiver(config.apiKey, config.apiSecret),
    };
  }
  return webhookReceiverCache.receiver;
}

export interface CallParticipant {
  userId: string;
  displayName: string;
  language: string;   // Preferred speech language (te, en, hi, etc.)
  translationMode?: "off" | "subtitles" | "voice";
  role?: "caller" | "callee" | "agent" | "bot";
}

export interface CreateCallRoomOptions {
  callId: string;
  maxParticipants?: number;
  emptyTimeoutSec?: number;  // Auto-close if empty this long
  metadata?: Record<string, unknown>;
}

/**
 * Create a room for a call (1-on-1 or conference).
 * Idempotent — re-creating with same name is safe.
 */
export async function createCallRoom(opts: CreateCallRoomOptions): Promise<Room> {
  return runWithResilience(
    () => getRoomService().createRoom({
      name: opts.callId,
      maxParticipants: opts.maxParticipants ?? 10,
      emptyTimeout: opts.emptyTimeoutSec ?? 300,
      metadata: JSON.stringify(opts.metadata ?? {}),
    }),
    {
      provider: "livekit",
      operation: "createRoom",
      timeoutMs: LIVEKIT_CREATE_ROOM_TIMEOUT_MS,
      retries: 0,
    },
  );
}

/**
 * Generate an access token for a participant to join the room.
 * Token embeds: identity, room name, grants (canPublish, canSubscribe), TTL.
 */
export async function issueAccessToken(
  roomName: string,
  participant: CallParticipant,
  ttlSeconds?: number
): Promise<string> {
  const config = requireLiveKitConfig();
  const resolvedTtl = ttlSeconds ?? getLiveKitTokenTtl();

  const at = new AccessToken(config.apiKey, config.apiSecret, {
    identity: participant.userId,
    name: participant.displayName,
    ttl: resolvedTtl,
    metadata: JSON.stringify({
      language: participant.language,
      translationMode: participant.translationMode ?? "subtitles",
      role: participant.role ?? "caller",
    }),
  });

  at.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    canUpdateOwnMetadata: true,
  });

  const token = at.toJwt();
  logger.info("LiveKit", `Token issued identity=${participant.userId} room=${roomName} role=${participant.role ?? "caller"} ttl=${resolvedTtl}s`);
  return token;
}

/**
 * Bot token — used by our server to join the room as a translator bot.
 * Bot receives audio from all participants, runs STT→Translate→TTS,
 * and publishes translated audio track per recipient language.
 */
export async function issueBotToken(roomName: string, botName = "neuratalk-translator"): Promise<string> {
  const config = requireLiveKitConfig();
  const at = new AccessToken(config.apiKey, config.apiSecret, {
    identity: botName,
    name: "NeuraTalk Translator",
    ttl: LIVEKIT_BOT_TOKEN_TTL,
    metadata: JSON.stringify({ role: "bot" }),
  });

  at.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    hidden: false,
    recorder: false,
  });

  const token = at.toJwt();
  logger.info("LiveKit", `Bot token issued identity=${botName} room=${roomName} ttl=${LIVEKIT_BOT_TOKEN_TTL}s`);
  return token;
}

/**
 * List participants in a room (to check who's live).
 */
/** LiveKit reports a missing room as code "not_found" with message "requested room does not exist". */
export function isRoomMissingError(err: unknown): boolean {
  const e = err as { code?: unknown; status?: unknown; message?: unknown } | null;
  const text = `${e?.code ?? ""} ${e?.message ?? err}`.toLowerCase();
  return e?.status === 404 || text.includes("not_found") || text.includes("does not exist") || text.includes("not found");
}

export async function listParticipants(roomName: string): Promise<ParticipantInfo[]> {
  return getRoomService().listParticipants(roomName);
}

/**
 * Close a room (ends all participants' sessions).
 */
export async function endCallRoom(roomName: string): Promise<void> {
  if (!isLiveKitConfigured()) {
    return;
  }
  try {
    await getRoomService().deleteRoom(roomName);
  } catch (err: any) {
    // Room may already be gone — not an error
    if (!isRoomMissingError(err)) throw err;
  }
}

/**
 * Server-side subscribe/unsubscribe of one participant to specific tracks.
 * Used so a translated-speech track is only received by the listener it was
 * generated for, regardless of what the client app does.
 */
export async function setParticipantTrackSubscriptions(
  roomName: string,
  identity: string,
  trackSids: string[],
  subscribe: boolean,
): Promise<void> {
  if (!isLiveKitConfigured() || trackSids.length === 0) return;
  await getRoomService().updateSubscriptions(roomName, identity, trackSids, subscribe);
}

/**
 * Remove a single participant (kick).
 */
export async function removeParticipant(roomName: string, identity: string): Promise<void> {
  await getRoomService().removeParticipant(roomName, identity);
}

/**
 * Hold/resume — mutes (or unmutes) every track a participant has published,
 * so the remote side stops receiving audio/video without dropping the room
 * connection. Used for app-to-app call hold; there is no PSTN leg to hold.
 */
export async function setParticipantHold(
  roomName: string,
  identity: string,
  onHold: boolean,
): Promise<void> {
  const svc = getRoomService();
  const participant = await svc.getParticipant(roomName, identity);
  const tracks = participant.tracks ?? [];
  await Promise.all(
    tracks.map((track) => svc.mutePublishedTrack(roomName, identity, track.sid, onHold)),
  );
}

/**
 * Update room metadata (e.g., current speaker language, translation state).
 * Used by language-detector to signal "translation ON/OFF" to clients.
 */
export async function updateRoomMetadata(
  roomName: string,
  metadata: Record<string, unknown>
): Promise<void> {
  await getRoomService().updateRoomMetadata(roomName, JSON.stringify(metadata));
}

/**
 * Webhook receiver — LiveKit sends events (participant_joined, track_published,
 * room_finished). Use to track call state transitions.
 */
export async function verifyWebhook(body: string, authHeader: string) {
  return getWebhookReceiver().receive(body, authHeader);
}

/**
 * Frontend config — exposed via GET /api/livekit/config.
 * Returns the WS URL for clients to connect. Secret never leaves server.
 */
export function getClientConfig() {
  const config = getLiveKitConfig();
  return {
    url: config?.url ?? null,
    configured: Boolean(config),
    // api key/secret intentionally NOT included — tokens are issued per-session
  };
}

/**
 * Health check — verify LiveKit server is reachable.
 */
export async function isLiveKitHealthy(): Promise<boolean> {
  if (!isLiveKitConfigured()) {
    return false;
  }
  try {
    await runWithResilience(
      async () => getRoomService().listRooms(),
      {
        provider: "livekit-control-plane",
        operation: "healthcheck",
        timeoutMs: 3_000,
        retries: 0,
      },
    );
    return true;
  } catch {
    return false;
  }
}
