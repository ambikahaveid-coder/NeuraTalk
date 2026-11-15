/**
 * The AI assistant on calls (in-app calls; phone-number calls once Exotel is live).
 *
 * When a call to someone isn't picked up within their "ring" time, or they
 * set themselves busy, or they tap "Let my assistant answer", the assistant
 * joins the call as its own participant ("<Name>'s assistant"):
 *   listen (streaming speech-to-text in the caller's language)
 *   → think (same brain as chats, ai-assistant.ts)
 *   → speak (Azure voice, or the owner's own cloned voice if they chose it)
 * It says first that it is an AI assistant, keeps it short, then ends the
 * call and leaves a summary in "Messages taken" with a push notification.
 * Calls are capped (3 minutes, and the plan's call minutes).
 */
import { Router, type Request, type Response } from "express";
// The LiveKit native library is heavy: loaded only when the assistant really joins a call.
import type { AudioSource, Room, RemoteParticipant, RemoteTrack } from "@livekit/rtc-node";
const rtc = () => import("@livekit/rtc-node");
import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { users } from "@shared/schema";
import { requireAuth } from "./role-middleware";
import { logger } from "./observability";
import {
  accessOf, assistantTestMode, businessKnowledge, converse, languageName, mayTakeCall, openSession, ownerDisplay, recordVoiceSeconds,
  settingsOf, isBusyNow, type BrainContext, type OwnerKind,
} from "./ai-assistant";

const router = Router();
const MAX_CALL_SECONDS = 180;
const PCM_RATE = 16_000;
const rows = <T = any>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? []) as T[];

type Owner = { kind: OwnerKind; ownerId: number };
// Shared by every copy of this module (the routes and the call router may load it separately).
const shared = ((globalThis as any).__neuratalkAssistantCalls ??= { pending: new Map(), live: new Map() }) as {
  pending: Map<string, ReturnType<typeof setTimeout>>; live: Map<string, AssistantCall>;
};
const pending = shared.pending;
const live = shared.live;

/** Whose assistant (if any) answers calls to this user: their business's, else their own. */
export async function assistantOwnerForCallee(calleeUserId: number): Promise<(Owner & { ringSeconds: number; busy: boolean }) | null> {
  const [u] = await db.select({ organizationId: users.organizationId }).from(users).where(eq(users.id, calleeUserId));
  if (u?.organizationId) {
    const s = await settingsOf("business", u.organizationId);
    if (s.enabled && s.callsEnabled && (await mayTakeCall("business", u.organizationId))) return { kind: "business", ownerId: u.organizationId, ringSeconds: s.ringSeconds, busy: false };
  }
  const s = await settingsOf("personal", calleeUserId);
  if (s.enabled && s.callsEnabled && (await mayTakeCall("personal", calleeUserId))) return { kind: "personal", ownerId: calleeUserId, ringSeconds: s.ringSeconds, busy: isBusyNow(s) };
  return null;
}

/**
 * Called right after an app-to-app call starts ringing. Arms a timer; if the
 * call is still ringing when it fires, the assistant answers.
 */
export async function scheduleAssistantForCall(input: { callId: string; calleeUserId: number; callerIdentity: string; callerLanguage: string; isGroup?: boolean }): Promise<void> {
  try {
    if (input.isGroup || pending.has(input.callId)) return;
    const owner = await assistantOwnerForCallee(input.calleeUserId);
    if (!owner) {
      // Say why, so a missed answer can be explained (no names or numbers here).
      const s = await settingsOf("personal", input.calleeUserId);
      const why = !s.enabled ? "assistant off" : !s.callsEnabled ? "calls off" : "no trial/plan minutes left";
      logger.warn("AssistantCall", `${input.callId}: assistant not armed (${why})`);
      return;
    }
    const delayMs = (owner.busy ? 3 : owner.ringSeconds) * 1000;
    logger.warn("AssistantCall", `${input.callId}: assistant armed (${owner.kind}, answers in ${delayMs / 1000}s${owner.busy ? ", busy" : ""})`);
    pending.set(input.callId, setTimeout(() => {
      pending.delete(input.callId);
      void answerWithAssistant({ ...input, owner, reason: owner.busy ? "busy" : "no_answer" });
    }, delayMs));
  } catch (error) {
    logger.warn("AssistantCall", `schedule failed for ${input.callId}: ${String(error)}`);
  }
}

