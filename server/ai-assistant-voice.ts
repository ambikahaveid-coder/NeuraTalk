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

/** Everything the assistant needs, made while the phone still rings, so its first word comes at once. */
type Prepared = {
  ctx: BrainContext; greeting: string; callerId: number | null; callerName: string | null;
  voice: { kind: "ai" | "own"; voiceId: string | null; gender: "male" | "female" };
  frames: Int16Array[] | null;
};
const prepared = ((shared as any).prepared ??= new Map()) as Map<string, Promise<Prepared>>;

const langOf = (callerLanguage: string) => {
  const l = String(callerLanguage || "en").toLowerCase();
  return l === "auto" ? "en" : l.split(/[-_]/)[0];
};

/** Speech for a line: the owner's own voice when chosen, else (or if that fails) the AI voice. */
async function* speechFrames(text: string, lang: string, voice: Prepared["voice"], signal: AbortSignal): AsyncGenerator<Int16Array> {
  const core = await import("./realtime-translation-core");
  if (voice.kind === "own" && voice.voiceId) {
    let any = false;
    try {
      for await (const f of core.streamElevenLabsTtsFrames(text, lang, voice.voiceId, signal)) { any = true; yield f; }
      return;
    } catch (error) {
      if (any || signal.aborted) throw error;
      logger.warn("AssistantCall", `own voice unavailable, using the AI voice: ${String(error)}`);
    }
  }
  yield* core.streamAzureTtsFrames(text, lang, signal, { gender: voice.gender });
}

async function prepareAssistant(input: { callId: string; callerIdentity: string; callerLanguage: string }, owner: Owner): Promise<Prepared> {
  const { kind, ownerId } = owner;
  const lang = langOf(input.callerLanguage);
  const s = await settingsOf(kind, ownerId);
  const who = await ownerDisplay(kind, ownerId);
  const callerNum = Number(input.callerIdentity);
  const callerId = Number.isInteger(callerNum) ? callerNum : null;
  const [caller] = callerId ? await db.select({ displayName: users.displayName, username: users.username }).from(users).where(eq(users.id, callerId)) : [];
  const callerName = (caller?.displayName || caller?.username || "").trim() || null;
  const ctx: BrainContext = {
    kind, channel: "call", ownerName: who.name, assistantName: s.assistantName || (kind === "business" ? `${who.name} assistant` : `${who.name}'s AI assistant`),
    busyNote: s.busyNote, instructions: s.instructions, knowledge: kind === "business" ? await businessKnowledge(ownerId, s.knowledge) : null,
    counterpartName: callerName, counterpartLanguage: lang, ownerLanguage: who.language,
  };
  let voice: Prepared["voice"] = { kind: "ai", voiceId: null, gender: s.voiceGender };
  if (kind === "personal" && s.voice === "own") {
    const { lookupClonedVoiceId } = await import("./cloned-voice");
    const { canSpeakInClonedVoice } = await import("./realtime-translation-core");
    const id = await lookupClonedVoiceId(String(ownerId)).catch(() => null);
    if (id && canSpeakInClonedVoice(lang)) voice = { kind: "own", voiceId: id, gender: s.voiceGender };
  }
  const greeting = await greetingText(kind, who.name, callerName, lang);
  let frames: Int16Array[] | null = null;
  if (!assistantTestMode()) {
    try {
      const signal = AbortSignal.timeout(15_000);
      frames = [];
      for await (const f of speechFrames(greeting, lang, voice, signal)) frames.push(f);
    } catch (error) {
      logger.warn("AssistantCall", `${input.callId}: greeting not pre-made (${String(error)}); it will be spoken live`);
      frames = null;
    }
  }
  return { ctx, greeting, callerId, callerName, voice, frames };
}

async function greetingText(kind: OwnerKind, ownerName: string, callerName: string | null, lang: string): Promise<string> {
  // The caller is known (their NeuraTalk account), so greet them by name and never ask who they are.
  const hi = callerName ? `Hello ${callerName.split(/\s+/)[0]}` : "Hello";
  const en = kind === "business"
    ? `${hi}, thank you for calling ${ownerName}. I'm the AI assistant. How can I help you?`
    : `${hi}, I'm ${ownerName}'s AI assistant. ${ownerName} can't take your call right now. What is it about, and is it urgent?`;
  if (lang === "en") return en;
  try {
    const { translateChatText } = await import("./translation/chat-translate");
    return await translateChatText(en, "en", lang);
  } catch {
    return en;
  }
}

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
    // Make the greeting (text and voice) now, while it rings.
    const ready = prepareAssistant(input, owner);
    ready.catch(() => undefined);
    prepared.set(input.callId, ready);
    setTimeout(() => prepared.delete(input.callId), delayMs + 120_000).unref?.();
    pending.set(input.callId, setTimeout(() => {
      pending.delete(input.callId);
      void answerWithAssistant({ ...input, owner, reason: owner.busy ? "busy" : "no_answer" });
    }, delayMs));
  } catch (error) {
    logger.warn("AssistantCall", `schedule failed for ${input.callId}: ${String(error)}`);
  }
}

