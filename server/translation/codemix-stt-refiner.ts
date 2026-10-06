/**
 * Code-mixed speech refinement for live calls.
 *
 * Indian callers mix languages ("nenu meeting lo unnanu, five minutes lo call
 * chesta"). Azure's streaming STT keeps captions fast, but on code-mixed audio
 * it transliterates English words and mishears numbers ("five minutes" ->
 * "15 minutes", "ten minutes" -> "110 minutes"). Sarvam's codemix STT gets
 * these right, so each finished utterance is re-recognised with Sarvam before
 * its final translation. Partials still come from the streaming provider; if
 * Sarvam is slow or fails, the streaming transcript is used unchanged.
 */
import { isSarvamAvailable, isSarvamLanguage, sarvamSTT } from "../sarvam-service";
import { logger } from "../observability";

const SAMPLE_RATE = 16_000;
const MAX_UTTERANCE_MS = parsePositiveInt(process.env.CODEMIX_REFINE_MAX_UTTERANCE_MS, 30_000);
const MIN_UTTERANCE_MS = 400;
const REFINE_TIMEOUT_MS = parsePositiveInt(process.env.CODEMIX_REFINE_TIMEOUT_MS, 2_500);

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** PCM16 mono audio of the utterance in progress, capped to the most recent MAX_UTTERANCE_MS. */
export class UtteranceAudioBuffer {
  private frames: Int16Array[] = [];
  private samples = 0;
  private readonly maxSamples: number;

  constructor(maxMs = MAX_UTTERANCE_MS, private readonly sampleRate = SAMPLE_RATE) {
    this.maxSamples = Math.round((maxMs / 1000) * sampleRate);
  }

  push(frame: Int16Array): void {
    if (!frame.length) return;
    this.frames.push(frame.slice());
    this.samples += frame.length;
    while (this.samples > this.maxSamples && this.frames.length > 1) {
      this.samples -= this.frames.shift()!.length;
    }
  }

  get durationMs(): number {
    return (this.samples / this.sampleRate) * 1000;
  }

  reset(): void {
    this.frames = [];
    this.samples = 0;
  }

  /** Drops all but the most recent `ms` of audio (silence before a new utterance). */
  keepLast(ms: number): void {
    const keep = Math.round((ms / 1000) * this.sampleRate);
    while (this.samples > keep && this.frames.length > 0) {
      const first = this.frames[0];
      const excess = this.samples - keep;
      if (first.length <= excess) {
        this.frames.shift();
        this.samples -= first.length;
      } else {
        this.frames[0] = first.slice(excess);
        this.samples -= excess;
      }
    }
  }

  /** Returns the buffered audio as a WAV file and clears the buffer. */
  takeWav(): Buffer | null {
    if (!this.samples) return null;
    const pcm = Buffer.alloc(this.samples * 2);
    let offset = 0;
    for (const frame of this.frames) {
      for (let i = 0; i < frame.length; i++, offset += 2) pcm.writeInt16LE(frame[i], offset);
    }
    this.reset();
    return Buffer.concat([wavHeader(pcm.length, this.sampleRate), pcm]);
  }
}

function wavHeader(dataBytes: number, sampleRate: number): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + dataBytes, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(dataBytes, 40);
  return h;
}

/** Refinement applies to Indian-language speakers (English-only speech is already handled well). */
export function shouldRefineCodemix(language: string): boolean {
  if ((process.env.CODEMIX_STT_REFINE || "true").trim().toLowerCase() === "false") return false;
  const base = normalizeBase(language);
  return base !== "en" && base !== "auto" && isSarvamLanguage(base) && isSarvamAvailable();
}

function normalizeBase(language: string): string {
  return (language || "").split("-")[0].toLowerCase();
}

/**
 * Re-recognises one finished utterance with Sarvam. Returns the streaming
 * transcript unchanged when the audio is too short, Sarvam is slow or fails,
 * or Sarvam's text is implausibly short next to the streaming text (a sign it
 * only caught part of the utterance).
 */
export async function refineCodemixTranscript(
  wav: Buffer | null,
  language: string,
  streamingText: string,
  opts: { timeoutMs?: number; stt?: typeof sarvamSTT } = {},
): Promise<{ text: string; refined: boolean; reason: string; ms: number }> {
  const startedAt = Date.now();
  const done = (text: string, refined: boolean, reason: string) => ({ text, refined, reason, ms: Date.now() - startedAt });
  if (!wav || wav.length <= 44) return done(streamingText, false, "no_audio");
  const audioMs = ((wav.length - 44) / 2 / SAMPLE_RATE) * 1000;
  if (audioMs < MIN_UTTERANCE_MS) return done(streamingText, false, "too_short");

  const stt = opts.stt ?? sarvamSTT;
  const timeoutMs = opts.timeoutMs ?? REFINE_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      stt(wav, normalizeBase(language), "wav"),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), timeoutMs); }),
    ]);
    const text = String(result || "").replace(/\s+/g, " ").trim();
    if (!text) return done(streamingText, false, "empty");
    const streamingLen = streamingText.replace(/\s+/g, "").length;
    if (streamingLen > 0 && text.replace(/\s+/g, "").length < streamingLen * 0.5) {
      return done(streamingText, false, "implausibly_short");
    }
    return done(text, true, "ok");
  } catch (error) {
    logger.debug("CodemixRefiner", `sarvam refine skipped: ${String(error)}`);
    return done(streamingText, false, String(error).includes("timeout") ? "timeout" : "error");
  } finally {
    if (timer) clearTimeout(timer);
  }
}
