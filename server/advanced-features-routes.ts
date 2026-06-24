import { Router, Request, Response } from "express";
import { db } from "./db";
import { 
  bridgedCalls, 
  callTranslations, 
  meetingRooms, 
  meetingParticipants,
  aiPersonas,
  userAnalytics,
  voiceProfiles,
  users
} from "@shared/schema";
import { eq, desc, and, gte, sql } from "drizzle-orm";
import { requireAuth } from "./role-middleware";

const router = Router();

function isLegacyMeetingTransportEnabled(): boolean {
  return (process.env.ENABLE_LEGACY_SIGNALING_WS || "").toLowerCase() === "true";
}

function legacyMeetingTransportPayload(roomType: "video" | "audio") {
  return {
    legacyTransportRequired: true,
    legacyTransportEnabled: false,
    recommendedRoute: roomType === "audio" ? "/calls/voice-translation" : "/calls/video-translation",
  };
}

// ============ CALL HISTORY ============

router.get("/call-history", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const calls = await db
      .select()
      .from(bridgedCalls)
      .where(eq(bridgedCalls.callerUserId, userId))
      .orderBy(desc(bridgedCalls.createdAt))
      .limit(50);

    res.json(calls);
  } catch (error) {
    console.error("Error fetching call history:", error);
    res.status(500).json({ error: "Failed to fetch call history" });
  }
});

router.get("/call-history/:callId", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const callId = parseInt(req.params.callId);

    const [call] = await db
      .select()
      .from(bridgedCalls)
      .where(and(
        eq(bridgedCalls.id, callId),
        eq(bridgedCalls.callerUserId, userId)
      ));

    if (!call) {
      return res.status(404).json({ error: "Call not found" });
    }

    const translations = await db
      .select()
      .from(callTranslations)
      .where(eq(callTranslations.callId, callId))
      .orderBy(callTranslations.timestamp);

    res.json({ call, translations });
  } catch (error) {
    console.error("Error fetching call details:", error);
    res.status(500).json({ error: "Failed to fetch call details" });
  }
});

// ============ VIDEO CALLS / MEETINGS ============

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

router.post("/meetings", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const { name, isVideoEnabled, isTranslationEnabled, defaultLanguage, maxParticipants } = req.body;
    const roomType = isVideoEnabled === false ? "audio" : "video";

    if (!isLegacyMeetingTransportEnabled()) {
      return res.status(409).json({
        error: "Legacy meeting transport is disabled for video/audio meetings",
        ...legacyMeetingTransportPayload(roomType),
      });
    }

    const roomCode = generateRoomCode();

    const [meeting] = await db
      .insert(meetingRooms)
      .values({
        roomCode,
        name: name || "New Meeting",
        hostUserId: userId,
        isVideoEnabled: isVideoEnabled ?? true,
        isTranslationEnabled: isTranslationEnabled ?? true,
        defaultLanguage: defaultLanguage || "en",
        maxParticipants: maxParticipants || 10,
        status: "scheduled",
      })
      .returning();

    res.json({
      ...meeting,
      legacyTransportRequired: true,
      legacyTransportEnabled: true,
    });
  } catch (error) {
    console.error("Error creating meeting:", error);
    res.status(500).json({ error: "Failed to create meeting" });
  }
});

router.get("/meetings", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;

    const meetings = await db
      .select()
      .from(meetingRooms)
      .where(eq(meetingRooms.hostUserId, userId))
      .orderBy(desc(meetingRooms.createdAt))
      .limit(20);

    res.json(meetings.map((meeting) => ({
      ...meeting,
      legacyTransportRequired: true,
      legacyTransportEnabled: isLegacyMeetingTransportEnabled(),
    })));
  } catch (error) {
    console.error("Error fetching meetings:", error);
    res.status(500).json({ error: "Failed to fetch meetings" });
  }
});

