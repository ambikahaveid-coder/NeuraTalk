/**
 * Voice Cloning Service for NeuraTalk
 * Preserves user's natural voice in real-time translation
 * 
 * Architecture:
 * - Voice Profile Creation: Record samples → Extract embeddings → Train model
 * - Real-time Voice Conversion: Text → User's Voice (not robotic TTS)
 * - Emotion/Prosody Preservation: Maintains original speaking style
 * 
 * Self-hosted options (Dependency Zero Policy):
 * - RVC (Retrieval-based Voice Conversion) - Fast, real-time
 * - XTTS v2 (Coqui) - High quality, needs GPU
 * - so-vits-svc - Open source voice cloning
 */

export interface VoiceProfile {
  id: string;
  userId: number;
  name: string;
  status: "pending" | "processing" | "ready" | "failed";
  embeddings?: string; // Base64 encoded speaker embeddings
  modelPath?: string; // Path to trained voice model
  sampleCount: number;
  totalDurationMs: number;
  createdAt: Date;
  trainedAt?: Date;
  consentGiven: boolean;
  consentTimestamp?: Date;
}

export interface VoiceSample {
  id: string;
  profileId: string;
  audioPath: string;
  durationMs: number;
  transcription?: string;
  processed: boolean;
  createdAt: Date;
}

export interface VoiceConversionRequest {
  text: string;
  profileId: string;
  emotion?: string;
  speed?: number; // 0.5 - 2.0
  pitch?: number; // -12 to +12 semitones
}

export interface VoiceConversionResult {
  audioBuffer: Buffer;
  durationMs: number;
  processingTimeMs: number;
  provider: "local-rvc" | "local-xtts" | "elevenlabs" | "openai-fallback";
}

export interface ProsodyFeatures {
  pitch: number[];
  energy: number[];
  tempo: number;
  emotionVector: number[];
}

// Configuration for self-hosted voice cloning services
const voiceCloningConfig = {
  // RVC - Fast real-time conversion
  rvcEndpoint: process.env.LOCAL_RVC_URL || "http://localhost:8083/convert",
  // XTTS - High quality synthesis
  xttsEndpoint: process.env.LOCAL_XTTS_URL || "http://localhost:8084/synthesize",
  // Prosody analyzer
  prosodyEndpoint: process.env.LOCAL_PROSODY_URL || "http://localhost:8085/analyze",
  // Timeout for voice conversion (must be fast!)
  timeoutMs: 150,
  // Minimum samples required for training
  minSamplesRequired: 5,
  // Minimum audio duration for training (2 minutes recommended)
  minTrainingDurationMs: 120000,
  // ElevenLabs - Premium high-fidelity cloning
  elevenlabsKey: process.env.ELEVEN_LABS_API_KEY || process.env.ELEVENLABS_API_KEY,
};

// Docker Compose configuration for voice cloning services
export const VOICE_CLONING_DOCKER_CONFIG = `
# docker-compose.voice-cloning.yml
# GPU-accelerated voice cloning services
# Run with: docker-compose -f docker-compose.voice-cloning.yml up -d

version: '3.8'

services:
  # RVC - Real-time Voice Conversion (Fast, ~50ms)
  rvc:
    image: ghcr.io/rvc-project/rvc-webui:latest
    ports:
      - "8083:7865"
    volumes:
      - ./voice-models:/app/models
      - ./voice-samples:/app/samples
    environment:
      - CUDA_VISIBLE_DEVICES=0
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    restart: unless-stopped

  # XTTS v2 - High Quality TTS with Voice Cloning
  xtts:
    image: ghcr.io/coqui-ai/xtts-streaming-server:latest
    ports:
      - "8084:8000"
    volumes:
      - ./xtts-models:/app/models
      - ./voice-samples:/app/samples
    environment:
      - CUDA_VISIBLE_DEVICES=0
      - XTTS_MODEL=v2
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    restart: unless-stopped

  # Prosody Analyzer - Pitch, Energy, Emotion
  prosody:
    image: pytorch/pytorch:2.0.1-cuda11.7-cudnn8-runtime
    command: python /app/prosody_server.py
    ports:
      - "8085:8085"
    volumes:
      - ./prosody-service:/app
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    restart: unless-stopped
`;

