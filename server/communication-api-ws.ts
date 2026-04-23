import { IncomingMessage } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { authenticateApiKey } from "./api-key-auth";
import { communicationApiEvents, getCommunicationCallStatus } from "./communication-api-service";

interface CommunicationWsClient {
  ws: WebSocket;
  sessionId: string;
  apiKeyId: number;
}

const clients = new Set<CommunicationWsClient>();

function removeClient(client: CommunicationWsClient) {
  clients.delete(client);
}

export function setupCommunicationApiWebSocket(wss: WebSocketServer): void {
  wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url || "", "http://localhost");
    const sessionId = url.searchParams.get("session_id") || "";
    const apiKeyFromQuery = url.searchParams.get("api_key") || undefined;
    const apiKeyFromHeader = req.headers["x-api-key"];
    const rawApiKey = typeof apiKeyFromHeader === "string" ? apiKeyFromHeader : apiKeyFromQuery;

    const auth = await authenticateApiKey(rawApiKey, "ws:subscribe");
    const authError = auth.body && typeof auth.body.error === "string" ? auth.body.error : "Unauthorized";
    if (!auth.ok || !auth.apiKey || !sessionId) {
      ws.send(JSON.stringify({
        type: "error",
        error: sessionId ? authError : "session_id is required",
      }));
      ws.close();
      return;
    }

    const client: CommunicationWsClient = {
      ws,
      sessionId,
      apiKeyId: auth.apiKey.id,
    };
    clients.add(client);

    try {
      const snapshot = await getCommunicationCallStatus(auth.apiKey, sessionId);
      ws.send(JSON.stringify({ type: "snapshot", data: snapshot }));
    } catch (error) {
      ws.send(JSON.stringify({ type: "error", error: "Session not found" }));
      ws.close();
      removeClient(client);
      return;
    }

    const forwardEvent = (event: Record<string, unknown>) => {
      if (client.ws.readyState !== WebSocket.OPEN) return;
      if (event.sessionId !== client.sessionId) return;
      client.ws.send(JSON.stringify({ type: "event", data: event }));
    };

    communicationApiEvents.on("event", forwardEvent);

    const heartbeat = setInterval(async () => {
      if (ws.readyState !== WebSocket.OPEN) return;
      try {
        const snapshot = await getCommunicationCallStatus(auth.apiKey!, sessionId);
        ws.send(JSON.stringify({ type: "snapshot", data: snapshot }));
      } catch {
        ws.send(JSON.stringify({ type: "error", error: "Session not found" }));
      }
    }, 5_000);

    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === "request_snapshot") {
          const snapshot = await getCommunicationCallStatus(auth.apiKey!, sessionId);
          ws.send(JSON.stringify({ type: "snapshot", data: snapshot }));
        }
      } catch {
        ws.send(JSON.stringify({ type: "error", error: "Invalid message payload" }));
      }
    });

    const cleanup = () => {
      clearInterval(heartbeat);
      communicationApiEvents.off("event", forwardEvent);
      removeClient(client);
    };

    ws.on("close", cleanup);
    ws.on("error", cleanup);
  });
}