export function cancelScheduledAssistant(callId: string): void {
  const t = pending.get(callId);
  if (t) clearTimeout(t);
  pending.delete(callId);
}

async function answerWithAssistant(input: { callId: string; calleeUserId: number; callerIdentity: string; callerLanguage: string; owner: Owner; reason: string }): Promise<boolean> {
  const svc = await import("./modules/calls/service");
  const call = await svc.getSmartCall(input.callId);
  if (!call || call.status !== "ringing") {
    logger.warn("AssistantCall", `${input.callId}: not answering, call is ${call ? call.status : "gone"} (picked up or hung up first)`);
    return false;
  }
  // The owner may already be in the call (answered a moment ago): never talk over them.
  if (!assistantTestMode()) {
    try {
      const { listParticipants } = await import("./livekit-service");
      const people = await listParticipants(input.callId);
      if (people.some((p) => p.identity === String(input.calleeUserId))) {
        logger.warn("AssistantCall", `${input.callId}: not answering, the owner already joined`);
        return false;
      }
    } catch { /* room not created yet: nobody has joined */ }
  }
  logger.warn("AssistantCall", `${input.callId}: answering (${input.reason})`);
  try {
    await svc.updateSmartCallStatus(input.callId, "answered" as any, { answeredBy: "assistant", assistantReason: input.reason } as any);
  } catch (error) {
    logger.warn("AssistantCall", `call ${input.callId} could not be answered by the assistant: ${String(error)}`);
    return false;
  }
  const session = new AssistantCall(input);
  live.set(input.callId, session);
  void session.run();
  return true;
}

// ---------------------------------------------------------------- the call itself

class AssistantCall {
  private room: Room | null = null;
  private source: AudioSource | null = null;
  private speaking = false;
  private queue: string[] = [];
  private ended = false;
  private startedAt = Date.now();
  private session: any = null;
  private ctx!: BrainContext;
  private voice: { kind: "ai" | "own"; voiceId: string | null; gender: "male" | "female" } = { kind: "ai", voiceId: null, gender: "female" };
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private pendingText = "";
  private stt: { send(f: Int16Array): void; close(): Promise<void> } | null = null;

  constructor(private input: { callId: string; calleeUserId: number; callerIdentity: string; callerLanguage: string; owner: Owner; reason: string }) {}

  private get lang() {
    const l = String(this.input.callerLanguage || "en").toLowerCase();
    return l === "auto" ? "en" : l.split(/[-_]/)[0];
  }