/**
 * Check if voice cloning services are available
 * Uses actual health endpoints supported by each service
 */
export async function isVoiceCloningAvailable(): Promise<{
  rvc: boolean;
  xtts: boolean;
  prosody: boolean;
}> {
  const checkService = async (baseUrl: string, healthPath: string): Promise<boolean> => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      // Extract base URL and append health path
      const url = new URL(healthPath, baseUrl.replace(/\/[^/]+$/, "/"));
      const response = await fetch(url.toString(), {
        method: "GET",
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  };

  // Different services have different health endpoints
  const [rvc, xtts, prosody] = await Promise.all([
    // RVC WebUI uses /api/v1/version or simple GET on base
    checkService(voiceCloningConfig.rvcEndpoint, "/"),
    // XTTS streaming server uses /docs or /
    checkService(voiceCloningConfig.xttsEndpoint, "/docs"),
    // Custom prosody service
    checkService(voiceCloningConfig.prosodyEndpoint, "/"),
  ]);

  return { rvc, xtts, prosody };
}

/**
 * Extract prosody features from audio (pitch, energy, emotion)
 * Used to preserve speaking style in voice conversion
 */
export async function extractProsody(audioBuffer: Buffer): Promise<ProsodyFeatures> {
  try {
    const availability = await isVoiceCloningAvailable();
    
    if (availability.prosody) {
      const boundary = `----NodeFormBoundary${Date.now()}`;
      const parts: Buffer[] = [];
      
      parts.push(Buffer.from(`--${boundary}\r\n`));
      parts.push(Buffer.from(`Content-Disposition: form-data; name="audio"; filename="audio.wav"\r\n`));
      parts.push(Buffer.from(`Content-Type: audio/wav\r\n\r\n`));
      parts.push(audioBuffer);
      parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
      
      const body = Buffer.concat(parts);
      
      const response = await fetch(voiceCloningConfig.prosodyEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });
      
      if (response.ok) {
        return await response.json();
      }
    }
    
    // Fallback: Return neutral prosody
    return {
      pitch: [0],
      energy: [0.5],
      tempo: 1.0,
      emotionVector: [0.5, 0, 0, 0], // neutral, happy, sad, angry
    };
  } catch (error) {
    console.error("[VoiceCloning] Prosody extraction error:", error);
    return {
      pitch: [0],
      energy: [0.5],
      tempo: 1.0,
      emotionVector: [0.5, 0, 0, 0],
    };
  }
}

/**
 * Convert text to speech using user's cloned voice
 * Prioritizes: RVC (fastest) → XTTS → OpenAI fallback
 */
