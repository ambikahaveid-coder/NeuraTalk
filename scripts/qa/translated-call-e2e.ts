/**
 * End-to-end check of a translated call without phones: two synthetic
 * participants join a real LiveKit room and "speak" generated audio, the real
 * translator bot (server/translator-bot.ts) runs against the real speech,
 * translation and voice providers, and we record what each person hears.
 *
 * Run with production-like env (LIVEKIT_*, AZURE_SPEECH_*, OPENAI_API_KEY,
 * ELEVENLABS_API_KEY, REDIS_URL) and a READ-ONLY DATABASE_URL so cloned voices
 * can be looked up but nothing is written:
 *   npx tsx scripts/qa/translated-call-e2e.ts --a 1:te --b 4:te --out <dir>
 * "--a 1:te" = user id 1 whose profile language is Telugu.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join as pathJoin } from "node:path";
import {
  AudioFrame, AudioSource, AudioStream, LocalAudioTrack, Room, RoomEvent,
  TrackKind, TrackPublishOptions, TrackSource,
  type RemoteTrack, type RemoteTrackPublication, type RemoteParticipant,
} from "@livekit/rtc-node";
import { createCallRoom, endCallRoom, issueAccessToken, issueBotToken, getClientConfig } from "../../server/livekit-service";
import { startBotWorker, stopBotWorker } from "../../server/translator-bot";

const RATE = 16_000;
const FRAME = 160; // 10 ms

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

const [aId, aProfile] = arg("a", "1:te").split(":");
const [bId, bProfile] = arg("b", "4:te").split(":");
const outDir = arg("out", "qa-out");
mkdirSync(outDir, { recursive: true });

// Who says what, in which language. A speaks Telugu, B (also a Telugu
// profile) speaks English, then both speak Telugu: no setting is changed.
const script: Array<{ who: "A" | "B"; language: string; text: string }> = [
  { who: "A", language: "te", text: "నమస్కారం, మీరు ఎలా ఉన్నారు? ఈ రోజు మీటింగ్ సాయంత్రం నాలుగు గంటలకు ఉంది." },
  { who: "B", language: "en", text: "Hi Kiran, I am doing well. Four o'clock works for me, see you then." },
  { who: "A", language: "te", text: "సరే, అప్పుడు కలుద్దాం. ధన్యవాదాలు." },
  { who: "B", language: "te", text: "సరే అండి, నాకు కూడా తెలుగు వచ్చు. బాగుంది." },
];

const t0 = Date.now();
const at = () => ((Date.now() - t0) / 1000).toFixed(2) + "s";
const log = (...parts: unknown[]) => console.log(`[qa ${at()}]`, ...parts);

async function synthesize(text: string, language: string, voiceId: string): Promise<Int16Array> {
  const key = process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY missing");
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=pcm_16000`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: "eleven_v4_turbo", language_code: language }),
  });
  if (!res.ok) throw new Error(`input TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
}

function wav(samples: Int16Array): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + samples.length * 2, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24); header.writeUInt32LE(RATE * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(samples.length * 2, 40);
  return Buffer.concat([header, Buffer.from(samples.buffer, samples.byteOffset, samples.length * 2)]);
}

interface Party {
  label: "A" | "B";
  id: string;
  room: Room;
  source: AudioSource;
  heard: Array<{ from: string; track: string; startedAt: string; samples: number[] }>;
  messages: unknown[];
}

async function join(label: "A" | "B", id: string, profile: string, callId: string): Promise<Party> {
  const token = await issueAccessToken(callId, { userId: id, displayName: `QA ${label}`, language: profile, translationMode: "voice", role: label === "A" ? "caller" : "callee" });
  const room = new Room();
  const party: Party = { label, id, room, source: new AudioSource(RATE, 1), heard: [], messages: [] };
  room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
    if (track.kind !== TrackKind.KIND_AUDIO) return;
    const name = pub.name || "";
    log(`${label} subscribed to ${participant.identity}/${name}`);
    if (!name.startsWith("translated-for-")) return; // a human mic; the client may mute it
    // Real clients only play their own translations (Flutter disables, web
    // mutes the rest), so only those count as "heard".
    if (!name.startsWith(`translated-for-${encodeURIComponent(id)}-from-`)) {
      log(`${label} ignores ${name} (meant for someone else)`);
      return;
    }
    const entry = { from: participant.identity, track: name, startedAt: "", samples: [] as number[] };
    party.heard.push(entry);
    void (async () => {
      for await (const frame of new AudioStream(track, { sampleRate: RATE, numChannels: 1 })) {
        const data = frame.data as Int16Array;
        let loud = false;
        for (let i = 0; i < data.length; i += 8) if (Math.abs(data[i]) > 500) { loud = true; break; }
        if (loud && !entry.startedAt) { entry.startedAt = at(); log(`${label} hears translated audio on ${name}`); }
        for (const s of data) entry.samples.push(s);
      }
    })();
  });
  room.on(RoomEvent.DataReceived, (payload: Uint8Array, _p?: RemoteParticipant, _k?: unknown, topic?: string) => {
    if (topic && topic !== "translation") return;
    try {
      const msg = JSON.parse(new TextDecoder().decode(payload));
      const p = msg?.payload ?? {};
      if (p.partial) return;
      party.messages.push({ at: at(), type: p.type, from: p.sourceLanguage, to: p.targetLanguage, original: p.original, translated: p.translated ?? p.translatedText, reason: p.reason });
    } catch { /* ignore */ }
  });
  await room.connect(getClientConfig().url, token, { autoSubscribe: true, dynacast: false });
  const track = LocalAudioTrack.createAudioTrack("microphone", party.source);
  const options = new TrackPublishOptions();
  options.source = TrackSource.SOURCE_MICROPHONE;
  await room.localParticipant!.publishTrack(track, options);
  log(`${label} (user ${id}, profile ${profile}) joined`);
  return party;
}