  async run(): Promise<void> {
    const { kind, ownerId } = this.input.owner;
    try {
      const s = await settingsOf(kind, ownerId);
      const owner = await ownerDisplay(kind, ownerId);
      const callerId = Number(this.input.callerIdentity);
      const [caller] = Number.isInteger(callerId) ? await db.select({ displayName: users.displayName, username: users.username }).from(users).where(eq(users.id, callerId)) : [];
      const callerName = (caller?.displayName || caller?.username || "").trim() || null;
      this.ctx = {
        kind, channel: "call", ownerName: owner.name, assistantName: s.assistantName || (kind === "business" ? `${owner.name} assistant` : "NeuraTalk Assistant"),
        busyNote: s.busyNote, instructions: s.instructions, knowledge: kind === "business" ? await businessKnowledge(ownerId, s.knowledge) : null,
        counterpartName: callerName, counterpartLanguage: this.lang, ownerLanguage: owner.language,
      };
      this.session = await openSession(kind, ownerId, "call", `call:${this.input.callId}`, Number.isInteger(callerId) ? callerId : null, callerName);
      this.voice.gender = s.voiceGender;
      if (kind === "personal" && s.voice === "own") {
        const { lookupClonedVoiceId } = await import("./cloned-voice");
        const { canSpeakInClonedVoice } = await import("./realtime-translation-core");
        const id = await lookupClonedVoiceId(String(ownerId)).catch(() => null);
        if (id && canSpeakInClonedVoice(this.lang)) this.voice = { kind: "own", voiceId: id, gender: s.voiceGender };
      }
      const greeting = await this.greeting(owner.name);
      await db.execute(sql`UPDATE assistant_sessions SET history = ${JSON.stringify([{ role: "assistant", text: greeting }])}::jsonb WHERE id = ${this.session.id}`);
      this.session.history = [{ role: "assistant", text: greeting }];

      if (assistantTestMode()) return; // local tests: no media; the turns are driven through /api/test/assistant-call
      await this.join();
      await this.say(greeting);
      // Hard stop: plan minutes or 3 minutes, whichever comes first.
      const access = await accessOf(kind, ownerId);
      const limit = Math.min(MAX_CALL_SECONDS, kind === "business" ? MAX_CALL_SECONDS : Math.max(30, access.voiceSecondsLeft));
      setTimeout(() => void this.finish("time limit", true), limit * 1000).unref?.();
    } catch (error) {
      logger.error("AssistantCall", `assistant failed on ${this.input.callId}`, error instanceof Error ? error : new Error(String(error)));
      await this.finish("error", false);
    }
  }

  private async greeting(ownerName: string): Promise<string> {
    const en = this.input.owner.kind === "business"
      ? `Hello, thank you for calling ${ownerName}. I'm the AI assistant. How can I help you?`
      : `Hello, I'm ${ownerName}'s NeuraTalk assistant, an AI. ${ownerName} can't take the call right now. What is it about, and is it urgent?`;
    if (this.lang === "en") return en;
    try {
      const { translateChatText } = await import("./translation/chat-translate");
      return await translateChatText(en, "en", this.lang);
    } catch {
      return en;
    }
  }