/** The owner picked up while their assistant was talking: it steps aside (the call goes on). */
export async function ownerTookOver(callId: string): Promise<void> {
  cancelScheduledAssistant(callId);
  await live.get(callId)?.finish("owner joined", false);
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
      // Made while it rang (usually ready by now); made here if the owner handed it over.
      const ready = prepared.get(this.input.callId) ?? prepareAssistant(this.input, this.input.owner);
      prepared.delete(this.input.callId);
      const p = await ready;
      this.ctx = p.ctx;
      this.voice = p.voice;
      this.session = await openSession(kind, ownerId, "call", `call:${this.input.callId}`, p.callerId, p.callerName);
      await db.execute(sql`UPDATE assistant_sessions SET history = ${JSON.stringify([{ role: "assistant", text: p.greeting }])}::jsonb WHERE id = ${this.session.id}`);
      this.session.history = [{ role: "assistant", text: p.greeting }];

      if (assistantTestMode()) return; // local tests: no media; the turns are driven through /api/test/assistant-call
      await this.join();
      if (p.frames?.length) await this.play(p.frames);
      else await this.say(p.greeting);
      // Hard stop: plan minutes or 3 minutes, whichever comes first.
      const access = await accessOf(kind, ownerId);
      const limit = Math.min(MAX_CALL_SECONDS, kind === "business" ? MAX_CALL_SECONDS : Math.max(30, access.voiceSecondsLeft));
      setTimeout(() => void this.finish("time limit", true), limit * 1000).unref?.();
    } catch (error) {
      logger.error("AssistantCall", `assistant failed on ${this.input.callId}`, error instanceof Error ? error : new Error(String(error)));
      await this.finish("error", false);
    }
  }

  /** Plays speech made earlier (the greeting). */
  private async play(frames: Int16Array[]): Promise<void> {
    if (!this.source) return;
    const { AudioFrame } = await rtc();
    try {
      for (const frame of frames) {
        if (this.ended) break;
        await this.source.captureFrame(new AudioFrame(frame, PCM_RATE, 1, frame.length));
      }
    } catch (error) {
      logger.warn("AssistantCall", `play failed on ${this.input.callId}: ${String(error)}`);
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
    if (this.ended || !text.trim() || !this.session) return;
    if (this.speaking) { this.queue.push(text); return; }
    this.speaking = true;
    try {
      const result = await converse(this.session, this.ctx, text);
      // Keep the last good copy if the row can't be re-read (never crash the call).
      this.session = rows(await db.execute(sql`SELECT * FROM assistant_sessions WHERE id = ${this.session.id}`))[0] ?? this.session;
      await this.say(result.reply);
      if (result.done || result.handoff) {
        await new Promise((r) => setTimeout(r, 800));
        await this.finish("done", true);
        return;
      }
    } catch (error) {
      logger.warn("AssistantCall", `turn failed on ${this.input.callId}: ${String(error)}`);
    } finally {
      this.speaking = false;
    }
    const next = this.queue.splice(0).join(" ");
    if (next) void this.heard(next);
  }

  private async say(text: string): Promise<void> {
    if (!this.source || !text.trim()) return;
    const { AudioFrame } = await rtc();
    const controller = new AbortController();
    try {
      for await (const frame of speechFrames(text, this.lang, this.voice, controller.signal)) {
        if (this.ended) { controller.abort(); break; }
        await this.source.captureFrame(new AudioFrame(frame, PCM_RATE, 1, frame.length));
      }
    } catch (error) {
      if (!this.ended) logger.warn("AssistantCall", `speak failed on ${this.input.callId}: ${String(error)}`);
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
      if (why !== "owner joined") await this.postToChat();
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

  /**
   * Personal calls: put what was said into the 1:1 chat with the caller, so the
   * owner reads it where they'd look anyway (each side sees it translated into
   * their own language, like any chat message). Marked as the assistant's.
   */
  private async postToChat(): Promise<void> {
    if (this.input.owner.kind !== "personal" || !this.session) return;
    const callerId = Number(this.input.callerIdentity);
    if (!Number.isInteger(callerId) || callerId === this.input.owner.ownerId) return;
    const turns = ((this.session.history ?? []) as Array<{ role: string; text: string }>).filter((t) => t.text?.trim());
    if (!turns.some((t) => t.role === "caller")) return; // nothing was said: the missed-call entry says enough
    try {
      const callerName = (this.ctx?.counterpartName ?? "Caller").split(/\s+/)[0];
      const lines = turns.map((t) => `${t.role === "caller" ? callerName : "🤖"}: ${t.text.trim()}`);
      const content = [`📞 ${this.ctx.ownerName}'s AI assistant answered ${callerName}'s call`, ...lines].join("\n").slice(0, 3800);
      const [ownerUser] = await db.select().from(users).where(eq(users.id, this.input.owner.ownerId));
      if (!ownerUser) return;
      const { openPersonalThread, sendPersonalMessage } = await import("./personal-chat-routes");
      const thread = await openPersonalThread(ownerUser as any, callerId);
      const threadId = thread.body?.thread?.id as number | undefined;
      if (!threadId) return;
      await sendPersonalMessage(ownerUser as any, threadId, { content, clientMessageId: `assistant-call-${this.input.callId}`.slice(0, 120) },
        { assistant: true, assistantCall: true, assistantSessionId: this.session.id, callId: this.input.callId });
    } catch (error) {
      logger.warn("AssistantCall", `could not post the call to the chat: ${String(error)}`);
    }
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
  if (!owner) {
    // Say the real reason: switched off, or its trial / plan / minutes ran out.
    const s = await settingsOf("personal", req.user!.id);
    if (s.enabled && s.callsEnabled) {
      return res.status(409).json({ code: "ASSISTANT_EXPIRED", error: "Your assistant's free trial or plan has ended (or its call minutes are used up). Renew it in Settings → My AI assistant." });
    }
    return res.status(409).json({ code: "ASSISTANT_OFF", error: "Turn on your assistant first (Settings → My AI assistant)." });
  }
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
