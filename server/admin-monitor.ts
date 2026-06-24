import { WebSocket, WebSocketServer } from "ws";
import { IncomingMessage } from "http";
import { signalingServer } from "./signaling-server";
import { getGatewayStatus } from "./modules/calls/gateway";
import { metricsEmitter, getMetricsSnapshot, getVoiceMetricsSnapshot, type StageLatencyEvent } from "./modules/calls/metrics";
import { buildUnifiedSessionFromLegacyCall } from "./modules/calls/session-view";
import { db } from "./db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";

interface AdminMonitorClient {
  ws: WebSocket;
  userId: number;
  connectedAt: number;
  lastSeqId: number;
}

const adminClients: AdminMonitorClient[] = [];
let eventSubscribed = false;
let globalSeqId = 0;

const EVENT_BUFFER_SIZE = 500;
const eventBuffer: Array<{ seqId: number; event: Record<string, unknown> }> = [];

function broadcastToAdmins(event: Record<string, unknown>) {
  globalSeqId++;
  const eventWithSeq = { ...event, seqId: globalSeqId };
  eventBuffer.push({ seqId: globalSeqId, event: eventWithSeq });
  if (eventBuffer.length > EVENT_BUFFER_SIZE) {
    eventBuffer.splice(0, eventBuffer.length - EVENT_BUFFER_SIZE);
  }

  const message = JSON.stringify(eventWithSeq);
  adminClients.forEach((client) => {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
      client.lastSeqId = globalSeqId;
    }
  });
}

function replayMissedEvents(client: AdminMonitorClient, sinceSeqId: number) {
  const missed = eventBuffer.filter((e) => e.seqId > sinceSeqId);
  missed.forEach((e) => {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(e.event));
    }
  });
  if (missed.length > 0) {
    client.lastSeqId = missed[missed.length - 1].seqId;
  }
}

function subscribeToSignalingEvents() {
  if (eventSubscribed) return;
  eventSubscribed = true;

  signalingServer.on("call_initiated", (call) => {
    broadcastToAdmins({
      type: "call_event",
      event: "initiated",
      callId: call.callId,
      callerId: call.callerId,
      calleeId: call.calleeId,
      callType: call.callType,
      videoEnabled: call.videoEnabled,
      metadata: call.metadata,
      timestamp: Date.now(),
    });
  });

  signalingServer.on("call_connected", (call) => {
    broadcastToAdmins({
      type: "call_event",
      event: "connected",
      callId: call.callId,
      callerId: call.callerId,
      calleeId: call.calleeId,
      callType: call.callType,
      connectedAt: call.connectedAt,
      timestamp: Date.now(),
    });
  });

  signalingServer.on("call_ended", (data) => {
    broadcastToAdmins({
      type: "call_event",
      event: "ended",
      callId: data.callId,
      reason: data.reason,
      duration: data.duration,
      timestamp: Date.now(),
    });
  });

  signalingServer.on("translation_subtitle", (data) => {
    broadcastToAdmins({
      type: "translation_event",
      callId: data.callId,
      sessionId: data.sessionId,
      subtitle: data.subtitle,
      language: data.language,
      emotion: data.emotion,
      timestamp: Date.now(),
    });
  });

  signalingServer.on("client_registered", (client) => {
    broadcastToAdmins({
      type: "client_event",
      event: "registered",
      sessionId: client.sessionId,
      userId: client.userId,
      phoneNumber: client.phoneNumber,
      capabilities: client.capabilities,
      timestamp: Date.now(),
    });
  });

  signalingServer.on("client_disconnected", (data) => {
    broadcastToAdmins({
      type: "client_event",
      event: "disconnected",
      sessionId: data.sessionId,
      timestamp: Date.now(),
    });
  });

  metricsEmitter.on("stage_latency", (event: StageLatencyEvent) => {
    broadcastToAdmins({
      type: "pipeline_latency",
      callId: event.callId,
      stage: event.stage,
      latency_ms: event.latency_ms,
      timestamp: event.timestamp,
    });
  });
}