router.get("/meetings/:roomCode", async (req: Request, res: Response) => {
  try {
    const { roomCode } = req.params;

    const [meeting] = await db
      .select()
      .from(meetingRooms)
      .where(eq(meetingRooms.roomCode, roomCode.toUpperCase()));

    if (!meeting) {
      return res.status(404).json({ error: "Meeting not found" });
    }

    if (!isLegacyMeetingTransportEnabled()) {
      return res.status(409).json({
        error: "Legacy meeting transport is disabled for video/audio meetings",
        ...legacyMeetingTransportPayload(meeting.isVideoEnabled === false ? "audio" : "video"),
      });
    }

    const participants = await db
      .select({
        id: meetingParticipants.id,
        displayName: meetingParticipants.displayName,
        language: meetingParticipants.language,
        role: meetingParticipants.role,
        isVideoOn: meetingParticipants.isVideoOn,
        isAudioOn: meetingParticipants.isAudioOn,
        joinedAt: meetingParticipants.joinedAt,
      })
      .from(meetingParticipants)
      .where(and(
        eq(meetingParticipants.meetingId, meeting.id),
        sql`${meetingParticipants.leftAt} IS NULL`
      ));

    res.json({
      meeting: {
        ...meeting,
        legacyTransportRequired: true,
        legacyTransportEnabled: true,
      },
      participants,
    });
  } catch (error) {
    console.error("Error fetching meeting:", error);
    res.status(500).json({ error: "Failed to fetch meeting" });
  }
});

router.post("/meetings/:roomCode/join", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const { roomCode } = req.params;
    const { displayName, language } = req.body;

    const [meeting] = await db
      .select()
      .from(meetingRooms)
      .where(eq(meetingRooms.roomCode, roomCode.toUpperCase()));

    if (!meeting) {
      return res.status(404).json({ error: "Meeting not found" });
    }

    if (meeting.status === "ended") {
      return res.status(400).json({ error: "Meeting has ended" });
    }

    if (!isLegacyMeetingTransportEnabled()) {
      return res.status(409).json({
        error: "Legacy meeting transport is disabled for video/audio meetings",
        ...legacyMeetingTransportPayload(meeting.isVideoEnabled === false ? "audio" : "video"),
      });
    }

    const [user] = await db.select().from(users).where(eq(users.id, userId));

    const [participant] = await db
      .insert(meetingParticipants)
      .values({
        meetingId: meeting.id,
        userId,
        displayName: displayName || user?.username || "Guest",
        language: language || "en",
        role: meeting.hostUserId === userId ? "host" : "participant",
      })
      .returning();

    if (meeting.status === "scheduled") {
      await db
        .update(meetingRooms)
        .set({ status: "active", startedAt: new Date() })
        .where(eq(meetingRooms.id, meeting.id));
    }

    res.json({
      meeting: {
        ...meeting,
        legacyTransportRequired: true,
        legacyTransportEnabled: true,
      },
      participant,
    });
  } catch (error) {
    console.error("Error joining meeting:", error);
    res.status(500).json({ error: "Failed to join meeting" });
  }
});

router.post("/meetings/:roomCode/leave", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const { roomCode } = req.params;

    const [meeting] = await db
      .select()
      .from(meetingRooms)
      .where(eq(meetingRooms.roomCode, roomCode.toUpperCase()));

    if (!meeting) {
      return res.status(404).json({ error: "Meeting not found" });
    }

    await db
      .update(meetingParticipants)
      .set({ leftAt: new Date() })
      .where(and(
        eq(meetingParticipants.meetingId, meeting.id),
        eq(meetingParticipants.userId, userId)
      ));

    res.json({ success: true });
  } catch (error) {
    console.error("Error leaving meeting:", error);
    res.status(500).json({ error: "Failed to leave meeting" });
  }
});

router.post("/meetings/:roomCode/end", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const { roomCode } = req.params;

    const [meeting] = await db
      .select()
      .from(meetingRooms)
      .where(eq(meetingRooms.roomCode, roomCode.toUpperCase()));

    if (!meeting) {
      return res.status(404).json({ error: "Meeting not found" });
    }

    if (meeting.hostUserId !== userId) {
      return res.status(403).json({ error: "Only host can end meeting" });
    }

    const duration = meeting.startedAt 
      ? Math.floor((Date.now() - meeting.startedAt.getTime()) / 1000)
      : 0;

    await db
      .update(meetingRooms)
      .set({ status: "ended", endedAt: new Date(), duration })
      .where(eq(meetingRooms.id, meeting.id));

    await db
      .update(meetingParticipants)
      .set({ leftAt: new Date() })
      .where(and(
        eq(meetingParticipants.meetingId, meeting.id),
        sql`${meetingParticipants.leftAt} IS NULL`
      ));

    res.json({ success: true });
  } catch (error) {
    console.error("Error ending meeting:", error);
    res.status(500).json({ error: "Failed to end meeting" });
  }
});

// ============ AI PERSONAS ============

