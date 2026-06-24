import { Express, Request, Response } from "express";
import crypto from "crypto";

export interface CallRoom {
  id: string;
  token: string;
  hostUserId: number;
  hostName: string;
  callType: "video" | "audio" | "f2f";
  hostLanguage: string;
  guestLanguage: string;
  translationEnabled: boolean;
  voicePreservation: boolean;
  emotionPreservation: boolean;
  status: "waiting" | "active" | "ended";
  createdAt: number;
  expiresAt: number;
  guestName?: string;
  guestSessionId?: string;
  hostSessionId?: string;
}

const rooms = new Map<string, CallRoom>();
const tokenToRoom = new Map<string, string>();

function isLegacyMeetingTransportEnabled(): boolean {
  return (process.env.ENABLE_LEGACY_SIGNALING_WS || "").toLowerCase() === "true";
}

function generateToken(): string {
  return crypto.randomBytes(4).toString("hex");
}

function cleanExpiredRooms() {
  const now = Date.now();
  const expired: string[] = [];
  rooms.forEach((room, id) => {
    if (now > room.expiresAt) {
      tokenToRoom.delete(room.token);
      expired.push(id);
    }
  });
  expired.forEach(id => rooms.delete(id));
}

setInterval(cleanExpiredRooms, 60000);

export function registerRoomRoutes(app: Express) {
  app.post("/api/rooms/create", async (req: Request, res: Response) => {
    try {
      const { callType, hostLanguage, guestLanguage, translationEnabled, voicePreservation, emotionPreservation, hostName } = req.body;

      if (!callType || !hostLanguage || !guestLanguage) {
        res.status(400).json({ error: "callType, hostLanguage, guestLanguage required" });
        return;
      }

      if (callType !== "f2f" && !isLegacyMeetingTransportEnabled()) {
        res.status(409).json({
          error: "Legacy meeting transport is disabled for video/audio rooms",
          legacyTransportRequired: true,
          legacyTransportEnabled: false,
          recommendedRoute: "/calls/face-to-face",
        });
        return;
      }

      const id = `room_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const token = generateToken();

      const room: CallRoom = {
        id,
        token,
        hostUserId: (req as any).user?.id || 0,
        hostName: hostName || "Host",
        callType: callType || "video",
        hostLanguage,
        guestLanguage,
        translationEnabled: translationEnabled !== false,
        voicePreservation: voicePreservation || false,
        emotionPreservation: emotionPreservation !== false,
        status: "waiting",
        createdAt: Date.now(),
        expiresAt: Date.now() + 2 * 60 * 60 * 1000,
      };

      rooms.set(id, room);
      tokenToRoom.set(token, id);

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const joinLink = `${baseUrl}/join/${token}`;

      res.json({
        success: true,
        legacyTransportRequired: room.callType !== "f2f",
        legacyTransportEnabled: room.callType === "f2f" ? true : isLegacyMeetingTransportEnabled(),
        room: {
          id: room.id,
          token: room.token,
          callType: room.callType,
          hostLanguage: room.hostLanguage,
          guestLanguage: room.guestLanguage,
          status: room.status,
        },
        joinLink,
      });
    } catch (error) {
      console.error("Room creation error:", error);
      res.status(500).json({ error: "Failed to create room" });
    }
  });

  app.get("/api/rooms/:token", async (req: Request, res: Response) => {
    try {
      const { token } = req.params;
      const roomId = tokenToRoom.get(token);

      if (!roomId) {
        res.status(404).json({ error: "Room not found or expired" });
        return;
      }

      const room = rooms.get(roomId);
      if (!room) {
        res.status(404).json({ error: "Room not found" });
        return;
      }

      if (Date.now() > room.expiresAt) {
        rooms.delete(roomId);
        tokenToRoom.delete(token);
        res.status(410).json({ error: "Room has expired" });
        return;
      }

      if (room.callType !== "f2f" && !isLegacyMeetingTransportEnabled()) {
        res.status(409).json({
          error: "Legacy meeting transport is disabled for this room type",
          legacyTransportRequired: true,
          legacyTransportEnabled: false,
          callType: room.callType,
        });
        return;
      }

      res.json({
        id: room.id,
        token: room.token,
        callType: room.callType,
        hostName: room.hostName,
        hostLanguage: room.hostLanguage,
        guestLanguage: room.guestLanguage,
        translationEnabled: room.translationEnabled,
        voicePreservation: room.voicePreservation,
        emotionPreservation: room.emotionPreservation,
        status: room.status,
        legacyTransportRequired: room.callType !== "f2f",
        legacyTransportEnabled: room.callType === "f2f" ? true : isLegacyMeetingTransportEnabled(),
      });
    } catch (error) {
      console.error("Room lookup error:", error);
      res.status(500).json({ error: "Failed to get room" });
    }
  });

  app.post("/api/rooms/:token/join", async (req: Request, res: Response) => {
    try {
      const { token } = req.params;
      const { guestName, guestLanguage } = req.body;
      const roomId = tokenToRoom.get(token);

      if (!roomId) {
        res.status(404).json({ error: "Room not found or expired" });
        return;
      }

      const room = rooms.get(roomId);
      if (!room) {
        res.status(404).json({ error: "Room not found" });
        return;
      }

      if (room.status === "ended") {
        res.status(410).json({ error: "This call has ended" });
        return;
      }

      if (room.callType !== "f2f" && !isLegacyMeetingTransportEnabled()) {
        res.status(409).json({
          error: "Legacy meeting transport is disabled for this room type",
          legacyTransportRequired: true,
          legacyTransportEnabled: false,
          callType: room.callType,
        });
        return;
      }

      room.guestName = guestName || "Guest";
      if (guestLanguage) {
        room.guestLanguage = guestLanguage;
      }
      room.status = "active";

      res.json({
        success: true,
        roomId: room.id,
        callType: room.callType,
        hostLanguage: room.hostLanguage,
        guestLanguage: room.guestLanguage,
        translationEnabled: room.translationEnabled,
        voicePreservation: room.voicePreservation,
        emotionPreservation: room.emotionPreservation,
        hostName: room.hostName,
        legacyTransportRequired: room.callType !== "f2f",
        legacyTransportEnabled: room.callType === "f2f" ? true : isLegacyMeetingTransportEnabled(),
      });
    } catch (error) {
      console.error("Room join error:", error);
      res.status(500).json({ error: "Failed to join room" });
    }
  });

  app.post("/api/rooms/:token/end", async (req: Request, res: Response) => {
    try {
      const { token } = req.params;
      const roomId = tokenToRoom.get(token);

      if (!roomId) {
        res.status(404).json({ error: "Room not found" });
        return;
      }

      const room = rooms.get(roomId);
      if (room) {
        room.status = "ended";
      }

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to end room" });
    }
  });
}

export function getRoomByToken(token: string): CallRoom | undefined {
  const roomId = tokenToRoom.get(token);
  if (!roomId) return undefined;
  return rooms.get(roomId);
}

export function updateRoomSession(token: string, role: "host" | "guest", sessionId: string) {
  const roomId = tokenToRoom.get(token);
  if (!roomId) return;
  const room = rooms.get(roomId);
  if (!room) return;
  if (role === "host") {
    room.hostSessionId = sessionId;
  } else {
    room.guestSessionId = sessionId;
  }
}
