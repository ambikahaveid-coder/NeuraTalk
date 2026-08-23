import type { Express, Request, Response } from "express";
import { chatStorage } from "../chat/storage";
import { openai, speechToText, textToSpeech, voiceChatWithTextModel, convertWebmToWav } from "./client";
import { analyzeAndStoreEmotion, generateEmotionAwarePrompt, getEmotionContext } from "../../emotion-engine";
import { loadUser, requireAuth } from "../../role-middleware";
import { rateLimiter } from "../../production-routes";
import {
  elevenLabsListVoices,
  elevenLabsCreateVoice,
  elevenLabsDeleteVoice,
  elevenLabsGetSubscription,
  elevenLabsTTS,
  translateText,
  ELEVENLABS_VOICES,
} from "../../elevenlabs-service";

// Human-like AI system prompt for natural conversations
// Architecture: Separated from AI provider for easy swapping
// Brand: Neura - premium, calm, intelligent companion
const HUMAN_VOICE_SYSTEM_PROMPT = `You are NeuraTalk by Neura - a premium, calm human companion. Users should emotionally trust you.

BRAND IDENTITY:
- You represent Neura - a premium brand
- Every interaction must feel calm, intelligent, respectful
- Never behave like a cheap chatbot
- When in doubt: choose simplicity and warmth
- User must feel understood and valued

CORE IDENTITY:
- You're the same trusted friend every day - consistent personality
- Speak like having chai with someone - relaxed, real, present
- Your goal: make user feel heard, not informed
- Emotion affects your tone, never your identity

HUMAN THINKING:
- Don't jump to conclusions instantly
- Take brief conversational pauses: "Hmm... let me think", "Okay, I see what you mean"
- Avoid perfect logic chains in casual chats
- Think emotionally first, logically second
- Sometimes just acknowledge: "Okay." "Hmm, that makes sense."

EMPATHY-FIRST RULE (CRITICAL):
- ALWAYS acknowledge emotion before advice
- NEVER give solutions immediately to emotional messages
- First: understanding. Then: gently help.
- Example: "Naku life lo clarity ledu" → validate feeling first, guidance later

SHORT RESPONSE WISDOM:
- Sometimes very short replies are perfect: "Okay." "Got it." "Hmm, I hear you."
- Don't always reply with long messages
- Short responses must still feel caring, not cold
- Allow conversational silence where appropriate

LANGUAGE INTELLIGENCE:
- NEVER assume default language - detect per sentence
- Mixed conversations natural (Telugu + English + Hindi)
- "Bro naku today chala stress undi" → reply same mixed style
- Don't translate word-by-word - keep cultural phrasing
- If user switches mid-sentence, follow seamlessly

EMOTION DRIFT:
- Track how user emotion changes over conversation
- Adapt tone gradually, not suddenly
- Never switch sad → happy tone abruptly
- Smooth emotional transitions only

VOICE TIMING (TTS):
- Insert ... for micro-pauses between thoughts
- Use - for slight pause before emotional words
- Emotional user: shorter sentences, more pauses
- Casual chat: slightly faster pacing
- Simulate breathing gaps - never continuous blocks

UNCERTAINTY & HONESTY:
- If unsure, admit naturally: "I'm not fully sure, but..."
- Never fake confidence
- Errors should feel human: "Let me think about that again..."
- No system-generated error messages

QUIET LEARNING:
- Learn user preferences subtly over time
- NEVER say "I stored this" or "I remember you said..."
- Adapt behavior quietly - don't announce it
- Don't remind user of old personal details unnecessarily

MEMORY BEHAVIOR:
- Remember emotional context over facts
- Forget irrelevant details naturally
- Prioritize recent conversations
- Never recall unnaturally: "As per our conversation..."

NEVER DO:
- Jump to conclusions or advice immediately
- Start with "I" repeatedly
- Use: "Certainly", "I understand", "I'd be happy to", "Great question"
- Sound like documentation or teacher
- Use bullet points or numbered lists
- Repeat user's question back
- Give perfectly structured responses
- Switch emotions abruptly
- Fake confidence when unsure

ALWAYS DO:
- Pause and acknowledge before responding to heavy topics
- Sound like a real person - warm, calm, present
- Be helpful but not eager
- Match energy gradually
- Respect silence
- Fast imperfect > slow perfect`;