  /** Joins the room as "<Name>'s assistant" and listens to the caller only. */
  private async join(): Promise<void> {
    const key = process.env.LIVEKIT_API_KEY, secret = process.env.LIVEKIT_API_SECRET, url = process.env.LIVEKIT_URL;
    if (!key || !secret || !url) throw new Error("LiveKit not configured");
    const identity = `assistant-${this.input.owner.kind}-${this.input.owner.ownerId}`;
    const { AccessToken } = await import("livekit-server-sdk");
    const { LocalAudioTrack, RemoteAudioTrack, Room, RoomEvent, TrackPublishOptions, TrackSource, AudioSource } = await rtc();
    const at = new AccessToken(key, secret, {
      identity, name: `${this.ctx.ownerName}'s assistant`, ttl: 600,
      // NOT role "bot": the caller's app and web treat "bot" as the translator
      // (muted, and the call would never count as answered). The translator
      // still skips this participant because its identity starts with "assistant-".
      metadata: JSON.stringify({ role: "assistant", assistant: true, language: this.lang, ownerName: this.ctx.ownerName }),
    });
    at.addGrant({ room: this.input.callId, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
    const room = new Room();
    this.room = room;
    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub: unknown, participant: RemoteParticipant) => {
      if (participant.identity === this.input.callerIdentity && track instanceof RemoteAudioTrack) void this.listen(track);
    });
    // The owner picked up after all (or tapped Accept just as it answered): step aside, don't hang up.
    room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
      if (participant.identity === String(this.input.calleeUserId)) void this.finish("owner joined", false);
    });
    room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      if (participant.identity === this.input.callerIdentity) void this.finish("caller hung up", false);
    });
    room.on(RoomEvent.Disconnected, () => void this.finish("room closed", false));
    await room.connect(url, await at.toJwt(), { autoSubscribe: true, dynacast: false });
    if (Array.from(room.remoteParticipants.values()).some((p) => p.identity === String(this.input.calleeUserId))) {
      throw new Error("OWNER_ALREADY_IN_CALL");
    }
    this.source = new AudioSource(PCM_RATE, 1, 200);
    const track = LocalAudioTrack.createAudioTrack("assistant-voice", this.source);
    const options = new TrackPublishOptions();
    options.source = TrackSource.SOURCE_MICROPHONE;
    await room.localParticipant!.publishTrack(track, options);
  }

  private async listen(track: RemoteTrack): Promise<void> {
    const { createManagedStreamingSttSession } = await import("./providers/stt-provider-registry");
    const stt = createManagedStreamingSttSession({
      language: this.lang,
      onTranscript: (e) => {
        if (!e.isFinal || !e.text.trim()) return;
        this.pendingText = `${this.pendingText} ${e.text.trim()}`.trim();
        if (this.debounce) clearTimeout(this.debounce);
        this.debounce = setTimeout(() => { const t = this.pendingText; this.pendingText = ""; void this.heard(t); }, e.speechFinal ? 300 : 900);
      },
      onError: (err) => logger.warn("AssistantCall", `stt error on ${this.input.callId}: ${String(err)}`),
      endpointingMs: 500,
    });
    await stt.connect();
    this.stt = stt as any;
    const { AudioStream } = await rtc();
    const stream = new AudioStream(track as any, { sampleRate: PCM_RATE, numChannels: 1, frameSizeMs: 20 } as any);
    for await (const frame of stream as unknown as AsyncIterable<{ data: Int16Array }>) {
      if (this.ended) break;
      stt.send(frame.data);
    }
  }

  /** What the caller said: think, answer, maybe finish. Turns that arrive while speaking wait their turn. */
  async heard(text: string): Promise<void> {
    if (this.ended || !text.trim()) return;
    if (this.speaking) { this.queue.push(text); return; }
    this.speaking = true;
    try {
      const result = await converse(this.session, this.ctx, text);
      this.session = rows(await db.execute(sql`SELECT * FROM assistant_sessions WHERE id = ${this.session.id}`))[0];
      await this.say(result.reply);
      if (result.done || result.handoff) {
        await new Promise((r) => setTimeout(r, 800));
        await this.finish("done", true);
        return;
      }
    } finally {
      this.speaking = false;
    }
    const next = this.queue.splice(0).join(" ");
    if (next) void this.heard(next);
  }

  private async say(text: string): Promise<void> {
    if (!this.source || !text.trim()) return;
    const core = await import("./realtime-translation-core");
    const { AudioFrame } = await rtc();
    const controller = new AbortController();
    const frames = this.voice.kind === "own" && this.voice.voiceId
      ? core.streamElevenLabsTtsFrames(text, this.lang, this.voice.voiceId, controller.signal)
      : core.streamAzureTtsFrames(text, this.lang, controller.signal, { gender: this.voice.gender });
    try {
      for await (const frame of frames) {
        if (this.ended) { controller.abort(); break; }
        await this.source.captureFrame(new AudioFrame(frame, PCM_RATE, 1, frame.length));
      }
    } catch (error) {
      logger.warn("AssistantCall", `speak failed on ${this.input.callId}: ${String(error)}`);
    }
  }

  /** Ends the assistant's part: bill the minutes, make sure there's a summary, hang up if we were the ones finishing. */
  async finish(why: string, hangUp: boolean): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    live.delete(this.input.callId);
    const seconds = Math.max(1, Math.round((Date.now() - this.startedAt) / 1000));
    try {
      if (this.session) {
        const s = rows(await db.execute(sql`
          UPDATE assistant_sessions SET voice_seconds = voice_seconds + ${seconds}, last_at = now(),
            status = CASE WHEN status = 'open' THEN 'done' ELSE status END,
            summary = coalesce(summary, ${this.fallbackSummary(why)}),
            importance = coalesce(importance, 'normal'),
            replies = greatest(replies, 1)
          WHERE id = ${this.session.id} RETURNING *`))[0];
        if (s && this.session.status === "open" && why !== "owner joined") {
          const { sendPushNotification } = await import("./firebase-admin");
          const targets = this.input.owner.kind === "personal" ? [this.input.owner.ownerId] : (await db.select({ id: users.id }).from(users).where(eq(users.organizationId, this.input.owner.ownerId))).map((u) => u.id);
          for (const uid of targets.slice(0, 20)) {
            await sendPushNotification(uid, { title: `🤖 Assistant took a call from ${s.counterpart_name ?? "someone"}`, body: String(s.summary).slice(0, 180), data: { type: "assistant_summary", sessionId: String(s.id) } }).catch(() => {});
          }
        }
      }
      await recordVoiceSeconds(this.input.owner.kind, this.input.owner.ownerId, seconds);
    } catch (error) {
      logger.warn("AssistantCall", `finish bookkeeping failed: ${String(error)}`);
    }
    if (this.debounce) clearTimeout(this.debounce);
    await this.stt?.close().catch(() => undefined);
    await this.room?.disconnect().catch(() => undefined);
    if (hangUp) {
      const svc = await import("./modules/calls/service");
      await svc.endCallById(this.input.callId, "assistant_completed").catch(() => undefined);
    }
    logger.warn("AssistantCall", `assistant finished ${this.input.callId} after ${seconds}s (${why})`);
  }

  private fallbackSummary(why: string): string {
    const said = (this.session?.history ?? []).filter((t: any) => t.role === "caller").map((t: any) => t.text).join(" / ");
    return said ? `${this.ctx?.counterpartName ?? "Someone"} called: ${said}`.slice(0, 400) : `${this.ctx?.counterpartName ?? "Someone"} called and didn't leave a message (${why}).`;
  }
}

