/**
 * Local AI Service - Self-Hosted Models for Ultra-Low Latency
 * 
 * Follows "Dependency Zero Policy" - No external SaaS dependencies
 * Target: <0.3s total translation latency
 * 
 * ARCHITECTURE:
 * 1. Self-hosted Whisper for STT (~50-100ms on GPU)
 * 2. Self-hosted NLLB/MarianMT for translation (~30-80ms on GPU)
 * 3. Local emotion detection (~20ms)
 * 
 * GPU REQUIREMENTS:
 * - Minimum: NVIDIA RTX 3060 (12GB VRAM) or equivalent
 * - Recommended: NVIDIA RTX 4080/A100 for production
 * 
 * DEPLOYMENT OPTIONS:
 * 1. Docker with NVIDIA Container Toolkit
 * 2. Kubernetes with GPU nodes
 * 3. Cloud GPU instances (AWS g4dn, GCP N1+T4, Azure NC series)
 */

export interface LocalSTTResult {
  text: string;
  language: string;
  confidence: number;
  processingTimeMs: number;
}

export interface LocalTranslationResult {
  translatedText: string;
  emotion?: string;
  processingTimeMs: number;
}

export interface LocalAIConfig {
  whisperEndpoint: string;      // e.g., "http://localhost:8080/transcribe"
  translationEndpoint: string;  // e.g., "http://localhost:8081/translate"
  emotionEndpoint?: string;     // e.g., "http://localhost:8082/emotion"
  timeoutMs: number;
}

const defaultConfig: LocalAIConfig = {
  whisperEndpoint: process.env.LOCAL_WHISPER_URL || "http://localhost:8080/transcribe",
  translationEndpoint: process.env.LOCAL_TRANSLATION_URL || "http://localhost:8081/translate",
  emotionEndpoint: process.env.LOCAL_EMOTION_URL || "http://localhost:8082/emotion",
  timeoutMs: 500, // 500ms max for entire pipeline
};

/**
 * Check if local AI services are available
 */
export async function isLocalAIAvailable(): Promise<{
  whisper: boolean;
  translation: boolean;
  emotion: boolean;
}> {
  const checkEndpoint = async (url: string): Promise<boolean> => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1000);
      const response = await fetch(`${url}/health`, { 
        signal: controller.signal,
        method: "GET"
      });
      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  };

  const [whisper, translation, emotion] = await Promise.all([
    checkEndpoint(defaultConfig.whisperEndpoint.replace("/transcribe", "")),
    checkEndpoint(defaultConfig.translationEndpoint.replace("/translate", "")),
    defaultConfig.emotionEndpoint 
      ? checkEndpoint(defaultConfig.emotionEndpoint.replace("/emotion", ""))
      : Promise.resolve(false),
  ]);

  return { whisper, translation, emotion };
}

/**
 * Local Whisper STT - Ultra-fast speech-to-text
 * Expected latency: 50-100ms on GPU
 */
export async function localSTT(
  audioBuffer: Buffer,
  language?: string
): Promise<LocalSTTResult> {
  const startTime = Date.now();
  
  try {
    // Use Node.js native fetch with multipart form data
    const boundary = `----NodeFormBoundary${Date.now()}`;
    const filename = "audio.wav";
    
    // Build multipart form data manually for Node.js compatibility
    const parts: Buffer[] = [];
    
    // Audio file part
    parts.push(Buffer.from(`--${boundary}\r\n`));
    parts.push(Buffer.from(`Content-Disposition: form-data; name="audio"; filename="${filename}"\r\n`));
    parts.push(Buffer.from(`Content-Type: audio/wav\r\n\r\n`));
    parts.push(audioBuffer);
    parts.push(Buffer.from(`\r\n`));
    
    // Language part (if provided)
    if (language) {
      parts.push(Buffer.from(`--${boundary}\r\n`));
      parts.push(Buffer.from(`Content-Disposition: form-data; name="language"\r\n\r\n`));
      parts.push(Buffer.from(`${language}\r\n`));
    }
    
    // End boundary
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    
    const body = Buffer.concat(parts);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), defaultConfig.timeoutMs);

    const response = await fetch(defaultConfig.whisperEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": body.length.toString(),
      },
      body: body,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Whisper STT failed: ${response.status}`);
    }

    const result = await response.json();
    
    return {
      text: result.text || "",
      language: result.language || language || "en",
      confidence: result.confidence || 1.0,
      processingTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    console.error("[LocalAI] STT error:", error);
    throw error;
  }
}

/**
 * Local Translation - Ultra-fast neural translation
 * Uses NLLB-200 or MarianMT for speed
 * Expected latency: 30-80ms on GPU
 */
export async function localTranslate(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
  detectEmotion: boolean = false
): Promise<LocalTranslationResult> {
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), defaultConfig.timeoutMs);

    const response = await fetch(defaultConfig.translationEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        source_lang: sourceLanguage,
        target_lang: targetLanguage,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Translation failed: ${response.status}`);
    }

    const result = await response.json();
    
    let emotion: string | undefined;
    
    // Parallel emotion detection if requested and endpoint available
    if (detectEmotion && defaultConfig.emotionEndpoint) {
      try {
        const emotionResponse = await fetch(defaultConfig.emotionEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (emotionResponse.ok) {
          const emotionResult = await emotionResponse.json();
          emotion = emotionResult.emotion || "neutral";
        }
      } catch {
        emotion = "neutral";
      }
    }

    return {
      translatedText: result.translated_text || result.translation || text,
      emotion,
      processingTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    console.error("[LocalAI] Translation error:", error);
    throw error;
  }
}

