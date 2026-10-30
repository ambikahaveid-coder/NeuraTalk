/**
 * Who asked for each upload. A freshly uploaded file has no owner recorded
 * in storage until it is first used (sent in a chat, added to a template...),
 * and the first user to use it becomes its owner. To make sure that first
 * user really is the uploader, the upload link remembers who requested it.
 *
 * Kept in Redis for a day (an upload is used right after it is made). If the
 * record is missing -- older uploads, or Redis unavailable -- the old rule
 * applies (paths are random UUIDs, not guessable).
 */
import { getRedisClient, isRedisReady } from "../../redis";

const TTL_SECONDS = 24 * 60 * 60;
const key = (objectPath: string) => `upload:owner:${objectPath}`;

export async function rememberUploader(objectPath: string, userId: number): Promise<void> {
  try {
    if (!isRedisReady()) return;
    await getRedisClient().set(key(objectPath), String(userId), "EX", TTL_SECONDS);
  } catch { /* best effort */ }
}

/** False only when we know a different user requested this upload. */
export async function mayClaimUpload(objectPath: string, userId: number): Promise<boolean> {
  try {
    if (!isRedisReady()) return true;
    const uploader = await getRedisClient().get(key(objectPath));
    return uploader == null || uploader === String(userId);
  } catch {
    return true;
  }
}