function getSnapshot() {
  const activeCalls = signalingServer.getActiveCalls().map((call) => ({
    callId: call.callId,
    callerId: call.callerId,
    calleeId: call.calleeId,
    status: call.status,
    callType: call.callType,
    videoEnabled: call.videoEnabled,
    screenShareActive: call.screenShareActive,
    startedAt: call.startedAt,
    connectedAt: call.connectedAt,
    metadata: call.metadata,
    durationMs: call.connectedAt ? Date.now() - call.connectedAt : Date.now() - call.startedAt,
    session: buildUnifiedSessionFromLegacyCall({
      id: call.callId,
      callId: call.callId,
      status: call.status,
      callType: call.callType,
      callerUserId: Number.isFinite(Number(call.callerId)) ? Number(call.callerId) : null,
      receiverUserId: Number.isFinite(Number(call.calleeId)) ? Number(call.calleeId) : null,
      callerLanguage: typeof call.metadata?.callerLanguage === "string" ? call.metadata.callerLanguage : null,
      receiverLanguage: typeof call.metadata?.calleeLanguage === "string" ? call.metadata.calleeLanguage : null,
      translationEnabled: typeof call.metadata?.translationEnabled === "boolean" ? call.metadata.translationEnabled : null,
      createdAt: new Date(call.startedAt),
      connectedAt: call.connectedAt ? new Date(call.connectedAt) : null,
      endedAt: null,
      metadata: call.metadata ?? {},
      livekitUrl: null,
      pstnCallId: typeof call.metadata?.pstnCallId === "string" ? call.metadata.pstnCallId : null,
    }),
  }));

  const clients = signalingServer.getRegisteredClients().map((c) => ({
    sessionId: c.sessionId,
    userId: c.userId,
    phoneNumber: c.phoneNumber,
    capabilities: c.capabilities,
    registeredAt: c.registeredAt,
    lastHeartbeat: c.lastHeartbeat,
    activeCallId: c.activeCallId,
  }));

  const stats = signalingServer.getStats();

  let gatewayStatus;
  try {
    gatewayStatus = getGatewayStatus();
  } catch {
    gatewayStatus = { configured: false, activeCalls: 0, connectedClients: 0 };
  }

  return {
    type: "snapshot",
    activeCalls,
    connectedClients: clients,
    stats: {
      ...stats,
      adminMonitorClients: adminClients.length,
    },
    gateway: gatewayStatus,
    pipelineMetrics: getMetricsSnapshot(),
    voiceMetrics: getVoiceMetricsSnapshot(),
    currentSeqId: globalSeqId,
    timestamp: Date.now(),
  };
}

async function validateAdminToken(url: string): Promise<number | null> {
  try {
    const urlObj = new URL(url, "http://localhost");
    const token = urlObj.searchParams.get("token");
    if (!token) return null;

    const { userSessions } = await import("@shared/schema");
    const [session] = await db
      .select()
      .from(userSessions)
      .where(eq(userSessions.token, token))
      .limit(1);

    if (!session || !session.userId) return null;
    if (session.expiresAt && new Date(session.expiresAt) < new Date()) return null;

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);

    if (!user || user.role !== "super_admin") return null;

    return user.id;
  } catch (err) {
    console.error("[AdminMonitor] Token validation error:", err);
    return null;
  }
}

export function setupAdminMonitor(wss: WebSocketServer): void {
  subscribeToSignalingEvents();

  wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
    const userId = await validateAdminToken(req.url || "");

    if (!userId) {
      ws.send(JSON.stringify({ type: "error", message: "Unauthorized" }));
      ws.close();
      return;
    }

    const client: AdminMonitorClient = {
      ws,
      userId,
      connectedAt: Date.now(),
      lastSeqId: globalSeqId,
    };

    adminClients.push(client);
    console.log(`[AdminMonitor] Admin connected (userId: ${userId}), total: ${adminClients.length}`);

    ws.send(JSON.stringify(getSnapshot()));

    const heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "heartbeat",
          timestamp: Date.now(),
          adminClients: adminClients.length,
          currentSeqId: globalSeqId,
        }));
      }
    }, 5000);

    const statsInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(getSnapshot()));
      }
    }, 10000);

    ws.on("message", (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "request_snapshot") {
          ws.send(JSON.stringify(getSnapshot()));
        } else if (msg.type === "replay_since" && typeof msg.seqId === "number") {
          replayMissedEvents(client, msg.seqId);
        }
      } catch {}
    });

    const removeClient = () => {
      const idx = adminClients.indexOf(client);
      if (idx !== -1) adminClients.splice(idx, 1);
      clearInterval(heartbeat);
      clearInterval(statsInterval);
    };

    ws.on("close", () => {
      removeClient();
      console.log(`[AdminMonitor] Admin disconnected, total: ${adminClients.length}`);
    });

    ws.on("error", () => {
      removeClient();
    });
  });
}