// Note: Set express.json({ limit: "50mb" }) for audio payloads.
// Note: Use convertWebmToWav() to convert browser WebM to WAV before API calls.
export function registerAudioRoutes(app: Express): void {
  // Text-to-Speech endpoint - converts text to audio (requires auth + rate limited)
  app.post("/api/audio/speech", loadUser, requireAuth, rateLimiter("api"), async (req: Request, res: Response) => {
    try {
      const { text, voice = "nova", language = "en" } = req.body;

      if (!text) {
        return res.status(400).json({ error: "Text is required" });
      }

      const audioBuffer = await textToSpeech(text, voice, "mp3", language);
      
      res.json({
        audio: audioBuffer.toString("base64"),
        format: "mp3",
      });
    } catch (error) {
      console.error("TTS error:", error);
      res.status(500).json({ error: "Text-to-speech failed" });
    }
  });

  // NOTE (2026-08-23): the four CRUD routes for /api/conversations that used
  // to live here (GET list, GET one, POST create, DELETE) were an exact
  // duplicate of server/ai_integrations/chat/routes.ts's registerChatRoutes,
  // registered second (server/routes.ts registers chat routes first) --
  // Express matches the first-registered handler for an identical
  // path+method, so this block was dead, unreachable code, not a second
  // live implementation. Removed rather than updated when chat/routes.ts's
  // copy got the P0 auth/ownership fix, to avoid maintaining a second,
  // divergent (and here, security-sensitive) definition of the same routes.
  // The voice-message route below is a real, distinct feature (different
  // request/response shape) and is unaffected.

  // Send voice message and get streaming audio response
  // Uses gpt-4o-mini-transcribe for STT, gpt-audio-mini for voice response
  // For text model control, chain: speechToText() -> text model -> textToSpeech()
  app.post("/api/conversations/:id/messages", async (req: Request, res: Response) => {
    try {
      const conversationId = parseInt(req.params.id);
      const { audio, voice = "alloy", inputFormat = "wav" } = req.body;

      if (!audio) {
        return res.status(400).json({ error: "Audio data (base64) is required" });
      }

      // 1. Transcribe user audio
      const audioBuffer = Buffer.from(audio, "base64");
      const userTranscript = await speechToText(audioBuffer, inputFormat);

      // 2. Detect user's emotion from transcript
      const sessionId = `conv_${conversationId}`;
      const emotionContext = await analyzeAndStoreEmotion(sessionId, userTranscript);
      const emotionPrompt = generateEmotionAwarePrompt(emotionContext);

      // 3. Save user message
      await chatStorage.createMessage(conversationId, "user", userTranscript);

      // 4. Get conversation history
      const existingMessages = await chatStorage.getMessagesByConversation(conversationId);
      const chatHistory = existingMessages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

      // 5. Set up SSE
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      res.write(`data: ${JSON.stringify({ type: "user_transcript", data: userTranscript })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: "emotion", data: emotionContext.current })}\n\n`);

      // 6. Stream audio response with emotion-aware system prompt
      const emotionAwareSystemPrompt = HUMAN_VOICE_SYSTEM_PROMPT + emotionPrompt;
      const stream = await openai.chat.completions.create({
        model: "gpt-audio-mini",
        modalities: ["text", "audio"],
        audio: { voice, format: "pcm16" },
        messages: [
          { role: "system", content: emotionAwareSystemPrompt },
          ...chatHistory,
        ],
        stream: true,
      });

      let assistantTranscript = "";

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta as any;
        if (!delta) continue;

        if (delta?.audio?.transcript) {
          assistantTranscript += delta.audio.transcript;
          res.write(`data: ${JSON.stringify({ type: "transcript", data: delta.audio.transcript })}\n\n`);
        }

        if (delta?.audio?.data) {
          res.write(`data: ${JSON.stringify({ type: "audio", data: delta.audio.data })}\n\n`);
        }
      }

      // 6. Save assistant message
      await chatStorage.createMessage(conversationId, "assistant", assistantTranscript);

      res.write(`data: ${JSON.stringify({ type: "done", transcript: assistantTranscript })}\n\n`);
      res.end();
    } catch (error) {
      console.error("Error processing voice message:", error);
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ type: "error", error: "Failed to process voice message" })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ error: "Failed to process voice message" });
      }
    }
  });

  // Voice chat using separate text model (GPT-5) + TTS pipeline
  // Streams sentences to TTS as they're generated for lower latency
  // Supports multilingual sentence detection via locale parameter
  // Includes emotion detection for adaptive responses
  app.post("/api/conversations/:id/voice-stream", async (req: Request, res: Response) => {
    try {
      const conversationId = parseInt(req.params.id);
      const { audio, voice = "alloy", inputFormat = "wav", locale = "en" } = req.body;

      if (!audio) {
        return res.status(400).json({ error: "Audio data (base64) is required" });
      }

      // Get conversation history
      const existingMessages = await chatStorage.getMessagesByConversation(conversationId);
      const chatHistory = existingMessages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

      // Set up SSE
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const audioBuffer = Buffer.from(audio, "base64");
      const sessionId = `conv_${conversationId}`;
      let userTranscript = "";
      let assistantTranscript = "";
      let emotionAwarePrompt = HUMAN_VOICE_SYSTEM_PROMPT;

      // Stream the voice chat pipeline with emotion-aware system prompt
      for await (const event of voiceChatWithTextModel(audioBuffer, {
        voice,
        inputFormat,
        chatHistory,
        locale,
        systemPrompt: emotionAwarePrompt,
      })) {
        if (event.type === "user_transcript") {
          userTranscript = event.data || "";
          await chatStorage.createMessage(conversationId, "user", userTranscript);

          // Detect emotion from user's transcript and update prompt for future responses
          const emotionContext = await analyzeAndStoreEmotion(sessionId, userTranscript);
          const emotionAddition = generateEmotionAwarePrompt(emotionContext);
          emotionAwarePrompt = HUMAN_VOICE_SYSTEM_PROMPT + emotionAddition;

          // Send emotion data to frontend
          res.write(`data: ${JSON.stringify({ type: "emotion", data: emotionContext.current })}\n\n`);
        }
        if (event.type === "transcript") {
          assistantTranscript = event.data || "";
        }

        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }

      // Save assistant message
      await chatStorage.createMessage(conversationId, "assistant", assistantTranscript);
      res.end();
    } catch (error) {
      console.error("Error in voice stream:", error);
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ type: "error", error: "Voice stream failed" })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ error: "Voice stream failed" });
      }
    }
  });

  // Get emotion context for a conversation
  app.get("/api/conversations/:id/emotion", async (req: Request, res: Response) => {
    try {
      const conversationId = parseInt(req.params.id);
      const sessionId = `conv_${conversationId}`;
      const context = await getEmotionContext(sessionId);

      if (!context) {
        return res.json({ emotion: "neutral", intensity: 0.5, trend: "stable" });
      }

      res.json({
        emotion: context.current.emotion,
        intensity: context.current.intensity,
        trend: context.trend,
        history: context.history.slice(-5),
      });
    } catch (error) {
      console.error("Error fetching emotion:", error);
      res.status(500).json({ error: "Failed to fetch emotion context" });
    }
  });

  // Real-time text translation endpoint (requires auth + rate limited)
  app.post("/api/translate", loadUser, requireAuth, rateLimiter("api"), async (req: Request, res: Response) => {
    try {
      // Support both naming conventions for API flexibility
      const { 
        text, 
        fromLanguage, 
        toLanguage, 
        sourceLanguage, 
        targetLanguage,
        from: fromShort,
        to: toShort,
        preserveEmotion = true 
      } = req.body;
      
      const from = fromLanguage || sourceLanguage || fromShort;
      const to = toLanguage || targetLanguage || toShort;

      if (!text || !to) {
        return res.status(400).json({ error: "Text and target language required" });
      }

      const systemPrompt = preserveEmotion
        ? `You are a real-time translator. Translate the following text from ${from || "auto-detected language"} to ${to}. 
           RULES:
           - Preserve the emotional tone and intensity of the original message
           - Keep cultural nuances where possible
           - Use natural, spoken language (not formal/bookish)
           - If mixed language (like Hinglish or Tenglish), translate appropriately
           - Respond ONLY with the translation, no explanations`
        : `Translate the following text to ${to}. Respond only with the translation.`;

      let translation = text;
      try {
        const aiResp = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: text },
          ],
          max_tokens: 500,
          temperature: 0.3,
        });
        translation = aiResp.choices[0]?.message?.content || text;
      } catch {
        // OpenAI unavailable — fall back to MyMemory free translation
        translation = await translateText(text, from || "en", to);
      }

      res.json({
        success: true,
        original: text,
        translation,
        translatedText: translation,
        fromLanguage: from || "auto",
        toLanguage: to,
      });
    } catch (error) {
      console.error("Translation error:", error);
      res.status(500).json({ error: "Translation failed" });
    }
  });

  // Real-time speech translation (audio in, translated audio out) - requires auth + rate limited
  app.post("/api/translate/speech", loadUser, requireAuth, rateLimiter("upload"), async (req: Request, res: Response) => {
    try {
      const { 
        audio, 
        fromLanguage, 
        toLanguage, 
        voice = "alloy",
        inputFormat = "wav" 
      } = req.body;

      if (!audio || !toLanguage) {
        return res.status(400).json({ error: "Audio and target language required" });
      }

      // 1. Transcribe the speech
      const audioBuffer = Buffer.from(audio, "base64");
      const transcript = await speechToText(audioBuffer, inputFormat, fromLanguage || "en");

      // 2. Translate the text (OpenAI primary, MyMemory fallback)
      let translation = transcript;
      try {
        const translateResponse = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `Translate from ${fromLanguage || "auto"} to ${toLanguage}. Use natural spoken language. Respond only with translation.`,
            },
            { role: "user", content: transcript },
          ],
          max_tokens: 500,
          temperature: 0.3,
        });
        translation = translateResponse.choices[0]?.message?.content || transcript;
      } catch {
        translation = await translateText(transcript, fromLanguage || "en", toLanguage);
      }

      // 3. Generate speech from translation (streaming)
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      res.write(`data: ${JSON.stringify({ type: "transcript", data: transcript })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: "translation", data: translation })}\n\n`);

      // Generate TTS for the translation
      const ttsBuffer = await textToSpeech(translation, voice, "mp3", toLanguage);
      res.write(`data: ${JSON.stringify({ 
        type: "audio", 
        data: ttsBuffer.toString("base64"),
        format: "mp3"
      })}\n\n`);

      res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      res.end();
    } catch (error) {
      console.error("Speech translation error:", error);
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ type: "error", error: "Speech translation failed" })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ error: "Speech translation failed" });
      }
    }
  });

  // Simple voice chat endpoint (non-streaming, returns JSON) - requires auth + rate limited
  // Supports both audio input (voice) and text input (typing)
  // Supports responseLanguage parameter to respond in the selected language
  app.post("/api/audio/voice-chat", loadUser, requireAuth, rateLimiter("upload"), async (req: Request, res: Response) => {
    try {
      const { 
        audio, 
        text,
        voice = "nova", 
        inputFormat = "webm",
        responseLanguage = "en",
        systemPrompt,
        conversationId,
      } = req.body;

      if (!audio && !text) {
        return res.status(400).json({ error: "Either audio (base64) or text is required" });
      }

      let transcript = "";

      if (text) {
        transcript = text;
      } else {
        // 1. Convert audio to WAV if needed
        let audioBuffer = Buffer.from(audio, "base64");
        if (inputFormat === "webm") {
          audioBuffer = await convertWebmToWav(audioBuffer);
        } else if (inputFormat === "pcm16" || inputFormat === "raw") {
          const { createWavFromPCM16 } = await import("./wav-helper");
          audioBuffer = createWavFromPCM16(audioBuffer, 16000);
        }

        // 2. Transcribe the speech
        try {
          transcript = await speechToText(audioBuffer, inputFormat === "mp3" ? "mp3" : "wav");
        } catch (sttErr: any) {
          console.warn("[VoiceChat] STT failed:", sttErr?.message);
          return res.json({ transcript: "", response: "I couldn't hear you clearly. Please try again.", audio: null, audioFormat: "mp3" });
        }

        if (!transcript || transcript.trim().length === 0) {
          return res.json({ transcript: "", response: "I didn't catch that. Could you say that again?", audio: null, audioFormat: "mp3" });
        }
      }

      // 3. Generate AI response in the requested language
      const languageNames: Record<string, string> = {
        en: "English",
        es: "Spanish",
        fr: "French",
        de: "German",
        zh: "Chinese",
        ja: "Japanese",
        hi: "Hindi",
        ar: "Arabic",
        te: "Telugu",
        ta: "Tamil",
        kn: "Kannada",
      };

      const langName = languageNames[responseLanguage] || "English";
      const emotionSessionId = conversationId || `voice-chat:${req.user?.id || "anon"}:${responseLanguage}`;
      const emotionContext = await analyzeAndStoreEmotion(emotionSessionId, transcript);
      const emotionPrompt = generateEmotionAwarePrompt(emotionContext);
      const effectiveSystemPrompt = [
        (typeof systemPrompt === "string" && systemPrompt.trim()) || HUMAN_VOICE_SYSTEM_PROMPT,
        emotionPrompt,
        `CRITICAL LANGUAGE INSTRUCTION:\nYou MUST respond ONLY in ${langName}. Do NOT respond in any other language. Even if the user speaks a different language, you MUST reply in ${langName}. This is a strict requirement.`,
      ].filter(Boolean).join("\n\n");

      let response = "";
      try {
        const chatResponse = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: effectiveSystemPrompt,
            },
            { role: "user", content: transcript },
          ],
          max_tokens: 500,
          temperature: 0.7,
        });
        response = chatResponse.choices[0]?.message?.content || "";
      } catch {
        // OpenAI unavailable — acknowledge the user's message politely
        const fallbacks: Record<string, string> = {
          te: "మీ మాట విన్నాను. AI కనెక్షన్ సెటప్ అవుతోంది, కొద్దిసేపు వేచి ఉండండి.",
          hi: "आपकी बात सुन ली। AI कनेक्शन सेट हो रहा है, कृपया प्रतीक्षा करें।",
          en: "I heard you. The AI service is being configured. Please add a valid OpenAI API key to enable full responses.",
        };
        response = fallbacks[responseLanguage] || fallbacks.en;
      }

      // 4. Generate TTS for the response (uses ElevenLabs automatically)
      const ttsBuffer = await textToSpeech(response, voice, "mp3", responseLanguage);

      res.json({
        transcript,
        response,
        audio: ttsBuffer.toString("base64"),
        audioFormat: "mp3",
        language: responseLanguage,
        emotion: emotionContext.current.emotion,
        emotionIntensity: emotionContext.current.intensity,
        emotionTrend: emotionContext.trend,
      });
    } catch (error) {
      console.error("Voice chat error:", error);
      res.status(500).json({ error: "Voice chat failed" });
    }
  });

  // ─── ElevenLabs Voice Management ────────────────────────────────────────────

  // List available voices (built-in + user clones)
  app.get("/api/voice/elevenlabs/voices", loadUser, requireAuth, async (_req: Request, res: Response) => {
    try {
      const voices = await elevenLabsListVoices();
      res.json({ voices });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to list voices" });
    }
  });

  // Get ElevenLabs subscription / usage
  app.get("/api/voice/elevenlabs/subscription", loadUser, requireAuth, async (_req: Request, res: Response) => {
    try {
      const sub = await elevenLabsGetSubscription();
      res.json(sub);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to get subscription" });
    }
  });

  // Quick TTS with a specific ElevenLabs voice (for previews)
  app.post("/api/voice/elevenlabs/tts", loadUser, requireAuth, rateLimiter("api"), async (req: Request, res: Response) => {
    try {
      const { text, voiceId } = req.body;
      if (!text) return res.status(400).json({ error: "text required" });
      const audio = await elevenLabsTTS(text, voiceId || ELEVENLABS_VOICES.rachel);
      res.json({ audio: audio.toString("base64"), format: "mp3" });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "TTS failed" });
    }
  });

  // Clone a voice — accepts base64 audio files
  app.post("/api/voice/elevenlabs/clone", loadUser, requireAuth, rateLimiter("upload"), async (req: Request, res: Response) => {
    try {
      const { name, samples, description } = req.body as {
        name: string;
        description?: string;
        samples: Array<{ audio: string; filename: string }>; // base64 audio
      };

      if (!name || !samples?.length) {
        return res.status(400).json({ error: "name and samples[] required" });
      }

      const buffers = samples.map((s) => ({
        buffer: Buffer.from(s.audio, "base64"),
        filename: s.filename || "sample.mp3",
      }));

      const result = await elevenLabsCreateVoice(name, buffers, description);

      // Store the voice_id in the DB voice profile if user has one
      res.json({
        success: true,
        voice_id: result.voice_id,
        name: result.name,
        profileId: `eleven_${result.voice_id}`, // use this as profileId in calls
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Voice cloning failed" });
    }
  });

  // Delete a cloned voice
  app.delete("/api/voice/elevenlabs/:voiceId", loadUser, requireAuth, async (req: Request, res: Response) => {
    try {
      await elevenLabsDeleteVoice(req.params.voiceId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Delete voice failed" });
    }
  });
}
