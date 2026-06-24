import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyCors from "@fastify/cors";
import type { FastifyRequest, FastifyReply } from "fastify";
import { chatStorage } from "./replit_integrations/chat/storage";
import { speechToText, textToSpeech, voiceChatWithTextModel, convertWebmToWav } from "./replit_integrations/audio/client";
import { sessionCache, presenceCache, emotionCache, contextCache } from "./cache";
import { storage } from "./storage";
import type { WebSocket } from "ws";
import { isOriginAllowed } from "./security-middleware";
import { logger } from "./observability";
import { getSessionDetails } from "./role-middleware";

async function extractVerifiedSession(req: FastifyRequest): Promise<{ userId: number } | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const session = await getSessionDetails(token).catch(() => null);
  if (!session) return null;
  return { userId: session.userId };
}

async function rejectUnauthorized(reply: FastifyReply): Promise<void> {
  reply.status(401).send({ error: "Unauthorized" });
}

// Human-like AI system prompt
const HUMAN_VOICE_SYSTEM_PROMPT = `You are NeuraTalk - a warm, friendly conversational AI with a human-like personality.

CORE BEHAVIOR:
- Speak naturally like a real human friend, NOT like a robotic assistant
- Use casual, conversational phrasing with natural sentence flow
- Include slight verbal fillers occasionally ("hmm", "well", "you know", "actually")
- Vary your sentence length - mix short punchy responses with longer explanations
- Show genuine interest and curiosity in what the user says

EMOTIONAL INTELLIGENCE:
- If the user sounds happy, excited, or enthusiastic - match their energy!
- If the user sounds sad, frustrated, or worried - respond with empathy first, solutions second
- Never give cold, factual responses to emotional messages
- Use phrases like "I totally get that", "That makes sense", "Oh that's exciting!"

LANGUAGE RULES:
- Automatically detect and respond in the same language the user speaks
- Support Telugu, Hindi, English, and natural code-mixing (Tenglish, Hinglish)
- If user mixes languages, feel free to mix languages in your response too
- Never force translation or switch languages unless the user asks
- For Telugu: Use conversational tone, not formal written Telugu

VOICE OPTIMIZATION:
- Write responses that sound natural when spoken aloud
- Use punctuation to create natural pauses (... for longer pauses, - for short breaks)
- Avoid long complex sentences that are hard to speak
- Use contractions (I'm, you're, that's, won't, can't)
- Keep responses concise but warm - don't ramble

AVOID:
- Starting responses with "I" too often
- Robotic phrases like "I understand", "Certainly", "I'd be happy to"
- Overly formal or textbook language
- Bullet points or numbered lists in voice responses
- Repeating the user's question back to them`;