async function speak(party: Party, samples: Int16Array, label: string) {
  log(`${party.label} starts speaking: ${label}`);
  for (let i = 0; i + FRAME <= samples.length; i += FRAME) {
    await party.source.captureFrame(new AudioFrame(samples.slice(i, i + FRAME), RATE, 1, FRAME));
  }
  log(`${party.label} stops speaking`);
}

async function silence(party: Party, seconds: number) {
  const zero = new Int16Array(FRAME);
  for (let i = 0; i < seconds * 100; i++) await party.source.captureFrame(new AudioFrame(zero, RATE, 1, FRAME));
}

async function main() {
  const callId = `qa_${Date.now()}`;
  log(`room ${callId}`);
  await createCallRoom({ callId, maxParticipants: 4, emptyTimeoutSec: 60, metadata: { qa: true, translationEnabled: true } } as any);

  // Stock input voices, so the speakers sound different from the clones.
  const inputVoice = { A: "CwhRBWXzGAHq8TQ4Fs17", B: "EXAVITQu4vr4xnSDxMaL" };
  const lines = [];
  for (const line of script) lines.push({ ...line, audio: await synthesize(line.text, line.language, inputVoice[line.who]) });
  log("input audio ready", lines.map((l) => `${l.who}:${l.language} ${(l.audio.length / RATE).toFixed(1)}s`).join(", "));

  const A = await join("A", aId, aProfile, callId);
  const B = await join("B", bId, bProfile, callId);
  await startBotWorker(callId, await issueBotToken(callId));
  log("translator bot started");
  const keepQuiet = Promise.all([silence(A, 3), silence(B, 3)]);
  await keepQuiet;

  for (const line of lines) {
    const speaker = line.who === "A" ? A : B;
    const other = line.who === "A" ? B : A;
    await Promise.all([speak(speaker, line.audio, `${line.language}: ${line.text}`), silence(other, line.audio.length / RATE)]);
    await Promise.all([silence(A, 7), silence(B, 7)]);
  }

  await stopBotWorker(callId);
  for (const p of [A, B]) {
    p.heard.forEach((h, i) => {
      const file = pathJoin(outDir, `${p.label}_heard_${i}.wav`);
      writeFileSync(file, wav(Int16Array.from(h.samples)));
      log(`${p.label} heard ${(h.samples.length / RATE).toFixed(1)}s on ${h.track} (first sound at ${h.startedAt || "never"}) -> ${file}`);
    });
    log(`${p.label} translation events:`, JSON.stringify(p.messages, null, 1));
    await p.room.disconnect();
  }
  await endCallRoom(callId).catch(() => undefined);
  log("done");
  process.exit(0);
}

main().catch((e) => { console.error("[qa] failed:", e); process.exit(1); });
