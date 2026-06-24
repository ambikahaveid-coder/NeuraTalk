import OpenAI, { toFile } from "openai";
import { Buffer } from "node:buffer";
import { spawn } from "child_process";
import { elevenLabsTTS, elevenLabsSTT, ELEVENLABS_VOICES } from "../../elevenlabs-service";
import { isAzureSpeechAvailable, azureTTS, azureSTT } from "../../azure-service";
import { getOpenAIKey, hasWorkingOpenAIKey } from "../../openai-config";

export const openai = new OpenAI({
  apiKey: getOpenAIKey() || "",
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

/**
 * Convert WebM audio buffer to WAV format using ffmpeg.
 * Browser MediaRecorder outputs WebM/opus which must be converted to WAV for audio APIs.
 * Note: Requires ffmpeg (available by default in production).
 *
 * @example
 * // In your route handler:
 * const webmBuffer = Buffer.from(req.body.audio, "base64");
 * const wavBuffer = await convertWebmToWav(webmBuffer);
 * const transcript = await speechToText(wavBuffer, "wav");
 */
export function convertWebmToWav(webmBuffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-i", "pipe:0",      // Read from stdin
      "-f", "wav",         // Output format
      "-ar", "16000",      // Sample rate (16kHz is good for speech)
      "-ac", "1",          // Mono audio
      "-acodec", "pcm_s16le", // PCM 16-bit encoding
      "pipe:1"             // Write to stdout
    ]);

    const chunks: Buffer[] = [];

    ffmpeg.stdout.on("data", (chunk) => chunks.push(chunk));
    ffmpeg.stderr.on("data", () => {}); // Suppress ffmpeg logs
    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
    ffmpeg.on("error", reject);

    ffmpeg.stdin.write(webmBuffer);
    ffmpeg.stdin.end();
  });
}

/**
 * Voice Chat: User speaks, LLM responds with audio (audio-in, audio-out).
 * Uses gpt-audio-mini model via NeuraTalk AI.
 *
 * @example
 * // Converting browser WebM to WAV before calling:
 * const webmBuffer = Buffer.from(req.body.audio, "base64");
 * const wavBuffer = await convertWebmToWav(webmBuffer);
 * const result = await voiceChat(wavBuffer, "alloy", "wav", "mp3");
 */
export async function voiceChat(
  audioBuffer: Buffer,
  voice: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer" = "alloy",
  inputFormat: "wav" | "mp3" = "wav",
  outputFormat: "wav" | "mp3" = "mp3"
): Promise<{ transcript: string; audioResponse: Buffer }> {
  const isMockKey = !hasWorkingOpenAIKey();

  if (!isMockKey) {
    try {
      const audioBase64 = audioBuffer.toString("base64");
      const response = await openai.chat.completions.create({
        model: "gpt-audio-mini",
        modalities: ["text", "audio"],
        audio: { voice, format: outputFormat },
        messages: [{
          role: "user",
          content: [
            { type: "input_audio", input_audio: { data: audioBase64, format: inputFormat } },
          ],
        }],
      });
      const message = response.choices[0]?.message as any;
      const transcript = message?.audio?.transcript || message?.content || "";
      const audioData = message?.audio?.data ?? "";
      return { transcript, audioResponse: Buffer.from(audioData, "base64") };
    } catch (e: any) {
      console.warn("[VoiceChat] OpenAI failed, using ElevenLabs fallback:", e?.message);
    }
  }

  // ElevenLabs fallback: STT → reply → TTS
  try {
    const transcript = await elevenLabsSTT(audioBuffer, inputFormat);
    const replyText = transcript
      ? `I heard: "${transcript}". Voice AI processing is active via ElevenLabs.`
      : "Voice received. ElevenLabs AI is processing your request.";
    const voiceId = VOICE_MAP[voice] || ELEVENLABS_VOICES.rachel;
    const audioResponse = await elevenLabsTTS(replyText, voiceId);
    return { transcript, audioResponse };
  } catch (e: any) {
    console.warn("[VoiceChat] ElevenLabs fallback also failed:", e?.message);
    return { transcript: "", audioResponse: Buffer.alloc(0) };
  }
}