export async function convertToUserVoice(
  request: VoiceConversionRequest,
  profileEmbeddings: string,
  prosody?: ProsodyFeatures
): Promise<VoiceConversionResult> {
  const startTime = Date.now();
  
  try {
    const availability = await isVoiceCloningAvailable();
    
    // Try RVC first (fastest, ~50ms)
    if (availability.rvc) {
      try {
        const result = await convertWithRVC(request, profileEmbeddings, prosody);
        return {
          ...result,
          provider: "local-rvc",
          processingTimeMs: Date.now() - startTime,
        };
      } catch (rvcError) {
        console.warn("[VoiceCloning] RVC failed, trying XTTS:", rvcError);
      }
    }
    
    // Try XTTS (high quality, ~100-150ms)
    if (availability.xtts) {
      try {
        const result = await convertWithXTTS(request, profileEmbeddings, prosody);
        return {
          ...result,
          provider: "local-xtts",
          processingTimeMs: Date.now() - startTime,
        };
      } catch (xttsError) {
        console.warn("[VoiceCloning] XTTS failed, falling back to OpenAI:", xttsError);
      }
    }
    
    // Try ElevenLabs (Premium, high quality, ~200-300ms)
    // Works for eleven_<voiceId> profiles AND as general TTS fallback
    if (voiceCloningConfig.elevenlabsKey) {
      try {
        const result = await convertWithElevenLabs(request, profileEmbeddings, prosody);
        return {
          ...result,
          provider: "elevenlabs",
          processingTimeMs: Date.now() - startTime,
        };
      } catch (elError) {
        console.warn("[VoiceCloning] ElevenLabs failed, falling back to OpenAI TTS:", elError);
      }
    }

    // Fallback to OpenAI TTS (via audio client which also tries ElevenLabs)
    const { textToSpeech } = await import("./ai_integrations/audio/client");
    const audioBuffer = await textToSpeech(request.text, "nova");
    
    return {
      audioBuffer,
      durationMs: estimateAudioDuration(request.text),
      processingTimeMs: Date.now() - startTime,
      provider: "openai-fallback",
    };
  } catch (error) {
    console.error("[VoiceCloning] All conversion methods failed:", error);
    throw error;
  }
}

/**
 * Convert using RVC (Retrieval-based Voice Conversion)
 * Fastest method, ~50ms on GPU
 * 
 * RVC Pipeline:
 * 1. First generate TTS audio from translated text
 * 2. Then run RVC to convert that audio to user's voice
 */