router.get("/personas", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;

    const publicPersonas = await db
      .select()
      .from(aiPersonas)
      .where(and(
        eq(aiPersonas.isPublic, true),
        eq(aiPersonas.isActive, true)
      ))
      .orderBy(desc(aiPersonas.usageCount));

    const userPersonas = await db
      .select()
      .from(aiPersonas)
      .where(and(
        eq(aiPersonas.createdBy, userId),
        eq(aiPersonas.isActive, true)
      ));

    res.json({
      public: publicPersonas,
      custom: userPersonas,
    });
  } catch (error) {
    console.error("Error fetching personas:", error);
    res.status(500).json({ error: "Failed to fetch personas" });
  }
});

router.post("/personas", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const { name, description, systemPrompt, voiceId, category, personality, language, isPublic } = req.body;

    if (!name || !systemPrompt) {
      return res.status(400).json({ error: "Name and system prompt required" });
    }

    const [persona] = await db
      .insert(aiPersonas)
      .values({
        name,
        description,
        systemPrompt,
        voiceId: voiceId || "alloy",
        category: category || "general",
        personality: personality || "friendly",
        language: language || "en",
        isPublic: isPublic || false,
        createdBy: userId,
      })
      .returning();

    res.json(persona);
  } catch (error) {
    console.error("Error creating persona:", error);
    res.status(500).json({ error: "Failed to create persona" });
  }
});

router.get("/personas/:id", async (req: Request, res: Response) => {
  try {
    const personaId = parseInt(req.params.id);

    const [persona] = await db
      .select()
      .from(aiPersonas)
      .where(eq(aiPersonas.id, personaId));

    if (!persona) {
      return res.status(404).json({ error: "Persona not found" });
    }

    res.json(persona);
  } catch (error) {
    console.error("Error fetching persona:", error);
    res.status(500).json({ error: "Failed to fetch persona" });
  }
});

router.put("/personas/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const personaId = parseInt(req.params.id);
    const updates = req.body;

    const [existing] = await db
      .select()
      .from(aiPersonas)
      .where(eq(aiPersonas.id, personaId));

    if (!existing) {
      return res.status(404).json({ error: "Persona not found" });
    }

    if (existing.createdBy !== userId) {
      return res.status(403).json({ error: "Cannot edit persona you didn't create" });
    }

    const [updated] = await db
      .update(aiPersonas)
      .set(updates)
      .where(eq(aiPersonas.id, personaId))
      .returning();

    res.json(updated);
  } catch (error) {
    console.error("Error updating persona:", error);
    res.status(500).json({ error: "Failed to update persona" });
  }
});

router.delete("/personas/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const personaId = parseInt(req.params.id);

    const [existing] = await db
      .select()
      .from(aiPersonas)
      .where(eq(aiPersonas.id, personaId));

    if (!existing) {
      return res.status(404).json({ error: "Persona not found" });
    }

    if (existing.createdBy !== userId) {
      return res.status(403).json({ error: "Cannot delete persona you didn't create" });
    }

    await db
      .update(aiPersonas)
      .set({ isActive: false })
      .where(eq(aiPersonas.id, personaId));

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting persona:", error);
    res.status(500).json({ error: "Failed to delete persona" });
  }
});

// Increment persona usage
router.post("/personas/:id/use", requireAuth, async (req: Request, res: Response) => {
  try {
    const personaId = parseInt(req.params.id);

    await db
      .update(aiPersonas)
      .set({ usageCount: sql`${aiPersonas.usageCount} + 1` })
      .where(eq(aiPersonas.id, personaId));

    res.json({ success: true });
  } catch (error) {
    console.error("Error incrementing persona usage:", error);
    res.status(500).json({ error: "Failed to update usage" });
  }
});

// ============ VOICE PROFILES ============

router.get("/voice-profiles", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;

    const profiles = await db
      .select()
      .from(voiceProfiles)
      .where(eq(voiceProfiles.userId, userId));

    const defaultVoices = [
      { id: "alloy", name: "Alloy", description: "Neutral and balanced" },
      { id: "echo", name: "Echo", description: "Warm and engaging" },
      { id: "fable", name: "Fable", description: "British and expressive" },
      { id: "onyx", name: "Onyx", description: "Deep and authoritative" },
      { id: "nova", name: "Nova", description: "Friendly and optimistic" },
      { id: "shimmer", name: "Shimmer", description: "Clear and refined" },
    ];

    res.json({
      custom: profiles,
      default: defaultVoices,
    });
  } catch (error) {
    console.error("Error fetching voice profiles:", error);
    res.status(500).json({ error: "Failed to fetch voice profiles" });
  }
});