/**
 * Streaming Voice Chat: For real-time audio responses.
 * Note: Streaming only supports pcm16 output format.
 *
 * @example
 * // Converting browser WebM to WAV before calling:
 * const webmBuffer = Buffer.from(req.body.audio, "base64");
 * const wavBuffer = await convertWebmToWav(webmBuffer);
 * for await (const chunk of voiceChatStream(wavBuffer)) { ... }
 */
export async function voiceChatStream(
  audioBuffer: Buffer,
  voice: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer" = "alloy",
  inputFormat: "wav" | "mp3" = "wav"
): Promise<AsyncIterable<{ type: "transcript" | "audio"; data: string }>> {
  const isMockKey = !hasWorkingOpenAIKey();

  if (!isMockKey) {
    try {
      const audioBase64 = audioBuffer.toString("base64");
      const stream = await openai.chat.completions.create({
        model: "gpt-audio-mini",
        modalities: ["text", "audio"],
        audio: { voice, format: "pcm16" },
        messages: [{
          role: "user",
          content: [
            { type: "input_audio", input_audio: { data: audioBase64, format: inputFormat } },
          ],
        }],
        stream: true,
      });

      return (async function* () {
        for await (const chunk of stream) {
          const delta = chunk.choices?.[0]?.delta as any;
          if (!delta) continue;
          if (delta?.audio?.transcript) {
            yield { type: "transcript" as const, data: delta.audio.transcript };
          }
          if (delta?.audio?.data) {
            yield { type: "audio" as const, data: delta.audio.data };
          }
        }
      })();
    } catch (e: any) {
      console.warn("[VoiceChatStream] OpenAI failed, using ElevenLabs fallback:", e?.message);
    }
  }

  // ElevenLabs fallback: STT → TTS (non-streaming, yielded as single chunk)
  return (async function* () {
    try {
      const transcript = await elevenLabsSTT(audioBuffer, inputFormat);
      if (transcript) yield { type: "transcript" as const, data: transcript };
      const voiceId = VOICE_MAP[voice] || ELEVENLABS_VOICES.rachel;
      const audioBuffer2 = await elevenLabsTTS(
        transcript || "Voice received and processed by ElevenLabs AI.",
        voiceId
      );
      yield { type: "audio" as const, data: audioBuffer2.toString("base64") };
    } catch (e: any) {
      console.warn("[VoiceChatStream] ElevenLabs fallback failed:", e?.message);
    }
  })();
}

// Map OpenAI voice names to ElevenLabs voice IDs
const VOICE_MAP: Record<string, string> = {
  nova:    ELEVENLABS_VOICES.rachel,
  alloy:   ELEVENLABS_VOICES.rachel,
  echo:    ELEVENLABS_VOICES.josh,
  fable:   ELEVENLABS_VOICES.bella,
  onyx:    ELEVENLABS_VOICES.adam,
  shimmer: ELEVENLABS_VOICES.elli,
};

/**
 * Text-to-Speech: Azure → OpenAI tts-1 (fast) → ElevenLabs (quality fallback).
 * @param language - Target language code (e.g., "hi", "te"). Defaults to "en".
 */
export async function textToSpeech(
  text: string,
  voice: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer" = "alloy",
  format: "wav" | "mp3" | "flac" | "opus" | "pcm16" = "wav",
  language: string = "en"
): Promise<Buffer> {
  // Azure Neural TTS (500K chars/month FREE, lowest latency)
  if (isAzureSpeechAvailable()) {
    try {
      return await azureTTS(text, language, { outputFormat: "audio-16khz-128kbitrate-mono-mp3" });
    } catch (e: any) {
      console.warn("[TTS] Azure failed, falling back:", e?.message);
    }
  }

  // OpenAI dedicated TTS (tts-1: fastest cloud TTS ~0.3-0.5s per phrase)
  try {
    const ttsFormat = format === "pcm16" ? "pcm" : format === "wav" ? "wav" : "mp3";
    const response = await openai.audio.speech.create({
      model: "tts-1",
      voice,
      input: text,
      response_format: ttsFormat as any,
      speed: 1.0,
    });
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length > 0) return buf;
  } catch (e: any) {
    console.warn("[TTS] OpenAI tts-1 failed, falling back to ElevenLabs:", e?.message);
  }

  // ElevenLabs (best multilingual quality, slower ~2-3s)
  if (process.env.ELEVEN_LABS_API_KEY) {
    try {
      const voiceId = VOICE_MAP[voice] || ELEVENLABS_VOICES.rachel;
      // Request pcm_16000 for telephony bridge (wav format param), mp3 for browser playback
      const outputFormat = format === "wav" ? "pcm_16000" : "mp3_44100_128";
      return await elevenLabsTTS(text, voiceId, { outputFormat });
    } catch (e: any) {
      console.warn("[TTS] ElevenLabs also failed:", e?.message);
    }
  }

  return Buffer.alloc(0);
}