// ---------------------------------------------------------------- routes

/** The person being called taps "Let my assistant answer" (while it rings). */
router.post("/api/calls/:callId/assistant", requireAuth, async (req: Request, res: Response) => {
  const callId = String(req.params.callId);
  const svc = await import("./modules/calls/service");
  const call: any = await svc.getSmartCall(callId);
  if (!call || String(call.calleeUserId) !== String(req.user!.id)) return res.status(404).json({ error: "Call not found." });
  if (call.status !== "ringing") return res.status(409).json({ error: "This call is no longer ringing." });
  const owner = await assistantOwnerForCallee(req.user!.id);
  if (!owner) return res.status(409).json({ code: "ASSISTANT_OFF", error: "Turn on your assistant first (Settings → AI assistant)." });
  cancelScheduledAssistant(callId);
  const ok = await answerWithAssistant({ callId, calleeUserId: req.user!.id, callerIdentity: String(call.callerId), callerLanguage: call.callerLanguage || "en", owner, reason: "handed_over" });
  if (!ok) return res.status(409).json({ error: "This call is no longer ringing." });
  res.json({ success: true });
});

/** Local tests only: drive a call's conversation by text (no audio, no LiveKit). */
router.post("/api/test/assistant-call/:callId", requireAuth, async (req: Request, res: Response) => {
  if (!assistantTestMode()) return res.status(404).json({ error: "Not found" });
  const c = live.get(String(req.params.callId));
  if (!c) return res.status(404).json({ error: "No assistant on this call." });
  const said = String(req.body?.said ?? "");
  if (req.body?.hangUp) await c.finish("caller hung up", false);
  else await c.heard(said);
  res.json({ success: true });
});

export default router;