/**
 * Full pipeline: Audio -> STT -> Translation (target <300ms)
 */
export async function localTranslateSpeech(
  audioBuffer: Buffer,
  sourceLanguage: string,
  targetLanguage: string,
  detectEmotion: boolean = false
): Promise<{
  originalText: string;
  translatedText: string;
  emotion?: string;
  detectedLanguage?: string;
  totalTimeMs: number;
  sttTimeMs: number;
  translationTimeMs: number;
}> {
  const pipelineStart = Date.now();

  // Step 1: STT
  const sttResult = await localSTT(audioBuffer, sourceLanguage === "auto" ? undefined : sourceLanguage);
  
  if (!sttResult.text || sttResult.text.trim().length === 0) {
    return {
      originalText: "",
      translatedText: "",
      emotion: detectEmotion ? "neutral" : undefined,
      totalTimeMs: Date.now() - pipelineStart,
      sttTimeMs: sttResult.processingTimeMs,
      translationTimeMs: 0,
    };
  }

  // Step 2: Translation
  const translationResult = await localTranslate(
    sttResult.text,
    sttResult.language, // Use the language Whisper detected
    targetLanguage,
    detectEmotion
  );

  return {
    originalText: sttResult.text,
    translatedText: translationResult.translatedText,
    detectedLanguage: sttResult.language,
    emotion: translationResult.emotion,
    totalTimeMs: Date.now() - pipelineStart,
    sttTimeMs: sttResult.processingTimeMs,
    translationTimeMs: translationResult.processingTimeMs,
  };
}

/**
 * Docker Compose configuration for self-hosted AI services
 */
export const DOCKER_COMPOSE_CONFIG = `
# docker-compose.gpu.yml
# Run with: docker-compose -f docker-compose.gpu.yml up -d

version: '3.8'

services:
  whisper:
    image: onerahmet/openai-whisper-asr-webservice:latest-gpu
    ports:
      - "8080:9000"
    environment:
      - ASR_MODEL=tiny  # Options: tiny, base, small, medium, large
      - ASR_ENGINE=faster_whisper
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    restart: unless-stopped

  translation:
    image: libretranslate/libretranslate:latest
    ports:
      - "8081:5000"
    environment:
      - LT_LOAD_ONLY=en,hi,te,ta,ml,kn,mr,gu,bn,pa  # Indian languages
      - LT_SUGGESTIONS=false
      - LT_DISABLE_WEB_UI=true
    restart: unless-stopped

  # Alternative: NLLB for higher quality
  # nllb:
  #   image: ghcr.io/mozilla/nllb-translate:latest
  #   ports:
  #     - "8081:8000"
  #   deploy:
  #     resources:
  #       reservations:
  #         devices:
  #           - driver: nvidia
  #             count: 1
  #             capabilities: [gpu]
`;

/**
 * Environment variables for local AI configuration
 */
export const ENV_VARS_TEMPLATE = `
# Local AI Services (Self-Hosted)
LOCAL_WHISPER_URL=http://localhost:8080/transcribe
LOCAL_TRANSLATION_URL=http://localhost:8081/translate
LOCAL_EMOTION_URL=http://localhost:8082/emotion

# Set to 'true' to prefer local models over OpenAI
PREFER_LOCAL_AI=true
`;