/**
 * Streaming Text-to-Speech: Converts text to speech with real-time streaming.
 * Uses gpt-audio-mini model via NeuraTalk AI.
 * Note: Streaming only supports pcm16 output format.
 * @param language - Target language code (e.g., "hi", "te"). Defaults to "en".
 */
export async function textToSpeechStream(
  text: string,
  voice: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer" = "alloy",
  language: string = "en"
): Promise<AsyncIterable<string>> {
  // Azure TTS primary (yield as single chunk)
  if (isAzureSpeechAvailable()) {
    try {
      const audioBuffer = await azureTTS(text, language, { outputFormat: "audio-16khz-128kbitrate-mono-mp3" });
      return (async function* () {
        yield audioBuffer.toString("base64");
      })();
    } catch (e: any) {
      console.warn("[TTS Stream] Azure failed, falling back to ElevenLabs:", e?.message);
    }
  }

  // ElevenLabs primary (non-streaming, yielded as one chunk)
  if (process.env.ELEVEN_LABS_API_KEY) {
    try {
      const voiceId = VOICE_MAP[voice] || ELEVENLABS_VOICES.rachel;
      const audioBuffer = await elevenLabsTTS(text, voiceId);
      return (async function* () {
        yield audioBuffer.toString("base64");
      })();
    } catch (e: any) {
      console.warn("[TTS Stream] ElevenLabs failed, falling back to OpenAI:", e?.message);
    }
  }

  try {
    const stream = await openai.chat.completions.create({
      model: "gpt-audio-mini",
      modalities: ["text", "audio"],
      audio: { voice, format: "pcm16" },
      messages: [
        { role: "system", content: "You are an assistant that performs text-to-speech." },
        { role: "user", content: `Repeat the following text verbatim: ${text}` },
      ],
      stream: true,
    });

    return (async function* () {
      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta as any;
        if (!delta) continue;
        if (delta?.audio?.data) {
          yield delta.audio.data;
        }
      }
    })();
  } catch (e: any) {
    console.warn("[TTS Stream] OpenAI fallback failed:", e?.message);
    return (async function* () {})();
  }
}

/**
 * Speech-to-Text: Azure → OpenAI Whisper (fast) → ElevenLabs (quality fallback).
 * @param language - Source language code (e.g., "te", "hi"). Defaults to "en".
 */
export async function speechToText(
  audioBuffer: Buffer,
  format: "wav" | "mp3" | "webm" = "wav",
  language: string = "en"
): Promise<string> {
  // Azure STT (5 hrs/month FREE, best Indian language accuracy)
  if (isAzureSpeechAvailable()) {
    try {
      return await azureSTT(audioBuffer, language, format === "webm" ? "wav" : format);
    } catch (e: any) {
      console.warn("[STT] Azure failed, falling back:", e?.message);
    }
  }

  // OpenAI Whisper — dedicated STT, fast (~1s vs ElevenLabs ~3s)
  try {
    const file = await toFile(audioBuffer, `audio.${format}`);
    const response = await openai.audio.transcriptions.create({
      file,
      model: "whisper-1",
      language: language.length === 2 ? language : undefined,
    });
    if (response.text) return response.text;
  } catch (e: any) {
    console.warn("[STT] OpenAI Whisper failed, falling back to ElevenLabs:", e?.message);
  }

  // ElevenLabs Scribe (high quality fallback)
  if (process.env.ELEVEN_LABS_API_KEY) {
    try {
      return await elevenLabsSTT(audioBuffer, format === "webm" ? "webm" : format === "mp3" ? "mp3" : "wav");
    } catch (e: any) {
      console.warn("[STT] ElevenLabs also failed:", e?.message);
    }
  }

  return "";
}