router.post("/voice-profiles", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const { name, voiceId, settings } = req.body;

    if (!name || !voiceId) {
      return res.status(400).json({ error: "Name and voice ID required" });
    }

    const [profile] = await db
      .insert(voiceProfiles)
      .values({
        userId,
        name,
        voiceId,
        settings: settings || {},
        isCustom: false,
        isEnabled: true,
      })
      .returning();

    res.json(profile);
  } catch (error) {
    console.error("Error creating voice profile:", error);
    res.status(500).json({ error: "Failed to create voice profile" });
  }
});

// ============ ANALYTICS ============

router.get("/analytics", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const days = parseInt(req.query.days as string) || 30;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const analytics = await db
      .select()
      .from(userAnalytics)
      .where(and(
        eq(userAnalytics.userId, userId),
        gte(userAnalytics.date, startDate)
      ))
      .orderBy(userAnalytics.date);

    const calls = await db
      .select()
      .from(bridgedCalls)
      .where(and(
        eq(bridgedCalls.callerUserId, userId),
        gte(bridgedCalls.createdAt, startDate)
      ));

    const totalCalls = calls.length;
    const totalMinutes = calls.reduce((sum, c) => sum + (c.duration || 0) / 60, 0);
    const completedCalls = calls.filter(c => c.status === "completed").length;

    res.json({
      summary: {
        totalCalls,
        totalMinutes: Math.round(totalMinutes),
        completedCalls,
        averageDuration: totalCalls > 0 ? Math.round(totalMinutes / totalCalls) : 0,
      },
      daily: analytics,
      recentCalls: calls.slice(0, 10),
    });
  } catch (error) {
    console.error("Error fetching analytics:", error);
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

// ============ DEFAULT PERSONAS (Seed) ============

router.post("/personas/seed-defaults", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const user = await db.select().from(users).where(eq(users.id, userId));
    
    if (user[0]?.role !== "super_admin") {
      return res.status(403).json({ error: "Admin only" });
    }

    const defaultPersonas = [
      {
        name: "Professional Assistant",
        description: "Formal and business-oriented AI for professional conversations",
        systemPrompt: "You are a professional business assistant. Be formal, precise, and helpful. Focus on productivity and efficiency.",
        voiceId: "onyx",
        category: "business",
        personality: "professional",
        isPublic: true,
        isDefault: true,
      },
      {
        name: "Friendly Helper",
        description: "Warm and approachable AI for casual conversations",
        systemPrompt: "You are a friendly and warm assistant. Be casual, supportive, and encouraging. Make conversations feel natural and comfortable.",
        voiceId: "nova",
        category: "general",
        personality: "friendly",
        isPublic: true,
        isDefault: true,
      },
      {
        name: "Language Tutor",
        description: "Patient language learning companion",
        systemPrompt: "You are a patient language tutor. Help users practice languages, correct their mistakes gently, and provide encouragement. Explain grammar clearly.",
        voiceId: "fable",
        category: "education",
        personality: "patient",
        isPublic: true,
        isDefault: true,
      },
      {
        name: "Tech Expert",
        description: "Technical advisor for coding and technology",
        systemPrompt: "You are a knowledgeable tech expert. Explain technical concepts clearly, help with coding problems, and provide best practices.",
        voiceId: "echo",
        category: "technology",
        personality: "analytical",
        isPublic: true,
        isDefault: true,
      },
      {
        name: "Wellness Coach",
        description: "Supportive mental wellness companion",
        systemPrompt: "You are a supportive wellness coach. Be empathetic, calming, and encouraging. Help with stress management and positive thinking.",
        voiceId: "shimmer",
        category: "health",
        personality: "empathetic",
        isPublic: true,
        isDefault: true,
      },
    ];

    for (const persona of defaultPersonas) {
      const [existing] = await db
        .select()
        .from(aiPersonas)
        .where(eq(aiPersonas.name, persona.name));

      if (!existing) {
        await db.insert(aiPersonas).values({
          ...persona,
          createdBy: userId,
        });
      }
    }

    res.json({ success: true, message: "Default personas seeded" });
  } catch (error) {
    console.error("Error seeding personas:", error);
    res.status(500).json({ error: "Failed to seed personas" });
  }
});

export default router;
