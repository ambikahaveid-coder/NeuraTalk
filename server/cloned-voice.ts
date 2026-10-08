import { and, eq, like } from "drizzle-orm";
import { db } from "./db";
import { voiceProfiles } from "@shared/schema";

/**
 * The ElevenLabs voice id a call participant may be spoken in: their own
 * cloned voice, only once training finished AND an admin approved it AND the
 * user hasn't switched it off. null otherwise (standard voice is used).
 */
const cache = new Map<string, { voiceId: string | null; at: number }>();
const CACHE_MS = 60_000;

export async function lookupClonedVoiceId(identity: string): Promise<string | null> {
  const userId = Number(identity);
  if (!Number.isInteger(userId) || userId <= 0) return null;
  const hit = cache.get(identity);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.voiceId;
  let voiceId: string | null = null;
  try {
    const [profile] = await db.select({ voiceId: voiceProfiles.voiceId })
      .from(voiceProfiles)
      .where(and(
        eq(voiceProfiles.userId, userId),
        eq(voiceProfiles.isCustom, true),
        eq(voiceProfiles.isEnabled, true),
        eq(voiceProfiles.trainingStatus, "ready"),
        eq(voiceProfiles.moderationStatus, "approved"),
        like(voiceProfiles.voiceId, "eleven\\_%"),
      ))
      .limit(1);
    voiceId = profile ? profile.voiceId.slice("eleven_".length) : null;
  } catch {
    voiceId = null; // never let a lookup problem affect the call
  }
  cache.set(identity, { voiceId, at: Date.now() });
  return voiceId;
}