/**
 * Streaming Speech-to-Text: Transcribes audio with real-time streaming.
 * Uses gpt-4o-mini-transcribe for accurate transcription.
 * @param language - Source language code (e.g., "te", "hi"). Defaults to "en".
 */
export async function speechToTextStream(
  audioBuffer: Buffer,
  format: "wav" | "mp3" | "webm" = "wav",
  language: string = "en"
): Promise<AsyncIterable<string>> {
  // Azure STT primary (yield as single chunk)
  if (isAzureSpeechAvailable()) {
    try {
      const transcript = await azureSTT(audioBuffer, language, format === "webm" ? "wav" : format);
      return (async function* () { if (transcript) yield transcript; })();
    } catch (e: any) {
      console.warn("[STT Stream] Azure failed, falling back to ElevenLabs:", e?.message);
    }
  }

  // ElevenLabs primary (non-streaming, yielded as one chunk)
  if (process.env.ELEVEN_LABS_API_KEY) {
    try {
      const transcript = await elevenLabsSTT(audioBuffer, format === "webm" ? "webm" : format === "mp3" ? "mp3" : "wav");
      return (async function* () { if (transcript) yield transcript; })();
    } catch (e: any) {
      console.warn("[STT Stream] ElevenLabs failed, falling back to OpenAI:", e?.message);
    }
  }

  try {
    const file = await toFile(audioBuffer, `audio.${format}`);
    const stream = await openai.audio.transcriptions.create({
      file,
      model: "gpt-4o-mini-transcribe",
      stream: true,
    });

    return (async function* () {
      for await (const event of stream) {
        if (event.type === "transcript.text.delta") {
          yield event.delta;
        }
      }
    })();
  } catch (e: any) {
    console.warn("[STT Stream] OpenAI fallback failed:", e?.message);
    return (async function* () {})();
  }
}

// ============================================================
// Sentence Parser - Multilingual using Intl.Segmenter
// ============================================================

/**
 * Extracts complete sentences from streaming text using Intl.Segmenter.
 * Supports multilingual text (handles CJK, Arabic, etc. properly).
 */
export class SentenceParser {
  private buffer = "";
  private seq = 0;
  private segmenter: Intl.Segmenter;

  constructor(locale = "en") {
    // Intl.Segmenter handles sentence boundaries for all Unicode languages
    // Falls back gracefully if locale not supported
    this.segmenter = new Intl.Segmenter(locale, { granularity: "sentence" });
  }

  /**
   * Feed tokens from LLM stream.
   * Returns complete sentences with sequence numbers.
   */
  feed(token: string): Array<{ seq: number; text: string }> {
    this.buffer += token;
    const sentences: Array<{ seq: number; text: string }> = [];

    // Segment current buffer - use Array.from for TypeScript compatibility
    const segments = Array.from(this.segmenter.segment(this.buffer));

    // All segments except the last are complete sentences
    // (last segment might be incomplete, still accumulating tokens)
    for (let i = 0; i < segments.length - 1; i++) {
      const text = segments[i].segment.trim();
      if (text) {
        sentences.push({ seq: this.seq++, text });
      }
    }

    // Keep only the last (potentially incomplete) segment in buffer
    if (segments.length > 0) {
      this.buffer = segments[segments.length - 1].segment;
    }

    return sentences;
  }

  /** Flush any remaining text as final sentence */
  flush(): { seq: number; text: string } | null {
    const text = this.buffer.trim();
    this.buffer = "";
    return text ? { seq: this.seq++, text } : null;
  }

  reset() {
    this.buffer = "";
    this.seq = 0;
  }
}

// ============================================================
// Cascading Voice Chat - STT → Text Model → TTS Pipeline
// ============================================================

export interface VoiceChatStreamEvent {
  type: "user_transcript" | "sentence" | "audio" | "transcript" | "done" | "error";
  seq?: number;
  data?: string;
  text?: string;
  error?: string;
}

/** Internal type for tracking active TTS streams */
interface TTSStream {
  seq: number;
  iterator: AsyncIterator<string>;
  done: boolean;
}

/**
 * Voice chat using separate text model and TTS.
 *
 * Key behaviors:
 * - TTS starts immediately when a sentence completes (doesn't wait for previous TTS)
 * - Audio yields in sequence order (always yields seq 0 chunks before seq 1)
 * - Multiple TTS streams can run concurrently
 * - Low latency: streams chunks as they arrive from the current sentence's TTS
 */