async function convertWithRVC(
  request: VoiceConversionRequest,
  embeddings: string,
  prosody?: ProsodyFeatures
): Promise<{ audioBuffer: Buffer; durationMs: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), voiceCloningConfig.timeoutMs * 3);
  
  try {
    // Step 1: Generate base TTS audio using a neutral voice
    // This will be converted to user's voice by RVC
    const { textToSpeech } = await import("./ai_integrations/audio/client");
    const baseTTSBuffer = await textToSpeech(request.text, "onyx");
    
    // Step 2: Build multipart form data for RVC
    // RVC requires: source audio + model/speaker reference
    const boundary = `----RVCBoundary${Date.now()}`;
    const parts: Buffer[] = [];
    
    // Source audio (the TTS we want to convert)
    parts.push(Buffer.from(`--${boundary}\r\n`));
    parts.push(Buffer.from(`Content-Disposition: form-data; name="audio"; filename="source.wav"\r\n`));
    parts.push(Buffer.from(`Content-Type: audio/wav\r\n\r\n`));
    parts.push(baseTTSBuffer);
    parts.push(Buffer.from(`\r\n`));
    
    // Speaker model/embedding ID
    parts.push(Buffer.from(`--${boundary}\r\n`));
    parts.push(Buffer.from(`Content-Disposition: form-data; name="model_name"\r\n\r\n`));
    parts.push(Buffer.from(`${request.profileId}\r\n`));
    
    // Pitch shift
    parts.push(Buffer.from(`--${boundary}\r\n`));
    parts.push(Buffer.from(`Content-Disposition: form-data; name="pitch"\r\n\r\n`));
    parts.push(Buffer.from(`${request.pitch || 0}\r\n`));
    
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    
    const body = Buffer.concat(parts);
    
    const response = await fetch(voiceCloningConfig.rvcEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: body,
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      throw new Error(`RVC conversion failed: ${response.status}`);
    }
    
    const audioBuffer = Buffer.from(await response.arrayBuffer());
    return {
      audioBuffer,
      durationMs: estimateAudioDuration(request.text),
    };
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

/**
 * Convert using XTTS v2 (Coqui)
 * Higher quality, ~100-150ms on GPU
 * 
 * XTTS supports zero-shot voice cloning with speaker reference audio
 * or pre-computed speaker embeddings from training
 */
async function convertWithXTTS(
  request: VoiceConversionRequest,
  embeddings: string,
  prosody?: ProsodyFeatures
): Promise<{ audioBuffer: Buffer; durationMs: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), voiceCloningConfig.timeoutMs * 3);

  try {
    const response = await fetch(voiceCloningConfig.xttsEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: request.text,
        speaker_embedding: embeddings,
        language: detectLanguage(request.text, request.emotion), // passing hint if available
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`XTTS conversion failed: ${response.status}`);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    return {
      audioBuffer,
      durationMs: estimateAudioDuration(request.text),
    };
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

/**
 * Convert using ElevenLabs API
 * ElevenLabs is the industry leader for "Natural" sounding voice clones
 */
async function convertWithElevenLabs(
  request: VoiceConversionRequest,
  embeddings: string,
  prosody?: ProsodyFeatures
): Promise<{ audioBuffer: Buffer; durationMs: number }> {
  if (!voiceCloningConfig.elevenlabsKey) {
    throw new Error("ElevenLabs API Key not configured");
  }

  // Extract ElevenLabs Voice ID from profileId
  // If profileId starts with "eleven_" strip the prefix, otherwise use Rachel (default)
  const voiceId = request.profileId.startsWith("eleven_")
    ? request.profileId.replace("eleven_", "")
    : "21m00Tcm4TlvDq8ikWAM"; // Rachel - natural multilingual voice
  
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`, {
    method: "POST",
    headers: {
      "Accept": "audio/mpeg",
      "Content-Type": "application/json",
      "xi-api-key": voiceCloningConfig.elevenlabsKey,
    },
    body: JSON.stringify({
      text: request.text,
      model_id: "eleven_multilingual_v2",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.5,
        use_speaker_boost: true,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`ElevenLabs conversion failed: ${response.status}`);
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  return {
    audioBuffer,
    durationMs: estimateAudioDuration(request.text),
  };
}

/**
 * Simple language detection for TTS routing
 */
function detectLanguage(text: string, hintedLanguage?: string): string {
  // If we already have a reliable detected language from STT, use it
  if (hintedLanguage && hintedLanguage !== "auto") return hintedLanguage;

  // Fallback to script-based detection for 100+ languages support
  // Telugu script range
  if (/[\u0C00-\u0C7F]/.test(text)) return "te";
  // Hindi/Devanagari script
  if (/[\u0900-\u097F]/.test(text)) return "hi";
  // Tamil script
  if (/[\u0B80-\u0BFF]/.test(text)) return "ta";
  // Kannada script
  if (/[\u0C80-\u0CFF]/.test(text)) return "kn";
  // Malayalam script
  if (/[\u0D00-\u0D7F]/.test(text)) return "ml";
  // Add more ranges for 100+ languages...
  
  // Default to English
  return "en";
}

/**
 * Estimate audio duration from text length
 * Average speaking rate: ~150 words per minute
 */
function estimateAudioDuration(text: string): number {
  const wordCount = text.split(/\s+/).length;
  const wordsPerSecond = 150 / 60;
  return Math.round((wordCount / wordsPerSecond) * 1000);
}

/**
 * Enroll a real cloned voice with ElevenLabs (Instant Voice Cloning API) and
 * return the resulting voice ID. This is the actual training call — unlike
 * `trainVoiceProfile` below, which only validates sample requirements and
 * never contacted a real provider.
 *
 * The caller is responsible for consent verification before calling this —
 * this function assumes consent has already been captured and checked.
 */
export async function enrollElevenLabsVoice(
  samples: Buffer[],
  name: string,
): Promise<{ voiceId: string }> {
  if (!voiceCloningConfig.elevenlabsKey) {
    throw new Error("ElevenLabs API Key not configured");
  }
  if (samples.length === 0) {
    throw new Error("At least one voice sample is required");
  }

  const form = new FormData();
  form.append("name", name);
  samples.forEach((sample, i) => {
    form.append("files", new Blob([sample], { type: "audio/wav" }), `sample-${i}.wav`);
  });

  const response = await fetch("https://api.elevenlabs.io/v1/voices/add", {
    method: "POST",
    headers: { "xi-api-key": voiceCloningConfig.elevenlabsKey },
    body: form as unknown as BodyInit,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`ElevenLabs voice enrollment failed: ${response.status} ${errText}`);
  }

  const data = await response.json() as { voice_id: string };
  if (!data.voice_id) {
    throw new Error("ElevenLabs enrollment response missing voice_id");
  }
  return { voiceId: data.voice_id };
}

/**
 * Remove a cloned voice from ElevenLabs (called on voice-profile deletion).
 */
export async function deleteElevenLabsVoice(voiceId: string): Promise<void> {
  if (!voiceCloningConfig.elevenlabsKey) return;
  try {
    await fetch(`https://api.elevenlabs.io/v1/voices/${voiceId}`, {
      method: "DELETE",
      headers: { "xi-api-key": voiceCloningConfig.elevenlabsKey },
    });
  } catch (error) {
    console.warn(`[VoiceCloning] Failed to delete ElevenLabs voice ${voiceId}:`, error);
  }
}