export async function createFastifyServer() {
  const fastify = Fastify({
    logger: false,
    bodyLimit: 50 * 1024 * 1024, // 50MB for audio
  });

  await fastify.register(fastifyCors, {
    origin: (origin, callback) => {
      if (!origin || isOriginAllowed(origin)) {
        callback(null, true);
        return;
      }

      logger.warn("Fastify", "Rejected CORS origin", { origin });
      callback(new Error("Origin not allowed"), false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "X-Tenant-Id", "X-Tenant-Slug"],
  });
  await fastify.register(fastifyWebsocket);

  // WebSocket voice streaming endpoint
  fastify.register(async function (fastify) {
    fastify.get("/ws/voice/:conversationId", { websocket: true }, async (socket: WebSocket, req) => {
      // Auth: token passed as ?token= query param (WebSocket handshake cannot set Authorization header)
      const tokenParam = typeof (req.query as any)?.token === "string" ? (req.query as any).token as string : null;
      const session = tokenParam
        ? await getSessionDetails(tokenParam).catch(() => null)
        : null;
      if (!session) {
        socket.send(JSON.stringify({ type: "error", error: "Unauthorized" }));
        socket.close(4401, "Unauthorized");
        return;
      }

      const conversationId = parseInt((req.params as any).conversationId);
      let audioChunks: Buffer[] = [];
      let isProcessing = false;

      socket.on("message", async (data: Buffer | string) => {
        try {
          const message = typeof data === "string" ? JSON.parse(data) : JSON.parse(data.toString());

          if (message.type === "audio_chunk") {
            // Accumulate audio chunks
            audioChunks.push(Buffer.from(message.data, "base64"));
          } else if (message.type === "audio_end") {
            if (isProcessing) return;
            isProcessing = true;

            // Combine audio chunks
            const fullAudio = Buffer.concat(audioChunks);
            audioChunks = [];

            // Convert WebM to WAV if needed
            let audioBuffer = fullAudio;
            if (message.format === "webm") {
              audioBuffer = await convertWebmToWav(fullAudio);
            }

            // Get chat history
            const existingMessages = await chatStorage.getMessagesByConversation(conversationId);
            const chatHistory = existingMessages.map((m) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
            }));

            // Stream voice response
            let userTranscript = "";
            let assistantTranscript = "";

            for await (const event of voiceChatWithTextModel(audioBuffer, {
              voice: message.voice || "nova",
              inputFormat: "wav",
              chatHistory,
              locale: message.locale || "en",
              systemPrompt: HUMAN_VOICE_SYSTEM_PROMPT,
            })) {
              // Send event through WebSocket
              socket.send(JSON.stringify(event));

              if (event.type === "user_transcript") {
                userTranscript = event.data || "";
                await chatStorage.createMessage(conversationId, "user", userTranscript);
              }
              if (event.type === "transcript") {
                assistantTranscript = event.data || "";
              }
            }

            // Save assistant message
            if (assistantTranscript) {
              await chatStorage.createMessage(conversationId, "assistant", assistantTranscript);
            }

            isProcessing = false;
          } else if (message.type === "ping") {
            socket.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
          }
        } catch (err) {
          logger.error("Fastify", "WebSocket voice error", err as Error);
          socket.send(JSON.stringify({ type: "error", error: "Processing failed" }));
          isProcessing = false;
        }
      });

      socket.on("close", () => {
        audioChunks = [];
      });
    });
  });

  // Preload endpoint - called after login
  fastify.post("/api/preload/:userId", async (request, reply) => {
    const session = await extractVerifiedSession(request);
    const userId = parseInt((request.params as any).userId);
    if (!session || session.userId !== userId) {
      return rejectUnauthorized(reply);
    }
    const startTime = Date.now();

    try {
      // Parallel fetch all user context
      const [user, conversations] = await Promise.all([
        storage.getUser(userId),
        chatStorage.getAllConversations(),
      ]);

      if (!user) {
        return reply.status(404).send({ error: "User not found" });
      }

      // Get organization if exists
      let organization = null;
      if (user.organizationId) {
        organization = await storage.getOrganization(user.organizationId);
      }

      // Filter conversations for this user
      const userConversations = conversations.filter((c) => c.userId === userId);
      const recentConversations = userConversations.slice(0, 5);

      // Cache the context
      const context = {
        user,
        organization,
        recentConversations,
        systemPrompt: HUMAN_VOICE_SYSTEM_PROMPT,
        preloadedAt: Date.now(),
      };

      await contextCache.preloadUserContext(userId, context);
      await presenceCache.setOnline(userId);

      const loadTime = Date.now() - startTime;
      
      return {
        success: true,
        loadTime,
        context: {
          user: { id: user.id, username: user.username, role: user.role },
          organizationName: organization?.name,
          conversationCount: recentConversations.length,
        },
      };
    } catch (err) {
      logger.error("Fastify", "Preload error", err as Error);
      return reply.status(500).send({ error: "Preload failed" });
    }
  });

  // Get cached context
  fastify.get("/api/context/:userId", async (request, reply) => {
    const session = await extractVerifiedSession(request);
    const userId = parseInt((request.params as any).userId);
    if (!session || session.userId !== userId) {
      return rejectUnauthorized(reply);
    }
    const context = await contextCache.getUserContext(userId);
    
    if (!context) {
      return reply.status(404).send({ error: "No cached context" });
    }
    
    return context;
  });

  // Presence heartbeat
  fastify.post("/api/presence/:userId/heartbeat", async (request, reply) => {
    const session = await extractVerifiedSession(request);
    const userId = parseInt((request.params as any).userId);
    if (!session || session.userId !== userId) {
      return rejectUnauthorized(reply);
    }
    await presenceCache.setOnline(userId, 120); // 2 min TTL
    return { success: true };
  });

  return fastify;
}

// Export for hybrid use with Express
export { createFastifyServer as default };
