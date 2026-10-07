import { spawn } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { ObjectStorageService } from "./ai_integrations/object_storage/objectStorage";
import { speechToText } from "./ai_integrations/audio/client";
import { logger } from "./observability";

// Voice notes longer than this are still sent, just without a transcript.
const MAX_VOICE_NOTE_BYTES = 8 * 1024 * 1024;
const TRANSCRIBE_TIMEOUT_MS = 15_000;

/** Any audio file -> 16 kHz mono WAV. Uses temp files because M4A/MP4 audio
 * keeps its index at the end of the file, which ffmpeg can't read from a pipe. */
async function toWav(audio: Buffer): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vn-"));
  const input = path.join(dir, `in-${randomUUID()}`);
  const output = path.join(dir, "out.wav");
  try {
    await fs.writeFile(input, audio);
    await new Promise<void>((resolve, reject) => {
      const ff = spawn("ffmpeg", ["-y", "-i", input, "-ar", "16000", "-ac", "1", "-acodec", "pcm_s16le", output]);
      ff.stderr.on("data", () => {});
      ff.on("error", reject);
      ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`))));
    });
    return await fs.readFile(output);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Speech-to-text for a chat voice note (what the sender said, in their own
 * language, code-mixed speech included). Returns "" when it can't be
 * transcribed; the voice note is still delivered either way.
 */
export async function transcribeVoiceNote(objectPath: string, language: string): Promise<string> {
  const work = (async () => {
    const file = await new ObjectStorageService().getObjectEntityFile(objectPath);
    const [meta] = await file.getMetadata();
    if ((meta.size ?? 0) > MAX_VOICE_NOTE_BYTES) return "";
    const [audio] = await file.download();
    const wav = await toWav(audio);
    return (await speechToText(wav, "wav", language)).trim();
  })();
  const timeout = new Promise<string>((resolve) => setTimeout(() => resolve(""), TRANSCRIBE_TIMEOUT_MS));
  try {
    return await Promise.race([work, timeout]);
  } catch (err) {
    logger.warn("VoiceNote", `transcription failed: ${String(err).slice(0, 200)}`);
    return "";
  }
}