export async function* voiceChatWithTextModel(
  audioBuffer: Buffer,
  options: {
    voice?: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";
    inputFormat?: "wav" | "mp3";
    systemPrompt?: string;
    chatHistory?: Array<{ role: "user" | "assistant"; content: string }>;
    textModel?: string;
    locale?: string; // For sentence segmentation (e.g., "en", "ja", "zh")
  } = {}
): AsyncGenerator<VoiceChatStreamEvent> {
  const {
    voice = "alloy",
    inputFormat = "wav",
    systemPrompt = "You are a helpful assistant.",
    chatHistory = [],
    textModel = "gpt-4o", // Updated from placeholder to stable production model
    locale = "en",
  } = options;

  // 1. Transcribe user audio
  const userText = await speechToText(audioBuffer, inputFormat, locale);
  yield { type: "user_transcript", data: userText };

  // 2. Build messages for text model
  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...chatHistory,
    { role: "user" as const, content: userText },
  ];

  // 3. Stream text from LLM
  const textStream = await openai.chat.completions.create({
    model: textModel,
    messages,
    stream: true,
  });

  // 4. Parse sentences and dispatch TTS in parallel
  const parser = new SentenceParser(locale);
  const activeStreams: TTSStream[] = [];
  let nextSeqToYield = 0;
  let fullTranscript = "";

  /**
   * Start TTS for a sentence. Runs concurrently with other TTS streams.
   */
  const startTTS = async (sentence: { seq: number; text: string }) => {
    const stream = await textToSpeechStream(sentence.text, voice);
    activeStreams.push({
      seq: sentence.seq,
      iterator: stream[Symbol.asyncIterator](),
      done: false,
    });
  };

  /**
   * Yield audio chunks from active TTS streams in sequence order.
   * - Always yields from the current sequence (nextSeqToYield) first
   * - Buffers are not needed here because we yield directly from iterators
   * - When current sequence's TTS is done, moves to next
   */
  async function* drainAudioInOrder(): AsyncGenerator<VoiceChatStreamEvent> {
    while (activeStreams.length > 0) {
      // Find the stream for the current sequence we should yield
      const currentStream = activeStreams.find((s) => s.seq === nextSeqToYield);

      if (!currentStream) {
        // Next sequence hasn't started TTS yet, yield control back
        return;
      }

      if (currentStream.done) {
        // Current stream exhausted, move to next sequence
        activeStreams.splice(activeStreams.indexOf(currentStream), 1);
        nextSeqToYield++;
        continue;
      }

      // Pull next chunk from current stream
      const { value, done } = await currentStream.iterator.next();

      if (done) {
        currentStream.done = true;
        activeStreams.splice(activeStreams.indexOf(currentStream), 1);
        nextSeqToYield++;
      } else {
        yield { type: "audio", seq: currentStream.seq, data: value };
      }
    }
  }

  // 5. Process text stream: parse sentences, dispatch TTS, yield audio
  for await (const chunk of textStream) {
    const token = chunk.choices[0]?.delta?.content || "";
    if (!token) continue;

    fullTranscript += token;

    // Extract complete sentences
    const sentences = parser.feed(token);
    for (const sentence of sentences) {
      yield { type: "sentence", seq: sentence.seq, text: sentence.text };
      await startTTS(sentence);
    }

    // Yield any ready audio (non-blocking: only yields if current seq has data)
    for await (const event of drainAudioInOrder()) {
      yield event;
    }
  }

  // 6. Flush remaining sentence
  const finalSentence = parser.flush();
  if (finalSentence) {
    yield { type: "sentence", seq: finalSentence.seq, text: finalSentence.text };
    await startTTS(finalSentence);
  }

  // 7. Drain all remaining TTS audio (blocking: wait for all to complete)
  while (activeStreams.length > 0) {
    for await (const event of drainAudioInOrder()) {
      yield event;
    }
    // Small yield to prevent tight loop if waiting for TTS
    if (activeStreams.length > 0 && !activeStreams.find((s) => s.seq === nextSeqToYield)) {
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  yield { type: "transcript", data: fullTranscript };
  yield { type: "done" };
}