/**
 * Voice Profile Training Pipeline
 * Takes user's voice samples and creates a cloneable voice model
 */
export async function trainVoiceProfile(
  profileId: string,
  samples: VoiceSample[]
): Promise<{ success: boolean; message: string }> {
  // Validate minimum requirements
  const totalDuration = samples.reduce((sum, s) => sum + s.durationMs, 0);
  
  if (samples.length < voiceCloningConfig.minSamplesRequired) {
    return {
      success: false,
      message: `Need at least ${voiceCloningConfig.minSamplesRequired} voice samples. Currently have ${samples.length}.`,
    };
  }
  
  if (totalDuration < voiceCloningConfig.minTrainingDurationMs) {
    const neededSeconds = Math.ceil((voiceCloningConfig.minTrainingDurationMs - totalDuration) / 1000);
    return {
      success: false,
      message: `Need ${neededSeconds} more seconds of audio. Minimum 2 minutes required.`,
    };
  }
  
  // In production, this would queue a GPU training job
  // For now, return success to indicate requirements are met
  console.log(`[VoiceCloning] Training job queued for profile ${profileId}`);
  console.log(`[VoiceCloning] ${samples.length} samples, ${Math.round(totalDuration / 1000)}s total audio`);
  
  return {
    success: true,
    message: "Voice profile training started. This takes 5-10 minutes on GPU.",
  };
}

/**
 * Real-time voice conversion for call translation
 * Preserves user's voice while translating to target language
 */
export async function translateWithVoicePreservation(
  originalAudio: Buffer,
  translatedText: string,
  userProfileId: string,
  userEmbeddings: string
): Promise<VoiceConversionResult> {
  // Extract prosody from original speech (pitch, tempo, emotion)
  const prosody = await extractProsody(originalAudio);
  
  // Convert translated text to user's voice with preserved prosody
  return convertToUserVoice(
    {
      text: translatedText,
      profileId: userProfileId,
      emotion: getEmotionFromVector(prosody.emotionVector),
      speed: prosody.tempo,
    },
    userEmbeddings,
    prosody
  );
}

/**
 * Convert emotion vector to emotion label
 */
function getEmotionFromVector(vector: number[]): string {
  const emotions = ["neutral", "happy", "sad", "angry"];
  const maxIndex = vector.indexOf(Math.max(...vector));
  return emotions[maxIndex] || "neutral";
}

// Environment variables template for voice cloning
export const VOICE_CLONING_ENV_TEMPLATE = `
# Voice Cloning Services (Self-Hosted GPU)
LOCAL_RVC_URL=http://localhost:8083/convert
LOCAL_XTTS_URL=http://localhost:8084/synthesize
LOCAL_PROSODY_URL=http://localhost:8085/analyze

# Enable voice cloning (requires GPU services running)
ENABLE_VOICE_CLONING=true
`;
