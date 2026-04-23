import { useMemo, useState } from "react";
import { Activity, Mic, MicOff, Radio, Sparkles, StopCircle, TimerReset } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useVoiceAssistant } from "@/hooks/use-voice-assistant";

const languageOptions = [
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi" },
  { value: "te", label: "Telugu" },
  { value: "ta", label: "Tamil" },
];

export default function VoiceAssistantPage() {
  const query = useMemo(() => new URLSearchParams(window.location.search), []);
  const mode = query.get("mode") || "general";
  const modePrompt = useMemo(() => {
    if (mode === "video-call") {
      return "You are a live call copilot. Give very short, spoken guidance that helps the user during a video or voice call without interrupting the flow.";
    }
    if (mode === "face-to-face") {
      return "You are a face-to-face communication assistant. Listen carefully, keep responses short, and help people stay calm and understood in real-world conversations.";
    }
    return "";
  }, [mode]);
  const modeDescription = mode === "video-call"
    ? "Sidecar assistant preset for live video and voice calls."
    : mode === "face-to-face"
      ? "Preset optimized for in-person conversations on a shared device."
      : "Audio-only WebRTC session optimized for mobile conditions.";
  const [language, setLanguage] = useState(query.get("language") || "en");
  const [assistantName, setAssistantName] = useState(query.get("assistantName") || "NeuraTalk Assistant");
  const [systemPrompt, setSystemPrompt] = useState(query.get("systemPrompt") || modePrompt);
  const { toast } = useToast();
  const assistant = useVoiceAssistant();

  async function handleStart() {
    try {
      await assistant.startAssistant({
        language,
        assistantName: assistantName.trim() || undefined,
        systemPrompt: systemPrompt.trim() || undefined,
      });
      toast({
        title: "Voice assistant ready",
        description: "WebRTC is connected. Speak naturally; interruption is enabled.",
      });
    } catch (error) {
      toast({
        title: "Assistant failed to start",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  async function handleStop() {
    await assistant.stopAssistant();
    toast({ title: "Session ended", description: "Assistant room disconnected." });
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-950 text-foreground">
      <audio ref={assistant.remoteAudioRef} autoPlay playsInline />

      <div className="mx-auto max-w-6xl px-4 py-8 md:px-6">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <Badge variant="outline" className="mb-3 border-cyan-400/30 bg-cyan-400/10 text-cyan-100">
              Ultra Low Latency Voice AI
            </Badge>
            <h1 className="text-3xl font-bold tracking-tight text-white md:text-4xl">LiveKit + Deepgram + OpenAI + Azure</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-300">
              {modeDescription} The assistant starts on partial transcripts,
              begins TTS on the first speakable phrase, and supports barge-in interruption.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-emerald-400/30 bg-emerald-400/10 text-emerald-100">
              <Radio className="mr-1 h-3 w-3" />
              20ms frames
            </Badge>
            <Badge variant="outline" className="border-sky-400/30 bg-sky-400/10 text-sky-100">
              <Activity className="mr-1 h-3 w-3" />
              Partial STT
            </Badge>
            <Badge variant="outline" className="border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-100">
              <Sparkles className="mr-1 h-3 w-3" />
              Barge-in
            </Badge>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
          <Card className="border-white/10 bg-white/5 backdrop-blur">
            <CardHeader>
              <CardTitle>Session Setup</CardTitle>
              <CardDescription>Deploy the backend in Mumbai, keep LiveKit nearby, and start a single audio room.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-200">Language</label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="flex h-12 w-full rounded-lg border border-white/10 bg-black/20 px-4 py-2 text-sm text-foreground outline-none transition-all focus:border-cyan-400/50 focus:ring-2 focus:ring-cyan-400/30"
                >
                  {languageOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-200">Assistant Name</label>
                <Input value={assistantName} onChange={(e) => setAssistantName(e.target.value)} maxLength={60} />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-200">Optional System Prompt Override</label>
                <Textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="Keep it short for low latency. Example: Be concise, warm, and action-oriented."
                  className="min-h-[120px] border-white/10 bg-black/20 text-sm"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Button onClick={handleStart} disabled={assistant.status === "starting" || assistant.status === "connected"}>
                  <Mic className="mr-2 h-4 w-4" />
                  {assistant.status === "starting" ? "Starting..." : "Start Session"}
                </Button>
                <Button variant="outline" onClick={handleStop} disabled={!assistant.session}>
                  <StopCircle className="mr-2 h-4 w-4" />
                  Stop Session
                </Button>
              </div>

              <Button variant="ghost" onClick={assistant.toggleMute} disabled={!assistant.session} className="w-full justify-start">
                {assistant.isMuted ? <MicOff className="mr-2 h-4 w-4" /> : <Mic className="mr-2 h-4 w-4" />}
                {assistant.isMuted ? "Unmute microphone" : "Mute microphone"}
              </Button>

              <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-slate-300">
                <p className="font-medium text-white">Status</p>
                <p className="mt-1 capitalize">{assistant.status}</p>
                {assistant.session ? (
                  <div className="mt-3 space-y-1 text-xs text-slate-400">
                    <p>Room: {assistant.session.roomName}</p>
                    <p>Transport: {assistant.session.transport}</p>
                    <p>Target latency: {assistant.session.targetLatencyMs}ms</p>
                    <p>Audio format: {assistant.session.sampleRate}Hz mono, {assistant.session.frameDurationMs}ms</p>
                  </div>
                ) : null}
                {assistant.error ? <p className="mt-3 text-sm text-red-300">{assistant.error}</p> : null}
                {assistant.emotions.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {assistant.emotions.map((emotion) => (
                      <Badge key={emotion.source} variant="outline" className="border-white/10 bg-white/10 text-slate-100">
                        {emotion.source}: {emotion.emotion} {Math.round(emotion.intensity * 100)}%
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6">
            <Card className="border-white/10 bg-white/5 backdrop-blur">
              <CardHeader>
                <CardTitle>Streaming Transcript</CardTitle>
                <CardDescription>The assistant begins on partial STT and corrects course when the final transcript lands.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">User Partial</p>
                    <p className="mt-2 min-h-[56px] text-sm text-slate-100">{assistant.partialUserText || "Waiting for speech..."}</p>
                  </div>
                  <div className="rounded-xl border border-fuchsia-400/20 bg-fuchsia-400/5 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-fuchsia-200">Assistant Partial</p>
                    <p className="mt-2 min-h-[56px] text-sm text-slate-100">{assistant.partialAssistantText || "Waiting for tokens..."}</p>
                  </div>
                </div>

                <div className="max-h-[360px] space-y-3 overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-4">
                  {assistant.messages.length === 0 ? (
                    <p className="text-sm text-slate-400">Start a session and speak into your microphone.</p>
                  ) : (
                    assistant.messages.map((message) => (
                      <div key={message.id} className="rounded-lg border border-white/10 bg-white/5 p-3">
                        <div className="mb-1 flex items-center gap-2">
                          <Badge variant="outline" className="border-white/10 bg-white/10 text-slate-100">
                            {message.speaker}
                          </Badge>
                        </div>
                        <p className="text-sm text-slate-100">{message.text}</p>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="border-white/10 bg-white/5 backdrop-blur">
              <CardHeader>
                <CardTitle>Latency Trace</CardTitle>
                <CardDescription>Measured on each turn: STT first partial, STT final, first LLM token, first TTS audio, and total turn time.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3">
                  {assistant.latencies.length === 0 ? (
                    <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">
                      Live latency metrics appear here once the first turn completes.
                    </div>
                  ) : (
                    assistant.latencies.map((latency) => (
                      <div key={latency.turnId} className="rounded-xl border border-white/10 bg-black/20 p-4">
                        <div className="mb-3 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <TimerReset className="h-4 w-4 text-cyan-300" />
                            <span className="text-sm font-medium text-white">Turn {latency.turnId.slice(0, 8)}</span>
                          </div>
                          <Badge
                            variant="outline"
                            className={
                              (latency.perceivedLatencyMs || 9999) <= latency.targetLatencyMs
                                ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
                                : "border-amber-400/30 bg-amber-400/10 text-amber-100"
                            }
                          >
                            {latency.perceivedLatencyMs ?? "n/a"}ms perceived
                          </Badge>
                        </div>

                        <div className="grid gap-3 text-sm text-slate-200 md:grid-cols-5">
                          <Metric label="STT partial" value={latency.sttFirstPartialMs} />
                          <Metric label="STT final" value={latency.sttFinalMs} />
                          <Metric label="LLM first token" value={latency.llmFirstTokenMs} />
                          <Metric label="TTS first audio" value={latency.ttsFirstAudioMs} />
                          <Metric label="Total turn" value={latency.totalTurnMs} />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-semibold text-white">{value ?? "n/a"}{value !== null ? "ms" : ""}</p>
    </div>
  );
}
