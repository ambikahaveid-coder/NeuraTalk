import type { Express, Request, Response } from "express";
import OpenAI from "openai";
import { chatStorage } from "./storage";
import { getOpenAIKey, hasWorkingOpenAIKey } from "../../openai-config";
import { loadUser, requireAuth } from "../../role-middleware";

const openai = new OpenAI({
  apiKey: getOpenAIKey() || "",
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export function registerChatRoutes(app: Express): void {
  // P0 security fix (2026-08-23): none of these routes had any auth
  // middleware, and chatStorage's queries had no user filter at all --
  // any unauthenticated caller could list and read every user's AI-chat
  // conversation history. loadUser + requireAuth (the same pattern used
  // throughout personal-chat-routes.ts) now gate every route, and every
  // storage call is scoped to req.user!.id.

  // Get all conversations (only the caller's own)
  app.get("/api/conversations", loadUser, requireAuth, async (req: Request, res: Response) => {
    try {
      const conversations = await chatStorage.getAllConversations(req.user!.id);
      res.json(conversations);
    } catch (error) {
      console.error("Error fetching conversations:", error);
      res.status(500).json({ error: "Failed to fetch conversations" });
    }
  });

  // Get single conversation with messages (only if owned by the caller)
  app.get("/api/conversations/:id", loadUser, requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const conversation = await chatStorage.getConversation(id, req.user!.id);
      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }
      const messages = await chatStorage.getMessagesByConversation(id);
      res.json({ ...conversation, messages });
    } catch (error) {
      console.error("Error fetching conversation:", error);
      res.status(500).json({ error: "Failed to fetch conversation" });
    }
  });

  // Create new conversation, owned by the caller
  app.post("/api/conversations", loadUser, requireAuth, async (req: Request, res: Response) => {
    try {
      const { title } = req.body;
      const conversation = await chatStorage.createConversation(title || "New Chat", req.user!.id);
      res.status(201).json(conversation);
    } catch (error) {
      console.error("Error creating conversation:", error);
      res.status(500).json({ error: "Failed to create conversation" });
    }
  });

  // Delete conversation (only if owned by the caller)
  app.delete("/api/conversations/:id", loadUser, requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const owned = await chatStorage.getConversation(id, req.user!.id);
      if (!owned) {
        return res.status(404).json({ error: "Conversation not found" });
      }
      await chatStorage.deleteConversation(id, req.user!.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting conversation:", error);
      res.status(500).json({ error: "Failed to delete conversation" });
    }
  });

  // Send message and get AI response (streaming) -- only into a
  // conversation the caller actually owns
  app.post("/api/conversations/:id/messages", loadUser, requireAuth, async (req: Request, res: Response) => {
    try {
      const conversationId = parseInt(req.params.id);
      const { content } = req.body;

      const owned = await chatStorage.getConversation(conversationId, req.user!.id);
      if (!owned) {
        return res.status(404).json({ error: "Conversation not found" });
      }

      // Save user message
      await chatStorage.createMessage(conversationId, "user", content);

      // Get conversation history for context
      const messages = await chatStorage.getMessagesByConversation(conversationId);
      const chatMessages = messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

      // Set up SSE
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const isMockKey = !hasWorkingOpenAIKey();

      if (isMockKey) {
        // No real OpenAI key — return a helpful message via SSE
        const fallbackMsg = "I'm NEURA's internal assistant. The OpenAI API key is not configured. Please add a real OPENAI_API_KEY to the environment to enable full AI chat. In the meantime, you can use NeuraTalk's voice features and translation services which are powered by ElevenLabs.";
        res.write(`data: ${JSON.stringify({ content: fallbackMsg })}\n\n`);
        await chatStorage.createMessage(conversationId, "assistant", fallbackMsg);
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
        return;
      }

      // Stream response from OpenAI
      const stream = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: chatMessages,
        stream: true,
        max_completion_tokens: 2048,
      });

      let fullResponse = "";

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) {
          fullResponse += content;
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }

      // Save assistant message
      await chatStorage.createMessage(conversationId, "assistant", fullResponse);

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (error) {
      console.error("Error sending message:", error);
      const errMsg = "AI service temporarily unavailable. Please try again later or contact support.";
      // Check if headers already sent (SSE streaming started)
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ content: errMsg })}\n\n`);
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ error: "Failed to send message" });
      }
    }
  });
}

