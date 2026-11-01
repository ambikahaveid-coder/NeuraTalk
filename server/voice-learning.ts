/**
 * Learn a caller's own voice from the call itself.
 *
 * The product promise: the other person hears your translated words in YOUR
 * voice, never a bot voice. That needs a sample of your voice. People who
 * never visit "Your voice" used to get captions only. With their one-time
 * permission (users.voice_learning_consent_at), the translator bot collects
 * the first ~25 s of clear speech they say in a call, creates their voice
 * clone from it, and switches their translated speech to it mid-call.
 *
 * The collected audio is held in memory only for this purpose, sent to the
 * voice provider once, and never stored. A voice the person switched off,
 * or an admin rejected, is never re-created.
 */
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { users, voiceProfiles } from "@shared/schema";
import { logger } from "./observability";
import { rememberClonedVoice } from "./cloned-voice";

const SAMPLE_RATE = 16_000;
/** Clear speech needed before creating the voice (provider minimum is ~10 s; more is closer to the real voice). */
// 15 s (was 25 s): the caller switches to their own voice sooner in their first call.
export const VOICE_LEARNING_TARGET_MS = Number(process.env.VOICE_LEARNING_TARGET_MS) || 15_000;
/** Enough to still create a voice if the call ends early. */
const VOICE_LEARNING_MIN_MS = 10_000;
const FAILURE_COOLDOWN_MS = 60 * 60_000;

const inProgress = new Set<number>();
const failedAt = new Map<number, number>();

function userIdOf(identity: string): number | null {
  const id = Number(identity);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** May NeuraTalk learn this caller's voice from this call? */
export async function canLearnVoice(identity: string): Promise<boolean> {
  const userId = userIdOf(identity);
  if (!userId || !process.env.ELEVENLABS_API_KEY) return false;
  if (inProgress.has(userId)) return false;
  const lastFailure = failedAt.get(userId);
  if (lastFailure && Date.now() - lastFailure < FAILURE_COOLDOWN_MS) return false;
  try {
    const [user] = await db.select({ consentAt: users.voiceLearningConsentAt }).from(users).where(eq(users.id, userId));
    if (!user?.consentAt) return false;
    const [profile] = await db.select().from(voiceProfiles)
      .where(and(eq(voiceProfiles.userId, userId), eq(voiceProfiles.isCustom, true)));
    if (!profile) return true;
    if (profile.moderationStatus === "rejected") return false; // an admin said no
    if (profile.trainingStatus === "ready" && profile.voiceId.startsWith("eleven_")) return false; // has one (on, or switched off by them)
    return true;
  } catch (error) {
    logger.warn("VoiceLearning", `consent check failed for ${identity}: ${String(error)}`);
    return false;
  }
}

function wavFromPcm(chunks: Int16Array[]): Buffer {
  const samples = chunks.reduce((n, c) => n + c.length, 0);
  const dataBytes = samples * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  let offset = 44;
  for (const chunk of chunks) {
    Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).copy(buffer, offset);
    offset += chunk.byteLength;
  }
  return buffer;
}

/** Creates the voice from collected speech and makes it the caller's own voice. Returns the provider voice id. */
export async function createVoiceFromCallAudio(identity: string, chunks: Int16Array[]): Promise<string | null> {
  const userId = userIdOf(identity);
  if (!userId) return null;
  const { enrollElevenLabsVoice } = await import("./voice-cloning-service");
  const { voiceId } = await enrollElevenLabsVoice([wavFromPcm(chunks)], `NeuraTalk_User_${userId}`);

  const [existing] = await db.select().from(voiceProfiles)
    .where(and(eq(voiceProfiles.userId, userId), eq(voiceProfiles.isCustom, true)));
  const values = {
    voiceId: `eleven_${voiceId}`,
    trainingStatus: "ready",
    moderationStatus: "approved",
    moderationNotes: "Learned from the owner's own call speech, with their permission",
    isEnabled: true,
  };
  if (existing) {
    await db.update(voiceProfiles).set(values).where(eq(voiceProfiles.id, existing.id));
  } else {
    await db.insert(voiceProfiles).values({ userId, name: "My Voice", isCustom: true, ...values } as typeof voiceProfiles.$inferInsert);
  }
  rememberClonedVoice(identity, voiceId);
  return voiceId;
}

/**
 * Per-speaker collector used by the translator bot. Feed it every 20 ms
 * frame with whether it was speech; it fires `onReady` once with the new
 * voice id.
 */
export class CallVoiceLearner {
  private chunks: Int16Array[] = [];
  private voicedMs = 0;
  private trailingSilenceFrames = 0;
  private done = false;

  constructor(
    private readonly identity: string,
    private readonly frameMs: number,
    private readonly onReady: (voiceId: string) => void,
  ) {}

  get learning(): boolean {
    return !this.done;
  }

  push(frame: Int16Array, voiced: boolean): void {
    if (this.done) return;
    if (voiced) {
      this.trailingSilenceFrames = 0;
      this.voicedMs += this.frameMs;
      this.chunks.push(new Int16Array(frame));
    } else if (this.chunks.length && this.trailingSilenceFrames < 10) {
      // Keep short natural pauses between words, drop long silences.
      this.trailingSilenceFrames += 1;
      this.chunks.push(new Int16Array(frame));
    }
    if (this.voicedMs >= VOICE_LEARNING_TARGET_MS) void this.finish();
  }

  /** Call end: still create the voice if enough clear speech was heard. */
  async flush(): Promise<void> {
    if (!this.done && this.voicedMs >= VOICE_LEARNING_MIN_MS) await this.finish();
    this.done = true;
    this.chunks = [];
  }

  private async finish(): Promise<void> {
    if (this.done) return;
    this.done = true;
    const userId = userIdOf(this.identity);
    if (!userId || inProgress.has(userId)) return;
    inProgress.add(userId);
    const chunks = this.chunks;
    this.chunks = [];
    try {
      const voiceId = await createVoiceFromCallAudio(this.identity, chunks);
      if (voiceId) {
        logger.info("VoiceLearning", `${this.identity}: own voice learned from ${Math.round(this.voicedMs / 1000)} s of call speech`);
        this.onReady(voiceId);
      }
    } catch (error) {
      failedAt.set(userId, Date.now());
      logger.warn("VoiceLearning", `${this.identity}: could not learn voice: ${String(error)}`);
    } finally {
      inProgress.delete(userId);
    }
  }
}
